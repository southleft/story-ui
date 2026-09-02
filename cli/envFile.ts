/**
 * The `.env` init writes and check reads.
 *
 * Init used to skip `.env` entirely when one existed — so the API key a
 * person had just typed at the prompt went nowhere, silently, and `--force`
 * made no difference. Merging is line-based: the provider's key line and
 * the port line are replaced when present, appended when not, and every
 * other line is left byte-for-byte as it was.
 */

/** Values that are not an API key: placeholders, serialised nothings, or too short to be one. */
const PLACEHOLDER_RE = /^(your[-_].*|.*[-_]key[-_]here|api[-_]key[-_]here|undefined|null|none|changeme|xxx+|\.\.\.|<.*>)$/i;

/** A value a person could have pasted from a provider dashboard, as opposed to init's placeholder. */
export function isUsableApiKey(value: string | undefined | null): boolean {
  if (value === undefined || value === null) return false;
  const v = String(value).trim().replace(/^["']|["']$/g, '');
  if (v.length < 20) return false;
  if (PLACEHOLDER_RE.test(v)) return false;
  return true;
}

/** KEY=value pairs from .env text; quotes stripped, comments and blanks skipped. */
export function parseEnv(content: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const line of content.split('\n')) {
    const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/);
    if (m) out[m[1]] = m[2].replace(/^["']|["']$/g, '');
  }
  return out;
}

export interface EnvEntry {
  key: string;
  value: string;
  /** Lines written above the entry when it is appended (no `#` needed). */
  comment?: string;
  /**
   * Replace an existing line only when its value is a placeholder (default:
   * replace whenever the line exists). Used for the API key when init has
   * none to write: a real key already in the file must survive.
   */
  onlyIfPlaceholder?: boolean;
}

export interface EnvMergeResult {
  content: string;
  /** Keys whose line was replaced. */
  replaced: string[];
  /** Keys that were appended. */
  appended: string[];
  /** Keys left as they were: present, and `onlyIfPlaceholder` withheld the write. */
  kept: string[];
}

const lineFor = (key: string): RegExp => new RegExp(`^\\s*(?:export\\s+)?${key}\\s*=`);

/**
 * `.env` text with `entries` applied. `null` for `existing` means the file
 * does not exist, and the result is the fresh file init always wrote.
 */
export function mergeEnv(existing: string | null, entries: EnvEntry[]): EnvMergeResult {
  const replaced: string[] = [];
  const appended: string[] = [];
  const kept: string[] = [];
  const lines = existing === null ? [] : existing.split('\n');
  const additions: string[] = [];

  for (const entry of entries) {
    const re = lineFor(entry.key);
    const idx = lines.findIndex((l) => re.test(l));
    if (idx >= 0) {
      const current = lines[idx].replace(re, '').trim().replace(/^["']|["']$/g, '');
      const placeholder = !current || PLACEHOLDER_RE.test(current) || (/API_KEY$/.test(entry.key) && !isUsableApiKey(current));
      if (entry.onlyIfPlaceholder && !placeholder) {
        kept.push(entry.key);
        continue;
      }
      if (current === entry.value) {
        kept.push(entry.key);
        continue;
      }
      lines[idx] = `${entry.key}=${entry.value}`;
      replaced.push(entry.key);
      continue;
    }
    if (entry.comment) {
      for (const c of entry.comment.split('\n')) additions.push(`# ${c}`);
    }
    additions.push(`${entry.key}=${entry.value}`);
    additions.push('');
    appended.push(entry.key);
  }

  let content: string;
  if (existing === null) {
    content = additions.join('\n');
  } else if (additions.length === 0) {
    content = lines.join('\n');
  } else {
    const body = lines.join('\n').replace(/\s*$/, '');
    content = (body ? body + '\n\n' : '') + additions.join('\n');
  }
  if (!content.endsWith('\n')) content += '\n';
  return { content, replaced, appended, kept };
}
