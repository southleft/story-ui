/**
 * Prop extraction — read a design system's real component APIs from its types.
 *
 * The catalog gives the model component NAMES. Everything else — that `NavLink`
 * has `active`, that `TextInput` takes `leftSection`, that a variant is one of
 * three specific strings — it has to infer. For a well-known library it infers
 * correctly often enough to look fine. For a private design system, which is the
 * case this tool exists to serve, it is guessing.
 *
 * Scope is deliberately syntactic — but syntactic reaches further than this
 * comment used to claim. It said resolving `TextInputProps extends BoxProps,
 * __BaseInputProps, StylesApiProps<TextInputFactory>` needed a TypeChecker and
 * full module resolution, and settled for 82% on Mantine.
 *
 * It does not. Every type the package declares is already collected, so
 * following an `extends` clause is a LOOKUP, not type resolution. Adding that
 * took Mantine from 77% to 94% and Fluent from 78% to 82%, with no TypeChecker
 * and no module resolution. It also unlocked the shape Chakra v3 uses
 * throughout, where a component's own props interface is empty and the real
 * props sit three levels down behind a generic argument.
 *
 * What remains genuinely out of scope is types the package does NOT declare:
 * React's own, and anything behind a deep style-system generic. Those
 * contribute nothing and should — enumerating every CSS property as a prop
 * would spend the whole prompt budget to say what the model already knows.
 */

import ts from 'typescript';
import { readAngularDeclarations } from './angularInputs.js';
import { readVueDeclarations } from './vueProps.js';
import { resolvePropsWithChecker } from './checkerProps.js';

/** Above this many resolved props, a component is one that spreads a styling surface. */
const SUBSTANTIAL_TOTAL = 50;

/** Does this package declare React — the framework whose components a JSX probe can resolve? */
function declaresReact(root: string): boolean {
  try {
    const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf-8'));
    return ['peerDependencies', 'dependencies', 'devDependencies']
      .some(field => pkg[field] && Object.keys(pkg[field]).some((d: string) => d === 'react' || d === '@types/react'));
  } catch {
    return false;
  }
}

/** Angular's compiler-emitted declaration types; see knowledge/angularInputs.ts. */
const ANGULAR_DECLARATION = /ɵɵ(Component|Directive)Declaration/;
import fs from 'fs';
import path from 'path';
import { contentFingerprint, knowledgeCacheFile, pruneStaleKnowledge } from './cacheKey.js';
import { packageNameOf } from './packageLocator.js';
import { createRequire } from 'module';
import { logger } from '../logger.js';
import { findLocalSourceFiles, readLocalSourceTree } from './localComponentFacts.js';
import { loadUserConfig } from '../configLoader.js';

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
  /**
   * The string values this prop accepts, when the type declares them.
   *
   * Powers a direct-manipulation control: a picker offering exactly what the
   * component takes cannot produce an invalid value, which is the whole
   * advantage of editing a prop instead of asking a model to.
   */
  options?: string[];
  /**
   * True when the declared type ALSO admits values beyond `options`.
   *
   * Mantine writes `size?: MantineSize | (string & {})` — the five sizes are
   * real, enumerated by the library's own alias, and any other string is legal
   * too. `options` are then suggestions rather than a closed set, and a control
   * built from them must accept free input as well. Absent means closed.
   */
  optionsOpen?: boolean;
}

export interface ComponentFacts {
  /** Component name, derived from `<Name>Props`. */
  name: string;
  props: PropFact[];
  /** Values of `<Name>Variant`, when the library declares one. */
  variants?: string[];
  /** Prose from the component's own declaration, when it says anything. */
  doc?: string;
  /**
   * The compiler resolved this component and it declares nothing beyond the
   * styling surface its library gives every component.
   *
   * Recorded because an empty prop list would otherwise mean two opposite
   * things — "we could not read this component" and "this component adds
   * nothing to read" — and a catalog cannot tell a reader which. Chakra's Box,
   * Text and Span are the second kind: they take that library's style props
   * and nothing else, which is a fact worth stating rather than a gap.
   */
  sharedBaseOnly?: boolean;
  /**
   * This export is a namespace whose members are the components.
   *
   * A modern library ships compound components as `Accordion.Root`,
   * `Accordion.Item`. Discovery admits the namespace itself as a component,
   * and a catalog that lists it with no props invites `<Accordion>` — which
   * the library cannot render. Naming the members turns a false component into
   * a true instruction.
   */
  namespaceMembers?: string[];
  /**
   * The compiler resolved this export and it cannot be written as an element:
   * no call signature, no construct signature. A version constant, a token
   * map. Recorded so a catalog can stop offering it as a component — the model
   * cannot know from a bare name that `<CLIENT_VERSION />` is impossible.
   */
  notAComponent?: boolean;
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
  /**
   * Packages this one re-exports from, when it is a barrel over siblings.
   *
   * A property of THIS package's version, so it caches safely under this key.
   * The merged union of their props deliberately does not.
   */
  reexportedFrom?: string[];
  /**
   * Where the facts came from: an installed package's declarations, or the
   * project's own source read with the AST. Present so a caller can tell the
   * two apart in a log; absent on records written before it existed.
   */
  source?: 'package' | 'local';
  /** The directory read, for a `local` record. */
  root?: string;
}

/** Long unions and generics hurt more than they help inside a prompt. */
const MAX_TYPE_TEXT = 80;

/**
 * Does this type admit any string? `(string & {})` — the widen-proof idiom —
 * or a bare `string` arm makes the literal options a hint, not a closed set.
 * MUI's Typography `color` is `OverridableStringUnion<'primary' | … |
 * (string & {}), Overrides>`; judging `color="text.secondary"` against the
 * literals rejected correct code on every MUI prompt.
 */
export function typeAdmitsAnyString(node: ts.TypeNode | undefined): boolean {
  if (!node) return false;
  let text = '';
  try { text = node.getText(); } catch { text = ''; }
  return /\bstring\s*&\s*\{\s*\}|(^|[|<(,\s])string\s*($|[|>),\s])/.test(text);
}

export function shortType(node: ts.TypeNode | undefined, source: ts.SourceFile): string | undefined {
  if (!node) return undefined;
  const text = node.getText(source).replace(/\s+/g, ' ').trim();
  return text.length <= MAX_TYPE_TEXT ? text : undefined;
}

/** The JSDoc block immediately preceding a node, comment syntax stripped. */
export function rawDocBlock(node: ts.Node, source: ts.SourceFile): string | undefined {
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

/** String literals inside `readonly ["a","b"]` or `["a","b"] as const`. */
function stringLiteralsIn(node: ts.Node | undefined, source: ts.SourceFile): string[] {
  if (!node) return [];
  const out: string[] = [];
  const visit = (n: ts.Node) => {
    if (ts.isLiteralTypeNode(n) && ts.isStringLiteral(n.literal)) out.push(n.literal.text);
    else if (ts.isStringLiteral(n) && !ts.isImportDeclaration(n.parent)) out.push(n.text);
    ts.forEachChild(n, visit);
  };
  visit(node);
  return out;
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
export function prosePart(cleaned: string): string {
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
export function readDoc(node: ts.Node, source: ts.SourceFile): Pick<PropFact, 'doc' | 'defaultValue' | 'deprecated'> {
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

/**
 * A component whose declaration names a props type we have not resolved yet.
 *
 * `<Name>Props` is a convention, not a rule, and treating it as one is the
 * same inference this extractor exists to remove. Atlassian's Avatar takes
 * `AvatarPropTypes`; its Tag takes `SimpleTagProps`; its Button takes a
 * `ButtonProps` declared in a different file. All three reported no props at
 * all, while the declaration beside them stated the answer:
 *
 *   declare const Avatar: React.ForwardRefExoticComponent<
 *     React.PropsWithoutRef<AvatarPropTypes> & React.RefAttributes<HTMLElement>>
 *
 * Recorded during the per-file pass and resolved once every file has been
 * read, because the type is often declared in a file other than the component.
 */
interface PropsTypeLink {
  component: string;
  propsType: string;
}

/** Type names that are React plumbing, never a component's props. */
const REACT_TYPE_NOISE = /^(React\.)?(ForwardRefExoticComponent|MemoExoticComponent|PropsWithoutRef|PropsWithChildren|RefAttributes|FunctionComponent|FC|ComponentType|ElementType|ReactElement|JSX\.Element|Omit|Pick|Partial|Readonly)$/;

/** Props-type names mentioned by a component's declared type, best first. */
function propsTypeCandidates(typeNode: ts.Node, source: ts.SourceFile): string[] {
  const found: string[] = [];
  const visit = (n: ts.Node) => {
    if (ts.isTypeReferenceNode(n)) {
      const name = n.typeName.getText(source);
      // `AvatarPropTypes` is singular-Prop plus Types, so a pattern anchored on
      // "Props" missed the very declaration this exists to read.
      if (!REACT_TYPE_NOISE.test(name) && /(Props|PropTypes|PropsTypes)$/.test(name)) found.push(name);
    }
    ts.forEachChild(n, visit);
  };
  visit(typeNode);
  return found;
}

/**
 * Cross-file literal knowledge: pass 1 records what each file DECLARES, pass 2
 * follows a prop's type name into it.
 *
 * The per-file `literalOptions` resolver can only follow names declared in the
 * SAME file, so Mantine's Button — `size?: MantineSize | ...` with MantineSize
 * five literals away in theme.types.d.ts — reported no options at all, and the
 * editable-props panel dropped the very props someone opens it for. Text is
 * stored rather than AST nodes so the registry does not pin every source file
 * in memory; each alias is a short line, re-parsed only if a prop points at it.
 */
interface TypeTextRegistry {
  /** Type alias name → its right-hand side, as written. First declaration wins. */
  aliases: Map<string, string>;
  /** `const X = [...] as const` values, across the whole package. */
  tuples: Map<string, string[]>;
}

/** Longer than any real variant/size alias; guards against pathological types. */
const MAX_REGISTRY_ALIAS_TEXT = 600;

/** Record a file's type aliases and const tuples into the shared registry. */
function harvestRegistry(source: ts.SourceFile, registry: TypeTextRegistry): void {
  ts.forEachChild(source, node => {
    if (ts.isTypeAliasDeclaration(node)) {
      if (!registry.aliases.has(node.name.text)) {
        const text = node.type.getText(source).replace(/\s+/g, ' ').trim();
        if (text.length <= MAX_REGISTRY_ALIAS_TEXT) registry.aliases.set(node.name.text, text);
      }
    } else if (ts.isVariableStatement(node)) {
      for (const decl of node.declarationList.declarations) {
        if (!ts.isIdentifier(decl.name) || registry.tuples.has(decl.name.text)) continue;
        const literals = stringLiteralsIn(decl.type ?? decl.initializer, source);
        if (literals.length) registry.tuples.set(decl.name.text, literals);
      }
    }
  });
}

function collectFromFile(
  filePath: string,
  out: Record<string, ComponentFacts>,
  inheritedOnly: string[],
  /** Every named type with members, so a link can be resolved across files. */
  allTypes: Record<string, PropFact[]> = {},
  links: PropsTypeLink[] = [],
  registry?: TypeTextRegistry,
): void {
  let text: string;
  try {
    text = fs.readFileSync(filePath, 'utf-8');
  } catch {
    return;
  }
  /**
   * TypeScript SOURCE carries declarations too.
   *
   * A workspace package consumed without a build step points `types` at
   * `src/index.ts`; it has no `.d.ts` and no `.js` anywhere. Treating only
   * `.d.ts` as declaration-bearing meant such a package yielded zero props,
   * zero descriptions, zero defaults and zero deprecations — while its source
   * stated all of them. Measured on a source-only fixture: 0 -> 15 props,
   * 4 prop docs, 3 component descriptions, 1 deprecation, 1 default.
   */
  const isDeclaration = /\.(d\.ts|d\.mts|d\.cts|ts|tsx|mts)$/.test(filePath) && !/\.stories\.[jt]sx?$/.test(filePath);

  // Cheap pre-filter — most files in a published package describe no props at
  // all, and parsing a large package's entire JS output would dominate the
  // runtime of a step that is meant to be incidental.
  if (isDeclaration) {
    // `Prop`, not `Props`: a type named `AvatarPropTypes` contains no "Props"
    // substring, so the file declaring it was skipped entirely and the
    // component that pointed at it resolved to nothing.
    /**
     * Angular says neither word.
     *
     * Its declarations are named `ɵɵComponentDeclaration` and the inputs live
     * in that type's arguments, so a file declaring a whole component library
     * can contain no "Prop" and no "Variant" anywhere. Measured: this filter
     * skipped 98 of Angular Material's 102 declaration files, which is why
     * that library reported props for 10 of 309 components after its inputs
     * became readable — the reader was never reached.
     */
    if (!text.includes('Prop') && !text.includes('Variant') && !ANGULAR_DECLARATION.test(text)) {
      // A theme file often mentions neither word, yet holds exactly the
      // aliases other files' props point into (`type ThemeSize = 'xs' | …`).
      // Skipping it whole silently emptied the registry, and cross-file
      // option resolution reported "no values declared" — the pre-filter is a
      // props optimisation, not a statement that the file declares nothing.
      if (registry && (text.includes('type ') || text.includes('const '))) {
        harvestRegistry(ts.createSourceFile(filePath, text, ts.ScriptTarget.Latest, true), registry);
      }
      return;
    }
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
      const opts = literalOptions(member.type);
      const open = typeAdmitsAnyString(member.type);
      found.push({
        name,
        type: shortType(member.type, source),
        required: !member.questionToken,
        ...readDoc(member, source),
        // Deduped and capped: a handful of variants is a control, forty is a
        // list nobody scrolls.
        ...(opts.length > 1 && opts.length <= 24 ? { options: [...new Set(opts)], ...(open ? { optionsOpen: true } : {}) } : {}),
      });
    }
    return found;
  };

  /**
   * Every named type in this file, so a props alias can be followed one hop.
   *
   * Atlassian declares the actual members under a neutral name and exports the
   * component's type as an application of it:
   *
   *   type OwnProps = { isChecked?: boolean; ... }
   *   export type CheckboxProps = Combine<Omit<InputHTMLAttributes, …>, OwnProps>
   *
   * Reading only literal members found nothing for `CheckboxProps` and filed
   * the real props under the component name "Own" — which matches nothing, so
   * Checkbox, Tag and Avatar reported no props at all. This is LOCAL
   * indirection: the answer is in the same file, and following it needs no
   * TypeChecker and no module resolution, which is the boundary this extractor
   * deliberately does not cross.
   */
  const namedTypes = new Map<string, ts.Node>();
  /**
   * `const X = [...] as const` declarations, for the `(typeof X)[number]` idiom.
   *
   * Carbon writes its variant sets this way:
   *   export declare const ButtonKinds: readonly ["primary", "secondary", …];
   *   export type ButtonKind = (typeof ButtonKinds)[number];
   * so the legal values are in a const, not in the type. Without following
   * that hop, `kind` — the single most useful prop on a Button — has no
   * knowable values at all.
   */
  const constTuples = new Map<string, string[]>();
  if (registry) harvestRegistry(source, registry);
  ts.forEachChild(source, node => {
    if (ts.isTypeAliasDeclaration(node)) namedTypes.set(node.name.text, node.type);
    else if (ts.isInterfaceDeclaration(node)) namedTypes.set(node.name.text, node);
    else if (ts.isVariableStatement(node)) {
      for (const decl of node.declarationList.declarations) {
        if (!ts.isIdentifier(decl.name)) continue;
        const literals = stringLiteralsIn(decl.type ?? decl.initializer, source);
        if (literals.length) constTuples.set(decl.name.text, literals);
      }
    }
  });

  /**
   * The string values a prop's type admits, following local references.
   *
   * Depth-limited and local-only, the same boundary the rest of this file
   * keeps. A conditional type contributes BOTH branches: `hasIconOnly extends
   * true ? IconButtonKind : ButtonKind` genuinely accepts either set depending
   * on another prop, and offering the union is honest where picking a branch
   * would silently hide half the options.
   */
  const literalOptions = (node: ts.Node | undefined, depth = 0, seen = new Set<string>()): string[] => {
    if (!node || depth > 4) return [];

    if (ts.isUnionTypeNode(node)) {
      return node.types.flatMap(t => literalOptions(t, depth + 1, seen));
    }
    if (ts.isLiteralTypeNode(node) && ts.isStringLiteral(node.literal)) {
      return [node.literal.text];
    }
    if (ts.isConditionalTypeNode(node)) {
      return [
        ...literalOptions(node.trueType, depth + 1, seen),
        ...literalOptions(node.falseType, depth + 1, seen),
      ];
    }
    if (ts.isParenthesizedTypeNode(node)) return literalOptions(node.type, depth + 1, seen);

    // `(typeof ButtonKinds)[number]`
    if (ts.isIndexedAccessTypeNode(node)) {
      const objectType = node.objectType;
      if (ts.isParenthesizedTypeNode(objectType) || ts.isTypeQueryNode(objectType)) {
        const query = ts.isParenthesizedTypeNode(objectType) ? objectType.type : objectType;
        if (ts.isTypeQueryNode(query)) {
          const name = query.exprName.getText(source);
          return constTuples.get(name) ?? [];
        }
      }
      return literalOptions(objectType, depth + 1, seen);
    }

    if (ts.isTypeReferenceNode(node)) {
      const name = node.typeName.getText(source);
      /**
       * MUI: `variant?: OverridableStringUnion<'text' | 'outlined' | 'contained', ButtonPropsVariantOverrides>`.
       * The literals are the first type argument; the second is a module-
       * augmentation hook that is empty in every project that has not
       * augmented it. Dropping the whole reference left Button with one
       * editable prop (loadingPosition) and no variant/color/size.
       */
      if (/^(OverridableStringUnion|OverridableComponentProps|LiteralUnion)$/.test(name) && node.typeArguments?.length) {
        return literalOptions(node.typeArguments[0], depth + 1, seen);
      }
      if (seen.has(name)) return [];
      seen.add(name);
      const target = namedTypes.get(name);
      if (target) return literalOptions(target, depth + 1, seen);
      // A type alias may point straight at a const tuple's name.
      return constTuples.get(name) ?? [];
    }
    return [];
  };

  /**
   * Members reachable from a type node, following local references.
   *
   * Depth-limited because these chains are short in practice and a cycle
   * (`type A = B & {…}; type B = A`) would otherwise not terminate.
   */
  const membersOf = (typeNode: ts.Node, depth = 0, seen = new Set<string>()): PropFact[] => {
    if (depth > 4) return [];
    if (ts.isTypeLiteralNode(typeNode)) return readMembers(typeNode.members);
    if (ts.isInterfaceDeclaration(typeNode)) {
      /**
       * An interface's props may be entirely INHERITED.
       *
       * Reading only `typeNode.members` returned nothing for the shape Chakra
       * v3 uses throughout:
       *
       *   interface ButtonProps extends HTMLChakraProps<"button", ButtonBaseProps> {}
       *   interface ButtonBaseProps extends RecipeProps<"button">, UnstyledProp, ButtonLoadingProps {}
       *   interface ButtonLoadingProps { loading?: …; loadingText?: …; spinnerPlacement?: … }
       *
       * Every component's own interface is empty and the real props — with
       * their JSDoc and @default values — are three levels down. Measured:
       * 822 components discovered, props known for 76 of them.
       *
       * This follows heritage through types the package ALREADY declares, which
       * is a lookup rather than type resolution: no TypeChecker, no module
       * resolution, and the same depth and cycle guards as every other path
       * here. Unresolvable externals (React's own types) simply contribute
       * nothing, exactly as before.
       */
      const own = readMembers(typeNode.members);
      const inherited: PropFact[] = [];
      for (const clause of typeNode.heritageClauses || []) {
        for (const expr of clause.types) {
          const name = expr.expression.getText(source);
          if (!seen.has(name)) {
            seen.add(name);
            const target = namedTypes.get(name);
            if (target) inherited.push(...membersOf(target, depth + 1, seen));
          }
          // `HTMLChakraProps<"button", ButtonBaseProps>` — the useful half is
          // the ARGUMENT, which the package does declare.
          for (const arg of expr.typeArguments || []) inherited.push(...membersOf(arg, depth + 1, seen));
        }
      }
      // Own members win: a subtype that narrows a prop states the better answer.
      return inherited.length ? mergeProps(own, inherited) : own;
    }

    const out: PropFact[] = [];
    if (ts.isIntersectionTypeNode(typeNode) || ts.isUnionTypeNode(typeNode)) {
      for (const part of typeNode.types) out.push(...membersOf(part, depth + 1, seen));
      return out;
    }
    // `Combine<A, B>` / `Omit<A, 'x'>` — the members live in the arguments.
    if (ts.isTypeReferenceNode(typeNode)) {
      const name = typeNode.typeName.getText(source);
      if (!seen.has(name)) {
        seen.add(name);
        const target = namedTypes.get(name);
        if (target) out.push(...membersOf(target, depth + 1, seen));
      }
      for (const arg of typeNode.typeArguments || []) out.push(...membersOf(arg, depth + 1, seen));
    }
    return out;
  };

  // Members of every named type in the file, under its own name, so a
  // declaration elsewhere in the package can point at it. Keyed by the type's
  // real name — no convention applied, and no component inferred from it.
  for (const [typeName, typeNode] of namedTypes) {
    if (allTypes[typeName]) continue;
    const members = membersOf(typeNode);
    if (members.length > 0) allTypes[typeName] = members;
  }

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

      // Literal members, plus any reachable by following local type names.
      const props = mergeProps([], membersOf(node.type));
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
        const opts = literalOptions(member.type);
        props.push({
          name,
          type: shortType(member.type, source),
          required: !member.questionToken,
          ...readDoc(member, source),
          ...(opts.length > 1 && opts.length <= 24 ? { options: [...new Set(opts)], ...(typeAdmitsAnyString(member.type) ? { optionsOpen: true } : {}) } : {}),
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
          // What does this component say its props are? Recorded even when a
          // `<Name>Props` also exists — resolution only fills a gap.
          if (decl.type) {
            for (const candidate of propsTypeCandidates(decl.type, source)) {
              links.push({ component: decl.name.text, propsType: candidate });
            }
          }
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

  /**
   * Angular declares its inputs where nothing above looks.
   *
   * The resolution bench measured Angular Material at 0 of 309 components with
   * known props, against 78-100% everywhere else — the catalog offered the
   * model 309 bare names, which is the condition under which a composition
   * invents attributes. The facts were never missing: Angular's compiler
   * writes each input, its template name and whether it is required into the
   * type of a static member on the class. This reads that, and takes each
   * input's type and prose from the class member behind it.
   *
   * It costs one AST walk on every file and yields nothing for React, Vue,
   * Svelte or Lit, which declare no such member.
   */
  /**
   * Vue resolves its props into the type it generates, and nothing above
   * looked there either: the Vue environment knew 39 of 174 components' props.
   * Same shape as the Angular reader — the framework's own contract, read for
   * any library built on it. See knowledge/vueProps.ts.
   */
  for (const component of readVueDeclarations(source)) {
    const props: PropFact[] = component.props.map(p => ({
      name: p.name,
      required: false,
      ...(p.type ? { type: p.type } : {}),
      ...(p.options ? { options: p.options } : {}),
    }));
    const prior = out[component.name];
    out[component.name] = prior
      ? { ...prior, props: mergeProps(prior.props, props) }
      : { name: component.name, props };
  }

  for (const component of readAngularDeclarations(source)) {
    if (!component.inputs.length) continue;
    const props: PropFact[] = component.inputs.map(input => ({
      name: input.output ? `(${input.name})` : input.name,
      required: input.required,
      ...(input.type ? { type: input.type } : {}),
      ...(input.doc ? { doc: input.doc } : {}),
    }));
    const prior = out[component.name];
    out[component.name] = prior
      ? { ...prior, props: mergeProps(prior.props, props) }
      : { name: component.name, props };
  }
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
export function mergeProps(a: PropFact[], b: PropFact[]): PropFact[] {
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
      options: prior.options ?? p.options,
      // Openness belongs to whichever reading supplied the options.
      optionsOpen: prior.options ? prior.optionsOpen : p.options ? p.optionsOpen : (prior.optionsOpen ?? p.optionsOpen),
    });
  }
  return [...byName.values()];
}

/**
 * Resolve a prop's declared type TEXT to the string values it admits, following
 * names into the package-wide registry.
 *
 * This is the cross-file completion of `literalOptions`, still a lookup and
 * never type resolution — the same boundary the rest of this file keeps. It
 * exists because a design system's variant/size/color values almost always
 * live behind a named alias in a theme file, not inline where the prop is
 * declared, and those are exactly the props a direct-manipulation panel is
 * opened for.
 *
 * Openness is tracked honestly: any arm we cannot enumerate — `(string & {})`,
 * a bare `number`, an `infer`red branch, an alias the package never declares —
 * marks the set OPEN, so a control offers the enumerated values as suggestions
 * rather than claiming the library rejects everything else.
 */
/**
 * Structural depth, not hop count: every union, parenthesis and conditional
 * spends one level, so Mantine's `radius` — `MantineRadius` → `_MantineRadius
 * | number` → a parenthesised conditional → `MantineSize` → the literals — is
 * already seven levels deep. A budget of 6 returned NOTHING for it while
 * looking exactly like "no values declared". Cycles are guarded by name, so
 * this bound only needs to beat real nesting, with room.
 */
const MAX_OPTION_TEXT_DEPTH = 16;

function parseTypeText(text: string): { node: ts.TypeNode; source: ts.SourceFile } | null {
  const source = ts.createSourceFile('t.ts', `type __T = ${text};`, ts.ScriptTarget.Latest, true);
  const stmt = source.statements[0];
  if (!stmt || !ts.isTypeAliasDeclaration(stmt)) return null;
  return { node: stmt.type, source };
}

function resolveOptionsFromTypeText(
  typeText: string,
  registry: TypeTextRegistry,
): { options: string[]; open: boolean } | null {
  const parsed = parseTypeText(typeText);
  if (!parsed) return null;

  interface Acc { values: string[]; open: boolean; }

  const walk = (
    node: ts.Node,
    source: ts.SourceFile,
    mode: 'values' | 'keys',
    depth: number,
    seen: Set<string>,
    acc: Acc,
  ): void => {
    if (depth > MAX_OPTION_TEXT_DEPTH) { acc.open = true; return; }

    if (ts.isParenthesizedTypeNode(node)) return walk(node.type, source, mode, depth + 1, seen, acc);
    if (ts.isUnionTypeNode(node)) {
      for (const t of node.types) walk(t, source, mode, depth + 1, seen, acc);
      return;
    }
    // A conditional genuinely admits either branch depending on facts we do
    // not track (theme overrides, another prop); both are honest.
    if (ts.isConditionalTypeNode(node)) {
      walk(node.trueType, source, mode, depth + 1, seen, acc);
      walk(node.falseType, source, mode, depth + 1, seen, acc);
      return;
    }

    if (mode === 'keys') {
      // keyof Record<K, V> — the keys ARE K's values.
      if (ts.isTypeReferenceNode(node)) {
        const name = node.typeName.getText(source);
        if (name === 'Record' && node.typeArguments?.length) {
          return walk(node.typeArguments[0], source, 'values', depth + 1, seen, acc);
        }
        if (name === 'Partial' && node.typeArguments?.length) {
          return walk(node.typeArguments[0], source, 'keys', depth + 1, seen, acc);
        }
        if (!seen.has(name)) {
          const aliasText = registry.aliases.get(name);
          if (aliasText) {
            const sub = parseTypeText(aliasText);
            // Path-local guard: a cycle must stop, but a sibling union arm
            // resolving the same alias again must not be blocked by it.
            if (sub) return walk(sub.node, sub.source, 'keys', depth + 1, new Set(seen).add(name), acc);
          }
        }
        acc.open = true;
        return;
      }
      if (ts.isTypeLiteralNode(node)) {
        for (const m of node.members) {
          if (ts.isPropertySignature(m) && m.name) acc.values.push(m.name.getText(source).replace(/^['"]|['"]$/g, ''));
        }
        return;
      }
      acc.open = true;
      return;
    }

    // values mode
    if (ts.isLiteralTypeNode(node)) {
      if (ts.isStringLiteral(node.literal)) acc.values.push(node.literal.text);
      // Numeric and other literals: not offerable as string options, but a
      // finite literal is not an OPEN set either — contribute nothing.
      return;
    }
    if (node.kind === ts.SyntaxKind.StringKeyword || node.kind === ts.SyntaxKind.NumberKeyword) {
      acc.open = true;
      return;
    }
    if (node.kind === ts.SyntaxKind.UndefinedKeyword || node.kind === ts.SyntaxKind.NullKeyword
      || node.kind === ts.SyntaxKind.NeverKeyword) {
      return;
    }
    // `(string & {})` — the widen-proof idiom. The intersection contributes no
    // literal; it says arbitrary strings are legal.
    if (ts.isIntersectionTypeNode(node)) {
      if (node.types.some(t => t.kind === ts.SyntaxKind.StringKeyword || t.kind === ts.SyntaxKind.NumberKeyword)) {
        acc.open = true;
      }
      return;
    }
    // `compact-${MantineSize}` — expandable when the single placeholder
    // resolves to a finite set; otherwise it names an open family.
    if (ts.isTemplateLiteralTypeNode(node)) {
      if (node.templateSpans.length === 1) {
        const span = node.templateSpans[0];
        const sub: Acc = { values: [], open: false };
        walk(span.type, source, 'values', depth + 1, seen, sub);
        if (sub.values.length && !sub.open) {
          for (const v of sub.values) acc.values.push(node.head.text + v + span.literal.text);
          return;
        }
      }
      acc.open = true;
      return;
    }
    if (ts.isTypeOperatorNode(node) && node.operator === ts.SyntaxKind.KeyOfKeyword) {
      return walk(node.type, source, 'keys', depth + 1, seen, acc);
    }
    if (ts.isTypeQueryNode(node)) {
      const tuple = registry.tuples.get(node.exprName.getText(source));
      if (tuple) acc.values.push(...tuple);
      else acc.open = true;
      return;
    }
    // `(typeof ButtonKinds)[number]`
    if (ts.isIndexedAccessTypeNode(node)) {
      return walk(node.objectType, source, 'values', depth + 1, seen, acc);
    }
    if (ts.isInferTypeNode(node)) { acc.open = true; return; }
    if (ts.isTypeReferenceNode(node)) {
      const name = node.typeName.getText(source);
      if (seen.has(name)) return; // cycle along this path: contributes nothing new
      const aliasText = registry.aliases.get(name);
      if (aliasText) {
        const sub = parseTypeText(aliasText);
        // Path-local guard — see the keys-mode note above.
        if (sub) return walk(sub.node, sub.source, 'values', depth + 1, new Set(seen).add(name), acc);
      }
      const tuple = registry.tuples.get(name);
      if (tuple) { acc.values.push(...tuple); return; }
      // Declared elsewhere or not at all — we cannot claim the set is closed.
      acc.open = true;
      return;
    }
    // Anything else (functions, object shapes, mapped types): unknowable here.
    acc.open = true;
  };

  const acc: Acc = { values: [], open: false };
  walk(parsed.node, parsed.source, 'values', 0, new Set(), acc);

  const unique = [...new Set(acc.values)];
  if (unique.length < 2 || unique.length > 24) return null;
  return { options: unique, open: acc.open };
}

const isUnderNodeModules = (p: string) => /(^|[\\/])node_modules([\\/]|$)/.test(p);
const dirExists = (p: string) => { try { return fs.statSync(p).isDirectory(); } catch { return false; } };

/**
 * The directory a relative importPath is written against.
 *
 * A relative specifier in `story-ui.config.js` (`importPath: '../../components'`)
 * is relative to the GENERATED STORIES directory — that is where the import
 * line ends up — and the config states where that directory is. Resolving it
 * against the project root would be a guess at a different question.
 */
function projectConfig(projectRoot: string): { generatedStoriesPath?: string; componentsPath?: string } | null {
  for (const name of ['story-ui.config.js', 'story-ui.config.cjs']) {
    const file = path.join(projectRoot, name);
    if (!fs.existsSync(file)) continue;
    try {
      const loaded = createRequire(file)(file);
      const cfg = loaded?.default ?? loaded;
      if (cfg && typeof cfg === 'object') return { generatedStoriesPath: cfg.generatedStoriesPath, componentsPath: cfg.componentsPath };
    } catch { /* an ESM project's CommonJS config cannot be require()d */ }
  }
  // The loader knows how to read that shape, for the directory it runs in.
  if (path.resolve(projectRoot) === process.cwd()) {
    try {
      const cfg = loadUserConfig();
      return { generatedStoriesPath: cfg.generatedStoriesPath, componentsPath: cfg.componentsPath };
    } catch { /* no config */ }
  }
  return null;
}

function generatedStoriesDir(projectRoot: string): string | null {
  const declared = projectConfig(projectRoot)?.generatedStoriesPath;
  return typeof declared === 'string' && declared ? path.resolve(projectRoot, declared) : null;
}

/**
 * Where the config says the components are, when the importPath names
 * nothing readable — the `your-component-library` placeholder init writes
 * for a project it could not classify, or a package that is not installed.
 * `componentsPath` is the project's own statement, and the same directory
 * discovery already scans.
 */
function configuredComponentsRoot(projectRoot: string): string | null {
  const declared = projectConfig(projectRoot)?.componentsPath;
  if (typeof declared !== 'string' || !declared) return null;
  const dir = path.resolve(projectRoot, declared);
  return dirExists(dir) && !isUnderNodeModules(dir) ? dir : null;
}

/**
 * A specifier that names LOCAL SOURCE rather than a package.
 *
 * An absolute directory, or a relative one, given as the "package" used to
 * fall into the name-splitting below: `'/Users/…/src/components'.split('/')[0]`
 * is the empty string, `path.join(node_modules, '')` is node_modules itself,
 * and the walk read all of it — 609 "components" including Storybook's own
 * template Button, and a 175KB cache written for the privilege. A path is
 * never a package name; it is either a directory we can open or nothing.
 */
function localRoot(projectRoot: string, importPath: string): string | null {
  if (!path.isAbsolute(importPath) && !importPath.startsWith('.')) return null;
  const candidates: string[] = [];
  if (path.isAbsolute(importPath)) {
    candidates.push(importPath);
  } else {
    const generated = generatedStoriesDir(projectRoot);
    if (generated) candidates.push(path.resolve(generated, importPath));
    candidates.push(path.resolve(projectRoot, importPath));
  }
  for (const c of candidates) {
    if (dirExists(c) && !isUnderNodeModules(c)) return c;
  }
  return null;
}

/**
 * The project IS the package: `package.json` names itself what the config
 * imports from. A design system repository configures `importPath:
 * '@sail-shelf/ui'` — its own published name — and nothing of that name is in
 * node_modules because it is the thing being built. The source is in `src`.
 */
function selfPackageRoot(projectRoot: string, pkgName: string): string | null {
  try {
    const pkg = JSON.parse(fs.readFileSync(path.join(projectRoot, 'package.json'), 'utf-8'));
    if (pkg?.name !== pkgName) return null;
  } catch {
    return null;
  }
  const src = path.join(projectRoot, 'src');
  return dirExists(src) ? src : projectRoot;
}

interface ResolvedRoot {
  dir: string;
  /** Source we read with the AST, as opposed to an installed package's declarations. */
  local: boolean;
}

function packageRoot(projectRoot: string, importPath: string): ResolvedRoot | null {
  const local = localRoot(projectRoot, importPath);
  if (local) return { dir: local, local: true };
  // A path that is not on disk is nothing — never a reason to read node_modules.
  if (path.isAbsolute(importPath) || importPath.startsWith('.')) return null;

  const pkgName = packageNameOf(importPath);
  if (!pkgName) return null;
  try {
    const req = createRequire(path.join(projectRoot, 'package.json'));
    let dir = path.dirname(req.resolve(pkgName));
    for (let i = 0; i < 8; i++) {
      if (fs.existsSync(path.join(dir, 'package.json'))) {
        const pkg = JSON.parse(fs.readFileSync(path.join(dir, 'package.json'), 'utf-8'));
        if (pkg?.name === pkgName) return { dir, local: false };
      }
      const parent = path.dirname(dir);
      if (parent === dir) break;
      dir = parent;
    }
  } catch { /* fall through */ }
  const guess = path.join(projectRoot, 'node_modules', ...pkgName.split('/'));
  if (fs.existsSync(guess)) return { dir: guess, local: false };
  const self = selfPackageRoot(projectRoot, pkgName);
  if (self) return { dir: self, local: true };
  const configured = configuredComponentsRoot(projectRoot);
  return configured ? { dir: configured, local: true } : null;
}

/**
 * The declarations file a package names as its entry.
 *
 * `exports['.']` nests the answer behind conditions (MUI:
 * `exports['.'].import.types`), so it is walked rather than indexed. Must not
 * throw when there is no package.json at all — Atlassian configures a bare
 * SCOPE, and `node_modules/@atlaskit/package.json` does not exist.
 */
function typesEntryFile(pkgRoot: string): string | null {
  let pkg: any;
  try { pkg = JSON.parse(fs.readFileSync(path.join(pkgRoot, 'package.json'), 'utf-8')); } catch { return null; }

  const candidates: string[] = [];
  const walk = (node: unknown, depth = 0) => {
    if (depth > 5 || node == null) return;
    if (typeof node === 'string') { if (/\.d\.[cm]?ts$/.test(node)) candidates.push(node); return; }
    if (Array.isArray(node)) return node.forEach(n => walk(n, depth + 1));
    if (typeof node === 'object') {
      const obj = node as Record<string, unknown>;
      // `types` must win over `default` within the same condition block.
      if (typeof obj.types === 'string') candidates.push(obj.types);
      for (const [k, v] of Object.entries(obj)) if (k !== 'types') walk(v, depth + 1);
    }
  };
  walk(pkg?.exports?.['.']);
  if (typeof pkg?.types === 'string') candidates.push(pkg.types);
  if (typeof pkg?.typings === 'string') candidates.push(pkg.typings);

  for (const rel of candidates) {
    const full = path.join(pkgRoot, rel);
    if (fs.existsSync(full)) return full;
  }
  return null;
}

/**
 * Packages a barrel re-exports its API from.
 *
 * Fluent UI v9's `@fluentui/react-components` is 6,083 lines of
 * `import { ButtonProps } from '@fluentui/react-button'` followed by
 * `export { ButtonProps }` — 2,027 of each, and ZERO declarations. The props
 * are real and this extractor reads them perfectly; they simply live in 58
 * sibling packages. The only missing fact is which packages, and the barrel
 * states it outright.
 *
 * RELATIVE specifiers are dropped. That single rule is what keeps this change
 * inert for Astryx and Carbon, whose barrels re-export from directories INSIDE
 * the package (`export * from './Button'`) that the existing walk already
 * covers — measured byte-identical on both.
 *
 * Type-only re-exports are kept: `export type { ButtonProps } from '...'` is
 * precisely the fact wanted.
 */
function reexportPackages(entryFile: string | null): string[] {
  if (!entryFile) return [];
  let text: string;
  try { text = fs.readFileSync(entryFile, 'utf-8'); } catch { return []; }

  const source = ts.createSourceFile(entryFile, text, ts.ScriptTarget.Latest, true);
  const localToSpecifier = new Map<string, string>();
  const specifiers = new Set<string>();

  const packageOf = (spec: string): string | null => {
    if (!spec || spec.startsWith('.')) return null;   // relative: already walked
    return packageNameOf(spec);
  };

  ts.forEachChild(source, node => {
    // `import { X } from 'pkg'` — remembered, in case a bare `export { X }` follows.
    if (ts.isImportDeclaration(node) && ts.isStringLiteral(node.moduleSpecifier)) {
      const spec = node.moduleSpecifier.text;
      const bindings = node.importClause?.namedBindings;
      if (bindings && ts.isNamedImports(bindings)) {
        for (const el of bindings.elements) localToSpecifier.set(el.name.text, spec);
      } else if (bindings && ts.isNamespaceImport(bindings)) {
        /**
         * `import * as reactDialog from '@radix-ui/react-dialog'`
         *
         * The unified `radix-ui` package — 42.4M installs a month, larger than
         * @mui/material — is built entirely from this followed by
         * `export { reactDialog as Dialog }`, across 55 siblings. It is a
         * FEDERATED NAMESPACE barrel: federation to reach the props, namespaces
         * to know the members are `Dialog.Root` and never bare `Root`.
         *
         * Handling only named imports missed all 55: 33 components discovered
         * with props for none of them. The pattern also evades an
         * `export * as` detector, which is the shape one would look for.
         */
        localToSpecifier.set(bindings.name.text, spec);
      }
      return;
    }
    if (!ts.isExportDeclaration(node)) return;

    // `export { X } from 'pkg'` / `export * from 'pkg'`
    if (node.moduleSpecifier && ts.isStringLiteral(node.moduleSpecifier)) {
      const pkg = packageOf(node.moduleSpecifier.text);
      if (pkg) specifiers.add(pkg);
      return;
    }
    // `export { X }` with no specifier — resolve X back through the imports.
    if (node.exportClause && ts.isNamedExports(node.exportClause)) {
      for (const el of node.exportClause.elements) {
        // The LOCAL name is what the import bound. `export { Image_2 as Image }`
        // must look up Image_2; using the exported name finds nothing, and that
        // is 4 of Fluent's real exports.
        const local = (el.propertyName ?? el.name).text;
        const spec = localToSpecifier.get(local);
        const pkg = spec ? packageOf(spec) : null;
        if (pkg) specifiers.add(pkg);
      }
    }
  });

  return [...specifiers];
}

/** A barrel over siblings can itself be re-exported; two levels is ample. */
const MAX_FEDERATION_DEPTH = 2;
/** Runaway guard, far above any real design system's fan-out (Fluent: 58). */
const MAX_FEDERATED_PACKAGES = 200;

/** Field-wise merge of one package's components into an accumulator. */
function mergeComponents(
  into: Record<string, ComponentFacts>,
  from: Record<string, ComponentFacts>,
): void {
  for (const [name, facts] of Object.entries(from)) {
    const prior = into[name];
    into[name] = prior
      ? {
          name,
          props: mergeProps(prior.props, facts.props),
          variants: prior.variants ?? facts.variants,
          doc: prior.doc ?? facts.doc,
        }
      : facts;
  }
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
      } else if (/\.d\.[cm]?ts$/.test(e.name) || /\.(js|jsx|ts|tsx|mts)$/.test(e.name)) {
        // `.ts`/`.tsx` for source-only workspace packages; stories are the
        // project's usage, not the component's API, and are read elsewhere.
        if (/\.stories\.[jt]sx?$/.test(e.name) || /\.test\.[jt]sx?$/.test(e.name)) continue;
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
 *
 * 4: cross-file option resolution (`options` filled from aliases declared in
 *    other files, `optionsOpen` for sets the type leaves open).
 * 5: local source roots read with the AST (`source: 'local'`), keyed by the
 *    exported component rather than a `<Name>Props` convention; a path given
 *    as the package no longer reads node_modules.
 */
const EXTRACTOR_SCHEMA = 8 // 8: props resolved by the TypeScript checker for React packages;
  // // 7: optionsOpen from the member's own type text; 6: OverridableStringUnion literals; caches written before it hid MUI's variant/color/size;

/**
 * Keyed on version AND a content fingerprint (`knowledge/cacheKey`).
 *
 * Version alone never changes for a source-only workspace package, and is
 * `unknown` forever for a bare scope — Atlassian's `@atlaskit` served one
 * 757KB record across every upgrade. For an installed copy the fingerprint is
 * the stamp of package.json and the types entry; for anything else it is the
 * stamp of every file this extractor reads.
 */
function cachePath(projectRoot: string, importPath: string, version: string | undefined, fingerprint: string): string {
  return knowledgeCacheFile(projectRoot, importPath, version, fingerprint, '.props.json');
}

/**
 * Read a LOCAL source root the way a package is read, from the same reader
 * discovery and the editor use (`localComponentFacts`), so the four never
 * disagree about a component. Cached under the tree's content fingerprint.
 */
async function readLocalRoot(
  importPath: string,
  projectRoot: string,
  root: string,
  options: { force?: boolean },
): Promise<ExtractedProps> {
  let sourceFiles: string[] | undefined;
  const filesToRead = () => (sourceFiles ??= findLocalSourceFiles(root));
  const fingerprint = contentFingerprint({ root, entryFile: null, files: filesToRead });
  const cacheFile = cachePath(projectRoot, importPath, undefined, fingerprint);
  if (!options.force && fs.existsSync(cacheFile)) {
    try {
      const cached = JSON.parse(fs.readFileSync(cacheFile, 'utf-8')) as ExtractedProps;
      if (cached.schema === EXTRACTOR_SCHEMA && cached.source === 'local') return cached;
    } catch { /* rebuild */ }
  }

  const started = Date.now();
  const tree = readLocalSourceTree(root);
  const components: Record<string, ComponentFacts> = {};
  for (const c of Object.values(tree.components)) {
    components[c.name] = { name: c.name, props: c.props, ...(c.doc ? { doc: c.doc } : {}) };
  }
  const extracted: ExtractedProps = {
    schema: EXTRACTOR_SCHEMA,
    importPath,
    components,
    inheritedOnly: [],
    extractedAt: new Date().toISOString(),
    source: 'local',
    root,
  };
  try {
    fs.mkdirSync(path.dirname(cacheFile), { recursive: true });
    fs.writeFileSync(cacheFile, JSON.stringify(extracted), 'utf-8');
    pruneStaleKnowledge(projectRoot, importPath, cacheFile, '.props.json');
  } catch { /* cache is an optimisation */ }

  const count = Object.keys(components).length;
  logger.log(
    `🧠 Read ${count} local component(s) for ${importPath} from ${path.relative(projectRoot, root) || '.'} ` +
    `(${tree.files.length} source file(s), AST) in ${Date.now() - started}ms` +
    (count === 0 ? ' — no exported component declares props or prose there' : ''),
  );
  return extracted;
}

/**
 * The name a specifier's knowledge is filed under.
 *
 * A path is its own root: `./src/ui` and `./src/ui/button` are different
 * trees. A package specifier is filed under the PACKAGE — `vuetify/components/
 * VBtn` under `vuetify`, `@mui/material/Button` under `@mui/material` —
 * because the package is the unit that is installed, versioned and read: the
 * resolver finds the package directory and the walk reads the whole of it,
 * whatever came after the package name. `@atlaskit/button` is already a
 * package name, so a package-per-component system stays one record per
 * package, exactly as before.
 *
 * Measured on Vuetify before this: discovery reports one home per component
 * (`vuetify/components/VBtn`, 126 of them); each was keyed on its own
 * specifier, so each MISSED the cache and re-read the package's entire
 * declaration tree — 126 reads of ~1s each and 193 identical 47KB records
 * under `.story-ui/knowledge/`, for a first generation that spent 105s in
 * "Reading your design system". MUI (`@mui/material/Button`) has the same
 * shape.
 */
export function knowledgeRootOf(specifier: string): string {
  if (path.isAbsolute(specifier) || specifier.startsWith('.')) return specifier;
  return packageNameOf(specifier) || specifier;
}

/** Read ONE package's own declarations. No federation; cached under the PACKAGE's key. */
async function readOnePackage(
  importPath: string,
  projectRoot: string = process.cwd(),
  options: { version?: string; force?: boolean } = {},
): Promise<ExtractedProps | null> {
  const resolved = packageRoot(projectRoot, importPath);
  if (!resolved) return null;
  if (resolved.local) return readLocalRoot(importPath, projectRoot, resolved.dir, options);
  const root = resolved.dir;
  // Every subpath of a package resolves to the same directory and reads the
  // same tree, so it is filed once, under the package (see knowledgeRootOf).
  const pkgName = knowledgeRootOf(importPath);

  let version = options.version;
  if (!version) {
    try {
      version = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf-8')).version;
    } catch { /* unknown */ }
  }

  // The file list is what a source tree's fingerprint is made of, and what a
  // miss reads; computed at most once.
  let declarationFiles: string[] | undefined;
  const filesToRead = () => (declarationFiles ??= findDeclarationFiles(root));
  const fingerprint = contentFingerprint({ root, version, entryFile: typesEntryFile(root), files: filesToRead });

  const cacheFile = cachePath(projectRoot, pkgName, version, fingerprint);
  if (!options.force && fs.existsSync(cacheFile)) {
    try {
      const cached = JSON.parse(fs.readFileSync(cacheFile, 'utf-8')) as ExtractedProps;
      // A cache from an older extractor is missing fields this one produces.
      // Re-reading costs a second; serving it silently costs the feature.
      if (cached.schema === EXTRACTOR_SCHEMA) return cached;
    } catch { /* rebuild */ }
  }

  const started = Date.now();
  const files = filesToRead();
  const components: Record<string, ComponentFacts> = {};
  const inheritedOnly: string[] = [];
  const allTypes: Record<string, PropFact[]> = {};
  const links: PropsTypeLink[] = [];
  const registry: TypeTextRegistry = { aliases: new Map(), tuples: new Map() };
  for (const file of files) collectFromFile(file, components, inheritedOnly, allTypes, links, registry);

  /**
   * Fill components whose props type is not named after them.
   *
   * Only ever ADDS: a component that already has props keeps them, so a link
   * can never displace something read directly. That matters because type
   * names are not unique across a package — two files may each declare
   * `OwnProps` — and a link is trusted precisely to the extent that it cannot
   * overwrite a better answer.
   */
  let linked = 0;
  for (const { component, propsType } of links) {
    const members = allTypes[propsType];
    if (!members?.length) continue;
    const existing = components[component];
    if (existing?.props?.length) continue;
    components[component] = {
      name: component,
      props: members,
      variants: existing?.variants,
      doc: existing?.doc,
    };
    linked++;
  }

  /**
   * Phase 2: options whose values live in ANOTHER file.
   *
   * Mantine's Button declares `size?: MantineSize | \`compact-${MantineSize}\`
   * | (string & {})` and `radius?: MantineRadius`; the literals sit in
   * theme.types.d.ts. The per-file resolver correctly found nothing, so the
   * editable-props panel classified these as `other` and dropped them — the
   * very props a design-system picker exists to offer. The registry knows what
   * every file in the package declared; following a name into it is still a
   * lookup, not type resolution.
   */
  let crossFilled = 0;
  for (const facts of Object.values(components)) {
    for (const prop of facts.props) {
      if (prop.options || !prop.type) continue;
      if (!/[A-Z]/.test(prop.type)) continue; // no type name to follow
      const resolved = resolveOptionsFromTypeText(prop.type, registry);
      if (resolved) {
        prop.options = resolved.options;
        if (resolved.open) prop.optionsOpen = true;
        crossFilled++;
      }
    }
  }
  if (crossFilled > 0) {
    logger.log(`🧠 Resolved option values across files for ${crossFilled} prop(s) in ${pkgName}`);
  }

  /**
   * Ask the compiler about what reading declarations could not resolve.
   *
   * `interface ButtonProps extends HTMLChakraProps<"button", ButtonBaseProps> {}`
   * declares nothing locally and cannot be followed syntactically. Measured by
   * the resolution bench, that shape cost one library 664 of its 754
   * components. Type resolution answers it, and only ADDS: a prop already read
   * from a declaration keeps its own reading, which carries the library's
   * prose.
   *
   * Gated on the library declaring React, because the probe is a JSX element —
   * a question tsc can answer about a React component and not about a Vue,
   * Angular or Lit one, which declare their inputs outright and are read
   * directly. The gate is the package's own manifest, not its name.
   */
  if (declaresReact(root)) {
    try {
      const checked = resolvePropsWithChecker({ projectRoot, importPath: pkgName, storiesDir: projectRoot });
      if (!checked.ran) {
        logger.log(`🧠 Type resolution for ${pkgName}: did not run — ${checked.reason}`);
      } else {
        let filled = 0;
        let added = 0;
        for (const component of checked.components) {
          if (!component.own.length) continue;
          const prior = components[component.name];
          if (prior && prior.props.length) {
            const before = prior.props.length;
            prior.props = mergeProps(prior.props, component.own);
            if (prior.props.length > before) filled++;
          } else {
            components[component.name] = { name: component.name, props: component.own };
            added++;
          }
        }
        // Exports that cannot be elements at all.
        let values = 0;
        for (const component of checked.components) {
          if (component.kind !== 'value') continue;
          const prior = components[component.name];
          if (prior && prior.props.length) continue;
          components[component.name] = { ...(prior ?? { name: component.name, props: [] }), notAComponent: true };
          values++;
        }
        // A namespace is not a component; say what to write instead.
        let namespaces = 0;
        for (const component of checked.components) {
          if (component.kind !== 'namespace' || !component.members?.length) continue;
          const prior = components[component.name];
          if (prior && prior.props.length) continue;
          components[component.name] = {
            ...(prior ?? { name: component.name, props: [] }),
            namespaceMembers: component.members,
          };
          namespaces++;
        }
        // Resolved, closed, and nothing of its own: a fact, not a gap.
        let baseOnly = 0;
        for (const component of checked.components) {
          // `open` counts too: a component whose props type admits extra keys
          // still resolved a definite styling surface, and reporting it as
          // unknown was the same conflation this comment block exists to stop.
          if (component.own.length || component.verdict === 'unknown' || component.total <= SUBSTANTIAL_TOTAL) continue;
          const prior = components[component.name];
          if (prior && prior.props.length) continue;
          components[component.name] = { ...(prior ?? { name: component.name, props: [] }), sharedBaseOnly: true };
          baseOnly++;
        }
        logger.log(
          `🧠 Type resolution for ${pkgName}: ${checked.components.length} export(s) probed in ${(checked.ms / 1000).toFixed(1)}s — ` +
          `${added} component(s) that had no props now have them, ${filled} extended, ${baseOnly} take only this library's shared styling surface, ${namespaces} are namespaces whose members are the components, ${values} cannot be written as an element at all` +
          `${checked.baseProps.length ? `; ${checked.baseProps.length} prop(s) shared by nearly every component treated as this library's base` : '; no shared base found, so nothing was subtracted'}`,
        );
      }
    } catch (error) {
      // Never fail an extraction because type resolution could not run.
      logger.log(`🧠 Type resolution for ${pkgName} failed, declarations stand alone: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  const entry = typesEntryFile(root);
  const reexportedFrom = reexportPackages(entry);

  const extracted: ExtractedProps = {
    schema: EXTRACTOR_SCHEMA,
    // The record is the PACKAGE's and is served to every specifier under it,
    // so it must not carry whichever subpath happened to write it first.
    importPath: pkgName,
    version,
    components,
    inheritedOnly,
    extractedAt: new Date().toISOString(),
    reexportedFrom,
  };

  try {
    fs.mkdirSync(path.dirname(cacheFile), { recursive: true });
    fs.writeFileSync(cacheFile, JSON.stringify(extracted), 'utf-8');
    // Also the per-subpath records an earlier extractor filed for this package
    // (`vuetify-components-VBtn@…`): their names do not say so, their contents do.
    pruneStaleKnowledge(projectRoot, pkgName, cacheFile, '.props.json', record =>
      typeof (record as ExtractedProps)?.importPath === 'string' &&
      knowledgeRootOf((record as ExtractedProps).importPath) === pkgName);
  } catch { /* cache is an optimisation */ }

  /**
   * Three situations that all printed "0 components" must read differently.
   *
   * A scope directory with no types entry, a package that genuinely declares
   * nothing, and a barrel that declares nothing but names 58 siblings are
   * completely different facts, and Fluent spent this entire session looking
   * like the second when it was the third.
   */
  const count = Object.keys(components).length;
  const why = !entry
    ? ' — no types entry declared, nothing to read'
    : count === 0 && reexportedFrom.length > 0
      ? ` — declares nothing itself, re-exports from ${reexportedFrom.length} package(s)`
      : count === 0
        ? ' — declares nothing and re-exports from nothing'
        : '';
  logger.log(
    `🧠 Extracted props for ${count} components from ${pkgName}` +
    `${version ? `@${version}` : ''} in ${Date.now() - started}ms ` +
    `(${inheritedOnly.length} inherit-only, ${linked} linked by declared props type)${why}`,
  );
  return extracted;
}

/**
 * Read a package, following its re-exports into sibling packages.
 *
 * Fluent UI v9 is the case: `@fluentui/react-components` declares zero props
 * and re-exports its entire API from 58 siblings. Reading only the configured
 * package reported that design system as having props for 0 of 233 components;
 * following the re-exports reports 85%.
 *
 * ALWAYS federates rather than gating on "the barrel found nothing" — a partial
 * barrel that declares some components locally and federates its primitives is
 * a real architecture, and gating would under-serve it invisibly. Cold cost is
 * ~640ms once, ~10ms warm.
 *
 * The merged union is deliberately NOT cached under the barrel's key. That key
 * names only the barrel's version, and siblings publish independently
 * (react-components@9.74.4 alongside react-button@9.10.1), so a sibling bump
 * would serve a stale merge until the barrel itself released — the same
 * stale-cache failure the schema version exists to prevent.
 */
export async function extractProps(
  importPath: string,
  projectRoot: string = process.cwd(),
  options: { version?: string; force?: boolean } = {},
): Promise<ExtractedProps | null> {
  const base = await readOnePackage(importPath, projectRoot, options);
  if (!base || base.reexportedFrom?.length === 0 || !base.reexportedFrom) return base;

  // The requested package is merged FIRST, so its own reading wins on conflict.
  const components: Record<string, ComponentFacts> = {};
  mergeComponents(components, base.components);
  const inheritedOnly = [...base.inheritedOnly];

  const seen = new Set<string>([importPath, knowledgeRootOf(importPath)]);
  let queue = base.reexportedFrom.map(name => ({ name, depth: 1 }));
  let read = 0;
  let unresolved = 0;

  while (queue.length && read < MAX_FEDERATED_PACKAGES) {
    const next: Array<{ name: string; depth: number }> = [];
    for (const { name, depth } of queue) {
      if (seen.has(name) || read >= MAX_FEDERATED_PACKAGES) continue;
      seen.add(name);
      const one = await readOnePackage(name, projectRoot, { force: options.force });
      if (!one) { unresolved++; continue; }   // named by the barrel, absent from node_modules
      read++;
      mergeComponents(components, one.components);
      for (const n of one.inheritedOnly) if (!inheritedOnly.includes(n)) inheritedOnly.push(n);
      if (depth < MAX_FEDERATION_DEPTH) {
        for (const child of one.reexportedFrom ?? []) if (!seen.has(child)) next.push({ name: child, depth: depth + 1 });
      }
    }
    queue = next;
  }

  logger.log(
    `🧠 Federated ${importPath}: ${base.reexportedFrom.length} package(s) named, ${read} read, ` +
    `${unresolved} unresolved — ${Object.keys(components).length} components total`,
  );

  return {
    schema: EXTRACTOR_SCHEMA,
    importPath,
    version: base.version,
    components,
    inheritedOnly,
    extractedAt: new Date().toISOString(),
    reexportedFrom: base.reexportedFrom,
  };
}

/**
 * Extract across every package a design system is spread over.
 *
 * A package-per-component system has no single place to read. Atlassian
 * configures `importPath: '@atlaskit'`, which is a SCOPE — it resolves to the
 * scope directory, so extraction walked all of node_modules/@atlaskit as one
 * undifferentiated tree and truncated at the file limit. Sixteen of 31
 * components ended up with props, and which sixteen depended on directory
 * order.
 *
 * Discovery already records where each component actually lives. Reading those
 * packages by name is bounded, complete, and derived from what the project
 * states rather than from how a walk happened to terminate.
 *
 * Results are merged rather than concatenated: a component named in two
 * packages (a re-export, or a shared base) should end up with the union of
 * what both declare, by the same field-wise rule used within a package.
 */
export async function extractPropsForPackages(
  packages: string[],
  projectRoot: string = process.cwd(),
  options: { force?: boolean } = {},
): Promise<ExtractedProps | null> {
  const specifiers = [...new Set(packages.filter(Boolean))];
  if (specifiers.length === 0) return null;
  /**
   * One read per PACKAGE, not per home.
   *
   * Vuetify's 126 homes are 126 subpaths of one package; MUI's are subpaths
   * of `@mui/material`. Each maps to the same directory and the same record,
   * and reading it through each name in turn was 126 reads of ~1s for a
   * first generation. Atlassian's homes are each their own package and
   * collapse to nothing, which is the correct answer there.
   */
  const unique = [...new Set(specifiers.map(knowledgeRootOf))];
  if (unique.length < specifiers.length) {
    logger.log(`🧠 ${specifiers.length} component home(s) live in ${unique.length} package(s); reading each package once`);
  }

  const merged: Record<string, ComponentFacts> = {};
  const inheritedOnly: string[] = [];
  let any = false;

  for (const pkg of unique) {
    const one = await extractProps(pkg, projectRoot, options);
    if (!one) continue;
    any = true;
    for (const [name, facts] of Object.entries(one.components)) {
      const prior = merged[name];
      merged[name] = prior
        ? {
            name,
            props: mergeProps(prior.props, facts.props),
            variants: prior.variants ?? facts.variants,
            doc: prior.doc ?? facts.doc,
          }
        : facts;
    }
    for (const n of one.inheritedOnly) if (!inheritedOnly.includes(n)) inheritedOnly.push(n);
  }

  if (!any) return null;
  return {
    schema: EXTRACTOR_SCHEMA,
    importPath: unique.join(','),
    components: merged,
    inheritedOnly,
    extractedAt: new Date().toISOString(),
  };
}

/**
 * Props most worth spending prompt space on: the ones that decide behaviour.
 * Handlers and state first, then content slots, then styling.
 */
/**
 * One prop as a catalog line: `variant? [primary|secondary] ='primary'`,
 * `headline (string) REQUIRED`.
 *
 * REQUIRED is said, not implied by a missing `?`: a model weighing a strong
 * prior from another library does not read punctuation. A literal union that
 * `options` already lists is not repeated as the type.
 */
export function formatPropForCatalog(p: PropFact): string {
  const type = p.type && p.options?.length && /^'[^']*'(\s*\|\s*'[^']*')*$/.test(p.type) ? '' : p.type;
  let entry = `${p.name}${p.required ? '' : '?'}${type ? ` (${type})` : ''}${p.required ? ' REQUIRED' : ''}`;
  if (p.options?.length) {
    const shown = p.options.slice(0, 8).join('|');
    entry += ` [${shown}${p.options.length > 8 ? `|…${p.options.length - 8}` : ''}]`;
  }
  if (p.defaultValue) entry += ` =${p.defaultValue}`;
  return entry;
}

/**
 * A doc sentence that describes a prop as carrying CSS itself.
 *
 * "Additional CSS class names" — Carbon's `className` — is deliberately NOT a
 * match: a class-name prop takes classes, and pointing a composition's CSS at
 * it would be the wrong destination. The exclusion is checked against the same
 * sentence rather than against the prop's name.
 */
const CSS_CARRIER_DOC = /\b(additional|arbitrary|custom|extra|inline)\b[^.]{0,40}\bCSS\s+(styles?|properties|rules)\b|\bstyle overrides\b/i;

export function rankProps(props: PropFact[]): PropFact[] {
  const tier = (p: PropFact): number => {
    if (p.required) return 0;
    if (/^on[A-Z]/.test(p.name)) return 1;
    if (/^(value|defaultValue|checked|active|selected|opened|open|disabled|loading|error)$/i.test(p.name)) return 2;
    if (/(section|icon|adornment|prefix|suffix|slot|label|placeholder)/i.test(p.name)) return 3;
    if (/^(variant|size|color|radius|shadow|position|orientation)$/i.test(p.name)) return 4;
    /**
     * The prop the library itself describes as taking arbitrary CSS.
     *
     * Judged by what the library WROTE about the prop, never by what the prop
     * is called: `sx`, `css` and `style` are three libraries' names for the
     * same idea and a custom design system owes none of them. MUI's Stack
     * declares `sx` with "allows defining system overrides as well as
     * additional CSS styles" — that sentence is the fact a composition needs,
     * and it was being dropped: with no required props, no handlers and no
     * state props, every prop on that component tied at the bottom tier and
     * sorted alphabetically, so `sx` came eighth and the catalog attaches docs
     * to the first six. Measured on a twenty-prompt MUI run: 28 of 29
     * first-round validation errors were `alignItems` and `justifyContent`
     * written as top-level props — CSS with nowhere visible to go.
     *
     * The pattern deliberately does not match a prop that merely mentions CSS
     * in passing: MUI's `useFlexGap` says "the CSS flexbox `gap` is used" and
     * is a boolean, not an escape hatch.
     */
    if (p.doc && CSS_CARRIER_DOC.test(p.doc) && !/\bCSS\s+class/i.test(p.doc)) return 4;
    return 5;
  };
  return [...props].sort((a, b) => tier(a) - tier(b) || a.name.localeCompare(b.name));
}
