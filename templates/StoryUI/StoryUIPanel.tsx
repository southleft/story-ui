import React, { useState, useRef, useEffect, useCallback, ReactNode } from 'react';

// Simple markdown renderer for AI messages with icon marker support
const renderMarkdown = (text: string): ReactNode => {
  // Split by double newlines to get paragraphs
  const paragraphs = text.split(/\n\n+/);

  // Parse inline formatting within text
  const parseInline = (str: string, paragraphIndex: number): ReactNode[] => {
    const parts: ReactNode[] = [];
    let remaining = str;
    let keyIndex = 0;

    while (remaining.length > 0) {
      // Icon markers: [SUCCESS], [ERROR], [TIP], [WRENCH]
      const iconMatch = remaining.match(/^\[(SUCCESS|ERROR|TIP|WRENCH)\]/);
      if (iconMatch) {
        const iconType = iconMatch[1].toLowerCase() as keyof typeof StatusIcons;
        parts.push(<span key={`icon-${paragraphIndex}-${keyIndex++}`}>{StatusIcons[iconType]}</span>);
        remaining = remaining.slice(iconMatch[0].length);
        continue;
      }

      // Bold: **text**
      const boldMatch = remaining.match(/^\*\*(.+?)\*\*/);
      if (boldMatch) {
        parts.push(<strong key={`b-${paragraphIndex}-${keyIndex++}`}>{boldMatch[1]}</strong>);
        remaining = remaining.slice(boldMatch[0].length);
        continue;
      }

      // Italic: _text_
      const italicMatch = remaining.match(/^_(.+?)_/);
      if (italicMatch) {
        parts.push(<em key={`i-${paragraphIndex}-${keyIndex++}`} style={{ opacity: 0.7, fontSize: '0.9em' }}>{italicMatch[1]}</em>);
        remaining = remaining.slice(italicMatch[0].length);
        continue;
      }

      // Code: `text`
      const codeMatch = remaining.match(/^`([^`]+)`/);
      if (codeMatch) {
        parts.push(
          <code
            key={`c-${paragraphIndex}-${keyIndex++}`}
            style={{
              background: 'rgba(0,0,0,0.08)',
              padding: '1px 4px',
              borderRadius: '4px',
              fontFamily: 'ui-monospace, monospace',
              fontSize: '0.88em'
            }}
          >
            {codeMatch[1]}
          </code>
        );
        remaining = remaining.slice(codeMatch[0].length);
        continue;
      }

      // Single newline within paragraph - convert to space or line break
      if (remaining.startsWith('\n')) {
        parts.push(' ');
        remaining = remaining.slice(1);
        continue;
      }

      // Regular text - consume until next special character or bracket
      const nextSpecial = remaining.search(/[*_`\[\n]/);
      if (nextSpecial === -1) {
        parts.push(remaining);
        remaining = '';
      } else if (nextSpecial === 0) {
        // Special char that didn't match a pattern, treat as regular text
        parts.push(remaining[0]);
        remaining = remaining.slice(1);
      } else {
        parts.push(remaining.slice(0, nextSpecial));
        remaining = remaining.slice(nextSpecial);
      }
    }

    return parts;
  };

  return (
    <>
      {paragraphs.map((paragraph, index) => (
        <div key={`p-${index}`} style={{ marginBottom: index < paragraphs.length - 1 ? '8px' : 0 }}>
          {parseInline(paragraph.trim(), index)}
        </div>
      ))}
    </>
  );
};

// Inline SVG icons for status indicators (avoiding emojis)
const StatusIcons = {
  success: (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ color: '#22c55e', verticalAlign: 'middle', marginRight: '6px' }}>
      <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/>
      <polyline points="22,4 12,14.01 9,11.01"/>
    </svg>
  ),
  error: (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ color: '#ef4444', verticalAlign: 'middle', marginRight: '6px' }}>
      <circle cx="12" cy="12" r="10"/>
      <line x1="15" y1="9" x2="9" y2="15"/>
      <line x1="9" y1="9" x2="15" y2="15"/>
    </svg>
  ),
  tip: (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ color: '#f59e0b', verticalAlign: 'middle', marginRight: '4px' }}>
      <circle cx="12" cy="12" r="10"/>
      <line x1="12" y1="16" x2="12" y2="12"/>
      <line x1="12" y1="8" x2="12.01" y2="8"/>
    </svg>
  ),
  wrench: (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ color: '#6366f1', verticalAlign: 'middle', marginRight: '4px' }}>
      <path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z"/>
    </svg>
  )
};

// Message type
interface Message {
  role: 'user' | 'ai';
  content: string;
  isStreaming?: boolean;
  streamingData?: StreamingState;
  attachedImages?: AttachedImage[];
}

// Attached image type for upload
interface AttachedImage {
  id: string;
  file: File;
  preview: string;
  base64?: string;
  mediaType?: string; // Store MIME type for data URL reconstruction after localStorage restore
}

// Provider info from /story-ui/providers API
interface ProviderInfo {
  type: string;
  name: string;
  configured: boolean;
  models: string[];
}

interface ProvidersResponse {
  providers: ProviderInfo[];
  current: {
    provider: string;
    model: string;
    supportsVision: boolean;
    supportsStreaming: boolean;
  };
}

// Streaming event types (matching backend streamTypes.ts)
type StreamEventType = 'intent' | 'progress' | 'validation' | 'retry' | 'completion' | 'error';

interface IntentPreview {
  requestType: 'new' | 'modification';
  framework: string;
  detectedDesignSystem: string | null;
  strategy: string;
  estimatedComponents: string[];
  promptAnalysis: {
    hasVisionInput: boolean;
    hasConversationContext: boolean;
    hasPreviousCode: boolean;
  };
}

interface ProgressUpdate {
  step: number;
  totalSteps: number;
  phase: 'config_loaded' | 'components_discovered' | 'prompt_built' | 'llm_thinking' | 'code_extracted' | 'validating' | 'post_processing' | 'saving';
  message: string;
  details?: Record<string, unknown>;
}

interface ValidationFeedback {
  isValid: boolean;
  errors: string[];
  warnings: string[];
  autoFixApplied: boolean;
  fixDetails?: string[];
}

interface RetryInfo {
  attempt: number;
  maxAttempts: number;
  reason: string;
  errors: string[];
}

interface CompletionFeedback {
  success: boolean;
  title: string;
  fileName: string;
  storyId: string;
  summary: { action: 'created' | 'updated' | 'failed'; description: string };
  componentsUsed: { name: string; reason?: string }[];
  layoutChoices: { pattern: string; reason: string }[];
  styleChoices: { property: string; value: string; reason?: string }[];
  suggestions?: string[];
  validation: ValidationFeedback;
  code: string;
  metrics: { totalTimeMs: number; llmCallsCount: number; tokensUsed?: number };
}

interface ErrorFeedback {
  code: string;
  message: string;
  details?: string;
  recoverable: boolean;
  suggestion?: string;
}

interface StreamEvent {
  type: StreamEventType;
  timestamp: number;
  data: IntentPreview | ProgressUpdate | ValidationFeedback | RetryInfo | CompletionFeedback | ErrorFeedback;
}

// State for tracking streaming progress
interface StreamingState {
  intent?: IntentPreview;
  progress?: ProgressUpdate;
  validation?: ValidationFeedback;
  retry?: RetryInfo;
  completion?: CompletionFeedback;
  error?: ErrorFeedback;
}

// Session type
interface ChatSession {
  id: string;
  title: string;
  fileName: string;
  conversation: Message[];
  lastUpdated: number;
}

// Orphan story = a generated story file that exists on disk but has no chat history
interface OrphanStory {
  id: string;
  fileName: string;
  title: string;
  createdAt: number;
}

// Model display names for friendly UI presentation
// Maps API model IDs to human-readable names
const MODEL_DISPLAY_NAMES: Record<string, string> = {
  // Claude models
  'claude-opus-4-5-20251101': 'Claude Opus 4.5',
  'claude-sonnet-4-5-20250929': 'Claude Sonnet 4.5',
  'claude-haiku-4-5-20251001': 'Claude Haiku 4.5',
  'claude-sonnet-4-20250514': 'Claude Sonnet 4',
  'claude-opus-4-20250514': 'Claude Opus 4',
  'claude-3-7-sonnet-20250219': 'Claude 3.7 Sonnet',
  'claude-3-5-sonnet-20241022': 'Claude 3.5 Sonnet',
  'claude-3-5-haiku-20241022': 'Claude 3.5 Haiku',
  // OpenAI models
  'gpt-5.1': 'GPT-5.1',
  'gpt-5.1-thinking': 'GPT-5.1 Thinking',
  'gpt-5': 'GPT-5',
  'gpt-4o': 'GPT-4o',
  'gpt-4o-mini': 'GPT-4o Mini',
  'o1': 'o1',
  'o1-mini': 'o1 Mini',
  // Gemini models
  'gemini-3-pro': 'Gemini 3 Pro',
  'gemini-3-pro-preview': 'Gemini 3 Pro Preview',
  'gemini-2.0-flash-exp': 'Gemini 2.0 Flash Exp',
  'gemini-2.0-flash': 'Gemini 2.0 Flash',
  'gemini-1.5-pro': 'Gemini 1.5 Pro',
  'gemini-1.5-flash': 'Gemini 1.5 Flash',
};

// Get friendly display name for a model, falling back to the API name if not found
const getModelDisplayName = (modelId: string): string => {
  return MODEL_DISPLAY_NAMES[modelId] || modelId;
};

// Determine the MCP API base URL.
// Priority order:
// 1. VITE_STORY_UI_EDGE_URL - Edge Worker URL for cloud deployments
// 2. window.__STORY_UI_EDGE_URL__ - Runtime override for edge URL
// 3. Production domains (railway.app, render.com, pages.dev) - use same origin
// 4. VITE_STORY_UI_PORT - Custom port for localhost
// 5. window.__STORY_UI_PORT__ - Legacy port override
// 6. window.STORY_UI_MCP_PORT - MCP port override
// 7. Default to localhost:4001
const getApiBaseUrl = () => {
  // Check for Edge Worker URL (cloud deployment)
  const edgeUrl = (import.meta as any).env?.VITE_STORY_UI_EDGE_URL;
  if (edgeUrl) return edgeUrl.replace(/\/$/, ''); // Remove trailing slash

  // Check for window override for edge URL (support both naming conventions)
  const windowEdgeUrl = (window as any).__STORY_UI_EDGE_URL__ || (window as any).STORY_UI_EDGE_URL;
  if (windowEdgeUrl) return windowEdgeUrl.replace(/\/$/, '');

  // Check if we're running on Railway production domain
  // In this case, the MCP server is proxied through the same origin
  if (typeof window !== 'undefined') {
    const hostname = window.location.hostname;
    if (hostname.includes('.railway.app')) {
      // Use same-origin requests (empty string means relative URLs)
      return '';
    }
  }

  // Check for Vite port environment variable
  const vitePort = (import.meta as any).env?.VITE_STORY_UI_PORT;
  if (vitePort) return `http://localhost:${vitePort}`;

  // Check for window override (legacy support)
  const windowOverride = (window as any).__STORY_UI_PORT__;
  if (windowOverride) return `http://localhost:${windowOverride}`;

  // Check for MCP port override set by stories file
  const mcpOverride = (window as any).STORY_UI_MCP_PORT;
  if (mcpOverride) return `http://localhost:${mcpOverride}`;

  return 'http://localhost:4001';
};

// Helper to check if we're using Edge mode (cloud deployment)
const isEdgeMode = () => {
  const baseUrl = getApiBaseUrl();
  return baseUrl.includes('workers.dev') || baseUrl.includes('pages.dev') ||
         baseUrl.startsWith('https://') && !baseUrl.includes('localhost');
};

// Helper to convert story title to Storybook URL format
// e.g., "Simple Card With Image" -> "generated-simple-card-with-image--default"
const titleToStoryPath = (title: string): string => {
  const kebabTitle = title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  return `generated-${kebabTitle}--default`;
};

// Helper to navigate to a newly created story after generation completes
// In dev mode with HMR, this prevents the "Couldn't find story after HMR" error
// In all modes, this provides a better UX by auto-navigating to the new story
const navigateToNewStory = (title: string, _code?: string, delayMs: number = 1500) => {
  const storyPath = titleToStoryPath(title);
  console.log(`[Story UI] Will navigate to story "${storyPath}" in ${delayMs}ms...`);

  setTimeout(() => {
    // Navigate the TOP window (parent Storybook UI), not the iframe
    // The Story UI panel runs inside an iframe, so we need window.top to escape it
    const topWindow = window.top || window;
    const newUrl = `${topWindow.location.origin}/?path=/story/${storyPath}`;
    console.log(`[Story UI] Navigating parent window to: ${newUrl}`);
    topWindow.location.href = newUrl;
  }, delayMs);
};

// Legacy helper for backwards compatibility
const getApiPort = () => {
  const baseUrl = getApiBaseUrl();
  const match = baseUrl.match(/:(\d+)$/);
  return match ? match[1] : '4001';
};

// Get connection display text
const getConnectionDisplayText = () => {
  const baseUrl = getApiBaseUrl();
  if (isEdgeMode()) {
    // Extract domain for Edge URL
    try {
      const url = new URL(baseUrl);
      return `Edge Worker (${url.hostname})`;
    } catch {
      return 'Edge Worker';
    }
  }
  return `MCP server (port ${getApiPort()})`;
};

const API_BASE = getApiBaseUrl();
const MCP_API = `${API_BASE}/story-ui/generate`;
const MCP_STREAM_API = `${API_BASE}/story-ui/generate-stream`;
const STORIES_API = `${API_BASE}/story-ui/stories`;
const DELETE_API_BASE = `${API_BASE}/story-ui/stories`;
const PROVIDERS_API = `${API_BASE}/story-ui/providers`;
// Considerations API URL - includes storybookOrigin param for Edge mode
const getConsiderationsApiUrl = () => {
  const baseUrl = `${API_BASE}/story-ui/considerations`;
  if (isEdgeMode()) {
    // In Edge mode, tell the Edge Worker where to fetch considerations from
    // The Storybook origin is where the panel is running (window.location.origin)
    const storybookOrigin = window.location.origin;
    return `${baseUrl}?storybookOrigin=${encodeURIComponent(storybookOrigin)}`;
  }
  return baseUrl;
};
const CONSIDERATIONS_API = getConsiderationsApiUrl();
const STORAGE_KEY = `story-ui-chats-${window.location.port}`;
const MAX_RECENT_CHATS = 20;

// Feature flag: Enable streaming mode (can be toggled for testing)
const USE_STREAMING = true;

// Load from localStorage
const loadChats = (): ChatSession[] => {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (!stored) return [];
    const chats = JSON.parse(stored) as ChatSession[];
    // Sort by lastUpdated and limit
    return chats
      .sort((a, b) => b.lastUpdated - a.lastUpdated)
      .slice(0, MAX_RECENT_CHATS);
  } catch (e) {
    console.error('Failed to load chats:', e);
    return [];
  }
};

// Save to localStorage
const saveChats = (chats: ChatSession[]) => {
  try {
    // Keep only the most recent chats
    const toSave = chats
      .sort((a, b) => b.lastUpdated - a.lastUpdated)
      .slice(0, MAX_RECENT_CHATS);
    localStorage.setItem(STORAGE_KEY, JSON.stringify(toSave));
  } catch (e) {
    console.error('Failed to save chats:', e);
  }
};

// Sync with memory stories from backend
const syncWithActualStories = async (): Promise<ChatSession[]> => {
  try {
    const response = await fetch(STORIES_API);
    if (!response.ok) {
      console.error('Failed to fetch stories from backend');
      return loadChats();
    }

    // Check if response is JSON
    const contentType = response.headers.get('content-type');
    if (!contentType || !contentType.includes('application/json')) {
      console.error('Server returned non-JSON response, likely server not running or wrong port');
      return loadChats();
    }

    const data = await response.json();
    const memoryStories = data.stories || [];

    // Load existing chats
    const existingChats = loadChats();

    // Create a map for quick lookup - using chat.id as the primary key
    const chatMap = new Map<string, ChatSession>();
    existingChats.forEach(chat => {
      chatMap.set(chat.id, chat);
    });

    // Update or add memory stories
    memoryStories.forEach((story: any) => {
      const storyId = story.storyId || story.fileName;

      // Look for existing chat by ID or by matching fileName
      let existingChat = chatMap.get(storyId);

      // If not found by ID, search by fileName
      if (!existingChat && story.fileName) {
        for (const [id, chat] of chatMap.entries()) {
          if (chat.fileName === story.fileName) {
            existingChat = chat;
            break;
          }
        }
      }

      if (existingChat) {
        // Update existing chat with latest info
        existingChat.title = story.title || existingChat.title;
        existingChat.fileName = story.fileName || existingChat.fileName;
        existingChat.lastUpdated = new Date(story.updatedAt || story.createdAt).getTime();
      } else {
        // Create new chat from memory story
        const newChat: ChatSession = {
          id: storyId,
          title: story.title || story.fileName,
          fileName: story.fileName,
          conversation: [{
            role: 'user',
            content: story.prompt || `Generate ${story.title}`
          }, {
            role: 'ai',
            content: `[SUCCESS] Created story: "${story.title}"\n\nThis story was recovered from memory. You can continue updating it or view it in Storybook.`
          }],
          lastUpdated: new Date(story.updatedAt || story.createdAt).getTime()
        };
        chatMap.set(storyId, newChat);
      }
    });

    // Convert back to array and save
    const syncedChats = Array.from(chatMap.values());
    saveChats(syncedChats);

    return syncedChats;
  } catch (error) {
    console.error('Error syncing with backend:', error);
    return loadChats();
  }
};

// Delete story and chat
const deleteStoryAndChat = async (chatId: string): Promise<boolean> => {
  try {
    // Remove .stories.tsx extension if present to get the actual story ID
    const storyId = chatId.replace(/\.stories\.tsx$/, '');
    console.log(`Attempting to delete story: chatId="${chatId}", storyId="${storyId}"`);

    let serverDeleteSucceeded = false;

    // First try to delete from backend
    try {
      const response = await fetch(`${DELETE_API_BASE}/${storyId}`, {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' }
      });

      // 404 means story doesn't exist on server - that's OK, we can still clean up localStorage
      if (response.ok || response.status === 404) {
        serverDeleteSucceeded = true;
        if (response.status === 404) {
          console.log('Story not found on server (may have been a failed generation), cleaning up localStorage');
        }
      } else {
        console.warn(`Backend delete returned ${response.status}, trying legacy endpoint`);
      }
    } catch (fetchError) {
      console.warn('Backend delete request failed, trying legacy endpoint:', fetchError);
    }

    // Try legacy endpoint as fallback only if primary didn't succeed
    if (!serverDeleteSucceeded) {
      try {
        const legacyResponse = await fetch(`${API_BASE}/story-ui/delete`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            chatId: storyId,
            storyId: storyId
          })
        });

        // 404 is also OK for legacy endpoint
        if (legacyResponse.ok || legacyResponse.status === 404) {
          serverDeleteSucceeded = true;
        } else {
          console.warn('Legacy delete endpoint also returned non-success status');
        }
      } catch (legacyError) {
        console.warn('Legacy delete request failed:', legacyError);
      }
    }

    // Always clean up localStorage - the chat/story data is primarily client-side
    // Even if server delete failed, we should allow users to clean up their chat history
    const chats = loadChats().filter(chat => chat.id !== chatId);
    saveChats(chats);
    console.log('Cleaned up localStorage chat entry');

    return true;
  } catch (error) {
    console.error('Error deleting story:', error);
    // Still try to clean up localStorage even on error
    try {
      const chats = loadChats().filter(chat => chat.id !== chatId);
      saveChats(chats);
      console.log('Cleaned up localStorage despite error');
      return true;
    } catch (localError) {
      console.error('Failed to clean up localStorage:', localError);
      return false;
    }
  }
};

// Test connection to MCP server
const testMCPConnection = async (): Promise<{ connected: boolean; error?: string }> => {
  try {
    const response = await fetch(STORIES_API, {
      method: 'GET',
      headers: { 'Content-Type': 'application/json' },
    });

    if (!response.ok) {
      return { connected: false, error: `HTTP ${response.status}: ${response.statusText}` };
    }

    const contentType = response.headers.get('content-type');
    if (!contentType || !contentType.includes('application/json')) {
      return { connected: false, error: 'Server returned non-JSON response (likely wrong port or server not running)' };
    }

    return { connected: true };
  } catch (error) {
    return { connected: false, error: error instanceof Error ? error.message : 'Unknown error' };
  }
};

// Fetch orphan stories (stories on disk without corresponding chat history)
const fetchOrphanStories = async (): Promise<OrphanStory[]> => {
  try {
    const response = await fetch(STORIES_API);
    if (!response.ok) {
      console.error('Failed to fetch stories from backend for orphan detection');
      return [];
    }

    const contentType = response.headers.get('content-type');
    if (!contentType || !contentType.includes('application/json')) {
      console.error('Server returned non-JSON response for orphan detection');
      return [];
    }

    const data = await response.json();
    const serverStories = data.stories || [];

    // Load current chats from localStorage
    const existingChats = loadChats();
    const chatIds = new Set(existingChats.map(chat => chat.id));
    const chatFileNames = new Set(existingChats.map(chat => chat.fileName).filter(Boolean));

    // Find stories that don't have a matching chat
    const orphans: OrphanStory[] = [];

    serverStories.forEach((story: any) => {
      const storyId = story.id || story.storyId || story.fileName;
      const fileName = story.fileName || '';

      // Check if this story has a corresponding chat
      const hasMatchingChat = chatIds.has(storyId) || chatFileNames.has(fileName);

      if (!hasMatchingChat && fileName) {
        orphans.push({
          id: storyId,
          fileName: fileName,
          title: story.title || fileName.replace(/\.stories\.(tsx|ts|jsx|js)$/, ''),
          createdAt: new Date(story.createdAt || Date.now()).getTime(),
        });
      }
    });

    // Sort by creation date, newest first
    return orphans.sort((a, b) => b.createdAt - a.createdAt);
  } catch (error) {
    console.error('Error fetching orphan stories:', error);
    return [];
  }
};

// Component styles
const STYLES = {
  container: {
    display: 'flex',
    flexDirection: 'row' as const,
    fontFamily: '"IBM Plex Sans", -apple-system, BlinkMacSystemFont, "Segoe UI", "Roboto", "Oxygen", "Ubuntu", "Cantarell", sans-serif',
    height: '100vh',
    overflow: 'hidden',
    background: 'linear-gradient(135deg, #1e293b 0%, #334155 100%)',
    color: '#e2e8f0',
    fontSize: '14px',
    lineHeight: '1.5',
  },

  // Sidebar
  sidebar: {
    width: '240px',
    background: 'rgba(255, 255, 255, 0.03)',
    borderRight: '1px solid rgba(255, 255, 255, 0.08)',
    display: 'flex',
    flexDirection: 'column' as const,
    backdropFilter: 'blur(10px)',
    transition: 'width 0.3s ease',
    position: 'relative' as const,
  },

  sidebarCollapsed: {
    width: '56px',
  },

  sidebarToggle: {
    width: '100%',
    padding: '10px 14px',
    background: 'rgba(59, 130, 246, 0.15)',
    color: '#e2e8f0',
    border: '1px solid rgba(59, 130, 246, 0.3)',
    borderRadius: '8px',
    fontSize: '14px',
    fontWeight: '600',
    cursor: 'pointer',
    marginBottom: '8px',
    transition: 'all 0.2s ease',
    boxShadow: 'none',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'flex-start',
    gap: '10px',
    lineHeight: '1',
  },

  newChatButton: {
    width: '100%',
    padding: '10px 14px',
    background: '#3b82f6',
    color: 'white',
    border: 'none',
    borderRadius: '8px',
    fontSize: '14px',
    fontWeight: '600',
    cursor: 'pointer',
    marginBottom: '16px',
    transition: 'all 0.2s ease',
    boxShadow: '0 2px 8px rgba(59, 130, 246, 0.25)',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'flex-start',
    gap: '10px',
    lineHeight: '1',
  },

  chatItem: {
    padding: '8px 12px',
    marginBottom: '4px',
    background: 'rgba(255, 255, 255, 0.05)',
    borderRadius: '6px',
    cursor: 'pointer',
    transition: 'all 0.15s ease',
    position: 'relative' as const,
    paddingRight: '32px',
  },

  chatItemActive: {
    background: 'rgba(59, 130, 246, 0.15)',
    borderLeft: '2px solid #3b82f6',
  },

  chatItemTitle: {
    fontSize: '14px',
    fontWeight: '500',
    marginBottom: '2px',
    whiteSpace: 'nowrap' as const,
    overflow: 'hidden',
    textOverflow: 'ellipsis',
  },

  chatItemTime: {
    fontSize: '12px',
    color: '#94a3b8',
  },

  deleteButton: {
    position: 'absolute' as const,
    right: '8px',
    top: '50%',
    transform: 'translateY(-50%)',
    background: 'rgba(239, 68, 68, 0.8)',
    color: 'white',
    border: 'none',
    borderRadius: '4px',
    padding: '4px 8px',
    fontSize: '12px',
    cursor: 'pointer',
    opacity: 0,
    transition: 'opacity 0.2s ease',
  },

  // Main content
  mainContent: {
    flex: 1,
    display: 'flex',
    flexDirection: 'column' as const,
    overflow: 'hidden',
  },

  chatHeader: {
    padding: '12px 16px',
    borderBottom: '1px solid rgba(255, 255, 255, 0.08)',
    background: 'rgba(255, 255, 255, 0.03)',
    backdropFilter: 'blur(10px)',
  },

  chatContainer: {
    flex: 1,
    padding: '16px',
    overflowY: 'auto' as const,
    scrollBehavior: 'smooth' as const,
  },

  emptyState: {
    color: '#94a3b8',
    textAlign: 'center' as const,
    marginTop: '60px',
  },

  emptyStateTitle: {
    fontSize: '15px',
    fontWeight: '500',
    marginBottom: '8px',
    color: '#cbd5e1',
  },

  emptyStateSubtitle: {
    fontSize: '13px',
    color: '#64748b',
  },

  // Message bubbles
  messageContainer: {
    display: 'flex',
    marginBottom: '8px',
  },

  userMessage: {
    background: 'rgba(59, 130, 246, 0.12)',
    color: '#e2e8f0',
    borderRadius: '16px 16px 4px 16px',
    padding: '10px 14px',
    maxWidth: '85%',
    marginLeft: 'auto',
    fontSize: '14px',
    lineHeight: '1.45',
    boxShadow: 'none',
    wordWrap: 'break-word' as const,
    border: '1px solid rgba(59, 130, 246, 0.2)',
  },

  aiMessage: {
    background: 'rgba(255, 255, 255, 0.95)',
    color: '#1f2937',
    borderRadius: '16px 16px 16px 4px',
    padding: '10px 14px',
    maxWidth: '90%',
    fontSize: '14px',
    lineHeight: '1.45',
    boxShadow: '0 1px 2px rgba(0, 0, 0, 0.06)',
    border: '1px solid rgba(0, 0, 0, 0.08)',
    wordWrap: 'break-word' as const,
    whiteSpace: 'pre-wrap' as const,
  },

  loadingMessage: {
    background: 'rgba(255, 255, 255, 0.95)',
    color: '#4b5563',
    borderRadius: '16px 16px 16px 4px',
    padding: '10px 14px',
    fontSize: '14px',
    lineHeight: '1.45',
    display: 'flex',
    alignItems: 'center',
    gap: '8px',
    border: '1px solid rgba(0, 0, 0, 0.08)',
    boxShadow: '0 1px 2px rgba(0, 0, 0, 0.06)',
  },

  // Input form
  inputForm: {
    display: 'flex',
    alignItems: 'center',
    gap: '12px',
    margin: '0 16px 16px 16px',
    padding: '12px',
    background: 'rgba(255, 255, 255, 0.03)',
    borderRadius: '12px',
    border: '1px solid rgba(255, 255, 255, 0.08)',
    backdropFilter: 'blur(10px)',
  },

  textInput: {
    font: 'inherit',
    flex: 1,
    padding: '12px 16px',
    borderRadius: '8px',
    border: '1px solid rgba(255, 255, 255, 0.15)',
    fontSize: '13px',
    color: '#1f2937',
    background: '#ffffff',
    outline: 'none',
    transition: 'all 0.15s ease',
    boxSizing: 'border-box' as const,
  },

  sendButton: {
    font: 'inherit',
    padding: '10px 16px',
    borderRadius: '10px',
    border: 'none',
    background: '#3b82f6',
    color: 'white',
    fontSize: '14px',
    fontWeight: '600',
    cursor: 'pointer',
    display: 'flex',
    alignItems: 'center',
    gap: '6px',
    transition: 'all 0.2s ease',
    boxShadow: '0 2px 8px rgba(59, 130, 246, 0.35)',
    flexShrink: 0,
  },

  errorMessage: {
    background: 'rgba(248, 113, 113, 0.1)',
    color: '#f87171',
    padding: '8px 12px',
    borderRadius: '6px',
    fontSize: '13px',
    marginBottom: '8px',
    border: '1px solid rgba(248, 113, 113, 0.2)',
  },

  loadingDots: {
    display: 'inline-block',
    animation: 'loadingDots 1.4s infinite',
  },

  '@keyframes loadingDots': {
    '0%': { content: '""' },
    '25%': { content: '"."' },
    '50%': { content: '".."' },
    '75%': { content: '"..."' },
  },

  codeBlock: {
    background: '#1e293b',
    padding: '12px',
    borderRadius: '8px',
    fontFamily: 'Consolas, Monaco, "Andale Mono", "Ubuntu Mono", monospace',
    fontSize: '12px',
    lineHeight: '1.5',
    overflowX: 'auto' as const,
    marginTop: '8px',
    border: '1px solid rgba(255, 255, 255, 0.08)',
  },

  // Streaming progress styles
  streamingContainer: {
    background: 'rgba(255, 255, 255, 0.95)',
    borderRadius: '16px 16px 16px 4px',
    padding: '10px 14px',
    maxWidth: '90%',
    boxShadow: '0 1px 2px rgba(0, 0, 0, 0.06)',
    border: '1px solid rgba(0, 0, 0, 0.08)',
    fontSize: '14px',
    lineHeight: '1.45',
  },

  intentPreview: {
    background: 'rgba(59, 130, 246, 0.06)',
    borderRadius: '8px',
    padding: '10px 12px',
    marginBottom: '10px',
    border: '1px solid rgba(59, 130, 246, 0.12)',
  },

  intentTitle: {
    fontSize: '13px',
    fontWeight: '600',
    color: '#1e40af',
    marginBottom: '8px',
    display: 'flex',
    alignItems: 'center',
    gap: '4px',
  },

  intentStrategy: {
    fontSize: '12px',
    color: '#4b5563',
    marginBottom: '4px',
  },

  intentComponents: {
    display: 'flex',
    flexWrap: 'wrap' as const,
    gap: '4px',
    marginTop: '8px',
  },

  componentTag: {
    background: 'rgba(59, 130, 246, 0.12)',
    color: '#1d4ed8',
    fontSize: '11px',
    padding: '2px 8px',
    borderRadius: '10px',
    fontWeight: '500',
  },

  progressBar: {
    background: 'rgba(0, 0, 0, 0.08)',
    borderRadius: '4px',
    height: '4px',
    marginTop: '12px',
    marginBottom: '8px',
    overflow: 'hidden',
  },

  progressFill: {
    background: '#3b82f6',
    height: '100%',
    borderRadius: '3px',
    transition: 'width 0.3s ease',
  },

  progressPhase: {
    fontSize: '14px',
    color: '#4b5563',
    display: 'flex',
    alignItems: 'center',
    gap: '6px',
    fontWeight: '500',
    lineHeight: '1.45',
  },

  phaseIcon: {
    fontSize: '14px',
  },

  validationBox: {
    marginTop: '8px',
    padding: '8px',
    borderRadius: '6px',
    fontSize: '11px',
  },

  validationSuccess: {
    background: 'rgba(16, 185, 129, 0.08)',
    border: '1px solid rgba(16, 185, 129, 0.15)',
    color: '#047857',
  },

  validationWarning: {
    background: 'rgba(245, 158, 11, 0.08)',
    border: '1px solid rgba(245, 158, 11, 0.15)',
    color: '#b45309',
  },

  validationError: {
    background: 'rgba(239, 68, 68, 0.08)',
    border: '1px solid rgba(239, 68, 68, 0.15)',
    color: '#dc2626',
  },

  retryBadge: {
    background: 'rgba(245, 158, 11, 0.12)',
    color: '#b45309',
    fontSize: '11px',
    padding: '2px 8px',
    borderRadius: '10px',
    display: 'inline-flex',
    alignItems: 'center',
    gap: '4px',
    marginTop: '8px',
  },

  completionSummary: {
    marginTop: '10px',
    paddingTop: '10px',
    borderTop: '1px solid rgba(0, 0, 0, 0.06)',
  },

  summaryTitle: {
    fontSize: '14px',
    fontWeight: '600',
    color: '#111827',
    marginBottom: '6px',
    display: 'flex',
    alignItems: 'center',
    gap: '6px',
    lineHeight: '1.45',
  },

  summaryDescription: {
    fontSize: '14px',
    color: '#4b5563',
    lineHeight: '1.45',
  },

  metricsRow: {
    display: 'flex',
    gap: '10px',
    marginTop: '6px',
    fontSize: '13px',
    color: '#6b7280',
  },

  metric: {
    display: 'flex',
    alignItems: 'center',
    gap: '4px',
  },

  // Code viewer styles for generated stories
  codeViewerContainer: {
    marginTop: '12px',
    borderTop: '1px solid rgba(0, 0, 0, 0.08)',
    paddingTop: '12px',
  },

  codeViewerToggle: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: '8px 12px',
    background: 'rgba(59, 130, 246, 0.08)',
    borderRadius: '6px',
    cursor: 'pointer',
    border: '1px solid rgba(59, 130, 246, 0.15)',
    transition: 'all 0.2s ease',
    fontSize: '13px',
    fontWeight: '500',
    color: '#1e40af',
  },

  codeViewerToggleHover: {
    background: 'rgba(59, 130, 246, 0.15)',
  },

  codeViewerContent: {
    marginTop: '12px',
    background: '#1e293b',
    borderRadius: '8px',
    overflow: 'hidden',
    border: '1px solid rgba(255, 255, 255, 0.08)',
  },

  codeViewerHeader: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: '8px 12px',
    background: 'rgba(0, 0, 0, 0.2)',
    borderBottom: '1px solid rgba(255, 255, 255, 0.08)',
  },

  codeViewerFileName: {
    fontSize: '12px',
    color: '#94a3b8',
    fontFamily: 'ui-monospace, monospace',
  },

  copyButton: {
    padding: '4px 12px',
    fontSize: '11px',
    fontWeight: '500',
    color: '#e2e8f0',
    background: 'rgba(59, 130, 246, 0.3)',
    border: '1px solid rgba(59, 130, 246, 0.5)',
    borderRadius: '4px',
    cursor: 'pointer',
    transition: 'all 0.2s ease',
  },

  copyButtonSuccess: {
    background: 'rgba(34, 197, 94, 0.3)',
    borderColor: 'rgba(34, 197, 94, 0.5)',
    color: '#86efac',
  },

  codeViewerPre: {
    margin: 0,
    padding: '12px',
    fontSize: '11px',
    lineHeight: '1.5',
    fontFamily: 'ui-monospace, Consolas, Monaco, monospace',
    color: '#e2e8f0',
    overflowX: 'auto' as const,
    maxHeight: '400px',
    overflowY: 'auto' as const,
  },

  // Image upload styles
  uploadButton: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    width: '36px',
    height: '36px',
    borderRadius: '6px',
    border: '1px solid rgba(255, 255, 255, 0.15)',
    background: 'rgba(255, 255, 255, 0.08)',
    color: '#e2e8f0',
    cursor: 'pointer',
    transition: 'all 0.2s ease',
    flexShrink: 0,
  },

  uploadButtonHover: {
    background: 'rgba(59, 130, 246, 0.2)',
    borderColor: 'rgba(59, 130, 246, 0.5)',
  },

  imagePreviewContainer: {
    display: 'flex',
    flexWrap: 'wrap' as const,
    gap: '8px',
    padding: '8px 12px',
    background: 'rgba(255, 255, 255, 0.03)',
    borderBottom: '1px solid rgba(255, 255, 255, 0.08)',
    margin: '0 16px',
    borderRadius: '8px 8px 0 0',
  },

  imagePreviewItem: {
    position: 'relative' as const,
    width: '56px',
    height: '56px',
    borderRadius: '6px',
    overflow: 'hidden',
    border: '1px solid rgba(255, 255, 255, 0.15)',
    background: '#1e293b',
  },

  imagePreviewImg: {
    width: '100%',
    height: '100%',
    objectFit: 'cover' as const,
  },

  imageRemoveButton: {
    position: 'absolute' as const,
    top: '2px',
    right: '2px',
    width: '18px',
    height: '18px',
    borderRadius: '50%',
    background: 'rgba(239, 68, 68, 0.9)',
    color: 'white',
    border: 'none',
    fontSize: '12px',
    cursor: 'pointer',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    lineHeight: 1,
  },

  imagePreviewLabel: {
    display: 'flex',
    alignItems: 'center',
    gap: '8px',
    fontSize: '12px',
    color: '#94a3b8',
    marginRight: 'auto',
  },

  userMessageImages: {
    display: 'flex',
    gap: '8px',
    marginTop: '8px',
    flexWrap: 'wrap' as const,
  },

  userMessageImage: {
    width: '40px',
    height: '40px',
    borderRadius: '6px',
    objectFit: 'cover' as const,
    border: '1px solid rgba(255, 255, 255, 0.25)',
  },

  // Drag and drop overlay
  dropOverlay: {
    position: 'absolute' as const,
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    background: 'rgba(59, 130, 246, 0.12)',
    border: '2px dashed rgba(59, 130, 246, 0.4)',
    borderRadius: '10px',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 100,
    backdropFilter: 'blur(3px)',
  },

  dropOverlayText: {
    background: 'rgba(59, 130, 246, 0.85)',
    color: 'white',
    padding: '12px 24px',
    borderRadius: '8px',
    fontSize: '14px',
    fontWeight: '500',
    display: 'flex',
    alignItems: 'center',
    gap: '8px',
    boxShadow: '0 2px 8px rgba(59, 130, 246, 0.3)',
  },
};

// Add custom style for loading animation and IBM Plex Sans font
// Use a unique ID to prevent duplicate stylesheets during HMR
const STYLESHEET_ID = 'story-ui-panel-styles';
if (!document.getElementById(STYLESHEET_ID)) {
  // Load IBM Plex Sans font
  const fontLink = document.createElement('link');
  fontLink.rel = 'stylesheet';
  fontLink.href = 'https://fonts.googleapis.com/css2?family=IBM+Plex+Sans:wght@400;500;600;700&display=swap';
  document.head.appendChild(fontLink);

  const styleSheet = document.createElement('style');
  styleSheet.id = STYLESHEET_ID;
  styleSheet.textContent = `
    @keyframes loadingDots {
      0%, 20% { content: "."; }
      40% { content: ".."; }
      60%, 100% { content: "..."; }
    }

    .loading-dots::after {
      content: ".";
      animation: loadingDots 1.4s infinite;
    }

    /* Override Storybook's default styles with !important */
    .story-ui-panel,
    .story-ui-panel * {
      font-family: "IBM Plex Sans", -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif !important;
    }

    .story-ui-panel {
      font-size: 14px !important;
      line-height: 1.5 !important;
    }

    /* Message bubbles - consistent styling */
    .story-ui-message {
      font-size: 16px !important;
      line-height: 1.45 !important;
      padding: 12px 16px !important;
    }

    .story-ui-user-message {
      background: rgba(59, 130, 246, 0.12) !important;
      color: #e2e8f0 !important;
      border-radius: 18px 18px 4px 18px !important;
      border: 1px solid rgba(59, 130, 246, 0.2) !important;
    }

    .story-ui-ai-message {
      background: rgba(255, 255, 255, 0.97) !important;
      color: #1f2937 !important;
      border-radius: 18px 18px 18px 4px !important;
      border: 1px solid rgba(0, 0, 0, 0.08) !important;
      box-shadow: 0 1px 3px rgba(0, 0, 0, 0.08) !important;
    }

    /* Override nested elements in AI messages (from renderMarkdown)
    .story-ui-ai-message p,
    .story-ui-ai-message span,
    .story-ui-ai-message strong,
    .story-ui-ai-message em,
    .story-ui-ai-message li,
    .story-ui-ai-message ul,
    .story-ui-ai-message ol {
      font-size: 14px !important;
      line-height: 1.45 !important;
      margin: 0 !important;
    } */

    .story-ui-ai-message p + p {
      margin-top: 8px !important;
    }

    /* Status text */
    .story-ui-status {
      font-size: 13px !important;
      font-weight: 400 !important;
    }

    .story-ui-status-connected {
      color: #10b981 !important;
    }

    .story-ui-status-disconnected {
      color: #ef4444 !important;
    }

    /* Sidebar buttons */
    .story-ui-sidebar button {
      font-size: 14px !important;
      font-weight: 600 !important;
    }

    /* Header text */
    .story-ui-header h1 {
      font-size: 24px !important;
      font-weight: 700 !important;
    }

    .story-ui-header p {
      font-size: 14px !important;
      color: #94a3b8 !important;
    }

    /* Input field */
    .story-ui-input {
      font-size: 14px !important;
      font-family: "IBM Plex Sans", -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif !important;
    }

    /* Code blocks in messages */
    .story-ui-ai-message code {
      font-family: ui-monospace, SFMono-Regular, "SF Mono", Menlo, Consolas, monospace !important;
      font-size: 13px !important;
      background: rgba(0, 0, 0, 0.06) !important;
      padding: 2px 6px !important;
      border-radius: 4px !important;
    }
  `;
  document.head.appendChild(styleSheet);
}

// Helper function to format timestamp
const formatTime = (timestamp: number): string => {
  // Handle invalid timestamps
  if (!timestamp || isNaN(timestamp) || timestamp <= 0) {
    return '';
  }

  const date = new Date(timestamp);

  // Check if the date is valid
  if (isNaN(date.getTime())) {
    return '';
  }

  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffMins = Math.floor(diffMs / 60000);
  const diffHours = Math.floor(diffMs / 3600000);
  const diffDays = Math.floor(diffMs / 86400000);

  if (diffMins < 1) return 'just now';
  if (diffMins < 60) return `${diffMins}m ago`;
  if (diffHours < 24) return `${diffHours}h ago`;
  if (diffDays < 7) return `${diffDays}d ago`;
  return date.toLocaleDateString();
};

// Helper to get phase text (no icons - cleaner UI)
const getPhaseInfo = (phase: ProgressUpdate['phase']): { text: string } => {
  const phases: Record<ProgressUpdate['phase'], { text: string }> = {
    config_loaded: { text: 'Loading configuration' },
    components_discovered: { text: 'Discovering components' },
    prompt_built: { text: 'Building prompt' },
    llm_thinking: { text: 'AI is thinking' },
    code_extracted: { text: 'Extracting code' },
    validating: { text: 'Validating output' },
    post_processing: { text: 'Processing' },
    saving: { text: 'Saving story' },
  };
  return phases[phase] || { text: 'Working' };
};

// Streaming Progress Message Component
const StreamingProgressMessage: React.FC<{ streamingData: StreamingState }> = ({ streamingData }) => {
  const { intent, progress, validation, retry, completion, error } = streamingData;
  const [showCode, setShowCode] = useState(true); // Show code by default for better UX
  const [copyStatus, setCopyStatus] = useState<'idle' | 'copied'>('idle');

  // Handle copy to clipboard
  const handleCopyCode = async (code: string) => {
    try {
      await navigator.clipboard.writeText(code);
      setCopyStatus('copied');
      setTimeout(() => setCopyStatus('idle'), 2000);
    } catch (err) {
      console.error('Failed to copy:', err);
    }
  };

  // If completed, show completion summary
  if (completion) {
    return (
      <div style={STYLES.streamingContainer}>
        <div style={STYLES.completionSummary}>
          <div style={STYLES.summaryTitle}>
            {completion.success ? StatusIcons.success : StatusIcons.error} {completion.title}
          </div>
          <div style={STYLES.summaryDescription}>
            {completion.summary.description}
          </div>

          {/* Components Used */}
          {completion.componentsUsed.length > 0 && (
            <div style={{ marginTop: '12px' }}>
              <div style={{ fontSize: '12px', color: '#6b7280', marginBottom: '8px' }}>Components used:</div>
              <div style={STYLES.intentComponents}>
                {completion.componentsUsed.map((comp, i) => (
                  <span key={i} style={STYLES.componentTag}>{comp.name}</span>
                ))}
              </div>
            </div>
          )}

          {/* Layout Choices */}
          {completion.layoutChoices.length > 0 && (
            <div style={{ marginTop: '12px' }}>
              <div style={{ fontSize: '12px', color: '#6b7280', marginBottom: '8px' }}>Layout:</div>
              <div style={{ fontSize: '12px', color: '#4b5563' }}>
                {completion.layoutChoices.map(l => l.pattern).join(', ')}
              </div>
            </div>
          )}

          {/* Validation Status */}
          {completion.validation && !completion.validation.isValid && (
            <div style={{ ...STYLES.validationBox, ...STYLES.validationWarning }}>
              {completion.validation.autoFixApplied ? 'Auto-fixed issues' : 'Minor issues detected'}
            </div>
          )}

          {/* Suggestions */}
          {completion.suggestions && completion.suggestions.length > 0 && (
            <div style={{ marginTop: '12px', fontSize: '12px', color: '#6b7280', display: 'flex', alignItems: 'flex-start', gap: '6px' }}>
              {StatusIcons.tip} <span>{completion.suggestions[0]}</span>
            </div>
          )}

          {/* Metrics */}
          {completion.metrics && (
            <div style={STYLES.metricsRow}>
              <span style={STYLES.metric}>{(completion.metrics.totalTimeMs / 1000).toFixed(1)}s</span>
              <span style={STYLES.metric}>{completion.metrics.llmCallsCount} LLM calls</span>
            </div>
          )}

          {/* Code Viewer - Show the generated story code */}
          {completion.code && (
            <div style={STYLES.codeViewerContainer}>
              <div
                style={STYLES.codeViewerToggle}
                onClick={() => setShowCode(!showCode)}
                role="button"
                tabIndex={0}
                onKeyDown={(e) => e.key === 'Enter' && setShowCode(!showCode)}
              >
                <span>{showCode ? '▼' : '▶'} View Generated Code</span>
                <span style={{ fontSize: '11px', color: '#6366f1' }}>{completion.fileName}</span>
              </div>
              {showCode && (
                <div style={STYLES.codeViewerContent}>
                  <div style={STYLES.codeViewerHeader}>
                    <span style={STYLES.codeViewerFileName}>{completion.fileName}</span>
                    <button
                      style={{
                        ...STYLES.copyButton,
                        ...(copyStatus === 'copied' ? STYLES.copyButtonSuccess : {})
                      }}
                      onClick={() => handleCopyCode(completion.code)}
                    >
                      {copyStatus === 'copied' ? 'Copied' : 'Copy'}
                    </button>
                  </div>
                  <pre style={STYLES.codeViewerPre}>
                    <code>{completion.code}</code>
                  </pre>
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    );
  }

  // If error, show error
  if (error) {
    return (
      <div style={STYLES.streamingContainer}>
        <div style={{ ...STYLES.validationBox, ...STYLES.validationError }}>
          <strong style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>{StatusIcons.error} {error.message}</strong>
          {error.details && <div style={{ marginTop: '4px' }}>{error.details}</div>}
          {error.suggestion && <div style={{ marginTop: '8px', display: 'flex', alignItems: 'flex-start', gap: '6px' }}>{StatusIcons.tip} <span>{error.suggestion}</span></div>}
        </div>
      </div>
    );
  }

  // Show progress - simplified to just show status without verbose details
  return (
    <div style={STYLES.streamingContainer}>
      {/* Simple progress indicator */}
      <div style={STYLES.intentPreview}>
        <div style={STYLES.progressPhase}>
          <span>Generating story...</span>
          {progress && (
            <span style={{ marginLeft: 'auto', color: '#9ca3af' }}>
              {progress.step}/{progress.totalSteps}
            </span>
          )}
        </div>

        {/* Progress Bar */}
        {progress && (
          <div style={{ ...STYLES.progressBar, marginTop: '8px' }}>
            <div
              style={{
                ...STYLES.progressFill,
                width: `${(progress.step / progress.totalSteps) * 100}%`
              }}
            />
          </div>
        )}
      </div>

      {/* Retry Badge - only show if retrying */}
      {retry && (
        <div style={STYLES.retryBadge}>
          Retry {retry.attempt}/{retry.maxAttempts}: {retry.reason}
        </div>
      )}

      {/* Loading indicator when no specific phase */}
      {!progress && !intent && (
        <div style={STYLES.progressPhase}>
          <span className="loading-dots">Connecting</span>
        </div>
      )}
    </div>
  );
};

// Main component
function StoryUIPanel() {
  const [input, setInput] = useState('');
  const [conversation, setConversation] = useState<Message[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [recentChats, setRecentChats] = useState<ChatSession[]>([]);
  const [activeChatId, setActiveChatId] = useState<string | null>(null);
  const [activeTitle, setActiveTitle] = useState<string>('');
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [connectionStatus, setConnectionStatus] = useState<{ connected: boolean; error?: string }>({ connected: false });
  const [availableProviders, setAvailableProviders] = useState<ProviderInfo[]>([]);
  const [selectedProvider, setSelectedProvider] = useState<string>('');
  const [selectedModel, setSelectedModel] = useState<string>('');
  const [streamingState, setStreamingState] = useState<StreamingState | null>(null);
  const [attachedImages, setAttachedImages] = useState<AttachedImage[]>([]);
  const [considerations, setConsiderations] = useState<string>('');
  const [orphanStories, setOrphanStories] = useState<OrphanStory[]>([]);
  const chatEndRef = useRef<HTMLDivElement | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const abortControllerRef = useRef<AbortController | null>(null);

  // Maximum images allowed
  const MAX_IMAGES = 4;
  const MAX_IMAGE_SIZE_MB = 20;

  // Helper to convert file to base64
  const fileToBase64 = (file: File): Promise<string> => {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.readAsDataURL(file);
      reader.onload = () => {
        const result = reader.result as string;
        // Extract base64 data (remove data:image/...;base64, prefix)
        const base64 = result.split(',')[1];
        resolve(base64);
      };
      reader.onerror = error => reject(error);
    });
  };

  // Handle file selection
  const handleFileSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files) return;

    const newImages: AttachedImage[] = [];
    const errors: string[] = [];

    for (let i = 0; i < files.length && (attachedImages.length + newImages.length) < MAX_IMAGES; i++) {
      const file = files[i];

      // Validate file type
      if (!file.type.startsWith('image/')) {
        errors.push(`${file.name}: Not an image file`);
        continue;
      }

      // Validate file size
      if (file.size > MAX_IMAGE_SIZE_MB * 1024 * 1024) {
        errors.push(`${file.name}: File too large (max ${MAX_IMAGE_SIZE_MB}MB)`);
        continue;
      }

      try {
        const base64 = await fileToBase64(file);
        const preview = URL.createObjectURL(file);

        newImages.push({
          id: `${Date.now()}-${i}`,
          file,
          preview,
          base64,
          mediaType: file.type || 'image/png',
        });
      } catch (err) {
        errors.push(`${file.name}: Failed to process`);
      }
    }

    if (errors.length > 0) {
      setError(errors.join('\n'));
    }

    setAttachedImages(prev => [...prev, ...newImages]);

    // Reset file input
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
  };

  // Remove attached image
  const removeAttachedImage = (id: string) => {
    setAttachedImages(prev => {
      const removed = prev.find(img => img.id === id);
      if (removed) {
        URL.revokeObjectURL(removed.preview);
      }
      return prev.filter(img => img.id !== id);
    });
  };

  // Clear all attached images
  const clearAttachedImages = () => {
    attachedImages.forEach(img => URL.revokeObjectURL(img.preview));
    setAttachedImages([]);
  };

  // Drag and drop state
  const [isDragging, setIsDragging] = useState(false);

  // Handle drag events
  const handleDragEnter = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (e.dataTransfer.types.includes('Files')) {
      setIsDragging(true);
    }
  }, []);

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    // Only set to false if we're leaving the main container
    if (!e.currentTarget.contains(e.relatedTarget as Node)) {
      setIsDragging(false);
    }
  }, []);

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
  }, []);

  const handleDrop = useCallback(async (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(false);

    const files = Array.from(e.dataTransfer.files);
    const imageFiles = files.filter(f => f.type.startsWith('image/'));

    if (imageFiles.length === 0) {
      setError('Please drop image files only');
      return;
    }

    const newImages: AttachedImage[] = [];
    const errors: string[] = [];

    for (let i = 0; i < imageFiles.length && (attachedImages.length + newImages.length) < MAX_IMAGES; i++) {
      const file = imageFiles[i];

      if (file.size > MAX_IMAGE_SIZE_MB * 1024 * 1024) {
        errors.push(`${file.name}: File too large (max ${MAX_IMAGE_SIZE_MB}MB)`);
        continue;
      }

      try {
        const base64 = await fileToBase64(file);
        const preview = URL.createObjectURL(file);

        newImages.push({
          id: `${Date.now()}-${i}`,
          file,
          preview,
          base64,
          mediaType: file.type || 'image/png',
        });
      } catch (err) {
        errors.push(`${file.name}: Failed to process`);
      }
    }

    if (errors.length > 0) {
      setError(errors.join('\n'));
    }

    setAttachedImages(prev => [...prev, ...newImages]);
  }, [attachedImages.length, fileToBase64]);

  // Handle clipboard paste for images
  const handlePaste = useCallback(async (e: React.ClipboardEvent) => {
    const items = e.clipboardData?.items;
    if (!items) return;

    const imageItems: DataTransferItem[] = [];
    for (let i = 0; i < items.length; i++) {
      if (items[i].type.startsWith('image/')) {
        imageItems.push(items[i]);
      }
    }

    if (imageItems.length === 0) return;

    // Prevent default text paste behavior when pasting images
    e.preventDefault();

    if (attachedImages.length >= MAX_IMAGES) {
      setError(`Maximum ${MAX_IMAGES} images allowed`);
      return;
    }

    const newImages: AttachedImage[] = [];
    const errors: string[] = [];

    for (let i = 0; i < imageItems.length && (attachedImages.length + newImages.length) < MAX_IMAGES; i++) {
      const item = imageItems[i];
      const file = item.getAsFile();

      if (!file) {
        errors.push('Failed to get image from clipboard');
        continue;
      }

      if (file.size > MAX_IMAGE_SIZE_MB * 1024 * 1024) {
        errors.push(`Pasted image too large (max ${MAX_IMAGE_SIZE_MB}MB)`);
        continue;
      }

      try {
        const base64 = await fileToBase64(file);
        const preview = URL.createObjectURL(file);

        // Create a meaningful name for pasted images
        const timestamp = new Date().toISOString().slice(11, 19).replace(/:/g, '-');
        const renamedFile = new File([file], `pasted-image-${timestamp}.${file.type.split('/')[1] || 'png'}`, { type: file.type });

        newImages.push({
          id: `paste-${Date.now()}-${i}`,
          file: renamedFile,
          preview,
          base64,
          mediaType: file.type || 'image/png',
        });
      } catch (err) {
        errors.push('Failed to process pasted image');
      }
    }

    if (errors.length > 0) {
      setError(errors.join('\n'));
    }

    if (newImages.length > 0) {
      setAttachedImages(prev => [...prev, ...newImages]);
      // Clear any existing error on successful paste
      if (errors.length === 0) {
        setError(null);
      }
    }
  }, [attachedImages.length, fileToBase64]);

  // Load and sync chats on mount
  useEffect(() => {
    const initializeChats = async () => {
      // Test connection first
      const connectionTest = await testMCPConnection();
      setConnectionStatus(connectionTest);

      if (connectionTest.connected) {
        // Fetch available providers
        try {
          const providersRes = await fetch(PROVIDERS_API);
          if (providersRes.ok) {
            const providersData: ProvidersResponse = await providersRes.json();
            setAvailableProviders(providersData.providers.filter(p => p.configured));
            // Set initial selection from server defaults
            if (providersData.current) {
              setSelectedProvider(providersData.current.provider.toLowerCase());
              setSelectedModel(providersData.current.model);
            }
          }
        } catch (e) {
          console.error('Failed to fetch providers:', e);
        }

        // Fetch design system considerations for environment parity
        // This ensures production gets the same considerations as local development
        try {
          const considerationsRes = await fetch(CONSIDERATIONS_API);
          if (considerationsRes.ok) {
            const considerationsData = await considerationsRes.json();
            if (considerationsData.hasConsiderations && considerationsData.considerations) {
              setConsiderations(considerationsData.considerations);
              console.log(`Loaded considerations from ${considerationsData.source}`);
            }
          }
        } catch (e) {
          console.error('Failed to fetch considerations:', e);
        }

        const syncedChats = await syncWithActualStories();
        const sortedChats = syncedChats.sort((a, b) => b.lastUpdated - a.lastUpdated).slice(0, MAX_RECENT_CHATS);
        setRecentChats(sortedChats);

        if (sortedChats.length > 0) {
          setConversation(sortedChats[0].conversation);
          setActiveChatId(sortedChats[0].id);
          setActiveTitle(sortedChats[0].title);
        }

        // Fetch orphan stories (stories on disk without chat history)
        const orphans = await fetchOrphanStories();
        setOrphanStories(orphans);
      } else {
        // Load from local storage if server is not available
        const localChats = loadChats();
        setRecentChats(localChats);
      }
    };

    initializeChats();
  }, []);

  // Scroll to bottom on new message
  useEffect(() => {
    if (chatEndRef.current) {
      chatEndRef.current.scrollIntoView({ behavior: 'smooth' });
    }
  }, [conversation, loading]);

  // Helper function for non-streaming fallback
  const handleSendNonStreaming = async (userInput: string, newConversation: Message[]) => {
    const res = await fetch(MCP_API, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        prompt: userInput,
        conversation: newConversation,
        fileName: activeChatId || undefined,
        provider: selectedProvider || undefined,
        model: selectedModel || undefined,
        considerations: considerations || undefined,
      }),
    });

    const contentType = res.headers.get('content-type');
    if (!contentType || !contentType.includes('application/json')) {
      const text = await res.text();
      throw new Error(`Server returned non-JSON response. Response: ${text.substring(0, 200)}...`);
    }

    const data = await res.json();
    if (!res.ok || !data.success) throw new Error(data.error || 'Story generation failed');

    return data;
  };

  // Helper function to build a conversational response from completion data
  // Uses special markers [SUCCESS], [ERROR], [TIP], [WRENCH] that renderMarkdown converts to icons
  // Track whether we've shown the refresh hint in this session
  const hasShownRefreshHint = useRef(false);

  const buildConversationalResponse = (completion: CompletionFeedback, isUpdate: boolean): string => {
    const parts: string[] = [];
    const statusMarker = completion.success ? '[SUCCESS]' : '[ERROR]';

    // Lead with the result - more conversational
    if (isUpdate) {
      parts.push(`${statusMarker} **Updated: "${completion.title}"**`);
    } else {
      parts.push(`${statusMarker} **Created: "${completion.title}"**`);
    }

    // Build component insights with reasons when available
    const componentCount = completion.componentsUsed?.length || 0;
    if (componentCount > 0) {
      const componentList = completion.componentsUsed!.slice(0, 5);

      // Check if we have meaningful reasons (not just "Used in composition")
      const componentsWithReasons = componentList.filter(c =>
        c.reason && c.reason !== 'Used in composition'
      );

      if (componentsWithReasons.length > 0) {
        // Show components with their reasons
        const insights = componentsWithReasons
          .slice(0, 3)
          .map(c => `\`${c.name}\` - ${c.reason?.toLowerCase()}`)
          .join(', ');
        parts.push(`\nUsed ${insights}${componentCount > 3 ? ` and ${componentCount - 3} more` : ''}.`);
      } else {
        // Fallback to simple list
        const names = componentList.map(c => `\`${c.name}\``).join(', ');
        parts.push(`\nBuilt with ${names}${componentCount > 5 ? '...' : ''}.`);
      }
    }

    // Add layout decisions with educational context
    if (completion.layoutChoices && completion.layoutChoices.length > 0) {
      const primaryLayout = completion.layoutChoices[0];
      parts.push(`\n\n**Layout:** ${primaryLayout.pattern} - ${primaryLayout.reason.charAt(0).toLowerCase()}${primaryLayout.reason.slice(1)}.`);
    }

    // Add style choices only if they add value
    if (completion.styleChoices && completion.styleChoices.length > 0) {
      const notableStyles = completion.styleChoices.filter(s =>
        s.reason && s.reason !== 'Semantic color from design system'
      );
      if (notableStyles.length > 0) {
        const styleInfo = notableStyles[0];
        parts.push(` Applied \`${styleInfo.value}\` for ${styleInfo.reason?.toLowerCase() || 'visual consistency'}.`);
      }
    }

    // Add validation fixes notice
    if (completion.validation?.autoFixApplied) {
      parts.push(`\n\n[WRENCH] **Auto-fixed:** Minor syntax issues were automatically corrected.`);
    }

    // Add suggestions only if meaningful
    if (completion.suggestions && completion.suggestions.length > 0) {
      const suggestion = completion.suggestions[0];
      // Only show if it's not the generic "review the generated code" message
      if (!suggestion.toLowerCase().includes('review the generated code')) {
        parts.push(`\n\n[TIP] **Tip:** ${suggestion}`);
      }
    }

    // Show refresh hint only once per session for new stories (local mode only)
    // In Edge mode, stories are stored in Durable Objects, not on filesystem
    if (!isUpdate && !hasShownRefreshHint.current) {
      if (isEdgeMode()) {
        parts.push(`\n\n_Story saved to cloud. View code in chat history recent chats navigation._`);
      } else {
        parts.push(`\n\n_Might need toefresh Storybook (Cmd/Ctrl + R) to see new stories in the sidebar._`);
      }
      hasShownRefreshHint.current = true;
    }

    // Add metrics in a subtle way (if available)
    if (completion.metrics?.totalTimeMs) {
      const seconds = (completion.metrics.totalTimeMs / 1000).toFixed(1);
      parts.push(`\n\n_${seconds}s_`);
    }

    return parts.join('');
  };

  // Helper function to finalize conversation after streaming completes
  const finalizeStreamingConversation = useCallback((
    newConversation: Message[],
    completion: CompletionFeedback,
    userInput: string
  ) => {
    // Build conversational response using rich completion data
    const isUpdate = completion.summary.action === 'updated';
    const responseMessage = buildConversationalResponse(completion, isUpdate);

    const aiMsg: Message = { role: 'ai', content: responseMessage };
    const updatedConversation = [...newConversation, aiMsg];
    setConversation(updatedConversation);

    // Update chat session
    const isExistingSession = activeChatId && conversation.length > 0;

    if (isExistingSession && activeChatId) {
      const updatedSession: ChatSession = {
        id: activeChatId,
        title: activeTitle,
        fileName: completion.fileName || activeChatId,
        conversation: updatedConversation,
        lastUpdated: Date.now(),
      };

      const chats = loadChats();
      const chatIndex = chats.findIndex(c => c.id === activeChatId);
      if (chatIndex !== -1) {
        chats[chatIndex] = updatedSession;
      }
      saveChats(chats);
      setRecentChats(chats);
    } else {
      const chatId = completion.storyId || completion.fileName || Date.now().toString();
      const chatTitle = completion.title || userInput;
      setActiveChatId(chatId);
      setActiveTitle(chatTitle);

      const newSession: ChatSession = {
        id: chatId,
        title: chatTitle,
        fileName: completion.fileName || '',
        conversation: updatedConversation,
        lastUpdated: Date.now(),
      };

      const chats = loadChats().filter(c => c.id !== chatId);
      chats.unshift(newSession);
      if (chats.length > MAX_RECENT_CHATS) {
        chats.splice(MAX_RECENT_CHATS);
      }
      saveChats(chats);
      setRecentChats(chats);

      // Auto-navigate to the newly created story after HMR processes the file
      // This prevents the "Couldn't find story after HMR" error by refreshing
      // after the file system has been updated and HMR has processed the change
      navigateToNewStory(chatTitle, completion.code);
    }
  }, [activeChatId, activeTitle, conversation.length]);

  const handleSend = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    // Allow sending with either text or images
    if (!input.trim() && attachedImages.length === 0) return;

    // Use input text or default vision prompt if only images
    const userInput = input.trim() || (attachedImages.length > 0 ? 'Create a component that matches this design' : '');
    setError(null);
    setLoading(true);
    setStreamingState(null);

    // Test connection before sending
    const connectionTest = await testMCPConnection();
    setConnectionStatus(connectionTest);

    if (!connectionTest.connected) {
      setError(`Cannot connect to MCP server: ${connectionTest.error || 'Server not running'}`);
      setLoading(false);
      return;
    }

    // Capture images before clearing
    const imagesToSend = [...attachedImages];
    const hasImages = imagesToSend.length > 0;

    // Create user message with images
    const userMessage: Message = {
      role: 'user',
      content: userInput,
      attachedImages: hasImages ? imagesToSend : undefined
    };
    const newConversation: Message[] = [...conversation, userMessage];
    setConversation(newConversation);
    setInput('');
    clearAttachedImages();

    // Use streaming if enabled
    if (USE_STREAMING) {
      try {
        // Cancel any existing request
        if (abortControllerRef.current) {
          abortControllerRef.current.abort();
        }
        abortControllerRef.current = new AbortController();

        // Initialize streaming state
        setStreamingState({});

        // Prepare images for API request
        const imagePayload = hasImages
          ? imagesToSend.map(img => ({
              type: 'base64' as const,
              data: img.base64,
              mediaType: img.file.type,
            }))
          : undefined;

        const response = await fetch(MCP_STREAM_API, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            prompt: userInput,
            conversation: newConversation,
            fileName: activeChatId || undefined,
            isUpdate: activeChatId && conversation.length > 0,
            originalTitle: activeTitle || undefined,
            storyId: activeChatId || undefined,
            images: imagePayload,
            visionMode: hasImages ? 'screenshot_to_story' : undefined,
            provider: selectedProvider || undefined,
            model: selectedModel || undefined,
            considerations: considerations || undefined,
          }),
          signal: abortControllerRef.current.signal,
        });

        if (!response.ok) {
          throw new Error(`Streaming request failed: ${response.status}`);
        }

        const reader = response.body?.getReader();
        if (!reader) {
          throw new Error('No response body');
        }

        const decoder = new TextDecoder();
        let buffer = '';
        let completionData: CompletionFeedback | null = null;
        let errorData: ErrorFeedback | null = null;

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;

          buffer += decoder.decode(value, { stream: true });

          // Parse SSE events from buffer
          const lines = buffer.split('\n');
          buffer = lines.pop() || ''; // Keep incomplete line in buffer

          for (const line of lines) {
            if (line.startsWith('data: ')) {
              try {
                const event: StreamEvent = JSON.parse(line.slice(6));

                // Update streaming state based on event type
                switch (event.type) {
                  case 'intent':
                    setStreamingState(prev => ({ ...prev, intent: event.data as IntentPreview }));
                    break;
                  case 'progress':
                    setStreamingState(prev => ({ ...prev, progress: event.data as ProgressUpdate }));
                    break;
                  case 'validation':
                    setStreamingState(prev => ({ ...prev, validation: event.data as ValidationFeedback }));
                    break;
                  case 'retry':
                    setStreamingState(prev => ({ ...prev, retry: event.data as RetryInfo }));
                    break;
                  case 'completion':
                    completionData = event.data as CompletionFeedback;
                    setStreamingState(prev => ({ ...prev, completion: event.data as CompletionFeedback }));
                    break;
                  case 'error':
                    errorData = event.data as ErrorFeedback;
                    setStreamingState(prev => ({ ...prev, error: event.data as ErrorFeedback }));
                    break;
                }
              } catch (parseError) {
                console.warn('Failed to parse SSE event:', line, parseError);
              }
            }
          }
        }

        // Handle completion or error
        if (completionData) {
          finalizeStreamingConversation(newConversation, completionData, userInput);
        } else if (errorData) {
          setError(errorData.message);
          const errorConversation = [...newConversation, { role: 'ai' as const, content: `Error: ${errorData.message}\n\n${errorData.suggestion || ''}` }];
          setConversation(errorConversation);
        }

      } catch (err: unknown) {
        if ((err as Error).name === 'AbortError') {
          console.log('Request aborted');
          return;
        }

        // Fall back to non-streaming on error
        console.warn('Streaming failed, falling back to non-streaming:', err);
        setStreamingState(null);

        try {
          const data = await handleSendNonStreaming(userInput, newConversation);

          // Process non-streaming response (same as before)
          let responseMessage: string;
          const statusMarker = data.validation?.hasWarnings ? (data.validation.errors?.length > 0 ? '[WRENCH]' : '[TIP]') : '[SUCCESS]';

          // Build conversational response for fallback
          if (data.isUpdate) {
            responseMessage = `${statusMarker} **Updated: "${data.title}"**\n\nI've made the requested changes to your component. You can view the updated version in Storybook.\n\n_Check the Docs tab to see both the rendered component and its code._`;
          } else {
            responseMessage = `${statusMarker} **Created: "${data.title}"**\n\nI've generated the component with the requested features. You can view it in Storybook where you'll see both the rendered component and its markup.\n\n[TIP] **Note**: If you don't see the story immediately, you may need to refresh your Storybook page (Cmd/Ctrl + R).`;
          }

          const aiMsg: Message = { role: 'ai', content: responseMessage };
          const updatedConversation = [...newConversation, aiMsg];
          setConversation(updatedConversation);

          // Update chat session
          const isUpdate = activeChatId && conversation.length > 0;
          if (isUpdate && activeChatId) {
            const updatedSession: ChatSession = {
              id: activeChatId,
              title: activeTitle,
              fileName: data.fileName || activeChatId,
              conversation: updatedConversation,
              lastUpdated: Date.now(),
            };
            const chats = loadChats();
            const chatIndex = chats.findIndex(c => c.id === activeChatId);
            if (chatIndex !== -1) chats[chatIndex] = updatedSession;
            saveChats(chats);
            setRecentChats(chats);
          } else {
            const chatId = data.storyId || data.fileName || Date.now().toString();
            const chatTitle = data.title || userInput;
            setActiveChatId(chatId);
            setActiveTitle(chatTitle);
            const newSession: ChatSession = {
              id: chatId,
              title: chatTitle,
              fileName: data.fileName || '',
              conversation: updatedConversation,
              lastUpdated: Date.now(),
            };
            const chats = loadChats().filter(c => c.id !== chatId);
            chats.unshift(newSession);
            if (chats.length > MAX_RECENT_CHATS) chats.splice(MAX_RECENT_CHATS);
            saveChats(chats);
            setRecentChats(chats);

            // Auto-navigate to the newly created story
            navigateToNewStory(chatTitle, data.code);
          }
        } catch (fallbackErr: unknown) {
          const errorMessage = fallbackErr instanceof Error ? fallbackErr.message : 'Unknown error';
          setError(errorMessage);
          const errorConversation = [...newConversation, { role: 'ai' as const, content: `Error: ${errorMessage}` }];
          setConversation(errorConversation);
        }
      } finally {
        setLoading(false);
        setStreamingState(null);
        abortControllerRef.current = null;
      }
    } else {
      // Non-streaming mode (original implementation)
      try {
        const data = await handleSendNonStreaming(userInput, newConversation);

        let responseMessage: string;
        const statusMarker = data.validation?.hasWarnings ? (data.validation.errors?.length > 0 ? '[WRENCH]' : '[TIP]') : '[SUCCESS]';

        // Build conversational response for non-streaming mode
        if (data.isUpdate) {
          responseMessage = `${statusMarker} **Updated: "${data.title}"**\n\nI've made the requested changes to your component. You can view the updated version in Storybook.\n\n_Check the Docs tab to see both the rendered component and its code._`;
        } else {
          responseMessage = `${statusMarker} **Created: "${data.title}"**\n\nI've generated the component with the requested features. You can view it in Storybook where you'll see both the rendered component and its markup.\n\n[TIP] **Note**: If you don't see the story immediately, you may need to refresh your Storybook page (Cmd/Ctrl + R).`;
        }

        const aiMsg: Message = { role: 'ai', content: responseMessage };
        const updatedConversation = [...newConversation, aiMsg];
        setConversation(updatedConversation);

        const isUpdate = activeChatId && conversation.length > 0;
        if (isUpdate && activeChatId) {
          const updatedSession: ChatSession = {
            id: activeChatId,
            title: activeTitle,
            fileName: data.fileName || activeChatId,
            conversation: updatedConversation,
            lastUpdated: Date.now(),
          };
          const chats = loadChats();
          const chatIndex = chats.findIndex(c => c.id === activeChatId);
          if (chatIndex !== -1) chats[chatIndex] = updatedSession;
          saveChats(chats);
          setRecentChats(chats);
        } else {
          const chatId = data.storyId || data.fileName || Date.now().toString();
          const chatTitle = data.title || userInput;
          setActiveChatId(chatId);
          setActiveTitle(chatTitle);
          const newSession: ChatSession = {
            id: chatId,
            title: chatTitle,
            fileName: data.fileName || '',
            conversation: updatedConversation,
            lastUpdated: Date.now(),
          };
          const chats = loadChats().filter(c => c.id !== chatId);
          chats.unshift(newSession);
          if (chats.length > MAX_RECENT_CHATS) chats.splice(MAX_RECENT_CHATS);
          saveChats(chats);
          setRecentChats(chats);
        }
      } catch (err: unknown) {
        const errorMessage = err instanceof Error ? err.message : 'Unknown error';
        setError(errorMessage);
        const errorConversation = [...newConversation, { role: 'ai' as const, content: `Error: ${errorMessage}` }];
        setConversation(errorConversation);
      } finally {
        setLoading(false);
      }
    }
  };

  const handleSelectChat = (chat: ChatSession) => {
    setConversation(chat.conversation);
    setActiveChatId(chat.id);
    setActiveTitle(chat.title);
  };

  const handleNewChat = () => {
    setConversation([]);
    setActiveChatId(null);
    setActiveTitle('');
  };

  const handleDeleteChat = async (chatId: string, e: React.MouseEvent) => {
    e.stopPropagation(); // Prevent selecting the chat

    if (confirm('Delete this story and chat? This action cannot be undone.')) {
      const success = await deleteStoryAndChat(chatId);

      if (success) {
        // Update local state
        const updatedChats = recentChats.filter(chat => chat.id !== chatId);
        setRecentChats(updatedChats);

        // If we deleted the active chat, switch to another or clear
        if (activeChatId === chatId) {
          if (updatedChats.length > 0) {
            setConversation(updatedChats[0].conversation);
            setActiveChatId(updatedChats[0].id);
            setActiveTitle(updatedChats[0].title);
          } else {
            handleNewChat();
          }
        }
      } else {
        alert('Failed to delete story. Please try again.');
      }
    }
  };

  return (
    <div className="story-ui-panel" style={STYLES.container}>
      {/* Sidebar */}
      <div style={{
        ...STYLES.sidebar,
        ...(sidebarOpen ? {} : STYLES.sidebarCollapsed),
      }}>
        {sidebarOpen && (
          <div style={{ flex: 1, overflowY: 'auto', padding: '16px' }}>
            <button
              onClick={() => setSidebarOpen(false)}
              style={STYLES.sidebarToggle}
              title="Collapse sidebar"
              onMouseEnter={(e) => {
                e.currentTarget.style.background = 'rgba(59, 130, 246, 0.25)';
                e.currentTarget.style.borderColor = 'rgba(59, 130, 246, 0.5)';
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.background = 'rgba(59, 130, 246, 0.15)';
                e.currentTarget.style.borderColor = 'rgba(59, 130, 246, 0.3)';
              }}
            >
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>
              </svg>
              <span>Chats</span>
            </button>
            <button
              onClick={handleNewChat}
              style={STYLES.newChatButton}
              onMouseEnter={(e) => {
                e.currentTarget.style.background = '#2563eb';
                e.currentTarget.style.boxShadow = '0 4px 12px rgba(59, 130, 246, 0.4)';
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.background = '#3b82f6';
                e.currentTarget.style.boxShadow = '0 2px 8px rgba(59, 130, 246, 0.25)';
              }}
            >
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <line x1="12" y1="5" x2="12" y2="19"/>
                <line x1="5" y1="12" x2="19" y2="12"/>
              </svg>
              <span>New Chat</span>
            </button>
            {recentChats.length > 0 && (
              <div style={{
                color: '#64748b',
                fontSize: '12px',
                marginBottom: '8px',
                fontWeight: '500',
                textTransform: 'uppercase',
                letterSpacing: '0.05em',
              }}>
                Recent Chats
              </div>
            )}
            {recentChats.map(chat => (
              <div
                key={chat.id}
                onClick={() => handleSelectChat(chat)}
                style={{
                  ...STYLES.chatItem,
                  ...(activeChatId === chat.id ? STYLES.chatItemActive : {}),
                }}
                onMouseEnter={(e) => {
                  if (activeChatId !== chat.id) {
                    e.currentTarget.style.background = 'rgba(255, 255, 255, 0.12)';
                  }
                  const deleteBtn = e.currentTarget.querySelector('.delete-btn') as HTMLElement;
                  if (deleteBtn) deleteBtn.style.opacity = '1';
                }}
                onMouseLeave={(e) => {
                  if (activeChatId !== chat.id) {
                    e.currentTarget.style.background = 'rgba(255, 255, 255, 0.08)';
                  }
                  const deleteBtn = e.currentTarget.querySelector('.delete-btn') as HTMLElement;
                  if (deleteBtn) deleteBtn.style.opacity = '0';
                }}
              >
                <div style={STYLES.chatItemTitle}>{chat.title}</div>
                <div style={STYLES.chatItemTime}>{formatTime(chat.lastUpdated)}</div>
                <button
                  className="delete-btn"
                  onClick={(e) => handleDeleteChat(chat.id, e)}
                  style={STYLES.deleteButton}
                  title="Delete chat"
                >
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
                </button>
              </div>
            ))}

            {/* Generated Files Section - orphan stories without chat history */}
            {orphanStories.length > 0 && (
              <>
                <div style={{
                  color: '#64748b',
                  fontSize: '12px',
                  marginTop: '16px',
                  marginBottom: '8px',
                  fontWeight: '500',
                  textTransform: 'uppercase',
                  letterSpacing: '0.05em',
                }}>
                  Generated Files
                </div>
                {orphanStories.map(story => (
                  <div
                    key={story.id}
                    style={{
                      ...STYLES.chatItem,
                      background: 'rgba(251, 191, 36, 0.1)',
                      borderLeft: '3px solid rgba(251, 191, 36, 0.5)',
                    }}
                    onMouseEnter={(e) => {
                      e.currentTarget.style.background = 'rgba(251, 191, 36, 0.15)';
                      const deleteBtn = e.currentTarget.querySelector('.delete-orphan-btn') as HTMLElement;
                      if (deleteBtn) deleteBtn.style.opacity = '1';
                    }}
                    onMouseLeave={(e) => {
                      e.currentTarget.style.background = 'rgba(251, 191, 36, 0.1)';
                      const deleteBtn = e.currentTarget.querySelector('.delete-orphan-btn') as HTMLElement;
                      if (deleteBtn) deleteBtn.style.opacity = '0';
                    }}
                  >
                    <div style={STYLES.chatItemTitle}>{story.title}</div>
                    <div style={{ ...STYLES.chatItemTime, fontSize: '11px' }}>
                      {story.fileName}
                    </div>
                    <button
                      className="delete-orphan-btn"
                      onClick={async (e) => {
                        e.stopPropagation();
                        try {
                          const response = await fetch(`${STORIES_API}/${story.id}`, {
                            method: 'DELETE',
                          });
                          if (response.ok) {
                            setOrphanStories(prev => prev.filter(s => s.id !== story.id));
                          } else {
                            console.error('Failed to delete orphan story');
                          }
                        } catch (err) {
                          console.error('Error deleting orphan story:', err);
                        }
                      }}
                      style={STYLES.deleteButton}
                      title="Delete generated file"
                    >
                      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
                    </button>
                  </div>
                ))}
              </>
            )}
          </div>
        )}
        {!sidebarOpen && (
          <div style={{ padding: '8px', display: 'flex', justifyContent: 'center' }}>
            <button
              onClick={() => setSidebarOpen(true)}
              style={{
                ...STYLES.sidebarToggle,
                width: '38px',
                height: '38px',
                padding: '0',
                fontSize: '16px',
                borderRadius: '8px',
              }}
              title="Expand sidebar"
              onMouseEnter={(e) => {
                e.currentTarget.style.transform = 'scale(1.05)';
                e.currentTarget.style.background = '#2563eb';
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.transform = 'scale(1)';
                e.currentTarget.style.background = '#3b82f6';
              }}
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="3" y1="6" x2="21" y2="6"/><line x1="3" y1="12" x2="21" y2="12"/><line x1="3" y1="18" x2="21" y2="18"/></svg>
            </button>
          </div>
        )}
      </div>

      {/* Main content */}
      <div
        style={{ ...STYLES.mainContent, position: 'relative' as const }}
        onDragEnter={handleDragEnter}
        onDragLeave={handleDragLeave}
        onDragOver={handleDragOver}
        onDrop={handleDrop}
      >
        {/* Drop zone overlay */}
        {isDragging && (
          <div style={STYLES.dropOverlay}>
            <div style={STYLES.dropOverlayText}>
              <svg width={24} height={24} viewBox="0 0 24 24" fill="currentColor">
                <path d="M21 19V5c0-1.1-.9-2-2-2H5c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h14c1.1 0 2-.9 2-2zM8.5 13.5l2.5 3.01L14.5 12l4.5 6H5l3.5-4.5z"/>
              </svg>
              Drop images here
            </div>
          </div>
        )}

        <div style={STYLES.chatHeader}>
          <h1 style={{
            fontSize: '22px',
            margin: 0,
            fontWeight: '700',
            background: 'linear-gradient(135deg, #60a5fa 0%, #3b82f6 100%)',
            WebkitBackgroundClip: 'text',
            WebkitTextFillColor: 'transparent',
            display: 'inline-block',
            letterSpacing: '-0.02em'
          }}>
            Story UI
          </h1>
          <p style={{ fontSize: '14px', margin: '6px 0 0 0', color: '#94a3b8', fontWeight: '500' }}>
            Generate Storybook stories with AI
          </p>
          <div style={{
            display: 'flex',
            alignItems: 'center',
            gap: '6px',
            marginTop: '10px',
            fontSize: '11px'
          }}>
            <div style={{
              width: '6px',
              height: '6px',
              borderRadius: '50%',
              backgroundColor: connectionStatus.connected ? '#10b981' : '#f87171'
            }}></div>
            <span
              className={`story-ui-status ${connectionStatus.connected ? 'story-ui-status-connected' : 'story-ui-status-disconnected'}`}
              style={{ color: connectionStatus.connected ? '#10b981' : '#ef4444', fontWeight: '400' }}
            >
              {connectionStatus.connected
                ? `Connected to ${getConnectionDisplayText()}`
                : `Disconnected: ${connectionStatus.error || 'Server not running'}`
              }
            </span>
          </div>

          {/* LLM Provider/Model Selection */}
          {connectionStatus.connected && availableProviders.length > 0 && (
            <div style={{
              display: 'flex',
              gap: '12px',
              marginTop: '12px',
              flexWrap: 'wrap'
            }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <label style={{ fontSize: '12px', color: '#94a3b8', fontWeight: '500' }}>Provider:</label>
                <select
                  value={selectedProvider}
                  onChange={(e) => {
                    const newProvider = e.target.value;
                    setSelectedProvider(newProvider);
                    // Reset model to first available for new provider
                    const provider = availableProviders.find(p => p.type === newProvider);
                    if (provider && provider.models.length > 0) {
                      setSelectedModel(provider.models[0]);
                    }
                  }}
                  style={{
                    background: '#1e293b',
                    border: '1px solid #334155',
                    borderRadius: '6px',
                    color: '#e2e8f0',
                    padding: '4px 8px',
                    fontSize: '12px',
                    cursor: 'pointer'
                  }}
                >
                  {availableProviders.map(p => (
                    <option key={p.type} value={p.type}>{p.name}</option>
                  ))}
                </select>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <label style={{ fontSize: '12px', color: '#94a3b8', fontWeight: '500' }}>Model:</label>
                <select
                  value={selectedModel}
                  onChange={(e) => setSelectedModel(e.target.value)}
                  style={{
                    background: '#1e293b',
                    border: '1px solid #334155',
                    borderRadius: '6px',
                    color: '#e2e8f0',
                    padding: '4px 8px',
                    fontSize: '12px',
                    cursor: 'pointer',
                    maxWidth: '200px'
                  }}
                >
                  {availableProviders
                    .find(p => p.type === selectedProvider)
                    ?.models.map(model => (
                      <option key={model} value={model}>{getModelDisplayName(model)}</option>
                    ))}
                </select>
              </div>
            </div>
          )}
        </div>

        <div style={STYLES.chatContainer}>
          {error && (
            <div style={STYLES.errorMessage}>
              {error}
            </div>
          )}

          {conversation.length === 0 && !loading && (
            <div style={STYLES.emptyState}>
              <div style={STYLES.emptyStateTitle}>Start a new conversation</div>
              <div style={STYLES.emptyStateSubtitle}>
                Describe the UI component you'd like to create
              </div>
            </div>
          )}

          {conversation.map((msg, i) => (
            <div key={i} style={STYLES.messageContainer}>
              <div
                className={`story-ui-message ${msg.role === 'user' ? 'story-ui-user-message' : 'story-ui-ai-message'}`}
                style={msg.role === 'user' ? STYLES.userMessage : STYLES.aiMessage}
              >
                {msg.role === 'ai' ? renderMarkdown(msg.content) : msg.content}
                {/* Show attached images in user messages */}
                {msg.role === 'user' && msg.attachedImages && msg.attachedImages.length > 0 && (
                  <div style={STYLES.userMessageImages}>
                    {msg.attachedImages.map((img) => (
                      <img
                        key={img.id}
                        src={img.base64
                          ? `data:${img.mediaType || 'image/png'};base64,${img.base64}`
                          : img.preview}
                        alt="attached"
                        style={STYLES.userMessageImage}
                      />
                    ))}
                  </div>
                )}
              </div>
            </div>
          ))}

          {loading && (
            <div style={STYLES.messageContainer}>
              {streamingState ? (
                <StreamingProgressMessage streamingData={streamingState} />
              ) : (
                <div style={STYLES.loadingMessage}>
                  <span>Generating story</span>
                  <span className="loading-dots"></span>
                </div>
              )}
            </div>
          )}

          <div ref={chatEndRef} />
        </div>

        {/* Hidden file input */}
        <input
          ref={fileInputRef}
          type="file"
          accept="image/*"
          multiple
          style={{ display: 'none' }}
          onChange={handleFileSelect}
        />

        {/* Image preview area */}
        {attachedImages.length > 0 && (
          <div style={STYLES.imagePreviewContainer}>
            <span style={STYLES.imagePreviewLabel}>
              <svg width={14} height={14} viewBox="0 0 24 24" fill="currentColor">
                <path d="M21 19V5c0-1.1-.9-2-2-2H5c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h14c1.1 0 2-.9 2-2zM8.5 13.5l2.5 3.01L14.5 12l4.5 6H5l3.5-4.5z"/>
              </svg>
              {attachedImages.length} image{attachedImages.length > 1 ? 's' : ''} attached
            </span>
            {attachedImages.map((img) => (
              <div key={img.id} style={STYLES.imagePreviewItem}>
                <img src={img.preview} alt="preview" style={STYLES.imagePreviewImg} />
                <button
                  type="button"
                  style={STYLES.imageRemoveButton}
                  onClick={() => removeAttachedImage(img.id)}
                  title="Remove image"
                >
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
                </button>
              </div>
            ))}
          </div>
        )}

        <form onSubmit={handleSend} style={{
          ...STYLES.inputForm,
          ...(attachedImages.length > 0 ? {
            marginTop: 0,
            borderTopLeftRadius: 0,
            borderTopRightRadius: 0,
          } : {})
        }}>
          {/* Upload button */}
          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            disabled={loading || attachedImages.length >= MAX_IMAGES}
            style={{
              ...STYLES.uploadButton,
              ...(attachedImages.length >= MAX_IMAGES ? {
                opacity: 0.5,
                cursor: 'not-allowed',
              } : {})
            }}
            title={attachedImages.length >= MAX_IMAGES
              ? `Maximum ${MAX_IMAGES} images`
              : 'Attach images (screenshots, designs)'
            }
            onMouseEnter={(e) => {
              if (attachedImages.length < MAX_IMAGES && !loading) {
                e.currentTarget.style.background = 'rgba(59, 130, 246, 0.2)';
                e.currentTarget.style.borderColor = 'rgba(59, 130, 246, 0.5)';
              }
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.background = 'rgba(255, 255, 255, 0.1)';
              e.currentTarget.style.borderColor = 'rgba(255, 255, 255, 0.2)';
            }}
          >
            <svg width={20} height={20} viewBox="0 0 24 24" fill="currentColor">
              <path d="M21 19V5c0-1.1-.9-2-2-2H5c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h14c1.1 0 2-.9 2-2zM8.5 13.5l2.5 3.01L14.5 12l4.5 6H5l3.5-4.5z"/>
            </svg>
          </button>

          <input
            ref={inputRef}
            type="text"
            value={input}
            onChange={e => setInput(e.target.value)}
            onPaste={handlePaste}
            placeholder={attachedImages.length > 0
              ? "Describe what to create from these images..."
              : "Describe a UI component..."
            }
            style={STYLES.textInput}
            onFocus={(e) => {
              e.currentTarget.style.borderColor = 'rgba(59, 130, 246, 0.5)';
              e.currentTarget.style.boxShadow = '0 0 0 3px rgba(59, 130, 246, 0.1)';
            }}
            onBlur={(e) => {
              e.currentTarget.style.borderColor = 'rgba(255, 255, 255, 0.2)';
              e.currentTarget.style.boxShadow = 'none';
            }}
          />
          <button
            type="submit"
            disabled={loading || (!input.trim() && attachedImages.length === 0)}
            style={{
              ...STYLES.sendButton,
              ...(loading || (!input.trim() && attachedImages.length === 0) ? {
                opacity: 0.4,
                cursor: 'not-allowed',
                background: '#64748b',
                boxShadow: 'none'
              } : {})
            }}
            onMouseEnter={(e) => {
              if (!loading && (input.trim() || attachedImages.length > 0)) {
                e.currentTarget.style.background = '#2563eb';
                e.currentTarget.style.boxShadow = '0 4px 16px rgba(59, 130, 246, 0.5)';
              }
            }}
            onMouseLeave={(e) => {
              if (!loading && (input.trim() || attachedImages.length > 0)) {
                e.currentTarget.style.background = '#3b82f6';
                e.currentTarget.style.boxShadow = '0 2px 8px rgba(59, 130, 246, 0.35)';
              }
            }}
          >
            <svg width={18} height={18} viewBox="0 0 24 24" fill="currentColor">
              <path d="M2.01 21L23 12 2.01 3 2 10l15 2-15 2z"/>
            </svg>
            <span>Send</span>
          </button>
        </form>
      </div>
    </div>
  );
}

export default StoryUIPanel;
export { StoryUIPanel };
