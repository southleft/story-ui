/**
 * Watch a same-origin Storybook preview iframe and say whether the story in
 * it rendered, failed, or is still loading.
 *
 * Shared by the canvas and the Home thumbnails so the two can never disagree
 * about what "broken" looks like. The verdict itself is `readFrameStatus`
 * (pure, in renderFailure.ts); this hook only decides WHEN to look:
 *
 *  - every second from a navigation, until the story renders or a minute
 *    passes — a story that is still compiling is not a failure, so silence
 *    past the deadline stays neutral;
 *  - again from every `load` of the frame: a repair rewriting the file, or a
 *    Retry, replaces the document, and the old verdict is void the moment
 *    the new one starts loading;
 *  - and on, while a failure is showing, so the first successful render
 *    clears it without anyone having to click.
 *
 * Right after `location.replace` the frame still holds the PREVIOUS document,
 * which reports the previous story's outcome. A verdict is only read from a
 * document whose URL names the story we are waiting for.
 */

import { useEffect, useRef, useState, type RefObject } from 'react';
import { readFrameStatus, type FrameVerdict } from './renderFailure';

export const FRAME_POLL_MS = 1_000;
export const FRAME_POLL_TIMEOUT_MS = 60_000;

interface Options {
  /** False when there is no frame to watch; the verdict is then `unavailable`. */
  active: boolean;
  /** The story the frame is being pointed at. A change resets the verdict. */
  storyId?: string;
  /** Bumped by the owner to force a reload; re-arms the poll, keeps the verdict. */
  reloadToken?: number;
  timeoutMs?: number;
}

const IDLE: FrameVerdict = { status: 'unavailable' };
const LOADING: FrameVerdict = { status: 'loading' };

export function useFrameRenderStatus(
  frameRef: RefObject<HTMLIFrameElement | null>,
  { active, storyId, reloadToken = 0, timeoutMs = FRAME_POLL_TIMEOUT_MS }: Options,
): FrameVerdict {
  const [verdict, setVerdict] = useState<FrameVerdict>(IDLE);
  const lastStory = useRef<string | undefined>(undefined);

  useEffect(() => {
    if (!active || !storyId) {
      lastStory.current = undefined;
      setVerdict(IDLE);
      return;
    }
    // A different story: whatever the last one did says nothing about this
    // one. A reload of the same story keeps its verdict until the new
    // document says otherwise — flipping to "loading" would put the old
    // error page back on screen for the length of the reload.
    if (lastStory.current !== storyId) {
      lastStory.current = storyId;
      setVerdict(LOADING);
    }

    const frame = frameRef.current;
    if (!frame) return;

    let timer: number | null = null;
    let deadline = Date.now() + timeoutMs;

    const documentIsCurrent = (): boolean => {
      try {
        const href = frame.contentWindow?.location?.href ?? '';
        return href.includes(`id=${encodeURIComponent(storyId)}`) || href.includes(`id=${storyId}`);
      } catch {
        return false;
      }
    };

    const stop = () => {
      if (timer !== null) { window.clearInterval(timer); timer = null; }
    };

    const look = (): void => {
      if (!documentIsCurrent()) return;
      let doc: Document | null = null;
      try { doc = frame.contentDocument; } catch { doc = null; }
      const next = readFrameStatus(doc);
      if (next.status === 'ok') {
        setVerdict(next);
        stop();
        return;
      }
      if (next.status === 'failed') {
        // Keep looking: a repair or a Retry that lands renders into this
        // same frame, and the first `ok` clears the state.
        setVerdict(prev => (prev.status === 'failed' && prev.reason === next.reason ? prev : next));
        return;
      }
      // Loading (or unreadable): no verdict yet. Give up quietly after the
      // deadline unless a failure is on screen, which we keep watching.
      setVerdict(prev => (prev.status === 'failed' ? prev : prev.status === 'loading' ? prev : LOADING));
      if (Date.now() > deadline) {
        let showingFailure = false;
        setVerdict(prev => { showingFailure = prev.status === 'failed'; return prev; });
        if (!showingFailure) stop();
      }
    };

    const start = () => {
      stop();
      deadline = Date.now() + timeoutMs;
      timer = window.setInterval(look, FRAME_POLL_MS);
      look();
    };

    // A new document. Its state at `load` is authoritative even when that is
    // "preparing": the previous verdict belonged to a document that is gone.
    const onLoad = () => {
      if (!documentIsCurrent()) return;
      let doc: Document | null = null;
      try { doc = frame.contentDocument; } catch { doc = null; }
      const now = readFrameStatus(doc);
      if (now.status === 'ok' || now.status === 'failed') setVerdict(now);
      else setVerdict(prev => (prev.status === 'failed' ? prev : LOADING));
      start();
    };

    frame.addEventListener('load', onLoad);
    start();
    return () => {
      frame.removeEventListener('load', onLoad);
      stop();
    };
  }, [active, storyId, reloadToken, timeoutMs, frameRef]);

  return verdict;
}
