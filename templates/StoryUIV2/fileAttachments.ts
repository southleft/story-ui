/**
 * Document attachments for the composer, beside the image pipeline.
 *
 * Images already have a pipeline (imageAttachments.ts) that downscales and
 * re-encodes for the vision model. Documents are simpler: text-like files
 * are read as text, PDFs as base64, and both travel on the generate request
 * as `files: [{ name, mediaType, data }]`. Classification is by extension
 * first and MIME type second — browsers report `''` for .md and .csv on some
 * platforms, and `text/plain` for nearly anything else.
 *
 * The pure parts (classification, limits, byte formatting) are here so they
 * can be tested without a DOM; only the readers touch FileReader.
 */

export type FileKind = 'image' | 'text' | 'pdf';

export interface AttachedDocument {
  id: string;
  name: string;
  kind: 'text' | 'pdf';
  mediaType: string;
  /** Bytes on disk, for the chip. */
  size: number;
  /** The text itself for text-like files; raw base64 (no data: prefix) for PDFs. */
  data: string;
}

/** What the generate request carries per document. */
export interface FilePayload {
  name: string;
  mediaType: string;
  data: string;
}

export const MAX_TEXT_BYTES = 200 * 1024;
export const MAX_PDF_BYTES = 10 * 1024 * 1024;

const IMAGE_EXT: Record<string, string> = {
  png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', webp: 'image/webp', gif: 'image/gif',
};
const TEXT_EXT: Record<string, string> = {
  md: 'text/markdown', markdown: 'text/markdown', txt: 'text/plain', csv: 'text/csv', json: 'application/json',
};
const IMAGE_MIME = new Set(Object.values(IMAGE_EXT));
const TEXT_MIME = new Set([...Object.values(TEXT_EXT), 'text/x-markdown']);

/** The `accept` attribute for the file picker: exactly what classifyFile admits. */
export const ACCEPT = [
  ...Object.values(IMAGE_EXT).filter((v, i, a) => a.indexOf(v) === i),
  '.png', '.jpg', '.jpeg', '.webp', '.gif',
  'application/pdf', '.pdf',
  'text/plain', 'text/markdown', 'text/csv', 'application/json',
  '.md', '.txt', '.csv', '.json',
].join(',');

const extensionOf = (name: string): string => {
  const i = name.lastIndexOf('.');
  return i >= 0 ? name.slice(i + 1).toLowerCase() : '';
};

/**
 * Which pipeline a file belongs to, or null when neither accepts it.
 * Extension is checked first: the browser's MIME guess is unreliable for
 * exactly the text formats this cares about.
 */
export function classifyFile(file: { name: string; type: string }): { kind: FileKind; mediaType: string } | null {
  const ext = extensionOf(file.name);
  if (ext in IMAGE_EXT) return { kind: 'image', mediaType: IMAGE_EXT[ext] };
  if (ext === 'pdf') return { kind: 'pdf', mediaType: 'application/pdf' };
  if (ext in TEXT_EXT) return { kind: 'text', mediaType: TEXT_EXT[ext] };
  const type = (file.type || '').toLowerCase();
  if (IMAGE_MIME.has(type)) return { kind: 'image', mediaType: type };
  if (type === 'application/pdf') return { kind: 'pdf', mediaType: type };
  if (TEXT_MIME.has(type)) return { kind: 'text', mediaType: type };
  return null;
}

/** "12 KB", "1.4 MB" — the chip has room for one number. */
export function formatBytes(n: number): string {
  if (!Number.isFinite(n) || n < 0) return '';
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${Math.round(n / 1024)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

/** The size ceiling for a kind, and the message when it is exceeded. */
export function sizeError(kind: 'text' | 'pdf', size: number, name: string): string | null {
  if (kind === 'pdf' && size > MAX_PDF_BYTES) return `${name}: larger than ${formatBytes(MAX_PDF_BYTES)}`;
  if (kind === 'text' && size > MAX_TEXT_BYTES) return `${name}: larger than ${formatBytes(MAX_TEXT_BYTES)}`;
  return null;
}

export const toPayload = (d: AttachedDocument): FilePayload => ({ name: d.name, mediaType: d.mediaType, data: d.data });

/** Split a file list into what each pipeline takes, and what neither does. */
export function partitionFiles<T extends { name: string; type: string }>(files: T[]): {
  images: T[]; documents: T[]; rejected: T[];
} {
  const images: T[] = [];
  const documents: T[] = [];
  const rejected: T[] = [];
  for (const f of files) {
    const c = classifyFile(f);
    if (!c) rejected.push(f);
    else if (c.kind === 'image') images.push(f);
    else documents.push(f);
  }
  return { images, documents, rejected };
}

const readText = (file: File): Promise<string> =>
  new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result ?? ''));
    r.onerror = () => reject(r.error ?? new Error('read failed'));
    r.readAsText(file);
  });

const readBase64 = (file: File): Promise<string> =>
  new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result ?? '').split(',')[1] ?? '');
    r.onerror = () => reject(r.error ?? new Error('read failed'));
    r.readAsDataURL(file);
  });

/**
 * Read documents client-side. Rejections are returned, never swallowed — a
 * file that silently vanishes from the composer reads as the tool losing it.
 */
export async function processDocumentFiles(files: File[]): Promise<{ documents: AttachedDocument[]; errors: string[] }> {
  const documents: AttachedDocument[] = [];
  const errors: string[] = [];
  for (const file of files) {
    const c = classifyFile(file);
    if (!c || c.kind === 'image') { errors.push(`${file.name}: not a supported file`); continue; }
    const tooBig = sizeError(c.kind, file.size, file.name);
    if (tooBig) { errors.push(tooBig); continue; }
    try {
      const data = c.kind === 'pdf' ? await readBase64(file) : await readText(file);
      documents.push({
        id: `${Date.now()}-${documents.length}-${Math.random().toString(36).slice(2, 6)}`,
        name: file.name,
        kind: c.kind,
        mediaType: c.mediaType,
        size: file.size,
        data,
      });
    } catch {
      errors.push(`${file.name}: could not be read`);
    }
  }
  return { documents, errors };
}
