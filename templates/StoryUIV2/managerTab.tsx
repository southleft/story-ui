/**
 * Story UI as a Storybook MANAGER page.
 *
 * Why the manager and not the preview: the workspace used to be mounted from
 * an MDX docs page inside the preview iframe, and Storybook re-renders that
 * page from scratch whenever a story enters its index — which every
 * generation does. The live narration, step list and in-flight stream were
 * torn down mid-run and rebuilt from the manifest afterwards. The manager
 * never remounts on index changes, so a workspace hosted here keeps its
 * state for the whole run.
 *
 * Which API: `types.experimental_PAGE`, registered from the project's
 * `.storybook/manager.ts` via templates/StoryUI/manager.tsx. In Storybook
 * 10.1 a page is rendered by the manager's App in `slotPages` whenever the
 * view mode is neither `story` nor `docs`, over the canvas and beside the
 * sidebar — exactly how Storybook's own Settings page works. `types.TAB`
 * still exists but is deprecated (the Preview logs "Addon tabs are
 * deprecated and will be removed in Storybook 11" as soon as a second tab
 * is registered), needs a story to be selected, and lives inside the
 * canvas toolbar; a page has its own route (`?path=/workspace/`) and no such
 * dependency.
 *
 * This module is bundled for the manager by scripts/bundle-workspace-manager.mjs
 * (React externalised to the manager's globals, `react/jsx-runtime` shimmed
 * onto `React.createElement`, CSS emitted beside it) and exported as
 * `@tpitre/story-ui/manager` + `@tpitre/story-ui/manager.css`.
 */
import React, { useCallback, useEffect, useState } from 'react';
import { useStorybookApi, useStorybookState } from 'storybook/manager-api';
import { Workspace } from './Workspace';
import { resolveApiBase } from './apiBase';

/**
 * The page's route: `?path=/workspace/`. Storybook parses the first segment
 * as the view mode. NOT `/story-ui/`: the manager decides whether to show the
 * canvas with `/(^\/story|docs|onboarding\/|^\/$)/`, and `/story-ui/`
 * matches `^\/story` — the (hidden-story) preview then paints over the page.
 */
export const STORY_UI_ROUTE = '/workspace/';
export const STORY_UI_VIEW_MODE = 'workspace';
export const STORY_UI_PAGE_ID = 'story-ui/workspace';
/**
 * sessionStorage flag the manager sets when it registers the page. The
 * preview iframe shares sessionStorage with the manager (same origin, same
 * tab), so the MDX fallback page can tell that a better surface exists and
 * point at it. Session-scoped on purpose: an un-wired addon must not leave a
 * stale promise behind.
 */
export const TAB_FLAG_KEY = 'story-ui-tab';

/** localStorage key shared with the workspace and the docs-page focus flow; "false" is the only opt-out. */
const FOCUS_KEY = 'story-ui-focus';
const FOCUS_MESSAGE = 'story-ui:focus';
const FOCUS_STATE_MESSAGE = 'story-ui:focus-state';

const readFocusPreference = (): boolean => {
  try { return localStorage.getItem(FOCUS_KEY) !== 'false'; } catch { return true; }
};
const writeFocusPreference = (on: boolean) => {
  try { localStorage.setItem(FOCUS_KEY, on ? 'true' : 'false'); } catch { /* private mode */ }
};

/** Record that the page exists, for the docs fallback to read. */
export function announceStoryUiTab(): void {
  try { sessionStorage.setItem(TAB_FLAG_KEY, STORY_UI_ROUTE); } catch { /* private mode */ }
}

/** True when the manager is showing the Story UI page. */
export function isStoryUiRoute(viewMode: string | undefined): boolean {
  return viewMode === STORY_UI_VIEW_MODE;
}

/**
 * Navigate the manager to the page. `navigateUrl` takes the URL as written
 * (`plain`), which is what a `?path=` for a non-story route needs; the
 * `selectStory`-style helpers all assume a story id.
 */
export function openStoryUiTab(api: { navigateUrl?: (url: string, options?: any) => void }): void {
  const url = `?path=${STORY_UI_ROUTE}`;
  if (typeof api?.navigateUrl === 'function') {
    api.navigateUrl(url);
    return;
  }
  window.location.search = url;
}

/**
 * What the sidebar was before we folded it, in sessionStorage rather than a
 * ref: a full reload while the page is open (Vite HMR of the manager, a
 * hard refresh) loses every ref, and the folded sidebar then looked like the
 * user's own choice — the next story view had no sidebar and nothing to put
 * it back. The toolbar tool in manager.tsx reads the same key and restores
 * on its own mount, so the manager heals itself wherever it comes back.
 */
export const CHROME_BEFORE_FOCUS_KEY = 'story-ui-chrome-before-focus';
interface SavedChrome { nav: boolean; panel?: boolean }
export const readSavedChrome = (): SavedChrome | null => {
  try {
    const raw = sessionStorage.getItem(CHROME_BEFORE_FOCUS_KEY);
    const parsed = raw ? JSON.parse(raw) : null;
    return parsed && typeof parsed.nav === 'boolean' ? parsed : null;
  } catch { return null; }
};
export const writeSavedChrome = (value: SavedChrome | null) => {
  try {
    if (value) sessionStorage.setItem(CHROME_BEFORE_FOCUS_KEY, JSON.stringify(value));
    else sessionStorage.removeItem(CHROME_BEFORE_FOCUS_KEY);
  } catch { /* private mode */ }
};

/**
 * Focus in the page context.
 *
 * The panel is not shown for pages at all (Storybook only shows it in story
 * view), so "focus" here means one thing: fold the sidebar away while the
 * page is open, and put it back exactly as it was on the way out. The
 * preference is the same `story-ui-focus` the docs-page flow uses.
 *
 * Messages are accepted from both places the workspace can post from: the
 * preview iframe (docs page, `window.parent` is the manager) and this very
 * document (page, `window.parent === window`, so the message arrives with
 * `e.source === window`). The answer goes back the same way.
 */
function useTabFocus(api: ReturnType<typeof useStorybookApi>) {
  const [focus, setFocusState] = useState<boolean>(readFocusPreference);

  useEffect(() => {
    const onMessage = (e: MessageEvent) => {
      if (e.origin !== window.location.origin) return;
      const msg = e.data;
      if (!msg || msg.type !== FOCUS_MESSAGE || typeof msg.on !== 'boolean') return;
      writeFocusPreference(msg.on);
      setFocusState(msg.on);
    };
    window.addEventListener('message', onMessage);
    return () => window.removeEventListener('message', onMessage);
  }, []);

  useEffect(() => {
    const canToggle = typeof api?.toggleNav === 'function';
    if (!canToggle) return;
    if (focus) {
      if (!readSavedChrome()) {
        writeSavedChrome({ nav: typeof api.getIsNavShown === 'function' ? api.getIsNavShown() : true });
      }
      api.toggleNav(false);
    } else if (readSavedChrome()) {
      // Focus turned off while the page is open is a request to SEE the
      // sidebar, whatever it was before; the exact restore belongs to
      // leaving the page (the unmount below).
      api.toggleNav(true);
      writeSavedChrome(null);
    }
    try { window.postMessage({ type: FOCUS_STATE_MESSAGE, on: focus }, window.location.origin); } catch { /* ignore */ }
  }, [api, focus]);

  // The page unmounts whenever the user selects a story; the sidebar must
  // come back with it.
  useEffect(() => () => {
    const saved = readSavedChrome();
    if (saved && typeof api?.toggleNav === 'function') {
      api.toggleNav(saved.nav);
      writeSavedChrome(null);
    }
  }, [api]);

  const setFocus = useCallback((on: boolean) => {
    writeFocusPreference(on);
    setFocusState(on);
  }, []);

  return { focus, setFocus };
}

/**
 * The page. Fills the manager's page slot; the workspace's own `.suiw-root`
 * is `position: fixed; inset: 0`, which inside the preview iframe meant
 * "the whole frame" and here would mean "the whole manager, sidebar
 * included" — the `transform` on the host makes this element the containing
 * block for fixed descendants instead, so the workspace fills the page slot
 * and nothing else. Popovers and dialogs portal to `document.body` and are
 * unaffected.
 */
export const StoryUIPage: React.FC = () => {
  const api = useStorybookApi();
  // Storybook's own theme is the host here; the workspace's "auto" would
  // otherwise read the OS preference and ignore a dark manager.
  const base = (useStorybookState() as any)?.theme?.base;
  const appearance = base === 'dark' || base === 'light' ? base : 'auto';
  const [apiBase] = useState<string>(() => resolveApiBase());
  // The sidebar toggle lives in the workspace's header; it posts
  // `story-ui:focus` to this window and this hook answers with the state.
  useTabFocus(api);

  return (
    <div
      className="suiw-manager-host"
      data-story-ui-page=""
      style={{
        position: 'relative',
        flex: '1 1 auto',
        minHeight: 0,
        height: '100%',
        overflow: 'hidden',
        transform: 'translate(0, 0)',
      }}
    >
      <Workspace apiBase={apiBase} appearance={appearance} />
    </div>
  );
};

export default StoryUIPage;
