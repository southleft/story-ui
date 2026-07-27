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
  /**
   * Value declared by `@default`.
   *
   * Without it the model restates the default explicitly — `variant="text"` on
   * an MUI Button — which is noise a design system reviewer reads as someone
   * who did not know the API.
   */
  defaultValue?: string;
  /**
   * Text of `@deprecated`. Presence alone means DO NOT USE.
   *
   * The single fastest way for generated code to be rejected by the team that
   * owns the design system. Atlassian's Lozenge deprecates both `isBold` and
   * `style`, and the replacement is named in the tag ("use Tag instead") — a
   * fact no amount of model prior supplies, because it is specific to the
   * installed version.
   */
  deprecated?: string;
}

export interface ComponentFacts {
  /** Component name, derived from `<Name>Props`. */
  name: string;
  props: PropFact[];
  /** Values of `<Name>Variant`, when the library declares one. */
  variants?: string[];
  /** Prose from the component's own declaration, when it says anything. */
  doc?: string;
}

export interface ExtractedProps {
  /** Extractor schema that produced this record; see EXTRACTOR_SCHEMA. */
  schema?: number;
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

/** The JSDoc block immediately preceding a node, comment syntax stripped. */
function rawDocBlock(node: ts.Node, source: ts.SourceFile): string | undefined {
  const full = source.getFullText();
  const ranges = ts.getLeadingCommentRanges(full, node.getFullStart());
  if (!ranges?.length) return undefined;
  const raw = full.slice(ranges[ranges.length - 1].pos, ranges[ranges.length - 1].end);
  const cleaned = raw
    .replace(/^\/\*\*?/, '')
    .replace(/\*\/$/, '')
    .split('\n')
    .map(l => l.replace(/^\s*\*?\s?/, '').trim())
    .filter(Boolean)
    .join(' ')
    .trim();
  return cleaned || undefined;
}

const clip = (s: string, max: number) => (s.length > max ? `${s.slice(0, max - 1)}…` : s);

/**
 * The prose part of a JSDoc block: everything before the first tag.
 *
 * Splitting on `\s@\w+` misses a block that OPENS with one, so MUI's
 * `@ignore - internal component.` was recorded as a component description —
 * an instruction to tooling, presented to the model as documentation.
 *
 * MUI also runs its link sections into the same paragraph, so Chip's real
 * sentence arrived with `Demos: - [Chip](https://mui.com…` glued to the end.
 * Those headings terminate the prose as surely as a tag does.
 */
function prosePart(cleaned: string): string {
  return cleaned
    .split(/(?:^|\s)@\w+/)[0]
    .split(/\b(?:Demos?|API)\s*:/)[0]
    // An inline link is part of the sentence — "used by the [Vertical
    // Stepper](https://…)" reads correctly once the URL goes and becomes
    // nonsense if the whole link goes. Keep the text, drop the address; a URL
    // in a prompt is spent context the model cannot follow.
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/https?:\/\/\S+/g, '')
    .replace(/\s{2,}/g, ' ')
    .trim();
}

/**
 * Prose, default and deprecation from one JSDoc block.
 *
 * The tags used to be split off and thrown away on the reasoning that "the
 * first sentence carries the meaning". It carries the DESCRIPTION; it does not
 * carry that `isBold` is deprecated in favour of Tag, or that `variant`
 * already defaults to `text`. Those two facts are worth more to a design
 * system team than the sentence they were discarded to protect, and neither is
 * recoverable from a model prior because both are specific to the installed
 * version.
 */
function readDoc(node: ts.Node, source: ts.SourceFile): Pick<PropFact, 'doc' | 'defaultValue' | 'deprecated'> {
  const cleaned = rawDocBlock(node, source);
  if (!cleaned) return {};

  const prose = prosePart(cleaned);

  // `@default 'primary'` / `@defaultValue 10`. Stop at the next tag.
  const defaultMatch = cleaned.match(/@default(?:Value)?\s+([^@]+)/);
  const defaultValue = defaultMatch ? clip(defaultMatch[1].trim().replace(/[.\s]+$/, ''), 40) : undefined;

  // `@deprecated` may carry no text; the tag alone is the signal, so an empty
  // string would be falsy and lose it. Record a usable sentence either way.
  const deprecatedMatch = cleaned.match(/@deprecated\b([^@]*)/);
  const deprecated = deprecatedMatch
    ? clip(deprecatedMatch[1].trim().replace(/^[.\s-]+/, ''), 120) || 'deprecated'
    : undefined;

  return {
    doc: prose ? clip(prose, 140) : undefined,
    defaultValue,
    deprecated,
  };
}

/**
 * Prose from a component's own declaration — `declare const Button: ...`.
 *
 * Most of what a published library writes here is not prose. MUI's Button
 * carries only a list of documentation links:
 *
 *   Demos: - [Button](https://mui.com/material-ui/react-button/)
 *   API:   - [Button API](https://mui.com/material-ui/api/button/)
 *
 * Recording that as the component's description would be worse than recording
 * nothing: the bench would report full coverage, and the model would be handed
 * a URL where it expects a definition. Strip link furniture first and judge
 * what survives, which is the same test the bench applies to boilerplate.
 */
function declarationDoc(node: ts.Node, source: ts.SourceFile, name: string): string | undefined {
  const cleaned = rawDocBlock(node, source);
  if (!cleaned) return undefined;

  const prose = prosePart(cleaned);
  if (!prose) return undefined;

  const residue = prose
    // Markdown links, bare URLs, and the headings that introduce them.
    .replace(/\[[^\]]*\]\([^)]*\)/g, '')
    .replace(/https?:\/\/\S+/g, '')
    .replace(/\b(demos?|api|see|inherits|documentation|docs)\b/gi, '')
    .replace(new RegExp(name, 'gi'), '')
    .replace(/[^a-zA-Z0-9]+/g, '');

  // Same threshold the bench uses for "says something the name does not".
  return residue.length >= 12 ? clip(prose, 160) : undefined;
}

function collectFromFile(filePath: string, out: Record<string, ComponentFacts>, inheritedOnly: string[]): void {
  let text: string;
  try {
    text = fs.readFileSync(filePath, 'utf-8');
  } catch {
    return;
  }
  const isDeclaration = filePath.endsWith('.d.ts');

  // Cheap pre-filter — most files in a published package describe no props at
  // all, and parsing a large package's entire JS output would dominate the
  // runtime of a step that is meant to be incidental.
  if (isDeclaration) {
    if (!text.includes('Props') && !text.includes('Variant')) return;
  } else if (!text.includes('.propTypes')) {
    return;
  }

  const source = ts.createSourceFile(filePath, text, ts.ScriptTarget.Latest, true);

  // A JS bundle has no interfaces to read; its API is in propTypes.
  if (!isDeclaration) {
    collectPropTypes(source, out);
    return;
  }

  /**
   * Property signatures from a type's members.
   *
   * Shared by interfaces and type aliases: `interface XProps {}` and
   * `type XProps = {}` describe the same thing, and only the former was read.
   */
  const readMembers = (members: readonly ts.TypeElement[]): PropFact[] => {
    const found: PropFact[] = [];
    for (const member of members) {
      if (!ts.isPropertySignature(member) || !member.name) continue;
      const name = member.name.getText(source);
      if (!/^[a-zA-Z_$][\w$]*$/.test(name)) continue;
      if (name.startsWith('_')) continue;
      found.push({
        name,
        type: shortType(member.type, source),
        required: !member.questionToken,
        ...readDoc(member, source),
      });
    }
    return found;
  };

  ts.forEachChild(source, node => {
    /**
     * type <Name>Props = { ... }  and  type <Name>Props = Base & { ... }
     *
     * Atlassian declares `type CheckboxProps`, `type HeadingProps` and
     * `type ButtonProps` as aliases rather than interfaces, so Button, Avatar,
     * Checkbox, Heading and Tag had NO props at all — 23% coverage on that
     * design system. Type aliases are the modern default across React
     * libraries; reading only interfaces silently halves what we know.
     */
    if (ts.isTypeAliasDeclaration(node) && node.name.text.endsWith('Props')) {
      const componentName = node.name.text.replace(/Props$/, '');
      if (!componentName) return;

      // A literal, or the literal halves of an intersection with a base type.
      const literals: ts.TypeLiteralNode[] = [];
      if (ts.isTypeLiteralNode(node.type)) literals.push(node.type);
      else if (ts.isIntersectionTypeNode(node.type)) {
        for (const part of node.type.types) if (ts.isTypeLiteralNode(part)) literals.push(part);
      }

      const props = literals.flatMap(l => readMembers(l.members));
      if (props.length > 0) {
        const record = (key: string) => {
          const existing = out[key];
          out[key] = {
            name: key,
            props: existing ? mergeProps(existing.props, props) : props,
            variants: existing?.variants,

            doc: existing?.doc,
          };
        };
        record(componentName);
        const alias = componentName.replace(/(Own|Base|Root|Inner|Slot)$/, '');
        if (alias && alias !== componentName && !out[alias]) record(alias);
      } else if (!inheritedOnly.includes(componentName)) {
        inheritedOnly.push(componentName);
      }
      return;
    }

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
          ...readDoc(member, source),
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

          doc: existing?.doc,
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

    /**
     * The component's own declaration, which is where prose lives when it
     * lives anywhere: `declare const Lozenge`, `declare function Tile`.
     *
     * Published libraries ship types but not narrative — measured description
     * coverage was 0% across Mantine, MUI, Carbon and Atlassian, against 99%
     * for a project whose source we can read. This closes part of that gap
     * from the one place npm packages do sometimes write it down.
     */
    const noteDoc = (declName: string, docNode: ts.Node) => {
      const doc = declarationDoc(docNode, source, declName);
      if (!doc) return;
      out[declName] = out[declName]
        ? { ...out[declName], doc: out[declName].doc || doc }
        : { name: declName, props: [], doc };
    };

    if (ts.isVariableStatement(node)) {
      // JSDoc attaches to the statement, not the individual declarator.
      for (const decl of node.declarationList.declarations) {
        if (ts.isIdentifier(decl.name) && /^[A-Z]/.test(decl.name.text)) {
          noteDoc(decl.name.text, node);
        }
      }
    } else if (
      (ts.isFunctionDeclaration(node) || ts.isClassDeclaration(node))
      && node.name && /^[A-Z]/.test(node.name.text)
    ) {
      noteDoc(node.name.text, node);
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

/**
 * Combine two readings of the same prop, field by field.
 *
 * First-wins-by-name discarded the more informative of the two. A library that
 * ships both declarations and JS carries the TYPE in `.d.ts` and the PROSE in
 * `.propTypes`, so whichever was read first silently suppressed the other:
 * Carbon's `children` arrived typed and undocumented, while `decorator` —
 * absent from the declaration — kept its description. Same component, same
 * pass, two different outcomes decided by file order.
 *
 * Neither source is authoritative for everything, so take each field from
 * whichever reading has it, and let a present value beat an absent one.
 */
function mergeProps(a: PropFact[], b: PropFact[]): PropFact[] {
  const byName = new Map<string, PropFact>();
  for (const p of [...a, ...b]) {
    const prior = byName.get(p.name);
    if (!prior) {
      byName.set(p.name, { ...p });
      continue;
    }
    byName.set(p.name, {
      name: p.name,
      type: prior.type ?? p.type,
      // A prop is required if either source says so; PropTypes' `isRequired`
      // and a missing `?` are the same statement in different dialects.
      required: prior.required || p.required,
      doc: prior.doc ?? p.doc,
      defaultValue: prior.defaultValue ?? p.defaultValue,
      deprecated: prior.deprecated ?? p.deprecated,
    });
  }
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

/**
 * Walk a published package, skipping its noisy corners.
 *
 * `.js` is collected alongside `.d.ts` because a large share of design systems
 * — Carbon, and most enterprise systems that predate or skip TypeScript —
 * document their API in `Component.propTypes` rather than in types. Carbon's
 * Tile.js carries 49 JSDoc blocks; its Tile.d.ts carries none, and reading
 * only declarations reported that library as having no prop documentation at
 * all.
 */
function findDeclarationFiles(root: string, limit = 3000): string[] {
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
      } else if (e.name.endsWith('.d.ts') || /\.(js|jsx)$/.test(e.name)) {
        results.push(full);
      }
    }
  };
  walk(root, 0);
  return results;
}

/**
 * Props documented as `Component.propTypes = { ... }`.
 *
 * The JSDoc sits on each member of the assigned object literal, exactly as it
 * does on an interface member, so the same reader applies once the object is
 * located. `isRequired` is the PropTypes spelling of a missing `?`.
 *
 * Deliberately does NOT record a type: `prop_types.default.node` describes the
 * runtime validator, not something a model should copy into JSX, and the
 * prose beside it is the part worth having.
 */
function collectPropTypes(source: ts.SourceFile, out: Record<string, ComponentFacts>): void {
  ts.forEachChild(source, node => {
    if (!ts.isExpressionStatement(node)) return;
    const expr = node.expression;
    if (!ts.isBinaryExpression(expr) || expr.operatorToken.kind !== ts.SyntaxKind.EqualsToken) return;
    if (!ts.isPropertyAccessExpression(expr.left) || expr.left.name.text !== 'propTypes') return;
    if (!ts.isIdentifier(expr.left.expression)) return;
    if (!ts.isObjectLiteralExpression(expr.right)) return;

    const componentName = expr.left.expression.text;
    if (!/^[A-Z]/.test(componentName)) return;

    const props: PropFact[] = [];
    for (const member of expr.right.properties) {
      if (!ts.isPropertyAssignment(member) || !member.name) continue;
      const name = member.name.getText(source).replace(/^['"]|['"]$/g, '');
      if (!/^[a-zA-Z_$][\w$]*$/.test(name) || name.startsWith('_')) continue;
      props.push({
        name,
        required: /\.isRequired\b/.test(member.initializer.getText(source)),
        ...readDoc(member, source),
      });
    }
    if (props.length === 0) return;

    const existing = out[componentName];
    out[componentName] = {
      name: componentName,
      props: existing ? mergeProps(existing.props, props) : props,
      variants: existing?.variants,
      doc: existing?.doc,
    };
  });
}

/**
 * Bump when the extractor learns to read something new.
 *
 * The cache key was the library's version alone, so it answered "have we read
 * THIS package before" when the question is "have we read it with THIS
 * extractor". Adding @default/@deprecated/component-prose changed nothing
 * anywhere: every environment served a cache written before those fields
 * existed, reported them as absent, and would have kept doing so until the
 * design system itself published a release. A stale cache that looks like a
 * measurement is how a knowledge layer silently stops improving.
 */
const EXTRACTOR_SCHEMA = 2;

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
      const cached = JSON.parse(fs.readFileSync(cacheFile, 'utf-8')) as ExtractedProps;
      // A cache from an older extractor is missing fields this one produces.
      // Re-reading costs a second; serving it silently costs the feature.
      if (cached.schema === EXTRACTOR_SCHEMA) return cached;
    } catch { /* rebuild */ }
  }

  const started = Date.now();
  const files = findDeclarationFiles(root);
  const components: Record<string, ComponentFacts> = {};
  const inheritedOnly: string[] = [];
  for (const file of files) collectFromFile(file, components, inheritedOnly);

  const extracted: ExtractedProps = {
    schema: EXTRACTOR_SCHEMA,
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
