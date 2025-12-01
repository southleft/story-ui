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
const extractUsageCode = (fullStoryCode: string): string => {
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
  if (argsMatch) {
    // Try to find the component from the meta
    const componentMatch = fullStoryCode.match(/component:\s*([A-Z][A-Za-z0-9]*)/);
    if (componentMatch) {
      const componentName = componentMatch[1];
      try {
        // Parse the args to generate JSX
        const argsStr = argsMatch[1];
        // Extract children if present
        const childrenMatch = argsStr.match(/children:\s*['"`]([^'"`]+)['"`]/);
        const children = childrenMatch ? childrenMatch[1] : '';

        // Extract other props (simplified)
        const propsStr = argsStr
          .replace(/children:\s*['"`][^'"`]*['"`],?/, '') // Remove children
          .replace(/^\{|\}$/g, '') // Remove braces
          .trim();

        if (children) {
          if (propsStr) {
            return `<${componentName} ${propsStr.replace(/,\s*$/, '')}>${children}</${componentName}>`;
          }
          return `<${componentName}>${children}</${componentName}>`;
        } else if (propsStr) {
          return `<${componentName} ${propsStr.replace(/,\s*$/, '')} />`;
        }
        return `<${componentName} />`;
      } catch {
        // Fall through to return full code
      }
    }
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

  // Memoize the usage code extraction
  const displayCode = useMemo(() => {
    if (!sourceCode) return '';
    return showFullCode ? sourceCode : extractUsageCode(sourceCode);
  }, [sourceCode, showFullCode]);

  // Get the current story ID
  const currentStoryId = state?.storyId;

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

      // If not in memory cache, check localStorage (survives page navigation)
      if (!cachedCode) {
        try {
          const stored = JSON.parse(localStorage.getItem('storyui_generated_code') || '{}');
          cachedCode = stored[currentStoryId];
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

  // Check if extraction was successful (displayCode is different from sourceCode)
  const hasUsageCode = displayCode !== sourceCode;

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
        <button
          style={{
            ...styles.copyButton,
            background: copied ? '#16825D' : '#0E639C',
          }}
          onClick={handleCopy}
        >
          {copied ? 'Copied!' : 'Copy'}
        </button>
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
