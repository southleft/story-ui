/**
 * Where the workspace should sit inside Storybook's manager.
 *
 * Storybook 10.5 places the custom-page wrapper (`main#main-content-wrapper`)
 * on the SIDEBAR's grid lines. Hide the sidebar — which the workspace does by
 * default — and the wrapper collapses to 0×0 in the bottom-right corner,
 * taking a fixed-position workspace contained by it along. The grid cell
 * named `content` is right in both states (full width with the sidebar
 * hidden, beside it when shown), so the workspace is positioned over that
 * cell, and over the wrapper or the viewport only when no cell exists.
 */

export interface Rect { left: number; top: number; width: number; height: number }

const has = (r: Rect | null | undefined): r is Rect => !!r && r.width > 0 && r.height > 0;

export function pickWorkspaceBounds(
  content: Rect | null | undefined,
  wrapper: Rect | null | undefined,
  viewport: { width: number; height: number },
): Rect {
  if (has(content)) return content;
  if (has(wrapper)) return wrapper;
  return { left: 0, top: 0, width: viewport.width, height: viewport.height };
}

/** The manager grid's `content` cell, found from the page wrapper. */
export function findContentCell(wrapper: Element | null): Element | null {
  const grid = wrapper?.parentElement;
  if (!grid) return null;
  for (const child of Array.from(grid.children)) {
    if (child === wrapper) continue;
    const area = getComputedStyle(child).gridArea || '';
    if (/^content\b/.test(area)) return child;
  }
  return null;
}
