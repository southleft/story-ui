/**
 * StoryUIPanel - AI-powered Storybook story generator
 *
 * ShadCN-inspired design with Gemini-style layout.
 * Self-contained React component with no external UI dependencies.
 * Supports light and dark modes based on Storybook theme.
 */

import React, { useState, useEffect, useRef, useCallback, useReducer } from 'react';
import './StoryUIPanel.css';

// ============================================
// Types & Interfaces
// ============================================

interface Message {
  role: 'user' | 'ai';
  content: string;
  isStreaming?: boolean;
  streamingData?: StreamingState;
  attachedImages?: AttachedImage[];
}

interface ChatSession {
  id: string;
  title: string;
  fileName: string;
  conversation: Message[];
  lastUpdated: number;
}

interface AttachedImage {
  id: string;
  file: File;
  preview: string;
  base64: string;
  mediaType: string;
}

interface IntentPreview {
  title: string;
  components: string[];
  approach: string;
}

interface ProgressUpdate {
  phase: string;
  step: number;
  totalSteps: number;
  message: string;
}

interface ValidationFeedback {
  isValid: boolean;
  errors?: string[];
  autoFixApplied?: boolean;
}

interface RetryInfo {
  attempt: number;
  maxAttempts: number;
  reason: string;
}

interface ComponentUsage {
  name: string;
  reason?: string;
}

interface LayoutChoice {
  pattern: string;
  reason: string;
}

interface StyleChoice {
  property: string;
  value: string;
  reason?: string;
}

interface CompletionFeedback {
  success: boolean;
  storyId?: string;
  fileName?: string;
  title?: string;
  code?: string;
  summary: { action: string; details: string };
  componentsUsed: ComponentUsage[];
  layoutChoices: LayoutChoice[];
  styleChoices?: StyleChoice[];
  validation?: ValidationFeedback;
  suggestions?: string[];
  metrics?: { totalTimeMs: number; llmCallsCount: number };
}

interface ErrorFeedback {
  message: string;
  details?: string;
  suggestion?: string;
}

interface StreamingState {
  intent?: IntentPreview;
  progress?: ProgressUpdate;
  validation?: ValidationFeedback;
  retry?: RetryInfo;
  completion?: CompletionFeedback;
  error?: ErrorFeedback;
}

interface OrphanStory {
  id: string;
  title: string;
  fileName: string;
}

interface ProviderInfo {
  type: string;
  name: string;
  configured: boolean;
  models: string[];
}

interface ProvidersResponse {
  providers: ProviderInfo[];
  current?: { provider: string; model: string };
}

interface StreamEvent {
  type: 'intent' | 'progress' | 'validation' | 'retry' | 'completion' | 'error';
  data: unknown;
}

// ============================================
// State Reducer
// ============================================

interface PanelState {
  sidebarOpen: boolean;
  showCode: boolean;
  isDragging: boolean;
  loading: boolean;
  isBulkDeleting: boolean;
  conversation: Message[];
  recentChats: ChatSession[];
  orphanStories: OrphanStory[];
  activeChatId: string | null;
  activeTitle: string;
  input: string;
  attachedImages: AttachedImage[];
  selectedStoryIds: Set<string>;
  availableProviders: ProviderInfo[];
  selectedProvider: string;
  selectedModel: string;
  connectionStatus: { connected: boolean; error?: string };
  streamingState: StreamingState | null;
  error: string | null;
  considerations: string;
  isDarkMode: boolean;
}

type PanelAction =
  | { type: 'TOGGLE_SIDEBAR' }
  | { type: 'SET_SIDEBAR'; payload: boolean }
  | { type: 'TOGGLE_CODE' }
  | { type: 'SET_DRAGGING'; payload: boolean }
  | { type: 'SET_LOADING'; payload: boolean }
  | { type: 'SET_BULK_DELETING'; payload: boolean }
  | { type: 'SET_CONVERSATION'; payload: Message[] }
  | { type: 'ADD_MESSAGE'; payload: Message }
  | { type: 'SET_RECENT_CHATS'; payload: ChatSession[] }
  | { type: 'SET_ORPHAN_STORIES'; payload: OrphanStory[] }
  | { type: 'SET_ACTIVE_CHAT'; payload: { id: string | null; title: string } }
  | { type: 'SET_INPUT'; payload: string }
  | { type: 'SET_ATTACHED_IMAGES'; payload: AttachedImage[] }
  | { type: 'ADD_ATTACHED_IMAGE'; payload: AttachedImage }
  | { type: 'REMOVE_ATTACHED_IMAGE'; payload: string }
  | { type: 'CLEAR_ATTACHED_IMAGES' }
  | { type: 'SET_SELECTED_STORY_IDS'; payload: Set<string> }
  | { type: 'TOGGLE_STORY_SELECTION'; payload: string }
  | { type: 'SET_PROVIDERS'; payload: ProviderInfo[] }
  | { type: 'SET_SELECTED_PROVIDER'; payload: string }
  | { type: 'SET_SELECTED_MODEL'; payload: string }
  | { type: 'SET_CONNECTION_STATUS'; payload: { connected: boolean; error?: string } }
  | { type: 'SET_STREAMING_STATE'; payload: StreamingState | null }
  | { type: 'UPDATE_STREAMING_STATE'; payload: Partial<StreamingState> }
  | { type: 'SET_ERROR'; payload: string | null }
  | { type: 'SET_CONSIDERATIONS'; payload: string }
  | { type: 'SET_DARK_MODE'; payload: boolean }
  | { type: 'NEW_CHAT' };

const initialState: PanelState = {
  sidebarOpen: true,
  showCode: false,
  isDragging: false,
  loading: false,
  isBulkDeleting: false,
  conversation: [],
  recentChats: [],
  orphanStories: [],
  activeChatId: null,
  activeTitle: '',
  input: '',
  attachedImages: [],
  selectedStoryIds: new Set(),
  availableProviders: [],
  selectedProvider: '',
  selectedModel: '',
  connectionStatus: { connected: false },
  streamingState: null,
  error: null,
  considerations: '',
  isDarkMode: false,
};

function panelReducer(state: PanelState, action: PanelAction): PanelState {
  switch (action.type) {
    case 'TOGGLE_SIDEBAR':
      return { ...state, sidebarOpen: !state.sidebarOpen };
    case 'SET_SIDEBAR':
      return { ...state, sidebarOpen: action.payload };
    case 'TOGGLE_CODE':
      return { ...state, showCode: !state.showCode };
    case 'SET_DRAGGING':
      return { ...state, isDragging: action.payload };
    case 'SET_LOADING':
      return { ...state, loading: action.payload };
    case 'SET_BULK_DELETING':
      return { ...state, isBulkDeleting: action.payload };
    case 'SET_CONVERSATION':
      return { ...state, conversation: action.payload };
    case 'ADD_MESSAGE':
      return { ...state, conversation: [...state.conversation, action.payload] };
    case 'SET_RECENT_CHATS':
      return { ...state, recentChats: action.payload };
    case 'SET_ORPHAN_STORIES':
      return { ...state, orphanStories: action.payload };
    case 'SET_ACTIVE_CHAT':
      return { ...state, activeChatId: action.payload.id, activeTitle: action.payload.title };
    case 'SET_INPUT':
      return { ...state, input: action.payload };
    case 'SET_ATTACHED_IMAGES':
      return { ...state, attachedImages: action.payload };
    case 'ADD_ATTACHED_IMAGE':
      return { ...state, attachedImages: [...state.attachedImages, action.payload] };
    case 'REMOVE_ATTACHED_IMAGE':
      return {
        ...state,
        attachedImages: state.attachedImages.filter(img => img.id !== action.payload),
      };
    case 'CLEAR_ATTACHED_IMAGES':
      return { ...state, attachedImages: [] };
    case 'SET_SELECTED_STORY_IDS':
      return { ...state, selectedStoryIds: action.payload };
    case 'TOGGLE_STORY_SELECTION': {
      const newSet = new Set(state.selectedStoryIds);
      if (newSet.has(action.payload)) {
        newSet.delete(action.payload);
      } else {
        newSet.add(action.payload);
      }
      return { ...state, selectedStoryIds: newSet };
    }
    case 'SET_PROVIDERS':
      return { ...state, availableProviders: action.payload };
    case 'SET_SELECTED_PROVIDER':
      return { ...state, selectedProvider: action.payload };
    case 'SET_SELECTED_MODEL':
      return { ...state, selectedModel: action.payload };
    case 'SET_CONNECTION_STATUS':
      return { ...state, connectionStatus: action.payload };
    case 'SET_STREAMING_STATE':
      return { ...state, streamingState: action.payload };
    case 'UPDATE_STREAMING_STATE':
      return { ...state, streamingState: { ...state.streamingState, ...action.payload } };
    case 'SET_ERROR':
      return { ...state, error: action.payload };
    case 'SET_CONSIDERATIONS':
      return { ...state, considerations: action.payload };
    case 'SET_DARK_MODE':
      return { ...state, isDarkMode: action.payload };
    case 'NEW_CHAT':
      return { ...state, conversation: [], activeChatId: null, activeTitle: '' };
    default:
      return state;
  }
}

// ============================================
// Constants
// ============================================

const USE_STREAMING = true;
const MAX_RECENT_CHATS = 20;
const CHAT_STORAGE_KEY = 'story-ui-chats';
const MAX_IMAGES = 4;
const MAX_IMAGE_SIZE_MB = 20;

// ============================================
// Helper Functions
// ============================================

function getApiBaseUrl(): string {
  if (typeof import.meta !== 'undefined' && (import.meta as any).env?.VITE_STORY_UI_EDGE_URL) {
    return (import.meta as any).env.VITE_STORY_UI_EDGE_URL;
  }
  if (typeof window !== 'undefined') {
    if ((window as any).__STORY_UI_EDGE_URL__) {
      return (window as any).__STORY_UI_EDGE_URL__;
    }
    // Detect cloud deployments: Railway, custom domains, or any non-localhost
    const hostname = window.location.hostname;
    const isLocalhost = hostname === 'localhost' || hostname === '127.0.0.1' || hostname.startsWith('192.168.') || hostname.startsWith('10.');
    if (!isLocalhost) {
      // Cloud deployment - use same origin (works for Railway, custom domains, etc.)
      return window.location.origin;
    }
  }
  let port = '4001';
  if (typeof import.meta !== 'undefined' && (import.meta as any).env?.VITE_STORY_UI_PORT) {
    port = (import.meta as any).env.VITE_STORY_UI_PORT;
  } else if (typeof window !== 'undefined') {
    if ((window as any).__STORY_UI_PORT__) {
      port = (window as any).__STORY_UI_PORT__;
    } else if ((window as any).STORY_UI_MCP_PORT) {
      port = (window as any).STORY_UI_MCP_PORT;
    }
  }
  return `http://localhost:${port}`;
}

const API_BASE = getApiBaseUrl();
const MCP_API = `${API_BASE}/mcp/generate-story`;
const MCP_STREAM_API = `${API_BASE}/mcp/generate-story-stream`;
const PROVIDERS_API = `${API_BASE}/mcp/providers`;
const STORIES_API = `${API_BASE}/story-ui/stories`;
const CONSIDERATIONS_API = `${API_BASE}/mcp/considerations`;

function isEdgeMode(): boolean {
  if (typeof window !== 'undefined') {
    const hostname = window.location.hostname;
    const isLocalhost = hostname === 'localhost' || hostname === '127.0.0.1' || hostname.startsWith('192.168.') || hostname.startsWith('10.');
    return !isLocalhost;
  }
  return false;
}

function getConnectionDisplayText(): string {
  const baseUrl = getApiBaseUrl();
  if (typeof window !== 'undefined') {
    const hostname = window.location.hostname;
    if (hostname.includes('railway.app')) return 'Railway Cloud';
    if (hostname.includes('workers.dev')) return 'Cloudflare Edge';
    if (hostname.includes('southleft.com')) return 'Southleft Cloud';
    const isLocalhost = hostname === 'localhost' || hostname === '127.0.0.1' || hostname.startsWith('192.168.') || hostname.startsWith('10.');
    if (!isLocalhost) return `Cloud (${hostname})`;
  }
  const port = baseUrl.match(/:(\d+)/)?.[1] || '4001';
  return `localhost:${port}`;
}

function loadChats(): ChatSession[] {
  try {
    const stored = localStorage.getItem(CHAT_STORAGE_KEY);
    if (stored) return JSON.parse(stored);
  } catch (e) {
    console.error('Failed to load chats:', e);
  }
  return [];
}

function saveChats(chats: ChatSession[]): void {
  try {
    localStorage.setItem(CHAT_STORAGE_KEY, JSON.stringify(chats));
  } catch (e) {
    console.error('Failed to save chats:', e);
  }
}

async function testMCPConnection(): Promise<{ connected: boolean; error?: string }> {
  try {
    const response = await fetch(PROVIDERS_API, { method: 'GET' });
    if (response.ok) return { connected: true };
    return { connected: false, error: `Server returned ${response.status}` };
  } catch (e) {
    return { connected: false, error: 'Cannot connect to MCP server' };
  }
}

// Simply load chats from localStorage - don't filter based on server state
// Chats should persist independently of whether story files exist
async function syncWithActualStories(): Promise<ChatSession[]> {
  return loadChats();
}

async function fetchOrphanStories(): Promise<OrphanStory[]> {
  try {
    const response = await fetch(STORIES_API);
    if (!response.ok) return [];
    const data = await response.json();
    const serverStories = data.stories || [];
    const localChats = loadChats();
    const chatIds = new Set(localChats.map(c => c.id));
    return serverStories
      .filter((s: any) => !chatIds.has(s.id))
      .map((s: any) => ({ id: s.id, title: s.title, fileName: s.fileName }));
  } catch (e) {
    return [];
  }
}

async function deleteStoryAndChat(chatId: string): Promise<boolean> {
  try {
    const response = await fetch(`${STORIES_API}/${chatId}`, { method: 'DELETE' });
    // Delete chat from localStorage if:
    // - Story was successfully deleted (200/204)
    // - Story doesn't exist (404) - orphan chat case
    if (response.ok || response.status === 404) {
      const chats = loadChats().filter(c => c.id !== chatId);
      saveChats(chats);
      return true;
    }
    return false;
  } catch (e) {
    // On network error, still allow removing the chat from localStorage
    // since the story file may not exist anyway
    const chats = loadChats().filter(c => c.id !== chatId);
    saveChats(chats);
    return true;
  }
}

function formatTime(timestamp: number): string {
  const now = Date.now();
  const diff = now - timestamp;
  const minutes = Math.floor(diff / 60000);
  const hours = Math.floor(diff / 3600000);
  const days = Math.floor(diff / 86400000);
  if (minutes < 1) return 'Just now';
  if (minutes < 60) return `${minutes}m ago`;
  if (hours < 24) return `${hours}h ago`;
  if (days < 7) return `${days}d ago`;
  return new Date(timestamp).toLocaleDateString();
}

function getModelDisplayName(model: string): string {
  const displayNames: Record<string, string> = {
    'claude-opus-4-5-20251101': 'Claude Opus 4.5',
    'claude-sonnet-4-5-20250929': 'Claude Sonnet 4.5',
    'claude-haiku-4-5-20251001': 'Claude Haiku 4.5',
    'gpt-4o': 'GPT-4o',
    'gpt-4o-mini': 'GPT-4o Mini',
    'o1': 'o1',
    'gemini-2.0-flash': 'Gemini 2.0 Flash',
    'gemini-1.5-pro': 'Gemini 1.5 Pro',
  };
  return displayNames[model] || model;
}

// ============================================
// Icons (Lucide-style SVG)
// ============================================

const Icons = {
  plus: (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M5 12h14" /><path d="M12 5v14" />
    </svg>
  ),
  messageSquare: (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
    </svg>
  ),
  panelLeft: (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <rect width="18" height="18" x="3" y="3" rx="2" /><path d="M9 3v18" />
    </svg>
  ),
  x: (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M18 6 6 18" /><path d="m6 6 12 12" />
    </svg>
  ),
  image: (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <rect width="18" height="18" x="3" y="3" rx="2" ry="2" /><circle cx="9" cy="9" r="2" /><path d="m21 15-3.086-3.086a2 2 0 0 0-2.828 0L6 21" />
    </svg>
  ),
  send: (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="m22 2-7 20-4-9-9-4Z" /><path d="M22 2 11 13" />
    </svg>
  ),
  chevronDown: (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="m6 9 6 6 6-6" />
    </svg>
  ),
  trash: (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M3 6h18" /><path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6" /><path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2" />
    </svg>
  ),
  sparkles: (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="m12 3-1.912 5.813a2 2 0 0 1-1.275 1.275L3 12l5.813 1.912a2 2 0 0 1 1.275 1.275L12 21l1.912-5.813a2 2 0 0 1 1.275-1.275L21 12l-5.813-1.912a2 2 0 0 1-1.275-1.275L12 3Z" />
      <path d="M5 3v4" /><path d="M19 17v4" /><path d="M3 5h4" /><path d="M17 19h4" />
    </svg>
  ),
  moreVertical: (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="1" /><circle cx="12" cy="5" r="1" /><circle cx="12" cy="19" r="1" />
    </svg>
  ),
  pencil: (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M17 3a2.85 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z" /><path d="m15 5 4 4" />
    </svg>
  ),
  check: (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M20 6 9 17l-5-5" />
    </svg>
  ),
  checkCircle: (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14" />
      <path d="M22 4 12 14.01l-3-3" />
    </svg>
  ),
  xCircle: (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="10" />
      <path d="m15 9-6 6" />
      <path d="m9 9 6 6" />
    </svg>
  ),
  lightbulb: (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M15 14c.2-1 .7-1.7 1.5-2.5 1-.9 1.5-2.2 1.5-3.5A6 6 0 0 0 6 8c0 1 .2 2.2 1.5 3.5.7.7 1.3 1.5 1.5 2.5" />
      <path d="M9 18h6" />
      <path d="M10 22h4" />
    </svg>
  ),
  wrench: (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z" />
    </svg>
  ),
};

// ============================================
// Markdown Renderer
// ============================================

function renderMarkdown(content: string): React.ReactNode {
  const elements: React.ReactNode[] = [];
  let key = 0;

  // Split content into blocks (paragraphs, lists, headings)
  const blocks = content.split(/\n\n+/);

  blocks.forEach(block => {
    if (!block.trim()) return;

    // Check for headings (# ## ###)
    const headingMatch = block.match(/^(#{1,6})\s+(.+)$/);
    if (headingMatch) {
      const level = headingMatch[1].length;
      const text = headingMatch[2];
      const inlineContent = parseInline(text);

      switch (level) {
        case 1:
          elements.push(<h1 key={key++}>{inlineContent}</h1>);
          break;
        case 2:
          elements.push(<h2 key={key++}>{inlineContent}</h2>);
          break;
        case 3:
          elements.push(<h3 key={key++}>{inlineContent}</h3>);
          break;
        case 4:
          elements.push(<h4 key={key++}>{inlineContent}</h4>);
          break;
        case 5:
          elements.push(<h5 key={key++}>{inlineContent}</h5>);
          break;
        case 6:
          elements.push(<h6 key={key++}>{inlineContent}</h6>);
          break;
      }
      return;
    }

    // Check for ordered lists (1. 2. 3.)
    const orderedListMatch = block.match(/^(\d+\.\s+.+)$/m);
    if (orderedListMatch) {
      const items = block.split('\n').filter(line => /^\d+\.\s+/.test(line));
      const listItems = items.map((item, i) => {
        const text = item.replace(/^\d+\.\s+/, '');
        return <li key={i}>{parseInline(text)}</li>;
      });
      elements.push(<ol key={key++}>{listItems}</ol>);
      return;
    }

    // Check for unordered lists (- or *)
    const unorderedListMatch = block.match(/^[-*]\s+.+$/m);
    if (unorderedListMatch) {
      const items = block.split('\n').filter(line => /^[-*]\s+/.test(line));
      const listItems = items.map((item, i) => {
        const text = item.replace(/^[-*]\s+/, '');
        return <li key={i}>{parseInline(text)}</li>;
      });
      elements.push(<ul key={key++}>{listItems}</ul>);
      return;
    }

    // Regular paragraph with line breaks preserved
    const lines = block.split('\n');
    const paragraphElements = lines.map((line, i) => (
      <React.Fragment key={i}>
        {parseInline(line)}
        {i < lines.length - 1 && <br />}
      </React.Fragment>
    ));
    elements.push(<p key={key++}>{paragraphElements}</p>);
  });

  return <div className="sui-markdown">{elements}</div>;
}

// Parse inline markdown elements and status icons
function parseInline(text: string): React.ReactNode[] {
  const parts: React.ReactNode[] = [];
  let remaining = text;

  // Replace status markers with icon components
  // Use {{ICON:n}} format to avoid conflict with markdown underscore patterns
  const iconReplacements = [
    { pattern: /\[SUCCESS\]/g, index: 0, icon: <span key="icon-0" className="sui-icon-inline sui-icon-success" aria-label="Success">{Icons.checkCircle}</span> },
    { pattern: /\[ERROR\]/g, index: 1, icon: <span key="icon-1" className="sui-icon-inline sui-icon-error" aria-label="Error">{Icons.xCircle}</span> },
    { pattern: /\[TIP\]/g, index: 2, icon: <span key="icon-2" className="sui-icon-inline sui-icon-tip" aria-label="Tip">{Icons.lightbulb}</span> },
    { pattern: /\[WRENCH\]/g, index: 3, icon: <span key="icon-3" className="sui-icon-inline sui-icon-wrench" aria-label="Auto-fixed">{Icons.wrench}</span> },
  ];

  iconReplacements.forEach(({ pattern, index, icon }) => {
    remaining = remaining.replace(pattern, `{{ICON:${index}}}`);
    parts[index] = icon;
  });

  // Parse bold, code, italic, and icon placeholders
  // Icon placeholder {{ICON:n}} uses curly braces to avoid markdown conflicts
  const regex = /(\*\*[^*]+\*\*|`[^`]+`|_[^_]+_|\{\{ICON:\d+\}\})/g;
  const tokens = remaining.split(regex);

  return tokens.map((token, i) => {
    if (token.startsWith('**') && token.endsWith('**')) {
      return <strong key={`inline-${i}`}>{token.slice(2, -2)}</strong>;
    }
    if (token.startsWith('`') && token.endsWith('`')) {
      return <code key={`inline-${i}`}>{token.slice(1, -1)}</code>;
    }
    if (token.startsWith('_') && token.endsWith('_') && !token.startsWith('{{')) {
      return <em key={`inline-${i}`}>{token.slice(1, -1)}</em>;
    }
    if (token.startsWith('{{ICON:')) {
      const iconIndex = parseInt(token.match(/\{\{ICON:(\d+)\}\}/)?.[1] || '0');
      return parts[iconIndex] || token;
    }
    return token;
  }).filter(Boolean);
}

// ============================================
// Sub-Components
// ============================================

interface BadgeProps {
  variant?: 'default' | 'secondary' | 'success' | 'destructive' | 'outline';
  children: React.ReactNode;
  className?: string;
}

const Badge: React.FC<BadgeProps> = ({ variant = 'default', children, className = '' }) => (
  <span className={`sui-badge sui-badge-${variant} ${className}`}>{children}</span>
);

interface ProgressIndicatorProps {
  streamingState: StreamingState;
}

const ProgressIndicator: React.FC<ProgressIndicatorProps> = ({ streamingState }) => {
  const { progress, retry, completion, error } = streamingState;
  if (error) {
    return (
      <div className="sui-error" role="alert">
        <strong>{error.message}</strong>
        {error.details && <div>{error.details}</div>}
        {error.suggestion && <div>{error.suggestion}</div>}
      </div>
    );
  }
  if (completion) {
    return (
      <div className="sui-completion">
        <div className="sui-completion-header">
          <span>{completion.success ? '\u2705' : '\u274C'}</span>
          <span>{completion.summary.action}: {completion.title}</span>
        </div>
        {completion.componentsUsed.length > 0 && (
          <div className="sui-completion-components">
            {completion.componentsUsed.map((comp, i) => (
              <span key={i} className="sui-completion-tag">{comp.name}</span>
            ))}
          </div>
        )}
        {completion.metrics && (
          <div className="sui-completion-metrics">
            <span>{(completion.metrics.totalTimeMs / 1000).toFixed(1)}s</span>
            <span>{completion.metrics.llmCallsCount} LLM calls</span>
          </div>
        )}
      </div>
    );
  }
  return (
    <div className="sui-progress" role="progressbar" aria-valuenow={progress?.step} aria-valuemax={progress?.totalSteps}>
      <div className="sui-progress-header">
        <span className="sui-progress-label">{progress?.message || 'Generating story...'}</span>
        {progress && <span className="sui-progress-step">{progress.step}/{progress.totalSteps}</span>}
      </div>
      {progress && (
        <div className="sui-progress-bar">
          <div className="sui-progress-fill" style={{ width: `${(progress.step / progress.totalSteps) * 100}%` }} />
        </div>
      )}
      {retry && <div className="sui-progress-retry">Retry {retry.attempt}/{retry.maxAttempts}: {retry.reason}</div>}
    </div>
  );
};

// ============================================
// Main Component
// ============================================

interface StoryUIPanelProps {
  mcpPort?: number | string;
}

function StoryUIPanel({ mcpPort }: StoryUIPanelProps) {
  const [state, dispatch] = useReducer(panelReducer, initialState);
  const [contextMenuId, setContextMenuId] = useState<string | null>(null);
  const [renamingChatId, setRenamingChatId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState('');
  const chatEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const abortControllerRef = useRef<AbortController | null>(null);
  const hasShownRefreshHint = useRef(false);

  // Set port override if provided
  useEffect(() => {
    if (mcpPort && typeof window !== 'undefined') {
      (window as any).STORY_UI_MCP_PORT = String(mcpPort);
    }
  }, [mcpPort]);

  // Detect Storybook theme
  useEffect(() => {
    const detectTheme = () => {
      const body = document.body;
      const html = document.documentElement;

      // Check URL parameters for Storybook background setting
      const urlParams = new URLSearchParams(window.location.search);
      const globals = urlParams.get('globals') || '';
      const hasStorybookLightBg = globals.includes('backgrounds.value:light');
      const hasStorybookDarkBg = globals.includes('backgrounds.value:dark') ||
        globals.includes('backgrounds.value:%23') || // Hex colors starting with #
        globals.includes('backgrounds.value:!hex');

      // Check parent frame URL if we're in an iframe (Storybook 8+)
      let parentHasDarkBg = false;
      let parentHasLightBg = false;
      let parentHasDarkClass = false;
      try {
        if (window.parent !== window) {
          const parentUrl = new URL(window.parent.location.href);
          const parentGlobals = parentUrl.searchParams.get('globals') || '';
          parentHasLightBg = parentGlobals.includes('backgrounds.value:light');
          parentHasDarkBg = parentGlobals.includes('backgrounds.value:dark') ||
            parentGlobals.includes('backgrounds.value:%23');
          // Check parent document for Storybook dark theme classes
          const parentBody = window.parent.document.body;
          const parentHtml = window.parent.document.documentElement;
          parentHasDarkClass = parentBody.classList.contains('sb-dark') ||
            parentHtml.classList.contains('dark') ||
            parentHtml.getAttribute('data-theme') === 'dark' ||
            parentBody.getAttribute('data-theme') === 'dark';
          // Check Storybook 8+ manager theme
          const sbMainEl = window.parent.document.querySelector('.sb-main-padded, .sb-show-main');
          if (sbMainEl) {
            const sbBgColor = window.getComputedStyle(sbMainEl).backgroundColor;
            const sbRgb = sbBgColor.match(/\d+/g);
            if (sbRgb && sbRgb.length >= 3) {
              const sbLuminance = (0.299 * parseInt(sbRgb[0]) + 0.587 * parseInt(sbRgb[1]) + 0.114 * parseInt(sbRgb[2])) / 255;
              if (sbLuminance < 0.5) parentHasDarkClass = true;
            }
          }
        }
      } catch {
        // Cross-origin access not allowed, ignore
      }

      // Check the actual background color of the body
      const bgColor = window.getComputedStyle(body).backgroundColor;
      const rgb = bgColor.match(/\d+/g);
      let isBackgroundDark = false;
      if (rgb && rgb.length >= 3) {
        const luminance = (0.299 * parseInt(rgb[0]) + 0.587 * parseInt(rgb[1]) + 0.114 * parseInt(rgb[2])) / 255;
        isBackgroundDark = luminance < 0.5;
      }

      // Check system preference as fallback
      const systemPrefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;

      // Explicit light mode takes precedence - if user selected "light" in Storybook, respect that
      const hasExplicitLightMode = hasStorybookLightBg || parentHasLightBg;

      // Explicit dark mode indicators
      const hasExplicitDarkMode =
        body.classList.contains('sb-dark') ||
        html.classList.contains('dark') ||
        html.getAttribute('data-theme') === 'dark' ||
        body.getAttribute('data-theme') === 'dark' ||
        hasStorybookDarkBg ||
        parentHasDarkBg;

      // Determine dark mode: explicit light mode forces light, otherwise check dark indicators
      const isDark = hasExplicitLightMode
        ? false
        : (hasExplicitDarkMode || parentHasDarkClass || isBackgroundDark || systemPrefersDark);
      dispatch({ type: 'SET_DARK_MODE', payload: isDark });
    };
    detectTheme();

    // Listen for URL changes (Storybook uses popstate for navigation)
    window.addEventListener('popstate', detectTheme);

    // Poll for changes since Storybook might change background without popstate
    const intervalId = setInterval(detectTheme, 500);

    const observer = new MutationObserver(detectTheme);
    observer.observe(document.body, { attributes: true, attributeFilter: ['class', 'data-theme', 'style'] });
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ['class', 'data-theme', 'style'] });
    const mediaQuery = window.matchMedia('(prefers-color-scheme: dark)');
    mediaQuery.addEventListener('change', detectTheme);
    return () => {
      window.removeEventListener('popstate', detectTheme);
      clearInterval(intervalId);
      observer.disconnect();
      mediaQuery.removeEventListener('change', detectTheme);
    };
  }, []);

  // Close context menu when clicking outside
  useEffect(() => {
    if (!contextMenuId) return;

    const handleClickOutside = (e: MouseEvent) => {
      const target = e.target as HTMLElement;
      if (!target.closest('.sui-context-menu') && !target.closest('.sui-chat-item-menu')) {
        setContextMenuId(null);
      }
    };

    document.addEventListener('click', handleClickOutside);
    return () => document.removeEventListener('click', handleClickOutside);
  }, [contextMenuId]);

  // Initialize on mount
  useEffect(() => {
    const initialize = async () => {
      const connectionTest = await testMCPConnection();
      dispatch({ type: 'SET_CONNECTION_STATUS', payload: connectionTest });
      if (connectionTest.connected) {
        try {
          const res = await fetch(PROVIDERS_API);
          if (res.ok) {
            const data: ProvidersResponse = await res.json();
            dispatch({ type: 'SET_PROVIDERS', payload: data.providers.filter(p => p.configured) });
            if (data.current) {
              dispatch({ type: 'SET_SELECTED_PROVIDER', payload: data.current.provider.toLowerCase() });
              dispatch({ type: 'SET_SELECTED_MODEL', payload: data.current.model });
            }
          }
        } catch (e) {
          console.error('Failed to fetch providers:', e);
        }
        try {
          const res = await fetch(CONSIDERATIONS_API);
          if (res.ok) {
            const data = await res.json();
            if (data.hasConsiderations && data.considerations) {
              dispatch({ type: 'SET_CONSIDERATIONS', payload: data.considerations });
            }
          }
        } catch (e) {
          console.error('Failed to fetch considerations:', e);
        }
        const syncedChats = await syncWithActualStories();
        const sortedChats = syncedChats.sort((a, b) => b.lastUpdated - a.lastUpdated).slice(0, MAX_RECENT_CHATS);
        dispatch({ type: 'SET_RECENT_CHATS', payload: sortedChats });
        if (sortedChats.length > 0) {
          dispatch({ type: 'SET_CONVERSATION', payload: sortedChats[0].conversation });
          dispatch({ type: 'SET_ACTIVE_CHAT', payload: { id: sortedChats[0].id, title: sortedChats[0].title } });
        }
      } else {
        const localChats = loadChats();
        dispatch({ type: 'SET_RECENT_CHATS', payload: localChats });
      }
    };
    initialize();
  }, []);

  // Scroll to bottom on new messages
  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [state.conversation, state.loading]);

  // File handling
  const fileToBase64 = (file: File): Promise<string> => {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.readAsDataURL(file);
      reader.onload = () => {
        const result = reader.result as string;
        resolve(result.split(',')[1]);
      };
      reader.onerror = error => reject(error);
    });
  };

  const handleFileSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files) return;
    const errors: string[] = [];
    for (let i = 0; i < files.length && (state.attachedImages.length + i) < MAX_IMAGES; i++) {
      const file = files[i];
      if (!file.type.startsWith('image/')) {
        errors.push(`${file.name}: Not an image file`);
        continue;
      }
      if (file.size > MAX_IMAGE_SIZE_MB * 1024 * 1024) {
        errors.push(`${file.name}: File too large (max ${MAX_IMAGE_SIZE_MB}MB)`);
        continue;
      }
      try {
        const base64 = await fileToBase64(file);
        const preview = URL.createObjectURL(file);
        dispatch({
          type: 'ADD_ATTACHED_IMAGE',
          payload: { id: `${Date.now()}-${i}`, file, preview, base64, mediaType: file.type || 'image/png' },
        });
      } catch {
        errors.push(`${file.name}: Failed to process`);
      }
    }
    if (errors.length > 0) dispatch({ type: 'SET_ERROR', payload: errors.join('\n') });
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  const removeAttachedImage = (id: string) => {
    const img = state.attachedImages.find(i => i.id === id);
    if (img) URL.revokeObjectURL(img.preview);
    dispatch({ type: 'REMOVE_ATTACHED_IMAGE', payload: id });
  };

  const clearAttachedImages = () => {
    state.attachedImages.forEach(img => URL.revokeObjectURL(img.preview));
    dispatch({ type: 'CLEAR_ATTACHED_IMAGES' });
  };

  // Drag and drop handlers
  const handleDragEnter = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (e.dataTransfer.types.includes('Files')) dispatch({ type: 'SET_DRAGGING', payload: true });
  }, []);

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (!e.currentTarget.contains(e.relatedTarget as Node)) dispatch({ type: 'SET_DRAGGING', payload: false });
  }, []);

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
  }, []);

  const handleDrop = useCallback(async (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    dispatch({ type: 'SET_DRAGGING', payload: false });
    const files = Array.from(e.dataTransfer.files);
    const imageFiles = files.filter(f => f.type.startsWith('image/'));
    if (imageFiles.length === 0) {
      dispatch({ type: 'SET_ERROR', payload: 'Please drop image files only' });
      return;
    }
    const errors: string[] = [];
    for (let i = 0; i < imageFiles.length && (state.attachedImages.length + i) < MAX_IMAGES; i++) {
      const file = imageFiles[i];
      if (file.size > MAX_IMAGE_SIZE_MB * 1024 * 1024) {
        errors.push(`${file.name}: File too large`);
        continue;
      }
      try {
        const base64 = await fileToBase64(file);
        const preview = URL.createObjectURL(file);
        dispatch({
          type: 'ADD_ATTACHED_IMAGE',
          payload: { id: `${Date.now()}-${i}`, file, preview, base64, mediaType: file.type || 'image/png' },
        });
      } catch {
        errors.push(`${file.name}: Failed to process`);
      }
    }
    if (errors.length > 0) dispatch({ type: 'SET_ERROR', payload: errors.join('\n') });
  }, [state.attachedImages.length]);

  // Paste handler
  const handlePaste = useCallback(async (e: React.ClipboardEvent) => {
    const items = e.clipboardData?.items;
    if (!items) return;
    const imageItems: DataTransferItem[] = [];
    for (let i = 0; i < items.length; i++) {
      if (items[i].type.startsWith('image/')) imageItems.push(items[i]);
    }
    if (imageItems.length === 0) return;
    e.preventDefault();
    if (state.attachedImages.length >= MAX_IMAGES) {
      dispatch({ type: 'SET_ERROR', payload: `Maximum ${MAX_IMAGES} images allowed` });
      return;
    }
    for (let i = 0; i < imageItems.length && (state.attachedImages.length + i) < MAX_IMAGES; i++) {
      const file = imageItems[i].getAsFile();
      if (!file) continue;
      try {
        const base64 = await fileToBase64(file);
        const preview = URL.createObjectURL(file);
        const timestamp = new Date().toISOString().slice(11, 19).replace(/:/g, '-');
        dispatch({
          type: 'ADD_ATTACHED_IMAGE',
          payload: {
            id: `paste-${Date.now()}-${i}`,
            file: new File([file], `pasted-image-${timestamp}.png`, { type: file.type }),
            preview,
            base64,
            mediaType: file.type || 'image/png',
          },
        });
      } catch {
        dispatch({ type: 'SET_ERROR', payload: 'Failed to process pasted image' });
      }
    }
  }, [state.attachedImages.length]);

  // Build response message
  const buildConversationalResponse = (completion: CompletionFeedback, isUpdate: boolean): string => {
    const parts: string[] = [];
    const statusMarker = completion.success ? '[SUCCESS]' : '[ERROR]';
    parts.push(isUpdate ? `${statusMarker} **Updated: "${completion.title}"**` : `${statusMarker} **Created: "${completion.title}"**`);
    const componentCount = completion.componentsUsed?.length || 0;
    if (componentCount > 0) {
      const names = completion.componentsUsed.slice(0, 5).map(c => `\`${c.name}\``).join(', ');
      parts.push(`\nBuilt with ${names}${componentCount > 5 ? '...' : ''}.`);
    }
    if (completion.layoutChoices?.length > 0) {
      const layout = completion.layoutChoices[0];
      parts.push(`\n\n**Layout:** ${layout.pattern} - ${layout.reason}.`);
    }
    if (completion.validation?.autoFixApplied) {
      parts.push(`\n\n[WRENCH] **Auto-fixed:** Minor syntax issues were automatically corrected.`);
    }
    if (completion.suggestions && completion.suggestions.length > 0 && !completion.suggestions[0].toLowerCase().includes('review the generated code')) {
      parts.push(`\n\n[TIP] **Tip:** ${completion.suggestions[0]}`);
    }
    if (!isUpdate && !hasShownRefreshHint.current) {
      parts.push(isEdgeMode() ? `\n\n_Story saved to cloud._` : `\n\n_Might need to refresh Storybook (Cmd/Ctrl + R) to see new stories._`);
      hasShownRefreshHint.current = true;
    }
    if (completion.metrics?.totalTimeMs) {
      parts.push(`\n\n_${(completion.metrics.totalTimeMs / 1000).toFixed(1)}s_`);
    }
    return parts.join('');
  };

  // Finalize streaming
  const finalizeStreamingConversation = useCallback((newConversation: Message[], completion: CompletionFeedback, userInput: string) => {
    const isUpdate = completion.summary.action === 'updated';
    const responseMessage = buildConversationalResponse(completion, isUpdate);
    const aiMsg: Message = { role: 'ai', content: responseMessage };
    const updatedConversation = [...newConversation, aiMsg];
    dispatch({ type: 'SET_CONVERSATION', payload: updatedConversation });
    const isExistingSession = state.activeChatId && state.conversation.length > 0;
    if (isExistingSession && state.activeChatId) {
      const updatedSession: ChatSession = {
        id: state.activeChatId,
        title: state.activeTitle,
        fileName: completion.fileName || state.activeChatId,
        conversation: updatedConversation,
        lastUpdated: Date.now(),
      };
      const chats = loadChats();
      const chatIndex = chats.findIndex(c => c.id === state.activeChatId);
      if (chatIndex !== -1) chats[chatIndex] = updatedSession;
      saveChats(chats);
      dispatch({ type: 'SET_RECENT_CHATS', payload: chats });
    } else {
      const chatId = completion.storyId || completion.fileName || Date.now().toString();
      const chatTitle = completion.title || userInput;
      dispatch({ type: 'SET_ACTIVE_CHAT', payload: { id: chatId, title: chatTitle } });
      const newSession: ChatSession = {
        id: chatId,
        title: chatTitle,
        fileName: completion.fileName || '',
        conversation: updatedConversation,
        lastUpdated: Date.now(),
      };
      const chats = loadChats().filter(c => c.id !== chatId);
      chats.unshift(newSession);
      if (chats.length > MAX_RECENT_CHATS) chats.splice(MAX_RECENT_CHATS);
      saveChats(chats);
      dispatch({ type: 'SET_RECENT_CHATS', payload: chats });
    }
  }, [state.activeChatId, state.activeTitle, state.conversation.length]);

  // Handle send
  const handleSend = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    if (!state.input.trim() && state.attachedImages.length === 0) return;
    const userInput = state.input.trim() || (state.attachedImages.length > 0 ? 'Create a component that matches this design' : '');
    dispatch({ type: 'SET_ERROR', payload: null });
    dispatch({ type: 'SET_LOADING', payload: true });
    dispatch({ type: 'SET_STREAMING_STATE', payload: null });
    const connectionTest = await testMCPConnection();
    dispatch({ type: 'SET_CONNECTION_STATUS', payload: connectionTest });
    if (!connectionTest.connected) {
      dispatch({ type: 'SET_ERROR', payload: `Cannot connect to MCP server: ${connectionTest.error || 'Server not running'}` });
      dispatch({ type: 'SET_LOADING', payload: false });
      return;
    }
    const imagesToSend = [...state.attachedImages];
    const hasImages = imagesToSend.length > 0;
    const userMessage: Message = {
      role: 'user',
      content: userInput,
      attachedImages: hasImages ? imagesToSend : undefined,
    };
    const newConversation: Message[] = [...state.conversation, userMessage];
    dispatch({ type: 'SET_CONVERSATION', payload: newConversation });
    dispatch({ type: 'SET_INPUT', payload: '' });
    clearAttachedImages();

    if (USE_STREAMING) {
      try {
        if (abortControllerRef.current) abortControllerRef.current.abort();
        abortControllerRef.current = new AbortController();
        dispatch({ type: 'SET_STREAMING_STATE', payload: {} });
        const imagePayload = hasImages
          ? imagesToSend.map(img => ({ type: 'base64' as const, data: img.base64, mediaType: img.file.type }))
          : undefined;
        const response = await fetch(MCP_STREAM_API, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            prompt: userInput,
            conversation: newConversation,
            fileName: state.activeChatId || undefined,
            isUpdate: state.activeChatId && state.conversation.length > 0,
            originalTitle: state.activeTitle || undefined,
            storyId: state.activeChatId || undefined,
            images: imagePayload,
            visionMode: hasImages ? 'screenshot_to_story' : undefined,
            provider: state.selectedProvider || undefined,
            model: state.selectedModel || undefined,
            considerations: state.considerations || undefined,
          }),
          signal: abortControllerRef.current.signal,
        });
        if (!response.ok) throw new Error(`Streaming request failed: ${response.status}`);
        const reader = response.body?.getReader();
        if (!reader) throw new Error('No response body');
        const decoder = new TextDecoder();
        let buffer = '';
        let completionData: CompletionFeedback | null = null;
        let errorData: ErrorFeedback | null = null;
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split('\n');
          buffer = lines.pop() || '';
          for (const line of lines) {
            if (line.startsWith('data: ')) {
              try {
                const event: StreamEvent = JSON.parse(line.slice(6));
                switch (event.type) {
                  case 'intent':
                    dispatch({ type: 'UPDATE_STREAMING_STATE', payload: { intent: event.data as IntentPreview } });
                    break;
                  case 'progress':
                    dispatch({ type: 'UPDATE_STREAMING_STATE', payload: { progress: event.data as ProgressUpdate } });
                    break;
                  case 'validation':
                    dispatch({ type: 'UPDATE_STREAMING_STATE', payload: { validation: event.data as ValidationFeedback } });
                    break;
                  case 'retry':
                    dispatch({ type: 'UPDATE_STREAMING_STATE', payload: { retry: event.data as RetryInfo } });
                    break;
                  case 'completion':
                    completionData = event.data as CompletionFeedback;
                    dispatch({ type: 'UPDATE_STREAMING_STATE', payload: { completion: completionData } });
                    break;
                  case 'error':
                    errorData = event.data as ErrorFeedback;
                    dispatch({ type: 'UPDATE_STREAMING_STATE', payload: { error: errorData } });
                    break;
                }
              } catch {
                console.warn('Failed to parse SSE event:', line);
              }
            }
          }
        }
        if (completionData) {
          finalizeStreamingConversation(newConversation, completionData, userInput);
        } else if (errorData) {
          dispatch({ type: 'SET_ERROR', payload: errorData.message });
          const errorConversation = [...newConversation, { role: 'ai' as const, content: `Error: ${errorData.message}\n\n${errorData.suggestion || ''}` }];
          dispatch({ type: 'SET_CONVERSATION', payload: errorConversation });
        }
      } catch (err: unknown) {
        if ((err as Error).name === 'AbortError') return;
        console.warn('Streaming failed, falling back to non-streaming:', err);
        dispatch({ type: 'SET_STREAMING_STATE', payload: null });
        try {
          const res = await fetch(MCP_API, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              prompt: userInput,
              conversation: newConversation,
              fileName: state.activeChatId || undefined,
              provider: state.selectedProvider || undefined,
              model: state.selectedModel || undefined,
              considerations: state.considerations || undefined,
            }),
          });
          const data = await res.json();
          if (!res.ok || !data.success) throw new Error(data.error || 'Story generation failed');
          const responseMessage = `[SUCCESS] **Created: "${data.title}"**\n\nStory generated successfully.`;
          const aiMsg: Message = { role: 'ai', content: responseMessage };
          const updatedConversation = [...newConversation, aiMsg];
          dispatch({ type: 'SET_CONVERSATION', payload: updatedConversation });
        } catch (fallbackErr: unknown) {
          const errorMessage = fallbackErr instanceof Error ? fallbackErr.message : 'Unknown error';
          dispatch({ type: 'SET_ERROR', payload: errorMessage });
          const errorConversation = [...newConversation, { role: 'ai' as const, content: `Error: ${errorMessage}` }];
          dispatch({ type: 'SET_CONVERSATION', payload: errorConversation });
        }
      } finally {
        dispatch({ type: 'SET_LOADING', payload: false });
        dispatch({ type: 'SET_STREAMING_STATE', payload: null });
        abortControllerRef.current = null;
      }
    }
  };

  // Chat management
  const handleSelectChat = (chat: ChatSession) => {
    dispatch({ type: 'SET_CONVERSATION', payload: chat.conversation });
    dispatch({ type: 'SET_ACTIVE_CHAT', payload: { id: chat.id, title: chat.title } });
  };

  const handleNewChat = () => dispatch({ type: 'NEW_CHAT' });

  const handleDeleteChat = async (chatId: string, e?: React.MouseEvent) => {
    if (e) e.stopPropagation();
    setContextMenuId(null);
    if (confirm('Delete this story and chat? This action cannot be undone.')) {
      const success = await deleteStoryAndChat(chatId);
      if (success) {
        const updatedChats = state.recentChats.filter(chat => chat.id !== chatId);
        dispatch({ type: 'SET_RECENT_CHATS', payload: updatedChats });
        if (state.activeChatId === chatId) {
          if (updatedChats.length > 0) {
            dispatch({ type: 'SET_CONVERSATION', payload: updatedChats[0].conversation });
            dispatch({ type: 'SET_ACTIVE_CHAT', payload: { id: updatedChats[0].id, title: updatedChats[0].title } });
          } else {
            handleNewChat();
          }
        }
      } else {
        alert('Failed to delete story. Please try again.');
      }
    }
  };

  const handleStartRename = (chatId: string, currentTitle: string, e?: React.MouseEvent) => {
    if (e) e.stopPropagation();
    setContextMenuId(null);
    setRenamingChatId(chatId);
    setRenameValue(currentTitle);
  };

  const handleConfirmRename = (chatId: string) => {
    if (!renameValue.trim()) {
      setRenamingChatId(null);
      return;
    }
    const chats = loadChats();
    const chatIndex = chats.findIndex(c => c.id === chatId);
    if (chatIndex !== -1) {
      chats[chatIndex].title = renameValue.trim();
      saveChats(chats);
      dispatch({ type: 'SET_RECENT_CHATS', payload: chats });
      if (state.activeChatId === chatId) {
        dispatch({ type: 'SET_ACTIVE_CHAT', payload: { id: chatId, title: renameValue.trim() } });
      }
    }
    setRenamingChatId(null);
    setRenameValue('');
  };

  const handleCancelRename = () => {
    setRenamingChatId(null);
    setRenameValue('');
  };

  // Orphan story handlers
  const toggleSelectAll = () => {
    if (state.selectedStoryIds.size === state.orphanStories.length) {
      dispatch({ type: 'SET_SELECTED_STORY_IDS', payload: new Set() });
    } else {
      dispatch({ type: 'SET_SELECTED_STORY_IDS', payload: new Set(state.orphanStories.map(s => s.id)) });
    }
  };

  const handleBulkDelete = async () => {
    if (state.selectedStoryIds.size === 0) return;
    const count = state.selectedStoryIds.size;
    if (!confirm(`Delete ${count} selected ${count === 1 ? 'story' : 'stories'}?`)) return;
    dispatch({ type: 'SET_BULK_DELETING', payload: true });
    try {
      const response = await fetch(`${STORIES_API}/delete-bulk`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ids: Array.from(state.selectedStoryIds) }),
      });
      if (response.ok) {
        dispatch({ type: 'SET_ORPHAN_STORIES', payload: state.orphanStories.filter(s => !state.selectedStoryIds.has(s.id)) });
        dispatch({ type: 'SET_SELECTED_STORY_IDS', payload: new Set() });
      } else {
        alert('Failed to delete some stories.');
      }
    } catch {
      alert('Failed to delete stories.');
    } finally {
      dispatch({ type: 'SET_BULK_DELETING', payload: false });
    }
  };

  const handleClearAll = async () => {
    if (state.orphanStories.length === 0) return;
    if (!confirm(`Delete ALL ${state.orphanStories.length} generated stories?`)) return;
    dispatch({ type: 'SET_BULK_DELETING', payload: true });
    try {
      const response = await fetch(STORIES_API, { method: 'DELETE' });
      if (response.ok) {
        dispatch({ type: 'SET_ORPHAN_STORIES', payload: [] });
        dispatch({ type: 'SET_SELECTED_STORY_IDS', payload: new Set() });
      } else {
        alert('Failed to clear stories.');
      }
    } catch {
      alert('Failed to clear stories.');
    } finally {
      dispatch({ type: 'SET_BULK_DELETING', payload: false });
    }
  };

  const handleDeleteOrphan = async (storyId: string) => {
    try {
      const response = await fetch(`${STORIES_API}/${storyId}`, { method: 'DELETE' });
      if (response.ok) {
        dispatch({ type: 'SET_ORPHAN_STORIES', payload: state.orphanStories.filter(s => s.id !== storyId) });
        const newSet = new Set(state.selectedStoryIds);
        newSet.delete(storyId);
        dispatch({ type: 'SET_SELECTED_STORY_IDS', payload: newSet });
      }
    } catch (err) {
      console.error('Error deleting orphan story:', err);
    }
  };

  // ============================================
  // Render
  // ============================================

  return (
    <div className={`sui-root ${state.isDarkMode ? 'dark' : ''}`}>
      {/* Sidebar */}
      <aside className={`sui-sidebar ${state.sidebarOpen ? '' : 'collapsed'}`} aria-label="Chat history">
        {state.sidebarOpen && (
          <div className="sui-sidebar-content">
            {/* Toggle */}
            <button
              className="sui-button sui-button-ghost"
              onClick={() => dispatch({ type: 'TOGGLE_SIDEBAR' })}
              style={{ width: '100%', marginBottom: '12px', justifyContent: 'flex-start' }}
            >
              {Icons.panelLeft}
              <span style={{ marginLeft: '8px' }}>Hide sidebar</span>
            </button>

            {/* New Chat */}
            <button className="sui-button sui-button-default" onClick={handleNewChat} style={{ width: '100%', marginBottom: '16px' }}>
              {Icons.plus}
              <span>New Chat</span>
            </button>

            {/* Chat history */}
            <div className="sui-sidebar-chats">
              {state.recentChats.map(chat => (
                <div
                  key={chat.id}
                  className={`sui-chat-item ${state.activeChatId === chat.id ? 'active' : ''} ${contextMenuId === chat.id ? 'menu-open' : ''}`}
                  onClick={() => renamingChatId !== chat.id && handleSelectChat(chat)}
                  role="button"
                  tabIndex={0}
                  onKeyDown={e => e.key === 'Enter' && renamingChatId !== chat.id && handleSelectChat(chat)}
                >
                  {renamingChatId === chat.id ? (
                    <div className="sui-chat-item-rename">
                      <input
                        type="text"
                        className="sui-rename-input"
                        value={renameValue}
                        onChange={e => setRenameValue(e.target.value)}
                        onKeyDown={e => {
                          if (e.key === 'Enter') handleConfirmRename(chat.id);
                          if (e.key === 'Escape') handleCancelRename();
                        }}
                        onClick={e => e.stopPropagation()}
                        autoFocus
                      />
                      <button className="sui-button sui-button-icon sui-button-sm" onClick={e => { e.stopPropagation(); handleConfirmRename(chat.id); }} aria-label="Save">
                        {Icons.check}
                      </button>
                      <button className="sui-button sui-button-icon sui-button-sm" onClick={e => { e.stopPropagation(); handleCancelRename(); }} aria-label="Cancel">
                        {Icons.x}
                      </button>
                    </div>
                  ) : (
                    <>
                      <div className="sui-chat-item-title">{chat.title}</div>
                      <div className="sui-chat-item-actions">
                        <button
                          className="sui-chat-item-menu sui-button sui-button-icon sui-button-sm"
                          onClick={e => { e.stopPropagation(); setContextMenuId(contextMenuId === chat.id ? null : chat.id); }}
                          aria-label="More options"
                        >
                          {Icons.moreVertical}
                        </button>
                        {contextMenuId === chat.id && (
                          <div className="sui-context-menu">
                            <button className="sui-context-menu-item" onClick={e => handleStartRename(chat.id, chat.title, e)}>
                              {Icons.pencil}
                              <span>Rename</span>
                            </button>
                            <button className="sui-context-menu-item sui-context-menu-item-danger" onClick={e => handleDeleteChat(chat.id, e)}>
                              {Icons.trash}
                              <span>Delete</span>
                            </button>
                          </div>
                        )}
                      </div>
                    </>
                  )}
                </div>
              ))}
            </div>

          </div>
        )}
        {!state.sidebarOpen && (
          <div style={{ padding: '12px', display: 'flex', justifyContent: 'center' }}>
            <button className="sui-button sui-button-ghost sui-button-icon" onClick={() => dispatch({ type: 'SET_SIDEBAR', payload: true })} aria-label="Show sidebar">
              {Icons.panelLeft}
            </button>
          </div>
        )}
      </aside>

      {/* Main */}
      <main className="sui-main" onDragEnter={handleDragEnter} onDragLeave={handleDragLeave} onDragOver={handleDragOver} onDrop={handleDrop}>
        {/* Drop overlay */}
        {state.isDragging && (
          <div className="sui-drop-overlay">
            <div className="sui-drop-overlay-text">
              {Icons.image}
              <span>Drop images here</span>
            </div>
          </div>
        )}

        {/* Header */}
        <header className="sui-header">
          <div className="sui-header-left">
            <span className="sui-header-title">Story UI</span>
            <Badge variant={state.connectionStatus.connected ? 'success' : 'destructive'}>
              <span className="sui-badge-dot" />
              {state.connectionStatus.connected ? getConnectionDisplayText() : 'Disconnected'}
            </Badge>
          </div>
          <div className="sui-header-right">
            {state.connectionStatus.connected && state.availableProviders.length > 0 && (
              <>
                <div className="sui-select">
                  <div className="sui-select-trigger">
                    <span>{state.availableProviders.find(p => p.type === state.selectedProvider)?.name || 'Provider'}</span>
                    {Icons.chevronDown}
                  </div>
                  <select
                    className="sui-select-native"
                    value={state.selectedProvider}
                    onChange={e => {
                      const newProvider = e.target.value;
                      dispatch({ type: 'SET_SELECTED_PROVIDER', payload: newProvider });
                      const provider = state.availableProviders.find(p => p.type === newProvider);
                      if (provider?.models.length) dispatch({ type: 'SET_SELECTED_MODEL', payload: provider.models[0] });
                    }}
                    aria-label="Select provider"
                  >
                    {state.availableProviders.map(p => <option key={p.type} value={p.type}>{p.name}</option>)}
                  </select>
                </div>
                <div className="sui-select">
                  <div className="sui-select-trigger">
                    <span>{getModelDisplayName(state.selectedModel)}</span>
                    {Icons.chevronDown}
                  </div>
                  <select
                    className="sui-select-native"
                    value={state.selectedModel}
                    onChange={e => dispatch({ type: 'SET_SELECTED_MODEL', payload: e.target.value })}
                    aria-label="Select model"
                  >
                    {state.availableProviders.find(p => p.type === state.selectedProvider)?.models.map(model => (
                      <option key={model} value={model}>{getModelDisplayName(model)}</option>
                    ))}
                  </select>
                </div>
              </>
            )}
          </div>
        </header>

        {/* Chat area */}
        <section className="sui-chat-area" role="log" aria-live="polite">
          {state.error && <div className="sui-error" role="alert" style={{ margin: '24px' }}>{state.error}</div>}

          {state.conversation.length === 0 && !state.loading ? (
            <div className="sui-welcome">
              <h2 className="sui-welcome-greeting">What would you like to create?</h2>
              <p className="sui-welcome-subtitle">Describe any UI component and I'll generate a Storybook story</p>
              <div className="sui-welcome-chips">
                <button className="sui-chip" onClick={() => dispatch({ type: 'SET_INPUT', payload: 'Create a responsive card with image, title, and description' })}>
                  Card
                </button>
                <button className="sui-chip" onClick={() => dispatch({ type: 'SET_INPUT', payload: 'Create a navigation bar with logo and menu links' })}>
                  Navbar
                </button>
                <button className="sui-chip" onClick={() => dispatch({ type: 'SET_INPUT', payload: 'Create a form with input fields and validation' })}>
                  Form
                </button>
                <button className="sui-chip" onClick={() => dispatch({ type: 'SET_INPUT', payload: 'Create a hero section with headline and call-to-action' })}>
                  Hero
                </button>
                <button className="sui-chip" onClick={() => dispatch({ type: 'SET_INPUT', payload: 'Create a button group with primary and secondary actions' })}>
                  Buttons
                </button>
                <button className="sui-chip" onClick={() => dispatch({ type: 'SET_INPUT', payload: 'Create a modal dialog with header, content, and footer' })}>
                  Modal
                </button>
              </div>
            </div>
          ) : (
            <div className="sui-chat-messages">
              {state.conversation.map((msg, i) => (
                <article key={i} className={`sui-message ${msg.role === 'user' ? 'sui-message-user' : 'sui-message-ai'}`}>
                  <div className="sui-message-bubble">
                    {msg.role === 'ai' ? renderMarkdown(msg.content) : msg.content}
                    {msg.role === 'user' && msg.attachedImages && msg.attachedImages.length > 0 && (
                      <div className="sui-message-images">
                        {msg.attachedImages.map(img => (
                          <img key={img.id} src={img.base64 ? `data:${img.mediaType};base64,${img.base64}` : img.preview} alt="attached" className="sui-message-image" />
                        ))}
                      </div>
                    )}
                  </div>
                </article>
              ))}
              {state.loading && (
                <div className="sui-message sui-message-ai">
                  {state.streamingState ? <ProgressIndicator streamingState={state.streamingState} /> : (
                    <div className="sui-progress">
                      <span className="sui-progress-label">Generating story<span className="sui-loading" /></span>
                    </div>
                  )}
                </div>
              )}
              <div ref={chatEndRef} />
            </div>
          )}
        </section>

        {/* Input area */}
        <div className="sui-input-area">
          <div className="sui-input-container">
            <input ref={fileInputRef} type="file" accept="image/*" multiple style={{ display: 'none' }} onChange={handleFileSelect} />
            {state.attachedImages.length > 0 && (
              <div className="sui-image-previews">
                <span className="sui-image-preview-label">{Icons.image} {state.attachedImages.length} image{state.attachedImages.length > 1 ? 's' : ''}</span>
                {state.attachedImages.map(img => (
                  <div key={img.id} className="sui-image-preview-item">
                    <img src={img.preview} alt="preview" className="sui-image-preview-thumb" />
                    <button className="sui-image-preview-remove" onClick={() => removeAttachedImage(img.id)} aria-label="Remove">{Icons.x}</button>
                  </div>
                ))}
              </div>
            )}
            <form onSubmit={handleSend} className="sui-input-form" style={state.attachedImages.length > 0 ? { borderTopLeftRadius: 0, borderTopRightRadius: 0 } : undefined}>
              <button type="button" className="sui-input-form-upload" onClick={() => fileInputRef.current?.click()} disabled={state.loading || state.attachedImages.length >= MAX_IMAGES} aria-label="Attach images">
                {Icons.image}
              </button>
              <input
                ref={inputRef}
                type="text"
                className="sui-input-form-field"
                value={state.input}
                onChange={e => dispatch({ type: 'SET_INPUT', payload: e.target.value })}
                onPaste={handlePaste}
                placeholder={state.attachedImages.length > 0 ? 'Describe what to create from these images...' : 'Describe a UI component...'}
              />
              <button type="submit" className="sui-input-form-send" disabled={state.loading || (!state.input.trim() && state.attachedImages.length === 0)} aria-label="Send">
                {Icons.send}
              </button>
            </form>
          </div>
        </div>
      </main>
    </div>
  );
}

export default StoryUIPanel;
export { StoryUIPanel };
