/**
 * Read what a local design system says about itself.
 *
 * For a component that lives in the project's own source rather than an npm
 * package, the engine knew almost nothing: 7% of college-town's 246 components
 * had a real description, 21% had a usage example, and none had its allowed
 * variant values. Everything needed was sitting in files we never opened.
 *
 * Three sources, all deterministic, none specific to any design system:
 *
 *   VARIANTS   `cva()` and `tv()` declare the exact set of values a prop
 *              accepts. Without them the model picks a plausible-sounding
 *              value — `variant="soft"` on a component whose options are
 *              default | secondary | destructive — which renders as the
 *              default and silently ignores the intent. With them the choice
 *              is closed.
 *
 *   PROSE      A story's `parameters.docs.description.component` is the team
 *              explaining, in their own words, what a component is for and
 *              when to reach for it. 51 of college-town's stories carry one.
 *              That is better than any description we could synthesise,
 *              because it encodes intent rather than shape.
 *
 *   PROP DOCS  `argTypes[].description` explains individual props. 33 stories
 *              carry these.
 *
 * Parsed with the TypeScript AST rather than regex: variant maps nest, and a
 * brace-counting parser silently truncates a component's options — which would
 * be worse than reading none, because a partial list looks authoritative.
 */

import fs from 'fs';
import path from 'path';
import ts from 'typescript';
import { logger } from '../logger.js';

export interface VariantFacts {
  /** Prop name to its allowed values, e.g. `variant` -> [default, destructive]. */
  options: Record<string, string[]>;
  /** Values applied when the prop is omitted. */
  defaults: Record<string, string>;
}

export interface SourceFacts {
  /** Prose describing what the component is for, from its story. */
  description?: string;
  /** Per-prop documentation, from the story's argTypes. */
  propDocs?: Record<string, string>;
  variants?: VariantFacts;
}

function parse(file: string): ts.SourceFile | null {
  try {
    return ts.createSourceFile(
      file,
      fs.readFileSync(file, 'utf8'),
      ts.ScriptTarget.Latest,
      true,
      /\.tsx?$/.test(file) ? ts.ScriptKind.TSX : ts.ScriptKind.JS,
    );
  } catch {
    return null;
  }
}

const literalName = (n: ts.PropertyName): string | null => {
  if (ts.isIdentifier(n) || ts.isPrivateIdentifier(n)) return n.text;
  if (ts.isStringLiteral(n) || ts.isNumericLiteral(n)) return n.text;
  return null;
};

/**
 * Allowed values declared by `cva()` / `tv()` / `cn()`-style variant maps.
 *
 * Shape: `cva(base, { variants: { size: { sm: …, lg: … } }, defaultVariants: { size: 'sm' } })`
 * The keys of each inner object are the values the prop accepts; their bodies
 * are class strings we deliberately ignore.
 */
export function extractVariants(componentFile: string): VariantFacts | null {
  const source = parse(componentFile);
  if (!source) return null;

  const options: Record<string, string[]> = {};
  const defaults: Record<string, string> = {};

  const readVariantMap = (obj: ts.ObjectLiteralExpression) => {
    for (const prop of obj.properties) {
      if (!ts.isPropertyAssignment(prop)) continue;
      const propName = literalName(prop.name);
      if (!propName || !ts.isObjectLiteralExpression(prop.initializer)) continue;
      const values = prop.initializer.properties
        .map(p => (ts.isPropertyAssignment(p) || ts.isShorthandPropertyAssignment(p)) ? literalName(p.name) : null)
        .filter((v): v is string => !!v);
      if (values.length) {
        // Merge rather than replace: a file can declare several variant maps
        // (a Button and its ButtonGroup), and both describe the same prop space.
        options[propName] = [...new Set([...(options[propName] || []), ...values])];
      }
    }
  };

  const visit = (node: ts.Node) => {
    if (ts.isCallExpression(node)) {
      const callee = ts.isIdentifier(node.expression) ? node.expression.text : '';
      if (callee === 'cva' || callee === 'tv') {
        for (const arg of node.arguments) {
          if (!ts.isObjectLiteralExpression(arg)) continue;
          for (const prop of arg.properties) {
            if (!ts.isPropertyAssignment(prop)) continue;
            const key = literalName(prop.name);
            if (key === 'variants' && ts.isObjectLiteralExpression(prop.initializer)) {
              readVariantMap(prop.initializer);
            }
            if (key === 'defaultVariants' && ts.isObjectLiteralExpression(prop.initializer)) {
              for (const d of prop.initializer.properties) {
                if (!ts.isPropertyAssignment(d)) continue;
                const dName = literalName(d.name);
                if (dName && (ts.isStringLiteral(d.initializer) || ts.isNoSubstitutionTemplateLiteral(d.initializer))) {
                  defaults[dName] = d.initializer.text;
                }
              }
            }
          }
        }
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(source);

  return Object.keys(options).length ? { options, defaults } : null;
}

/** Collapse the markdown a docs block usually contains into one useful line. */
function firstMeaningfulLine(text: string): string {
  const lines = text.split('\n').map(l => l.trim()).filter(Boolean);
  for (const line of lines) {
    // Skip the heading, which almost always just repeats the component name.
    if (line.startsWith('#')) continue;
    if (line.startsWith('```')) break;
    return line.replace(/\s+/g, ' ').slice(0, 300);
  }
  return '';
}

/**
 * Prose and prop docs from a component's own story.
 *
 * Reads `parameters.docs.description.component` and `argTypes[].description`
 * wherever they appear, rather than walking an exact path — teams nest meta
 * differently, and a strict path finds nothing in half of real projects.
 */
export function extractStoryDocs(storyFile: string): { description?: string; propDocs: Record<string, string> } {
  const source = parse(storyFile);
  const propDocs: Record<string, string> = {};
  if (!source) return { propDocs };

  let description: string | undefined;

  const textOf = (node: ts.Expression): string | null => {
    if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) return node.text;
    if (ts.isTemplateExpression(node)) return node.head.text;
    return null;
  };

  const visit = (node: ts.Node) => {
    if (ts.isPropertyAssignment(node)) {
      const name = literalName(node.name);

      // `description: { component: '…' }` — the component-level blurb.
      if (name === 'description' && ts.isObjectLiteralExpression(node.initializer)) {
        for (const p of node.initializer.properties) {
          if (!ts.isPropertyAssignment(p)) continue;
          if (literalName(p.name) !== 'component') continue;
          const raw = textOf(p.initializer);
          if (raw && !description) description = firstMeaningfulLine(raw);
        }
      }

      // `argTypes: { variant: { description: '…' } }`
      if (name === 'argTypes' && ts.isObjectLiteralExpression(node.initializer)) {
        for (const entry of node.initializer.properties) {
          if (!ts.isPropertyAssignment(entry) || !ts.isObjectLiteralExpression(entry.initializer)) continue;
          const propName = literalName(entry.name);
          if (!propName) continue;
          for (const field of entry.initializer.properties) {
            if (!ts.isPropertyAssignment(field)) continue;
            if (literalName(field.name) !== 'description') continue;
            const raw = textOf(field.initializer);
            if (raw) propDocs[propName] = raw.replace(/\s+/g, ' ').slice(0, 200);
          }
        }
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(source);

  return { description, propDocs };
}

/** The story file that documents a component, if one sits beside it. */
export function findStoryFor(componentFile: string): string | null {
  const dir = path.dirname(componentFile);
  const base = path.basename(componentFile).replace(/\.[jt]sx?$/, '');
  const candidates = [
    ...['tsx', 'ts', 'jsx', 'js'].map(e => path.join(dir, `${base}.stories.${e}`)),
    // index.ts re-exports; the story is usually named for the directory.
    ...['tsx', 'ts', 'jsx', 'js'].map(e => path.join(dir, `${path.basename(dir)}.stories.${e}`)),
  ];
  return candidates.find(f => fs.existsSync(f)) ?? null;
}

/**
 * Everything readable about a locally-defined component.
 *
 * Never throws: this raises fidelity, and a generation must still work when a
 * file is unparseable or absent.
 */
export function readSourceFacts(componentFile: string): SourceFacts {
  const facts: SourceFacts = {};
  if (!componentFile || !fs.existsSync(componentFile)) return facts;

  try {
    const variants = extractVariants(componentFile);
    if (variants) facts.variants = variants;
  } catch { /* unparseable component */ }

  try {
    const storyFile = findStoryFor(componentFile);
    if (storyFile) {
      const { description, propDocs } = extractStoryDocs(storyFile);
      if (description) facts.description = description;
      if (Object.keys(propDocs).length) facts.propDocs = propDocs;
    }
  } catch { /* unparseable story */ }

  return facts;
}

/** Render variant facts as the line the model reads in the catalog. */
export function formatVariants(v: VariantFacts): string {
  return Object.entries(v.options)
    .map(([prop, values]) => {
      const def = v.defaults[prop];
      const shown = values.map(x => (x === def ? `${x} (default)` : x));
      return `${prop}: ${shown.join(' | ')}`;
    })
    .join('; ');
}

/** Attach source-derived facts to a discovered component catalog, in place. */
export function enrichWithSourceFacts(components: any[]): number {
  let enriched = 0;
  for (const component of components) {
    const file = component.filePath;
    if (!file || file.includes('node_modules')) continue;

    const facts = readSourceFacts(file);
    if (!facts.description && !facts.variants && !facts.propDocs) continue;

    // The team's own words beat anything we generated, but never overwrite a
    // description a project explicitly declared in its config.
    if (facts.description && /^\w+ component$/.test(component.description || '')) {
      component.description = facts.description;
    }
    if (facts.variants) {
      const line = formatVariants(facts.variants);
      component.description = component.description
        ? `${component.description} — ${line}`
        : line;
    }
    if (facts.propDocs) {
      component.propDocs = facts.propDocs;
    }
    enriched++;
  }
  if (enriched) logger.log(`📖 Read source facts for ${enriched} local component(s)`);
  return enriched;
}
