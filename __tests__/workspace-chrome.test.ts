/**
 * The pure pieces behind the V2 chrome: the assistant markdown subset, the
 * verification-reason cleaner, and document classification for the composer.
 */
import { describe, it, expect } from 'vitest';
import { parseInline, parseMarkdownLite } from '../templates/StoryUIV2/markdownLite.js';
import { cleanNotice, NOTICE_MAX } from '../templates/StoryUIV2/notice.js';
import {
  ACCEPT,
  classifyFile,
  formatBytes,
  partitionFiles,
  sizeError,
  MAX_PDF_BYTES,
  MAX_TEXT_BYTES,
} from '../templates/StoryUIV2/fileAttachments.js';

describe('markdownLite', () => {
  it('splits paragraphs on blank lines and keeps single line breaks inside one', () => {
    const blocks = parseMarkdownLite('First line\nstill first\n\nSecond');
    expect(blocks).toEqual([
      { kind: 'paragraph', inlines: [{ kind: 'text', text: 'First line\nstill first' }] },
      { kind: 'paragraph', inlines: [{ kind: 'text', text: 'Second' }] },
    ]);
  });

  it('renders bold and inline code, with code winning over bold', () => {
    expect(parseInline('Use **the** `Button` and `**not** bold`')).toEqual([
      { kind: 'text', text: 'Use ' },
      { kind: 'bold', text: 'the' },
      { kind: 'text', text: ' ' },
      { kind: 'code', text: 'Button' },
      { kind: 'text', text: ' and ' },
      { kind: 'code', text: '**not** bold' },
    ]);
  });

  it('collects "- " lines into one list and ends a paragraph before it', () => {
    const blocks = parseMarkdownLite('I did:\n- one `A`\n- **two**\n* three\n\nDone.');
    expect(blocks).toHaveLength(3);
    expect(blocks[0]).toEqual({ kind: 'paragraph', inlines: [{ kind: 'text', text: 'I did:' }] });
    expect(blocks[1]).toEqual({
      kind: 'list',
      items: [
        [{ kind: 'text', text: 'one ' }, { kind: 'code', text: 'A' }],
        [{ kind: 'bold', text: 'two' }],
        [{ kind: 'text', text: 'three' }],
      ],
    });
    expect(blocks[2]).toEqual({ kind: 'paragraph', inlines: [{ kind: 'text', text: 'Done.' }] });
  });

  it('leaves everything else as text', () => {
    const blocks = parseMarkdownLite('# Not a heading\n1. not a list\n[not](a link)');
    expect(blocks).toEqual([
      { kind: 'paragraph', inlines: [{ kind: 'text', text: '# Not a heading\n1. not a list\n[not](a link)' }] },
    ]);
  });

  it('does not treat unbalanced or empty markers as markup', () => {
    expect(parseInline('a ** b ** c')).toEqual([{ kind: 'text', text: 'a ** b ** c' }]);
    expect(parseInline('a `` b')).toEqual([{ kind: 'text', text: 'a `` b' }]);
    expect(parseInline('****')).toEqual([{ kind: 'text', text: '****' }]);
  });

  it('handles CRLF and an empty string', () => {
    expect(parseMarkdownLite('a\r\n\r\nb')).toHaveLength(2);
    expect(parseMarkdownLite('')).toEqual([]);
  });
});

describe('cleanNotice', () => {
  it('keeps a short reason as it is', () => {
    expect(cleanNotice('Playwright is not installed.')).toBe('Playwright is not installed.');
  });

  it('drops everything from the first box-drawing banner onward', () => {
    const raw = 'Verification skipped ╔══════╗\n║ Looks like Playwright ║\n╚══════╝';
    expect(cleanNotice(raw)).toBe('Verification skipped');
  });

  it('drops everything from the first line break onward', () => {
    expect(cleanNotice('Storybook was unreachable\n    at fetch (node:internal)\n    at run')).toBe('Storybook was unreachable');
  });

  it('strips stray box-drawing characters and collapses whitespace', () => {
    expect(cleanNotice('│ Browser  ─ not   available │')).toBe('Browser not available');
  });

  it('clips at the limit on a word boundary with an ellipsis', () => {
    const long = Array.from({ length: 60 }, (_, i) => `word${i}`).join(' ');
    const out = cleanNotice(long);
    expect(out.length).toBeLessThanOrEqual(NOTICE_MAX);
    expect(out.endsWith('…')).toBe(true);
    // Never cut mid-word: everything before the ellipsis is a whole token.
    expect(out.slice(0, -1).split(' ').every(w => /^word\d+$/.test(w))).toBe(true);
  });

  it('returns an empty string for nothing', () => {
    expect(cleanNotice(undefined)).toBe('');
    expect(cleanNotice(null)).toBe('');
    expect(cleanNotice('   \n')).toBe('');
  });
});

describe('fileAttachments', () => {
  it('classifies images, documents and PDFs by extension first', () => {
    expect(classifyFile({ name: 'shot.PNG', type: '' })).toEqual({ kind: 'image', mediaType: 'image/png' });
    expect(classifyFile({ name: 'notes.md', type: '' })).toEqual({ kind: 'text', mediaType: 'text/markdown' });
    expect(classifyFile({ name: 'data.csv', type: 'application/vnd.ms-excel' })).toEqual({ kind: 'text', mediaType: 'text/csv' });
    expect(classifyFile({ name: 'spec.json', type: '' })).toEqual({ kind: 'text', mediaType: 'application/json' });
    expect(classifyFile({ name: 'brief.pdf', type: '' })).toEqual({ kind: 'pdf', mediaType: 'application/pdf' });
  });

  it('falls back to the MIME type when the extension says nothing', () => {
    expect(classifyFile({ name: 'clipboard', type: 'image/webp' })).toEqual({ kind: 'image', mediaType: 'image/webp' });
    expect(classifyFile({ name: 'paste', type: 'text/plain' })).toEqual({ kind: 'text', mediaType: 'text/plain' });
    expect(classifyFile({ name: 'doc', type: 'application/pdf' })).toEqual({ kind: 'pdf', mediaType: 'application/pdf' });
  });

  it('rejects what neither pipeline takes', () => {
    expect(classifyFile({ name: 'app.zip', type: 'application/zip' })).toBeNull();
    expect(classifyFile({ name: 'movie.mp4', type: 'video/mp4' })).toBeNull();
    expect(classifyFile({ name: 'sketch.svg', type: 'image/svg+xml' })).toBeNull();
    expect(classifyFile({ name: 'page.html', type: 'text/html' })).toBeNull();
  });

  it('partitions a drop into images, documents and rejects', () => {
    const { images, documents, rejected } = partitionFiles([
      { name: 'a.jpg', type: 'image/jpeg' },
      { name: 'b.txt', type: '' },
      { name: 'c.exe', type: '' },
    ]);
    expect(images.map(f => f.name)).toEqual(['a.jpg']);
    expect(documents.map(f => f.name)).toEqual(['b.txt']);
    expect(rejected.map(f => f.name)).toEqual(['c.exe']);
  });

  it('enforces the size caps per kind', () => {
    expect(sizeError('text', MAX_TEXT_BYTES, 'x.txt')).toBeNull();
    expect(sizeError('text', MAX_TEXT_BYTES + 1, 'x.txt')).toBe('x.txt: larger than 200 KB');
    expect(sizeError('pdf', MAX_PDF_BYTES, 'x.pdf')).toBeNull();
    expect(sizeError('pdf', MAX_PDF_BYTES + 1, 'x.pdf')).toBe('x.pdf: larger than 10.0 MB');
  });

  it('formats bytes for a chip', () => {
    expect(formatBytes(512)).toBe('512 B');
    expect(formatBytes(12 * 1024)).toBe('12 KB');
    expect(formatBytes(1.4 * 1024 * 1024)).toBe('1.4 MB');
  });

  it('accept lists images and every document type', () => {
    for (const token of ['image/png', 'image/jpeg', 'image/webp', 'image/gif', 'application/pdf', '.pdf', '.md', '.txt', '.csv', '.json']) {
      expect(ACCEPT.split(',')).toContain(token);
    }
  });
});
