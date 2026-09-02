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
 *
 * The frame fills the stage at its real pixel size — no device widths, no
 * zoom. Both existed and neither earned the toolbar room: a story reviewed at
 * 390px is what Storybook's own viewport addon is for, and it is one click
 * away in the tab "Open in Storybook" opens.
 */

import React, { forwardRef, useEffect, useImperativeHandle, useRef, useState } from 'react';
import { Badge, Button, Callout, Flex, IconButton, SegmentedControl, Text, Tooltip } from '@radix-ui/themes';
import { attachElementPicker, describeElement, type ElementTarget } from './elementTargeting';
import { CodeView } from './CodeView';
import { DiffView } from './DiffView';
import { CursorIcon, MaximizeIcon, MinimizeIcon } from './icons';
import type { LiveCode } from './useGeneration';
import type { LineDiff } from './lineDiff';
import { useFrameRenderStatus } from './useFrameRenderStatus';
import { DEFAULT_REASON } from './renderFailure';

/** What the stage shows in place of the frame, when anything. */
export type CanvasView = 'preview' | 'code' | 'changes';

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
   * Changes segment is simply absent.
   */
  diff?: LineDiff | null;
  /** When set, the canvas shows this instead of any story. */
  failure?: PreviewFailure | null;
  /**
   * The last completion's verdict on the story in the frame: it did not
   * render, and this is why. The canvas also watches the frame itself (a
   * story that fails before verification runs, or where verification could
   * not run at all), and the frame's own outcome wins in both directions —
   * a document that is actually showing the story is never hidden.
   */
  renderFailure?: { reason: string | null } | null;
  /** Re-send the last request. Absent when there is nothing to re-send. */
  onRetryRender?: () => void;
  /**
   * The open story was deleted from another tab. Shown instead of
   * Storybook's own "Couldn't find story" page, with the way out.
   */
  deleted?: { title: string; onHome: () => void } | null;
  /**
   * The preview column fills the workspace. Owned by the workspace, which
   * owns the grid the rail sits in; the canvas only draws the toggle.
   */
  fullscreen?: boolean;
  onToggleFullscreen?: () => void;
  /**
   * The inspector, docked at the right edge of the stage while an element is
   * selected. Owned by the workspace (it knows the file and the selection);
   * the canvas only gives it the column. Hidden in fullscreen.
   */
  inspector?: React.ReactNode;
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
  renderFailure = null,
  onRetryRender,
  deleted = null,
  fullscreen = false,
  onToggleFullscreen,
  inspector = null,
}, ref) {
  const [picking, setPicking] = useState(false);
  const [view, setView] = useState<CanvasView>('preview');
  const frameRef = useRef<HTMLIFrameElement>(null);
  const lastSrc = useRef<string | null>(null);
  /** "Show anyway": the raw error page, for the person who wants the stack. */
  const [revealed, setRevealed] = useState(false);

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
   * Whether the story in the frame actually rendered. Storybook draws its
   * own red error page inside the iframe for a module that will not load
   * and for a story that throws; the canvas used to present that page as
   * the result. Watched from here because the frame is same-origin.
   */
  const live = useFrameRenderStatus(frameRef, { active: !!src, storyId, reloadToken });

  // A new document — another story, a reload — is not the one the user
  // asked to see anyway.
  useEffect(() => { setRevealed(false); }, [src, reloadToken]);

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

  /**
   * Escape closes the inspector from INSIDE the preview too.
   *
   * A pick ends with the click inside the iframe, so that is where keyboard
   * focus is when the user reaches for Esc — and a key pressed in the
   * preview document never reaches the workspace's window. Same-origin, so
   * the listener goes on the document itself, re-attached per navigation.
   * Clearing the selection is what closes the inspector.
   */
  useEffect(() => {
    if (!hasSelection || !onSelectElement) return;
    const frame = frameRef.current;
    if (!frame) return;
    let detach: (() => void) | null = null;
    const attach = () => {
      detach?.();
      detach = null;
      try {
        const doc = frame.contentDocument;
        if (!doc) return;
        const onKey = (e: KeyboardEvent) => {
          if (e.key !== 'Escape' || e.defaultPrevented) return;
          e.preventDefault();
          onSelectElement(null);
        };
        doc.addEventListener('keydown', onKey);
        detach = () => doc.removeEventListener('keydown', onKey);
      } catch {
        // Cross-origin: the workspace's own listener still covers the rail.
      }
    };
    attach();
    frame.addEventListener('load', attach);
    return () => {
      frame.removeEventListener('load', attach);
      detach?.();
    };
  }, [hasSelection, onSelectElement]);

  // A rebuild replaces the document; leaving the picker armed across it would
  // attach to a document that no longer exists.
  useEffect(() => { if (busy) setPicking(false); }, [busy]);

  // Picking needs the frame on screen.
  useEffect(() => { if (view !== 'preview') setPicking(false); }, [view]);

  // The diff went away under the Changes view (New, another story opened,
  // a version restored): back to the preview rather than an empty pane.
  useEffect(() => { if (view === 'changes' && !diff) setView('preview'); }, [view, diff]);

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
  //
  // `render-failed` is the story that is on disk and indexed but does not
  // render: the frame's own verdict, or the completion's when the frame has
  // not contradicted it by rendering. Behind Code and Changes, which the
  // user chose, and cleared by "Show anyway".
  const renderFailed =
    !!src && !revealed && (
      live.status === 'failed' ||
      (renderFailure != null && live.status !== 'ok')
    );
  const renderFailedReason =
    live.status === 'failed' && live.reason ? live.reason : (renderFailure?.reason || DEFAULT_REASON);

  const overlay: 'failure' | 'deleted' | 'code' | 'changes' | 'render-failed' | 'writing' | null =
    failure ? 'failure'
      : deleted ? 'deleted'
      : view === 'code' ? 'code'
        : view === 'changes' && diff ? 'changes'
          : renderFailed ? 'render-failed'
            : writing && !src ? 'writing'
              : null;
  const frameHidden = overlay !== null;
  /** What the Code view shows: the stream while it runs, the file otherwise. */
  const shownCode = writing ? liveCode!.text : code;
  const codeAvailable = shownCode != null || codeLoading;

  /** What the segmented control reads as selected. */
  const segment: CanvasView =
    overlay === 'code' || overlay === 'writing' ? 'code'
      : overlay === 'changes' ? 'changes'
        : 'preview';

  return (
    <div className="suiw-canvas">
      <Flex align="center" gap="3" px="3" className="suiw-toolbar">
        {/* Preview | Code | Changes. Code is present whenever the source is
            known — including a story Storybook has not indexed, and while
            it is still being written — and Changes only when there is
            something to compare against. While the stream IS the stage (a
            first story, nothing else to show) the control is held on Code:
            there is no preview to go back to yet. */}
        <SegmentedControl.Root
          size="1"
          value={segment}
          onValueChange={v => setView(v as CanvasView)}
          disabled={overlay === 'writing' || overlay === 'failure' || overlay === 'deleted'}
          aria-label="Canvas view"
        >
          <SegmentedControl.Item value="preview">Preview</SegmentedControl.Item>
          {codeAvailable && <SegmentedControl.Item value="code">Code</SegmentedControl.Item>}
          {diff && <SegmentedControl.Item value="changes">Changes</SegmentedControl.Item>}
        </SegmentedControl.Root>

        <Flex flexGrow="1" minWidth="0" justify="center">
          {/* An update writing over a preview that stays put: the count is
              the only sign the file is moving. The code view's own bar
              carries the same figure, so it is not repeated there. */}
          {streaming && src && overlay !== 'code' && (
            <Text size="1" color="gray" className="suiw-ellipsis suiw-writing" aria-live="polite">
              <span className="suiw-pulse">Writing changes…</span>
              {' '}{liveCode!.text.length.toLocaleString()} characters
            </Text>
          )}
        </Flex>

        {onSelectElement && (
          <Tooltip content={picking ? 'Click an element in the preview (Esc to cancel)' : 'Point at an element to change just that element'}>
            <Button
              size="1"
              variant={picking ? 'solid' : hasSelection ? 'soft' : 'ghost'}
              color={picking || hasSelection ? undefined : 'gray'}
              highContrast={picking}
              disabled={!storyId || busy || frameHidden}
              aria-pressed={picking}
              onClick={() => {
                if (picking) { setPicking(false); return; }
                // Starting a new pick clears the old one, so the chip in the
                // composer never disagrees with what is highlighted.
                onSelectElement(null);
                setPicking(true);
              }}
            >
              <CursorIcon />
              Select
            </Button>
          </Tooltip>
        )}

        {historySlot}

        {/* Works with no manager addon at all: it only moves the rail out of
            the way. Storybook's own sidebar is the header toggle's job. */}
        {onToggleFullscreen && (
          <Tooltip content={fullscreen ? 'Bring the conversation back' : 'Give the preview the whole workspace'}>
            <IconButton
              size="1"
              variant={fullscreen ? 'soft' : 'ghost'}
              color="gray"
              onClick={onToggleFullscreen}
              aria-pressed={fullscreen}
              aria-label={fullscreen ? 'Exit fullscreen' : 'Fullscreen'}
            >
              {fullscreen ? <MinimizeIcon /> : <MaximizeIcon />}
            </IconButton>
          </Tooltip>
        )}
      </Flex>

      <div className="suiw-canvas-body">
      {/* `--fit` only when a frame is actually on screen: it swaps the stage's
          `place-items: center` for `stretch`, which is right for a full-bleed
          frame and wrong for every placeholder state. */}
      <div className={`suiw-stage${src && !frameHidden ? ' suiw-stage--fit' : ''}`}>
        {src && (
          <div
            className={`suiw-frame${busy ? ' suiw-frame--stale' : ''}${frameHidden ? ' suiw-frame--hidden' : ''}`}
            aria-hidden={frameHidden || undefined}
          >
            {/* Real pixel size: the story sees the width it is shown at, so
                its media queries are honest. */}
            <iframe ref={frameRef} title={title || 'Generated story preview'} />
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
        ) : overlay === 'deleted' && deleted ? (
          // Deleted in another tab. The cached list opened it anyway, and
          // Storybook's "Couldn't find story" page was the only clue.
          <Flex direction="column" align="center" gap="3" className="suiw-render-failed" role="status">
            <Flex direction="column" align="center" gap="1">
              <Text size="3" weight="medium">This story was deleted</Text>
              <Text as="div" size="1" color="gray" align="center">
                {deleted.title ? `"${deleted.title}" was removed from this project in another tab.` : 'It was removed from this project in another tab.'}
              </Text>
            </Flex>
            <Button size="1" variant="soft" color="gray" onClick={deleted.onHome}>
              Back to Home
            </Button>
          </Flex>
        ) : overlay === 'code' ? (
          <CodeView code={shownCode} fileName={codeFileName} loading={codeLoading && !writing} streaming={streaming} />
        ) : overlay === 'changes' && diff ? (
          <DiffView diff={diff} code={code} fileName={codeFileName} />
        ) : overlay === 'render-failed' ? (
          // The story is on disk and Storybook indexed it, and it does not
          // render. Storybook's red error page used to be shown here as if
          // it were the result; the reason is one line, and the page itself
          // is one click away for whoever wants the stack.
          <Flex direction="column" align="center" gap="3" className="suiw-render-failed" role="status" aria-live="polite">
            <Flex direction="column" align="center" gap="1">
              <Text size="3" weight="medium">This story does not render</Text>
              <Text as="div" size="1" color="gray" align="center" className="suiw-render-failed-reason">
                {renderFailedReason}
              </Text>
            </Flex>
            <Flex gap="3" align="center">
              {onRetryRender && (
                <Button size="1" variant="soft" onClick={onRetryRender} disabled={busy}>
                  Retry
                </Button>
              )}
              <Button size="1" variant="ghost" color="gray" onClick={() => setRevealed(true)}>
                Show anyway
              </Button>
            </Flex>
          </Flex>
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

      {inspector && !fullscreen && (
        <aside className="suiw-inspector" aria-label="Inspector">
          {inspector}
        </aside>
      )}
      </div>
    </div>
  );
});

export default PreviewCanvas;
