/**
 * Layout recipes — "three cards in columns with a heading above" without a model.
 *
 * Jev cannot write a structure, but this one has a fixed shape: a section,
 * optionally a heading and a subheading, then N copies of one component laid
 * out in columns or rows. Code owns the shape; Jev fills every slot from a
 * closed set — which component repeats, how many, which way, which of the
 * person's words are the heading. The components that do the laying out come
 * from the project's own catalog (Mantine's SimpleGrid and its `cols`, Title,
 * Text, Stack), found once per catalog and cached; a design system without
 * them gets a plain CSS grid, which every design system can render.
 */

import { expr, type Literal, type TemplateNode } from './templates.js';

/** What the catalog offers for building a section, found once and cached. */
export interface LayoutKit {
  /** A component that lays children out in N columns, and the prop for N. */
  grid?: { tag: string; colsProp: string };
  /** A component that stacks children vertically with spacing. */
  stack?: string;
  /** A component for a section heading, and one for body text. */
  heading?: string;
  text?: string;
}

export interface RecipeSpec {
  count: number;
  arrangement: 'columns' | 'rows';
  /** One copy of the repeated item. Cloned per item. */
  item: TemplateNode;
  heading?: string;
  subheading?: string;
}

const clone = (n: TemplateNode): TemplateNode => ({
  tag: n.tag,
  attrs: n.attrs.map(([k, v]): [string, Literal] => [k, v]),
  children: n.children.map(c => (typeof c === 'string' ? c : clone(c))),
});

/** Give each copy its own ids and image seeds, so copies stay distinct. */
function distinct(item: TemplateNode, index: number): TemplateNode {
  const walk = (n: TemplateNode): TemplateNode => ({
    tag: n.tag,
    attrs: n.attrs.map(([k, v]): [string, Literal] => {
      if ((k === 'id' || k === 'htmlFor') && typeof v === 'string') return [k, `${v}-${index + 1}`];
      if (k === 'src' && typeof v === 'string') return [k, v.replace(/(picsum\.photos\/seed\/)([^/]+)/, `$1$2-${index + 1}`)];
      return [k, v];
    }),
    children: n.children.map(c => (typeof c === 'string' ? c : walk(c))),
  });
  return walk(clone(item));
}

/** The section as a template tree — printed and inserted like any other add. */
export function buildRecipe(spec: RecipeSpec, kit: LayoutKit): TemplateNode {
  const items = Array.from({ length: spec.count }, (_, i) => distinct(spec.item, i));

  let group: TemplateNode;
  if (spec.arrangement === 'columns' && kit.grid) {
    group = { tag: kit.grid.tag, attrs: [[kit.grid.colsProp, spec.count]], children: items };
  } else if (spec.arrangement === 'rows' && kit.stack) {
    group = { tag: kit.stack, attrs: [], children: items };
  } else {
    // No layout component in the catalog: plain CSS, which renders anywhere.
    const style = spec.arrangement === 'columns'
      ? `{ display: 'grid', gridTemplateColumns: 'repeat(${spec.count}, minmax(0, 1fr))', gap: 24 }`
      : `{ display: 'flex', flexDirection: 'column', gap: 24 }`;
    group = { tag: 'div', attrs: [['style', expr(style)]], children: items };
  }

  const head: TemplateNode[] = [];
  if (spec.heading) head.push({ tag: kit.heading ?? 'h2', attrs: [], children: [spec.heading] });
  if (spec.subheading) head.push({ tag: kit.text ?? 'p', attrs: [], children: [spec.subheading] });
  if (!head.length) return group;

  return kit.stack
    ? { tag: kit.stack, attrs: [], children: [...head, group] }
    : { tag: 'div', attrs: [['style', expr(`{ display: 'flex', flexDirection: 'column', gap: 16 }`)]], children: [...head, group] };
}
