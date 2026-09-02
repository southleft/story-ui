/**
 * One short, clean line out of a server-side reason.
 *
 * "Not verified" reasons used to arrive as whatever the check threw — a
 * Playwright banner in box-drawing characters, a stack trace, three
 * paragraphs of install instructions. The server is being changed to send a
 * sentence; this is the client's own guarantee that a sentence is all it
 * shows, whatever arrives.
 */

export const NOTICE_MAX = 160;

/** Box-drawing and block characters (U+2500–U+257F, U+2580–U+259F). */
const BOX_DRAWING = /[─-▟]/g;

export function cleanNotice(reason: string | null | undefined, max: number = NOTICE_MAX): string {
  if (!reason) return '';
  let s = String(reason);
  // Everything from the first banner or line break onward is decoration or
  // detail; the first line is the sentence.
  const cut = s.search(/[╔\n]/);
  if (cut >= 0) s = s.slice(0, cut);
  s = s.replace(BOX_DRAWING, '').replace(/\s+/g, ' ').trim();
  if (s.length > max) s = `${s.slice(0, max - 1).replace(/\s+\S*$/, '').trimEnd()}…`;
  return s;
}
