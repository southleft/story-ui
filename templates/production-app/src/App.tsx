/**
 * Story UI Production App
 *
 * A Lovable/Bolt-style interface for generating UI components
 * using AI and a user's component library.
 */

import React, { useState, useEffect, useRef, useCallback } from 'react';
import { LivePreviewRenderer } from './LivePreviewRenderer';
import { availableComponents } from './componentRegistry';
import { aiConsiderations, hasConsiderations } from './considerations';

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
}

interface ImageAttachment {
  id: string;
  data: string;
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

interface ProviderOption {
  id: string;
  name: string;
  isDefault?: boolean;
}

interface ModelOption {
  id: string;
  name: string;
  provider?: string;
}

interface ServerConfig {
  providers: ProviderOption[];
  currentProvider: string;
  models: ModelOption[];
  currentModel: string;
  isConfigured: boolean;
  loading: boolean;
  error: string | null;
}

// ============================================================================
// CONSTANTS & CONFIG
// ============================================================================

const getServerUrl = (): string => {
  if (import.meta.env.VITE_STORY_UI_SERVER) {
    return import.meta.env.VITE_STORY_UI_SERVER;
  }
  return window.location.origin;
};

const SERVER_URL = getServerUrl();

const THEME = {
  bg: '#09090b',
  bgSurface: '#18181b',
  bgElevated: '#27272a',
  bgHover: '#3f3f46',
  border: '#27272a',
  borderSubtle: '#3f3f46',
  text: '#fafafa',
  textMuted: '#a1a1aa',
  textSubtle: '#71717a',
  accent: '#3b82f6',
  accentHover: '#2563eb',
  accentMuted: 'rgba(59, 130, 246, 0.15)',
  success: '#22c55e',
  error: '#ef4444',
  warning: '#f59e0b',
};

const generateId = () => Math.random().toString(36).substring(2, 15);

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

  // Use a ref to always have access to the latest value for functional updates
  const storedValueRef = useRef(storedValue);
  storedValueRef.current = storedValue;

  const setValue: React.Dispatch<React.SetStateAction<T>> = useCallback((value) => {
    const valueToStore = value instanceof Function ? value(storedValueRef.current) : value;
    storedValueRef.current = valueToStore;
    setStoredValue(valueToStore);
    window.localStorage.setItem(key, JSON.stringify(valueToStore));
  }, [key]);

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

// Default models for fallback
const DEFAULT_MODELS: Record<string, ModelOption[]> = {
  claude: [
    { id: 'claude-sonnet-4-5-20250929', name: 'Claude Sonnet 4.5', provider: 'claude' },
    { id: 'claude-sonnet-4-20250514', name: 'Claude Sonnet 4', provider: 'claude' },
    { id: 'claude-3-5-sonnet-20241022', name: 'Claude 3.5 Sonnet', provider: 'claude' },
  ],
  openai: [
    { id: 'gpt-4o', name: 'GPT-4o', provider: 'openai' },
    { id: 'gpt-4o-mini', name: 'GPT-4o Mini', provider: 'openai' },
    { id: 'gpt-4-turbo', name: 'GPT-4 Turbo', provider: 'openai' },
  ],
  gemini: [
    { id: 'gemini-2.0-flash', name: 'Gemini 2.0 Flash', provider: 'gemini' },
    { id: 'gemini-1.5-pro', name: 'Gemini 1.5 Pro', provider: 'gemini' },
    { id: 'gemini-1.5-flash', name: 'Gemini 1.5 Flash', provider: 'gemini' },
  ],
};

const useServerConfig = () => {
  const [config, setConfig] = useState<ServerConfig>({
    providers: [],
    currentProvider: 'claude',
    models: DEFAULT_MODELS.claude,
    currentModel: DEFAULT_MODELS.claude[0].id,
    isConfigured: false,
    loading: true,
    error: null,
  });

  const fetchConfig = useCallback(async () => {
    setConfig(prev => ({ ...prev, loading: true, error: null }));
    try {
      const response = await fetch(`${SERVER_URL}/story-ui/providers`);
      if (response.ok) {
        const data = await response.json();
        const providers = data.providers || [];
        const defaultProvider = providers.find((p: ProviderOption) => p.isDefault)?.id || providers[0]?.id || 'claude';
        const models = DEFAULT_MODELS[defaultProvider] || DEFAULT_MODELS.claude;
        setConfig({
          providers,
          currentProvider: defaultProvider,
          models,
          currentModel: models[0]?.id || '',
          isConfigured: true,
          loading: false,
          error: null,
        });
      } else {
        throw new Error('Failed to fetch providers');
      }
    } catch (err) {
      // Fallback to default Claude config
      setConfig({
        providers: [{ id: 'claude', name: 'Claude (Anthropic)', isDefault: true }],
        currentProvider: 'claude',
        models: DEFAULT_MODELS.claude,
        currentModel: DEFAULT_MODELS.claude[0].id,
        isConfigured: true,
        loading: false,
        error: null,
      });
    }
  }, []);

  useEffect(() => {
    fetchConfig();
  }, [fetchConfig]);

  const changeProvider = useCallback((providerId: string) => {
    const models = DEFAULT_MODELS[providerId] || DEFAULT_MODELS.claude;
    setConfig(prev => ({
      ...prev,
      currentProvider: providerId,
      models,
      currentModel: models[0]?.id || '',
    }));
  }, []);

  const changeModel = useCallback((modelId: string) => {
    setConfig(prev => ({
      ...prev,
      currentModel: modelId,
    }));
  }, []);

  return { ...config, refetch: fetchConfig, changeProvider, changeModel };
};

// ============================================================================
// ICON COMPONENTS
// ============================================================================

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
};

// ============================================================================
// SUB-COMPONENTS
// ============================================================================

// Dropdown component for provider/model selection
const Dropdown: React.FC<{
  label: string;
  value: string;
  options: { id: string; name: string }[];
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
    <div ref={ref} style={{ position: 'relative', width: '100%' }}>
      <button
        onClick={() => !disabled && setIsOpen(!isOpen)}
        disabled={disabled}
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          width: '100%',
          padding: '8px 10px',
          background: THEME.bgElevated,
          border: `1px solid ${THEME.border}`,
          borderRadius: '6px',
          color: disabled ? THEME.textSubtle : THEME.text,
          fontSize: '12px',
          cursor: disabled ? 'not-allowed' : 'pointer',
          transition: 'all 0.2s',
          opacity: disabled ? 0.6 : 1,
        }}
      >
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-start', gap: '2px' }}>
          <span style={{ color: THEME.textSubtle, fontSize: '10px', textTransform: 'uppercase', letterSpacing: '0.5px' }}>
            {label}
          </span>
          <span style={{ fontWeight: 500 }}>{selectedOption?.name || 'Select'}</span>
        </div>
        <Icons.ChevronDown />
      </button>
      {isOpen && !disabled && (
        <div
          style={{
            position: 'absolute',
            bottom: '100%',
            left: 0,
            right: 0,
            marginBottom: '4px',
            maxHeight: '200px',
            overflowY: 'auto',
            background: THEME.bgElevated,
            border: `1px solid ${THEME.border}`,
            borderRadius: '6px',
            boxShadow: '0 -4px 12px rgba(0,0,0,0.3)',
            zIndex: 100,
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
                padding: '8px 10px',
                background: option.id === value ? THEME.accentMuted : 'transparent',
                border: 'none',
                textAlign: 'left',
                color: THEME.text,
                fontSize: '12px',
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
              {option.name}
            </button>
          ))}
        </div>
      )}
    </div>
  );
};

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

const ImageUploadArea: React.FC<{
  images: ImageAttachment[];
  onImagesChange: (images: ImageAttachment[]) => void;
  disabled?: boolean;
}> = ({ images, onImagesChange, disabled }) => {
  const fileInputRef = useRef<HTMLInputElement>(null);

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
        disabled={disabled}
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: '6px',
          padding: '6px 10px',
          background: 'transparent',
          border: `1px dashed ${THEME.border}`,
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

const CodeViewer: React.FC<{ code: string }> = ({ code }) => {
  const [copied, setCopied] = useState(false);

  const handleCopy = async () => {
    await navigator.clipboard.writeText(code);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

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
      >
        {code}
      </pre>
    </div>
  );
};

// ============================================================================
// MAIN APP
// ============================================================================

const App: React.FC = () => {
  // Server configuration (providers, models)
  const serverConfig = useServerConfig();

  const [conversations, setConversations] = useLocalStorage<Conversation[]>('storyui_conversations', []);
  const [activeConversationId, setActiveConversationId] = useState<string | null>(null);
  const [inputValue, setInputValue] = useState('');
  const [isGenerating, setIsGenerating] = useState(false);
  const [previewCode, setPreviewCode] = useState<string | null>(null);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [previewTab, setPreviewTab] = useState<'preview' | 'code'>('preview');
  const [images, setImages] = useState<ImageAttachment[]>([]);

  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const { width: chatWidth, startResize } = useResizable(400, 320, 600);

  const activeConversation = conversations.find(c => c.id === activeConversationId);

  // Filter out empty conversations for display (deferred creation)
  const displayConversations = conversations.filter(c => c.messages.length > 0);

  // Auto-scroll messages
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [activeConversation?.messages]);

  // Initialize - select existing conversation or stay in "new chat" mode
  useEffect(() => {
    // Only select an existing conversation if we don't have one selected
    // and there are conversations with messages
    if (!activeConversationId && displayConversations.length > 0) {
      setActiveConversationId(displayConversations[0].id);
      const lastMsgWithCode = [...displayConversations[0].messages].reverse().find(m => m.generatedCode);
      setPreviewCode(lastMsgWithCode?.generatedCode || null);
    }
    // Don't create an empty conversation - we'll create one when user sends first message
  }, [displayConversations.length, activeConversationId]);

  // Start a new chat - just clear state, don't create empty conversation
  const startNewChat = useCallback(() => {
    setActiveConversationId(null);
    setPreviewCode(null);
    setImages([]);
    inputRef.current?.focus();
  }, []);

  // Actually create a conversation when first message is sent
  const createConversationWithMessage = useCallback((message: Message): string => {
    const newConversation: Conversation = {
      id: generateId(),
      title: message.content.substring(0, 40),
      messages: [message],
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };
    setConversations(prev => [newConversation, ...prev]);
    return newConversation.id;
  }, [setConversations]);

  const deleteConversation = (id: string) => {
    setConversations(prev => prev.filter(c => c.id !== id));
    if (activeConversationId === id) {
      const remaining = displayConversations.filter(c => c.id !== id);
      if (remaining.length > 0) {
        setActiveConversationId(remaining[0].id);
      } else {
        // Go to "new chat" mode instead of creating empty conversation
        setActiveConversationId(null);
        setPreviewCode(null);
      }
    }
  };

  const generateComponent = async (prompt: string, imageAttachments: ImageAttachment[]): Promise<string> => {
    // Get the last generated code from conversation for iteration context
    const lastGeneratedCode = activeConversation?.messages
      .filter(m => m.generatedCode)
      .slice(-1)[0]?.generatedCode;

    // Check if this is an iteration (modification of existing code)
    const isIteration = !!lastGeneratedCode && (activeConversation?.messages.length || 0) > 0;

    // Build conversation history, but for iterations include the code reference differently
    const conversationHistory = isIteration
      ? activeConversation?.messages.slice(0, -1).map(msg => ({
          role: msg.role,
          content: msg.role === 'assistant' && msg.generatedCode
            ? `[Generated JSX component - see CURRENT_CODE below]`
            : msg.content
        })) || []
      : [];

    // Build a UNIVERSAL system prompt that works with ANY component library
    // Design-system-specific rules come from aiConsiderations (generated from story-ui-considerations.md)
    const basePrompt = `You are a JSX code generator. Your ONLY job is to output raw JSX code.

CRITICAL OUTPUT RULES:
1. Start DIRECTLY with < (opening tag of a component)
2. End with > (closing tag)
3. NO markdown, NO headers, NO explanations, NO code fences
4. NO internal tags like <budget>, <usage>, <thinking>, or any metadata
5. NEVER output anything except JSX components

UNIVERSAL BEST PRACTICES (applies to ALL design systems):

THEME & COLORS:
- Components render on a LIGHT BACKGROUND by default
- Use DARK text colors for body text (ensure readability)
- Never use white/light text colors unless on a dark or colored background
- Ensure sufficient color contrast (4.5:1 for normal text, 3:1 for large text)

ACCESSIBILITY (WCAG):
- Use semantic HTML structure (headings, lists, landmarks)
- Include aria-labels on interactive elements without visible text
- Ensure focusable elements have visible focus states
- Use role attributes appropriately
- Form inputs should have associated labels
- Interactive elements should be keyboard accessible

RESPONSIVE DESIGN:
- Components should work at various viewport sizes
- Use relative units and flexible layouts
- Avoid fixed pixel widths that could cause overflow

AVAILABLE COMPONENTS (use ONLY these):
${availableComponents.join(', ')}${hasConsiderations ? `

DESIGN SYSTEM GUIDELINES:
${aiConsiderations}` : ''}`;

    let systemPrompt: string;

    if (isIteration && lastGeneratedCode) {
      // Iteration-specific prompt with clear modification instructions
      systemPrompt = `${basePrompt}

ITERATION MODE - You are MODIFYING existing code:

CURRENT_CODE (this is what you're modifying):
${lastGeneratedCode}

MODIFICATION RULES:
1. Keep the overall structure unless asked to change it
2. Only modify what the user specifically requests
3. Preserve existing styling, layout, and components not mentioned
4. Output the COMPLETE modified JSX (not just the changed parts)

IMPORTANT: User requests OVERRIDE design system defaults. If the user asks to change colors, styling, or any other aspect, follow their request exactly - even if it differs from the design system guidelines above.

OUTPUT: Start immediately with < and output only the complete modified JSX.`;
    } else {
      // New generation prompt
      systemPrompt = `${basePrompt}

GENERATION RULES:
1. Output a SINGLE JSX expression starting with < and ending with >
2. Use ONLY components from the list above
3. NO imports, NO exports, NO function definitions
4. NO explanations, NO comments outside JSX

OUTPUT: Start immediately with < and output only JSX.`;
    }

    // Use assistant prefill to force Claude to start with JSX
    // This is a powerful technique that constrains the output format
    const prefillAssistant = '<';

    const response = await fetch(`${SERVER_URL}/story-ui/claude`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        prompt,
        messages: conversationHistory,
        systemPrompt,
        prefillAssistant,
        model: serverConfig.currentModel,
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
    // Handle various response formats from different LLM providers
    let content: string;
    if (Array.isArray(data.content)) {
      // Claude API format: { content: [{ type: 'text', text: '...' }] }
      content = data.content[0]?.text || '';
    } else if (typeof data.content === 'string') {
      content = data.content;
    } else if (typeof data.text === 'string') {
      // Alternative format
      content = data.text;
    } else {
      content = String(data.content || data.text || '');
    }

    // Clean up the response
    let cleanCode = content.trim();
    if (cleanCode.startsWith('```')) {
      cleanCode = cleanCode
        .replace(/^```(?:jsx|tsx|javascript|js)?\n?/, '')
        .replace(/\n?```$/, '');
    }

    return cleanCode;
  };

  const sendMessage = async () => {
    if (!inputValue.trim() || isGenerating) return;

    const userMessage: Message = {
      id: generateId(),
      role: 'user',
      content: inputValue.trim(),
      timestamp: Date.now(),
      images: images.length > 0 ? [...images] : undefined,
    };

    // Determine if we need to create a new conversation or add to existing
    let conversationId = activeConversationId;

    if (!conversationId) {
      // Create new conversation with the first message
      conversationId = createConversationWithMessage(userMessage);
      setActiveConversationId(conversationId);
    } else {
      // Add message to existing conversation
      setConversations(prev => prev.map(conv => {
        if (conv.id === conversationId) {
          return {
            ...conv,
            messages: [...conv.messages, userMessage],
            updatedAt: Date.now(),
          };
        }
        return conv;
      }));
    }

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
        if (conv.id === conversationId) {
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
        if (conv.id === conversationId) {
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
        ::-webkit-scrollbar { width: 6px; height: 6px; }
        ::-webkit-scrollbar-track { background: transparent; }
        ::-webkit-scrollbar-thumb { background: ${THEME.bgElevated}; border-radius: 3px; }
        ::-webkit-scrollbar-thumb:hover { background: ${THEME.bgHover}; }
      `}</style>

      {/* Sidebar */}
      <aside style={{
        width: sidebarCollapsed ? '60px' : '240px',
        background: THEME.bgSurface,
        borderRight: `1px solid ${THEME.border}`,
        display: 'flex',
        flexDirection: 'column',
        transition: 'width 0.2s ease',
        overflow: 'hidden',
      }}>
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
            }}
          >
            <Icons.Sidebar />
          </button>
        </div>

        {/* New Chat Button */}
        <div style={{ padding: sidebarCollapsed ? '8px' : '12px' }}>
          <button
            onClick={startNewChat}
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
            }}
          >
            <Icons.Plus />
            {!sidebarCollapsed && 'New Chat'}
          </button>
        </div>

        {/* Conversation List */}
        {!sidebarCollapsed && (
          <div style={{ flex: 1, overflow: 'auto', padding: '8px 12px' }}>
            {displayConversations.map(conv => (
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
                  }}
                >
                  <Icons.Trash />
                </button>
              </div>
            ))}
          </div>
        )}

        {/* Sidebar Footer - Provider/Model Info */}
        {!sidebarCollapsed && (
          <div style={{
            padding: '12px',
            borderTop: `1px solid ${THEME.border}`,
            display: 'flex',
            flexDirection: 'column',
            gap: '6px',
          }}>
            {/* Provider Label */}
            <div style={{ fontSize: '12px', color: THEME.textMuted }}>
              <span style={{ color: THEME.textSubtle, textTransform: 'uppercase', fontSize: '10px', letterSpacing: '0.5px' }}>Provider: </span>
              <span style={{ color: THEME.text, fontWeight: 500 }}>
                {serverConfig.providers.find(p => p.id === serverConfig.currentProvider)?.name || 'Claude (Anthropic)'}
              </span>
            </div>

            {/* Model Dropdown */}
            <div style={{ fontSize: '12px', color: THEME.textMuted }}>
              <span style={{ color: THEME.textSubtle, textTransform: 'uppercase', fontSize: '10px', letterSpacing: '0.5px' }}>Model</span>
            </div>
            <select
              value={serverConfig.currentModel}
              onChange={(e) => serverConfig.changeModel(e.target.value)}
              disabled={serverConfig.loading}
              style={{
                width: '100%',
                padding: '8px 10px',
                background: THEME.bgElevated,
                border: `1px solid ${THEME.border}`,
                borderRadius: '6px',
                color: THEME.text,
                fontSize: '12px',
                cursor: 'pointer',
                outline: 'none',
                appearance: 'none',
                backgroundImage: `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='12' viewBox='0 0 24 24' fill='none' stroke='%2371717a' stroke-width='2'%3E%3Cpath d='M6 9l6 6 6-6'/%3E%3C/svg%3E")`,
                backgroundRepeat: 'no-repeat',
                backgroundPosition: 'right 8px center',
                paddingRight: '28px',
              }}
            >
              {serverConfig.models.map(model => (
                <option key={model.id} value={model.id}>{model.id}</option>
              ))}
            </select>

            {/* Components Count */}
            <div style={{
              display: 'flex',
              alignItems: 'center',
              gap: '6px',
              fontSize: '11px',
              color: THEME.textSubtle,
              paddingTop: '4px',
            }}>
              <div style={{
                width: '6px',
                height: '6px',
                borderRadius: '50%',
                background: THEME.success,
              }} />
              <span>{availableComponents.length} components available</span>
            </div>
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
        {/* Messages */}
        <div style={{ flex: 1, overflow: 'auto', padding: '16px' }}>
          {(!activeConversation || activeConversation.messages.length === 0) && (
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
                Build UI Components
              </h2>
              <p style={{
                color: THEME.textMuted,
                fontSize: '14px',
                marginBottom: '24px',
                lineHeight: 1.6,
              }}>
                Describe what you want to build using your component library.
              </p>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px', justifyContent: 'center' }}>
                {['Create a pricing card', 'Build a dashboard', 'Design a login form'].map(suggestion => (
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
                border: `1px solid ${THEME.border}`,
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
                {message.content}
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
                  }}
                >
                  <Icons.Eye />
                  View Component
                </button>
              )}
            </div>
          ))}

          {isGenerating && (
            <div style={{
              marginBottom: '16px',
              padding: '14px 16px',
              borderRadius: '12px',
              maxWidth: '90%',
              background: THEME.bgSurface,
              border: `1px solid ${THEME.border}`,
            }}>
              <LoadingDots />
            </div>
          )}

          <div ref={messagesEndRef} />
        </div>

        {/* Input Area - ChatGPT/Lovable Style */}
        <div style={{
          padding: '16px',
          borderTop: `1px solid ${THEME.border}`,
          background: THEME.bgSurface,
        }}>
          {/* Image thumbnails if any */}
          {images.length > 0 && (
            <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap', marginBottom: '12px' }}>
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
                    onClick={() => setImages(images.filter(i => i.id !== img.id))}
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

          {/* Combined input container matching reference */}
          <div style={{
            display: 'flex',
            flexDirection: 'column',
            background: THEME.bgElevated,
            border: `1px solid ${THEME.border}`,
            borderRadius: '12px',
            overflow: 'hidden',
          }}>
            {/* Text input area */}
            <textarea
              ref={inputRef}
              value={inputValue}
              onChange={e => setInputValue(e.target.value)}
              onKeyDown={handleKeyPress}
              placeholder="Describe the component you want to create..."
              disabled={isGenerating}
              style={{
                width: '100%',
                padding: '14px 16px',
                background: 'transparent',
                border: 'none',
                color: THEME.text,
                fontSize: '14px',
                resize: 'none',
                outline: 'none',
                fontFamily: 'inherit',
                minHeight: '24px',
                maxHeight: '120px',
              }}
              rows={1}
            />

            {/* Bottom row with attach button and send */}
            <div style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              padding: '8px 12px',
              borderTop: `1px solid ${THEME.border}`,
            }}>
              {/* + Attach button */}
              <label
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '6px',
                  padding: '6px 12px',
                  background: THEME.bgHover,
                  border: `1px solid ${THEME.borderSubtle}`,
                  borderRadius: '6px',
                  color: THEME.textMuted,
                  fontSize: '13px',
                  cursor: isGenerating ? 'not-allowed' : 'pointer',
                  opacity: isGenerating ? 0.5 : 1,
                  transition: 'all 0.2s',
                }}
              >
                <Icons.Plus />
                <span>Attach</span>
                <input
                  type="file"
                  accept="image/*"
                  multiple
                  style={{ display: 'none' }}
                  disabled={isGenerating}
                  onChange={(e) => {
                    if (e.target.files) {
                      Array.from(e.target.files).forEach(file => {
                        if (file.type.startsWith('image/')) {
                          const reader = new FileReader();
                          reader.onload = (ev) => {
                            const newImage: ImageAttachment = {
                              id: generateId(),
                              data: ev.target?.result as string,
                              type: file.type,
                              name: file.name,
                            };
                            setImages(prev => [...prev, newImage]);
                          };
                          reader.readAsDataURL(file);
                        }
                      });
                    }
                  }}
                />
              </label>

              {/* Send button */}
              <button
                onClick={sendMessage}
                disabled={isGenerating || !inputValue.trim()}
                style={{
                  padding: '8px 12px',
                  background: (isGenerating || !inputValue.trim()) ? THEME.bgHover : THEME.accent,
                  border: 'none',
                  borderRadius: '8px',
                  color: (isGenerating || !inputValue.trim()) ? THEME.textSubtle : '#fff',
                  cursor: (isGenerating || !inputValue.trim()) ? 'not-allowed' : 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                }}
              >
                <Icons.Send />
              </button>
            </div>
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
          }}
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
        {/* Preview Header */}
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
        <div style={{ flex: 1, overflow: 'hidden' }}>
          {previewCode ? (
            previewTab === 'preview' ? (
              <LivePreviewRenderer
                code={previewCode}
                containerStyle={{ height: '100%', background: THEME.bgSurface }}
                onError={(err) => console.error('Preview error:', err)}
              />
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
              padding: '40px',
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
                Describe a component and watch it come to life
              </p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default App;
