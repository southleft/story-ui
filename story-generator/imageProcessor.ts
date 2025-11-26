/**
 * Image Processing Module for StoryUI Vision Feature
 *
 * This module handles all image processing operations including:
 * - Validation of image inputs (size, format, data integrity)
 * - Conversion between different image formats (URL, base64, buffer)
 * - Media type detection from magic bytes and file extensions
 * - Preparation of images for LLM provider consumption
 *
 * Supports: PNG, JPEG, GIF, WebP formats
 * Max size: 20MB for base64 encoded images
 */

import { logger } from './logger.js';
import { ImageContent } from './llm-providers/types.js';

// Maximum image size in bytes (20MB)
const MAX_IMAGE_SIZE_BYTES = 20 * 1024 * 1024;

// Size warning threshold (5MB)
const SIZE_WARNING_THRESHOLD = 5 * 1024 * 1024;

// Supported MIME types
const SUPPORTED_MEDIA_TYPES = [
  'image/png',
  'image/jpeg',
  'image/jpg',
  'image/gif',
  'image/webp',
] as const;

type SupportedMediaType = typeof SUPPORTED_MEDIA_TYPES[number];

// Magic bytes for image format detection
const MAGIC_BYTES: Record<string, { bytes: number[]; type: SupportedMediaType }> = {
  png: { bytes: [0x89, 0x50, 0x4e, 0x47], type: 'image/png' },
  jpeg: { bytes: [0xff, 0xd8, 0xff], type: 'image/jpeg' },
  gif87a: { bytes: [0x47, 0x49, 0x46, 0x38, 0x37, 0x61], type: 'image/gif' },
  gif89a: { bytes: [0x47, 0x49, 0x46, 0x38, 0x39, 0x61], type: 'image/gif' },
  webp: { bytes: [0x52, 0x49, 0x46, 0x46], type: 'image/webp' }, // RIFF header (WebP also has WEBP at offset 8)
};

// File extension to MIME type mapping
const EXTENSION_TO_MIME: Record<string, SupportedMediaType> = {
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  gif: 'image/gif',
  webp: 'image/webp',
};

/**
 * Image Input Interface
 * Accepts images from API requests in various formats
 */
export interface ImageInput {
  data?: string;      // base64 encoded image data (with or without data URI prefix)
  url?: string;       // URL to fetch image from
  mediaType?: string; // MIME type like 'image/png', 'image/jpeg'
  name?: string;      // Optional filename for logging/debugging
}

/**
 * Image Validation Result
 */
export interface ImageValidationResult {
  valid: boolean;
  error?: string;
  warning?: string;
}

/**
 * Processed Image Result
 * Internal type used during processing before final ImageContent conversion
 */
interface ProcessedImage {
  data: string;           // base64 encoded data (without data URI prefix)
  mediaType: SupportedMediaType;
  name?: string;
}

/**
 * Get media type from buffer by checking magic bytes
 *
 * @param buffer - Image buffer to analyze
 * @returns Detected MIME type or undefined if not recognized
 */
export function getMediaTypeFromBuffer(buffer: Buffer): SupportedMediaType | undefined {
  // Check each magic byte signature
  for (const [format, { bytes, type }] of Object.entries(MAGIC_BYTES)) {
    if (buffer.length < bytes.length) continue;

    // Compare the first N bytes
    const matches = bytes.every((byte, index) => buffer[index] === byte);

    if (matches) {
      // Special case for WebP: verify WEBP signature at offset 8
      if (format === 'webp') {
        if (buffer.length < 12) continue;
        const webpSignature = buffer.slice(8, 12).toString('ascii');
        if (webpSignature === 'WEBP') {
          logger.debug(`Detected image format from magic bytes: ${type}`);
          return type;
        }
        continue;
      }

      logger.debug(`Detected image format from magic bytes: ${type}`);
      return type;
    }
  }

  logger.warn('Unable to detect image format from magic bytes');
  return undefined;
}

/**
 * Get media type from URL file extension
 *
 * @param url - URL to extract extension from
 * @returns MIME type or undefined if not recognized
 */
function getMediaTypeFromUrl(url: string): SupportedMediaType | undefined {
  try {
    const urlObj = new URL(url);
    const pathname = urlObj.pathname.toLowerCase();
    const extension = pathname.split('.').pop();

    if (extension && EXTENSION_TO_MIME[extension]) {
      const mediaType = EXTENSION_TO_MIME[extension];
      logger.debug(`Detected media type from URL extension: ${mediaType}`);
      return mediaType;
    }
  } catch (error) {
    logger.warn(`Failed to parse URL for media type detection: ${url}`);
  }

  return undefined;
}

/**
 * Normalize base64 data by removing data URI prefix if present
 *
 * @param data - Base64 string (with or without data URI prefix)
 * @returns Pure base64 string without prefix
 */
function normalizeBase64(data: string): string {
  // Remove data URI prefix if present (e.g., "data:image/png;base64,")
  const dataUriPattern = /^data:([^;]+);base64,/;
  const match = data.match(dataUriPattern);

  if (match) {
    logger.debug(`Removing data URI prefix: ${match[1]}`);
    return data.replace(dataUriPattern, '');
  }

  return data;
}

/**
 * Extract media type from data URI prefix if present
 *
 * @param data - Base64 string that may contain data URI prefix
 * @returns Media type from prefix or undefined
 */
function extractMediaTypeFromDataUri(data: string): SupportedMediaType | undefined {
  const dataUriPattern = /^data:([^;]+);base64,/;
  const match = data.match(dataUriPattern);

  if (match) {
    const mediaType = match[1].toLowerCase();
    if (SUPPORTED_MEDIA_TYPES.includes(mediaType as SupportedMediaType)) {
      logger.debug(`Extracted media type from data URI: ${mediaType}`);
      return mediaType as SupportedMediaType;
    }
  }

  return undefined;
}

/**
 * Validate an image input
 *
 * Checks:
 * - Has either data or url
 * - File size is within limits
 * - Media type is supported
 * - Base64 data is valid
 *
 * @param image - Image input to validate
 * @returns Validation result with error/warning messages
 */
export function validateImage(image: ImageInput): ImageValidationResult {
  const name = image.name || 'unknown';

  // Check that either data or url is provided
  if (!image.data && !image.url) {
    return {
      valid: false,
      error: `Image "${name}" must have either 'data' or 'url' property`,
    };
  }

  // Both data and url provided - prefer data
  if (image.data && image.url) {
    logger.warn(`Image "${name}" has both data and url, will use data`);
  }

  // Validate media type if provided
  if (image.mediaType) {
    const mediaType = image.mediaType.toLowerCase();
    if (!SUPPORTED_MEDIA_TYPES.includes(mediaType as SupportedMediaType)) {
      return {
        valid: false,
        error: `Unsupported media type "${mediaType}". Supported types: ${SUPPORTED_MEDIA_TYPES.join(', ')}`,
      };
    }
  }

  // Validate base64 data if provided
  if (image.data) {
    try {
      const normalizedData = normalizeBase64(image.data);

      // Check if valid base64
      const base64Pattern = /^[A-Za-z0-9+/]*={0,2}$/;
      if (!base64Pattern.test(normalizedData)) {
        return {
          valid: false,
          error: `Invalid base64 data for image "${name}"`,
        };
      }

      // Calculate decoded size
      const padding = (normalizedData.match(/=/g) || []).length;
      const sizeBytes = (normalizedData.length * 3 / 4) - padding;

      logger.debug(`Image "${name}" size: ${(sizeBytes / 1024 / 1024).toFixed(2)}MB`);

      // Check size limits
      if (sizeBytes > MAX_IMAGE_SIZE_BYTES) {
        return {
          valid: false,
          error: `Image "${name}" exceeds maximum size of ${MAX_IMAGE_SIZE_BYTES / 1024 / 1024}MB (size: ${(sizeBytes / 1024 / 1024).toFixed(2)}MB)`,
        };
      }

      // Warn about large images
      if (sizeBytes > SIZE_WARNING_THRESHOLD) {
        return {
          valid: true,
          warning: `Image "${name}" is large (${(sizeBytes / 1024 / 1024).toFixed(2)}MB). Consider optimizing for better performance.`,
        };
      }

    } catch (error) {
      return {
        valid: false,
        error: `Failed to validate base64 data for image "${name}": ${error instanceof Error ? error.message : String(error)}`,
      };
    }
  }

  // If URL is provided and no data, we can't validate size until fetch
  if (image.url && !image.data) {
    try {
      // Basic URL validation
      new URL(image.url);
    } catch (error) {
      return {
        valid: false,
        error: `Invalid URL for image "${name}": ${image.url}`,
      };
    }
  }

  return { valid: true };
}

/**
 * Fetch an image from a URL and convert to base64
 *
 * @param url - URL to fetch image from
 * @returns Object containing base64 data and detected media type
 * @throws Error if fetch fails or image is invalid
 */
export async function fetchImageAsBase64(url: string): Promise<{ data: string; mediaType: SupportedMediaType }> {
  logger.info(`Fetching image from URL: ${url}`);

  try {
    const response = await fetch(url);

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }

    // Get content type from response headers
    const contentType = response.headers.get('content-type')?.toLowerCase();
    logger.debug(`Response content-type: ${contentType}`);

    // Get the image buffer
    const arrayBuffer = await response.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);

    // Check size
    if (buffer.length > MAX_IMAGE_SIZE_BYTES) {
      throw new Error(`Image exceeds maximum size of ${MAX_IMAGE_SIZE_BYTES / 1024 / 1024}MB (size: ${(buffer.length / 1024 / 1024).toFixed(2)}MB)`);
    }

    // Detect media type (priority: magic bytes > content-type header > URL extension)
    let mediaType = getMediaTypeFromBuffer(buffer);

    if (!mediaType && contentType && SUPPORTED_MEDIA_TYPES.includes(contentType as SupportedMediaType)) {
      mediaType = contentType as SupportedMediaType;
      logger.debug(`Using media type from content-type header: ${mediaType}`);
    }

    if (!mediaType) {
      mediaType = getMediaTypeFromUrl(url);
    }

    if (!mediaType) {
      throw new Error('Unable to determine image media type from URL, headers, or content');
    }

    // Convert to base64
    const base64Data = buffer.toString('base64');
    logger.info(`Successfully fetched and encoded image: ${(buffer.length / 1024).toFixed(2)}KB, type: ${mediaType}`);

    return {
      data: base64Data,
      mediaType,
    };

  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    logger.error(`Failed to fetch image from URL ${url}: ${errorMessage}`);
    throw new Error(`Failed to fetch image: ${errorMessage}`);
  }
}

/**
 * Process a single image input into the internal ProcessedImage format
 *
 * @param image - Image input to process
 * @returns Processed image with validated data and media type
 * @throws Error if processing fails
 */
async function processSingleImage(image: ImageInput): Promise<ProcessedImage> {
  const name = image.name || 'unknown';
  logger.debug(`Processing image: ${name}`);

  // Validate image first
  const validation = validateImage(image);
  if (!validation.valid) {
    throw new Error(validation.error || 'Image validation failed');
  }

  // Log warnings
  if (validation.warning) {
    logger.warn(validation.warning);
  }

  let data: string;
  let mediaType: SupportedMediaType | undefined;

  // Process based on input type
  if (image.data) {
    // Extract media type from data URI if present
    mediaType = extractMediaTypeFromDataUri(image.data);

    // Normalize base64 data (remove data URI prefix)
    data = normalizeBase64(image.data);

    // If no media type from data URI, try to detect from base64 data
    if (!mediaType) {
      const buffer = Buffer.from(data, 'base64');
      mediaType = getMediaTypeFromBuffer(buffer);
    }

    // Use provided media type as fallback
    if (!mediaType && image.mediaType) {
      const providedType = image.mediaType.toLowerCase();
      if (SUPPORTED_MEDIA_TYPES.includes(providedType as SupportedMediaType)) {
        mediaType = providedType as SupportedMediaType;
        logger.debug(`Using provided media type: ${mediaType}`);
      }
    }

    if (!mediaType) {
      throw new Error(`Unable to determine media type for image "${name}". Please provide mediaType property.`);
    }

  } else if (image.url) {
    // Fetch image from URL
    const fetched = await fetchImageAsBase64(image.url);
    data = fetched.data;
    mediaType = fetched.mediaType;

    // Override with provided media type if specified
    if (image.mediaType) {
      const providedType = image.mediaType.toLowerCase();
      if (SUPPORTED_MEDIA_TYPES.includes(providedType as SupportedMediaType)) {
        logger.debug(`Overriding detected media type ${mediaType} with provided type ${providedType}`);
        mediaType = providedType as SupportedMediaType;
      }
    }

  } else {
    throw new Error(`Image "${name}" must have either 'data' or 'url' property`);
  }

  logger.info(`Successfully processed image "${name}": ${mediaType}`);

  return {
    data,
    mediaType,
    name: image.name,
  };
}

/**
 * Convert processed images to ImageContent format for LLM providers
 *
 * @param processed - Array of processed images
 * @returns Array of ImageContent objects ready for LLM consumption
 */
function convertToImageContent(processed: ProcessedImage[]): ImageContent[] {
  return processed.map(img => ({
    type: 'image' as const,
    source: {
      type: 'base64' as const,
      mediaType: img.mediaType,
      data: img.data,
    },
  }));
}

/**
 * Process multiple image inputs and convert to ImageContent format
 *
 * This is the main entry point for image processing. It:
 * 1. Validates each image input
 * 2. Fetches URL images and converts to base64
 * 3. Detects media types from magic bytes, headers, or extensions
 * 4. Returns array of ImageContent objects ready for LLM providers
 *
 * @param images - Array of image inputs to process
 * @returns Promise resolving to array of ImageContent objects
 * @throws Error if any image fails to process
 */
export async function processImageInputs(images: ImageInput[]): Promise<ImageContent[]> {
  if (!images || images.length === 0) {
    logger.debug('No images to process');
    return [];
  }

  logger.info(`Processing ${images.length} image(s)`);

  try {
    // Process all images (can be done in parallel for better performance)
    const processed = await Promise.all(
      images.map((img, index) => {
        // Add index to name for better error messages if name not provided
        const imageWithName = {
          ...img,
          name: img.name || `image-${index + 1}`,
        };
        return processSingleImage(imageWithName);
      })
    );

    // Convert to ImageContent format
    const imageContents = convertToImageContent(processed);

    logger.info(`Successfully processed ${imageContents.length} image(s)`);
    return imageContents;

  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    logger.error(`Failed to process images: ${errorMessage}`);
    throw new Error(`Image processing failed: ${errorMessage}`);
  }
}
