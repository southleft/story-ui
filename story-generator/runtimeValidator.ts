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
  errorType?: 'module_error' | 'render_error' | 'not_found' | 'timeout' | 'connection_error' | 'not_run';
  details?: string;
}

export interface RuntimeValidatorConfig {
  storybookUrl: string;
  hmrWaitMs?: number;       // Time to wait for HMR to process (default: 3000)
  fetchTimeoutMs?: number;  // HTTP request timeout (default: 5000)
  retryAttempts?: number;   // Number of retries for index check (default: 3)
  retryDelayMs?: number;    // Delay between retries (default: 1000)
  /**
   * The Storybook component ID, when the caller already knows it
   * authoritatively. Overrides anything derivable from the story content.
   */
  storyId?: string;
  /** Where to resolve Playwright from. Defaults to process.cwd(). */
  projectRoot?: string;
  /** Budget for the browser render check (default: 15000). */
  renderTimeoutMs?: number;
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

  /**
   * Priority 4: the conventional default — a GUESS, and labelled as one.
   *
   * 6006 is right for a default Storybook and wrong for every project that
   * chose another port without exporting STORYBOOK_PORT. Verifying against the
   * wrong Storybook is worse than not verifying: the story is not there, so the
   * report is about somebody else's page.
   *
   * Callers that care can ask `isGuessedStorybookUrl()` and say so.
   */
  return 'http://localhost:6006';
}

/**
 * True when getStorybookUrl() had nothing to go on and fell back to convention.
 *
 * Lets a caller distinguish "verified against the Storybook this project
 * declares" from "verified against whatever is on 6006", which are very
 * different claims.
 */
export function isGuessedStorybookUrl(): boolean {
  return !process.env.STORYBOOK_URL
    && process.env.STORYBOOK_PROXY_ENABLED !== 'true'
    && !process.env.STORYBOOK_PORT;
}

/**
 * Check if runtime validation is enabled
 */
export function isRuntimeValidationEnabled(): boolean {
  // Enabled by default whenever a Storybook URL can be resolved, and disabled
  // only when the operator says so.
  //
  // This used to return `STORYBOOK_RUNTIME_VALIDATION === 'true'` while its own
  // comment claimed "enabled by default". That variable is set by nothing in
  // this repo — not `.env.sample`, not `init`, not the docs — so every
  // CLI-initialised project silently ran with the runtime check, and therefore
  // the runtime healing loop, switched off. Opting IN to the check that catches
  // a story which compiles and then crashes on render is the wrong default.
  if (process.env.STORYBOOK_RUNTIME_VALIDATION === 'false') {
    return false;
  }

  // In proxy mode we know Storybook is reachable.
  if (process.env.STORYBOOK_PROXY_ENABLED === 'true') {
    return true;
  }

  // Otherwise the check is on; validateStoryRuntime reports `not_run` when no
  // Storybook URL can be resolved, which is honest and costs nothing.
  return true;
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
 * Read the explicit meta `id:` the generator injected, which Storybook uses
 * VERBATIM as the component ID.
 *
 * This is the fact the file states, and it must win over any slug we could
 * derive from the title. Since generated stories gained an explicit `id`
 * (hashed, so two failed generations can no longer collide on a truncated
 * prompt), a title-derived prefix has been unable to match anything in the
 * index: we searched for `generated-user-settings-notifications` while the
 * story sat there as `user-settings-notifications-d6677a22--default`. Every
 * lookup returned `not_found`, which routes to "skipping healing" — so the
 * runtime healing loop never ran once, and the failure was invisible because
 * `not_found` reads as an infrastructure hiccup rather than a defect.
 *
 * Anchored to the title line, exactly as `applyTitleAndId` writes it, so an
 * `id:` prop anywhere in the user's JSX cannot be mistaken for the meta ID.
 *
 * Returns null for Svelte `defineMeta`, which deliberately carries no explicit
 * id because addon-svelte-csf derives the ID from the title — there, the
 * title-derived slug is the correct answer.
 */
export function extractMetaIdFromStory(storyContent: string): string | null {
  const idMatch = storyContent.match(
    /title:\s*["'][^"']+["']\s*,\s*\n\s*id:\s*['"]([^'"]+)['"]/
  );
  return idMatch ? idMatch[1] : null;
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
): Promise<{ success: boolean; error?: string; errorType?: RuntimeValidationResult['errorType']; htmlOnly?: boolean }> {
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

    // Reaching here means the SERVED HTML is clean, which is not the same as
    // the story rendering. `iframe.html` is a shell that mounts the story
    // client-side: fetched over HTTP it is byte-for-byte identical whether the
    // story renders perfectly or throws on its first line. Measured, not
    // assumed — a crashing story and a healthy one both returned 18,706 bytes.
    //
    // So every pattern above can only catch an error Storybook managed to
    // write into the document server-side, and a React render error never is
    // one. Returning `success: true` here would be the same false pass this
    // module was just fixed to stop emitting, one layer down.
    return { success: true, htmlOnly: true };
  } catch (error: any) {
    if (error.message.includes('timed out')) {
      return { success: false, error: error.message, errorType: 'timeout' };
    }
    return { success: false, error: error.message, errorType: 'connection_error' };
  }
}

/**
 * Ask a real browser whether the story mounted.
 *
 * The HTTP check above cannot answer this, and the project already owns the
 * thing that can: `renderStory` drives Playwright, waits for the story to
 * actually mount rather than sleeping, and collects uncaught page errors —
 * its own type calls them "invisible to the old text-fetch approach". The
 * runtime validator simply never called it.
 *
 * Returns null when no browser is available, which the caller must report as
 * `not_run`. A project without Playwright genuinely cannot answer the
 * question, and saying so is the whole point.
 */
async function checkStoryInBrowser(
  storyId: string,
  storybookUrl: string,
  config: RuntimeValidatorConfig
): Promise<{ success: boolean; error?: string; errorType?: RuntimeValidationResult['errorType'] } | null> {
  let tooling: any;
  try {
    const { resolveHostTooling } = await import('./verify/hostTooling.js');
    tooling = resolveHostTooling(config.projectRoot || process.cwd());
  } catch {
    return null;
  }
  if (!tooling) return null;

  let render: any;
  try {
    const { renderStory } = await import('./verify/renderHarness.js');
    render = await renderStory({
      storybookUrl,
      storyId,
      tooling,
      timeoutMs: config.renderTimeoutMs ?? 15000,
    });
  } catch (error: any) {
    // Chromium missing or refusing to launch is an infrastructure fact about
    // this machine, never a defect in the user's story.
    logger.debug(`Runtime render check unavailable: ${error?.message || error}`);
    return null;
  }

  try {
    // Only an UNCAUGHT exception or a story that never mounted counts as a
    // runtime failure. `console.error` deliberately does not: React key
    // warnings, deprecation notices and dev-mode advisories are all emitted by
    // stories that render perfectly, and condemning those would spend a
    // regeneration rewriting correct code — the failure mode this project
    // rates as worse than having no check at all.
    const faults = [...(render.pageErrors || [])];
    const detail = (render.reason || faults[0] || '').toString().slice(0, 300);

    if (!render.ok || faults.length > 0) {
      // Distinguish a module that never loaded from a component that threw,
      // because the healing prompt asks the model for different things.
      const isModule = /cannot find module|failed to resolve|failed to fetch dynamically imported|is not a function|importers\[/i
        .test(detail);
      return {
        success: false,
        error: detail || 'Story did not mount',
        errorType: isModule ? 'module_error' : 'render_error',
      };
    }
    return { success: true };
  } finally {
    try { await render.dispose?.(); } catch { /* page already gone */ }
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
  // A check that did not run must never report a pass. Both of these used to
  // return `success: true`, which the JSON route forwards verbatim — so
  // "Storybook wasn't configured" and "the story rendered correctly" were the
  // same answer to any caller.
  if (!isRuntimeValidationEnabled()) {
    logger.debug('Runtime validation disabled, skipping');
    return {
      success: false, storyExists: false, errorType: 'not_run',
      details: 'Runtime validation disabled via STORYBOOK_RUNTIME_VALIDATION=false',
    };
  }

  // The panel tells the server which Storybook it lives in. Env is the
  // fallback, not the source: a fresh install has no STORYBOOK_PORT and would
  // otherwise check 6006 for a story living on 6101.
  const storybookUrl = customConfig?.storybookUrl || getStorybookUrl();
  if (!storybookUrl) {
    logger.warn('Could not determine Storybook URL for runtime validation');
    return {
      success: false, storyExists: false, errorType: 'not_run',
      details: 'Storybook URL not configured',
    };
  }

  const config: RuntimeValidatorConfig = {
    storybookUrl,
    hmrWaitMs: 3000,
    fetchTimeoutMs: 5000,
    retryAttempts: 3,
    retryDelayMs: 1000,
    ...customConfig
  };

  // Resolve the story ID, most authoritative source first: the ID the caller
  // already computed, then the one the FILE declares, and only then a slug
  // derived from the title.
  let storyIdPrefix: string;
  const metaId = extractMetaIdFromStory(storyContent);
  const extractedTitle = extractTitleFromStory(storyContent);

  if (config.storyId) {
    storyIdPrefix = config.storyId;
    logger.debug(`Using story ID supplied by the caller: "${storyIdPrefix}"`);
  } else if (metaId) {
    storyIdPrefix = metaId;
    logger.debug(`Using explicit meta id from the story: "${storyIdPrefix}"`);
  } else if (extractedTitle) {
    // No explicit id (Svelte defineMeta) — Storybook derives it from the title.
    storyIdPrefix = fullTitleToStoryIdPrefix(extractedTitle);
    logger.debug(`Extracted title from story: "${extractedTitle}" -> prefix: "${storyIdPrefix}"`);
  } else {
    // Fall back to constructing from the provided title
    storyIdPrefix = titleToStoryIdPrefix(fallbackTitle, storyPrefix);
    logger.debug(`Using fallback title: "${fallbackTitle}" -> prefix: "${storyIdPrefix}"`);
  }

  logger.info(`Runtime validation: checking stories with prefix "${storyIdPrefix}" at ${storybookUrl}`);

  // Step 1: Check if story appears in the index (with retries for HMR timing)
  let matchingStoryId: string | undefined;
  let lastIndexError: string | undefined;

  // Probe once BEFORE paying the HMR wait. Two reasons, and the first is the
  // one that matters:
  //
  //  - When Storybook is not running at all, there is no index to poll and no
  //    amount of waiting produces one. Sleeping 3s and then retrying twice
  //    charges every generation five dead seconds to learn something the first
  //    request already knew, and reports it as `not_found` — a story-shaped
  //    failure — rather than "Storybook is not there".
  //  - When the story already exists (an update to a story Storybook indexed
  //    long ago) the wait buys nothing either.
  const probe = await checkStoryInIndex(storyIdPrefix, storybookUrl, config);
  if (probe.error) {
    logger.warn(`Runtime validation skipped: Storybook unreachable at ${storybookUrl} (${probe.error})`);
    return {
      success: false,
      storyExists: false,
      errorType: 'not_run',
      details: `Storybook unreachable at ${storybookUrl}: ${probe.error}`,
    };
  }

  if (probe.exists && probe.matchingStoryId) {
    matchingStoryId = probe.matchingStoryId;
    logger.debug(`Found matching story without waiting: "${matchingStoryId}"`);
  } else {
    // A new file. Now the HMR wait is worth paying.
    logger.debug(`Waiting ${config.hmrWaitMs}ms for HMR to process...`);
    await sleep(config.hmrWaitMs!);

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

  // Step 3: The HTTP check found nothing, which for a client-rendered story is
  // not evidence of anything. Put it in a browser before claiming it renders.
  if (iframeResult.htmlOnly) {
    const browserResult = await checkStoryInBrowser(matchingStoryId, storybookUrl, config);

    if (!browserResult) {
      logger.warn(
        `Runtime validation could not run for "${matchingStoryId}": no browser available ` +
        `(install Playwright in this project to catch stories that crash on render)`
      );
      return {
        success: false,
        storyExists: true,
        errorType: 'not_run',
        details: 'No browser available; a served HTML response cannot reveal a client-side render error',
      };
    }

    if (!browserResult.success) {
      logger.error(`Runtime error detected in story "${matchingStoryId}": ${browserResult.error}`);
      return {
        success: false,
        storyExists: true,
        renderError: browserResult.error,
        errorType: browserResult.errorType,
        details: `Story ID: ${matchingStoryId}, URL: ${storybookUrl}/iframe.html?id=${matchingStoryId}`,
      };
    }
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
