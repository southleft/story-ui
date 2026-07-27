/**
 * Prop extraction — read a design system's real component APIs from its types.
 *
 * The catalog gives the model component NAMES. Everything else — that `NavLink`
 * has `active`, that `TextInput` takes `leftSection`, that a variant is one of
 * three specific strings — it has to infer. For a well-known library it infers
 * correctly often enough to look fine. For a private design system, which is the
 * case this tool exists to serve, it is guessing.
 *
 * Scope is deliberately syntactic. Fully resolving `TextInputProps extends
 * BoxProps, __BaseInputProps, StylesApiProps<TextInputFactory>` across barrel
 * re-exports needs a TypeChecker and full module resolution — an order of
 * magnitude more work and runtime. Measured against Mantine 8.3.9, reading only
 * locally-declared members covers 231 of 280 prop interfaces (82%), and the
 * shortfall is concentrated in input primitives whose props are well known to
 * every model. That is the right trade: most of the value, none of the
 * type-resolution project.
 */

import ts from 'typescript';
import fs from 'fs';
import path from 'path';
import { createRequire } from 'module';
import { logger } from '../logger.js';

export interface PropFact {
  name: string;
  /** Type text as written, trimmed. Undefined when it is unhelpfully long. */
  type?: string;
  required: boolean;
  /** First line of the JSDoc comment, when present. */
  doc?: string;
}

export interface ComponentFacts {
  /** Component name, derived from `<Name>Props`. */
  name: string;
  props: PropFact[];
  /** Values of `<Name>Variant`, when the library declares one. */
  variants?: string[];
}

export interface ExtractedProps {
  importPath: string;
  version?: string;
  components: Record<string, ComponentFacts>;
  /** Interfaces that declare nothing locally, so callers can be honest about gaps. */
  inheritedOnly: string[];
  extractedAt: string;
}

/** Long unions and generics hurt more than they help inside a prompt. */
const MAX_TYPE_TEXT = 80;

function shortType(node: ts.TypeNode | undefined, source: ts.SourceFile): string | undefined {
  if (!node) return undefined;
  const text = node.getText(source).replace(/\s+/g, ' ').trim();
  return text.length <= MAX_TYPE_TEXT ? text : undefined;
}

function firstDocLine(member: ts.Node, source: ts.SourceFile): string | undefined {
  const ranges = ts.getLeadingCommentRanges(source.getFullText(), member.getFullStart());
  if (!ranges?.length) return undefined;
  const raw = source.getFullText().slice(ranges[ranges.length - 1].pos, ranges[ranges.length - 1].end);
  const cleaned = raw
    .replace(/^\/\*\*?/, '')
    .replace(/\*\/$/, '')
    .split('\n')
    .map(l => l.replace(/^\s*\*?\s?/, '').trim())
    .filter(Boolean)
    .join(' ')
    .trim();
  if (!cleaned) return undefined;
  // Drop @default/@deprecated tails; the first sentence carries the meaning.
  const sentence = cleaned.split(/\s@\w+/)[0].trim();
  return sentence.length > 140 ? `${sentence.slice(0, 137)}…` : sentence || undefined;
}

function collectFromFile(filePath: string, out: Record<string, ComponentFacts>, inheritedOnly: string[]): void {
  let text: string;
  try {
    text = fs.readFileSync(filePath, 'utf-8');
  } catch {
    return;
  }
  // Cheap pre-filter — most declaration files contain no component props at all.
  if (!text.includes('Props') && !text.includes('Variant')) return;

  const source = ts.createSourceFile(filePath, text, ts.ScriptTarget.Latest, true);

  ts.forEachChild(source, node => {
    // interface <Name>Props { ... }
    if (ts.isInterfaceDeclaration(node) && node.name.text.endsWith('Props')) {
      const componentName = node.name.text.replace(/Props$/, '');
      if (!componentName) return;

      const props: PropFact[] = [];
      for (const member of node.members) {
        if (!ts.isPropertySignature(member) || !member.name) continue;
        const name = member.name.getText(source);
        if (!/^[a-zA-Z_$][\w$]*$/.test(name)) continue; // skip index/computed members
        // Library internals (__staticSelector, __vars, _internal) are noise to a
        // consumer and were surfacing in the ranked list.
        if (name.startsWith('_')) continue;
        props.push({
          name,
          type: shortType(member.type, source),
          required: !member.questionToken,
          doc: firstDocLine(member, source),
        });
      }

      if (props.length === 0) {
        if (!inheritedOnly.includes(componentName)) inheritedOnly.push(componentName);
        return;
      }
      const record = (key: string) => {
        const existing = out[key];
        out[key] = {
          name: key,
          props: existing ? mergeProps(existing.props, props) : props,
          variants: existing?.variants,
        };
      };
      record(componentName);

      /**
       * Also register under the name with a structural qualifier removed.
       *
       * Libraries split a props type and name the halves: MUI declares
       * `ButtonOwnProps`, which strips to `ButtonOwn` and matches no component,
       * so its props were lost entirely. 71 of MUI's components use OwnProps
       * against 69 using plain Props — half the library's prop knowledge went
       * missing, which is what a measured 42% coverage was made of.
       *
       * These qualifiers are TypeScript structuring conventions rather than any
       * library's vocabulary, and registering an ALIAS can only add: it never
       * overwrites a component that genuinely carries the longer name.
       */
      const alias = componentName.replace(/(Own|Base|Root|Inner|Slot)$/, '');
      if (alias && alias !== componentName && !out[alias]) record(alias);
    }

    // type <Name>Variant = 'a' | 'b'
    if (ts.isTypeAliasDeclaration(node) && node.name.text.endsWith('Variant')) {
      const componentName = node.name.text.replace(/Variant$/, '');
      if (!componentName || !ts.isUnionTypeNode(node.type)) return;
      const values = node.type.types
        .map(t => (ts.isLiteralTypeNode(t) && ts.isStringLiteral(t.literal) ? t.literal.text : null))
        .filter((v): v is string => !!v);
      if (values.length === 0) return;
      out[componentName] = out[componentName]
        ? { ...out[componentName], variants: values }
        : { name: componentName, props: [], variants: values };
    }
  });
}

function mergeProps(a: PropFact[], b: PropFact[]): PropFact[] {
  const byName = new Map(a.map(p => [p.name, p]));
  for (const p of b) if (!byName.has(p.name)) byName.set(p.name, p);
  return [...byName.values()];
}

function packageRoot(projectRoot: string, importPath: string): string | null {
  const pkgName = importPath.startsWith('@')
    ? importPath.split('/').slice(0, 2).join('/')
    : importPath.split('/')[0];
  try {
    const req = createRequire(path.join(projectRoot, 'package.json'));
    let dir = path.dirname(req.resolve(pkgName));
    for (let i = 0; i < 8; i++) {
      if (fs.existsSync(path.join(dir, 'package.json'))) {
        const pkg = JSON.parse(fs.readFileSync(path.join(dir, 'package.json'), 'utf-8'));
        if (pkg?.name === pkgName) return dir;
      }
      const parent = path.dirname(dir);
      if (parent === dir) break;
      dir = parent;
    }
  } catch { /* fall through */ }
  const guess = path.join(projectRoot, 'node_modules', ...pkgName.split('/'));
  return fs.existsSync(guess) ? guess : null;
}

/** Walk for .d.ts files, skipping the noisy corners of a published package. */
function findDeclarationFiles(root: string, limit = 1500): string[] {
  const results: string[] = [];
  const skip = new Set(['node_modules', 'esm', 'cjs', '__tests__', 'test', 'dist-types']);
  const walk = (dir: string, depth: number) => {
    if (results.length >= limit || depth > 6) return;
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      if (results.length >= limit) return;
      const full = path.join(dir, e.name);
      if (e.isDirectory()) {
        if (skip.has(e.name) || e.name.startsWith('.')) continue;
        walk(full, depth + 1);
      } else if (e.name.endsWith('.d.ts')) {
        results.push(full);
      }
    }
  };
  walk(root, 0);
  return results;
}

function cachePath(projectRoot: string, importPath: string, version?: string): string {
  const safe = importPath.replace(/[^a-z0-9]+/gi, '-');
  return path.join(projectRoot, '.story-ui', 'knowledge', `${safe}@${version || 'unknown'}.props.json`);
}

export async function extractProps(
  importPath: string,
  projectRoot: string = process.cwd(),
  options: { version?: string; force?: boolean } = {},
): Promise<ExtractedProps | null> {
  const root = packageRoot(projectRoot, importPath);
  if (!root) return null;

  let version = options.version;
  if (!version) {
    try {
      version = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf-8')).version;
    } catch { /* unknown */ }
  }

  const cacheFile = cachePath(projectRoot, importPath, version);
  if (!options.force && fs.existsSync(cacheFile)) {
    try {
      return JSON.parse(fs.readFileSync(cacheFile, 'utf-8')) as ExtractedProps;
    } catch { /* rebuild */ }
  }

  const started = Date.now();
  const files = findDeclarationFiles(root);
  const components: Record<string, ComponentFacts> = {};
  const inheritedOnly: string[] = [];
  for (const file of files) collectFromFile(file, components, inheritedOnly);

  const extracted: ExtractedProps = {
    importPath,
    version,
    components,
    inheritedOnly,
    extractedAt: new Date().toISOString(),
  };

  try {
    fs.mkdirSync(path.dirname(cacheFile), { recursive: true });
    fs.writeFileSync(cacheFile, JSON.stringify(extracted), 'utf-8');
  } catch { /* cache is an optimisation */ }

  logger.log(
    `🧠 Extracted props for ${Object.keys(components).length} components from ${importPath}` +
    `${version ? `@${version}` : ''} in ${Date.now() - started}ms ` +
    `(${inheritedOnly.length} inherit-only)`,
  );
  return extracted;
}

/**
 * Props most worth spending prompt space on: the ones that decide behaviour.
 * Handlers and state first, then content slots, then styling.
 */
export function rankProps(props: PropFact[]): PropFact[] {
  const tier = (p: PropFact): number => {
    if (p.required) return 0;
    if (/^on[A-Z]/.test(p.name)) return 1;
    if (/^(value|defaultValue|checked|active|selected|opened|open|disabled|loading|error)$/i.test(p.name)) return 2;
    if (/(section|icon|adornment|prefix|suffix|slot|label|placeholder)/i.test(p.name)) return 3;
    if (/^(variant|size|color|radius|shadow|position|orientation)$/i.test(p.name)) return 4;
    return 5;
  };
  return [...props].sort((a, b) => tier(a) - tier(b) || a.name.localeCompare(b.name));
}
