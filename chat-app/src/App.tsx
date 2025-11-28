import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';

// ============================================================================
// TYPES
// ============================================================================

interface Message {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  timestamp: number;
  generatedCode?: string;
  images?: ImageAttachment[];
  isStreaming?: boolean;
}

interface ImageAttachment {
  id: string;
  data: string; // base64
  type: string;
  name: string;
}

interface Conversation {
  id: string;
  title: string;
  messages: Message[];
  createdAt: number;
  updatedAt: number;
}

interface ModelOption {
  id: string;
  name: string;
  provider?: string;
  description?: string;
  isDefault?: boolean;
  isRecommended?: boolean;
}

interface ProviderOption {
  id: string;
  name: string;
  isDefault?: boolean;
  isRecommended?: boolean;
}

interface ServerConfig {
  providers: ProviderOption[];
  currentProvider: string;
  models: ModelOption[];
  currentModel: string;
  framework: string;
  isConfigured: boolean;
  loading: boolean;
  error: string | null;
  singleProviderMode: boolean;
}

// ============================================================================
// CONSTANTS & CONFIG
// ============================================================================

// Server URL - from URL params, env var, or default to same origin
const getServerUrl = (): string => {
  const params = new URLSearchParams(window.location.search);
  const urlServer = params.get('server');
  if (urlServer) return urlServer;

  // Check if running in development with a different server
  if (import.meta.env.VITE_STORY_UI_SERVER) {
    return import.meta.env.VITE_STORY_UI_SERVER;
  }

  // Default: same origin (for when deployed alongside Story UI server)
  return window.location.origin;
};

const SERVER_URL = getServerUrl();

// Fallback models for all providers (used if server doesn't provide them)
const DEFAULT_MODELS_BY_PROVIDER: Record<string, ModelOption[]> = {
  claude: [
    { id: 'claude-opus-4-5-20251101', name: 'Claude Opus 4.5', provider: 'claude' },
    { id: 'claude-sonnet-4-5-20250929', name: 'Claude Sonnet 4.5', provider: 'claude' },
    { id: 'claude-sonnet-4-20250514', name: 'Claude Sonnet 4', provider: 'claude' },
  ],
  openai: [
    { id: 'gpt-5.1', name: 'GPT-5.1', provider: 'openai' },
    { id: 'gpt-4o', name: 'GPT-4o', provider: 'openai' },
    { id: 'gpt-4o-mini', name: 'GPT-4o Mini', provider: 'openai' },
  ],
  gemini: [
    { id: 'gemini-3-pro', name: 'Gemini 3 Pro', provider: 'gemini' },
    { id: 'gemini-2.0-flash', name: 'Gemini 2.0 Flash', provider: 'gemini' },
    { id: 'gemini-1.5-pro', name: 'Gemini 1.5 Pro', provider: 'gemini' },
  ],
};

const THEME = {
  // Backgrounds
  bg: '#09090b',
  bgSurface: '#18181b',
  bgElevated: '#27272a',
  bgHover: '#3f3f46',

  // Borders
  border: '#27272a',
  borderSubtle: '#3f3f46',

  // Text
  text: '#fafafa',
  textMuted: '#a1a1aa',
  textSubtle: '#71717a',

  // Accent
  accent: '#3b82f6',
  accentHover: '#2563eb',
  accentMuted: 'rgba(59, 130, 246, 0.15)',

  // Status
  success: '#22c55e',
  error: '#ef4444',
  warning: '#f59e0b',

  // Effects
  glow: '0 0 20px rgba(59, 130, 246, 0.3)',
  shadow: '0 4px 6px -1px rgba(0, 0, 0, 0.3), 0 2px 4px -1px rgba(0, 0, 0, 0.2)',
};

const generateId = () => Math.random().toString(36).substring(2, 15);

// ============================================================================
// SYSTEM PROMPT
// ============================================================================

const getSystemPrompt = (framework: string) => `You are a UI component generator. When given a description, generate clean, working code.

FRAMEWORK: ${framework}

IMPORTANT RULES:
1. Return ONLY the code - no imports, no explanations, no markdown code blocks
2. Use modern, professional styling with a dark theme aesthetic
3. Colors: Use #09090b (background), #18181b (surface), #27272a (elevated), #3b82f6 (accent blue), #22c55e (success), #ef4444 (error)
4. Keep code simple and self-contained - no external dependencies
5. Use placeholder data for content (lorem ipsum for text)
6. Make components visually polished with smooth transitions

${framework === 'react' || framework === 'react-tailwind' ? `
For React: Return a single JSX expression. Use inline styles (camelCase) or Tailwind classes.
Example: <div style={{ padding: '24px', background: '#18181b' }}>Content</div>
` : ''}

${framework === 'vue' ? `
For Vue: Return template content only, using inline styles.
Example: <div :style="{ padding: '24px', background: '#18181b' }">Content</div>
` : ''}

${framework === 'html' ? `
For HTML: Return HTML with embedded <style> tag.
Example: <style>.card { padding: 24px; }</style><div class="card">Content</div>
` : ''}

Only respond with the code, nothing else.`;

// ============================================================================
// HOOKS
// ============================================================================

const useLocalStorage = <T,>(key: string, initialValue: T): [T, React.Dispatch<React.SetStateAction<T>>] => {
  const [storedValue, setStoredValue] = useState<T>(() => {
    try {
      const item = window.localStorage.getItem(key);
      return item ? JSON.parse(item) : initialValue;
    } catch {
      return initialValue;
    }
  });

  const setValue: React.Dispatch<React.SetStateAction<T>> = (value) => {
    const valueToStore = value instanceof Function ? value(storedValue) : value;
    setStoredValue(valueToStore);
    window.localStorage.setItem(key, JSON.stringify(valueToStore));
  };

  return [storedValue, setValue];
};

const useResizable = (initialWidth: number, minWidth: number, maxWidth: number) => {
  const [width, setWidth] = useState(initialWidth);
  const isDragging = useRef(false);
  const startX = useRef(0);
  const startWidth = useRef(0);

  const startResize = useCallback((e: React.MouseEvent) => {
    isDragging.current = true;
    startX.current = e.clientX;
    startWidth.current = width;
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';
  }, [width]);

  useEffect(() => {
    const handleMouseMove = (e: MouseEvent) => {
      if (!isDragging.current) return;
      const delta = e.clientX - startX.current;
      const newWidth = Math.min(Math.max(startWidth.current + delta, minWidth), maxWidth);
      setWidth(newWidth);
    };

    const handleMouseUp = () => {
      isDragging.current = false;
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
    };

    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseup', handleMouseUp);
    return () => {
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
    };
  }, [minWidth, maxWidth]);

  return { width, startResize };
};

// Simplified hook with hardcoded defaults - no server config fetch needed
// This allows the chat app to work standalone with any backend
const useServerConfig = (): ServerConfig & {
  refetch: () => Promise<void>;
  changeProvider: (provider: string) => Promise<void>;
} => {
  // Hardcoded config - single provider mode, no dropdowns needed
  const config: ServerConfig = {
    providers: [{ id: 'claude', name: 'Anthropic Claude', isDefault: true }],
    currentProvider: 'claude',
    models: DEFAULT_MODELS_BY_PROVIDER.claude,
    currentModel: DEFAULT_MODELS_BY_PROVIDER.claude[0].id,
    framework: 'react',
    isConfigured: true,
    loading: false,
    error: null,
    singleProviderMode: true, // Always single provider - no dropdown
  };

  // No-op functions since we're using hardcoded config
  const refetch = useCallback(async () => {}, []);
  const changeProvider = useCallback(async () => {}, []);

  return { ...config, refetch, changeProvider };
};

// ============================================================================
// COMPONENTS
// ============================================================================

// Icon Components
const Icons = {
  Plus: () => (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2">
      <path d="M8 3v10M3 8h10" />
    </svg>
  ),
  Trash: () => (
    <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5">
      <path d="M3 4h10M6 4V3a1 1 0 011-1h2a1 1 0 011 1v1M5 4v9a1 1 0 001 1h4a1 1 0 001-1V4" />
    </svg>
  ),
  Send: () => (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <path d="M22 2L11 13M22 2l-7 20-4-9-9-4 20-7z" />
    </svg>
  ),
  Image: () => (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <rect x="3" y="3" width="18" height="18" rx="2" />
      <circle cx="8.5" cy="8.5" r="1.5" />
      <path d="M21 15l-5-5L5 21" />
    </svg>
  ),
  Code: () => (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <path d="M16 18l6-6-6-6M8 6l-6 6 6 6" />
    </svg>
  ),
  Eye: () => (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
      <circle cx="12" cy="12" r="3" />
    </svg>
  ),
  Copy: () => (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <rect x="9" y="9" width="13" height="13" rx="2" />
      <path d="M5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v1" />
    </svg>
  ),
  Sidebar: () => (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <rect x="3" y="3" width="18" height="18" rx="2" />
      <path d="M9 3v18" />
    </svg>
  ),
  Check: () => (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <path d="M20 6L9 17l-5-5" />
    </svg>
  ),
  X: () => (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <path d="M18 6L6 18M6 6l12 12" />
    </svg>
  ),
  ChevronDown: () => (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <path d="M6 9l6 6 6-6" />
    </svg>
  ),
  Server: () => (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <rect x="2" y="2" width="20" height="8" rx="2" />
      <rect x="2" y="14" width="20" height="8" rx="2" />
      <circle cx="6" cy="6" r="1" fill="currentColor" />
      <circle cx="6" cy="18" r="1" fill="currentColor" />
    </svg>
  ),
  AlertCircle: () => (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <circle cx="12" cy="12" r="10" />
      <line x1="12" y1="8" x2="12" y2="12" />
      <line x1="12" y1="16" x2="12.01" y2="16" />
    </svg>
  ),
  Refresh: () => (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <path d="M23 4v6h-6M1 20v-6h6" />
      <path d="M3.51 9a9 9 0 0114.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0020.49 15" />
    </svg>
  ),
};

// Dropdown Component
const Dropdown: React.FC<{
  label: string;
  value: string;
  options: { id: string; name: string; description?: string }[];
  onChange: (value: string) => void;
  disabled?: boolean;
}> = ({ label, value, options, onChange, disabled }) => {
  const [isOpen, setIsOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const selectedOption = options.find(o => o.id === value);

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setIsOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  return (
    <div ref={ref} style={{ position: 'relative' }}>
      <button
        onClick={() => !disabled && setIsOpen(!isOpen)}
        disabled={disabled}
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: '8px',
          padding: '8px 12px',
          background: THEME.bgSurface,
          border: `1px solid ${THEME.border}`,
          borderRadius: '8px',
          color: disabled ? THEME.textSubtle : THEME.text,
          fontSize: '13px',
          cursor: disabled ? 'not-allowed' : 'pointer',
          transition: 'all 0.2s',
          opacity: disabled ? 0.6 : 1,
        }}
      >
        <span style={{ color: THEME.textMuted, fontSize: '11px', textTransform: 'uppercase', letterSpacing: '0.5px' }}>
          {label}
        </span>
        <span>{selectedOption?.name || 'Select'}</span>
        <Icons.ChevronDown />
      </button>
      {isOpen && !disabled && (
        <div
          style={{
            position: 'absolute',
            top: '100%',
            left: 0,
            marginTop: '4px',
            minWidth: '220px',
            maxHeight: '300px',
            overflowY: 'auto',
            background: THEME.bgElevated,
            border: `1px solid ${THEME.border}`,
            borderRadius: '8px',
            boxShadow: THEME.shadow,
            zIndex: 100,
            overflow: 'hidden',
          }}
        >
          {options.map(option => (
            <button
              key={option.id}
              onClick={() => {
                onChange(option.id);
                setIsOpen(false);
              }}
              style={{
                display: 'block',
                width: '100%',
                padding: '10px 14px',
                background: option.id === value ? THEME.accentMuted : 'transparent',
                border: 'none',
                textAlign: 'left',
                color: THEME.text,
                fontSize: '13px',
                cursor: 'pointer',
                transition: 'background 0.15s',
              }}
              onMouseEnter={e => {
                if (option.id !== value) e.currentTarget.style.background = THEME.bgHover;
              }}
              onMouseLeave={e => {
                e.currentTarget.style.background = option.id === value ? THEME.accentMuted : 'transparent';
              }}
            >
              <div style={{ fontWeight: 500 }}>{option.name}</div>
              {option.description && (
                <div style={{ fontSize: '11px', color: THEME.textMuted, marginTop: '2px' }}>
                  {option.description}
                </div>
              )}
            </button>
          ))}
        </div>
      )}
    </div>
  );
};

// Image Upload Area
const ImageUploadArea: React.FC<{
  images: ImageAttachment[];
  onImagesChange: (images: ImageAttachment[]) => void;
  disabled?: boolean;
}> = ({ images, onImagesChange, disabled }) => {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [isDragOver, setIsDragOver] = useState(false);

  const handleFiles = useCallback((files: FileList) => {
    Array.from(files).forEach(file => {
      if (file.type.startsWith('image/')) {
        const reader = new FileReader();
        reader.onload = (e) => {
          const newImage: ImageAttachment = {
            id: generateId(),
            data: e.target?.result as string,
            type: file.type,
            name: file.name,
          };
          onImagesChange([...images, newImage]);
        };
        reader.readAsDataURL(file);
      }
    });
  }, [images, onImagesChange]);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragOver(false);
    if (!disabled && e.dataTransfer.files.length) {
      handleFiles(e.dataTransfer.files);
    }
  }, [disabled, handleFiles]);

  const handlePaste = useCallback((e: ClipboardEvent) => {
    if (disabled) return;
    const items = e.clipboardData?.items;
    if (items) {
      for (const item of items) {
        if (item.type.startsWith('image/')) {
          const file = item.getAsFile();
          if (file) {
            handleFiles(new DataTransfer().files);
            const reader = new FileReader();
            reader.onload = (ev) => {
              const newImage: ImageAttachment = {
                id: generateId(),
                data: ev.target?.result as string,
                type: file.type,
                name: file.name,
              };
              onImagesChange([...images, newImage]);
            };
            reader.readAsDataURL(file);
          }
        }
      }
    }
  }, [disabled, handleFiles, images, onImagesChange]);

  useEffect(() => {
    document.addEventListener('paste', handlePaste);
    return () => document.removeEventListener('paste', handlePaste);
  }, [handlePaste]);

  const removeImage = (id: string) => {
    onImagesChange(images.filter(img => img.id !== id));
  };

  return (
    <div style={{ marginBottom: images.length > 0 ? '12px' : 0 }}>
      <input
        ref={fileInputRef}
        type="file"
        accept="image/*"
        multiple
        style={{ display: 'none' }}
        onChange={(e) => e.target.files && handleFiles(e.target.files)}
        disabled={disabled}
      />

      {images.length > 0 && (
        <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap', marginBottom: '8px' }}>
          {images.map(img => (
            <div
              key={img.id}
              style={{
                position: 'relative',
                width: '64px',
                height: '64px',
                borderRadius: '8px',
                overflow: 'hidden',
                border: `1px solid ${THEME.border}`,
              }}
            >
              <img
                src={img.data}
                alt={img.name}
                style={{ width: '100%', height: '100%', objectFit: 'cover' }}
              />
              <button
                onClick={() => removeImage(img.id)}
                style={{
                  position: 'absolute',
                  top: '2px',
                  right: '2px',
                  width: '18px',
                  height: '18px',
                  borderRadius: '50%',
                  background: 'rgba(0,0,0,0.7)',
                  border: 'none',
                  color: '#fff',
                  cursor: 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  fontSize: '10px',
                }}
              >
                <Icons.X />
              </button>
            </div>
          ))}
        </div>
      )}

      <button
        onClick={() => fileInputRef.current?.click()}
        onDragOver={(e) => { e.preventDefault(); setIsDragOver(true); }}
        onDragLeave={() => setIsDragOver(false)}
        onDrop={handleDrop}
        disabled={disabled}
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: '6px',
          padding: '6px 10px',
          background: isDragOver ? THEME.accentMuted : 'transparent',
          border: `1px dashed ${isDragOver ? THEME.accent : THEME.border}`,
          borderRadius: '6px',
          color: THEME.textMuted,
          fontSize: '12px',
          cursor: disabled ? 'not-allowed' : 'pointer',
          transition: 'all 0.2s',
          opacity: disabled ? 0.5 : 1,
        }}
      >
        <Icons.Image />
        <span>Add image</span>
      </button>
    </div>
  );
};

// Streaming Text Effect
const StreamingText: React.FC<{ text: string; speed?: number }> = ({ text, speed = 20 }) => {
  const [displayedText, setDisplayedText] = useState('');
  const [isComplete, setIsComplete] = useState(false);

  useEffect(() => {
    setDisplayedText('');
    setIsComplete(false);
    let index = 0;
    const timer = setInterval(() => {
      if (index < text.length) {
        setDisplayedText(text.slice(0, index + 1));
        index++;
      } else {
        setIsComplete(true);
        clearInterval(timer);
      }
    }, speed);
    return () => clearInterval(timer);
  }, [text, speed]);

  return (
    <span>
      {displayedText}
      {!isComplete && <span style={{ opacity: 0.5, animation: 'blink 1s infinite' }}>|</span>}
    </span>
  );
};

// Code Viewer with Syntax Highlighting
const CodeViewer: React.FC<{ code: string }> = ({ code }) => {
  const [copied, setCopied] = useState(false);

  const handleCopy = async () => {
    await navigator.clipboard.writeText(code);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  // Simple syntax highlighting
  const highlightedCode = useMemo(() => {
    let highlighted = code
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      // Strings
      .replace(/(["'`])(?:(?!\1)[^\\]|\\.)*\1/g, '<span style="color: #a5d6ff">$&</span>')
      // Keywords
      .replace(/\b(const|let|var|function|return|if|else|for|while|import|export|from|default|class|extends|new|this|true|false|null|undefined|style|className|onClick|onChange|onSubmit)\b/g, '<span style="color: #ff7b72">$&</span>')
      // Numbers
      .replace(/\b(\d+)\b/g, '<span style="color: #79c0ff">$&</span>')
      // Comments
      .replace(/(\/\/.*$|\/\*[\s\S]*?\*\/)/gm, '<span style="color: #8b949e">$&</span>')
      // JSX tags
      .replace(/(&lt;\/?)([\w-]+)/g, '$1<span style="color: #7ee787">$2</span>')
      // Props
      .replace(/(\s)([\w-]+)(=)/g, '$1<span style="color: #79c0ff">$2</span>$3');
    return highlighted;
  }, [code]);

  return (
    <div style={{ height: '100%', display: 'flex', flexDirection: 'column' }}>
      <div style={{
        padding: '8px 12px',
        borderBottom: `1px solid ${THEME.border}`,
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
      }}>
        <span style={{ fontSize: '12px', color: THEME.textMuted }}>Generated Code</span>
        <button
          onClick={handleCopy}
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: '4px',
            padding: '4px 8px',
            background: copied ? 'rgba(34, 197, 94, 0.2)' : 'transparent',
            border: `1px solid ${copied ? THEME.success : THEME.border}`,
            borderRadius: '4px',
            color: copied ? THEME.success : THEME.textMuted,
            fontSize: '11px',
            cursor: 'pointer',
            transition: 'all 0.2s',
          }}
        >
          {copied ? <Icons.Check /> : <Icons.Copy />}
          {copied ? 'Copied!' : 'Copy'}
        </button>
      </div>
      <pre
        style={{
          flex: 1,
          margin: 0,
          padding: '16px',
          overflow: 'auto',
          fontSize: '13px',
          lineHeight: 1.6,
          fontFamily: '"Fira Code", "SF Mono", Monaco, monospace',
          background: '#0d1117',
          color: '#e6edf3',
        }}
        dangerouslySetInnerHTML={{ __html: highlightedCode }}
      />
    </div>
  );
};

// Preview Iframe Component
const PreviewIframe: React.FC<{ code: string; framework: string }> = ({ code, framework }) => {
  const iframeRef = useRef<HTMLIFrameElement>(null);

  useEffect(() => {
    if (iframeRef.current) {
      const html = generatePreviewHtml(code, framework);
      iframeRef.current.srcdoc = html;
    }
  }, [code, framework]);

  return (
    <iframe
      ref={iframeRef}
      style={{
        width: '100%',
        height: '100%',
        border: 'none',
        background: THEME.bgSurface,
        borderRadius: '8px',
      }}
      title="Component Preview"
      sandbox="allow-scripts"
    />
  );
};

// Generate preview HTML
function generatePreviewHtml(code: string, framework: string): string {
  let cleanCode = code.trim();
  if (cleanCode.startsWith('```')) {
    cleanCode = cleanCode.replace(/^```(?:jsx|tsx|javascript|js|vue|html)?\n?/, '').replace(/\n?```$/, '');
  }

  if (framework === 'html') {
    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      padding: 24px;
      background: ${THEME.bg};
      color: ${THEME.text};
      min-height: 100vh;
    }
  </style>
</head>
<body>
  ${cleanCode}
</body>
</html>`;
  }

  if (framework === 'vue') {
    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <script src="https://unpkg.com/vue@3/dist/vue.global.js"></script>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      padding: 24px;
      background: ${THEME.bg};
      color: ${THEME.text};
      min-height: 100vh;
    }
  </style>
</head>
<body>
  <div id="app">${cleanCode}</div>
  <script>
    Vue.createApp({}).mount('#app')
  </script>
</body>
</html>`;
  }

  // React (default)
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <script src="https://unpkg.com/react@18/umd/react.development.js" crossorigin></script>
  <script src="https://unpkg.com/react-dom@18/umd/react-dom.development.js" crossorigin></script>
  <script src="https://unpkg.com/@babel/standalone/babel.min.js"></script>
  ${framework === 'react-tailwind' ? '<script src="https://cdn.tailwindcss.com"></script>' : ''}
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      padding: 24px;
      background: ${THEME.bg};
      color: ${THEME.text};
      min-height: 100vh;
    }
    .error-message {
      color: ${THEME.error};
      padding: 16px;
      background: rgba(239, 68, 68, 0.1);
      border-left: 3px solid ${THEME.error};
      font-size: 14px;
      border-radius: 4px;
    }
  </style>
</head>
<body>
  <div id="root"></div>
  <script type="text/babel" data-presets="react">
    const { useState, useEffect, useRef, useCallback } = React;

    const Component = () => {
      try {
        return (${cleanCode});
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
          return <div className="error-message">Error: {this.state.error?.message}</div>;
        }
        return this.props.children;
      }
    }

    const root = ReactDOM.createRoot(document.getElementById('root'));
    root.render(<ErrorBoundary><Component /></ErrorBoundary>);
  </script>
</body>
</html>`;
}

// Loading Dots
const LoadingDots: React.FC = () => (
  <div style={{ display: 'flex', gap: '4px', alignItems: 'center' }}>
    {[0, 1, 2].map(i => (
      <div
        key={i}
        style={{
          width: '6px',
          height: '6px',
          borderRadius: '50%',
          background: THEME.accent,
          animation: `pulse 1.4s ease-in-out ${i * 0.2}s infinite`,
        }}
      />
    ))}
  </div>
);

// Provider name mapping for display
const getProviderDisplayName = (providerId: string): string => {
  const names: Record<string, string> = {
    claude: 'Claude',
    openai: 'OpenAI',
    gemini: 'Gemini',
  };
  return names[providerId] || providerId;
};

// Server Status Badge
const ServerStatusBadge: React.FC<{
  loading: boolean;
  error: string | null;
  provider: string;
  framework: string;
  onRetry: () => void;
}> = ({ loading, error, provider, framework, onRetry }) => {
  if (loading) {
    return (
      <div style={{
        display: 'flex',
        alignItems: 'center',
        gap: '6px',
        padding: '6px 10px',
        background: THEME.bgSurface,
        borderRadius: '6px',
        fontSize: '12px',
        color: THEME.textMuted,
      }}>
        <LoadingDots />
        <span>Connecting...</span>
      </div>
    );
  }

  if (error) {
    return (
      <div style={{
        display: 'flex',
        alignItems: 'center',
        gap: '6px',
        padding: '6px 10px',
        background: 'rgba(239, 68, 68, 0.1)',
        borderRadius: '6px',
        fontSize: '12px',
        color: THEME.error,
      }}>
        <Icons.AlertCircle />
        <span>Server Error</span>
        <button
          onClick={onRetry}
          style={{
            background: 'transparent',
            border: 'none',
            color: THEME.error,
            cursor: 'pointer',
            padding: '2px',
            display: 'flex',
            alignItems: 'center',
          }}
          title="Retry connection"
        >
          <Icons.Refresh />
        </button>
      </div>
    );
  }

  return (
    <div style={{
      display: 'flex',
      alignItems: 'center',
      gap: '8px',
      padding: '6px 10px',
      background: THEME.bgSurface,
      borderRadius: '6px',
      fontSize: '12px',
      color: THEME.textMuted,
    }}>
      <div style={{
        width: '6px',
        height: '6px',
        borderRadius: '50%',
        background: THEME.success,
      }} />
      <span>{getProviderDisplayName(provider)}</span>
      <span style={{ color: THEME.textSubtle }}>|</span>
      <span style={{ textTransform: 'capitalize' }}>{framework}</span>
    </div>
  );
};

// ============================================================================
// MAIN APP
// ============================================================================

const App: React.FC = () => {
  // Server configuration
  const serverConfig = useServerConfig();

  // State
  const [conversations, setConversations] = useLocalStorage<Conversation[]>('storyui_conversations', []);
  const [activeConversationId, setActiveConversationId] = useState<string | null>(null);
  const [inputValue, setInputValue] = useState('');
  const [isGenerating, setIsGenerating] = useState(false);
  const [previewCode, setPreviewCode] = useState<string | null>(null);
  const [selectedModel, setSelectedModel] = useState<string>('');
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [previewTab, setPreviewTab] = useState<'preview' | 'code'>('preview');
  const [images, setImages] = useState<ImageAttachment[]>([]);

  // Update selected model when server config loads or changes
  useEffect(() => {
    if (serverConfig.currentModel && !serverConfig.loading) {
      setSelectedModel(serverConfig.currentModel);
    }
  }, [serverConfig.currentModel, serverConfig.loading]);

  // Refs
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  // Resizable panels - smaller chat panel to give more room to preview
  const { width: chatWidth, startResize } = useResizable(380, 300, 500);

  // Computed
  const activeConversation = conversations.find(c => c.id === activeConversationId);
  const framework = serverConfig.framework;
  const showProviderDropdown = !serverConfig.singleProviderMode && serverConfig.providers.length > 1;

  // Effects
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [activeConversation?.messages]);

  useEffect(() => {
    if (conversations.length > 0 && !activeConversationId) {
      setActiveConversationId(conversations[0].id);
      const lastMsgWithCode = [...conversations[0].messages].reverse().find(m => m.generatedCode);
      setPreviewCode(lastMsgWithCode?.generatedCode || null);
    } else if (conversations.length === 0) {
      createNewConversation();
    }
  }, [conversations.length, activeConversationId]);

  // Actions
  const createNewConversation = useCallback(() => {
    const newConversation: Conversation = {
      id: generateId(),
      title: 'New Conversation',
      messages: [],
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };
    setConversations(prev => [newConversation, ...prev]);
    setActiveConversationId(newConversation.id);
    setPreviewCode(null);
    setImages([]);
    inputRef.current?.focus();
  }, [setConversations]);

  const deleteConversation = (id: string) => {
    setConversations(prev => prev.filter(c => c.id !== id));
    if (activeConversationId === id) {
      const remaining = conversations.filter(c => c.id !== id);
      if (remaining.length > 0) {
        setActiveConversationId(remaining[0].id);
      } else {
        createNewConversation();
      }
    }
  };

  // Handle provider change
  const handleProviderChange = async (providerId: string) => {
    await serverConfig.changeProvider(providerId);
  };

  const generateComponent = async (prompt: string, imageAttachments: ImageAttachment[]): Promise<string> => {
    const conversationHistory = activeConversation?.messages.map(msg => ({
      role: msg.role,
      content: msg.role === 'assistant' && msg.generatedCode
        ? `Generated component:\n${msg.generatedCode}`
        : msg.content
    })) || [];

    // Build messages array for the server
    const messages = [
      ...conversationHistory.map(msg => ({
        role: msg.role as 'user' | 'assistant',
        content: msg.content,
      })),
    ];

    // Build user content with images
    if (imageAttachments.length > 0) {
      const userContent: Array<{ type: string; text?: string; source?: { type: string; media_type: string; data: string } }> = [];

      imageAttachments.forEach(img => {
        userContent.push({
          type: 'image',
          source: {
            type: 'base64',
            media_type: img.type,
            data: img.data.split(',')[1],
          }
        });
      });

      userContent.push({ type: 'text', text: prompt });
      messages.push({ role: 'user' as const, content: userContent as unknown as string });
    } else {
      messages.push({ role: 'user' as const, content: prompt });
    }

    // Call the Story UI server proxy endpoint
    const response = await fetch(`${SERVER_URL}/story-ui/claude`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        prompt,
        messages: conversationHistory,
        systemPrompt: getSystemPrompt(framework),
        model: selectedModel,
        maxTokens: 4096,
        images: imageAttachments.map(img => ({
          type: img.type,
          data: img.data.split(',')[1],
        })),
      }),
    });

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      throw new Error(errorData.error || `Server Error: ${response.status}`);
    }

    const data = await response.json();
    const content = data.content?.[0]?.text || data.content || '';

    // Extract code from response
    if (typeof content === 'string') {
      const codeMatch = content.match(/```[\s\S]*?```/);
      if (codeMatch) {
        return codeMatch[0].replace(/^```(?:jsx|tsx|javascript|js|vue|html)?\n?/, '').replace(/\n?```$/, '');
      }

      const jsxMatch = content.match(/<[\s\S]*>/);
      return jsxMatch ? jsxMatch[0] : content;
    }

    return content;
  };

  const sendMessage = async () => {
    if (!inputValue.trim() || !activeConversationId || isGenerating) return;

    if (!serverConfig.isConfigured && serverConfig.error) {
      // Try to reconnect
      await serverConfig.refetch();
      return;
    }

    const userMessage: Message = {
      id: generateId(),
      role: 'user',
      content: inputValue.trim(),
      timestamp: Date.now(),
      images: images.length > 0 ? [...images] : undefined,
    };

    setConversations(prev => prev.map(conv => {
      if (conv.id === activeConversationId) {
        return {
          ...conv,
          messages: [...conv.messages, userMessage],
          updatedAt: Date.now(),
          title: conv.messages.length === 0 ? inputValue.trim().substring(0, 40) : conv.title,
        };
      }
      return conv;
    }));

    const currentImages = [...images];
    setInputValue('');
    setImages([]);
    setIsGenerating(true);

    try {
      const generatedCode = await generateComponent(inputValue.trim(), currentImages);

      const assistantMessage: Message = {
        id: generateId(),
        role: 'assistant',
        content: 'Component generated successfully.',
        timestamp: Date.now(),
        generatedCode,
      };

      setConversations(prev => prev.map(conv => {
        if (conv.id === activeConversationId) {
          return {
            ...conv,
            messages: [...conv.messages, assistantMessage],
            updatedAt: Date.now(),
          };
        }
        return conv;
      }));

      if (generatedCode) {
        setPreviewCode(generatedCode);
        setPreviewTab('preview');
      }
    } catch (error) {
      const errorMessage: Message = {
        id: generateId(),
        role: 'assistant',
        content: `Error: ${error instanceof Error ? error.message : 'Unknown error'}`,
        timestamp: Date.now(),
      };

      setConversations(prev => prev.map(conv => {
        if (conv.id === activeConversationId) {
          return {
            ...conv,
            messages: [...conv.messages, errorMessage],
            updatedAt: Date.now(),
          };
        }
        return conv;
      }));
    } finally {
      setIsGenerating(false);
    }
  };

  const handleKeyPress = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      sendMessage();
    }
  };

  // Render
  return (
    <div style={{
      display: 'flex',
      height: '100vh',
      overflow: 'hidden',
      background: THEME.bg,
      color: THEME.text,
      fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
    }}>
      {/* Global Styles */}
      <style>{`
        @keyframes pulse {
          0%, 100% { opacity: 0.4; transform: scale(0.8); }
          50% { opacity: 1; transform: scale(1); }
        }
        @keyframes blink {
          0%, 100% { opacity: 1; }
          50% { opacity: 0; }
        }
        ::-webkit-scrollbar { width: 6px; height: 6px; }
        ::-webkit-scrollbar-track { background: transparent; }
        ::-webkit-scrollbar-thumb { background: ${THEME.bgElevated}; border-radius: 3px; }
        ::-webkit-scrollbar-thumb:hover { background: ${THEME.bgHover}; }
        ::selection { background: ${THEME.accentMuted}; }
      `}</style>

      {/* Sidebar */}
      <aside
        style={{
          width: sidebarCollapsed ? '60px' : '240px',
          background: THEME.bgSurface,
          borderRight: `1px solid ${THEME.border}`,
          display: 'flex',
          flexDirection: 'column',
          transition: 'width 0.2s ease',
          overflow: 'hidden',
        }}
      >
        {/* Sidebar Header */}
        <div style={{
          padding: '16px',
          borderBottom: `1px solid ${THEME.border}`,
          display: 'flex',
          alignItems: 'center',
          justifyContent: sidebarCollapsed ? 'center' : 'space-between',
        }}>
          {!sidebarCollapsed && (
            <h1 style={{
              fontSize: '16px',
              fontWeight: 600,
              background: `linear-gradient(135deg, ${THEME.accent}, #8b5cf6)`,
              WebkitBackgroundClip: 'text',
              WebkitTextFillColor: 'transparent',
              letterSpacing: '-0.5px',
            }}>
              Story UI
            </h1>
          )}
          <button
            onClick={() => setSidebarCollapsed(!sidebarCollapsed)}
            style={{
              padding: '8px',
              background: 'transparent',
              border: 'none',
              color: THEME.textMuted,
              cursor: 'pointer',
              borderRadius: '6px',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              transition: 'all 0.2s',
            }}
            title={sidebarCollapsed ? 'Expand sidebar' : 'Collapse sidebar'}
          >
            <Icons.Sidebar />
          </button>
        </div>

        {/* New Chat Button */}
        <div style={{ padding: sidebarCollapsed ? '8px' : '12px' }}>
          <button
            onClick={createNewConversation}
            style={{
              width: '100%',
              padding: sidebarCollapsed ? '10px' : '10px 14px',
              background: THEME.accent,
              border: 'none',
              borderRadius: '8px',
              color: '#fff',
              fontSize: '13px',
              fontWeight: 500,
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: '8px',
              transition: 'all 0.2s',
            }}
          >
            <Icons.Plus />
            {!sidebarCollapsed && 'New Chat'}
          </button>
        </div>

        {/* Conversation List */}
        {!sidebarCollapsed && (
          <div style={{ flex: 1, overflow: 'auto', padding: '8px 12px' }}>
            {conversations.map(conv => (
              <div
                key={conv.id}
                onClick={() => {
                  setActiveConversationId(conv.id);
                  const lastMsgWithCode = [...conv.messages].reverse().find(m => m.generatedCode);
                  setPreviewCode(lastMsgWithCode?.generatedCode || null);
                }}
                style={{
                  padding: '10px 12px',
                  marginBottom: '4px',
                  borderRadius: '8px',
                  cursor: 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  background: conv.id === activeConversationId ? THEME.bgElevated : 'transparent',
                  transition: 'all 0.15s',
                }}
                onMouseEnter={e => {
                  if (conv.id !== activeConversationId) {
                    e.currentTarget.style.background = THEME.bgElevated;
                  }
                }}
                onMouseLeave={e => {
                  if (conv.id !== activeConversationId) {
                    e.currentTarget.style.background = 'transparent';
                  }
                }}
              >
                <span style={{
                  fontSize: '13px',
                  color: conv.id === activeConversationId ? THEME.text : THEME.textMuted,
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  whiteSpace: 'nowrap',
                  flex: 1,
                }}>
                  {conv.title}
                </span>
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    deleteConversation(conv.id);
                  }}
                  style={{
                    padding: '4px',
                    background: 'transparent',
                    border: 'none',
                    color: THEME.textSubtle,
                    cursor: 'pointer',
                    opacity: 0.5,
                    transition: 'opacity 0.2s',
                    display: 'flex',
                    alignItems: 'center',
                  }}
                  onMouseEnter={e => e.currentTarget.style.opacity = '1'}
                  onMouseLeave={e => e.currentTarget.style.opacity = '0.5'}
                >
                  <Icons.Trash />
                </button>
              </div>
            ))}
          </div>
        )}

        {/* Sidebar Footer - Server Status */}
        {!sidebarCollapsed && (
          <div style={{
            padding: '12px',
            borderTop: `1px solid ${THEME.border}`,
          }}>
            <ServerStatusBadge
              loading={serverConfig.loading}
              error={serverConfig.error}
              provider={serverConfig.currentProvider}
              framework={serverConfig.framework}
              onRetry={serverConfig.refetch}
            />
          </div>
        )}
      </aside>

      {/* Chat Panel */}
      <div style={{
        width: `${chatWidth}px`,
        display: 'flex',
        flexDirection: 'column',
        background: THEME.bg,
        borderRight: `1px solid ${THEME.border}`,
        position: 'relative',
      }}>
        {/* Chat Header - Provider and Model selectors */}
        <div style={{
          padding: '12px 16px',
          borderBottom: `1px solid ${THEME.border}`,
          display: 'flex',
          alignItems: 'center',
          gap: '12px',
          flexWrap: 'wrap',
        }}>
          {/* Provider Dropdown (only shown when multiple providers available) */}
          {showProviderDropdown && (
            <Dropdown
              label="Provider"
              value={serverConfig.currentProvider}
              options={serverConfig.providers}
              onChange={handleProviderChange}
              disabled={serverConfig.loading}
            />
          )}

          {/* Model Dropdown */}
          <Dropdown
            label="Model"
            value={selectedModel}
            options={serverConfig.models}
            onChange={setSelectedModel}
            disabled={serverConfig.loading}
          />
        </div>

        {/* Messages */}
        <div style={{ flex: 1, overflow: 'auto', padding: '16px' }}>
          {activeConversation?.messages.length === 0 && (
            <div style={{
              padding: '32px 16px',
              textAlign: 'center',
            }}>
              <h2 style={{
                fontSize: '24px',
                fontWeight: 600,
                marginBottom: '8px',
                background: `linear-gradient(135deg, ${THEME.text}, ${THEME.textMuted})`,
                WebkitBackgroundClip: 'text',
                WebkitTextFillColor: 'transparent',
              }}>
                Create UI Components
              </h2>
              <p style={{
                color: THEME.textMuted,
                fontSize: '14px',
                marginBottom: '24px',
                maxWidth: '320px',
                margin: '0 auto 24px',
                lineHeight: 1.6,
              }}>
                Describe what you want to build. Upload images for reference.
              </p>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px', justifyContent: 'center' }}>
                {[
                  'Create a pricing card',
                  'Build a user profile',
                  'Design a notification',
                ].map(suggestion => (
                  <button
                    key={suggestion}
                    onClick={() => setInputValue(suggestion)}
                    style={{
                      padding: '8px 14px',
                      background: THEME.bgSurface,
                      border: `1px solid ${THEME.border}`,
                      borderRadius: '20px',
                      color: THEME.textMuted,
                      fontSize: '13px',
                      cursor: 'pointer',
                      transition: 'all 0.2s',
                    }}
                    onMouseEnter={e => {
                      e.currentTarget.style.borderColor = THEME.accent;
                      e.currentTarget.style.color = THEME.text;
                    }}
                    onMouseLeave={e => {
                      e.currentTarget.style.borderColor = THEME.border;
                      e.currentTarget.style.color = THEME.textMuted;
                    }}
                  >
                    {suggestion}
                  </button>
                ))}
              </div>
            </div>
          )}

          {activeConversation?.messages.map(message => (
            <div
              key={message.id}
              style={{
                marginBottom: '16px',
                padding: '14px 16px',
                borderRadius: '12px',
                maxWidth: '90%',
                marginLeft: message.role === 'user' ? 'auto' : '0',
                marginRight: message.role === 'user' ? '0' : 'auto',
                background: message.role === 'user' ? THEME.bgElevated : THEME.bgSurface,
                border: `1px solid ${message.role === 'user' ? THEME.border : THEME.border}`,
              }}
            >
              {message.images && message.images.length > 0 && (
                <div style={{ display: 'flex', gap: '8px', marginBottom: '10px', flexWrap: 'wrap' }}>
                  {message.images.map(img => (
                    <img
                      key={img.id}
                      src={img.data}
                      alt={img.name}
                      style={{
                        width: '80px',
                        height: '80px',
                        objectFit: 'cover',
                        borderRadius: '8px',
                        border: `1px solid ${THEME.border}`,
                      }}
                    />
                  ))}
                </div>
              )}
              <div style={{ fontSize: '14px', lineHeight: 1.6, color: THEME.text }}>
                {message.isStreaming ? (
                  <StreamingText text={message.content} />
                ) : (
                  message.content
                )}
              </div>
              {message.generatedCode && (
                <button
                  onClick={() => {
                    setPreviewCode(message.generatedCode!);
                    setPreviewTab('preview');
                  }}
                  style={{
                    marginTop: '10px',
                    padding: '6px 12px',
                    background: THEME.accentMuted,
                    border: `1px solid ${THEME.accent}`,
                    borderRadius: '6px',
                    color: THEME.accent,
                    fontSize: '12px',
                    cursor: 'pointer',
                    display: 'flex',
                    alignItems: 'center',
                    gap: '6px',
                    transition: 'all 0.2s',
                  }}
                >
                  <Icons.Eye />
                  View Component
                </button>
              )}
            </div>
          ))}

          {isGenerating && (
            <div
              style={{
                marginBottom: '16px',
                padding: '14px 16px',
                borderRadius: '12px',
                maxWidth: '90%',
                background: THEME.bgSurface,
                border: `1px solid ${THEME.border}`,
              }}
            >
              <LoadingDots />
            </div>
          )}

          <div ref={messagesEndRef} />
        </div>

        {/* Input Area */}
        <div style={{
          padding: '16px',
          borderTop: `1px solid ${THEME.border}`,
          background: THEME.bgSurface,
        }}>
          <ImageUploadArea
            images={images}
            onImagesChange={setImages}
            disabled={isGenerating}
          />

          <div style={{ display: 'flex', gap: '10px', alignItems: 'flex-end' }}>
            <textarea
              ref={inputRef}
              value={inputValue}
              onChange={e => setInputValue(e.target.value)}
              onKeyDown={handleKeyPress}
              placeholder="Describe the component you want to create..."
              disabled={isGenerating}
              style={{
                flex: 1,
                padding: '12px 14px',
                background: THEME.bgElevated,
                border: `1px solid ${THEME.border}`,
                borderRadius: '10px',
                color: THEME.text,
                fontSize: '14px',
                resize: 'none',
                outline: 'none',
                fontFamily: 'inherit',
                minHeight: '44px',
                maxHeight: '120px',
                transition: 'border-color 0.2s',
              }}
              rows={1}
              onFocus={e => e.target.style.borderColor = THEME.accent}
              onBlur={e => e.target.style.borderColor = THEME.border}
            />
            <button
              onClick={sendMessage}
              disabled={isGenerating || !inputValue.trim()}
              style={{
                padding: '12px',
                background: (isGenerating || !inputValue.trim()) ? THEME.bgElevated : THEME.accent,
                border: 'none',
                borderRadius: '10px',
                color: (isGenerating || !inputValue.trim()) ? THEME.textSubtle : '#fff',
                cursor: (isGenerating || !inputValue.trim()) ? 'not-allowed' : 'pointer',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                transition: 'all 0.2s',
                minWidth: '44px',
                height: '44px',
              }}
            >
              <Icons.Send />
            </button>
          </div>
        </div>

        {/* Resize Handle */}
        <div
          onMouseDown={startResize}
          style={{
            position: 'absolute',
            right: 0,
            top: 0,
            bottom: 0,
            width: '4px',
            cursor: 'col-resize',
            background: 'transparent',
            transition: 'background 0.2s',
          }}
          onMouseEnter={e => e.currentTarget.style.background = THEME.accent}
          onMouseLeave={e => e.currentTarget.style.background = 'transparent'}
        />
      </div>

      {/* Preview Panel */}
      <div style={{
        flex: 1,
        display: 'flex',
        flexDirection: 'column',
        background: THEME.bg,
        minWidth: 0,
      }}>
        {/* Preview Header with Tabs */}
        <div style={{
          padding: '12px 16px',
          borderBottom: `1px solid ${THEME.border}`,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
        }}>
          <div style={{ display: 'flex', gap: '4px' }}>
            <button
              onClick={() => setPreviewTab('preview')}
              style={{
                padding: '8px 14px',
                background: previewTab === 'preview' ? THEME.bgElevated : 'transparent',
                border: 'none',
                borderRadius: '6px',
                color: previewTab === 'preview' ? THEME.text : THEME.textMuted,
                fontSize: '13px',
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                gap: '6px',
                transition: 'all 0.2s',
              }}
            >
              <Icons.Eye />
              Preview
            </button>
            <button
              onClick={() => setPreviewTab('code')}
              style={{
                padding: '8px 14px',
                background: previewTab === 'code' ? THEME.bgElevated : 'transparent',
                border: 'none',
                borderRadius: '6px',
                color: previewTab === 'code' ? THEME.text : THEME.textMuted,
                fontSize: '13px',
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                gap: '6px',
                transition: 'all 0.2s',
              }}
            >
              <Icons.Code />
              Code
            </button>
          </div>

          {previewCode && previewTab === 'preview' && (
            <span style={{ fontSize: '12px', color: THEME.textMuted }}>
              Live Preview
            </span>
          )}
        </div>

        {/* Preview Content */}
        <div style={{ flex: 1, overflow: 'hidden', padding: '16px' }}>
          {previewCode ? (
            previewTab === 'preview' ? (
              <PreviewIframe code={previewCode} framework={framework} />
            ) : (
              <CodeViewer code={previewCode} />
            )
          ) : (
            <div style={{
              height: '100%',
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              justifyContent: 'center',
              color: THEME.textSubtle,
            }}>
              <div style={{
                width: '80px',
                height: '80px',
                borderRadius: '20px',
                background: THEME.bgSurface,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                marginBottom: '20px',
                border: `1px solid ${THEME.border}`,
              }}>
                <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
                  <rect x="3" y="3" width="18" height="18" rx="2" />
                  <path d="M3 9h18M9 21V9" />
                </svg>
              </div>
              <p style={{ fontSize: '16px', fontWeight: 500, marginBottom: '8px', color: THEME.textMuted }}>
                Ready to Build
              </p>
              <p style={{ fontSize: '14px', maxWidth: '260px', textAlign: 'center', lineHeight: 1.5 }}>
                Describe a component in the chat and watch it come to life here
              </p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default App;
