/**
 * An Angular component's inputs, read from the declaration Angular itself
 * emits.
 *
 * Measured by the resolution bench across fourteen design systems: Angular
 * Material discovered 309 components and knew the props of NONE of them. Every
 * other environment sat between 78% and 100%. The catalog therefore offered
 * the model 309 names and nothing else, which is the condition under which a
 * composition invents attributes — the opposite of adhering to the system.
 *
 * The facts were never missing. Angular's compiler writes them into the type
 * of a static member on the class:
 *
 *   static ɵcmp: i0.ɵɵComponentDeclaration<
 *     MatButton,
 *     "button[matButton], a[matButton], …",   // selector
 *     ["matButton", "matAnchor"],             // exportAs
 *     { "appearance": { "alias": "matButton"; "required": false; } },  // inputs
 *     {},                                     // outputs
 *     …>;
 *
 * So the inputs, their template names, and whether each is required are
 * declared in the library's own output. This reads them, and takes each
 * input's TYPE and JSDoc from the class member of the same name.
 *
 * This is a FRAMEWORK reader, not a library one: `ɵɵComponentDeclaration` and
 * `ɵɵDirectiveDeclaration` are Angular's, so any Angular design system —
 * Material, a vendor's, or one written in-house — is read the same way. There
 * is no component name, package name or design system anywhere in it.
 */

import ts from 'typescript';

export interface AngularInput {
  /** The name written in a template — the alias when the library declares one. */
  name: string;
  /** The class property behind it, when the alias differs. */
  property?: string;
  required: boolean;
  /** Declared type of the class member, when it has one. */
  type?: string;
  /** First line of the member's JSDoc. */
  doc?: string;
  /** True for an @Output: the template binding is an event. */
  output?: boolean;
}

export interface AngularComponentFacts {
  name: string;
  /** The CSS selector Angular matches — how the component is actually written. */
  selector?: string;
  inputs: AngularInput[];
}

/** Angular's own declaration types, in the order their type arguments appear. */
const DECLARATION_TYPES = new Set(['ɵɵComponentDeclaration', 'ɵɵDirectiveDeclaration']);
const INPUTS_ARG = 3;
const OUTPUTS_ARG = 4;

function typeName(node: ts.TypeNode): string | null {
  if (!ts.isTypeReferenceNode(node)) return null;
  const n = node.typeName;
  return ts.isQualifiedName(n) ? n.right.text : n.text;
}

/** The string a literal type node carries, or null. */
function literalText(node: ts.TypeNode | undefined): string | null {
  if (!node || !ts.isLiteralTypeNode(node)) return null;
  return ts.isStringLiteral(node.literal) ? node.literal.text : null;
}

function isTrue(node: ts.TypeNode | undefined): boolean {
  return !!node && ts.isLiteralTypeNode(node) && node.literal.kind === ts.SyntaxKind.TrueKeyword;
}

/** First line of the JSDoc immediately above a node. */
function docOf(node: ts.Node, source: ts.SourceFile): string | undefined {
  const ranges = ts.getLeadingCommentRanges(source.text, node.getFullStart()) || [];
  for (const r of ranges.reverse()) {
    const raw = source.text.slice(r.pos, r.end);
    if (!raw.startsWith('/**')) continue;
    const body = raw.replace(/^\/\*\*|\*\/$/g, '')
      .split('\n')
      .map(l => l.replace(/^\s*\*\s?/, '').trim())
      .filter(l => l && !l.startsWith('@'))
      .join(' ')
      .trim();
    if (body) return body.split(/(?<=\.)\s/)[0].trim();
  }
  return undefined;
}

/**
 * The declared members of one type argument, as {name, aliasedTo, required}.
 *
 * Angular writes the map keyed by the CLASS PROPERTY with the template name in
 * `alias`, so the name a composition writes is the alias when there is one.
 */
function membersOf(arg: ts.TypeNode | undefined): Array<{ property: string; alias?: string; required: boolean }> {
  if (!arg || !ts.isTypeLiteralNode(arg)) return [];
  const out: Array<{ property: string; alias?: string; required: boolean }> = [];
  for (const member of arg.members) {
    if (!ts.isPropertySignature(member) || !member.name) continue;
    const property = ts.isStringLiteral(member.name) || ts.isIdentifier(member.name)
      ? (member.name as ts.StringLiteral | ts.Identifier).text
      : null;
    if (!property) continue;
    let alias: string | undefined;
    let required = false;
    if (member.type && ts.isTypeLiteralNode(member.type)) {
      for (const f of member.type.members) {
        if (!ts.isPropertySignature(f) || !f.name || !ts.isIdentifier(f.name)) continue;
        if (f.name.text === 'alias') alias = literalText(f.type) ?? undefined;
        if (f.name.text === 'required') required = isTrue(f.type);
      }
    }
    out.push({ property, ...(alias && alias !== property ? { alias } : {}), required });
  }
  return out;
}

/** The class member of a given name, for its type and its documentation. */
function memberNamed(cls: ts.ClassDeclaration, name: string): ts.ClassElement | undefined {
  return cls.members.find(m => {
    if (!m.name) return false;
    const n = ts.isIdentifier(m.name) || ts.isStringLiteral(m.name)
      ? (m.name as ts.Identifier | ts.StringLiteral).text : null;
    return n === name
      && (ts.isPropertyDeclaration(m) || ts.isGetAccessorDeclaration(m) || ts.isSetAccessorDeclaration(m));
  });
}

function memberType(member: ts.ClassElement | undefined, source: ts.SourceFile): string | undefined {
  if (!member) return undefined;
  if (ts.isPropertyDeclaration(member) && member.type) return member.type.getText(source);
  if (ts.isGetAccessorDeclaration(member) && member.type) return member.type.getText(source);
  if (ts.isSetAccessorDeclaration(member) && member.parameters[0]?.type) {
    return member.parameters[0].type.getText(source);
  }
  return undefined;
}

/**
 * Read every Angular component and directive declared in one source file.
 *
 * Returns an empty array for a file that declares none, which is every file in
 * a React, Vue, Svelte or Lit project — so this is safe to run everywhere and
 * costs one AST walk.
 */
export function readAngularDeclarations(source: ts.SourceFile): AngularComponentFacts[] {
  const out: AngularComponentFacts[] = [];

  const visit = (node: ts.Node): void => {
    if (ts.isClassDeclaration(node) && node.name) {
      for (const member of node.members) {
        if (!ts.isPropertyDeclaration(member) || !member.type || !member.name) continue;
        const memberName = ts.isIdentifier(member.name) ? member.name.text : null;
        if (memberName !== 'ɵcmp' && memberName !== 'ɵdir') continue;
        const declared = typeName(member.type);
        if (!declared || !DECLARATION_TYPES.has(declared)) continue;
        const args = (member.type as ts.TypeReferenceNode).typeArguments || [];
        const selector = literalText(args[1]) ?? undefined;
        const inputs: AngularInput[] = [];
        for (const m of membersOf(args[INPUTS_ARG])) {
          const classMember = memberNamed(node, m.property);
          inputs.push({
            name: m.alias ?? m.property,
            ...(m.alias ? { property: m.property } : {}),
            required: m.required,
            ...(memberType(classMember, source) ? { type: memberType(classMember, source) } : {}),
            ...(classMember && docOf(classMember, source) ? { doc: docOf(classMember, source) } : {}),
          });
        }
        for (const m of membersOf(args[OUTPUTS_ARG])) {
          const classMember = memberNamed(node, m.property);
          inputs.push({
            name: m.alias ?? m.property,
            ...(m.alias ? { property: m.property } : {}),
            required: false,
            output: true,
            ...(classMember && docOf(classMember, source) ? { doc: docOf(classMember, source) } : {}),
          });
        }
        out.push({
          name: node.name.text,
          ...(selector ? { selector: selector.replace(/\s+/g, ' ').trim() } : {}),
          inputs,
        });
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  return out;
}
