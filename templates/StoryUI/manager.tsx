/**
 * Story UI Storybook Manager Addon
 *
 * This addon adds a "Source Code" panel to Storybook that displays
 * the source code of the currently viewed story with syntax highlighting.
 *
 * Works in both local development and production deployments.
 */

import { addons, types, useStorybookApi, useStorybookState } from 'storybook/manager-api';
import React, { useEffect, useState, useCallback, useMemo } from 'react';

// Addon identifier
const ADDON_ID = 'story-ui';
const PANEL_ID = `${ADDON_ID}/source-code`;

// Event channel for receiving generated code from StoryUIPanel
const EVENTS = {
  CODE_GENERATED: `${ADDON_ID}/code-generated`,
  STORY_SELECTED: `${ADDON_ID}/story-selected`,
};

/**
 * Get the API base URL for story operations.
 * Works in both local development and production (Railway).
 */
const getApiBaseUrl = (): string => {
  if (typeof window === 'undefined') return 'http://localhost:4001';

  // Check for Railway production domain - use same-origin requests
  const hostname = window.location.hostname;
  if (hostname.includes('.railway.app')) {
    return '';
  }

  // Check for window overrides (local development)
  const windowOverride = (window as any).__STORY_UI_PORT__;
  if (windowOverride) return `http://localhost:${windowOverride}`;

  const mcpOverride = (window as any).STORY_UI_MCP_PORT;
  if (mcpOverride) return `http://localhost:${mcpOverride}`;

  return 'http://localhost:4001';
};

// Extend Window to include generated stories cache
declare global {
  interface Window {
    __STORY_UI_GENERATED_CODE__?: Record<string, string>;
  }
}

/**
 * Extract clean component usage JSX from a full Storybook story file.
 *
 * Transforms:
 *   import { Button } from '@mantine/core';
 *   export default { title: 'Generated/Button' };
 *   export const Default: Story = { render: () => <Button>Click</Button> };
 *
 * Into:
 *   <Button>Click</Button>
 */
const extractUsageCode = (fullStoryCode: string, variantName?: string): string => {
  // Helper function to convert object-style props to JSX attribute syntax
  // e.g., "color: 'blue', variant: 'filled'" -> 'color="blue" variant="filled"'
  const convertToJsxAttributes = (propsStr: string): string => {
    if (!propsStr.trim()) return '';

    const attributes: string[] = [];
    // Match key: value pairs, handling strings, booleans, numbers, and expressions
    // Pattern: key: 'value' or key: "value" or key: true/false or key: 123 or key: expression
    const propRegex = /(\w+)\s*:\s*(?:'([^']*)'|"([^"]*)"|(\btrue\b|\bfalse\b)|(\d+(?:\.\d+)?)|(\{[^}]+\})|([^,}\s]+))/g;

    let match;
    while ((match = propRegex.exec(propsStr)) !== null) {
      const key = match[1];
      const stringValueSingle = match[2]; // 'value'
      const stringValueDouble = match[3]; // "value"
      const boolValue = match[4]; // true/false
      const numValue = match[5]; // 123 or 1.5
      const objValue = match[6]; // {expression}
      const otherValue = match[7]; // other expressions

      if (stringValueSingle !== undefined) {
        attributes.push(`${key}="${stringValueSingle}"`);
      } else if (stringValueDouble !== undefined) {
        attributes.push(`${key}="${stringValueDouble}"`);
      } else if (boolValue !== undefined) {
        if (boolValue === 'true') {
          attributes.push(key); // Just the prop name for true (e.g., fullWidth)
        }
        // Skip false values - they're the default and don't need to be shown
      } else if (numValue !== undefined) {
        attributes.push(`${key}={${numValue}}`);
      } else if (objValue !== undefined) {
        attributes.push(`${key}=${objValue}`);
      } else if (otherValue !== undefined) {
        attributes.push(`${key}={${otherValue}}`);
      }
    }

    return attributes.join(' ');
  };

  // Helper function to generate JSX from args
  const generateJsxFromArgs = (argsStr: string, componentName: string): string | null => {
    try {
      // Extract children if present
      const childrenMatch = argsStr.match(/children:\s*['"`]([^'"`]+)['"`]/);
      const children = childrenMatch ? childrenMatch[1] : '';

      // Extract other props (remove children first)
      const propsStr = argsStr
        .replace(/children:\s*['"`][^'"`]*['"`],?/, '') // Remove children
        .replace(/^\{|\}$/g, '') // Remove braces
        .trim();

      // Convert to JSX attribute syntax
      const jsxAttributes = convertToJsxAttributes(propsStr);

      if (children) {
        if (jsxAttributes) {
          return `<${componentName} ${jsxAttributes}>${children}</${componentName}>`;
        }
        return `<${componentName}>${children}</${componentName}>`;
      } else if (jsxAttributes) {
        return `<${componentName} ${jsxAttributes} />`;
      }
      return `<${componentName} />`;
    } catch {
      return null;
    }
  };

  // Get the component name from meta
  const componentMatch = fullStoryCode.match(/component:\s*([A-Z][A-Za-z0-9]*)/);
  const componentName = componentMatch ? componentMatch[1] : null;

  // If we have a variant name, try to find that specific variant's args or render
  if (variantName) {
    // Normalize variant name for matching:
    // - "primary" -> "Primary"
    // - "full-width" -> "FullWidth" (kebab-case to PascalCase)
    const normalizedVariant = variantName
      .split('-')
      .map(word => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
      .join('');

    // Pattern A: export const Primary: Story = { args: {...} }
    // Match the specific variant's export block
    const variantExportRegex = new RegExp(
      `export\\s+const\\s+${normalizedVariant}\\s*(?::\\s*Story)?\\s*=\\s*\\{([\\s\\S]*?)\\}\\s*;`,
      'i'
    );
    const variantExportMatch = fullStoryCode.match(variantExportRegex);

    if (variantExportMatch) {
      const variantBlock = variantExportMatch[1];

      // Try to extract render function from this variant
      const renderWithParensMatch = variantBlock.match(/render:\s*\([^)]*\)\s*=>\s*\(\s*([\s\S]*?)\s*\)\s*[,}]/);
      if (renderWithParensMatch) {
        return renderWithParensMatch[1].trim().replace(/,\s*$/, '');
      }

      const renderNoParensMatch = variantBlock.match(/render:\s*\([^)]*\)\s*=>\s*(<[A-Z][^,}]*(?:\/>|<\/[A-Za-z.]+>))/s);
      if (renderNoParensMatch) {
        return renderNoParensMatch[1].trim();
      }

      // Try to extract args from this variant
      const argsMatch = variantBlock.match(/args:\s*(\{[\s\S]*?\})\s*[,}]/);
      if (argsMatch && componentName) {
        const result = generateJsxFromArgs(argsMatch[1], componentName);
        if (result) return result;
      }
    }

    // Pattern B: Arrow function variant: export const Primary = () => <Component...>
    const arrowVariantRegex = new RegExp(
      `export\\s+const\\s+${normalizedVariant}\\s*=\\s*\\(\\)\\s*=>\\s*\\(\\s*([\\s\\S]*?)\\s*\\)\\s*;`,
      'i'
    );
    const arrowVariantMatch = fullStoryCode.match(arrowVariantRegex);
    if (arrowVariantMatch) {
      return arrowVariantMatch[1].trim().replace(/,\s*$/, '');
    }

    // Pattern C: Arrow function without parens: export const Primary = () => <Component...>;
    const arrowNoParensRegex = new RegExp(
      `export\\s+const\\s+${normalizedVariant}\\s*=\\s*\\(\\)\\s*=>\\s*(<[A-Z][^;]*(?:\\/>|<\\/[A-Za-z.]+>))\\s*;`,
      'is'
    );
    const arrowNoParensMatch = fullStoryCode.match(arrowNoParensRegex);
    if (arrowNoParensMatch) {
      return arrowNoParensMatch[1].trim();
    }
  }

  // Fallback: Try generic patterns (for Default or when variant not specified)

  // Try to extract JSX from render function: render: () => (<JSX>) or render: () => <JSX>
  // Pattern 1: render: () => (\n  <Component...>\n)
  const renderWithParensMatch = fullStoryCode.match(/render:\s*\([^)]*\)\s*=>\s*\(\s*([\s\S]*?)\s*\)\s*[,}]/);
  if (renderWithParensMatch) {
    const jsx = renderWithParensMatch[1].trim();
    // Clean up any trailing commas or extra whitespace
    return jsx.replace(/,\s*$/, '').trim();
  }

  // Pattern 2: render: () => <Component...> (no parentheses, single line)
  const renderNoParensMatch = fullStoryCode.match(/render:\s*\([^)]*\)\s*=>\s*(<[A-Z][^,}]*(?:\/>|<\/[A-Za-z.]+>))/s);
  if (renderNoParensMatch) {
    return renderNoParensMatch[1].trim();
  }

  // Pattern 3: Arrow function story: () => (<JSX>)
  const arrowWithParensMatch = fullStoryCode.match(/export\s+const\s+\w+\s*=\s*\(\)\s*=>\s*\(\s*([\s\S]*?)\s*\)\s*;/);
  if (arrowWithParensMatch) {
    const jsx = arrowWithParensMatch[1].trim();
    return jsx.replace(/,\s*$/, '').trim();
  }

  // Pattern 4: Arrow function story: () => <Component...>
  const arrowNoParensMatch = fullStoryCode.match(/export\s+const\s+\w+\s*=\s*\(\)\s*=>\s*(<[A-Z][^;]*(?:\/>|<\/[A-Za-z.]+>))\s*;/s);
  if (arrowNoParensMatch) {
    return arrowNoParensMatch[1].trim();
  }

  // Pattern 5: Look for args-based stories with component prop spreading
  // e.g., args: { children: 'Click me', color: 'blue' }
  const argsMatch = fullStoryCode.match(/args:\s*(\{[\s\S]*?\})\s*[,}]/);
  if (argsMatch && componentName) {
    const result = generateJsxFromArgs(argsMatch[1], componentName);
    if (result) return result;
  }

  // Pattern 6: Look for any JSX block starting with < and ending with /> or </Component>
  // This is a fallback for any JSX we can find
  const jsxBlockMatch = fullStoryCode.match(/(<[A-Z][a-zA-Z0-9.]*[\s\S]*?(?:\/>|<\/[A-Za-z.]+>))/);
  if (jsxBlockMatch) {
    // Don't return if it looks like an import or type definition
    const match = jsxBlockMatch[1];
    if (!match.includes('import') && !match.includes('Meta<') && !match.includes('StoryObj<')) {
      return match.trim();
    }
  }

  // If no patterns matched, return the original code
  // (better than showing nothing)
  return fullStoryCode;
};

/**
 * Simple Prism-like syntax highlighting for JSX/TSX
 * Uses inline styles for portability (no external CSS needed)
 */
const tokenize = (code: string): Array<{ type: string; value: string }> => {
  const tokens: Array<{ type: string; value: string }> = [];
  let remaining = code;

  const patterns: Array<{ type: string; regex: RegExp }> = [
    // Comments
    { type: 'comment', regex: /^(\/\/[^\n]*|\/\*[\s\S]*?\*\/)/ },
    // Strings (double, single, template)
    { type: 'string', regex: /^("[^"\\]*(?:\\.[^"\\]*)*"|'[^'\\]*(?:\\.[^'\\]*)*'|`[^`\\]*(?:\\.[^`\\]*)*`)/ },
    // JSX tags
    { type: 'tag', regex: /^(<\/?[A-Z][a-zA-Z0-9.]*|<\/?[a-z][a-z0-9-]*)/ },
    // Closing tag bracket
    { type: 'punctuation', regex: /^(\/>|>)/ },
    // Keywords
    { type: 'keyword', regex: /^(const|let|var|function|return|export|default|import|from|if|else|for|while|class|extends|new|this|typeof|instanceof|async|await|try|catch|throw|finally)\b/ },
    // Booleans and null
    { type: 'boolean', regex: /^(true|false|null|undefined)\b/ },
    // Numbers
    { type: 'number', regex: /^-?\d+\.?\d*(e[+-]?\d+)?/ },
    // Props/attributes (word followed by =)
    { type: 'attr-name', regex: /^([a-zA-Z_$][a-zA-Z0-9_$]*)\s*(?==)/ },
    // Function names
    { type: 'function', regex: /^([a-zA-Z_$][a-zA-Z0-9_$]*)\s*(?=\()/ },
    // Identifiers
    { type: 'plain', regex: /^[a-zA-Z_$][a-zA-Z0-9_$]*/ },
    // Operators
    { type: 'operator', regex: /^(=>|===|!==|==|!=|<=|>=|&&|\|\||[+\-*/%=<>!&|^~?:])/ },
    // Punctuation
    { type: 'punctuation', regex: /^[{}[\]();,.]/ },
    // Whitespace
    { type: 'whitespace', regex: /^\s+/ },
  ];

  while (remaining.length > 0) {
    let matched = false;

    for (const { type, regex } of patterns) {
      const match = remaining.match(regex);
      if (match) {
        tokens.push({ type, value: match[0] });
        remaining = remaining.slice(match[0].length);
        matched = true;
        break;
      }
    }

    if (!matched) {
      // Unknown character, add as plain
      tokens.push({ type: 'plain', value: remaining[0] });
      remaining = remaining.slice(1);
    }
  }

  return tokens;
};

/**
 * Color scheme for syntax highlighting (VS Code-like dark theme)
 */
const tokenColors: Record<string, React.CSSProperties> = {
  comment: { color: '#6A9955', fontStyle: 'italic' },
  string: { color: '#CE9178' },
  tag: { color: '#569CD6' },
  keyword: { color: '#C586C0' },
  boolean: { color: '#569CD6' },
  number: { color: '#B5CEA8' },
  'attr-name': { color: '#9CDCFE' },
  function: { color: '#DCDCAA' },
  operator: { color: '#D4D4D4' },
  punctuation: { color: '#D4D4D4' },
  plain: { color: '#D4D4D4' },
  whitespace: {},
};

/**
 * Syntax Highlighter Component
 */
const SyntaxHighlighter: React.FC<{ code: string }> = ({ code }) => {
  const tokens = useMemo(() => tokenize(code), [code]);

  return (
    <pre
      style={{
        margin: 0,
        padding: '16px',
        background: '#1E1E1E',
        borderRadius: '4px',
        overflow: 'auto',
        fontSize: '13px',
        lineHeight: '1.5',
        fontFamily: 'ui-monospace, SFMono-Regular, "SF Mono", Menlo, Consolas, monospace',
      }}
    >
      <code>
        {tokens.map((token, index) => (
          <span key={index} style={tokenColors[token.type] || {}}>
            {token.value}
          </span>
        ))}
      </code>
    </pre>
  );
};

/**
 * Inline styles for the panel
 */
const styles = {
  container: {
    height: '100%',
    display: 'flex',
    flexDirection: 'column' as const,
    background: '#1E1E1E',
    color: '#D4D4D4',
  },
  header: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: '8px 12px',
    borderBottom: '1px solid #3C3C3C',
    background: '#252526',
  },
  title: {
    fontSize: '12px',
    fontWeight: 600,
    color: '#CCCCCC',
    textTransform: 'uppercase' as const,
    letterSpacing: '0.5px',
  },
  copyButton: {
    background: '#0E639C',
    color: 'white',
    border: 'none',
    borderRadius: '4px',
    padding: '4px 10px',
    fontSize: '11px',
    cursor: 'pointer',
    fontWeight: 500,
  },
  codeContainer: {
    flex: 1,
    overflow: 'auto',
    padding: '0',
  },
  emptyState: {
    display: 'flex',
    flexDirection: 'column' as const,
    alignItems: 'center',
    justifyContent: 'center',
    height: '100%',
    color: '#888',
    fontSize: '13px',
    textAlign: 'center' as const,
    padding: '20px',
  },
  storyInfo: {
    fontSize: '11px',
    color: '#888',
    marginTop: '4px',
  },
  deleteButton: {
    background: 'transparent',
    color: '#C75050',
    border: '1px solid #C75050',
    borderRadius: '4px',
    padding: '4px 10px',
    fontSize: '11px',
    cursor: 'pointer',
    fontWeight: 500,
  },
  deleteButtonHover: {
    background: '#C75050',
    color: 'white',
  },
  deleteButtonDeleting: {
    background: '#555',
    color: '#888',
    border: '1px solid #555',
    cursor: 'not-allowed',
  },
};

/**
 * Source Code Panel Component
 */
const SourceCodePanel: React.FC<{ active?: boolean }> = ({ active }) => {
  const api = useStorybookApi();
  const state = useStorybookState();
  const [sourceCode, setSourceCode] = useState<string>('');
  const [storyTitle, setStoryTitle] = useState<string>('');
  const [copied, setCopied] = useState(false);
  const [showFullCode, setShowFullCode] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);
  const [deleteHover, setDeleteHover] = useState(false);

  // Get the current story ID
  const currentStoryId = state?.storyId;

  // Extract variant name from story ID (e.g., "generated-button--primary" -> "primary", "generated-button--full-width" -> "full-width")
  const currentVariant = useMemo(() => {
    if (!currentStoryId) return undefined;
    // Match everything after the last -- (variant can contain hyphens like "full-width")
    const variantMatch = currentStoryId.match(/--([a-z0-9-]+)$/i);
    return variantMatch ? variantMatch[1] : undefined;
  }, [currentStoryId]);

  // Memoize the usage code extraction with variant awareness
  const usageCode = useMemo(() => {
    if (!sourceCode) return '';
    return extractUsageCode(sourceCode, currentVariant);
  }, [sourceCode, currentVariant]);

  const displayCode = useMemo(() => {
    if (!sourceCode) return '';
    return showFullCode ? sourceCode : usageCode;
  }, [sourceCode, showFullCode, usageCode]);

  // Check if there's different usage code (for showing toggle button)
  // This should remain true even when showing full code
  const hasUsageCode = useMemo(() => {
    return sourceCode && usageCode && usageCode !== sourceCode;
  }, [sourceCode, usageCode]);

  // Check if this is a generated story (for showing delete button)
  const isGeneratedStory = useMemo(() => {
    return currentStoryId?.includes('generated') || false;
  }, [currentStoryId]);

  // Extract story file ID from the Storybook story ID
  // e.g., "generated-simple-test-button--primary" -> "SimpleTestButton"
  const getStoryFileId = useCallback((storyId: string): string => {
    // Remove "generated-" prefix and variant suffix
    const match = storyId.match(/^generated[-\/]?(.+?)(?:--.*)?$/i);
    if (match) {
      // Convert kebab-case to PascalCase: "simple-test-button" -> "SimpleTestButton"
      const words = match[1].split('-');
      return words.map(w => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase()).join('');
    }
    return storyId;
  }, []);

  // Handle delete story
  const handleDelete = useCallback(async () => {
    if (!currentStoryId || !isGeneratedStory || isDeleting) return;

    const confirmed = window.confirm('Delete this generated story? This cannot be undone.');
    if (!confirmed) return;

    setIsDeleting(true);

    try {
      const apiBase = getApiBaseUrl();
      const storyFileId = getStoryFileId(currentStoryId);

      console.log('[Source Code Panel] Deleting story:', { currentStoryId, storyFileId, apiBase });

      // Try the RESTful DELETE endpoint first
      const response = await fetch(`${apiBase}/story-ui/stories/${storyFileId}`, {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
      });

      if (response.ok) {
        console.log('[Source Code Panel] Story deleted successfully');

        // Clear local cache
        const topWindow = window.top || window;
        if (topWindow.__STORY_UI_GENERATED_CODE__) {
          delete topWindow.__STORY_UI_GENERATED_CODE__[currentStoryId];
        }
        if (window.__STORY_UI_GENERATED_CODE__) {
          delete window.__STORY_UI_GENERATED_CODE__[currentStoryId];
        }

        // Clear localStorage cache
        try {
          const stored = JSON.parse(localStorage.getItem('storyui_generated_code') || '{}');
          delete stored[storyFileId];
          delete stored[currentStoryId];
          localStorage.setItem('storyui_generated_code', JSON.stringify(stored));
        } catch (e) {
          console.warn('[Source Code Panel] Failed to clear localStorage:', e);
        }

        // Clear the source code display
        setSourceCode('');

        // Navigate to a different story (Story UI Generator default)
        api.selectStory('story-ui-story-generator--default');

        // Trigger Storybook refresh to update sidebar
        window.location.reload();
      } else {
        const errorData = await response.json().catch(() => ({}));
        console.error('[Source Code Panel] Delete failed:', errorData);
        alert(`Failed to delete story: ${errorData.error || 'Unknown error'}`);
      }
    } catch (error) {
      console.error('[Source Code Panel] Delete error:', error);
      alert('Failed to delete story. Check console for details.');
    } finally {
      setIsDeleting(false);
    }
  }, [currentStoryId, isGeneratedStory, isDeleting, api, getStoryFileId]);

  // Try to get source code from the story
  useEffect(() => {
    if (!currentStoryId || !active) return;

    // Get story data from the API
    const story = api.getData(currentStoryId);

    // Check if this is a generated story based on ID (works even if story doesn't exist in Storybook yet)
    const isGeneratedStory = currentStoryId.includes('generated');

    if (story) {
      setStoryTitle(story.title || '');

      // Try to get source from story parameters
      const storySource = (story as any)?.parameters?.docs?.source?.code ||
                          (story as any)?.parameters?.storySource?.source ||
                          (story as any)?.parameters?.source?.code;

      if (storySource) {
        setSourceCode(storySource);
        return;
      }
    } else {
      // Story doesn't exist in Storybook yet, set title from story ID
      setStoryTitle(currentStoryId);
    }

    // For generated stories (whether or not they exist in Storybook), try to get from cache/localStorage
    if (isGeneratedStory) {
      // Try to get from window cache first
      const topWindow = window.top || window;
      let cachedCode = topWindow.__STORY_UI_GENERATED_CODE__?.[currentStoryId] ||
                        window.__STORY_UI_GENERATED_CODE__?.[currentStoryId];

      console.log('[Source Code Panel DEBUG] Looking for code:', {
        currentStoryId,
        foundInWindowCache: !!cachedCode,
        windowCacheKeys: Object.keys(topWindow.__STORY_UI_GENERATED_CODE__ || {}),
      });

      // If not in memory cache, check localStorage (survives page navigation)
      if (!cachedCode) {
        try {
          const stored = JSON.parse(localStorage.getItem('storyui_generated_code') || '{}');

          console.log('[Source Code Panel DEBUG] localStorage lookup:', {
            localStorageKeys: Object.keys(stored),
            localStorageKeyCount: Object.keys(stored).length,
          });

          // Try multiple key formats since Storybook IDs differ from our storage keys
          // Storybook ID format: "generated-componentname--variant" or "generated/componentname--variant"
          // Our storage keys: "ComponentName", "ComponentName.stories.tsx", "story-hash123", etc.
          const keysToTry: string[] = [currentStoryId];

          // Extract component name and base story ID from Storybook ID
          // e.g., "generated-simple-test-button--primary" -> baseId: "generated-simple-test-button--default", component: "simpletestbutton"
          const match = currentStoryId.match(/^(generated[-\/]?.+?)(?:--(.*))?$/i);
          if (match) {
            const baseId = match[1];
            const variant = match[2];

            // Try base story ID with --default variant (this is what we store)
            if (variant && variant !== 'default') {
              keysToTry.push(`${baseId}--default`);
            }
            // Also try just the base ID without any variant
            keysToTry.push(baseId);

            // Extract component name (e.g., "generated-simple-test-button" -> "simpletestbutton")
            const componentMatch = baseId.match(/^generated[-\/]?(.+)$/i);
            if (componentMatch) {
              const componentNameLower = componentMatch[1].replace(/-/g, '');
              keysToTry.push(componentNameLower);
              // Try PascalCase version (e.g., "simpletestbutton" -> "Simpletestbutton")
              const pascalCase = componentNameLower.charAt(0).toUpperCase() + componentNameLower.slice(1);
              keysToTry.push(pascalCase);
              keysToTry.push(`${pascalCase}.stories.tsx`);

              // Try with spaces converted to title case (e.g., "Simple Test Button" -> "SimpleTestButton")
              const words = componentMatch[1].split('-');
              if (words.length > 1) {
                const titleCase = words.map(w => w.charAt(0).toUpperCase() + w.slice(1)).join('');
                keysToTry.push(titleCase);
                // Also try with space-separated title (what we store)
                const spacedTitle = words.map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');
                keysToTry.push(spacedTitle);
              }
            }
          }

          // Also try the story title if available
          if (storyTitle) {
            keysToTry.push(storyTitle);
            keysToTry.push(storyTitle.replace(/\s+/g, ''));
            keysToTry.push(`${storyTitle.replace(/\s+/g, '')}.stories.tsx`);
          }

          console.log('[Source Code Panel DEBUG] trying keys:', keysToTry);

          // Try each key format
          for (const key of keysToTry) {
            if (stored[key]) {
              cachedCode = stored[key];
              console.log('[Source Code Panel DEBUG] found code with key:', key, 'codeLength:', cachedCode?.length);
              break;
            }
          }

          // Restore to memory cache if found
          if (cachedCode) {
            if (!topWindow.__STORY_UI_GENERATED_CODE__) {
              topWindow.__STORY_UI_GENERATED_CODE__ = {};
            }
            topWindow.__STORY_UI_GENERATED_CODE__[currentStoryId] = cachedCode;
          }
        } catch (e) {
          console.warn('[Story UI] Failed to read from localStorage:', e);
        }
      }

      console.log('[Source Code Panel DEBUG] final result:', {
        foundCode: !!cachedCode,
        codeLength: cachedCode?.length,
      });

      if (cachedCode) {
        setSourceCode(cachedCode);
      } else {
        setSourceCode('');
      }
    } else {
      setSourceCode('');
    }
  }, [currentStoryId, active, api]);

  // Listen for code generated events from StoryUIPanel
  useEffect(() => {
    const channel = addons.getChannel();
    const topWindow = window.top || window;

    const handleCodeGenerated = (data: { storyId: string; code: string }) => {
      // Store in window cache (both local and top window)
      if (!window.__STORY_UI_GENERATED_CODE__) {
        window.__STORY_UI_GENERATED_CODE__ = {};
      }
      window.__STORY_UI_GENERATED_CODE__[data.storyId] = data.code;

      if (topWindow !== window) {
        if (!topWindow.__STORY_UI_GENERATED_CODE__) {
          topWindow.__STORY_UI_GENERATED_CODE__ = {};
        }
        topWindow.__STORY_UI_GENERATED_CODE__[data.storyId] = data.code;
      }

      // If this is the current story, update the display
      if (data.storyId === currentStoryId) {
        setSourceCode(data.code);
      }
    };

    channel.on(EVENTS.CODE_GENERATED, handleCodeGenerated);

    return () => {
      channel.off(EVENTS.CODE_GENERATED, handleCodeGenerated);
    };
  }, [currentStoryId]);

  const handleCopy = useCallback(() => {
    if (displayCode) {
      navigator.clipboard.writeText(displayCode).then(() => {
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
      });
    }
  }, [displayCode]);

  if (!active) return null;

  // No story selected
  if (!currentStoryId) {
    return (
      <div style={styles.container}>
        <div style={styles.emptyState}>
          <span>Select a story to view its source code</span>
        </div>
      </div>
    );
  }

  // No source code available
  if (!sourceCode) {
    return (
      <div style={styles.container}>
        <div style={styles.header}>
          <span style={styles.title}>Source Code</span>
        </div>
        <div style={styles.emptyState}>
          <span>No source code available for this story</span>
          <span style={styles.storyInfo}>
            {storyTitle || currentStoryId}
          </span>
          <span style={{ ...styles.storyInfo, marginTop: '12px', maxWidth: '280px' }}>
            Generate a story using the Story UI panel to see the code here.
          </span>
        </div>
      </div>
    );
  }

  return (
    <div style={styles.container}>
      <div style={styles.header}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
          <span style={styles.title}>{showFullCode ? 'Full Story' : 'Usage Code'}</span>
          {hasUsageCode && (
            <button
              style={{
                background: 'transparent',
                color: '#888',
                border: '1px solid #555',
                borderRadius: '4px',
                padding: '2px 8px',
                fontSize: '10px',
                cursor: 'pointer',
                fontWeight: 400,
              }}
              onClick={() => setShowFullCode(!showFullCode)}
            >
              {showFullCode ? 'Show Usage' : 'Show Full'}
            </button>
          )}
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <button
            style={{
              ...styles.copyButton,
              background: copied ? '#16825D' : '#0E639C',
            }}
            onClick={handleCopy}
          >
            {copied ? 'Copied!' : 'Copy'}
          </button>
          {isGeneratedStory && (
            <button
              style={{
                ...styles.deleteButton,
                ...(isDeleting ? styles.deleteButtonDeleting : {}),
                ...(deleteHover && !isDeleting ? styles.deleteButtonHover : {}),
              }}
              onClick={handleDelete}
              onMouseEnter={() => setDeleteHover(true)}
              onMouseLeave={() => setDeleteHover(false)}
              disabled={isDeleting}
              title="Delete this generated story"
            >
              {isDeleting ? 'Deleting...' : 'Delete'}
            </button>
          )}
        </div>
      </div>
      <div style={styles.codeContainer}>
        <SyntaxHighlighter code={displayCode} />
      </div>
    </div>
  );
};

// Register the addon - always register, not just in Edge mode
addons.register(ADDON_ID, () => {
  addons.add(PANEL_ID, {
    type: types.PANEL,
    title: 'Source Code',
    match: ({ viewMode }) => viewMode === 'story' || viewMode === 'docs',
    render: ({ active }) => <SourceCodePanel active={active} />,
  });
});
