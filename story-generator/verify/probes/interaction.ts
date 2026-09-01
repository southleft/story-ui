/**
 * Does the thing actually work when you click it?
 *
 * Every other probe in this directory OBSERVES a static render. None of them
 * ever use the page, and that gap is exactly where the defects a human found by
 * hand were hiding:
 *
 *   - three toggle switches on a settings panel, correctly labelled, visually
 *     present, and completely inert. Nothing static can see this: the markup is
 *     valid, the control is focusable, axe is satisfied, and a screenshot looks
 *     perfect. A vision model looking at a picture is structurally blind to it.
 *   - a row-actions menu that rendered IN THE DOCUMENT FLOW, pushing sibling
 *     content sideways every time it opened, instead of floating above it. Also
 *     invisible to a static check, since the closed state is fine.
 *
 * Both are deterministic once you interact: click a switch and its state either
 * flips or it does not; open an overlay and siblings either move or they do not.
 * No judgement, no vision model, no taste.
 *
 * SAFETY. Clicking things in someone else's story is intrusive, so this is
 * deliberately timid. It only clicks controls that look like toggles or overlay
 * triggers, never links, never anything whose text suggests a destructive action.
 * It caps how many it touches, restores state by clicking again, and refuses to
 * run at all if the page has a dialog open. A verification step that mangles the
 * thing it is verifying is worse than no verification.
 */

export interface DeadControl {
  /** Accessible name or nearby label, for a message a human can act on. */
  label: string;
  /** Tag and role, e.g. `button[role=switch]`. */
  descriptor: string;
  /** What we watched for and did not see. */
  expected: string;
  owner?: string;
  ownedByLibrary?: boolean;
}

export interface FlowBreakingOverlay {
  label: string;
  descriptor: string;
  /** How far the worst-affected sibling moved, in px. */
  shiftedBy: number;
  /** How many siblings moved at all. */
  siblingsMoved: number;
  owner?: string;
  ownedByLibrary?: boolean;
}

export interface InteractionResult {
  /** Controls clicked; 0 means there was nothing to test, not that all passed. */
  controlsTested: number;
  /** Overlay triggers opened. */
  overlaysTested: number;
  /**
   * Controls found but NOT clicked because the cap was reached.
   *
   * A cap reached is not an all-clear. Mantine's notification panels render 8
   * switches against a cap of 6, so two would go unexercised and the log would
   * have read exactly like a clean run.
   */
  controlsSkippedByCap: number;
  overlaysSkippedByCap: number;
  deadControls: DeadControl[];
  flowBreakingOverlays: FlowBreakingOverlay[];
  /** True when the probe declined to run; findings are then meaningless. */
  skipped: boolean;
  skipReason?: string;
}

export interface InteractionOptions {
  libraryComponents?: string[];
  /** Hard cap, so verification cannot dominate generation latency. */
  maxControls?: number;
  maxOverlays?: number;
}

export async function runInteractionProbe(
  page: any,
  options: InteractionOptions = {},
): Promise<InteractionResult> {
  const { maxControls = 6, maxOverlays = 3 } = options;

  return page.evaluate(
    async (opts: InteractionOptions & { maxControls: number; maxOverlays: number }) => {
      const LIBRARY = new Set(opts?.libraryComponents || []);

      /**
       * Search PORTALLED roots too, not only #storybook-root.
       *
       * Overlays, modals and drawers portal to document.body, so scoping to the
       * story root leaves a switch inside a drawer silently unexercised — the
       * exact regression domCensus was already fixed for. Storybook's own chrome
       * is excluded by id so the probe never clicks the toolbar.
       */
      const roots: HTMLElement[] = [];
      const storyRoot = (document.querySelector('#storybook-root')
        || document.querySelector('#root')) as HTMLElement | null;
      if (storyRoot) roots.push(storyRoot);
      for (const child of Array.from(document.body.children) as HTMLElement[]) {
        if (storyRoot && (child === storyRoot || child.contains(storyRoot))) continue;
        if (/^(storybook|sb-)/i.test(child.id) || child.tagName === 'SCRIPT' || child.tagName === 'STYLE') continue;
        roots.push(child);
      }
      if (roots.length === 0) roots.push(document.body);

      const queryAll = (selector: string): HTMLElement[] => {
        const out: HTMLElement[] = [];
        for (const r of roots) {
          if (r.matches?.(selector)) out.push(r);
          out.push(...(Array.from(r.querySelectorAll(selector)) as HTMLElement[]));
        }
        return [...new Set(out)];
      };

      const result: InteractionResult = {
        controlsTested: 0, overlaysTested: 0,
        controlsSkippedByCap: 0, overlaysSkippedByCap: 0,
        deadControls: [], flowBreakingOverlays: [],
        skipped: false,
      };

      // Never interact with a page that already has something modal open — the
      // baseline is not trustworthy and a stray click could dismiss it.
      if (document.querySelector('[role="dialog"][open], dialog[open], [aria-modal="true"]')) {
        return { ...result, skipped: true, skipReason: 'a modal was already open' };
      }

      const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

      const nameOf = (el: Element): string => {
        const aria = el.getAttribute('aria-label');
        if (aria) return aria;
        const id = el.getAttribute('aria-labelledby');
        if (id) {
          const t = document.getElementById(id)?.textContent?.trim();
          if (t) return t;
        }
        const labelled = (el as HTMLInputElement).labels?.[0]?.textContent?.trim();
        if (labelled) return labelled;
        // A switch's label is very often a sibling, not an ancestor.
        const near = el.closest('label')?.textContent?.trim()
          || el.parentElement?.textContent?.trim();
        return (near || el.textContent?.trim() || '(unnamed)').slice(0, 60);
      };

      /** The component React says rendered this node. Same rule as every probe here. */
      const ownerOf = (node: any): string | null => {
        const key = Object.keys(node).find((k: string) =>
          k.startsWith('__reactFiber$') || k.startsWith('__reactInternalInstance$'));
        if (!key) return null;
        const nm = (t: any): string | null => {
          if (!t) return null;
          if (typeof t === 'string') return null;
          if (typeof t === 'function') return t.displayName || t.name || null;
          if (typeof t === 'object') return t.displayName || nm(t.render) || nm(t.type) || null;
          return null;
        };
        const NOISE = /^(Fragment|ForwardRef|Memo|Unknown|Anonymous|Slot|Provider|_c\d*)$/;
        let f: any = node[key];
        let guard = 0;
        while (f && guard++ < 40) {
          if (typeof f.type !== 'string' && f.type) {
            const n = (nm(f.type) || '').replace(/^.*\//, '');
            if (n && !NOISE.test(n)) return n;
          }
          f = f.return;
        }
        return null;
      };

      const attribute = (el: Element) => {
        const owner = ownerOf(el);
        return owner ? { owner, ownedByLibrary: LIBRARY.has(owner) } : {};
      };

      /** Text that suggests clicking would destroy something. Never touched. */
      const DESTRUCTIVE = /\b(delete|remove|destroy|revoke|cancel|deactivate|sign out|log out|submit|save|pay|purchase)\b/i;

      /* ── 1. Toggles that do not toggle ──────────────────────────────────── */

      /**
       * `''` means the control exposes NO checked state, which is a different
       * defect from a state that refuses to change — the message must say which.
       * The coalesce sits inside String() deliberately: `String(undefined)` would
       * be the literal "undefined" and make that case indistinguishable.
       */
      const toggleState = (el: Element): string =>
        el.getAttribute('aria-checked')
        ?? el.getAttribute('aria-pressed')
        ?? String((el as HTMLInputElement).checked ?? '');

      const allToggles = queryAll(
        '[role="switch"], [role="checkbox"], input[type="checkbox"], [role="radio"], input[type="radio"]',
      )
        .filter(el => {
          if ((el as HTMLInputElement).disabled) return false;
          if (el.getAttribute('aria-disabled') === 'true') return false;
          /**
           * A zero-size control is not necessarily an absent one.
           *
           * Almost every design system renders a switch or checkbox as a
           * visually-hidden native `input` with a styled element painted over
           * it, so the real control measures 0×0 (or 1×1 under a clip rect)
           * while being perfectly operable. Filtering on its own box meant the
           * probe skipped every toggle on Mantine, MUI, Carbon and Chakra
           * alike — measured live: a panel with three working Switches
           * reported "0 controls exercised", which reads as "nothing to test"
           * and is the silence this probe exists to prevent.
           *
           * What actually matters is whether SOMETHING visible represents it,
           * so fall back to the nearest labelled/rendered ancestor before
           * concluding the control is not on the page.
           */
          const isRendered = (node: Element): boolean => {
            // `checkVisibility` has precisely the semantics wanted here: false
            // for display:none and visibility:hidden anywhere up the tree, true
            // for an element that is merely clipped to a pixel. Walking
            // ancestors for a non-zero box does NOT work — a display:none child
            // still sits inside a full-width parent.
            const anyNode = node as any;
            if (typeof anyNode.checkVisibility === 'function') {
              return anyNode.checkVisibility({ checkVisibilityCSS: true });
            }
            // Fallback for older engines: offsetParent is null for display:none.
            const box = node.getBoundingClientRect();
            return (node as HTMLElement).offsetParent !== null || box.width > 0 || box.height > 0;
          };
          if (!isRendered(el)) return false;
          return !DESTRUCTIVE.test(nameOf(el));
        });
      const toggles = allToggles.slice(0, opts.maxControls);
      result.controlsSkippedByCap = Math.max(0, allToggles.length - toggles.length);

      for (const el of toggles) {
        const before = toggleState(el);
        try { (el as HTMLElement).click(); } catch { continue; }
        await sleep(120);
        const after = toggleState(el);
        result.controlsTested++;

        if (before === after) {
          result.deadControls.push({
            label: nameOf(el),
            descriptor: `${el.tagName.toLowerCase()}${el.getAttribute('role') ? `[role=${el.getAttribute('role')}]` : ''}`,
            expected: before === ''
              ? 'no checked state at all — the control exposes neither aria-checked nor a checked property'
              : `aria-checked/checked to change from "${before}"`,
            ...attribute(el),
          });
        } else {
          // Put it back. The story may be screenshotted after this.
          try { (el as HTMLElement).click(); await sleep(60); } catch { /* best effort */ }
        }
      }

      /* ── 2. Overlays that push content instead of floating over it ───────── */

      /**
       * An overlay must not affect layout. Measure every sibling of the
       * trigger's container before and after opening: if any moved, the overlay
       * is in the document flow.
       *
       * Tolerance of 2px absorbs sub-pixel reflow and a focus ring; a real
       * in-flow menu displaces content by tens of pixels, so the signal is not
       * marginal.
       */
      const allTriggers = queryAll('[aria-haspopup], [aria-expanded]')
        .filter(el => {
          const r = el.getBoundingClientRect();
          if (r.width === 0 && r.height === 0) return false;
          if (el.getAttribute('aria-expanded') === 'true') return false;   // already open
          if ((el as HTMLButtonElement).disabled) return false;
          return !DESTRUCTIVE.test(nameOf(el));
        });
      const triggers = allTriggers.slice(0, opts.maxOverlays);
      result.overlaysSkippedByCap = Math.max(0, allTriggers.length - triggers.length);

      for (const el of triggers) {
        // Watch everything outside the trigger's own subtree.
        const others = queryAll('*')
          .filter(n => !el.contains(n) && !n.contains(el))
          .slice(0, 400);
        const before = others.map(n => {
          const r = n.getBoundingClientRect();
          return { n, top: r.top, left: r.left };
        });

        try { el.click(); } catch { continue; }
        await sleep(220);   // allow the overlay to mount and position
        result.overlaysTested++;

        let worst = 0;
        let moved = 0;
        for (const b of before) {
          const r = b.n.getBoundingClientRect();
          const d = Math.max(Math.abs(r.top - b.top), Math.abs(r.left - b.left));
          if (d > 2) { moved++; worst = Math.max(worst, d); }
        }

        if (moved > 0) {
          result.flowBreakingOverlays.push({
            label: nameOf(el),
            descriptor: `${el.tagName.toLowerCase()}[aria-haspopup]`,
            shiftedBy: Math.round(worst),
            siblingsMoved: moved,
            ...attribute(el),
          });
        }

        // Close it again: Escape first, then the trigger.
        try {
          el.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
          await sleep(80);
          if (el.getAttribute('aria-expanded') === 'true') { el.click(); await sleep(80); }
        } catch { /* best effort */ }
      }

      return result;
    },
    { ...options, maxControls, maxOverlays },
  );
}
