/**
 * A Vue component's props, read from the type Vue itself generates.
 *
 * Measured by the resolution bench across fourteen design systems: the Vue
 * environment knew the props of 39 of 174 components, 22%, against 78-100% for
 * most of the others. A catalog that lists a component and nothing about it is
 * the condition under which a composition invents attributes.
 *
 * Vue's compiler resolves a component's props into the first type argument of
 * its public instance type:
 *
 *   export declare const VBtn: {
 *     new (...args: any[]): import("vue").CreateComponentPublicInstanceWithMixins<{
 *       density: Density;
 *       variant: "elevated" | "flat" | "outlined" | "plain" | "text" | "tonal";
 *       disabled: boolean;
 *       …
 *     }, …>
 *   };
 *
 * Every prop is there with its real type, and a union type carries the values
 * the component accepts — the single most useful fact a catalog can hold about
 * a prop.
 *
 * This is a FRAMEWORK reader. The type names it looks for belong to Vue, not
 * to any design system, so a Vue library of any provenance is read the same
 * way. Nothing here names a component, a package, or a vendor.
 */

import ts from 'typescript';

export interface VueProp {
  name: string;
  type?: string;
  /** String values the type declares, when it is a union of literals. */
  options?: string[];
}

export interface VueComponentFacts {
  name: string;
  props: VueProp[];
}

/**
 * Vue's own public-instance and component types, whose FIRST type argument is
 * the resolved props object.
 */
const VUE_INSTANCE_TYPES = new Set([
  'CreateComponentPublicInstance',
  'CreateComponentPublicInstanceWithMixins',
  'ComponentPublicInstance',
  'DefineComponent',
]);

/** Props every Vue component inherits; listing them teaches nothing. */
const UNIVERSAL = new Set(['key', 'ref', 'class', 'style', 'theme']);

function typeName(node: ts.TypeNode): string | null {
  if (ts.isImportTypeNode(node)) {
    const q = node.qualifier;
    if (!q) return null;
    return ts.isQualifiedName(q) ? q.right.text : q.text;
  }
  if (!ts.isTypeReferenceNode(node)) return null;
  const n = node.typeName;
  return ts.isQualifiedName(n) ? n.right.text : n.text;
}

function typeArgumentsOf(node: ts.TypeNode): ts.NodeArray<ts.TypeNode> | undefined {
  if (ts.isImportTypeNode(node)) return node.typeArguments;
  if (ts.isTypeReferenceNode(node)) return node.typeArguments;
  return undefined;
}

/** The string literals of a union type, when every member is one. */
function unionLiterals(node: ts.TypeNode | undefined, source: ts.SourceFile): string[] | undefined {
  if (!node || !ts.isUnionTypeNode(node)) return undefined;
  const out: string[] = [];
  for (const t of node.types) {
    if (ts.isLiteralTypeNode(t) && ts.isStringLiteral(t.literal)) out.push(t.literal.text);
    else if (t.kind === ts.SyntaxKind.UndefinedKeyword || t.kind === ts.SyntaxKind.NullKeyword) continue;
    else return undefined;   // a mixed union is not a value set
  }
  void source;
  return out.length > 1 ? out : undefined;
}

/**
 * The props declared in a resolved props object.
 *
 * Vue resolves the props argument itself as an intersection — the component's
 * own props, then each mixin's — so the members have to be gathered from every
 * constituent. Reading only a plain object literal found nothing on a library
 * where every component has mixins, which is most of them.
 */
function propsOf(node: ts.TypeNode | undefined, source: ts.SourceFile): VueProp[] {
  if (!node) return [];
  if (ts.isParenthesizedTypeNode(node)) return propsOf(node.type, source);
  if (ts.isIntersectionTypeNode(node)) {
    const seen = new Map<string, VueProp>();
    for (const t of node.types) {
      for (const p of propsOf(t, source)) if (!seen.has(p.name)) seen.set(p.name, p);
    }
    return [...seen.values()];
  }
  if (!ts.isTypeLiteralNode(node)) return [];
  const out: VueProp[] = [];
  for (const member of node.members) {
    if (!ts.isPropertySignature(member) || !member.name) continue;
    const name = ts.isIdentifier(member.name) || ts.isStringLiteral(member.name)
      ? (member.name as ts.Identifier | ts.StringLiteral).text
      : null;
    if (!name || UNIVERSAL.has(name) || name.startsWith('$') || name.startsWith('_')) continue;
    const options = unionLiterals(member.type, source);
    const text = member.type ? member.type.getText(source) : undefined;
    out.push({
      name,
      // A resolved type can be enormous (a whole slots record); a catalog line
      // is not the place for it, and an unreadable type teaches nothing.
      ...(text && text.length <= 120 ? { type: text.replace(/\s+/g, ' ') } : {}),
      ...(options ? { options } : {}),
    });
  }
  return out;
}

/**
 * Read every Vue component declared in one source file.
 *
 * Returns an empty array for a file that declares none — every file in a
 * React, Angular, Svelte or Lit project — so this costs one AST walk and is
 * safe to run everywhere.
 */
export function readVueDeclarations(source: ts.SourceFile): VueComponentFacts[] {
  const out: VueComponentFacts[] = [];

  /** The props argument of a Vue instance type, wherever it is nested. */
  const propsFromType = (node: ts.TypeNode): VueProp[] | null => {
    const name = typeName(node);
    if (name && VUE_INSTANCE_TYPES.has(name)) {
      const args = typeArgumentsOf(node);
      return propsOf(args?.[0], source);
    }
    /**
     * Vue emits the component as an INTERSECTION: the constructor, then the
     * statics, then whatever mixins contribute. The props are in one member of
     * it, so the constituents have to be tried — reading only the outermost
     * node found nothing at all on a library where every component is declared
     * this way.
     */
    if (ts.isIntersectionTypeNode(node) || ts.isUnionTypeNode(node)) {
      for (const t of node.types) {
        const found = propsFromType(t);
        if (found && found.length) return found;
      }
      return null;
    }
    // `{ new (...args): <instance type> }` — the shape Vue emits for a
    // component declared with defineComponent.
    if (ts.isTypeLiteralNode(node)) {
      for (const member of node.members) {
        if (ts.isConstructSignatureDeclaration(member) && member.type) {
          const found = propsFromType(member.type);
          if (found) return found;
        }
      }
    }
    return null;
  };

  const visit = (node: ts.Node): void => {
    if (ts.isVariableStatement(node)) {
      for (const decl of node.declarationList.declarations) {
        if (!ts.isIdentifier(decl.name) || !decl.type) continue;
        if (!/^[A-Z]/.test(decl.name.text)) continue;
        const props = propsFromType(decl.type);
        if (props && props.length) out.push({ name: decl.name.text, props });
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  return out;
}
