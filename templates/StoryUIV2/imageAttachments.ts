/**
 * Image attachments for the composer — client-side preparation only.
 *
 * Ported from the V1 panel rather than imported from it: only StoryUIV2 is
 * compiled into the package's dist/templates/StoryUIV2 export, so reaching
 * across template trees would break the published workspace.
 *
 * Everything here exists to hand the server bytes it will actually accept:
 * images are downscaled to the vision model's effective resolution ceiling and
 * re-encoded as JPEG past a size threshold, because sending the original file
 * is what produced 413s and provider rejections.
 */

export interface AttachedImage {
  id: string;
  name: string;
  /** Raw base64, no data: prefix — what the generate request carries. */
  base64: string;
  /** Must describe the bytes actually encoded, which after downscaling can
   *  differ from the original file's type — they must agree or the provider
   *  rejects the image. */
  mediaType: string;
  /** Small data-URL preview, shown in the composer and kept on the sent turn. */
  preview: string;
}

export const MAX_IMAGES = 4;
const MAX_IMAGE_SIZE_MB = 20;
const MAX_IMAGE_DIMENSION = 1568;
const JPEG_FALLBACK_BYTES = 1.5 * 1024 * 1024;
const JPEG_QUALITY = 0.85;
const THUMB_MAX_DIMENSION = 240;
const THUMB_QUALITY = 0.6;

const fileToBase64 = (file: File): Promise<string> => {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.readAsDataURL(file);
    reader.onload = () => {
      const result = reader.result as string;
      resolve(result.split(',')[1]);
    };
    reader.onerror = error => reject(error);
  });
};

// Decode a File into an <img> we can draw to a canvas.
const loadImageElement = (file: File): Promise<HTMLImageElement> =>
  new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => { URL.revokeObjectURL(url); resolve(img); };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('Could not decode image')); };
    img.src = url;
  });

/** Build a small, persistable data-URL preview of an attachment. */
const makeThumbnail = async (file: File): Promise<string | undefined> => {
  try {
    const img = await loadImageElement(file);
    const longEdge = Math.max(img.width, img.height);
    const scale = Math.min(1, THUMB_MAX_DIMENSION / longEdge);
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(img.width * scale));
    canvas.height = Math.max(1, Math.round(img.height * scale));
    const ctx = canvas.getContext('2d');
    if (!ctx) return undefined;
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
    return canvas.toDataURL('image/jpeg', THUMB_QUALITY);
  } catch {
    return undefined;
  }
};

/**
 * Prepare an attachment for upload: downscale to the vision model's effective
 * resolution ceiling and re-encode large images as JPEG.
 *
 * Returns raw base64 (no data: prefix) plus the media type that actually
 * matches the encoded bytes — these must agree or the provider rejects it.
 * Falls back to the original bytes if canvas encoding is unavailable.
 */
export const prepareImageForUpload = async (
  file: File
): Promise<{ base64: string; mediaType: string }> => {
  try {
    const img = await loadImageElement(file);
    const longEdge = Math.max(img.width, img.height);
    const scale = longEdge > MAX_IMAGE_DIMENSION ? MAX_IMAGE_DIMENSION / longEdge : 1;
    const needsResize = scale < 1;
    const needsRecompress = file.size > JPEG_FALLBACK_BYTES;

    if (!needsResize && !needsRecompress) {
      return { base64: await fileToBase64(file), mediaType: file.type || 'image/png' };
    }

    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(img.width * scale));
    canvas.height = Math.max(1, Math.round(img.height * scale));
    const ctx = canvas.getContext('2d');
    if (!ctx) {
      return { base64: await fileToBase64(file), mediaType: file.type || 'image/png' };
    }
    // White matte: JPEG has no alpha, and transparent screenshot regions
    // would otherwise composite to black.
    const asJpeg = needsRecompress || file.type === 'image/jpeg';
    if (asJpeg) {
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, canvas.width, canvas.height);
    }
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height);

    const mediaType = asJpeg ? 'image/jpeg' : 'image/png';
    const dataUrl = canvas.toDataURL(mediaType, asJpeg ? JPEG_QUALITY : undefined);
    const base64 = dataUrl.split(',')[1];
    if (!base64) {
      return { base64: await fileToBase64(file), mediaType: file.type || 'image/png' };
    }
    return { base64, mediaType };
  } catch {
    // Canvas path failed (tainted, decode error, headless) — send as-is.
    return { base64: await fileToBase64(file), mediaType: file.type || 'image/png' };
  }
};

export interface ProcessedImages {
  images: AttachedImage[];
  errors: string[];
}

/**
 * Turn dropped/selected/pasted files into attachments, up to `room` more.
 *
 * Rejections are returned, never swallowed: a file that silently vanishes
 * from the composer reads as the tool losing the user's design.
 */
export async function processImageFiles(files: File[], room: number): Promise<ProcessedImages> {
  const images: AttachedImage[] = [];
  const errors: string[] = [];
  for (const file of files) {
    if (images.length >= room) {
      errors.push(`Up to ${MAX_IMAGES} images per message — ${file.name} was not attached`);
      break;
    }
    if (!file.type.startsWith('image/')) {
      errors.push(`${file.name}: not an image file`);
      continue;
    }
    if (file.size > MAX_IMAGE_SIZE_MB * 1024 * 1024) {
      errors.push(`${file.name}: larger than ${MAX_IMAGE_SIZE_MB}MB`);
      continue;
    }
    try {
      const { base64, mediaType } = await prepareImageForUpload(file);
      const preview = (await makeThumbnail(file)) ?? `data:${mediaType};base64,${base64}`;
      images.push({
        id: `${Date.now()}-${images.length}-${Math.random().toString(36).slice(2, 6)}`,
        name: file.name,
        base64,
        mediaType,
        preview,
      });
    } catch {
      errors.push(`${file.name}: could not be processed`);
    }
  }
  return { images, errors };
}
