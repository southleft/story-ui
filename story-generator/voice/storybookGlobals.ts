/**
 * The preview settings a project declares — its Storybook toolbar globals.
 *
 * "Dark mode" is not a change to a component; in most projects it is a
 * global the preview's decorators read (`globalTypes.theme`, items Light and
 * Dark). The project states the setting's name and every legal value, so a
 * spoken "black UI" is a Choice among them and a URL parameter — no model,
 * no code change. Nothing here names a theme library or assumes a setting is
 * called `theme`; whatever the toolbar offers is what can be switched.
 */

import fs from 'fs';
import path from 'path';
import ts from 'typescript';

export interface StorybookGlobal {
  name: string;
  description?: string;
  title?: string;
  items: Array<{ value: string; title?: string }>;
}

const PREVIEW_FILES = ['preview.tsx', 'preview.ts', 'preview.jsx', 'preview.js', 'preview.mjs'];

function str(e: ts.Expression | undefined): string | undefined {
  return e && (ts.isStringLiteral(e) || ts.isNoSubstitutionTemplateLiteral(e)) ? e.text : undefined;
}

function prop(obj: ts.ObjectLiteralExpression, name: string): ts.Expression | undefined {
  for (const p of obj.properties) {
    if (ts.isPropertyAssignment(p) && (ts.isIdentifier(p.name) || ts.isStringLiteral(p.name)) && p.name.text === name) {
      return p.initializer;
    }
  }
  return undefined;
}

function unwrap(e: ts.Expression): ts.Expression {
  while (ts.isParenthesizedExpression(e) || ts.isAsExpression(e) || ts.isSatisfiesExpression(e)) e = e.expression;
  return e;
}

/** Globals with a closed set of toolbar items, read from preview source. */
export function globalsFromPreviewSource(source: string): StorybookGlobal[] {
  const sf = ts.createSourceFile('preview.tsx', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const out: StorybookGlobal[] = [];
  const visit = (n: ts.Node) => {
    if (
      ts.isPropertyAssignment(n)
      && (ts.isIdentifier(n.name) || ts.isStringLiteral(n.name))
      && n.name.text === 'globalTypes'
    ) {
      const types = unwrap(n.initializer);
      if (ts.isObjectLiteralExpression(types)) {
        for (const g of types.properties) {
          if (!ts.isPropertyAssignment(g) || !(ts.isIdentifier(g.name) || ts.isStringLiteral(g.name))) continue;
          const def = unwrap(g.initializer);
          if (!ts.isObjectLiteralExpression(def)) continue;
          const toolbar = prop(def, 'toolbar');
          const tb = toolbar ? unwrap(toolbar) : undefined;
          const itemsExpr = tb && ts.isObjectLiteralExpression(tb) ? prop(tb, 'items') : undefined;
          const items: StorybookGlobal['items'] = [];
          if (itemsExpr && ts.isArrayLiteralExpression(unwrap(itemsExpr))) {
            for (const el of (unwrap(itemsExpr) as ts.ArrayLiteralExpression).elements) {
              const e = unwrap(el as ts.Expression);
              const plain = str(e);
              if (plain) items.push({ value: plain });
              else if (ts.isObjectLiteralExpression(e)) {
                const value = str(prop(e, 'value'));
                if (value) items.push({ value, title: str(prop(e, 'title')) });
              }
            }
          }
          if (items.length > 1) {
            out.push({
              name: g.name.text,
              description: str(prop(def, 'description')),
              title: tb && ts.isObjectLiteralExpression(tb) ? str(prop(tb, 'title')) : undefined,
              items,
            });
          }
        }
      }
    }
    ts.forEachChild(n, visit);
  };
  visit(sf);
  return out;
}

/** The project's toolbar globals, or [] when it declares none. */
export function readStorybookGlobals(projectRoot: string): StorybookGlobal[] {
  for (const f of PREVIEW_FILES) {
    const file = path.join(projectRoot, '.storybook', f);
    if (!fs.existsSync(file)) continue;
    try {
      return globalsFromPreviewSource(fs.readFileSync(file, 'utf8'));
    } catch {
      return [];
    }
  }
  return [];
}
