/**
 * Read-only source of the active story.
 *
 * The preview is the product, but the file is what the user takes away — and
 * until now the only way to see it was to leave the workspace and open the
 * file in an editor. Copy and Download are the two things people do with it.
 *
 * No highlighter: the story is short, monospace is enough, and a highlighter
 * is another dependency the consuming project would have to carry.
 */

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Button, Flex, Text } from '@radix-ui/themes';

interface CodeViewProps {
  code: string | null;
  /** The story's file name, used for the download and shown in the bar. */
  fileName?: string;
  loading?: boolean;
}

export const CodeView: React.FC<CodeViewProps> = ({ code, fileName, loading = false }) => {
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

  const lines = useMemo(() => (code == null ? [] : code.replace(/\n$/, '').split('\n')), [code]);

  return (
    <div className="suiw-code" role="region" aria-label="Story source">
      <Flex align="center" gap="3" px="3" py="2" style={{ borderBottom: '1px solid var(--gray-a5)', flex: '0 0 auto' }}>
        <Text size="1" color="gray" className="suiw-ellipsis">
          {fileName || 'Story source'}
          {code != null && ` · ${lines.length} line${lines.length === 1 ? '' : 's'}`}
        </Text>
        <Flex flexGrow="1" />
        <Button size="1" variant="soft" color="gray" onClick={copy} disabled={code == null}>
          {copied === 'ok' ? 'Copied' : copied === 'failed' ? 'Copy failed' : 'Copy'}
        </Button>
        <Button size="1" variant="soft" color="gray" onClick={download} disabled={code == null}>
          Download
        </Button>
      </Flex>

      {code == null ? (
        <Flex align="center" justify="center" flexGrow="1">
          <Text size="2" color="gray">
            {loading ? 'Reading the story file…' : 'No source to show for this story.'}
          </Text>
        </Flex>
      ) : (
        <pre tabIndex={0}>
          <code>
            {lines.map((line, i) => (
              <span key={i} className="suiw-code-line" data-line={i + 1}>
                {line}
                {'\n'}
              </span>
            ))}
          </code>
        </pre>
      )}
    </div>
  );
};

export default CodeView;
