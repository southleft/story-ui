/**
 * Which appearance the workspace should wear: the host's.
 *
 * Both Theme roots were hardcoded `appearance="dark"`, so a light-themed
 * Storybook opened the workspace as a dark slab inside a white page. The
 * workspace has no theme of its own to defend; it is a panel inside someone
 * else's tool and should look like it belongs there.
 *
 * Signals, in order, each one read rather than guessed:
 *
 *   1. `html[data-theme]` / `body[data-theme]` — what addon-themes'
 *      data-attribute strategy writes, and what a project's own theme
 *      switcher usually writes too.
 *   2. The docs container's rendered background. addon-docs paints
 *      `.sbdocs-wrapper` with its theme's `background.content` (#FFFFFF for
 *      the light theme, #222425 for dark), so its luminance is the docs
 *      theme, measured off the page rather than inferred from anything.
 *   3. `prefers-color-scheme` — the OS, when the page says nothing.
 *
 * The docs container is only consulted when it has painted an opaque colour;
 * a transparent wrapper says nothing and falls through.
 */

import { useEffect, useState } from 'react';

export type Appearance = 'light' | 'dark';
export type AppearanceSetting = Appearance | 'auto';

/**
 * Relative luminance (0..1) of a computed CSS colour, or null when the value
 * is not an opaque rgb()/rgba() colour — transparent means "no signal".
 */
export function luminanceOf(color: string | null | undefined): number | null {
  if (!color) return null;
  const m = color.match(/rgba?\(\s*([\d.]+)[\s,]+([\d.]+)[\s,]+([\d.]+)(?:[\s,/]+([\d.]+%?))?\s*\)/i);
  if (!m) return null;
  if (m[4] !== undefined) {
    const alpha = m[4].endsWith('%') ? parseFloat(m[4]) / 100 : parseFloat(m[4]);
    if (!(alpha > 0.5)) return null;
  }
  const lin = (c: number) => {
    const v = c / 255;
    return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
  };
  const r = Number(m[1]);
  const g = Number(m[2]);
  const b = Number(m[3]);
  if ([r, g, b].some(n => !Number.isFinite(n))) return null;
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
}

const asAppearance = (v: string | null | undefined): Appearance | null => {
  const s = (v || '').trim().toLowerCase();
  return s === 'dark' || s === 'light' ? s : null;
};

/**
 * What the page around the workspace says its appearance is, or null when it
 * says nothing we trust.
 */
export function readHostAppearance(doc: Document): Appearance | null {
  try {
    const declared =
      asAppearance(doc.documentElement.getAttribute('data-theme')) ??
      asAppearance(doc.body?.getAttribute('data-theme'));
    if (declared) return declared;
  } catch { /* no DOM */ }

  try {
    const wrapper = doc.querySelector('.sbdocs-wrapper, .sbdocs.sbdocs-wrapper');
    const view = doc.defaultView;
    if (wrapper && view) {
      const lum = luminanceOf(view.getComputedStyle(wrapper).backgroundColor);
      if (lum !== null) return lum < 0.5 ? 'dark' : 'light';
    }
  } catch { /* getComputedStyle unavailable */ }

  return null;
}

function resolve(setting: AppearanceSetting): Appearance {
  if (setting === 'light' || setting === 'dark') return setting;
  if (typeof document === 'undefined') return 'dark';
  const host = readHostAppearance(document);
  if (host) return host;
  try {
    return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
  } catch {
    return 'dark';
  }
}

export function useAppearance(setting: AppearanceSetting = 'auto'): Appearance {
  const [appearance, setAppearance] = useState<Appearance>(() => resolve(setting));

  useEffect(() => {
    setAppearance(resolve(setting));
    if (setting !== 'auto' || typeof window === 'undefined') return;

    const update = () => setAppearance(resolve(setting));

    let media: MediaQueryList | null = null;
    try {
      media = window.matchMedia('(prefers-color-scheme: dark)');
      media.addEventListener('change', update);
    } catch { media = null; }

    // A theme switcher rewrites data-theme; addon-docs repaints the wrapper.
    // Either way the attributes on the root elements change.
    let observer: MutationObserver | null = null;
    try {
      observer = new MutationObserver(update);
      observer.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme', 'class', 'style'] });
      if (document.body) {
        observer.observe(document.body, { attributes: true, attributeFilter: ['data-theme', 'class', 'style'] });
      }
    } catch { observer = null; }

    return () => {
      media?.removeEventListener('change', update);
      observer?.disconnect();
    };
  }, [setting]);

  return appearance;
}
