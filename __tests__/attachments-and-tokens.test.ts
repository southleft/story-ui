import { describe, it, expect } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { checkTokenUsage, nearestToken } from '../story-generator/knowledge/tokenConformance';
import { processFileInputs, MAX_FILES } from '../story-generator/fileAttachments';
import { describeLaunchFailure } from '../story-generator/verify/verifyStory';
import { readDesignTokens, formatStylingGuidance } from '../story-generator/knowledge/stylingFacts';

const b64 = (s: string) => Buffer.from(s, 'utf8').toString('base64');

describe('token existence check', () => {
  const known = new Set(['cbds-font-weight-bold', 'cbds-font-size-1', 'cbds-color-fg-primary', 'cbds-space-4']);

  it('rejects a token the project does not declare and names the nearest real one', () => {
    const code = `const s = { fontWeight: 'var(--cbds-weight-bold)', color: 'var(--cbds-color-fg-primary)' };`;
    const v = checkTokenUsage(code, known);
    expect(v).toHaveLength(1);
    expect(v[0].name).toBe('cbds-weight-bold');
    expect(v[0].nearest).toBe('cbds-font-weight-bold');
    expect(v[0].message).toContain('did you mean --cbds-font-weight-bold');
  });

  it('offers no suggestion when nothing is close', () => {
    expect(nearestToken('zzzz-totally-unrelated-thing', known)).toBeUndefined();
    const v = checkTokenUsage(`padding: var(--zzzz-totally-unrelated-thing)`, known);
    expect(v[0].nearest).toBeUndefined();
    expect(v[0].message).toContain('not a design token');
  });

  it('accepts a property the story declares itself', () => {
    const code = `<div style={{ '--row-gap': '8px', gap: 'var(--row-gap)' }} />`;
    expect(checkTokenUsage(code, known)).toHaveLength(0);
  });

  it('is skipped, not passed, when the project declares no tokens', () => {
    expect(checkTokenUsage(`var(--anything)`, new Set())).toHaveLength(0);
  });

  it('reports each invented name once with the first line it appears on', () => {
    const code = `a: var(--nope);\nb: var(--nope);\nc: var(--cbds-space-4)`;
    const v = checkTokenUsage(code, known);
    expect(v).toHaveLength(1);
    expect(v[0].line).toBe(1);
  });
});

describe('design token values', () => {
  it('reads the declared value beside each name and prints it for scale tokens', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tokens-'));
    fs.mkdirSync(path.join(dir, 'src'), { recursive: true });
    fs.writeFileSync(path.join(dir, 'src', 'tokens.css'),
      `:root { --cbds-font-size-1: 72px; --cbds-font-size-9: 12px; --cbds-color-fg-primary: #111; --cbds-space-4: var(--cbds-space-base); }`);
    const groups = readDesignTokens(dir);
    const typography = groups.find(g => g.category === 'typography');
    expect(typography?.values?.['cbds-font-size-1']).toBe('72px');
    const guidance = formatStylingGuidance({ tokens: groups, idiom: { attributes: [], sampled: 0 }, sources: { tokens: 4, projectFiles: 1, packageFiles: 0 } } as any);
    expect(guidance).toContain('--cbds-font-size-1 (72px)');
    // A colour's hex adds nothing the name does not; a var() reference is not a value.
    expect(guidance).not.toContain('(#111)');
    expect(guidance).not.toContain('(var(--cbds-space-base))');
    expect(guidance).toContain('Only the tokens listed above exist');
  });
});

describe('file attachments', () => {
  it('inlines text-like files as fenced blocks and keeps PDFs as documents', () => {
    const out = processFileInputs([
      { name: 'spec.md', mediaType: 'text/markdown', data: b64('# Spec\n\nThree columns.') },
      { name: 'rows.csv', data: b64('id,name\n1,Ada') },
      { name: 'brief.pdf', mediaType: 'application/pdf', data: b64('%PDF-1.4 fake') },
    ]);
    expect(out.skipped).toEqual([]);
    expect(out.summary).toEqual({ text: 2, pdf: 1 });
    expect(out.blocks[0]).toMatchObject({ type: 'text' });
    expect((out.blocks[0] as any).text).toContain('Attached file "spec.md"');
    expect((out.blocks[0] as any).text).toContain('```md\n# Spec');
    expect((out.blocks[1] as any).text).toContain('```csv\nid,name');
    expect(out.blocks[2]).toMatchObject({ type: 'document', source: { mediaType: 'application/pdf', name: 'brief.pdf' } });
  });

  it('refuses what it cannot read, with a reason the user can act on', () => {
    const out = processFileInputs([
      { name: 'design.sketch', mediaType: 'application/octet-stream', data: b64('xx') },
      { name: 'empty.md', data: '' },
    ]);
    expect(out.blocks).toHaveLength(0);
    expect(out.skipped.map(s => s.name)).toEqual(['design.sketch', 'empty.md']);
    expect(out.skipped[0].reason).toContain('not a readable attachment');
  });

  it('caps the count and truncates oversized text instead of dropping it silently', () => {
    const many = Array.from({ length: MAX_FILES + 2 }, (_, i) => ({ name: `f${i}.txt`, data: b64('x') }));
    const out = processFileInputs(many);
    expect(out.blocks).toHaveLength(MAX_FILES);
    expect(out.skipped).toHaveLength(2);
    expect(out.skipped[0].reason).toContain(`more than ${MAX_FILES}`);

    const big = processFileInputs([{ name: 'big.txt', data: b64('y'.repeat(250_000)) }]);
    expect(big.blocks).toHaveLength(1);
    expect((big.blocks[0] as any).text).toContain('(truncated)');
    expect((big.blocks[0] as any).text.length).toBeLessThan(210_000);
  });
});

describe('browser launch failure message', () => {
  it('turns Playwright\'s boxed missing-browser paragraph into one line with the fix', () => {
    const raw = `browserType.launch: Executable doesn't exist at /Users/x/Library/Caches/ms-playwright/chromium_headless_shell-1187/chrome-headless-shell-mac-arm64/chrome-headless-shell
╔═════════════════════════════════════════════════════════════════════════╗
║ Looks like Playwright Test or Playwright was just installed or updated. ║
║ Please run the following command to download new browsers:             ║
║                                                                         ║
║     npx playwright install                                              ║
╚═════════════════════════════════════════════════════════════════════════╝`;
    expect(describeLaunchFailure(raw)).toBe('Playwright is installed but its browser is not. Run: npx playwright install chromium');
  });

  it('keeps only the first line of any other failure', () => {
    expect(describeLaunchFailure('spawn EACCES\n  at ChildProcess…\n  at …')).toBe('Browser could not launch: spawn EACCES');
  });
});

describe('attachment encoding contract', () => {
  it('reads text sent as text, base64 sent as base64, and guesses honestly when unlabelled', () => {
    const plain = "# Spec\n\na single green Button labelled 'Approve invoice' and nothing else";
    const asText = processFileInputs([{ name: 'spec.md', data: plain, encoding: 'text' }]);
    expect((asText.blocks[0] as any).text).toContain('Approve invoice');
    const asB64 = processFileInputs([{ name: 'spec.md', data: b64(plain), encoding: 'base64' }]);
    expect((asB64.blocks[0] as any).text).toContain('Approve invoice');
    // An older client that sends the text itself without saying so.
    const unlabelled = processFileInputs([{ name: 'spec.md', data: plain }]);
    expect((unlabelled.blocks[0] as any).text).toContain('Approve invoice');
    const unlabelledB64 = processFileInputs([{ name: 'spec.md', data: b64(plain) }]);
    expect((unlabelledB64.blocks[0] as any).text).toContain('Approve invoice');
  });
});

describe('story titles inside string literals', () => {
  it('drops quotes, backslashes and line breaks', async () => {
    const { sanitizeStoryTitle } = await import('../mcp-server/routes/generationCore');
    expect(sanitizeStoryTitle(`I'd be happy to help but I don't see an "attached" spec`)).toBe('Id be happy to help but I dont see an attached spec');
    expect(sanitizeStoryTitle('Line\none\\two')).toBe('Line onetwo');
    expect(sanitizeStoryTitle('   ')).toBe('Untitled');
  }, 30_000);
});
