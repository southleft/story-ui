/**
 * Live Preview Renderer
 *
 * This component takes generated JSX code as a string and renders it live
 * using Babel standalone for JSX compilation and the component registry
 * for component resolution.
 */

import React, { useState, useEffect, useRef } from 'react';
import * as Babel from '@babel/standalone';
// This import will be replaced with the actual component registry at build time
import { componentRegistry, React as ReactExport } from './componentRegistry';

interface LivePreviewRendererProps {
  /** The JSX code string to render */
  code: string;
  /** Optional error handler */
  onError?: (error: Error) => void;
  /** Optional success handler */
  onSuccess?: () => void;
  /** Custom styles for the container */
  containerStyle?: React.CSSProperties;
}

interface ErrorBoundaryState {
  hasError: boolean;
  error: Error | null;
}

// Error boundary to catch render errors
class ErrorBoundary extends React.Component<
  { children: React.ReactNode; onError?: (error: Error) => void },
  ErrorBoundaryState
> {
  constructor(props: { children: React.ReactNode; onError?: (error: Error) => void }) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error) {
    this.props.onError?.(error);
  }

  componentDidUpdate(prevProps: { children: React.ReactNode }) {
    // Reset error state when children change
    if (prevProps.children !== this.props.children && this.state.hasError) {
      this.setState({ hasError: false, error: null });
    }
  }

  render() {
    if (this.state.hasError) {
      return (
        <div style={{
          padding: '16px',
          background: 'rgba(239, 68, 68, 0.1)',
          borderLeft: '3px solid #ef4444',
          borderRadius: '4px',
          color: '#ef4444',
          fontFamily: 'monospace',
          fontSize: '13px',
          whiteSpace: 'pre-wrap',
        }}>
          <strong>Render Error:</strong>
          <br />
          {this.state.error?.message}
        </div>
      );
    }

    return this.props.children;
  }
}

/**
 * Extract JSX from generated code
 * The AI typically returns a full story file, but we only need the JSX render content
 * This function handles various LLM output formats including markdown-wrapped code
 */
function extractJSX(code: string): string {
  let cleanCode = code.trim();

  // Step 0: Detect and reject HTML documents and invalid XML responses
  // LLMs sometimes return full HTML pages or internal XML tags instead of JSX components
  if (cleanCode.match(/^<!DOCTYPE\s+html/i) || cleanCode.match(/^<html[\s>]/i)) {
    // Try to extract JSX components from within the HTML
    // Look for React/JSX component patterns inside the HTML
    const jsxInHtml = cleanCode.match(/<([A-Z][a-zA-Z0-9]*)[^>]*>[\s\S]*?<\/\1>/);
    if (jsxInHtml) {
      cleanCode = jsxInHtml[0];
    } else {
      throw new Error('Invalid response: LLM returned an HTML document instead of JSX components. Please try again with a more specific prompt.');
    }
  }

  // Step 0.5: Detect internal LLM metadata tags (anthropic_info, thinking, budget, usage, etc.)
  // These should never appear in responses but sometimes leak through
  // Pattern matches: <tag>, <tag:value>, <tag_name>, </tag>, etc. where tag is lowercase
  const llmMetadataPattern = /<(?:anthropic_info|thinking|budget|usage|system|context|response|metadata|internal)[^>]*>|<[a-z][a-z_]*:[^>]+>|<\/?[a-z_]+>/;
  if (cleanCode.match(llmMetadataPattern)) {
    // Try to find JSX components in the mess
    const jsxMatch = cleanCode.match(/<([A-Z][a-zA-Z0-9]*)[^>]*>[\s\S]*?<\/\1>/);
    if (jsxMatch) {
      cleanCode = jsxMatch[0];
    } else {
      // Also try self-closing JSX components
      const selfClosingMatch = cleanCode.match(/<([A-Z][a-zA-Z0-9]*)[^>]*\/>/);
      if (selfClosingMatch) {
        cleanCode = selfClosingMatch[0];
      } else {
        throw new Error('Invalid response: LLM returned internal metadata instead of JSX components. Please try again.');
      }
    }
  }

  // Step 1: Remove markdown headers (# Header, ## Header, etc.)
  cleanCode = cleanCode.replace(/^#+\s+[^\n]*\n*/gm, '');

  // Step 2: Remove markdown explanatory text before code blocks
  // This handles patterns like "Here's a component:\n\n```jsx"
  cleanCode = cleanCode.replace(/^[^<`]*(?=```)/s, '');

  // Step 3: Remove markdown code blocks (```jsx ... ```)
  // Handle multiple code blocks and various language tags
  const codeBlockMatch = cleanCode.match(/```(?:jsx|tsx|javascript|js|typescript|ts|html|react)?\n?([\s\S]*?)```/);
  if (codeBlockMatch) {
    cleanCode = codeBlockMatch[1].trim();
    // Recursively process in case extracted code is also HTML
    if (cleanCode.match(/^<!DOCTYPE\s+html/i) || cleanCode.match(/^<html[\s>]/i)) {
      return extractJSX(cleanCode);
    }
  } else if (cleanCode.startsWith('```')) {
    // Fallback for unclosed code blocks
    cleanCode = cleanCode
      .replace(/^```(?:jsx|tsx|javascript|js|typescript|ts|html|react)?\n?/, '')
      .replace(/\n?```$/, '');
  }

  // Step 4: Remove any remaining text before the first JSX tag
  // This catches explanations like "Here's the card:" that appear before <Component>
  const firstTagIndex = cleanCode.indexOf('<');
  if (firstTagIndex > 0) {
    // Check if there's actual JSX after this point
    const potentialJSX = cleanCode.substring(firstTagIndex);
    if (potentialJSX.match(/^<[A-Z]/)) {
      cleanCode = potentialJSX;
    }
  }

  // Step 4.5: Skip lowercase HTML tags and find actual JSX components
  // JSX components start with uppercase letters
  if (cleanCode.match(/^<[a-z]/)) {
    // This is an HTML tag, not a JSX component - look for JSX further in
    const jsxComponentMatch = cleanCode.match(/<([A-Z][a-zA-Z0-9]*)[^>]*>[\s\S]*$/);
    if (jsxComponentMatch) {
      cleanCode = jsxComponentMatch[0];
    }
  }

  // Step 5: Remove any trailing text after the JSX closes
  // Find the matching closing tag by tracking depth
  if (cleanCode.startsWith('<') && cleanCode.match(/^<[A-Z]/)) {
    const jsxEndIndex = findJSXEnd(cleanCode);
    if (jsxEndIndex > 0 && jsxEndIndex < cleanCode.length) {
      cleanCode = cleanCode.substring(0, jsxEndIndex).trim();
    }
  }

  cleanCode = cleanCode.trim();

  // Try to extract JSX from a render function
  const renderMatch = cleanCode.match(/render:\s*\(\)\s*=>\s*\(?([\s\S]*?)\)?\s*,?\s*\}/);
  if (renderMatch) {
    const jsx = renderMatch[1].trim();
    // Remove trailing paren if present
    return jsx.endsWith(')') && !jsx.includes('(') ? jsx.slice(0, -1) : jsx;
  }

  // Try to extract from args.children
  const childrenMatch = cleanCode.match(/children:\s*\(?([\s\S]*?)\)?\s*\}/);
  if (childrenMatch) {
    const jsx = childrenMatch[1].trim();
    return jsx.endsWith(')') && !jsx.includes('(') ? jsx.slice(0, -1) : jsx;
  }

  // If it looks like a JSX component (starts with <Uppercase), use it directly
  if (cleanCode.match(/^<[A-Z]/)) {
    return cleanCode;
  }

  // Try to extract any JSX component from the code
  const jsxMatch = cleanCode.match(/<[A-Z][a-zA-Z0-9]*[^>]*>[\s\S]*$/);
  if (jsxMatch) {
    return jsxMatch[0];
  }

  // If we still have lowercase tags, it's not valid JSX
  if (cleanCode.match(/^<[a-z]/)) {
    throw new Error('Invalid response: LLM returned HTML elements instead of JSX components. Please try again.');
  }

  // Return as-is and let Babel fail if it's not valid
  return cleanCode;
}

/**
 * Find where the JSX expression ends by tracking tag depth
 */
function findJSXEnd(code: string): number {
  let depth = 0;
  let i = 0;
  let inTag = false;
  let inString = false;
  let stringChar = '';
  let lastTagEnd = -1;

  while (i < code.length) {
    const char = code[i];

    // Handle string boundaries
    if (!inString && (char === '"' || char === "'" || char === '`')) {
      inString = true;
      stringChar = char;
    } else if (inString && char === stringChar && code[i - 1] !== '\\') {
      inString = false;
    }

    if (!inString) {
      if (char === '<') {
        // Check for closing tag
        if (code[i + 1] === '/') {
          inTag = true;
        } else if (code[i + 1] && /[A-Za-z]/.test(code[i + 1])) {
          // Opening tag
          depth++;
          inTag = true;
        }
      } else if (char === '>') {
        if (inTag) {
          // Self-closing tag
          if (code[i - 1] === '/') {
            depth--;
          } else if (code.substring(Math.max(0, i - 10), i).includes('</')) {
            // Closing tag
            depth--;
          }
          inTag = false;
          lastTagEnd = i + 1;

          // If depth is 0, we've found the end of the root element
          if (depth === 0) {
            return lastTagEnd;
          }
        }
      }
    }
    i++;
  }

  return lastTagEnd > 0 ? lastTagEnd : code.length;
}

/**
 * Compile JSX code string to a React component
 */
function compileJSX(jsxCode: string): React.ComponentType | null {
  try {
    // Create a scope object with all available components and React
    const scope: Record<string, any> = {
      React: ReactExport,
      ...componentRegistry,
      // Add common React hooks
      useState: React.useState,
      useEffect: React.useEffect,
      useCallback: React.useCallback,
      useMemo: React.useMemo,
      useRef: React.useRef,
    };

    // Extract the JSX to render
    const extractedJSX = extractJSX(jsxCode);

    // Wrap in a function component
    const wrappedCode = `
      (function() {
        const { ${Object.keys(scope).join(', ')} } = scope;
        return function PreviewComponent() {
          return (${extractedJSX});
        };
      })()
    `;

    // Transform JSX to JavaScript
    const transformed = Babel.transform(wrappedCode, {
      presets: ['react'],
      filename: 'preview.tsx',
    });

    if (!transformed.code) {
      throw new Error('Babel transformation produced no output');
    }

    // Create the component using Function constructor
    // eslint-disable-next-line no-new-func
    const createComponent = new Function('scope', `return ${transformed.code}`);
    const Component = createComponent(scope);

    return Component;
  } catch (error) {
    console.error('JSX compilation error:', error);
    throw error;
  }
}

/**
 * Live Preview Renderer Component
 */
export const LivePreviewRenderer: React.FC<LivePreviewRendererProps> = ({
  code,
  onError,
  onSuccess,
  containerStyle,
}) => {
  const [compiledComponent, setCompiledComponent] = useState<React.ComponentType | null>(null);
  const [error, setError] = useState<Error | null>(null);
  const previousCodeRef = useRef<string>('');

  // Compile the code when it changes
  useEffect(() => {
    if (!code || code === previousCodeRef.current) {
      return;
    }

    previousCodeRef.current = code;
    setError(null);

    try {
      const Component = compileJSX(code);
      setCompiledComponent(() => Component);
      onSuccess?.();
    } catch (err) {
      const error = err instanceof Error ? err : new Error(String(err));
      setError(error);
      setCompiledComponent(null);
      onError?.(error);
    }
  }, [code, onError, onSuccess]);

  // Render error state
  if (error) {
    return (
      <div style={{
        padding: '24px',
        ...containerStyle,
      }}>
        <div style={{
          padding: '16px',
          background: 'rgba(239, 68, 68, 0.1)',
          borderLeft: '3px solid #ef4444',
          borderRadius: '4px',
          color: '#ef4444',
        }}>
          <div style={{
            fontWeight: 600,
            marginBottom: '8px',
            fontSize: '14px',
          }}>
            Compilation Error
          </div>
          <pre style={{
            margin: 0,
            fontFamily: '"Fira Code", Monaco, monospace',
            fontSize: '12px',
            lineHeight: 1.5,
            whiteSpace: 'pre-wrap',
            wordBreak: 'break-word',
          }}>
            {error.message}
          </pre>
        </div>
      </div>
    );
  }

  // Render empty state
  if (!compiledComponent) {
    return (
      <div style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        height: '100%',
        color: '#71717a',
        ...containerStyle,
      }}>
        Waiting for code...
      </div>
    );
  }

  // Render the compiled component
  const Component = compiledComponent;
  return (
    <div style={{
      padding: '24px',
      minHeight: '200px',
      ...containerStyle,
    }}>
      <ErrorBoundary onError={onError}>
        <Component />
      </ErrorBoundary>
    </div>
  );
};

export default LivePreviewRenderer;
