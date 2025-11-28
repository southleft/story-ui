/**
 * Generated Story Renderer
 *
 * This story component renders dynamically generated stories from the Edge Worker.
 * When a user clicks on a generated story in the sidebar panel, this renderer fetches
 * the story content and renders it using React and Babel standalone for JSX compilation.
 */

import React, { useEffect, useState, useRef, useCallback } from 'react';
import type { Meta, StoryObj } from '@storybook/react';
import { addons } from '@storybook/preview-api';

// Event channels matching manager.tsx
const ADDON_ID = 'story-ui';
const EVENTS = {
  SELECT_GENERATED_STORY: `${ADDON_ID}/select-generated-story`,
};

interface GeneratedStory {
  id: string;
  title: string;
  content?: string;
  createdAt: number;
  framework?: string;
}

/**
 * Get the Edge URL from environment
 */
function getEdgeUrl(): string {
  // Check for Vite env variable
  if (typeof import.meta !== 'undefined' && import.meta.env?.VITE_STORY_UI_EDGE_URL) {
    return import.meta.env.VITE_STORY_UI_EDGE_URL;
  }

  // In production Cloudflare Pages, detect from hostname
  if (typeof window !== 'undefined') {
    const hostname = window.location.hostname;
    if (hostname.includes('pages.dev') || hostname.includes('cloudflare')) {
      return 'https://story-ui-mcp-edge.southleft-llc.workers.dev';
    }
  }

  return '';
}

/**
 * Extract renderable JSX from story content
 */
function extractJSXFromStory(storyContent: string): string {
  // Try to extract the render function content
  const renderMatch = storyContent.match(/render:\s*\(\)\s*=>\s*\(([\s\S]*?)\),?\s*}/);
  if (renderMatch) {
    return renderMatch[1].trim();
  }

  // Try to find JSX after the component definition
  const jsxMatch = storyContent.match(/return\s*\(([\s\S]*?)\);?\s*\}/);
  if (jsxMatch) {
    return jsxMatch[1].trim();
  }

  // Fallback
  return `<div style={{ padding: '20px', textAlign: 'center' }}>
    <p>Unable to extract renderable content from this story.</p>
  </div>`;
}

/**
 * Styles for the renderer
 */
const styles = {
  container: {
    padding: '20px',
    minHeight: '100vh',
    boxSizing: 'border-box' as const,
  },
  header: {
    marginBottom: '20px',
    paddingBottom: '16px',
    borderBottom: '1px solid #e0e0e0',
  },
  title: {
    margin: '0 0 8px 0',
    fontSize: '24px',
    fontWeight: 500 as const,
    color: '#1e1e1e',
  },
  meta: {
    fontSize: '12px',
    color: '#666',
  },
  preview: {
    background: '#fff',
    borderRadius: '8px',
    padding: '40px',
    boxShadow: '0 2px 8px rgba(0,0,0,0.1)',
    minHeight: '200px',
  },
  loading: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    height: '200px',
    color: '#666',
  },
  error: {
    padding: '20px',
    background: '#ffebee',
    borderRadius: '8px',
    color: '#d32f2f',
  },
  empty: {
    textAlign: 'center' as const,
    padding: '60px 20px',
    color: '#666',
  },
  emptyIcon: {
    fontSize: '48px',
    marginBottom: '16px',
  },
  iframe: {
    width: '100%',
    minHeight: '400px',
    border: 'none',
    borderRadius: '8px',
    background: '#fff',
  },
};

/**
 * Generated Story Renderer Component
 */
const GeneratedStoryRendererComponent: React.FC = () => {
  const [selectedStory, setSelectedStory] = useState<GeneratedStory | null>(null);
  const [storyContent, setStoryContent] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const iframeRef = useRef<HTMLIFrameElement>(null);

  const fetchStoryContent = useCallback(async (storyId: string) => {
    setLoading(true);
    setError(null);

    try {
      const edgeUrl = getEdgeUrl();
      if (!edgeUrl) {
        throw new Error('Edge URL not configured');
      }

      const response = await fetch(`${edgeUrl}/story-ui/stories/${storyId}`);
      if (!response.ok) {
        throw new Error(`Failed to fetch story: ${response.statusText}`);
      }

      const data = await response.json();
      setStoryContent(data.content);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load story');
    } finally {
      setLoading(false);
    }
  }, []);

  // Listen for story selection events from the manager
  useEffect(() => {
    const channel = addons.getChannel();

    const handleSelectStory = (story: GeneratedStory) => {
      setSelectedStory(story);
      setError(null);
      fetchStoryContent(story.id);
    };

    channel.on(EVENTS.SELECT_GENERATED_STORY, handleSelectStory);

    return () => {
      channel.off(EVENTS.SELECT_GENERATED_STORY, handleSelectStory);
    };
  }, [fetchStoryContent]);

  // Render story in iframe when content is available
  useEffect(() => {
    if (storyContent && iframeRef.current) {
      const jsxContent = extractJSXFromStory(storyContent);
      const html = generatePreviewHtml(selectedStory?.title || 'Generated Story', jsxContent);
      iframeRef.current.srcdoc = html;
    }
  }, [storyContent, selectedStory]);

  if (!selectedStory) {
    return (
      <div style={styles.container}>
        <div style={styles.empty}>
          <div style={styles.emptyIcon}>&#128214;</div>
          <h3>Generated Story Renderer</h3>
          <p>Select a generated story from the "Generated" panel below to view it here.</p>
          <p style={{ fontSize: '12px', marginTop: '20px' }}>
            Open the "Generated" panel in the addon bar below to see your generated stories.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div style={styles.container}>
      <div style={styles.header}>
        <h1 style={styles.title}>{selectedStory.title}</h1>
        <div style={styles.meta}>
          ID: {selectedStory.id} | Created: {new Date(selectedStory.createdAt).toLocaleString()}
          {selectedStory.framework && ` | Framework: ${selectedStory.framework}`}
        </div>
      </div>

      <div style={styles.preview}>
        {loading && (
          <div style={styles.loading}>Loading story...</div>
        )}

        {error && (
          <div style={styles.error}>
            <strong>Error:</strong> {error}
          </div>
        )}

        {!loading && !error && storyContent && (
          <iframe
            ref={iframeRef}
            style={styles.iframe}
            title={`Preview: ${selectedStory.title}`}
            sandbox="allow-scripts"
          />
        )}
      </div>
    </div>
  );
};

/**
 * Generate the preview HTML for the iframe
 */
function generatePreviewHtml(title: string, jsxContent: string): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${title}</title>
  <script src="https://unpkg.com/react@18/umd/react.development.js" crossorigin></script>
  <script src="https://unpkg.com/react-dom@18/umd/react-dom.development.js" crossorigin></script>
  <script src="https://unpkg.com/@babel/standalone/babel.min.js"></script>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      padding: 20px;
    }
    .card {
      border: 1px solid #e0e0e0;
      border-radius: 8px;
      padding: 16px;
      margin: 8px;
      background: white;
      box-shadow: 0 1px 3px rgba(0,0,0,0.1);
    }
    .card-grid {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(250px, 1fr));
      gap: 16px;
    }
    button {
      padding: 8px 16px;
      border-radius: 4px;
      border: 1px solid #ddd;
      cursor: pointer;
      font-size: 14px;
      background: #fff;
    }
    button:hover { background: #f5f5f5; }
    button.primary {
      background: #1976d2;
      color: white;
      border: none;
    }
    button.primary:hover { background: #1565c0; }
    .error-message {
      color: #d32f2f;
      padding: 20px;
      background: #ffebee;
      border-radius: 8px;
    }
  </style>
</head>
<body>
  <div id="root"></div>
  <script type="text/babel" data-presets="react">
    const { useState, useEffect } = React;

    const Card = ({ children, title, ...props }) => (
      <div className="card" {...props}>
        {title && <h3 style={{ margin: '0 0 12px 0' }}>{title}</h3>}
        {children}
      </div>
    );

    const Button = ({ children, variant = 'default', onClick, ...props }) => (
      <button className={variant === 'primary' ? 'primary' : ''} onClick={onClick} {...props}>
        {children}
      </button>
    );

    const StoryPreview = () => {
      try {
        return (${jsxContent});
      } catch (error) {
        return <div className="error-message">Render Error: {error.message}</div>;
      }
    };

    class ErrorBoundary extends React.Component {
      constructor(props) {
        super(props);
        this.state = { hasError: false, error: null };
      }
      static getDerivedStateFromError(error) {
        return { hasError: true, error };
      }
      render() {
        if (this.state.hasError) {
          return <div className="error-message">Preview Error: {this.state.error?.message}</div>;
        }
        return this.props.children;
      }
    }

    const root = ReactDOM.createRoot(document.getElementById('root'));
    root.render(<ErrorBoundary><StoryPreview /></ErrorBoundary>);
  </script>
</body>
</html>`;
}

// Meta configuration
const meta = {
  title: 'StoryUI/Generated',
  component: GeneratedStoryRendererComponent,
  parameters: {
    layout: 'fullscreen',
    // Hide from docs to keep sidebar clean
    docs: { disable: true },
  },
} satisfies Meta<typeof GeneratedStoryRendererComponent>;

export default meta;
type Story = StoryObj<typeof meta>;

// Default story - this is the renderer that gets displayed
export const StoryRenderer: Story = {
  render: () => <GeneratedStoryRendererComponent />,
};
