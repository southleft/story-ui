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
import { formatPropForCatalog, mergeProps, rankProps, type PropFact } from './propExtractor.js';
import { readLocalComponent, readLocalComponents } from './localComponentFacts.js';
import { saysMoreThanName } from './descriptionQuality.js';

export interface VariantFacts {
  /** Prop name to its allowed values, e.g. `variant` -> [default, destructive]. */
  options: Record<string, string[]>;
  /** Values applied when the prop is omitted. */
  defaults: Record<string, string>;
}

export interface SourceFacts {
  /** Prose describing what the component is for: its story's docs block, else the JSDoc above its export. */
  description?: string;
  /** Per-prop documentation: the story's argTypes, filled in by the declaration's own JSDoc. */
  propDocs?: Record<string, string>;
  variants?: VariantFacts;
  /**
   * Props the component's own declaration states — its interface or type
   * alias, read with the AST (see localComponentFacts). For a LOCAL component
   * this is the primary statement of its API; npm declarations do not exist.
   */
  declaredProps?: PropFact[];
  /** Standard attributes the props type extends and forwards, e.g. `React.HTMLAttributes<HTMLElement>`. */
  passthrough?: string;
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
export function readSourceFacts(componentFile: string, componentName?: string): SourceFacts {
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

  /**
   * The component's own declaration and the JSDoc above its export.
   *
   * Nothing read the paragraph a team writes above `export const Button`;
   * the only prose this module knew came from a story's docs block, which
   * most hand-written design systems do not carry. Measured on 46 components
   * with a JSDoc apiece: 0 descriptions. The story's block still wins when
   * both exist; the JSDoc fills the gap, and the interface's per-prop JSDoc
   * fills whatever the story's argTypes did not describe.
   */
  try {
    const local = componentName
      ? readLocalComponent(componentFile, componentName)
      : readLocalComponents(componentFile).find(c => c.exported && (c.props.length > 0 || !!c.doc)) ?? null;
    if (local) {
      if (local.props.length) facts.declaredProps = local.props;
      if (local.passthrough) facts.passthrough = local.passthrough;
      if (local.doc && !facts.description) facts.description = local.doc;
      const docs: Record<string, string> = { ...(facts.propDocs ?? {}) };
      for (const p of local.props) if (p.doc && !docs[p.name]) docs[p.name] = p.doc;
      if (Object.keys(docs).length) facts.propDocs = docs;
    }
  } catch { /* unparseable component */ }

  return facts;
}

/**
 * Merge source-derived facts into declaration-derived prop facts, field-wise.
 *
 * The same rule as the Carbon propTypes merge in propExtractor: neither source
 * is authoritative for everything, so each field comes from whichever reading
 * has it, and a present value beats an absent one. For an npm library the
 * declarations carry types and the source usually adds nothing; for a
 * LOCAL-SOURCE component there are often no declarations at all, and the
 * cva()/tv() map is the only statement of what `variant` and `size` accept.
 *
 * A cva variant map is a CLOSED set: the keys are the lookup table the
 * component's className resolution actually indexes, so `optionsOpen` is
 * deliberately not set — offering free input would claim a latitude the
 * component does not have. Openness still applies when a DECLARATION supplied
 * the options and marked them open; those options win and are left alone.
 */
export function mergePropFactsFromSource(declared: PropFact[], facts: SourceFacts): PropFact[] {
  const byName = new Map<string, PropFact>();
  // Package declarations first, the component's own interface filling every
  // field they left empty — for a local component that is all of them.
  const base = facts.declaredProps?.length ? mergeProps(declared, facts.declaredProps) : declared;
  for (const p of base) byName.set(p.name, { ...p });

  const variantOptions = facts.variants?.options ?? {};
  const variantDefaults = facts.variants?.defaults ?? {};
  for (const [name, values] of Object.entries(variantOptions)) {
    if (values.length === 0) continue;
    const existing = byName.get(name);
    if (existing) {
      // Declarations win when they answered; the source fills the gaps.
      if (!existing.options || existing.options.length === 0) {
        existing.options = [...values];
        delete existing.optionsOpen;
      }
      if (existing.defaultValue === undefined && variantDefaults[name] !== undefined) {
        existing.defaultValue = variantDefaults[name];
      }
    } else {
      byName.set(name, {
        name,
        required: false,
        options: [...values],
        ...(variantDefaults[name] !== undefined ? { defaultValue: variantDefaults[name] } : {}),
      });
    }
  }

  // The team's own prop prose, from the story's argTypes. Doc only — a
  // description proves nothing about the values a prop accepts.
  for (const [name, doc] of Object.entries(facts.propDocs ?? {})) {
    const existing = byName.get(name);
    if (existing && !existing.doc) existing.doc = doc;
  }

  return [...byName.values()];
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

    const facts = readSourceFacts(file, component.name);
    if (!facts.description && !facts.variants && !facts.propDocs && !facts.declaredProps) continue;

    // The team's own words beat anything we generated, but never overwrite a
    // description that already says something — one a project declared in
    // its config, or one read earlier. Judged by the shared predicate, so a
    // `<Name> component` placeholder counts as absent here exactly as it does
    // in the catalog and the bench.
    if (facts.description && !saysMoreThanName(component.name, component.description)) {
      component.description = facts.description;
    }
    /**
     * The catalog line per prop, from the component's own declaration.
     *
     * Discovery records prop NAMES; generationCore renders the full form —
     * type, legal values, default, REQUIRED — only for props it read from an
     * installed package's declarations. A local component's interface is the
     * same fact in the same file we already opened, so it gets the same line.
     * Names discovery found elsewhere (a story's args) are kept after it:
     * `disabled` on a Button is real, it arrives through the attributes the
     * interface extends.
     */
    if (facts.declaredProps?.length) {
      const merged = mergePropFactsFromSource(facts.declaredProps, { variants: facts.variants });
      const declaredNames = new Set(merged.map(p => p.name));
      const live = merged.filter(p => !p.deprecated);
      const extra = (Array.isArray(component.props) ? component.props as string[] : [])
        .map(p => String(p).replace(/[?:( ].*$/, ''))
        .filter(n => n && !declaredNames.has(n));
      component.props = [...rankProps(live).map(formatPropForCatalog), ...extra];
      const deprecated = merged.filter(p => p.deprecated);
      if (deprecated.length) {
        const avoid = deprecated.slice(0, 8).map(p =>
          p.deprecated && p.deprecated !== 'deprecated' ? `${p.name} (${p.deprecated.replace(/\s+/g, ' ').slice(0, 60)})` : p.name);
        const note = `DO NOT USE these deprecated props: ${avoid.join('; ')}`;
        component.description = saysMoreThanName(component.name, component.description)
          ? `${component.description} — ${note}` : note;
      }
    }
    if (facts.variants) {
      const line = formatVariants(facts.variants);
      component.description = saysMoreThanName(component.name, component.description)
        ? `${component.description} — ${line}`
        : line;
    }
    if (facts.propDocs) {
      component.propDocs = facts.propDocs;
      // The field the catalog renders when a request asks for prop docs.
      if (!component.__propDocs) component.__propDocs = facts.propDocs;
    }
    if (facts.passthrough && !component.passthroughAttributes) {
      component.passthroughAttributes = facts.passthrough;
    }
    enriched++;
  }
  if (enriched) logger.log(`📖 Read source facts for ${enriched} local component(s)`);
  return enriched;
}
