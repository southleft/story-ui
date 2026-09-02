/**
 * What the last update did to the story, as an inline diff.
 *
 * The assistant says "Updated the table" and the preview changes — but which
 * lines, and was it the two the request asked for or a rewrite of the whole
 * file? The hunks answer that at a glance: removed lines in red, added in
 * green, the rest muted context, each hunk headed with its line numbers.
 *
 * The bar's Copy and Download act on the CURRENT file, never the diff.
 */

import React from 'react';
import { Flex, Text } from '@radix-ui/themes';
import { CodeActions } from './CodeView';
import { hunkHeader, summarizeDiff, type LineDiff } from './lineDiff';

interface DiffViewProps {
  diff: LineDiff;
  /** The current file, for the actions in the bar. */
  code: string | null;
  fileName?: string;
}

const SIGN = { add: '+', del: '−', context: ' ' } as const;

export const DiffView: React.FC<DiffViewProps> = ({ diff, code, fileName }) => (
  <div className="suiw-diff" role="region" aria-label="Changes from the last update">
    <Flex align="center" gap="3" px="3" py="2" style={{ borderBottom: '1px solid var(--gray-a5)', flex: '0 0 auto' }}>
      <Text size="1" color="gray" className="suiw-ellipsis">
        {fileName ? `${fileName} · ` : ''}
        <span className="suiw-diff-summary">{summarizeDiff(diff)}</span>
      </Text>
      <Flex flexGrow="1" />
      <CodeActions code={code} fileName={fileName} />
    </Flex>

    {diff.hunks.length === 0 ? (
      <Flex align="center" justify="center" flexGrow="1">
        <Text size="2" color="gray">The new version is identical to the previous one.</Text>
      </Flex>
    ) : (
      <div className="suiw-diff-body" tabIndex={0}>
        {diff.hunks.map((hunk, i) => (
          <React.Fragment key={i}>
            <div className="suiw-diff-hunk" role="separator" aria-label={hunkHeader(hunk, i)}>
              {hunkHeader(hunk, i)}
            </div>
            {hunk.lines.map((line, j) => (
              <div key={j} className={`suiw-diff-line suiw-diff-line--${line.kind}`}>
                <span className="suiw-diff-no" aria-hidden="true">{line.oldNo ?? ''}</span>
                <span className="suiw-diff-no" aria-hidden="true">{line.newNo ?? ''}</span>
                <span className="suiw-diff-sign" aria-label={line.kind === 'add' ? 'added' : line.kind === 'del' ? 'removed' : undefined}>
                  {SIGN[line.kind]}
                </span>
                <span className="suiw-diff-text">{line.text || ' '}</span>
              </div>
            ))}
          </React.Fragment>
        ))}
      </div>
    )}
  </div>
);

export default DiffView;
