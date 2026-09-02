/**
 * Preview canvas — the right pane.
 *
 * The whole reason Story UI can compete with v0 or Claude Design is that it does
 * not need to build a sandbox: Storybook is already running the user's real
 * design system, and the docs page is same-origin with it. So the canvas is
 * literally Storybook's own `/iframe.html`, showing the story that was just
 * written to disk, rendered by the project's own providers and theme.
 *
 * Nothing here simulates a preview. It IS the preview.
 */

import React, { forwardRef, useCallback, useEffect, useImperativeHandle, useMemo, useRef, useState } from 'react';
import { Badge, Button, Callout, DropdownMenu, Flex, Text } from '@radix-ui/themes';
import { attachElementPicker, describeElement, type ElementTarget } from './elementTargeting';
import { CodeView } from './CodeView';
import { DiffView } from './DiffView';
import type { LiveCode } from './useGeneration';
import type { LineDiff } from './lineDiff';

export type Viewport = 'fit' | 'desktop' | 'tablet' | 'mobile';

/** What the stage shows in place of the frame, when anything. */
export type CanvasView = 'preview' | 'code' | 'changes';

/**
 * `fit` uses the whole stage; the rest are real device widths.
 *
 * The canvas was pinned to a 1280px desktop frame that only ever scaled DOWN,
 * so on any wider stage the user got grid backdrop instead of preview and had
 * no way to reclaim it. The device widths are worth keeping — checking a
 * composition at 390px is exactly what they are for — but they are a
 * deliberate act, not a sensible default. Reviewing the work should use all
 * the room there is.
 *
 * Width 0 means "measure the stage"; see `spec` below.
 */
const VIEWPORTS: Record<Viewport, { w: number; h: number; label: string }> = {
  fit: { w: 0, h: 0, label: 'Fit' },
  desktop: { w: 1280, h: 900, label: 'Desktop' },
  tablet: { w: 834, h: 1000, label: 'Tablet' },
  mobile: { w: 390, h: 844, label: 'Mobile' },
};

/** A generation that ended without a working story. Shown instead of the frame. */
export interface PreviewFailure {
  message: string;
  notice?: string;
  onRetry: () => void;
  onEditPrompt: () => void;
}

interface PreviewCanvasProps {
  storyId?: string;
  title?: string;
  /** Bumped by the caller to force a reload after a regeneration. */
  reloadToken?: number;
  busy?: boolean;
  onOpenInStorybook?: () => void;
  onHandoff?: () => void;
  /**
   * False when there is no generated file to commit — e.g. a story opened from
   * Recent work. Disabled with a reason beats a button that does nothing.
   */
  canHandoff?: boolean;
  /** Set when the story was written but Storybook never indexed it. */
  notIndexed?: { fileName?: string; title?: string } | null;
  onRecheck?: () => void;
  /** Called when the user points at an element, or null when they cancel. */
  onSelectElement?: (target: ElementTarget | null) => void;
  /** True while an element is already selected, so the toggle reads correctly. */
  hasSelection?: boolean;
  /** Version history control, owned by the workspace which knows the file. */
  historySlot?: React.ReactNode;
  /** The active story's source, for the Code view. Null when unknown. */
  code?: string | null;
  codeFileName?: string;
  codeLoading?: boolean;
  /**
   * The story file as the model writes it, live-run only (null between runs
   * and before the first code delta). With no preview on screen it IS the
   * stage until the story is indexed; over a previous preview it is offered,
   * not imposed — a toolbar count, and the Code toggle to watch.
   */
  liveCode?: LiveCode | null;
  /**
   * What the last update changed. Null when there is nothing to compare —
   * a fresh story, or a session restored from the manifest — and then the
   * Changes toggle is simply absent.
   */
  diff?: LineDiff | null;
  /** When set, the canvas shows this instead of any story. */
  failure?: PreviewFailure | null;
  /**
   * The preview column fills the workspace. Owned by the workspace, which
   * owns the grid the rail sits in; the canvas only draws the toggle.
   */
  fullscreen?: boolean;
  onToggleFullscreen?: () => void;
}

/**
 * What the workspace can ask the canvas to do beyond rendering.
 *
 * The iframe lives here; the verification findings live in the thread. A
 * finding's "Select" has to reach the preview document, and this is the
 * narrowest door: give it a selector, get back the same target a click on
 * that element would have produced.
 */
export interface PreviewCanvasHandle {
  /** Null when nothing matches — the element is not on the page any more. */
  targetBySelector(selector: string): ElementTarget | null;
  /** Open the Changes view — the "Show changes" line under an assistant turn. */
  showChanges(): void;
}

export const PreviewCanvas = forwardRef<PreviewCanvasHandle, PreviewCanvasProps>(function PreviewCanvas({
  storyId,
  title,
  reloadToken = 0,
  busy = false,
  onOpenInStorybook,
  onHandoff,
  canHandoff = true,
  notIndexed,
  onRecheck,
  onSelectElement,
  hasSelection = false,
  historySlot,
  code = null,
  codeFileName,
  codeLoading = false,
  liveCode = null,
  diff = null,
  failure = null,
  fullscreen = false,
  onToggleFullscreen,
}, ref) {
  const [picking, setPicking] = useState(false);
  const [viewport, setViewport] = useState<Viewport>('fit');
  const [zoom, setZoom] = useState(1);
  const [view, setView] = useState<CanvasView>('preview');
  const [stageSize, setStageSize] = useState({ w: 0, h: 0 });
  const stageRef = useRef<HTMLDivElement>(null);
  const frameRef = useRef<HTMLIFrameElement>(null);
  const lastSrc = useRef<string | null>(null);

  useImperativeHandle(ref, () => ({
    targetBySelector(selector: string) {
      try {
        const doc = frameRef.current?.contentDocument;
        if (!doc?.body) return null;
        const el = doc.querySelector(selector);
        if (!el) return null;
        return describeElement(doc, el);
      } catch {
        // An invalid selector, or a cross-origin preview. Neither is "found".
        return null;
      }
    },
    showChanges() {
      setView('changes');
    },
  }), []);

  useEffect(() => {
    const el = stageRef.current;
    if (!el) return;
    const ro = new ResizeObserver(entries => {
      const box = entries[0]?.contentRect;
      if (box) setStageSize({ w: box.width, h: box.height });
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  /**
   * In `fit` the frame IS the stage: real pixel size, no scaling, so the story
   * sees the width it is actually being shown at and its media queries are
   * honest. Falls back to the desktop frame until the stage has been measured.
   */
  const spec = useMemo(() => {
    if (viewport !== 'fit') return VIEWPORTS[viewport];
    if (!stageSize.w || !stageSize.h) return VIEWPORTS.desktop;
    return { w: Math.round(stageSize.w), h: Math.round(stageSize.h), label: 'Fit' };
  }, [viewport, stageSize]);

  // Fit the chosen viewport inside the stage. Never scale UP — a 390px mobile
  // frame blown up to fill 1200px would misrepresent the design.
  const fitScale = useMemo(() => {
    // `fit` is already stage-sized; scaling it would shrink it away from the
    // edges it was just measured to fill.
    if (viewport === 'fit') return 1;
    if (!stageSize.w || !stageSize.h) return 1;
    const pad = 48;
    return Math.min(1, (stageSize.w - pad) / spec.w, (stageSize.h - pad) / spec.h);
  }, [stageSize, spec, viewport]);

  const scale = fitScale * zoom;
  const src = storyId ? `/iframe.html?id=${encodeURIComponent(storyId)}&viewMode=story` : undefined;

  // Navigate the SAME iframe rather than remounting it. Keying the frame on a
  // reload counter forced a cold Storybook boot per generation and made a
  // cross-fade impossible, because the old document dies before the new paints.
  useEffect(() => {
    const frame = frameRef.current;
    if (!frame || !src) return;
    if (lastSrc.current === src && reloadToken === 0) return;
    try {
      // location.replace keeps the workspace out of the iframe's history, so
      // Back never walks the user through old previews.
      if (frame.contentWindow) frame.contentWindow.location.replace(src);
      else frame.src = src;
    } catch {
      frame.src = src;
    }
    lastSrc.current = src;
  }, [src, reloadToken]);

  /**
   * Click-to-select, attached directly to the preview document.
   *
   * Possible because Storybook's iframe is same-origin with the workspace —
   * v0 and Lovable have to bridge a sandbox to do the same thing. Re-attached
   * on every navigation, since replacing the location swaps the document out
   * from under the listeners.
   */
  useEffect(() => {
    if (!picking) return;
    const frame = frameRef.current;
    if (!frame) return;

    let detach: (() => void) | null = null;
    const attach = () => {
      detach?.();
      detach = null;
      try {
        const doc = frame.contentDocument;
        if (!doc?.body) return;
        detach = attachElementPicker(doc, target => {
          onSelectElement?.(target);
          // One pick per activation: staying armed would swallow the next click
          // on a story the user is trying to actually use.
          setPicking(false);
        });
      } catch {
        // Cross-origin only happens if the preview is proxied from elsewhere;
        // selection is an enhancement, so fail quiet rather than break the pane.
        setPicking(false);
      }
    };

    attach();
    frame.addEventListener('load', attach);
    return () => {
      frame.removeEventListener('load', attach);
      detach?.();
    };
  }, [picking, onSelectElement]);

  /**
   * Escape leaves pick mode from anywhere in the workspace.
   *
   * The picker already handles Escape inside the preview document, but focus
   * is usually still in the composer when the user arms it and changes their
   * mind — and there the key did nothing.
   */
  useEffect(() => {
    if (!picking) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      e.preventDefault();
      setPicking(false);
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [picking]);

  // A rebuild replaces the document; leaving the picker armed across it would
  // attach to a document that no longer exists.
  useEffect(() => { if (busy) setPicking(false); }, [busy]);

  // Picking needs the frame on screen.
  useEffect(() => { if (view !== 'preview') setPicking(false); }, [view]);

  // The diff went away under the Changes view (New, another story opened,
  // a version restored): back to the preview rather than an empty pane.
  useEffect(() => { if (view === 'changes' && !diff) setView('preview'); }, [view, diff]);

  const cycleZoom = useCallback(() => {
    setZoom(z => (z >= 1 ? 0.5 : z >= 0.75 ? 1 : z + 0.25));
  }, []);

  /**
   * Code arriving from the model, for this run. `busy` gates it: the hook
   * clears the buffer between runs, but the completion's code and the
   * buffer's text are the same bytes by then anyway (see applyLiveCode).
   */
  const writing = busy && liveCode != null;
  const streaming = writing && !!liveCode?.streaming;

  // The frame stays mounted under the code view so switching back is
  // instant — unmounting it would cold-boot Storybook and lose the iframe's
  // navigation state, which the reload effect above does not repeat.
  //
  // `writing` is the stage only while there is NO preview to show: a story
  // being written for the first time. When a previous version is on screen
  // during an update, it stays — the user is iterating on it, and half a
  // file replacing a working composition is the wrong trade. Once the story
  // is indexed `src` appears and the stage returns to the frame by itself;
  // the user can toggle Code to keep reading.
  const overlay: 'failure' | 'code' | 'changes' | 'writing' | null =
    failure ? 'failure'
      : view === 'code' ? 'code'
        : view === 'changes' && diff ? 'changes'
          : writing && !src ? 'writing'
            : null;
  const frameHidden = overlay !== null;
  /** The viewport and zoom controls only mean something with a frame showing. */
  const frameControlsHeld = overlay === 'code' || overlay === 'changes' || overlay === 'writing';
  /** What the Code view shows: the stream while it runs, the file otherwise. */
  const shownCode = writing ? liveCode!.text : code;

  return (
    <div className="suiw-canvas">
      <Flex align="center" gap="3" px="3" py="2" style={{ borderBottom: '1px solid var(--gray-a5)' }}>
        {/* One quiet trigger instead of a four-way segmented row: the device
            widths are a deliberate act, not a default, so they can live a click
            away — and the toolbar stops fighting the right-side actions for
            room in a narrow pane. Styling matches the workspace's other
            compact pickers (soft gray, size 1). */}
        <DropdownMenu.Root>
          <DropdownMenu.Trigger>
            <Button size="1" variant="soft" color="gray" aria-label="Viewport" style={{ flexShrink: 0 }} disabled={frameControlsHeld}>
              {VIEWPORTS[viewport].label}
              <DropdownMenu.TriggerIcon />
            </Button>
          </DropdownMenu.Trigger>
          <DropdownMenu.Content size="1">
            <DropdownMenu.RadioGroup value={viewport} onValueChange={v => setViewport(v as Viewport)}>
              {(Object.keys(VIEWPORTS) as Viewport[]).map(v => (
                <DropdownMenu.RadioItem key={v} value={v}>
                  <Flex align="center" justify="between" gap="4" width="100%">
                    <Text size="1">{VIEWPORTS[v].label}</Text>
                    <Text size="1" color="gray">
                      {VIEWPORTS[v].w ? `${VIEWPORTS[v].w}` : 'auto'}
                    </Text>
                  </Flex>
                </DropdownMenu.RadioItem>
              ))}
            </DropdownMenu.RadioGroup>
          </DropdownMenu.Content>
        </DropdownMenu.Root>

        <Button size="1" variant="ghost" color="gray" onClick={cycleZoom} title="Zoom" style={{ flexShrink: 0 }} disabled={frameControlsHeld}>
          {Math.round(scale * 100)}%
        </Button>

        {/* Preview / Code. Code is available whenever the source is known,
            which includes a story Storybook has not indexed — reading the
            file is sometimes the only way to see what was built — and while
            it is still being written. While the stream IS the stage (a first
            story, nothing else to show) the toggle reads as pressed and
            held: there is no preview to go back to yet. */}
        <Button
          size="1"
          variant={overlay === 'code' || overlay === 'writing' ? 'soft' : 'ghost'}
          color={overlay === 'code' || overlay === 'writing' ? undefined : 'gray'}
          onClick={() => setView(v => (v === 'code' ? 'preview' : 'code'))}
          disabled={overlay === 'writing' || (shownCode == null && !codeLoading)}
          aria-pressed={overlay === 'code' || overlay === 'writing'}
          title={
            overlay === 'code' ? 'Back to the preview'
              : streaming ? 'Watch the story being written'
                : 'Show the story source'
          }
          style={{ flexShrink: 0 }}
        >
          {overlay === 'code' ? 'Preview' : 'Code'}
        </Button>

        {/* Only when there is something to compare against: a story just
            updated in this session. Absent, not disabled, for a fresh story
            or one restored from the manifest — there the button would never
            do anything. */}
        {diff && (
          <Button
            size="1"
            variant={overlay === 'changes' ? 'soft' : 'ghost'}
            color={overlay === 'changes' ? undefined : 'gray'}
            onClick={() => setView(v => (v === 'changes' ? 'preview' : 'changes'))}
            aria-pressed={overlay === 'changes'}
            title={overlay === 'changes' ? 'Back to the preview' : 'Show what the last update changed'}
            style={{ flexShrink: 0 }}
          >
            Changes
          </Button>
        )}

        <Flex flexGrow="1" minWidth="0" justify="center">
          {/* An update writing over a preview that stays put: the count is
              the only sign the file is moving. The code view's own bar
              carries the same figure, so it is not repeated there. */}
          {streaming && src && overlay !== 'code' ? (
            <Text size="1" color="gray" className="suiw-ellipsis suiw-writing" aria-live="polite">
              <span className="suiw-pulse">Writing changes…</span>
              {' '}{liveCode!.text.length.toLocaleString()} characters
            </Text>
          ) : title ? (
            <Text size="1" color="gray" className="suiw-ellipsis">{title}</Text>
          ) : null}
        </Flex>

        {onSelectElement && (
          <Button
            size="1"
            variant={picking ? 'solid' : hasSelection ? 'soft' : 'ghost'}
            color={picking || hasSelection ? undefined : 'gray'}
            highContrast={picking}
            disabled={!storyId || busy || frameHidden}
            onClick={() => {
              if (picking) { setPicking(false); return; }
              // Starting a new pick clears the old one, so the chip in the
              // composer never disagrees with what is highlighted.
              onSelectElement(null);
              setPicking(true);
            }}
            title="Point at an element to describe a change to just that element (Esc to cancel)"
          >
            {picking ? 'Click an element…' : hasSelection ? 'Selected' : 'Select'}
          </Button>
        )}

        {historySlot}

        {/* Works with no manager addon at all: it only moves the rail out of
            the way. Storybook's own sidebar is the Focus button's job. */}
        {onToggleFullscreen && (
          <Button
            size="1"
            variant={fullscreen ? 'soft' : 'ghost'}
            color="gray"
            onClick={onToggleFullscreen}
            aria-pressed={fullscreen}
            title={fullscreen ? 'Bring the conversation back' : 'Give the preview the whole workspace'}
          >
            {fullscreen ? 'Exit fullscreen' : 'Fullscreen'}
          </Button>
        )}

        <Button
          size="1"
          variant="ghost"
          color="gray"
          disabled={!storyId}
          onClick={onOpenInStorybook}
          title="Open this story in Storybook, in a new tab"
        >
          Open in Storybook
        </Button>
        {/* highContrast: solid-on-accent-9 measures 3.15:1 for this accent,
            under AA. See the Build button in Workspace.tsx. */}
        <Button
          size="1"
          highContrast
          disabled={!storyId || !canHandoff}
          onClick={onHandoff}
          title={
            !canHandoff
              ? 'Generate or update a story in this session to hand it off'
              : 'Commit this story to a new branch'
          }
        >
          Hand off
        </Button>
      </Flex>

      {/* `--fit` only when a frame is actually on screen: it swaps the stage's
          `place-items: center` for `stretch`, which is right for a full-bleed
          frame and wrong for every placeholder state — with the default
          viewport being `fit`, the Building/empty states were stretched and
          their content pinned to the top instead of dead-centre. */}
      <div className={`suiw-stage${viewport === 'fit' && src && !frameHidden ? ' suiw-stage--fit' : ''}`} ref={stageRef}>
        {src && (
          <div
            className={`suiw-frame${busy ? ' suiw-frame--stale' : ''}${frameHidden ? ' suiw-frame--hidden' : ''}`}
            style={{ width: spec.w * scale, height: spec.h * scale }}
            aria-hidden={frameHidden || undefined}
          >
            {/* Rendered at true viewport size and scaled down, so the story sees
                the media queries it would see at that width. Scaling the
                container instead would lie about breakpoints. */}
            <iframe
              ref={frameRef}
              title={title || 'Generated story preview'}
              style={{
                width: spec.w,
                height: spec.h,
                transform: `scale(${scale})`,
                transformOrigin: '0 0',
              }}
            />
          </div>
        )}

        {overlay === 'failure' && failure ? (
          // A failed generation writes a fallback error story so Storybook
          // stays consistent. The canvas used to load that story as if it
          // were the result — a red Storybook error page presented as "here
          // is what you asked for".
          <Callout.Root color="red" size="2" role="alert" style={{ maxWidth: 'min(560px, 100%)' }}>
            <Callout.Text>
              <Text weight="medium">That generation did not produce a working story</Text>
              {failure.message && <><br />{failure.message}</>}
              {failure.notice && <><br /><Text color="gray">{failure.notice}</Text></>}
            </Callout.Text>
            <Flex gap="2" mt="3">
              <Button size="1" variant="soft" color="red" onClick={failure.onRetry} disabled={busy}>
                Retry
              </Button>
              <Button size="1" variant="ghost" color="gray" onClick={failure.onEditPrompt}>
                Edit prompt
              </Button>
            </Flex>
          </Callout.Root>
        ) : overlay === 'code' ? (
          <CodeView code={shownCode} fileName={codeFileName} loading={codeLoading && !writing} streaming={streaming} />
        ) : overlay === 'changes' && diff ? (
          <DiffView diff={diff} code={code} fileName={codeFileName} />
        ) : overlay === 'writing' ? (
          // The story, arriving. Replaces the "Building" placeholder from the
          // first code delta; the frame takes over the moment the story is
          // indexed, and the Code toggle brings this back.
          <CodeView code={liveCode!.text} fileName={codeFileName} streaming={streaming} />
        ) : src ? null : busy ? (
          <Flex direction="column" align="center" gap="2">
            <Badge color="orange" variant="soft">
              <span className="suiw-pulse">Building</span>
            </Badge>
            <Text size="2" color="gray">
              It appears here as soon as the story is written and indexed.
            </Text>
          </Flex>
        ) : notIndexed ? (
          // The generation SUCCEEDED. Saying "nothing to preview" here read as
          // failure and sent the user hunting for a bug in the wrong place.
          <Callout.Root color="amber" size="1" style={{ maxWidth: 'min(520px, 100%)' }}>
            <Callout.Text>
              <Text weight="medium">Your story was created, but Storybook has not picked it up.</Text>
              <br />
              {notIndexed.fileName ? `${notIndexed.fileName} is on disk. ` : 'The file is on disk. '}
              Storybook&rsquo;s file watcher stops delivering events after a while, and when that
              happens new stories never enter its index. Restarting Storybook picks it up.
            </Callout.Text>
            {onRecheck && (
              <Flex mt="2">
                <Button size="1" variant="soft" color="amber" onClick={onRecheck}>
                  Check again
                </Button>
              </Flex>
            )}
          </Callout.Root>
        ) : (
          <Flex direction="column" align="center" gap="1" style={{ maxWidth: '44ch' }}>
            <Text size="2" color="gray">Nothing to preview yet</Text>
            <Text size="1" color="gray" align="center">
              Describe what you want on the left, and it renders here using your own components.
            </Text>
          </Flex>
        )}
      </div>
    </div>
  );
});

export default PreviewCanvas;
