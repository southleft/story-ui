/**
 * Renders the markdownLite block model. See markdownLite.ts for the grammar.
 */
import React from 'react';
import { parseMarkdownLite, type Inline } from './markdownLite';

const renderInlines = (inlines: Inline[]): React.ReactNode =>
  inlines.map((node, i) => {
    if (node.kind === 'code') return <code key={i} className="suiw-inline-code">{node.text}</code>;
    if (node.kind === 'bold') return <strong key={i}>{node.text}</strong>;
    return <React.Fragment key={i}>{node.text}</React.Fragment>;
  });

export const AssistantMarkdown: React.FC<{ text: string; className?: string }> = ({ text, className }) => {
  const blocks = parseMarkdownLite(text);
  return (
    <div className={`suiw-md${className ? ` ${className}` : ''}`}>
      {blocks.map((block, i) =>
        block.kind === 'list' ? (
          <ul key={i}>
            {block.items.map((item, j) => <li key={j}>{renderInlines(item)}</li>)}
          </ul>
        ) : (
          <p key={i}>{renderInlines(block.inlines)}</p>
        ),
      )}
    </div>
  );
};

export default AssistantMarkdown;
