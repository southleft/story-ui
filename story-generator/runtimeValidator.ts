/**
 * Runtime Validator for Story UI
 *
 * Validates that generated stories actually load and render in Storybook
 * by making HTTP requests to the running Storybook instance after HMR processes
 * the new story file.
 *
 * This catches runtime errors that static validation cannot detect, such as:
 * - "importers[path] is not a function" - Storybook CSF loader errors
 * - Module resolution failures
 * - Runtime component errors
 */

import { logger } from './logger.js';

export interface RuntimeValidationResult {
  success: boolean;
  storyExists: boolean;
  renderError?: string;
  errorType?: 'module_error' | 'render_error' | 'not_found' | 'timeout' | 'connection_error';
  details?: string;
}

export interface RuntimeValidatorConfig {
  storybookUrl: string;
  hmrWaitMs?: number;       // Time to wait for HMR to process (default: 3000)
  fetchTimeoutMs?: number;  // HTTP request timeout (default: 5000)
  retryAttempts?: number;   // Number of retries for index check (default: 3)
  retryDelayMs?: number;    // Delay between retries (default: 1000)
}

// Known Storybook runtime error patterns
const RUNTIME_ERROR_PATTERNS = [
  { pattern: /importers\[.*?\] is not a function/i, type: 'module_error' as const, description: 'CSF module loader error' },
  { pattern: /Cannot read propert.*of undefined/i, type: 'render_error' as const, description: 'Component render error' },
  { pattern: /is not defined/i, type: 'render_error' as const, description: 'Undefined variable error' },
  { pattern: /Module not found/i, type: 'module_error' as const, description: 'Module resolution error' },
  { pattern: /Failed to resolve import/i, type: 'module_error' as const, description: 'Import resolution error' },
  { pattern: /SyntaxError/i, type: 'module_error' as const, description: 'Runtime syntax error' },
  { pattern: /Unexpected token/i, type: 'module_error' as const, description: 'Parse error' },
  { pattern: /ReferenceError/i, type: 'render_error' as const, description: 'Reference error' },
  { pattern: /TypeError/i, type: 'render_error' as const, description: 'Type error' },
];

/**
 * Get the Storybook URL based on environment configuration
 */
export function getStorybookUrl(): string | null {
  // Priority 1: Explicit storybookUrl in environment
  if (process.env.STORYBOOK_URL) {
    return process.env.STORYBOOK_URL;
  }

  // Priority 2: Proxy mode - use internal Storybook port
  if (process.env.STORYBOOK_PROXY_ENABLED === 'true') {
    const proxyPort = process.env.STORYBOOK_PROXY_PORT || '6006';
    return `http://localhost:${proxyPort}`;
  }

  // Priority 3: Explicit Storybook port
  if (process.env.STORYBOOK_PORT) {
    return `http://localhost:${process.env.STORYBOOK_PORT}`;
  }

  // Priority 4: Default local Storybook
  return 'http://localhost:6006';
}

/**
 * Check if runtime validation is enabled
 */
export function isRuntimeValidationEnabled(): boolean {
  // Enabled by default if we can determine a Storybook URL
  // Can be explicitly disabled with STORYBOOK_RUNTIME_VALIDATION=false
  if (process.env.STORYBOOK_RUNTIME_VALIDATION === 'false') {
    return false;
  }

  // In proxy mode, always enable since we know Storybook is accessible
  if (process.env.STORYBOOK_PROXY_ENABLED === 'true') {
    return true;
  }

  // Otherwise, enable if explicitly set to true
  return process.env.STORYBOOK_RUNTIME_VALIDATION === 'true';
}

/**
 * Convert a story title to the Storybook story ID prefix format
 * e.g., "Simple Card" with prefix "Generated/" -> "generated-simple-card"
 * Note: This returns the prefix only, without the story export name
 */
export function titleToStoryIdPrefix(title: string, storyPrefix: string = 'Generated/'): string {
  // Remove prefix and convert to kebab case
  const fullTitle = storyPrefix + title;
  const kebabTitle = fullTitle
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
  return kebabTitle;
}

/**
 * Extract the actual title from generated story content
 * Looks for: title: 'Generated/Something' or title: "Generated/Something"
 */
export function extractTitleFromStory(storyContent: string): string | null {
  const titleMatch = storyContent.match(/title:\s*['"]([^'"]+)['"]/);
  if (titleMatch) {
    // Return the full title (including prefix like "Generated/")
    return titleMatch[1];
  }
  return null;
}

/**
 * Convert a full story title (like "Generated/Button Click Counter") to story ID prefix
 */
export function fullTitleToStoryIdPrefix(fullTitle: string): string {
  return fullTitle
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
}

/**
 * Sleep utility
 */
function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Fetch with timeout
 */
async function fetchWithTimeout(url: string, timeoutMs: number): Promise<Response> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(url, { signal: controller.signal });
    clearTimeout(timeoutId);
    return response;
  } catch (error: any) {
    clearTimeout(timeoutId);
    if (error.name === 'AbortError') {
      throw new Error(`Request timed out after ${timeoutMs}ms`);
    }
    throw error;
  }
}

/**
 * Check if stories exist in Storybook's index that match the given title prefix
 * Returns the first matching story ID for iframe validation
 */
async function checkStoryInIndex(
  storyIdPrefix: string,
  storybookUrl: string,
  config: RuntimeValidatorConfig
): Promise<{ exists: boolean; matchingStoryId?: string; error?: string }> {
  const indexUrl = `${storybookUrl}/index.json`;
  const timeout = config.fetchTimeoutMs || 5000;

  try {
    const response = await fetchWithTimeout(indexUrl, timeout);

    if (!response.ok) {
      return { exists: false, error: `Index returned ${response.status}` };
    }

    const index = await response.json();

    // Storybook 7+ uses 'entries', older versions use 'stories'
    const stories = index.entries || index.stories || {};

    // Find story IDs that match our prefix (not docs entries)
    const matchingIds = Object.keys(stories).filter(id => {
      // Skip docs entries - we want actual story entries
      if (id.endsWith('--docs')) return false;
      // Check if the ID starts with our prefix
      return id.startsWith(storyIdPrefix + '--');
    });

    if (matchingIds.length > 0) {
      return { exists: true, matchingStoryId: matchingIds[0] };
    }

    return { exists: false };
  } catch (error: any) {
    return { exists: false, error: error.message };
  }
}

/**
 * Check the story iframe for runtime errors
 */
async function checkStoryIframe(
  storyId: string,
  storybookUrl: string,
  config: RuntimeValidatorConfig
): Promise<{ success: boolean; error?: string; errorType?: RuntimeValidationResult['errorType'] }> {
  const iframeUrl = `${storybookUrl}/iframe.html?id=${storyId}&viewMode=story`;
  const timeout = config.fetchTimeoutMs || 5000;

  try {
    const response = await fetchWithTimeout(iframeUrl, timeout);

    if (!response.ok) {
      return {
        success: false,
        error: `Story iframe returned ${response.status}`,
        errorType: 'not_found'
      };
    }

    const html = await response.text();

    // Check for known error patterns in the HTML response
    for (const { pattern, type, description } of RUNTIME_ERROR_PATTERNS) {
      if (pattern.test(html)) {
        // Extract the actual error message if possible
        const match = html.match(/<pre[^>]*>([\s\S]*?)<\/pre>/i) ||
                      html.match(/Error:?\s*([^\n<]+)/i);
        const errorDetail = match ? match[1].trim().substring(0, 200) : description;

        return {
          success: false,
          error: errorDetail,
          errorType: type
        };
      }
    }

    // Check for Storybook error boundary markers
    // Note: We need to check for VISIBLE errors, not just the error display template
    // The 'sb-show-errordisplay' class is added to body when an error is actually shown
    // IMPORTANT: Must use regex to check for class attribute, not just includes()
    // because ':not(.sb-show-errordisplay)' exists in CSS selectors
    const hasVisibleError = /class="[^"]*sb-show-errordisplay[^"]*"/i.test(html);
    // Check for actual error content in the error display elements (non-empty)
    const hasErrorContent = /<h1[^>]*id="error-message"[^>]*>[^<]+<\/h1>/i.test(html) ||
                           /<code[^>]*id="error-stack"[^>]*>[^<]+<\/code>/i.test(html);
    // Check for specific error text (not in CSS context)
    const hasDocsError = />\s*DocsRenderer error/i.test(html);
    const hasStoryError = /class="[^"]*story-error[^"]*"/i.test(html);

    if (hasVisibleError || hasErrorContent || hasDocsError || hasStoryError) {
      // Try to extract the actual error message
      const errorMsgMatch = html.match(/<h1[^>]*id="error-message"[^>]*>([^<]+)<\/h1>/i);
      const errorDetail = errorMsgMatch ? errorMsgMatch[1].trim() : 'Storybook error boundary triggered';

      return {
        success: false,
        error: errorDetail,
        errorType: 'render_error'
      };
    }

    return { success: true };
  } catch (error: any) {
    if (error.message.includes('timed out')) {
      return { success: false, error: error.message, errorType: 'timeout' };
    }
    return { success: false, error: error.message, errorType: 'connection_error' };
  }
}

/**
 * Validate that a story loads and renders correctly in Storybook
 *
 * @param storyContent - The generated story content (used to extract the actual title)
 * @param fallbackTitle - Fallback title if extraction fails (e.g., "Simple Card")
 * @param storyPrefix - The story prefix from config (e.g., "Generated/")
 * @param customConfig - Runtime validator configuration
 * @returns Validation result with success status and any errors
 */
export async function validateStoryRuntime(
  storyContent: string,
  fallbackTitle: string,
  storyPrefix: string = 'Generated/',
  customConfig?: Partial<RuntimeValidatorConfig>
): Promise<RuntimeValidationResult> {
  // Check if runtime validation is enabled
  if (!isRuntimeValidationEnabled()) {
    logger.debug('Runtime validation disabled, skipping');
    return { success: true, storyExists: true };
  }

  const storybookUrl = getStorybookUrl();
  if (!storybookUrl) {
    logger.warn('Could not determine Storybook URL for runtime validation');
    return { success: true, storyExists: true, details: 'Storybook URL not configured' };
  }

  const config: RuntimeValidatorConfig = {
    storybookUrl,
    hmrWaitMs: 3000,
    fetchTimeoutMs: 5000,
    retryAttempts: 3,
    retryDelayMs: 1000,
    ...customConfig
  };

  // Extract the actual title from the story content, or use fallback
  const extractedTitle = extractTitleFromStory(storyContent);
  let storyIdPrefix: string;

  if (extractedTitle) {
    // Use the exact title from the generated code
    storyIdPrefix = fullTitleToStoryIdPrefix(extractedTitle);
    logger.debug(`Extracted title from story: "${extractedTitle}" -> prefix: "${storyIdPrefix}"`);
  } else {
    // Fall back to constructing from the provided title
    storyIdPrefix = titleToStoryIdPrefix(fallbackTitle, storyPrefix);
    logger.debug(`Using fallback title: "${fallbackTitle}" -> prefix: "${storyIdPrefix}"`);
  }

  logger.info(`Runtime validation: checking stories with prefix "${storyIdPrefix}" at ${storybookUrl}`);

  // Wait for HMR to process the new file
  logger.debug(`Waiting ${config.hmrWaitMs}ms for HMR to process...`);
  await sleep(config.hmrWaitMs!);

  // Step 1: Check if story appears in the index (with retries for HMR timing)
  let matchingStoryId: string | undefined;
  let lastIndexError: string | undefined;

  for (let attempt = 1; attempt <= config.retryAttempts!; attempt++) {
    const indexResult = await checkStoryInIndex(storyIdPrefix, storybookUrl, config);

    if (indexResult.exists && indexResult.matchingStoryId) {
      matchingStoryId = indexResult.matchingStoryId;
      logger.debug(`Found matching story: "${matchingStoryId}"`);
      break;
    }

    lastIndexError = indexResult.error;

    if (attempt < config.retryAttempts!) {
      logger.debug(`Story not found in index (attempt ${attempt}/${config.retryAttempts}), waiting...`);
      await sleep(config.retryDelayMs!);
    }
  }

  if (!matchingStoryId) {
    logger.warn(`Stories with prefix "${storyIdPrefix}" not found in Storybook index after ${config.retryAttempts} attempts`);
    return {
      success: false,
      storyExists: false,
      errorType: 'not_found',
      renderError: lastIndexError || 'Story not found in Storybook index - HMR may not have processed the file',
      details: `Story ID prefix: ${storyIdPrefix}`
    };
  }

  // Step 2: Load the story iframe and check for runtime errors
  const iframeResult = await checkStoryIframe(matchingStoryId, storybookUrl, config);

  if (!iframeResult.success) {
    logger.error(`Runtime error detected in story "${matchingStoryId}": ${iframeResult.error}`);
    return {
      success: false,
      storyExists: true,
      renderError: iframeResult.error,
      errorType: iframeResult.errorType,
      details: `Story ID: ${matchingStoryId}, URL: ${storybookUrl}/iframe.html?id=${matchingStoryId}`
    };
  }

  logger.info(`Runtime validation passed for story "${matchingStoryId}"`);
  return {
    success: true,
    storyExists: true
  };
}

/**
 * Format runtime validation errors for the self-healing prompt
 */
export function formatRuntimeErrorForHealing(result: RuntimeValidationResult): string {
  if (result.success) return '';

  const parts: string[] = [];

  parts.push(`RUNTIME ERROR: The generated story failed to load in Storybook.`);

  if (result.renderError) {
    parts.push(`Error: ${result.renderError}`);
  }

  if (result.errorType === 'module_error') {
    parts.push(`This is a module/import error. Common causes:`);
    parts.push(`- Invalid CSF (Component Story Format) structure`);
    parts.push(`- Missing or malformed default export (meta)`);
    parts.push(`- Story exports that conflict with Storybook internals`);
    parts.push(`- Invalid import statements`);
    parts.push(`\nEnsure the story follows this exact structure:`);
    parts.push(`\`\`\`tsx`);
    parts.push(`import type { Meta, StoryObj } from '@storybook/react';`);
    parts.push(`import { Component } from '@design-system/core';`);
    parts.push(``);
    parts.push(`const meta: Meta<typeof Component> = {`);
    parts.push(`  title: 'Generated/Story Title',`);
    parts.push(`  component: Component,`);
    parts.push(`};`);
    parts.push(``);
    parts.push(`export default meta;`);
    parts.push(`type Story = StoryObj<typeof meta>;`);
    parts.push(``);
    parts.push(`export const Default: Story = {`);
    parts.push(`  render: () => <Component />,`);
    parts.push(`};`);
    parts.push(`\`\`\``);
  } else if (result.errorType === 'render_error') {
    parts.push(`This is a component render error. Common causes:`);
    parts.push(`- Using undefined variables or components`);
    parts.push(`- Invalid props passed to components`);
    parts.push(`- Missing required props`);
    parts.push(`- Incorrect component composition`);
  } else if (result.errorType === 'not_found') {
    parts.push(`The story was not found in Storybook's index. This usually means:`);
    parts.push(`- The file has syntax errors that prevent Storybook from parsing it`);
    parts.push(`- The story title/path doesn't match expected format`);
    parts.push(`- The default export is missing or invalid`);
  }

  if (result.details) {
    parts.push(`\nDetails: ${result.details}`);
  }

  return parts.join('\n');
}
