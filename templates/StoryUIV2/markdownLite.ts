/**
 * A deliberately small markdown subset for assistant replies.
 *
 * The model writes prose with a few habits: blank-line paragraphs, `code`
 * for component names, **bold** for emphasis, and "- " bullet lists when it
 * enumerates what it did. That is the whole grammar here. Headings, links,
 * tables, nested lists and numbered lists are NOT parsed — they render as the
 * text they are, which is the honest failure mode for a chat reply. A full
 * markdown library would be a dependency for four constructs.
 *
 * Pure — no React — so it can be tested in node.
 */

export type Inline =
  | { kind: 'text'; text: string }
  | { kind: 'bold'; text: string }
  | { kind: 'code'; text: string };

export type Block =
  | { kind: 'paragraph'; inlines: Inline[] }
  | { kind: 'list'; items: Inline[][] };

/**
 * Inline spans. Code wins over bold — a `**` inside backticks is code, not
 * emphasis — so backticks are split first and bold only inside text runs.
 */
export function parseInline(text: string): Inline[] {
  const out: Inline[] = [];
  const codeParts = text.split(/(`[^`\n]+`)/g);
  for (const part of codeParts) {
    if (!part) continue;
    if (part.length > 2 && part.startsWith('`') && part.endsWith('`')) {
      out.push({ kind: 'code', text: part.slice(1, -1) });
      continue;
    }
    // Like CommonMark, a delimiter run beside a space is not emphasis.
    const boldParts = part.split(/(\*\*(?=\S)[^*\n]+?(?<=\S)\*\*)/g);
    for (const b of boldParts) {
      if (!b) continue;
      if (b.length > 4 && b.startsWith('**') && b.endsWith('**')) {
        out.push({ kind: 'bold', text: b.slice(2, -2) });
      } else {
        out.push({ kind: 'text', text: b });
      }
    }
  }
  return out;
}

const BULLET = /^\s*[-*]\s+(.*)$/;

/**
 * Blocks. Paragraphs are separated by one or more blank lines; consecutive
 * bullet lines form one list, and a list also ends a paragraph without a
 * blank line between them (the model rarely leaves one).
 */
export function parseMarkdownLite(text: string): Block[] {
  const blocks: Block[] = [];
  const lines = text.replace(/\r\n?/g, '\n').split('\n');
  let para: string[] = [];
  let list: Inline[][] | null = null;

  const flushPara = () => {
    if (para.length) {
      blocks.push({ kind: 'paragraph', inlines: parseInline(para.join('\n')) });
      para = [];
    }
  };
  const flushList = () => {
    if (list && list.length) blocks.push({ kind: 'list', items: list });
    list = null;
  };

  for (const raw of lines) {
    const line = raw.replace(/\s+$/, '');
    if (!line.trim()) {
      flushPara();
      flushList();
      continue;
    }
    const m = BULLET.exec(line);
    if (m) {
      flushPara();
      if (!list) list = [];
      list.push(parseInline(m[1]));
      continue;
    }
    flushList();
    para.push(line);
  }
  flushPara();
  flushList();
  return blocks;
}
