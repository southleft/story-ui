/**
 * Read-only source of the active story.
 *
 * The preview is the product, but the file is what the user takes away — and
 * until now the only way to see it was to leave the workspace and open the
 * file in an editor. Copy and Download are the two things people do with it.
 *
 * No highlighter: the story is short, monospace is enough, and a highlighter
 * is another dependency the consuming project would have to carry.
 *
 * While the model is still writing the file, the same view shows it arriving
 * and follows the newest lines — until the reader scrolls up to look at
 * something, at which point following would yank it away from them.
 */

import React, { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { Button, Flex, Text } from '@radix-ui/themes';

/**
 * Copy and Download for a piece of code. Shared with the Changes view, which
 * shows a diff but must still hand over the CURRENT file — nobody wants a
 * download of the hunks.
 */
export const CodeActions: React.FC<{
  code: string | null;
  fileName?: string;
  /** Held while the code is still being written: half a file is not a deliverable. */
  disabled?: boolean;
}> = ({ code, fileName, disabled = false }) => {
  const [copied, setCopied] = useState<'ok' | 'failed' | null>(null);
  const copiedTimer = useRef<number | null>(null);

  useEffect(() => () => { if (copiedTimer.current) window.clearTimeout(copiedTimer.current); }, []);

  const flash = useCallback((state: 'ok' | 'failed') => {
    setCopied(state);
    if (copiedTimer.current) window.clearTimeout(copiedTimer.current);
    copiedTimer.current = window.setTimeout(() => setCopied(null), 1500);
  }, []);

  const copy = useCallback(async () => {
    if (code == null) return;
    try {
      await navigator.clipboard.writeText(code);
      flash('ok');
    } catch {
      flash('failed');
    }
  }, [code, flash]);

  const download = useCallback(() => {
    if (code == null) return;
    const blob = new Blob([code], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = fileName || 'story.stories.tsx';
    document.body.appendChild(a);
    a.click();
    a.remove();
    // Revoked on the next tick: revoking synchronously races the click in
    // some browsers and the download comes out empty.
    window.setTimeout(() => URL.revokeObjectURL(url), 0);
  }, [code, fileName]);

  const held = disabled || code == null;
  return (
    <>
      <Button size="1" variant="soft" color="gray" onClick={copy} disabled={held}>
        {copied === 'ok' ? 'Copied' : copied === 'failed' ? 'Copy failed' : 'Copy'}
      </Button>
      <Button size="1" variant="soft" color="gray" onClick={download} disabled={held}>
        Download
      </Button>
    </>
  );
};

interface CodeViewProps {
  code: string | null;
  /** The story's file name, used for the download and shown in the bar. */
  fileName?: string;
  loading?: boolean;
  /**
   * The file is still being written. The bar says so with a character count
   * instead of a line count, the actions are held, and the view follows the
   * newest lines until the reader scrolls up.
   */
  streaming?: boolean;
}

/** How close to the bottom counts as "still following", in pixels. */
const FOLLOW_SLACK = 8;

export const CodeView: React.FC<CodeViewProps> = ({ code, fileName, loading = false, streaming = false }) => {
  const preRef = useRef<HTMLPreElement>(null);
  /**
   * Whether the view is pinned to the tail. True at the start of a stream;
   * flips off when the reader scrolls up and back on when they return to the
   * bottom. A ref, not state: it changes on every scroll event and nothing
   * needs to re-render for it.
   */
  const followRef = useRef(true);

  useEffect(() => {
    if (streaming) followRef.current = true;
  }, [streaming]);

  // Layout effect so the tail is in place before paint — an effect would
  // show the un-scrolled frame first, and at ~7 frames a second that flickers.
  useLayoutEffect(() => {
    if (!streaming || !followRef.current) return;
    const pre = preRef.current;
    if (pre) pre.scrollTop = pre.scrollHeight;
  }, [code, streaming]);

  const onScroll = useCallback(() => {
    const pre = preRef.current;
    if (!pre) return;
    followRef.current = pre.scrollHeight - pre.scrollTop - pre.clientHeight <= FOLLOW_SLACK;
  }, []);

  const lines = useMemo(() => (code == null ? [] : code.replace(/\n$/, '').split('\n')), [code]);

  return (
    <div className="suiw-code" role="region" aria-label={streaming ? 'Story source, being written' : 'Story source'}>
      <Flex align="center" gap="3" px="3" py="2" style={{ borderBottom: '1px solid var(--gray-a5)', flex: '0 0 auto' }}>
        <Text size="1" color="gray" className="suiw-ellipsis" aria-live={streaming ? 'polite' : undefined}>
          {streaming ? (
            <>
              <span className="suiw-pulse">Writing {fileName || 'the story'}…</span>
              {' '}{(code?.length ?? 0).toLocaleString()} characters
            </>
          ) : (
            <>
              {fileName || 'Story source'}
              {code != null && ` · ${lines.length} line${lines.length === 1 ? '' : 's'}`}
            </>
          )}
        </Text>
        <Flex flexGrow="1" />
        <CodeActions code={code} fileName={fileName} disabled={streaming} />
      </Flex>

      {code == null ? (
        <Flex align="center" justify="center" flexGrow="1">
          <Text size="2" color="gray">
            {loading ? 'Reading the story file…' : 'No source to show for this story.'}
          </Text>
        </Flex>
      ) : (
        <pre tabIndex={0} ref={preRef} onScroll={onScroll}>
          <code>
            {lines.map((line, i) => (
              <span key={i} className="suiw-code-line" data-line={i + 1}>
                {line}
                {'\n'}
              </span>
            ))}
            {streaming && <span className="suiw-caret" aria-hidden="true" />}
          </code>
        </pre>
      )}
    </div>
  );
};

export default CodeView;
