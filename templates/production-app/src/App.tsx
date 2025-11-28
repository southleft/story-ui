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
};

// ============================================================================
// SUB-COMPONENTS
// ============================================================================

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

  // Auto-scroll messages
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [activeConversation?.messages]);

  // Initialize first conversation
  useEffect(() => {
    if (conversations.length > 0 && !activeConversationId) {
      setActiveConversationId(conversations[0].id);
      const lastMsgWithCode = [...conversations[0].messages].reverse().find(m => m.generatedCode);
      setPreviewCode(lastMsgWithCode?.generatedCode || null);
    } else if (conversations.length === 0) {
      createNewConversation();
    }
  }, [conversations.length, activeConversationId]);

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
    if (!inputValue.trim() || !activeConversationId || isGenerating) return;

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

        {/* Components Badge */}
        {!sidebarCollapsed && (
          <div style={{
            padding: '12px',
            borderTop: `1px solid ${THEME.border}`,
            fontSize: '11px',
            color: THEME.textSubtle,
          }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
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
              }}
              rows={1}
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
