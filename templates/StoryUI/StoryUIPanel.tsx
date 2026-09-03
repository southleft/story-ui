/**
 * StoryUIPanel - AI-powered Storybook story generator
 *
 * ShadCN-inspired design with Gemini-style layout.
 * Self-contained React component with no external UI dependencies.
 * Supports light and dark modes based on Storybook theme.
 */

import React, { useState, useEffect, useRef, useCallback, useReducer } from 'react';
import './StoryUIPanel.css';
import { VoiceControls } from './voice/VoiceControls';
import { VoiceCanvas, type VoiceCanvasHandle } from './voice/VoiceCanvas';
import { DesignContextPanel } from './DesignContextPanel';
import { ACCEPT, partitionFiles, processDocumentFiles, toPayload, formatBytes, type AttachedDocument } from './fileAttachments';
import { VerificationBadge } from './VerificationBadge';
import { HandoffDialog } from './HandoffDialog';
import type { VoiceCommand } from './voice/types';

/**
 * Every call to the Story UI server goes through this so a server that
 * requires STORY_UI_TOKEN can be reached: the token comes from
 * window.__STORY_UI_TOKEN__ or VITE_STORY_UI_TOKEN, or from the cookie the
 * server sets when the site is first opened with ?token= (sent automatically).
 */
function storyUiToken(): string | null {
  try {
    const w = window as unknown as { __STORY_UI_TOKEN__?: string };
    if (typeof w.__STORY_UI_TOKEN__ === 'string' && w.__STORY_UI_TOKEN__) return w.__STORY_UI_TOKEN__;
  } catch { /* no window */ }
  try {
    const env = (import.meta as unknown as { env?: Record<string, string | undefined> }).env;
    if (env?.VITE_STORY_UI_TOKEN) return env.VITE_STORY_UI_TOKEN;
  } catch { /* no import.meta.env */ }
  return null;
}
function apiFetch(input: string, init: RequestInit = {}): Promise<Response> {
  const token = storyUiToken();
  if (!token) return fetch(input, init);
  const headers = new Headers(init.headers ?? {});
  if (!headers.has('authorization')) headers.set('authorization', `Bearer ${token}`);
  return fetch(input, { ...init, headers });
}

// ============================================
// Types & Interfaces
// ============================================

interface Message {
  role: 'user' | 'ai';
  content: string;
  isStreaming?: boolean;
  streamingData?: StreamingState;
  attachedImages?: AttachedImage[];
  /** Names of the documents (Markdown, CSV, JSON, text, PDF) sent with this message. */
  documents?: string[];
  /**
   * Persisted thumbnails for images attached to this message. attachedImages
   * holds File objects and blob: URLs, neither of which survives being written
   * to localStorage or the manifest — without these, reopening a chat lost the
   * reference image entirely.
   */
  thumbnails?: string[];
  /** Follow-up refinement prompts rendered as clickable chips (AI messages). */
  suggestions?: string[];
  /** Generated story code, shown behind a "View code" toggle (AI messages). */
  code?: string;
  /** True when this AI message reports a failure — enables the retry button. */
  isError?: boolean;
  /** The user input that failed, so "Try again" can resend it. */
  retryInput?: string;
  /** Storybook entry ID once the new story is indexed — enables "Open story". */
  storyEntryId?: string;
  /** Browser verification for the story this message produced. */
  verification?: VerificationResult;
  /** File this message produced, so it can be handed off to a branch. */
  storyFileName?: string;
  storyTitle?: string;
  /**
   * Set when the story file was written but never showed up in Storybook's
   * index. Storybook's dev-server watcher can stop noticing new files, and
   * silently rendering no action left the story unreachable.
   */
  storyIndexStalled?: { storybookId: string; fileName?: string };
  /** Generation duration — rendered as a muted metadata stamp, not prose. */
  generationTimeMs?: number;
  /** Storybook component id (persisted) — resolved to a full entry id on chat open. */
  storybookComponentId?: string;
  /**
   * Progress messages seen while this reply streamed, in order — the
   * "12 steps · 31s" disclosure. Live only: the manifest does not keep them.
   */
  steps?: string[];
  /** True when this reply updated an existing story rather than creating one. */
  isUpdate?: boolean;
}

interface ChatSession {
  id: string;
  title: string;
  fileName: string;
  conversation: Message[];
  lastUpdated: number;
  source?: string; // 'panel' | 'mcp-external' | 'voice-save' etc.
}

interface AttachedImage {
  id: string;
  file: File;
  preview: string;
  base64: string;
  mediaType: string;
  /** Small data-URL copy that survives persistence (blob URLs and File do not). */
  thumbnail?: string;
}

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
  phase: string;
  step: number;
  totalSteps: number;
  message: string;
}

interface ValidationFeedback {
  isValid: boolean;
  errors?: string[];
  autoFixApplied?: boolean;
  /**
   * What the auto-fix actually changed, one clause each ("rewrote 3 import
   * paths to 'vuetify/components'"). Absent on a server that predates it.
   */
  fixDetails?: string[];
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

interface VerificationFinding {
  id: string;
  severity: 'blocker' | 'warning' | 'info';
  class: 'code' | 'a11y' | 'interaction' | 'infrastructure';
  message: string;
  evidence?: string;
  selector?: string;
}

interface VerificationResult {
  outcome: 'verified' | 'issues' | 'not_verified';
  reason?: string;
  findings: VerificationFinding[];
  metrics?: Record<string, number | string | boolean | string[]>;
}

interface CompletionFeedback {
  success: boolean;
  isFallback?: boolean; // True when a fallback error placeholder was created
  storyId?: string;
  fileName?: string;
  title?: string;
  code?: string;
  /** What the browser actually observed after rendering the story. */
  verification?: VerificationResult;
  summary: { action: string; details: string };
  componentsUsed: ComponentUsage[];
  layoutChoices: LayoutChoice[];
  styleChoices?: StyleChoice[];
  validation?: ValidationFeedback;
  suggestions?: string[];
  /** Model-authored conversational reply describing what was built. */
  chatSummary?: string;
  /** Storybook component ID for client-side navigation to the new story. */
  storybookId?: string;
  runtimeValidation?: { enabled: boolean; success: boolean; error?: string; healedByRetry?: boolean };
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
  /** Reference documents for the next message — the same pipeline the workspace uses. */
  attachedDocs: AttachedDocument[];
  selectedStoryIds: Set<string>;
  availableProviders: ProviderInfo[];
  selectedProvider: string;
  selectedModel: string;
  connectionStatus: { connected: boolean; error?: string };
  streamingState: StreamingState | null;
  error: string | null;
  considerations: string;
  isDarkMode: boolean;
  storybookMcpAvailable: boolean;
  useStorybookMcp: boolean;
}

type PanelAction =
  | { type: 'TOGGLE_SIDEBAR' }
  | { type: 'SET_SIDEBAR'; payload: boolean }
  | { type: 'PATCH_LAST_AI_MESSAGE'; payload: Partial<Message> }
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
  | { type: 'ADD_ATTACHED_DOCS'; payload: AttachedDocument[] }
  | { type: 'REMOVE_ATTACHED_DOC'; payload: string }
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
  | { type: 'SET_STORYBOOK_MCP_AVAILABLE'; payload: boolean }
  | { type: 'SET_USE_STORYBOOK_MCP'; payload: boolean }
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
  attachedDocs: [],
  selectedStoryIds: new Set(),
  availableProviders: [],
  selectedProvider: '',
  selectedModel: '',
  connectionStatus: { connected: false },
  streamingState: null,
  error: null,
  considerations: '',
  isDarkMode: false,
  storybookMcpAvailable: false,
  useStorybookMcp: true, // Default to enabled when available
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
    case 'PATCH_LAST_AI_MESSAGE': {
      const conversation = [...state.conversation];
      for (let i = conversation.length - 1; i >= 0; i--) {
        if (conversation[i].role === 'ai') {
          conversation[i] = { ...conversation[i], ...action.payload };
          break;
        }
      }
      return { ...state, conversation };
    }
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
    case 'ADD_ATTACHED_DOCS':
      return { ...state, attachedDocs: [...state.attachedDocs, ...action.payload] };
    case 'REMOVE_ATTACHED_DOC':
      return { ...state, attachedDocs: state.attachedDocs.filter(d => d.id !== action.payload) };
    case 'CLEAR_ATTACHED_IMAGES':
      return { ...state, attachedImages: [], attachedDocs: [] };
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
    case 'SET_STORYBOOK_MCP_AVAILABLE':
      return { ...state, storybookMcpAvailable: action.payload };
    case 'SET_USE_STORYBOOK_MCP':
      return { ...state, useStorybookMcp: action.payload };
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
const PROVIDER_PREFS_KEY = 'story-ui-provider-prefs';
// In-flight generation stash — survives preview-iframe reloads (sessionStorage)
const PENDING_GEN_KEY = 'story-ui-pending-generation';
const MAX_IMAGES = 4;
const MAX_IMAGE_SIZE_MB = 20;
// Vision models downsample anything larger than ~1568px on the long edge, so
// sending a raw retina screenshot just burns bytes and tokens for no extra
// detail. Downscaling client-side is what makes big screenshots work at all.
const MAX_IMAGE_DIMENSION = 1568;
// Above this, re-encode as JPEG — full-page screenshots are far smaller as JPEG
// and the fidelity loss is irrelevant for layout recognition.
const JPEG_FALLBACK_BYTES = 1.5 * 1024 * 1024;
const JPEG_QUALITY = 0.85;
// Persisted chat thumbnails. Small enough that a few of them per chat stay well
// inside the localStorage quota.
const THUMB_MAX_DIMENSION = 240;
const THUMB_QUALITY = 0.6;

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

let _apiBase: string | null = null;
function getApiBase(): string {
  if (!_apiBase) _apiBase = getApiBaseUrl();
  return _apiBase;
}
const MCP_API = () => `${getApiBase()}/mcp/generate-story`;
const MCP_STREAM_API = () => `${getApiBase()}/mcp/generate-story-stream`;
const PROVIDERS_API = () => `${getApiBase()}/mcp/providers`;
const STORIES_API = () => `${getApiBase()}/story-ui/stories`;
const ORPHAN_STORIES_API = () => `${getApiBase()}/story-ui/orphan-stories`;
const MANIFEST_API = () => `${getApiBase()}/story-ui/manifest`;
const MIGRATION_FLAG = 'story-ui-manifest-migrated-v1';
// v2: also updates reconciled 'mcp-external' entries that have localStorage conversation data
const MIGRATION_FLAG_V2 = 'story-ui-manifest-migrated-v2';
// v3: seeds synthetic conversations for any manifest entry with metadata.prompt but no conversation
const MIGRATION_FLAG_V3 = 'story-ui-manifest-migrated-v3';
const CONSIDERATIONS_API = () => `${getApiBase()}/story-ui/considerations`;

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

interface ProviderPrefs {
  provider: string;
  model: string;
}

function loadProviderPrefs(): ProviderPrefs | null {
  try {
    const stored = localStorage.getItem(PROVIDER_PREFS_KEY);
    if (stored) return JSON.parse(stored);
  } catch (e) {
    console.error('Failed to load provider preferences:', e);
  }
  return null;
}

function saveProviderPrefs(provider: string, model: string): void {
  try {
    localStorage.setItem(PROVIDER_PREFS_KEY, JSON.stringify({ provider, model }));
  } catch (e) {
    console.error('Failed to save provider preferences:', e);
  }
}

// Storage key for Storybook MCP preference
const STORYBOOK_MCP_PREF_KEY = 'story-ui-use-storybook-mcp';

/**
 * Detect if Storybook MCP addon is available.
 * Checks for the MCP endpoint that @storybook/addon-mcp exposes.
 * The addon returns SSE (Server-Sent Events) responses, not JSON.
 */
async function detectStorybookMcp(): Promise<boolean> {
  try {
    // Try to detect Storybook MCP on the same origin (works when running in Storybook)
    const storybookOrigin = typeof window !== 'undefined' ? window.location.origin : '';
    const mcpEndpoint = `${storybookOrigin}/mcp`;

    const response = await apiFetch(mcpEndpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'tools/list',
        params: {}
      })
    });

    if (!response.ok) return false;

    // Storybook MCP addon returns SSE (Server-Sent Events) responses
    // Check content-type or read a small portion to verify it's SSE format
    const contentType = response.headers.get('content-type') || '';
    if (contentType.includes('text/event-stream')) {
      console.log('[StoryUI] Storybook MCP addon detected (SSE endpoint)');
      return true;
    }

    // Also check by reading a portion of the response
    const text = await response.text();
    if (text.startsWith('event:') || text.startsWith('data:')) {
      console.log('[StoryUI] Storybook MCP addon detected (SSE response)');
      return true;
    }

    // Try parsing as JSON as fallback (some implementations may return JSON)
    try {
      const data = JSON.parse(text);
      if (data && data.result && Array.isArray(data.result.tools)) {
        console.log('[StoryUI] Storybook MCP addon detected (JSON response)');
        return true;
      }
    } catch {
      // Not JSON, but might still be valid SSE that we missed
    }

    return false;
  } catch (e) {
    // Not available - this is normal if addon-mcp isn't installed
    return false;
  }
}

/**
 * The manifest keeps a SUMMARY of a verification (outcome, counts, which
 * layers ran), not the findings list. Shape it like the live result so the
 * badge can render it; restoring the summary as-is crashed the panel on the
 * first reopened chat ("Cannot read properties of undefined (reading 'filter')").
 */
function verificationFromSummary(v: any): VerificationResult | undefined {
  if (!v || typeof v !== 'object' || !v.outcome) return undefined;
  const metrics: Record<string, number | string | boolean | string[]> = {};
  for (const key of ['blockers', 'warnings', 'focusables', 'checksRun', 'checksTotal']) {
    if (typeof v[key] === 'number') metrics[key] = v[key];
  }
  if (Array.isArray(v.checksNotRun)) metrics.checksNotRun = v.checksNotRun;
  const findings = Array.isArray(v.findings) ? v.findings : [];
  return { outcome: v.outcome, reason: typeof v.reason === 'string' ? v.reason : undefined, findings, metrics };
}

function loadStorybookMcpPref(): boolean {
  try {
    const stored = localStorage.getItem(STORYBOOK_MCP_PREF_KEY);
    if (stored !== null) return JSON.parse(stored);
  } catch (e) {
    console.error('Failed to load Storybook MCP preference:', e);
  }
  return true; // Default to enabled
}

function saveStorybookMcpPref(enabled: boolean): void {
  try {
    localStorage.setItem(STORYBOOK_MCP_PREF_KEY, JSON.stringify(enabled));
  } catch (e) {
    console.error('Failed to save Storybook MCP preference:', e);
  }
}

async function testMCPConnection(): Promise<{ connected: boolean; error?: string }> {
  try {
    const response = await apiFetch(PROVIDERS_API(), { method: 'GET' });
    if (response.ok) return { connected: true };
    return { connected: false, error: `Server returned ${response.status}` };
  } catch (e) {
    return { connected: false, error: 'Cannot connect to MCP server' };
  }
}

// Simply load chats from localStorage - don't filter based on server state
// Chats should persist independently of whether story files exist
/**
 * Load chat sessions from the server manifest.
 * Falls back to localStorage if the server is unreachable.
 * On first call, runs a one-time migration of localStorage data → manifest.
 */
/**
 * Fetch the order Storybook actually displays stories in its sidebar.
 * Returns a Map<lowercased-title, position-index> for the Generated/ group.
 * Falls back to an empty map (caller will use alphabetical fallback).
 */
async function fetchStorybookOrder(): Promise<Map<string, number>> {
  try {
    const response = await apiFetch('/index.json');
    if (!response.ok) return new Map();
    const data = await response.json();
    const entries: Record<string, any> = data.entries ?? {};
    const seen = new Set<string>();
    const order = new Map<string, number>();
    let i = 0;
    for (const entry of Object.values(entries)) {
      const fullTitle: string = (entry as any).title ?? '';
      if (fullTitle.startsWith('Generated/') && !seen.has(fullTitle)) {
        seen.add(fullTitle);
        order.set(fullTitle.replace('Generated/', '').toLowerCase(), i++);
      }
    }
    return order;
  } catch {
    return new Map();
  }
}

async function syncWithActualStories(): Promise<ChatSession[]> {
  try {
    const response = await apiFetch(MANIFEST_API());
    if (!response.ok) throw new Error('manifest unavailable');
    const data = await response.json();
    const entries: Record<string, any> = data.stories ?? {};

    // Map manifest entries to ChatSession format
    const sessions: ChatSession[] = Object.values(entries)
      .filter((e: any) => e.source !== 'voice-canvas') // scratchpad excluded from chat list
      .map((e: any) => {
        const serverConv = (e.conversation ?? []).map((m: any) => ({ role: m.role as 'user' | 'ai', content: m.content, thumbnails: m.thumbnails }));
        // If no conversation history but the original prompt is known, synthesize one so
        // users can open the story and immediately continue iterating with full context.
        const conversation: Message[] = serverConv.length > 0
          ? serverConv
          : e.metadata?.prompt
            ? [
                { role: 'user' as const, content: e.metadata.prompt },
                { role: 'ai' as const, content: `Story generated: "${e.title}"` },
              ]
            : [];
        // Rehydrate the last reply's completion payload (code viewer, timing,
        // suggestion chips) — persisted server-side precisely because the
        // preview iframe can reload mid-generation and lose the live event.
        const lastCompletion = e.metadata?.lastCompletion;
        const lastMsg = conversation[conversation.length - 1];
        if (lastCompletion && lastMsg?.role === 'ai') {
          lastMsg.code = lastCompletion.code || undefined;
          lastMsg.suggestions = lastCompletion.suggestions?.length ? lastCompletion.suggestions : undefined;
          lastMsg.generationTimeMs = lastCompletion.generationTimeMs || undefined;
          lastMsg.storybookComponentId = lastCompletion.storybookId || undefined;
          // The story this reply produced. Without these a reopened chat had
          // no "Open in Storybook", no "Hand off" and no verification badge —
          // they existed only in the session that generated the story.
          lastMsg.storyEntryId = lastMsg.storyEntryId || (e.id ? String(e.id) : undefined);
          lastMsg.storyFileName = lastMsg.storyFileName || e.fileName || undefined;
          lastMsg.verification = lastMsg.verification || verificationFromSummary(lastCompletion.verification);
        }
        return {
          id: e.id ?? e.fileName.replace(/\.stories\.[a-z]+$/, ''),
          title: e.title,
          fileName: e.fileName,
          conversation,
          lastUpdated: new Date(e.updatedAt ?? e.createdAt).getTime(),
          source: e.source,
        };
      })
      .sort((a, b) => b.lastUpdated - a.lastUpdated)
      .slice(0, MAX_RECENT_CHATS);

    // Mirror to localStorage as offline cache
    saveChats(sessions);

    // One-time migration: push any localStorage chats the server doesn't know about
    migrateLocalStorageToManifest(entries);

    return sessions;
  } catch {
    // Server unreachable — fall back to localStorage
    return loadChats();
  }
}

/**
 * Migrate localStorage chats to the manifest once. This handles the transition
 * for existing users who have chat history that the server doesn't know about yet.
 */
async function migrateLocalStorageToManifest(
  manifestEntries: Record<string, any>,
): Promise<void> {
  try {
    const localChats = loadChats();
    let migrated = 0;

    // v1: add localStorage chats the server doesn't know about at all
    if (!localStorage.getItem(MIGRATION_FLAG)) {
      for (const chat of localChats) {
        if (!chat.fileName || chat.fileName in manifestEntries) continue;
        if (!chat.conversation?.length) continue;
        const conversation = chat.conversation
          .filter(m => (m.role === 'user' || m.role === 'ai') && m.content)
          .map(m => ({ role: m.role as 'user' | 'ai', content: m.content, thumbnails: m.thumbnails }));
        await apiFetch(`${MANIFEST_API()}/${encodeURIComponent(chat.fileName)}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          // `backfilled`: this restores history the manifest was missing, it
          // is not new activity — the server leaves updatedAt alone for it.
          body: JSON.stringify({ id: chat.id, title: chat.title, source: 'panel', conversation, metadata: { backfilled: true } }),
        });
        migrated++;
      }
      localStorage.setItem(MIGRATION_FLAG, '1');
    }

    // v2: update reconciled 'mcp-external' entries that have conversation data in localStorage
    if (!localStorage.getItem(MIGRATION_FLAG_V2)) {
      for (const chat of localChats) {
        if (!chat.fileName || !chat.conversation?.length) continue;
        const entry = manifestEntries[chat.fileName];
        // Only update if the manifest entry was auto-reconciled (mcp-external, no conversation)
        if (!entry || entry.source !== 'mcp-external' || (entry.conversation?.length ?? 0) > 0) continue;
        const conversation = chat.conversation
          .filter(m => (m.role === 'user' || m.role === 'ai') && m.content)
          .map(m => ({ role: m.role as 'user' | 'ai', content: m.content, thumbnails: m.thumbnails }));
        await apiFetch(`${MANIFEST_API()}/${encodeURIComponent(chat.fileName)}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          // `backfilled`: this restores history the manifest was missing, it
          // is not new activity — the server leaves updatedAt alone for it.
          body: JSON.stringify({ id: chat.id, title: chat.title, source: 'panel', conversation, metadata: { backfilled: true } }),
        });
        migrated++;
      }
      localStorage.setItem(MIGRATION_FLAG_V2, '1');
    }

    if (migrated > 0) console.log(`[story-ui] Migrated ${migrated} chats to manifest`);

    // v3: seed synthetic conversations for any manifest entry with metadata.prompt but no conversation.
    // Runs regardless of localStorage — covers MCP-external and voice-saved stories.
    // This makes all generated stories openable and continuable from the chat UI.
    //
    // Marked `backfilled` so the server does not stamp updatedAt: this runs
    // once per browser origin, and without the marker every older story
    // jumped to "just now" in the workspace's Recent work the first time the
    // classic panel was opened.
    if (!localStorage.getItem(MIGRATION_FLAG_V3)) {
      const toSeed = Object.entries(manifestEntries).filter(([, e]) =>
        (e.conversation?.length ?? 0) === 0 && e.metadata?.prompt
      );
      await Promise.all(toSeed.map(([fileName, e]) =>
        apiFetch(`${MANIFEST_API()}/${encodeURIComponent(fileName)}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            conversation: [
              { role: 'user', content: e.metadata.prompt },
              { role: 'ai', content: `Story generated: "${e.title}"` },
            ],
            metadata: { backfilled: true },
          }),
        }).catch(() => {}),
      ));
      localStorage.setItem(MIGRATION_FLAG_V3, '1');
    }
  } catch {
    // Non-fatal — migration will retry next session
  }
}

/**
 * Persist a chat session's conversation to the manifest after generation.
 * Also updates localStorage as a cache.
 */
async function persistChatToManifest(session: ChatSession): Promise<void> {
  // Update localStorage immediately (optimistic)
  const chats = loadChats().filter(c => c.id !== session.id);
  chats.unshift(session);
  if (chats.length > MAX_RECENT_CHATS) chats.splice(MAX_RECENT_CHATS);
  saveChats(chats);

  // Persist to server manifest (non-blocking)
  if (!session.fileName) return;
  try {
    const conversation = session.conversation
      .filter(m => (m.role === 'user' || m.role === 'ai') && m.content)
      .map(m => ({ role: m.role as 'user' | 'ai', content: m.content, thumbnails: m.thumbnails }));
    await apiFetch(`${MANIFEST_API()}/${encodeURIComponent(session.fileName)}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ conversation }),
    });
  } catch {
    // Non-fatal — localStorage already updated
  }
}

async function fetchOrphanStories(): Promise<OrphanStory[]> {
  try {
    // With the manifest, "orphans" are entries the server knows about but have
    // no conversation history (externally generated from Claude Desktop / MCP).
    const response = await apiFetch(MANIFEST_API());
    if (!response.ok) throw new Error('manifest unavailable');
    const data = await response.json();
    const entries: Record<string, any> = data.stories ?? {};

    return Object.values(entries)
      .filter((e: any) =>
        e.source !== 'voice-canvas' &&
        (!e.conversation || e.conversation.length === 0)
      )
      .map((e: any) => ({
        id: e.id ?? e.fileName.replace(/\.stories\.[a-z]+$/, ''),
        title: e.title,
        fileName: e.fileName,
      }));
  } catch {
    // Fall back to the old localStorage-based orphan detection
    try {
      const response = await apiFetch(STORIES_API());
      if (!response.ok) return [];
      const data = await response.json();
      const serverStories = data.stories || [];
      const localChats = loadChats();
      const chatIds = new Set(localChats.map(c => c.id));
      return serverStories
        .filter((s: any) => !chatIds.has(s.id))
        .map((s: any) => ({ id: s.id, title: s.title, fileName: s.fileName }));
    } catch {
      return [];
    }
  }
}

async function deleteStoryAndChat(chatId: string, fileName?: string): Promise<boolean> {
  // Use fileName if provided (more reliable), otherwise fall back to chatId
  const fileId = fileName || chatId;
  try {
    const response = await apiFetch(`${STORIES_API()}/${encodeURIComponent(fileId)}`, { method: 'DELETE' });
    // Delete chat from localStorage if:
    // - Story was successfully deleted (200/204)
    // - Story doesn't exist (404) - orphan chat case
    if (response.ok || response.status === 404) {
      // Remove by chatId from localStorage (chatId is the session ID)
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
    // Claude
    'claude-fable-5-1': 'Claude Fable 5.1',
    'claude-opus-5': 'Claude Opus 5',
    'claude-opus-4-8': 'Claude Opus 4.8',
    'claude-sonnet-5': 'Claude Sonnet 5',
    'claude-haiku-4-5': 'Claude Haiku 4.5',
    // OpenAI
    'gpt-5.5': 'GPT-5.5',
    'gpt-5.4-mini': 'GPT-5.4 Mini',
    'gpt-5.4-nano': 'GPT-5.4 Nano',
    // Gemini
    'gemini-3.1-pro': 'Gemini 3.1 Pro',
    'gemini-3.5-flash': 'Gemini 3.5 Flash',
    'gemini-3.1-flash-lite': 'Gemini 3.1 Flash-Lite',
  };
  if (displayNames[model]) return displayNames[model];
  // Fallback for an id the table does not know: "claude-fable-5-1" reads as
  // "Claude Fable 5.1", "gpt-5-6-sol" as "GPT-5.6 Sol" — consecutive number
  // segments are one version, a date suffix is dropped, and family acronyms
  // keep their case. The old split-and-title-case gave "Claude Fable 5 1".
  const ACRONYMS: Record<string, string> = { gpt: 'GPT', o1: 'o1', o3: 'o3', o4: 'o4' };
  const parts = model.split(/[-_]/).filter(Boolean).filter(p => !/^\d{8}$/.test(p));
  const out: string[] = [];
  for (const part of parts) {
    const numeric = /^\d+(\.\d+)?$/.test(part);
    const prev = out[out.length - 1];
    if (numeric && prev !== undefined && /^\d+(\.\d+)*$/.test(prev)) out[out.length - 1] = `${prev}.${part}`;
    else if (numeric && prev !== undefined && ACRONYMS[prev.toLowerCase()]) out[out.length - 1] = `${prev}-${part}`;
    else out.push(ACRONYMS[part.toLowerCase()] ?? (numeric ? part : part.charAt(0).toUpperCase() + part.slice(1)));
  }
  return out.join(' ');
}

// ============================================
// Icons (fine-line 14px set, drawn to match Storybook's icon proportions)
// ============================================

const Icons = {
  plus: (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 4.5v15M4.5 12h15" />
    </svg>
  ),
  messageSquare: (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
    </svg>
  ),
  panelLeft: ( /* Storybook SidebarIcon geometry: frame + divider + list ticks */
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <rect x="3" y="4" width="18" height="16" rx="1.5" />
      <path d="M9.75 4v16" />
      <path d="M5.75 8.5h1.5M5.75 12h1.5M5.75 15.5h1.5" />
    </svg>
  ),
  x: (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <path d="m6 6 12 12M18 6 6 18" />
    </svg>
  ),
  file: ( /* a page with a folded corner */
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <path d="M6 3.5h8l4.5 4.5v12.5h-12.5z" />
      <path d="M14 3.5v4.5h4.5" />
    </svg>
  ),
  image: ( /* geometry from Storybook PhotoIcon: frame + dot + mountain */
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <rect x="3.5" y="4.5" width="17" height="15" rx="1.5" />
      <circle cx="8.75" cy="9.25" r="1.5" />
      <path d="m20.5 15.5-4.4-4.4a1 1 0 0 0-1.42 0L7.5 18.25" />
      <path d="m3.5 16.5 3.05-3.05a1 1 0 0 1 1.4 0L10 15.5" />
    </svg>
  ),
  send: ( /* arrow-up — modern chat idiom, matches Storybook ArrowUpIcon geometry */
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 19.5v-15M5 11.5l7-7 7 7" />
    </svg>
  ),
  chevronDown: (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <path d="m6 9 6 6 6-6" />
    </svg>
  ),
  trash: ( /* Storybook DeleteIcon geometry incl. interior ticks */
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <path d="M4 6h16" />
      <path d="M9.5 6V4.25c0-.69.56-1.25 1.25-1.25h2.5c.69 0 1.25.56 1.25 1.25V6" />
      <path d="M6 6v13a2 2 0 0 0 2 2h8a2 2 0 0 0 2-2V6" />
      <path d="M10 10.5v6M14 10.5v6" />
    </svg>
  ),
  moreVertical: ( /* horizontal, filled dots — matches Storybook EllipsisIcon */
    <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" stroke="none">
      <circle cx="5" cy="12" r="1.6" /><circle cx="12" cy="12" r="1.6" /><circle cx="19" cy="12" r="1.6" />
    </svg>
  ),
  pencil: (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <path d="M17 3a2.85 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z" /><path d="m15 5 4 4" />
    </svg>
  ),
  check: (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <path d="M20 6 9 17l-5-5" />
    </svg>
  ),
  checkCircle: (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14" />
      <path d="M22 4 12 14.01l-3-3" />
    </svg>
  ),
  xCircle: (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="10" />
      <path d="m15 9-6 6" />
      <path d="m9 9 6 6" />
    </svg>
  ),
  lightbulb: (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <path d="M15 14c.2-1 .7-1.7 1.5-2.5 1-.9 1.5-2.2 1.5-3.5A6 6 0 0 0 6 8c0 1 .2 2.2 1.5 3.5.7.7 1.3 1.5 1.5 2.5" />
      <path d="M9 18h6" />
      <path d="M10 22h4" />
    </svg>
  ),
  wrench: (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z" />
    </svg>
  ),
  openExternal: ( /* "Open in Storybook" — box with an arrow leaving it */
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M14 4h6v6M20 4l-9 9M18 13v6H5V6h6" />
    </svg>
  ),
  code: ( /* "View code" — angle brackets */
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M8 7l-5 5 5 5M16 7l5 5-5 5" />
    </svg>
  ),
  chevronRight: ( /* steps disclosure; rotated 90° by CSS when open */
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M9 6l6 6-6 6" />
    </svg>
  ),
  gear: ( /* settings */
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="3" />
      <path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z" />
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

interface ProgressIndicatorProps {
  streamingState: StreamingState;
}

const ProgressIndicator: React.FC<ProgressIndicatorProps> = ({ streamingState }) => {
  const { intent, progress, retry, completion, error } = streamingState;
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
    // Determine status icon and class based on success and fallback state
    const isFallback = completion.isFallback === true;
    const statusIcon = completion.success ? '\u2705' : (isFallback ? '\u26A0\uFE0F' : '\u274C');
    const statusClass = completion.success ? '' : (isFallback ? 'sui-completion-fallback' : 'sui-completion-error');

    return (
      <div className={`sui-completion ${statusClass}`}>
        <div className="sui-completion-header">
          <span>{statusIcon}</span>
          <span>{completion.summary.action}: {completion.title}</span>
        </div>
        {isFallback && (
          <div className="sui-completion-fallback-warning">
            <strong>Error Placeholder Created</strong>
            <p>Generation failed after retries. A placeholder story was saved that you may want to delete or regenerate.</p>
          </div>
        )}
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
            <span>{completion.metrics.llmCallsCount} {completion.metrics.llmCallsCount === 1 ? 'generation' : 'generations'}</span>
          </div>
        )}
      </div>
    );
  }
  return (
    <div
      className="sui-progress"
      role="progressbar"
      aria-valuemin={0}
      aria-valuenow={progress?.step ?? 0}
      aria-valuemax={progress?.totalSteps ?? 8}
      aria-label="Story generation progress"
    >
      {intent && (
        <div className="sui-progress-intent">
          <strong>Plan:</strong> {intent.strategy}
          {intent.estimatedComponents.length > 0 && (
            <span className="sui-progress-intent-components"> · {intent.estimatedComponents.slice(0, 4).join(', ')}</span>
          )}
        </div>
      )}
      <div className="sui-progress-header">
        <span className="sui-progress-label">{progress?.message || 'Generating your story…'}</span>
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
  // Handoff availability is a property of the repo, not the story, so it is
  // fetched once and reused for every message's action row.
  const [handoffStatus, setHandoffStatus] = useState<{
    available: boolean; reason?: string; branch?: string; remote?: string | null;
    canPush?: boolean; canOpenPr?: boolean; prUnavailableReason?: string;
  } | null>(null);
  const [handoffFor, setHandoffFor] = useState<{ fileName: string; title: string } | null>(null);

  const [panelMode, setPanelMode] = useState<'chat' | 'canvas' | 'context'>(() => {
    try {
      const stored = localStorage.getItem('__sui_panel_mode__');
      return stored === 'canvas' ? 'canvas' : stored === 'context' ? 'context' : 'chat';
    } catch { return 'chat'; }
  });
  // Tracks whether Voice Canvas is available (React-only feature). Defaults true to
  // avoid flashing the tab away on initial render; corrected after canvas-config loads.
  const [isReactFramework, setIsReactFramework] = useState(true);
  const [canvasRegistry, setCanvasRegistry] = useState<Record<string, any>>({});
  const [canvasProvider, setCanvasProvider] = useState<React.ComponentType<{ children: React.ReactNode }> | null>(null);
  const [contextMenuId, setContextMenuId] = useState<string | null>(null);
  const [renamingChatId, setRenamingChatId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState('');
  const [orphanCount, setOrphanCount] = useState<number>(0);
  const [isDeletingOrphans, setIsDeletingOrphans] = useState<boolean>(false);
  const [storybookOrder, setStorybookOrder] = useState<Map<string, number>>(new Map());
  // Presentation-only state for the thread: which popover is open (one at a
  // time), which turns show their steps / code, and a transient "Copied".
  type OpenMenu = null | 'title' | 'gear' | 'model' | { turn: number };
  const [openMenu, setOpenMenu] = useState<OpenMenu>(null);
  const [openSteps, setOpenSteps] = useState<Record<number, boolean>>({});
  const [openCode, setOpenCode] = useState<Record<number, boolean>>({});
  const [copiedTurn, setCopiedTurn] = useState<number | null>(null);
  const chatEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  // Auto-resize textarea based on content
  const adjustTextareaHeight = useCallback(() => {
    const textarea = inputRef.current;
    if (textarea) {
      // Reset height to auto to get the correct scrollHeight
      textarea.style.height = 'auto';
      // Set height to scrollHeight, capped at max-height (200px)
      const maxHeight = 200;
      const newHeight = Math.min(textarea.scrollHeight, maxHeight);
      textarea.style.height = `${newHeight}px`;
    }
  }, []);

  // Adjust height when input changes
  useEffect(() => {
    adjustTextareaHeight();
  }, [state.input, adjustTextareaHeight]);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const abortControllerRef = useRef<AbortController | null>(null);
  const hasShownRefreshHint = useRef(false);

  // Load component registry for Voice Canvas from window globals.
  // preview.tsx exposes:
  //   window.__STORY_UI_DESIGN_SYSTEM__ = component modules (e.g. MantineCore)
  //   window.__STORY_UI_CANVAS_PROVIDER__ = configured provider with theme
  // This avoids ALL dynamic imports in the docs page, which crash Storybook.
  useEffect(() => {
    if (panelMode !== 'canvas' || Object.keys(canvasRegistry).length > 0) return;

    const ds = (window as any).__STORY_UI_DESIGN_SYSTEM__;
    if (ds && typeof ds === 'object') {
      const reg: Record<string, any> = {};
      for (const [key, value] of Object.entries(ds)) {
        if (/^[A-Z]/.test(key) && (typeof value === 'function' || typeof value === 'object')) {
          reg[key] = value;
        }
      }
      if (Object.keys(reg).length > 0) {
        console.log(`[VoiceCanvas] Loaded ${Object.keys(reg).length} components from design system`);
        setCanvasRegistry(reg);
      }
    } else {
      console.warn('[VoiceCanvas] No design system found on window.__STORY_UI_DESIGN_SYSTEM__');
    }

    // Use the pre-configured provider (with theme) from preview.tsx
    const configuredProvider = (window as any).__STORY_UI_CANVAS_PROVIDER__;
    if (configuredProvider) {
      setCanvasProvider(() => configuredProvider);
    }
  }, [panelMode]);

  // Track stories for MCP external generation detection
  // Used to detect when stories are created via MCP remote (Claude Desktop)
  // and trigger automatic refresh since MCP has no browser context
  const panelGeneratedStoryIds = useRef<Set<string>>(new Set());
  // Mirrors state.loading so the story poller (registered once) can see it.
  const loadingRef = useRef(false);
  useEffect(() => { loadingRef.current = state.loading; }, [state.loading]);
  const voiceModeActiveRef = useRef(false);
  const canvasModeRef = useRef(panelMode === 'canvas');
  const voiceCanvasRef = useRef<VoiceCanvasHandle>(null);
  const knownStoryIds = useRef<Set<string>>(new Set());
  const isPollingInitialized = useRef(false);

  // Set port override if provided
  useEffect(() => {
    if (mcpPort && typeof window !== 'undefined') {
      (window as any).STORY_UI_MCP_PORT = String(mcpPort);
    }
  }, [mcpPort]);

  // Poll for MCP-generated stories (stories created externally via Claude Desktop/Code)
  // This solves the Vite HMR issue where stories generated via MCP remote don't trigger
  // a browser refresh because MCP has no browser context to call window.location.reload()
  useEffect(() => {
    const POLL_INTERVAL_MS = 5000; // Check every 5 seconds

    const pollForExternalStories = async () => {
      try {
        const baseUrl = getApiBaseUrl();
        const response = await apiFetch(`${baseUrl}/story-ui/stories`);
        if (!response.ok) return;

        const data = await response.json();
        const currentStoryIds = new Set<string>(data.stories?.map((s: { id: string }) => s.id) || []);

        // On first poll, just record what's already there
        if (!isPollingInitialized.current) {
          knownStoryIds.current = currentStoryIds;
          isPollingInitialized.current = true;
          console.log('[Story UI] MCP story polling initialized with', currentStoryIds.size, 'stories');
          return;
        }

        // Never reload while a generation is streaming — the reload would
        // race the completion event and drop the assistant's reply.
        if (loadingRef.current) {
          knownStoryIds.current = currentStoryIds;
          return;
        }

        // Check for new stories not created by this panel session.
        // Storybook ≥9 registers new story files live (sidebar + preview both
        // update without a reload), so external stories only need a chat-list
        // resync — the old full-page reload is gone.
        for (const storyId of currentStoryIds) {
          if (storyId === 'generated-voice-canvas--default' || storyId.startsWith('voice-canvas')) continue;
          if (!knownStoryIds.current.has(storyId) && !panelGeneratedStoryIds.current.has(storyId)) {
            console.log('[Story UI] Detected externally generated story:', storyId);
            try {
              const sessions = await syncWithActualStories();
              dispatch({ type: 'SET_RECENT_CHATS', payload: sessions });
            } catch {
              // Chat list resync is best-effort.
            }
            break;
          }
        }

        // Update known stories
        knownStoryIds.current = currentStoryIds;
      } catch (error) {
        // Silently ignore polling errors - server may be unavailable temporarily
      }
    };

    // Start polling
    const intervalId = setInterval(pollForExternalStories, POLL_INTERVAL_MS);

    // Initial poll
    pollForExternalStories();

    return () => clearInterval(intervalId);
  }, []);

  // Detect Storybook MCP addon availability
  useEffect(() => {
    const checkStorybookMcp = async () => {
      // Ask only when there is reason to: the server saw the addon in
      // .storybook/main.*, or the user turned the toggle on before. A blind
      // probe answered 404 in the console on every load of every project
      // without the addon.
      // The stored value only when the user set it: loadStorybookMcpPref()
      // defaults to true (the toggle's default once the addon is known),
      // which made every project probe.
      let worthAsking = (() => { try { return localStorage.getItem(STORYBOOK_MCP_PREF_KEY) === 'true'; } catch { return false; } })();
      if (!worthAsking) {
        try {
          const cfg = await apiFetch(`${getApiBase()}/mcp/canvas-config`);
          if (cfg.ok) worthAsking = !!(await cfg.json())?.storybookMcpAddon;
        } catch { /* server down: nothing to detect */ }
      }
      if (!worthAsking) return;
      const available = await detectStorybookMcp();
      dispatch({ type: 'SET_STORYBOOK_MCP_AVAILABLE', payload: available });

      // Load saved preference if MCP is available
      if (available) {
        const savedPref = loadStorybookMcpPref();
        dispatch({ type: 'SET_USE_STORYBOOK_MCP', payload: savedPref });
      }
    };

    checkStorybookMcp();
  }, []);

  // Recover an in-flight generation after a preview-iframe reload.
  // Vite reloads the docs page when the new story file lands, which kills the
  // SSE stream mid-generation. The server finishes anyway and persists the
  // assistant reply to the manifest — so on remount, restore the conversation
  // from the stash and poll the manifest until the reply appears.
  useEffect(() => {
    let cancelled = false;
    let raw: string | null = null;
    try { raw = sessionStorage.getItem(PENDING_GEN_KEY); } catch {}
    if (!raw) return;

    let pending: {
      userInput: string;
      conversation: Array<{ role: 'user' | 'ai'; content: string }>;
      fileName: string | null;
      chatId: string | null;
      title: string | null;
      startedAt: number;
    };
    try { pending = JSON.parse(raw); } catch {
      try { sessionStorage.removeItem(PENDING_GEN_KEY); } catch {}
      return;
    }

    // The base window alone decided this once, and it was wrong: a generation
    // with a self-healing pass ran 4m12s, the stash was discarded as stale on
    // the next remount, and the panel came back empty while the server was
    // still working. Now the server's own in-flight list extends the wait
    // (see poll below); the hard ceiling is the only unconditional cutoff.
    const RECOVERY_WINDOW_MS = 4 * 60_000;
    const RECOVERY_HARD_CEILING_MS = 15 * 60_000;
    const ACTIVE_GRACE_MS = 15_000;
    if (!pending.startedAt || Date.now() - pending.startedAt > RECOVERY_HARD_CEILING_MS) {
      try { sessionStorage.removeItem(PENDING_GEN_KEY); } catch {}
      return;
    }

    // Restore the conversation and show a resuming state
    dispatch({ type: 'SET_CONVERSATION', payload: pending.conversation.map(m => ({ role: m.role, content: m.content, thumbnails: (m as any).thumbnails })) });
    if (pending.chatId) {
      dispatch({ type: 'SET_ACTIVE_CHAT', payload: { id: pending.chatId, title: pending.title || '' } });
    }
    dispatch({ type: 'SET_LOADING', payload: true });
    dispatch({
      type: 'SET_STREAMING_STATE',
      payload: { progress: { phase: 'llm_thinking', step: 4, totalSteps: 8, message: 'Reconnecting to your in-progress generation…' } },
    });

    const finishRecovery = () => {
      try { sessionStorage.removeItem(PENDING_GEN_KEY); } catch {}
      dispatch({ type: 'SET_LOADING', payload: false });
      dispatch({ type: 'SET_STREAMING_STATE', payload: null });
    };

    const poll = async () => {
      const baseDeadline = pending.startedAt + RECOVERY_WINDOW_MS;
      const hardDeadline = pending.startedAt + RECOVERY_HARD_CEILING_MS;
      // Only a write newer than this request is this request's result: an
      // update's entry already exists with an older reply, and matching it
      // restored the previous turn as if the new one had finished.
      const earliest = pending.startedAt - 2_000;
      // Whether the server has /story-ui/active-generations. A 404 turns the
      // extension off; the base window alone decides, exactly as before.
      let activeSupported = true;
      let lastActiveMatchAt = 0;
      while (!cancelled && Date.now() < hardDeadline) {
        try {
          const res = await apiFetch(MANIFEST_API());
          if (res.ok) {
            const data = await res.json();
            const entries: Record<string, any> = data.stories ?? {};
            const entry = Object.values(entries).find((e: any) => {
              const matches = pending.fileName ? e.fileName === pending.fileName : e.metadata?.prompt === pending.userInput;
              if (!matches) return false;
              const updated = Date.parse(e.updatedAt || '');
              return Number.isNaN(updated) || updated >= earliest;
            }) as any;
            const conv = entry?.conversation ?? [];
            const last = conv[conv.length - 1];
            // The reply must be NEW: the server upserts the entry when the
            // file lands, before the reply exists, and an update's entry
            // already ends with the previous turn's reply — matching that
            // restored the old two-message chat as if the edit had finished.
            // The stash holds every prior turn plus this request, so the
            // finished conversation is strictly longer.
            const grewPastRequest = conv.length > pending.conversation.length;
            if (entry && last?.role === 'ai' && grewPastRequest) {
              if (cancelled) return;
              finishRecovery();
              const restored: Message[] = conv.map((m: any) => ({ role: m.role, content: m.content, thumbnails: m.thumbnails }));
              const lastCompletion = entry.metadata?.lastCompletion;
              const restoredLast = restored[restored.length - 1];
              if (lastCompletion && restoredLast?.role === 'ai') {
                restoredLast.code = lastCompletion.code || undefined;
                restoredLast.suggestions = lastCompletion.suggestions?.length ? lastCompletion.suggestions : undefined;
                restoredLast.generationTimeMs = lastCompletion.generationTimeMs || undefined;
                restoredLast.storyEntryId = restoredLast.storyEntryId || (entry.id ? String(entry.id) : undefined);
                restoredLast.storyFileName = restoredLast.storyFileName || entry.fileName || undefined;
                restoredLast.verification = restoredLast.verification || verificationFromSummary(lastCompletion.verification);
              }
              dispatch({ type: 'SET_CONVERSATION', payload: restored });
              // Sessions are keyed by the file stem (what /story-ui/stories
              // returns), not the manifest id and not the fileName. The wrong
              // key here made the next message a NEW story instead of an update,
              // and dropped the panel to the welcome screen after a reload.
              dispatch({ type: 'SET_ACTIVE_CHAT', payload: { id: entry.fileName ? entry.fileName.replace(/\.stories\.[a-z]+$/, '') : entry.id, title: entry.title || pending.title || '' } });
              try {
                const sessions = await syncWithActualStories();
                if (!cancelled) dispatch({ type: 'SET_RECENT_CHATS', payload: sessions });
              } catch { /* best effort */ }
              // entry.id is the storyIdSlug — enables the "Open in Storybook" chip
              if (entry.id) {
                awaitStoryIndexed(String(entry.id));
              }
              return;
            }
          }
        } catch { /* server busy — keep polling */ }

        if (activeSupported && !cancelled) {
          try {
            const res = await apiFetch(`${getApiBase()}/story-ui/active-generations`);
            if (res.status === 404) {
              activeSupported = false;
            } else if (res.ok) {
              const active: Array<{ prompt: string; fileName: string | null }> = (await res.json())?.active ?? [];
              const match = active.some(a =>
                a?.prompt === pending.userInput && (!pending.fileName || a.fileName === pending.fileName),
              );
              if (match) lastActiveMatchAt = Date.now();
            }
          } catch { /* a blip says nothing either way; decide on what we last knew */ }
        }

        const now = Date.now();
        if (now >= baseDeadline) {
          if (!activeSupported) break;
          // The manifest write lands just before the server drops the entry,
          // so a short grace after the last sighting lets the next poll see it.
          const stillWorking = lastActiveMatchAt > 0 && now - lastActiveMatchAt < ACTIVE_GRACE_MS;
          if (!stillWorking) break;
        }
        await new Promise(resolve => setTimeout(resolve, 3000));
      }
      if (!cancelled) finishRecovery();
    };
    poll();

    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // "Edit in Story UI" handoff: the manager toolbar button (manager.tsx)
  // stashes the generated story's component id in sessionStorage before
  // navigating here. Once the chat list is loaded, open that story's chat.
  useEffect(() => {
    if (state.recentChats.length === 0) return;
    let request: { componentId?: string } | null = null;
    try {
      request = JSON.parse(sessionStorage.getItem('story-ui-edit-request') || 'null');
    } catch { /* malformed stash — ignore */ }
    if (!request?.componentId) return;
    try { sessionStorage.removeItem('story-ui-edit-request'); } catch {}
    // Primary match: injected meta id (= manifest entry id). Fallback: stories
    // without an injected id (e.g. Svelte defineMeta) get a title-derived
    // Storybook id — 'Generated/My Card' → 'generated-my-card'.
    const sanitize = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
    const chat = state.recentChats.find(c =>
      c.id === request!.componentId ||
      `generated-${sanitize(c.title)}` === request!.componentId
    );
    if (chat) {
      dispatch({ type: 'SET_CONVERSATION', payload: chat.conversation });
      dispatch({ type: 'SET_ACTIVE_CHAT', payload: { id: chat.id, title: chat.title } });
      awaitStoryIndexed(request!.componentId);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.recentChats]);

  // Detect Storybook MANAGER theme (not preview background)
  // This ensures Story UI follows Storybook's overall theme, not the story preview background toggle
  useEffect(() => {
    const detectManagerTheme = () => {
      // null = could not determine from the manager; fall back to system pref.
      // A determined `false` (manager IS light) must NOT be overridden by the
      // system preference — that made the panel render dark inside a light
      // Storybook whenever the OS was in dark mode.
      let managerIsDark: boolean | null = null;

      try {
        if (window.parent !== window) {
          const parentDoc = window.parent.document;
          const parentBody = parentDoc.body;
          const parentHtml = parentDoc.documentElement;

          // Explicit theme markers win when present
          if (parentBody.classList.contains('sb-dark') ||
              parentHtml.classList.contains('sb-dark') ||
              parentHtml.getAttribute('data-theme') === 'dark' ||
              parentBody.getAttribute('data-theme') === 'dark') {
            managerIsDark = true;
          } else {
            // Luminance of the manager chrome. Walk candidates until one has a
            // NON-TRANSPARENT background — `rgba(0, 0, 0, 0)` naively parses
            // as black and previously forced dark mode unconditionally.
            const candidates = [
              parentDoc.querySelector('.sidebar-container'),
              parentDoc.querySelector('#storybook-explorer-menu')?.parentElement ?? null,
              parentDoc.querySelector('.sb-bar'),
              parentBody,
              parentHtml,
            ];
            for (const el of candidates) {
              if (!el) continue;
              const bg = window.parent.getComputedStyle(el).backgroundColor;
              const match = bg.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)(?:,\s*([\d.]+))?\)/);
              if (!match) continue;
              const alpha = match[4] === undefined ? 1 : parseFloat(match[4]);
              if (alpha < 0.5) continue; // transparent — not a real surface color
              const luminance = (0.299 * +match[1] + 0.587 * +match[2] + 0.114 * +match[3]) / 255;
              managerIsDark = luminance < 0.5;
              break;
            }
          }
        }
      } catch {
        // Cross-origin access not allowed — managerIsDark stays null
      }

      // Only when the manager theme is genuinely unknowable, use the system preference.
      if (managerIsDark === null) {
        managerIsDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
      }

      dispatch({ type: 'SET_DARK_MODE', payload: managerIsDark });
    };

    detectManagerTheme();

    // Poll for changes (manager theme changes are rare but possible)
    const intervalId = setInterval(detectManagerTheme, 1000);

    // Listen for system preference changes
    const mediaQuery = window.matchMedia('(prefers-color-scheme: dark)');
    mediaQuery.addEventListener('change', detectManagerTheme);

    // Observe parent document for theme changes if accessible
    let parentObserver: MutationObserver | null = null;
    try {
      if (window.parent !== window) {
        parentObserver = new MutationObserver(detectManagerTheme);
        parentObserver.observe(window.parent.document.body, { attributes: true, attributeFilter: ['class', 'data-theme'] });
        parentObserver.observe(window.parent.document.documentElement, { attributes: true, attributeFilter: ['class', 'data-theme'] });
      }
    } catch {
      // Cross-origin, ignore
    }

    return () => {
      clearInterval(intervalId);
      mediaQuery.removeEventListener('change', detectManagerTheme);
      parentObserver?.disconnect();
    };
  }, []);

  // Close context menu when clicking outside or pressing Escape
  useEffect(() => {
    if (!contextMenuId) return;

    const handleClickOutside = (e: MouseEvent) => {
      const target = e.target as HTMLElement;
      if (!target.closest('.sui-context-menu') && !target.closest('.sui-chat-item-menu')) {
        setContextMenuId(null);
      }
    };
    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setContextMenuId(null);
      }
    };

    document.addEventListener('click', handleClickOutside);
    document.addEventListener('keydown', handleEscape);
    return () => {
      document.removeEventListener('click', handleClickOutside);
      document.removeEventListener('keydown', handleEscape);
    };
  }, [contextMenuId]);

  // One popover at a time: a press outside its anchor, or Escape, closes it.
  useEffect(() => {
    if (!openMenu) return;
    const handlePointerDown = (e: MouseEvent) => {
      const target = e.target as HTMLElement | null;
      if (!target?.closest?.('.sui-menu-anchor')) setOpenMenu(null);
    };
    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpenMenu(null);
    };
    document.addEventListener('mousedown', handlePointerDown);
    document.addEventListener('keydown', handleEscape);
    return () => {
      document.removeEventListener('mousedown', handlePointerDown);
      document.removeEventListener('keydown', handleEscape);
    };
  }, [openMenu]);

  // Disclosure state is keyed by turn index; it must not carry over from one
  // conversation into the next.
  useEffect(() => {
    setOpenSteps({});
    setOpenCode({});
    setOpenMenu(null);
  }, [state.activeChatId]);

  const copyCode = useCallback((turn: number, code: string) => {
    const fail = () => dispatch({ type: 'SET_ERROR', payload: 'Could not copy the code to the clipboard.' });
    try {
      navigator.clipboard.writeText(code).then(() => {
        setCopiedTurn(turn);
        window.setTimeout(() => setCopiedTurn(t => (t === turn ? null : t)), 1600);
      }).catch(fail);
    } catch {
      fail();
    }
  }, []);

  // Initialize on mount
  useEffect(() => {
    const initialize = async () => {
      const connectionTest = await testMCPConnection();
      dispatch({ type: 'SET_CONNECTION_STATUS', payload: connectionTest });
      if (connectionTest.connected) {
        try {
          const res = await apiFetch(PROVIDERS_API());
          if (res.ok) {
            const data: ProvidersResponse = await res.json();
            const configuredProviders = data.providers.filter(p => p.configured);
            dispatch({ type: 'SET_PROVIDERS', payload: configuredProviders });

            // Check for saved provider preferences first
            const savedPrefs = loadProviderPrefs();
            if (savedPrefs) {
              // Verify saved provider is still configured
              const savedProviderExists = configuredProviders.some(p => p.type === savedPrefs.provider);
              if (savedProviderExists) {
                dispatch({ type: 'SET_SELECTED_PROVIDER', payload: savedPrefs.provider });
                // Verify saved model exists for this provider
                const providerInfo = configuredProviders.find(p => p.type === savedPrefs.provider);
                if (providerInfo?.models.includes(savedPrefs.model)) {
                  dispatch({ type: 'SET_SELECTED_MODEL', payload: savedPrefs.model });
                } else if (providerInfo?.models.length) {
                  // Model no longer available, use first model of saved provider
                  dispatch({ type: 'SET_SELECTED_MODEL', payload: providerInfo.models[0] });
                }
              } else if (data.current) {
                // Saved provider no longer configured, fall back to server default
                dispatch({ type: 'SET_SELECTED_PROVIDER', payload: data.current.provider.toLowerCase() });
                dispatch({ type: 'SET_SELECTED_MODEL', payload: data.current.model });
              }
            } else if (data.current) {
              // No saved preferences, use server default
              dispatch({ type: 'SET_SELECTED_PROVIDER', payload: data.current.provider.toLowerCase() });
              dispatch({ type: 'SET_SELECTED_MODEL', payload: data.current.model });
            }
          }
        } catch (e) {
          console.error('Failed to fetch providers:', e);
        }
        try {
          const res = await apiFetch(CONSIDERATIONS_API());
          if (res.ok) {
            const data = await res.json();
            if (data.hasConsiderations && data.considerations) {
              dispatch({ type: 'SET_CONSIDERATIONS', payload: data.considerations });
            }
          }
        } catch (e) {
          console.error('Failed to fetch considerations:', e);
        }
        try {
          // Whether this project can accept a handoff at all (git repo, remote,
          // gh auth). Fetched once; the action row reuses it per message.
          const res = await apiFetch(`${getApiBase()}/story-ui/handoff/status`);
          if (res.ok) setHandoffStatus(await res.json());
        } catch {
          // Handoff simply stays unavailable.
        }
        try {
          const canvasCfgRes = await apiFetch(`${getApiBase()}/mcp/canvas-config`);
          if (canvasCfgRes.ok) {
            const canvasCfg = await canvasCfgRes.json();
            const isReact = !canvasCfg.componentFramework || canvasCfg.componentFramework === 'react';
            setIsReactFramework(isReact);
            if (!isReact && panelMode === 'canvas') {
              setPanelMode('chat');
              canvasModeRef.current = false;
              try { localStorage.removeItem('__sui_panel_mode__'); } catch {}
            }
          }
        } catch {
          // canvas-config unavailable — default to showing the tab
        }
        const [syncedChats, sbOrder] = await Promise.all([
          syncWithActualStories(),
          fetchStorybookOrder(),
        ]);
        setStorybookOrder(sbOrder);
        // Keep manifest order (lastUpdated desc) as the base; render will re-sort by Storybook position
        const sortedChats = syncedChats.sort((a, b) => b.lastUpdated - a.lastUpdated).slice(0, MAX_RECENT_CHATS);
        dispatch({ type: 'SET_RECENT_CHATS', payload: sortedChats });
        // Start with a fresh empty chat — user clicks a chat to resume it
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

  // Save provider preferences when they change
  useEffect(() => {
    if (state.selectedProvider && state.selectedModel) {
      saveProviderPrefs(state.selectedProvider, state.selectedModel);
    }
  }, [state.selectedProvider, state.selectedModel]);

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

  // Decode a File into an <img> we can draw to a canvas.
  const loadImageElement = (file: File): Promise<HTMLImageElement> =>
    new Promise((resolve, reject) => {
      const url = URL.createObjectURL(file);
      const img = new Image();
      img.onload = () => { URL.revokeObjectURL(url); resolve(img); };
      img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('Could not decode image')); };
      img.src = url;
    });

  /** Build a small, persistable data-URL preview of an attachment. */
  const makeThumbnail = async (file: File): Promise<string | undefined> => {
    try {
      const img = await loadImageElement(file);
      const longEdge = Math.max(img.width, img.height);
      const scale = Math.min(1, THUMB_MAX_DIMENSION / longEdge);
      const canvas = document.createElement('canvas');
      canvas.width = Math.max(1, Math.round(img.width * scale));
      canvas.height = Math.max(1, Math.round(img.height * scale));
      const ctx = canvas.getContext('2d');
      if (!ctx) return undefined;
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
      return canvas.toDataURL('image/jpeg', THUMB_QUALITY);
    } catch {
      return undefined;
    }
  };

  /**
   * Prepare an attachment for upload: downscale to the vision model's effective
   * resolution ceiling and re-encode large images as JPEG.
   *
   * Returns raw base64 (no data: prefix) plus the media type that actually
   * matches the encoded bytes — these must agree or the provider rejects it.
   * Falls back to the original bytes if canvas encoding is unavailable.
   */
  const prepareImageForUpload = async (
    file: File
  ): Promise<{ base64: string; mediaType: string }> => {
    try {
      const img = await loadImageElement(file);
      const longEdge = Math.max(img.width, img.height);
      const scale = longEdge > MAX_IMAGE_DIMENSION ? MAX_IMAGE_DIMENSION / longEdge : 1;
      const needsResize = scale < 1;
      const needsRecompress = file.size > JPEG_FALLBACK_BYTES;

      if (!needsResize && !needsRecompress) {
        return { base64: await fileToBase64(file), mediaType: file.type || 'image/png' };
      }

      const canvas = document.createElement('canvas');
      canvas.width = Math.max(1, Math.round(img.width * scale));
      canvas.height = Math.max(1, Math.round(img.height * scale));
      const ctx = canvas.getContext('2d');
      if (!ctx) {
        return { base64: await fileToBase64(file), mediaType: file.type || 'image/png' };
      }
      // White matte: JPEG has no alpha, and transparent screenshot regions
      // would otherwise composite to black.
      const asJpeg = needsRecompress || file.type === 'image/jpeg';
      if (asJpeg) {
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(0, 0, canvas.width, canvas.height);
      }
      ctx.imageSmoothingEnabled = true;
      ctx.imageSmoothingQuality = 'high';
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height);

      const mediaType = asJpeg ? 'image/jpeg' : 'image/png';
      const dataUrl = canvas.toDataURL(mediaType, asJpeg ? JPEG_QUALITY : undefined);
      const base64 = dataUrl.split(',')[1];
      if (!base64) {
        return { base64: await fileToBase64(file), mediaType: file.type || 'image/png' };
      }
      return { base64, mediaType };
    } catch {
      // Canvas path failed (tainted, decode error, headless) — send as-is.
      return { base64: await fileToBase64(file), mediaType: file.type || 'image/png' };
    }
  };

  const handleFileSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const selected = e.target.files;
    if (!selected) return;
    const errors: string[] = [];
    // Images go through the vision path; Markdown, CSV, JSON, text and PDF
    // travel as reference documents (the "+" used to refuse them as "Not an
    // image file", so a spec attached to a prompt was never read).
    const { images: files, documents: docFiles, rejected } = partitionFiles(Array.from(selected));
    for (const f of rejected) errors.push(`${f.name}: not a supported file (images, PDF, Markdown, CSV, JSON or text)`);
    if (docFiles.length) {
      const { documents, errors: docErrors } = await processDocumentFiles(docFiles);
      if (documents.length) dispatch({ type: 'ADD_ATTACHED_DOCS', payload: documents });
      errors.push(...docErrors);
    }
    for (let i = 0; i < files.length && (state.attachedImages.length + i) < MAX_IMAGES; i++) {
      const file = files[i];
      if (file.size > MAX_IMAGE_SIZE_MB * 1024 * 1024) {
        errors.push(`${file.name}: File too large (max ${MAX_IMAGE_SIZE_MB}MB)`);
        continue;
      }
      try {
        const { base64, mediaType } = await prepareImageForUpload(file);
        const thumbnail = await makeThumbnail(file);
        const preview = URL.createObjectURL(file);
        dispatch({
          type: 'ADD_ATTACHED_IMAGE',
          payload: { id: `${Date.now()}-${i}`, file, preview, base64, mediaType, thumbnail },
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
        const { base64, mediaType } = await prepareImageForUpload(file);
        const thumbnail = await makeThumbnail(file);
        const preview = URL.createObjectURL(file);
        dispatch({
          type: 'ADD_ATTACHED_IMAGE',
          payload: { id: `${Date.now()}-${i}`, file, preview, base64, mediaType, thumbnail },
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
        const { base64, mediaType } = await prepareImageForUpload(file);
        const thumbnail = await makeThumbnail(file);
        const preview = URL.createObjectURL(file);
        const timestamp = new Date().toISOString().slice(11, 19).replace(/:/g, '-');
        const ext = mediaType === 'image/jpeg' ? 'jpg' : 'png';
        dispatch({
          type: 'ADD_ATTACHED_IMAGE',
          payload: {
            id: `paste-${Date.now()}-${i}`,
            file: new File([file], `pasted-image-${timestamp}.${ext}`, { type: file.type }),
            preview,
            base64,
            mediaType,
            thumbnail,
          },
        });
      } catch {
        dispatch({ type: 'SET_ERROR', payload: 'Failed to process pasted image' });
      }
    }
  }, [state.attachedImages.length]);

  // Build response message. When the server includes a model-authored
  // chatSummary, that becomes the assistant's voice; the structured receipt
  // is only used as a fallback for older servers.
  const buildConversationalResponse = (completion: CompletionFeedback, isUpdate: boolean): string => {
    const parts: string[] = [];
    const isFallback = completion.isFallback === true;
    const statusMarker = completion.success ? '[SUCCESS]' : (isFallback ? '[WARNING]' : '[ERROR]');
    // Show "Failed:" when success is false, otherwise "Created:" or "Updated:"
    const actionWord = completion.success ? (isUpdate ? 'Updated' : 'Created') : (isFallback ? 'Placeholder' : 'Failed');
    parts.push(`${statusMarker} **${actionWord}: "${completion.title}"**`);

    // Add fallback-specific warning
    if (isFallback) {
      parts.push(`\n\n⚠️ **Generation failed** - An error placeholder was saved. You may want to delete this story and try again with a simpler request.`);
    }

    if (completion.chatSummary && !isFallback) {
      // Conversational reply authored by the model
      parts.push(`\n\n${completion.chatSummary}`);
    } else {
      // Legacy receipt built from code analysis
      const componentCount = completion.componentsUsed?.length || 0;
      if (componentCount > 0) {
        const names = completion.componentsUsed.slice(0, 5).map(c => `\`${c.name}\``).join(', ');
        parts.push(`\nBuilt with ${names}${componentCount > 5 ? '…' : ''}.`);
      }
      if (completion.layoutChoices?.length > 0) {
        const layout = completion.layoutChoices[0];
        parts.push(`\n\n**Layout:** ${layout.pattern} - ${layout.reason}.`);
      }
      if (completion.suggestions && completion.suggestions.length > 0 && !completion.suggestions[0].toLowerCase().includes('review the generated code')) {
        parts.push(`\n\n[TIP] **Tip:** ${completion.suggestions[0]}`);
      }
    }

    if (completion.validation?.autoFixApplied) {
      // Say what was fixed, not "minor syntax issues": on Vue every story
      // carried that line, and the fix was actually import paths being
      // rewritten onto the configured barrel. A server that reports the
      // fix but describes it as having changed nothing gets no banner —
      // there is nothing to tell the user about.
      const details = completion.validation.fixDetails;
      if (details === undefined) {
        parts.push(`\n\n[WRENCH] **Auto-fixed:** the generated code was automatically corrected before it was saved.`);
      } else if (details.length > 0) {
        parts.push(`\n\n[WRENCH] **Auto-fixed:** ${details.join('; ')}.`);
      }
    }
    if (completion.runtimeValidation?.enabled && !completion.runtimeValidation.success) {
      parts.push(`\n\n⚠️ **Heads up:** the story saved but may not render correctly in Storybook (${completion.runtimeValidation.error || 'runtime error'}). Ask me to fix it or try regenerating.`);
    }
    if (!isUpdate && isEdgeMode() && !hasShownRefreshHint.current) {
      parts.push(`\n\n_Story saved to cloud._`);
      hasShownRefreshHint.current = true;
    }
    return parts.join('');
  };

  /**
   * No-reload story registration (Storybook ≥9 handles new story files live):
   * poll the story index until the new story appears, then attach its entry ID
   * to the last AI message so an "Open story" button can navigate to it
   * client-side via the addons channel. Replaces the old full-page reload
   * workaround for storybookjs/storybook#30431, which is fixed upstream.
   */
  const awaitStoryIndexed = useCallback((storybookId: string, fileName?: string) => {
    let cancelled = false;
    // ~45s. Large compositions can take a moment to be picked up; the previous
    // 22s window expired before slower indexes caught up.
    const maxAttempts = 30;
    let attempt = 0;

    const poll = async () => {
      while (!cancelled && attempt < maxAttempts) {
        attempt++;
        try {
          const res = await apiFetch('/index.json', { cache: 'no-store' });
          if (res.ok) {
            const index = await res.json();
            const entries = index.entries || {};
            // Prefer a real story entry; fall back to the docs entry.
            const entryId =
              Object.keys(entries).find(id => id.startsWith(`${storybookId}--`) && entries[id].type === 'story') ||
              Object.keys(entries).find(id => id.startsWith(`${storybookId}--`));
            if (entryId) {
              if (!cancelled) {
                dispatch({ type: 'PATCH_LAST_AI_MESSAGE', payload: { storyEntryId: entryId, storyIndexStalled: undefined } });
              }
              return;
            }
          }
        } catch {
          // Index not reachable yet — keep polling.
        }
        await new Promise(resolve => setTimeout(resolve, 1500));
      }
      if (!cancelled) {
        // The file is on disk but Storybook never indexed it. Say so in the UI:
        // failing silently here is what left generated stories unreachable.
        console.warn(`[Story UI] Story "${storybookId}" did not appear in the index after ${maxAttempts} polls`);
        dispatch({
          type: 'PATCH_LAST_AI_MESSAGE',
          payload: { storyIndexStalled: { storybookId, fileName } },
        });
      }
    };

    poll();
    return () => { cancelled = true; };
  }, []);

  /**
   * Re-check the index on demand. Storybook rebuilds its index on restart, so
   * this turns the stalled notice into a working button without a full reload.
   */
  const recheckStoryIndex = useCallback(async (storybookId: string) => {
    try {
      const res = await apiFetch('/index.json', { cache: 'no-store' });
      if (!res.ok) return false;
      const entries = (await res.json()).entries || {};
      const entryId =
        Object.keys(entries).find(id => id.startsWith(`${storybookId}--`) && entries[id].type === 'story') ||
        Object.keys(entries).find(id => id.startsWith(`${storybookId}--`));
      if (entryId) {
        dispatch({ type: 'PATCH_LAST_AI_MESSAGE', payload: { storyEntryId: entryId, storyIndexStalled: undefined } });
        return true;
      }
    } catch { /* still unreachable */ }
    return false;
  }, []);

  /** Navigate the Storybook manager to a story without a page reload. */
  const openStoryInStorybook = useCallback((entryId: string) => {
    // The panel lives in the preview iframe, so the channel here is the
    // preview's. Emitting selectStory usually reaches the manager — but when it
    // doesn't, the old code had already returned and the button did nothing.
    // Emit, then verify the manager actually navigated and fall back to a URL.
    const navigateByUrl = () => {
      try {
        const target = window.top ?? window;
        target.location.href = `${target.location.pathname}?path=/story/${entryId}`;
      } catch {
        window.open(`/?path=/story/${entryId}`, '_blank');
      }
    };

    let emitted = false;
    try {
      const channel = (window as any).__STORYBOOK_ADDONS_CHANNEL__;
      if (channel?.emit) {
        // Storybook has used both event names across versions; emitting the
        // one the running manager doesn't know is harmless.
        channel.emit('selectStory', { storyId: entryId });
        channel.emit('setCurrentStory', { storyId: entryId });
        emitted = true;
      }
    } catch {
      // fall through to URL navigation
    }

    if (!emitted) {
      navigateByUrl();
      return;
    }

    // If the manager didn't move to the story shortly after the emit, navigate
    // directly rather than leaving the click with no visible effect.
    window.setTimeout(() => {
      try {
        const search = (window.top ?? window).location.search || '';
        if (!search.includes(entryId)) navigateByUrl();
      } catch {
        navigateByUrl();
      }
    }, 400);
  }, []);

  // Finalize streaming
  const finalizeStreamingConversation = useCallback(async (newConversation: Message[], completion: CompletionFeedback, userInput: string, steps?: string[]) => {
    // Track this story as panel-generated to prevent false MCP detection
    // The story ID is the fileName without .stories.tsx extension
    if (completion.success && completion.fileName) {
      const storyId = completion.fileName.replace('.stories.tsx', '');
      panelGeneratedStoryIds.current.add(storyId);
    }

    const isUpdate = completion.summary.action === 'updated';
    const responseMessage = buildConversationalResponse(completion, isUpdate);
    const aiMsg: Message = {
      role: 'ai',
      content: responseMessage,
      // Model-authored follow-ups become clickable refinement chips. Legacy
      // warning-style suggestions (no chatSummary) stay inline text only.
      suggestions: completion.chatSummary && completion.success ? completion.suggestions : undefined,
      code: completion.code,
      isError: !completion.success,
      retryInput: !completion.success ? userInput : undefined,
      generationTimeMs: completion.metrics?.totalTimeMs,
      verification: completion.verification,
      storyFileName: completion.fileName,
      storyTitle: completion.title,
      steps: steps?.length ? steps : undefined,
      isUpdate,
    };
    const updatedConversation = [...newConversation, aiMsg];
    dispatch({ type: 'SET_CONVERSATION', payload: updatedConversation });
    const isExistingSession = state.activeChatId && state.conversation.length > 0;

    if (isExistingSession && state.activeChatId) {
      // Load existing session to preserve fileName if completion doesn't include it
      // This fixes the bug where iterations would corrupt fileName with storyId
      const chats = loadChats();
      const chatIndex = chats.findIndex(c => c.id === state.activeChatId);
      const existingFileName = chatIndex !== -1 ? chats[chatIndex].fileName : '';

      const updatedSession: ChatSession = {
        id: state.activeChatId,
        title: state.activeTitle,
        // Use completion.fileName if provided, otherwise preserve existing fileName
        // NEVER fall back to storyId (activeChatId) as that corrupts the fileName
        fileName: completion.fileName || existingFileName || '',
        conversation: updatedConversation,
        lastUpdated: Date.now(),
      };
      if (chatIndex !== -1) chats[chatIndex] = updatedSession;
      await persistChatToManifest(updatedSession);
      dispatch({ type: 'SET_RECENT_CHATS', payload: loadChats() });
    } else {
      // FIX: Use fileName as chat ID (not storyId) so delete endpoint can find the actual file
      // storyId is like "story-a1b2c3d4" but fileName is "Button-a1b2c3d4.stories.tsx"
      const chatId = completion.fileName || completion.storyId || Date.now().toString();
      const chatTitle = completion.title || userInput;
      dispatch({ type: 'SET_ACTIVE_CHAT', payload: { id: chatId, title: chatTitle } });
      const newSession: ChatSession = {
        id: chatId,
        title: chatTitle,
        fileName: completion.fileName || '',
        conversation: updatedConversation,
        lastUpdated: Date.now(),
      };
      await persistChatToManifest(newSession);
      dispatch({ type: 'SET_RECENT_CHATS', payload: loadChats() });

    }

    // Watch the story index and attach an "Open story" link when the new
    // story is ready — no page reload needed (Storybook ≥9 indexes live).
    if (completion.success && completion.storybookId) {
      awaitStoryIndexed(completion.storybookId, completion.fileName);
    }
  }, [state.activeChatId, state.activeTitle, state.conversation.length, awaitStoryIndexed]);

  // Handle send. overrideInput lets retry buttons and suggestion chips send
  // without round-tripping through the (possibly stale) input state.
  const handleSend = async (e?: React.FormEvent, overrideInput?: string) => {
    if (e) e.preventDefault();
    if (!overrideInput && !state.input.trim() && state.attachedImages.length === 0 && state.attachedDocs.length === 0) return;
    // Default prompt for a bare image upload. Phrased as a composition on
    // purpose: "a component" biased the model toward extracting one card out
    // of a full-page screenshot.
    const userInput = overrideInput?.trim() || state.input.trim() || (state.attachedImages.length > 0
      ? 'Recreate this design. Reproduce every region visible in the image, in the same layout.'
      : '');
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
    const docsToSend = [...state.attachedDocs];
    const userMessage: Message = {
      role: 'user',
      content: userInput,
      attachedImages: hasImages ? imagesToSend : undefined,
      documents: docsToSend.length ? docsToSend.map(d => d.name) : undefined,
      // Kept separately so the reference image is still visible after the chat
      // is reloaded from storage.
      thumbnails: hasImages
        ? imagesToSend.map(img => img.thumbnail).filter((t): t is string => !!t)
        : undefined,
    };
    const newConversation: Message[] = [...state.conversation, userMessage];
    dispatch({ type: 'SET_CONVERSATION', payload: newConversation });
    dispatch({ type: 'SET_INPUT', payload: '' });
    clearAttachedImages();

    // Get the actual fileName from localStorage (not React state which may be stale)
    // This ensures updates overwrite the correct file instead of creating duplicates
    const freshChats = loadChats();
    const activeChat = freshChats.find(c => c.id === state.activeChatId);
    const activeFileName = activeChat?.fileName || undefined;

    if (USE_STREAMING) {
      try {
        if (abortControllerRef.current) abortControllerRef.current.abort();
        abortControllerRef.current = new AbortController();
        dispatch({ type: 'SET_STREAMING_STATE', payload: {} });

        // Stash the in-flight generation so it survives a preview-iframe
        // reload (Vite reloads the docs page when the new story file lands).
        // The server persists the assistant reply to the manifest, so the
        // remounted panel can recover the finished conversation from there.
        try {
          sessionStorage.setItem(PENDING_GEN_KEY, JSON.stringify({
            userInput,
            conversation: newConversation.map(m => ({ role: m.role, content: m.content, thumbnails: m.thumbnails })),
            fileName: activeFileName || null,
            chatId: state.activeChatId || null,
            title: state.activeTitle || null,
            startedAt: Date.now(),
          }));
        } catch { /* sessionStorage unavailable */ }

        const requestBody = {
          prompt: userInput,
          conversation: newConversation,
          fileName: activeFileName,
          isUpdate: !!(state.activeChatId && activeFileName),
          originalTitle: state.activeTitle || undefined,
          storyId: state.activeChatId || undefined,
          // mediaType must describe the bytes we actually encoded — after
          // downscaling that can differ from the original file's type.
          images: hasImages
            ? imagesToSend.map(img => ({ type: 'base64' as const, data: img.base64, mediaType: img.mediaType }))
            : undefined,
          files: docsToSend.length ? docsToSend.map(toPayload) : undefined,
          visionMode: hasImages ? 'screenshot_to_story' : undefined,
          provider: state.selectedProvider || undefined,
          model: state.selectedModel || undefined,
          considerations: state.considerations || undefined,
          useStorybookMcp: state.storybookMcpAvailable && state.useStorybookMcp,
          // The panel runs inside Storybook's docs iframe, so it knows the
          // origin. Sent unconditionally, as the V2 workspace does
          // (useGeneration.ts): it used to ride only with the Storybook-MCP
          // toggle, so with the toggle off the server verified against port
          // 6006 "by convention" and reported a story indexed on :6103 within
          // seconds as "did not appear in Storybook's index".
          storybookUrl: typeof window !== 'undefined' ? window.location.origin : undefined,
          voiceMode: voiceModeActiveRef.current || undefined,
        };
        const response = await apiFetch(MCP_STREAM_API(), {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(requestBody),
          signal: abortControllerRef.current.signal,
        });
        if (!response.ok) {
          const streamErr = new Error(`Streaming request failed: ${response.status}`);
          (streamErr as any).status = response.status;
          throw streamErr;
        }
        const reader = response.body?.getReader();
        if (!reader) throw new Error('No response body');
        const decoder = new TextDecoder();
        let buffer = '';
        let completionData: CompletionFeedback | null = null;
        let errorData: ErrorFeedback | null = null;
        // Every progress message, once — becomes the reply's steps disclosure.
        const progressLog: string[] = [];
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
                  case 'progress': {
                    const progress = event.data as ProgressUpdate;
                    if (progress?.message && progressLog[progressLog.length - 1] !== progress.message) {
                      progressLog.push(progress.message);
                    }
                    dispatch({ type: 'UPDATE_STREAMING_STATE', payload: { progress } });
                    break;
                  }
                  case 'validation':
                    dispatch({ type: 'UPDATE_STREAMING_STATE', payload: { validation: event.data as ValidationFeedback } });
                    break;
                  case 'retry': {
                    const retry = event.data as RetryInfo;
                    if (retry?.reason) progressLog.push(`Retry ${retry.attempt}/${retry.maxAttempts}: ${retry.reason}`);
                    dispatch({ type: 'UPDATE_STREAMING_STATE', payload: { retry } });
                    break;
                  }
                  case 'completion':
                    completionData = event.data as CompletionFeedback;
                    // Register immediately so the story poller never classifies
                    // this panel-generated story as external (reload race).
                    if (completionData.fileName) {
                      panelGeneratedStoryIds.current.add(completionData.fileName.replace(/\.stories\.\w+$/, ''));
                    }
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
        try { sessionStorage.removeItem(PENDING_GEN_KEY); } catch {}
        if (completionData) {
          finalizeStreamingConversation(newConversation, completionData, userInput, progressLog);
        } else if (errorData) {
          dispatch({ type: 'SET_ERROR', payload: errorData.message });
          const errorConversation = [...newConversation, {
            role: 'ai' as const,
            content: `Error: ${errorData.message}\n\n${errorData.suggestion || ''}`,
            isError: true,
            retryInput: userInput,
          }];
          dispatch({ type: 'SET_CONVERSATION', payload: errorConversation });
        }
      } catch (err: unknown) {
        if ((err as Error).name === 'AbortError') return;

        // A rejected payload will be rejected again by the fallback, and
        // retrying without the images would silently produce a story that
        // ignores the design the user attached. Surface it instead.
        if ((err as any)?.status === 413) {
          try { sessionStorage.removeItem(PENDING_GEN_KEY); } catch {}
          dispatch({ type: 'SET_STREAMING_STATE', payload: null });
          dispatch({ type: 'SET_LOADING', payload: false });
          const msg = 'The attached image is too large for the server to accept. Try a smaller or lower-resolution image, or attach fewer images.';
          dispatch({ type: 'SET_ERROR', payload: msg });
          dispatch({ type: 'SET_CONVERSATION', payload: [...newConversation, {
            role: 'ai' as const, content: `Error: ${msg}`, isError: true, retryInput: userInput,
          }] });
          return;
        }

        console.warn('Streaming failed, falling back to non-streaming:', err);
        try { sessionStorage.removeItem(PENDING_GEN_KEY); } catch {}
        dispatch({ type: 'SET_STREAMING_STATE', payload: null });
        try {
          const res = await apiFetch(MCP_API(), {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              prompt: userInput,
              conversation: newConversation,
              fileName: activeFileName,
              isUpdate: !!(state.activeChatId && activeFileName),
              originalTitle: state.activeTitle || undefined,
              storyId: state.activeChatId || undefined,
              // Vision inputs must survive the fallback. Dropping them here is
              // what made image uploads look like they were being ignored.
              images: hasImages
                ? imagesToSend.map(img => ({ type: 'base64' as const, data: img.base64, mediaType: img.mediaType }))
                : undefined,
              files: docsToSend.length ? docsToSend.map(toPayload) : undefined,
              visionMode: hasImages ? 'screenshot_to_story' : undefined,
              provider: state.selectedProvider || undefined,
              model: state.selectedModel || undefined,
              considerations: state.considerations || undefined,
              useStorybookMcp: state.storybookMcpAvailable && state.useStorybookMcp,
          // The panel runs inside Storybook's docs iframe, so it knows the
          // origin. Sent unconditionally, as the V2 workspace does
          // (useGeneration.ts): it used to ride only with the Storybook-MCP
          // toggle, so with the toggle off the server verified against port
          // 6006 "by convention" and reported a story indexed on :6103 within
          // seconds as "did not appear in Storybook's index".
          storybookUrl: typeof window !== 'undefined' ? window.location.origin : undefined,
            }),
          });
          const data = await res.json();
          if (!res.ok || !data.success) throw new Error(data.error || 'Story generation failed');
          const responseMessage = `[SUCCESS] **Created: "${data.title}"**\n\nStory generated successfully.`;
          const aiMsg: Message = { role: 'ai', content: responseMessage };
          const updatedConversation = [...newConversation, aiMsg];
          dispatch({ type: 'SET_CONVERSATION', payload: updatedConversation });

          // Persist chat to localStorage (mirrors streaming path behavior)
          const chatId = data.fileName || data.storyId || Date.now().toString();
          const chatTitle = data.title || userInput;
          dispatch({ type: 'SET_ACTIVE_CHAT', payload: { id: chatId, title: chatTitle } });
          const newSession: ChatSession = {
            id: chatId,
            title: chatTitle,
            fileName: data.fileName || '',
            conversation: updatedConversation,
            lastUpdated: Date.now(),
          };
          await persistChatToManifest(newSession);
          dispatch({ type: 'SET_RECENT_CHATS', payload: loadChats() });
        } catch (fallbackErr: unknown) {
          const errorMessage = fallbackErr instanceof Error ? fallbackErr.message : 'Unknown error';
          dispatch({ type: 'SET_ERROR', payload: errorMessage });
          const errorConversation = [...newConversation, {
            role: 'ai' as const,
            content: `Error: ${errorMessage}`,
            isError: true,
            retryInput: userInput,
          }];
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
    const last = chat.conversation[chat.conversation.length - 1];
    if (last?.role === 'ai' && last.storybookComponentId) {
      awaitStoryIndexed(last.storybookComponentId);
    }
  };

  const handleNewChat = () => {
    dispatch({ type: 'NEW_CHAT' });
    // When on Voice Canvas, also clear the canvas state (abort generation,
    // reset code, blank the iframe, clear conversation history)
    if (panelMode === 'canvas') {
      voiceCanvasRef.current?.clear();
    }
  };

  // Voice input handlers
  const handleVoiceTranscript = useCallback((text: string) => {
    // Append transcript to current input (user may be speaking in segments)
    dispatch({ type: 'SET_INPUT', payload: state.input ? `${state.input} ${text}` : text });
  }, [state.input]);

  const handleVoiceCommand = useCallback((command: VoiceCommand) => {
    switch (command.type) {
      case 'submit':
        if (state.input.trim()) handleSend();
        break;
      case 'clear':
      case 'new-chat':
        dispatch({ type: 'NEW_CHAT' });
        dispatch({ type: 'SET_INPUT', payload: '' });
        break;
      case 'stop':
        // Voice toggle handles this via its own state
        break;
      case 'undo':
        // TODO: Implement undo (revert to previous story version)
        break;
      case 'redo':
        // TODO: Implement redo
        break;
    }
  }, [state.input, handleSend]);

  const handleVoiceSubmit = useCallback(() => {
    if (state.input.trim() && !state.loading) {
      handleSend();
    }
  }, [state.input, state.loading, handleSend]);

  const handleDeleteChat = async (chatId: string, e?: React.MouseEvent) => {
    if (e) e.stopPropagation();
    setContextMenuId(null);
    if (confirm('Delete this story and chat? This action cannot be undone.')) {
      // Look up the actual fileName from the chat session (more reliable than chatId)
      const chat = state.recentChats.find(c => c.id === chatId);
      const success = await deleteStoryAndChat(chatId, chat?.fileName);
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

  // Check for orphan stories (stories without associated chats)
  const checkOrphanStories = useCallback(async () => {
    if (!state.connectionStatus.connected) return;
    try {
      const chatFileNames = state.recentChats.map(chat => chat.fileName);
      const response = await apiFetch(ORPHAN_STORIES_API(), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ chatFileNames }),
      });
      if (response.ok) {
        const data = await response.json();
        setOrphanCount(data.count || 0);
      }
    } catch (error) {
      console.error('Failed to check orphan stories:', error);
    }
  }, [state.connectionStatus.connected, state.recentChats]);

  // Delete all orphan stories
  const handleDeleteOrphans = async () => {
    if (orphanCount === 0) return;
    if (!confirm(`Delete ${orphanCount} orphan ${orphanCount === 1 ? 'story' : 'stories'}? These are generated story files without associated chats.`)) {
      return;
    }
    setIsDeletingOrphans(true);
    try {
      const chatFileNames = state.recentChats.map(chat => chat.fileName);
      const response = await apiFetch(ORPHAN_STORIES_API(), {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ chatFileNames }),
      });
      if (response.ok) {
        const data = await response.json();
        setOrphanCount(0);
        if (data.count > 0) {
          // Show success message briefly
          alert(`Deleted ${data.count} orphan ${data.count === 1 ? 'story' : 'stories'}.`);
        }
      } else {
        alert('Failed to delete orphan stories. Please try again.');
      }
    } catch (error) {
      console.error('Failed to delete orphan stories:', error);
      alert('Failed to delete orphan stories. Please try again.');
    } finally {
      setIsDeletingOrphans(false);
    }
  };

  // Check for orphans when chats change or connection is established
  useEffect(() => {
    checkOrphanStories();
  }, [checkOrphanStories]);

  const handleStartRename = (chatId: string, currentTitle: string, e?: React.MouseEvent) => {
    if (e) e.stopPropagation();
    setContextMenuId(null);
    setRenamingChatId(chatId);
    setRenameValue(currentTitle);
  };

  const handleConfirmRename = async (chatId: string) => {
    if (!renameValue.trim()) {
      setRenamingChatId(null);
      return;
    }
    const newTitle = renameValue.trim();
    const chats = loadChats();
    const chatIndex = chats.findIndex(c => c.id === chatId);
    if (chatIndex !== -1) {
      const chat = chats[chatIndex];
      chats[chatIndex].title = newTitle;
      saveChats(chats);
      dispatch({ type: 'SET_RECENT_CHATS', payload: chats });
      if (state.activeChatId === chatId) {
        dispatch({ type: 'SET_ACTIVE_CHAT', payload: { id: chatId, title: newTitle } });
      }
      // Propagate rename to story file and manifest (non-blocking)
      if (chat.fileName) {
        apiFetch(`${STORIES_API()}/${encodeURIComponent(chat.fileName)}/rename`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ title: newTitle }),
        }).catch(() => { /* non-fatal */ });
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
      const response = await apiFetch(`${STORIES_API()}/delete-bulk`, {
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
      const response = await apiFetch(STORIES_API(), { method: 'DELETE' });
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
      const response = await apiFetch(`${STORIES_API()}/${storyId}`, { method: 'DELETE' });
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

  // Explicit light/dark class: the CSS prefers-color-scheme fallback only
  // applies to .sui-root:not(.light), so a detected-light panel must carry
  // the .light class or a dark-mode OS forces dark variables anyway.
  //
  // `sb-unstyled` opts the whole panel out of Storybook's docs typography.
  // Those rules are `:where(h2:not(.sb-unstyled, .sb-unstyled h2))` — zero
  // specificity, injected after this stylesheet, so they beat any class of
  // ours on a tie and painted every heading and paragraph in the Design
  // Context and Voice Canvas tabs in the docs theme's fixed text colour:
  // #2E3338 on a dark panel, 1.2:1.
  const connected = state.connectionStatus.connected;
  // One ordering for the sidebar and the header's story switcher: Storybook's
  // own sidebar order (from /index.json), alphabetical fallback.
  const sortedChats = [...state.recentChats].sort((a, b) => {
    const posA = storybookOrder.get(a.title.toLowerCase()) ?? Infinity;
    const posB = storybookOrder.get(b.title.toLowerCase()) ?? Infinity;
    if (posA !== posB) return posA - posB;
    return a.title.localeCompare(b.title);
  });
  const composerPlaceholder = state.attachedImages.length > 0
    ? 'Describe what to build from these images…'
    : state.conversation.length > 0
      ? 'Describe a change, or ask for something new'
      : 'Describe a component or layout…';

  return (
    <div className={`sui-root sb-unstyled ${state.isDarkMode ? 'dark' : 'light'}`}>
      {/* Sidebar — toggled from the header; collapsed means zero width, and
          its contents unmount so nothing hidden stays in the tab order. */}
      <aside className={`sui-sidebar ${state.sidebarOpen ? '' : 'collapsed'}`} aria-label="Chat history" aria-hidden={!state.sidebarOpen}>
        {state.sidebarOpen && (
          <div className="sui-sidebar-content">
            <button className="sui-button sui-button-default sui-sidebar-new" onClick={handleNewChat}>
              {Icons.plus}
              <span>{panelMode === 'canvas' ? 'New canvas' : 'New story'}</span>
            </button>

            {/* Chat history */}
            <div className="sui-sidebar-chats">
              {sortedChats.map(chat => (
                <div
                  key={chat.id}
                  className={`sui-chat-item ${state.activeChatId === chat.id ? 'active' : ''} ${contextMenuId === chat.id ? 'menu-open' : ''} ${chat.conversation.length === 0 ? 'sui-chat-item--no-history' : ''}`}
                  onClick={() => renamingChatId !== chat.id && handleSelectChat(chat)}
                  role="button"
                  tabIndex={0}
                  aria-current={state.activeChatId === chat.id || undefined}
                  onKeyDown={e => {
                    // Only when the row itself is focused — Enter/Space on the
                    // inner Save/Cancel/More buttons must not also select the chat.
                    if (e.target !== e.currentTarget) return;
                    if ((e.key === 'Enter' || e.key === ' ') && renamingChatId !== chat.id) {
                      e.preventDefault();
                      handleSelectChat(chat);
                    }
                  }}
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
                      <div className="sui-chat-item-title">
                        {chat.source === 'voice-save' && (
                          <span className="sui-chat-item-voice" title="Created with Voice Canvas" aria-label="Created with Voice Canvas">
                            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                              <rect x="9" y="3" width="6" height="11" rx="3" />
                              <path d="M5 11a7 7 0 0 0 14 0M12 18v3" />
                            </svg>
                          </span>
                        )}
                        {chat.title}
                      </div>
                      <div className="sui-chat-item-actions">
                        <button
                          className="sui-chat-item-menu sui-button sui-button-icon sui-button-sm"
                          onClick={e => { e.stopPropagation(); setContextMenuId(contextMenuId === chat.id ? null : chat.id); }}
                          aria-label="More options"
                          aria-haspopup="menu"
                          aria-expanded={contextMenuId === chat.id}
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

            {/* Orphan Stories Footer */}
            {orphanCount > 0 && (
              <div className="sui-orphan-footer">
                <button
                  className="sui-orphan-delete-btn"
                  onClick={handleDeleteOrphans}
                  disabled={isDeletingOrphans}
                  title={`${orphanCount} story ${orphanCount === 1 ? 'file has' : 'files have'} no associated chat`}
                >
                  {isDeletingOrphans ? (
                    <>
                      <span className="sui-orphan-spinner" />
                      <span>Deleting…</span>
                    </>
                  ) : (
                    <>
                      {Icons.trash}
                      <span>Clean up {orphanCount} unlinked {orphanCount === 1 ? 'story' : 'stories'}</span>
                    </>
                  )}
                </button>
              </div>
            )}

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

        {/* Header: wordmark + current story on the left, mode tabs centred,
            status / settings / New on the right. Provider and model live in
            the composer; the Storybook MCP toggle lives behind the gear. */}
        <header className="sui-header">
          <div className="sui-header-left">
            <button
              type="button"
              className="sui-icon-btn"
              onClick={() => dispatch({ type: 'TOGGLE_SIDEBAR' })}
              aria-label={state.sidebarOpen ? 'Hide sidebar' : 'Show sidebar'}
              title={state.sidebarOpen ? 'Hide sidebar' : 'Show sidebar'}
            >
              {Icons.panelLeft}
            </button>
            <span className="sui-header-title">Story UI</span>
            {panelMode === 'chat' && (
              <div className="sui-menu-anchor">
                <button
                  type="button"
                  className="sui-title-chip"
                  aria-haspopup="menu"
                  aria-expanded={openMenu === 'title'}
                  onClick={() => setOpenMenu(m => (m === 'title' ? null : 'title'))}
                  title="Switch story"
                >
                  <span className="sui-title-chip-text">{state.activeTitle || 'New story'}</span>
                  {Icons.chevronDown}
                </button>
                {openMenu === 'title' && (
                  <div className="sui-menu sui-menu--stories" role="menu" aria-label="Stories">
                    <button type="button" role="menuitem" className="sui-menu-item" onClick={() => { setOpenMenu(null); handleNewChat(); }}>
                      {Icons.plus}
                      <span className="sui-menu-item-label">New story</span>
                    </button>
                    {sortedChats.length > 0 && <div className="sui-menu-sep" role="separator" />}
                    {sortedChats.map(chat => (
                      <button
                        key={chat.id}
                        type="button"
                        role="menuitemradio"
                        aria-checked={chat.id === state.activeChatId}
                        className={`sui-menu-item ${chat.id === state.activeChatId ? 'sui-menu-item--active' : ''}`}
                        onClick={() => { setOpenMenu(null); handleSelectChat(chat); }}
                      >
                        <span className="sui-menu-item-label">{chat.title}</span>
                        {chat.id === state.activeChatId && Icons.check}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>
          <div className="sui-header-center">
            <div className="sui-mode-toggle">
              <button
                type="button"
                className={`sui-mode-toggle-btn ${panelMode === 'chat' ? 'sui-mode-toggle-btn--active' : ''}`}
                aria-pressed={panelMode === 'chat'}
                onClick={() => { canvasModeRef.current = false; setPanelMode('chat'); try { localStorage.removeItem('__sui_panel_mode__'); } catch {} }}
              >Chat</button>
              {isReactFramework && (
                <button
                  type="button"
                  className={`sui-mode-toggle-btn ${panelMode === 'canvas' ? 'sui-mode-toggle-btn--active' : ''}`}
                  aria-pressed={panelMode === 'canvas'}
                  onClick={() => { canvasModeRef.current = true; setPanelMode('canvas'); try { localStorage.setItem('__sui_panel_mode__', 'canvas'); } catch {} }}
                >Voice Canvas</button>
              )}
              {/* Design context is the highest-authority input to generation, so
                  it gets a first-class home rather than living only on disk. */}
              <button
                type="button"
                className={`sui-mode-toggle-btn ${panelMode === 'context' ? 'sui-mode-toggle-btn--active' : ''}`}
                aria-pressed={panelMode === 'context'}
                title="Teach the generator how your design system works"
                onClick={() => { canvasModeRef.current = false; setPanelMode('context'); try { localStorage.setItem('__sui_panel_mode__', 'context'); } catch {} }}
              >Design Context</button>
            </div>
          </div>
          <div className="sui-header-right">
            <span
              className={`sui-status ${connected ? 'sui-status--ok' : 'sui-status--bad'}`}
              title={connected ? getConnectionDisplayText() : (state.connectionStatus.error || 'Server not running')}
            >
              <span className="sui-status-dot" aria-hidden="true" />
              {connected ? 'Connected' : 'Disconnected'}
            </span>
            <div className="sui-menu-anchor">
              <button
                type="button"
                className="sui-icon-btn"
                aria-label="Settings"
                title="Settings"
                aria-haspopup="menu"
                aria-expanded={openMenu === 'gear'}
                onClick={() => setOpenMenu(m => (m === 'gear' ? null : 'gear'))}
              >
                {Icons.gear}
              </button>
              {openMenu === 'gear' && (
                <div className="sui-menu sui-menu--right" role="menu" aria-label="Settings">
                  <div className="sui-menu-row" role="presentation">
                    <span>Server</span>
                    <span className="sui-menu-row-value">{connected ? getConnectionDisplayText() : (state.connectionStatus.error || 'Not connected')}</span>
                  </div>
                  {/* Storybook MCP toggle — only when the addon is detected */}
                  {state.storybookMcpAvailable && (
                    <label className="sui-menu-row sui-menu-row--toggle" title="Use Storybook MCP context for enhanced component generation">
                      <span>MCP context</span>
                      <span className="sui-toggle-switch">
                        <input
                          type="checkbox"
                          role="menuitemcheckbox"
                          checked={state.useStorybookMcp}
                          onChange={e => {
                            const enabled = e.target.checked;
                            dispatch({ type: 'SET_USE_STORYBOOK_MCP', payload: enabled });
                            saveStorybookMcpPref(enabled);
                          }}
                          aria-label="Use Storybook MCP context"
                        />
                        <span className="sui-toggle-slider" />
                      </span>
                    </label>
                  )}
                </div>
              )}
            </div>
            <button type="button" className="sui-button sui-button-default" onClick={handleNewChat}>
              {Icons.plus}
              <span>New</span>
            </button>
          </div>
        </header>

        {handoffFor && handoffStatus?.available && (
          <HandoffDialog
            apiBase={getApiBase()}
            status={handoffStatus}
            fileName={handoffFor.fileName}
            title={handoffFor.title}
            onClose={() => setHandoffFor(null)}
          />
        )}
        {panelMode === 'context' ? (
          <DesignContextPanel
            apiBase={getApiBase()}
            onContextChanged={() => {
              // Re-pull considerations so the very next generation uses the
              // edits the user just made, without a reload.
              (async () => {
                try {
                  const res = await apiFetch(CONSIDERATIONS_API());
                  if (res.ok) {
                    const data = await res.json();
                    dispatch({ type: 'SET_CONSIDERATIONS', payload: data.considerations || '' });
                  }
                } catch { /* keep the previous considerations */ }
              })();
            }}
          />
        ) : panelMode === 'canvas' ? (
          <VoiceCanvas
            ref={voiceCanvasRef}
            apiBase={getApiBase()}
            provider={state.selectedProvider}
            model={state.selectedModel}
            onSave={(result: { fileName: string; code: string; title: string }) => {
              // Track the saved story — use fileName stem as chatId (consistent with manifest entry IDs)
              const chatId = result.fileName.replace(/\.stories\.[a-z]+$/, '') || Date.now().toString();
              const newSession = {
                id: chatId,
                title: result.title,
                fileName: result.fileName,
                conversation: [
                  { role: 'user' as const, content: `[Voice Canvas] ${result.title}` },
                  { role: 'ai' as const, content: `Saved as ${result.fileName}` },
                ],
                lastUpdated: Date.now(),
              };
              persistChatToManifest(newSession).then(() => {
                dispatch({ type: 'SET_RECENT_CHATS', payload: loadChats() });
              });
              panelGeneratedStoryIds.current.add(chatId);
            }}
            onError={(error: string) => dispatch({ type: 'SET_ERROR', payload: error })}
          />
        ) : (
        <>
        {/* Chat area */}
        <section className="sui-chat-area">
          {state.error && <div className="sui-error" role="alert" style={{ margin: '24px' }}>{state.error}</div>}

          {state.conversation.length === 0 && !state.loading ? (
            <div className="sui-welcome">
              <h2 className="sui-welcome-greeting">{state.activeChatId ? 'No conversation yet' : 'What should we build?'}</h2>
              <p className="sui-welcome-subtitle">{state.activeChatId ? 'This story doesn\'t have a conversation yet. Describe a change below to start editing it.' : 'Describe a component and Story UI writes the story — using your design system.'}</p>
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
            <div className="sui-thread" role="log">
              {state.conversation.map((msg, i) => {
                const isLastMessage = i === state.conversation.length - 1;

                if (msg.role === 'user') {
                  return (
                    <article key={i} className="sui-turn sui-turn-user">
                      <div className="sui-bubble">
                        {msg.content}
                        {msg.attachedImages && msg.attachedImages.length > 0 && (
                          <div className="sui-message-images">
                            {msg.attachedImages.map(img => (
                              <img key={img.id} src={img.base64 ? `data:${img.mediaType};base64,${img.base64}` : img.preview} alt="Image attached to this message" className="sui-message-image" />
                            ))}
                          </div>
                        )}
                        {/* Reloaded from storage: the live attachments are gone, but
                            the persisted thumbnails still show what was referenced. */}
                        {!msg.attachedImages?.length && !!msg.thumbnails?.length && (
                          <div className="sui-message-images">
                            {msg.thumbnails.map((src, ti) => (
                              <img key={ti} src={src} alt="Image attached to this message" className="sui-message-image" />
                            ))}
                          </div>
                        )}
                      </div>
                    </article>
                  );
                }

                // An update turn puts its meta line under the prose ("Updated ·
                // Show changes · Verified"); a creation turn leads with it.
                // Messages restored from the manifest predate the flag, so fall
                // back to position: any reply after the first is an update.
                const aiOrdinal = state.conversation.slice(0, i).filter(m => m.role === 'ai').length;
                const isUpdateTurn = msg.isUpdate ?? aiOrdinal > 0;
                const steps = msg.steps ?? [];
                const secs = typeof msg.generationTimeMs === 'number' && msg.generationTimeMs > 0
                  ? `${Math.round(msg.generationTimeMs / 1000)}s`
                  : null;
                const stepsOpen = !!openSteps[i];
                const codeOpen = !!openCode[i];
                const menuOpen = typeof openMenu === 'object' && openMenu !== null && openMenu.turn === i;
                const showChanges = isUpdateTurn && !!msg.code;
                const hasMeta = !msg.isError && (steps.length > 0 || !!secs || !!msg.verification || showChanges);
                const canAct = !msg.isError && !state.loading && !!(msg.storyEntryId || msg.code || msg.storyFileName || state.activeChatId);
                const priorUser = isLastMessage
                  ? [...state.conversation.slice(0, i)].reverse().find(m => m.role === 'user')
                  : undefined;
                const toggleCode = () => setOpenCode(s => ({ ...s, [i]: !s[i] }));

                const metaRow = hasMeta && (
                  <div className="sui-turn-meta">
                    {steps.length > 0 ? (
                      <button
                        type="button"
                        className="sui-steps-toggle"
                        aria-expanded={stepsOpen}
                        onClick={() => setOpenSteps(s => ({ ...s, [i]: !s[i] }))}
                        title={stepsOpen ? 'Hide generation steps' : 'Show generation steps'}
                      >
                        <span className={`sui-steps-chevron ${stepsOpen ? 'open' : ''}`} aria-hidden="true">{Icons.chevronRight}</span>
                        <span>{steps.length} {steps.length === 1 ? 'step' : 'steps'}{secs ? ` · ${secs}` : ''}</span>
                      </button>
                    ) : secs ? (
                      <span className="sui-turn-meta-text">{isUpdateTurn ? `Updated in ${secs}` : secs}</span>
                    ) : showChanges ? (
                      <span className="sui-turn-meta-text">Updated the story</span>
                    ) : null}
                    {showChanges && (
                      <>
                        <span className="sui-turn-meta-dot" aria-hidden="true">·</span>
                        <button type="button" className="sui-link-btn" aria-expanded={codeOpen} onClick={toggleCode}>
                          {codeOpen ? 'Hide changes' : 'Show changes'}
                        </button>
                      </>
                    )}
                    {msg.verification && <VerificationBadge verification={msg.verification} />}
                  </div>
                );

                return (
                  <article key={i} className="sui-turn sui-turn-ai">
                    <div className="sui-avatar" aria-hidden="true">S</div>
                    <div className="sui-turn-body">
                      {!isUpdateTurn && metaRow}
                      {stepsOpen && steps.length > 0 && (
                        <ol className="sui-steps" aria-label="Generation steps">
                          {steps.map((s, si) => <li key={si}>{s}</li>)}
                        </ol>
                      )}
                      <div className="sui-turn-prose">{renderMarkdown(msg.content)}</div>
                      {isUpdateTurn && metaRow}
                      {codeOpen && msg.code && (
                        <div className="sui-code">
                          <pre><code>{msg.code}</code></pre>
                        </div>
                      )}
                      {msg.isError && msg.retryInput && isLastMessage && !state.loading && (
                        <div className="sui-turn-suggestions">
                          <button
                            type="button"
                            className="sui-chip sui-chip-retry"
                            onClick={() => handleSend(undefined, msg.retryInput)}
                          >
                            ↻ Try again
                          </button>
                        </div>
                      )}
                      {/* The story exists on disk but Storybook's watcher never
                          indexed it. Tell the user plainly and give them a way out
                          instead of rendering nothing. */}
                      {!msg.isError && !msg.storyEntryId && msg.storyIndexStalled && !state.loading && (
                        <div className="sui-index-stalled" aria-label="Story indexing notice">
                          <div className="sui-index-stalled-text">
                            Storybook hasn’t picked this story up yet. The file was written
                            {msg.storyIndexStalled.fileName ? ` to ${msg.storyIndexStalled.fileName}` : ''}, but
                            it isn’t in the story index — this usually means Storybook’s file watcher stopped.
                            Restart Storybook, then check again.
                          </div>
                          <button
                            type="button"
                            className="sui-chip"
                            onClick={async () => {
                              const found = await recheckStoryIndex(msg.storyIndexStalled!.storybookId);
                              if (!found) {
                                dispatch({ type: 'SET_ERROR', payload: 'Still not in the story index. Restart Storybook to pick up newly generated stories.' });
                              }
                            }}
                          >
                            Check again
                          </button>
                        </div>
                      )}
                      {/* Quiet action row: shown on hover, on focus-within for
                          keyboard users, and while its menu is open. */}
                      {canAct && (
                        <div className={`sui-turn-actions ${menuOpen ? 'is-open' : ''}`} aria-label="Story actions">
                          {msg.storyEntryId && (
                            <button
                              type="button"
                              className="sui-icon-btn"
                              title="Open in Storybook"
                              aria-label="Open in Storybook"
                              onClick={() => openStoryInStorybook(msg.storyEntryId!)}
                            >
                              {Icons.openExternal}
                            </button>
                          )}
                          {msg.code && (
                            <button
                              type="button"
                              className="sui-icon-btn"
                              title={codeOpen ? 'Hide code' : 'View code'}
                              aria-label={codeOpen ? 'Hide code' : 'View code'}
                              aria-pressed={codeOpen}
                              onClick={toggleCode}
                            >
                              {Icons.code}
                            </button>
                          )}
                          <div className="sui-menu-anchor">
                            <button
                              type="button"
                              className="sui-icon-btn"
                              title="More actions"
                              aria-label="More actions"
                              aria-haspopup="menu"
                              aria-expanded={menuOpen}
                              onClick={() => setOpenMenu(m => (typeof m === 'object' && m !== null && m.turn === i ? null : { turn: i }))}
                            >
                              {Icons.moreVertical}
                            </button>
                            {menuOpen && (
                              <div className="sui-menu" role="menu" aria-label="More actions">
                                {handoffStatus?.available && msg.storyFileName && (
                                  <button
                                    type="button"
                                    role="menuitem"
                                    className="sui-menu-item"
                                    title="Commit this story to a new branch for a product engineer"
                                    onClick={() => { setOpenMenu(null); setHandoffFor({ fileName: msg.storyFileName!, title: msg.storyTitle || state.activeTitle || 'Story' }); }}
                                  >
                                    Hand off
                                  </button>
                                )}
                                {msg.code && (
                                  <button type="button" role="menuitem" className="sui-menu-item" onClick={() => { setOpenMenu(null); copyCode(i, msg.code!); }}>
                                    Copy code
                                  </button>
                                )}
                                {priorUser && (
                                  <button type="button" role="menuitem" className="sui-menu-item" onClick={() => { setOpenMenu(null); handleSend(undefined, priorUser.content); }}>
                                    Regenerate
                                  </button>
                                )}
                                {state.activeChatId && (
                                  <button
                                    type="button"
                                    role="menuitem"
                                    className="sui-menu-item"
                                    onClick={() => {
                                      setOpenMenu(null);
                                      // Rename edits inline in the sidebar list, so make sure it is visible.
                                      dispatch({ type: 'SET_SIDEBAR', payload: true });
                                      handleStartRename(state.activeChatId!, state.activeTitle);
                                    }}
                                  >
                                    Rename story
                                  </button>
                                )}
                                {state.activeChatId && (
                                  <>
                                    <div className="sui-menu-sep" role="separator" />
                                    <button
                                      type="button"
                                      role="menuitem"
                                      className="sui-menu-item sui-menu-item--danger"
                                      onClick={() => { setOpenMenu(null); handleDeleteChat(state.activeChatId!); }}
                                    >
                                      Delete story
                                    </button>
                                  </>
                                )}
                              </div>
                            )}
                          </div>
                          {copiedTurn === i && <span className="sui-turn-meta-text" role="status">Copied</span>}
                        </div>
                      )}
                      {!msg.isError && isLastMessage && !state.loading && (msg.suggestions?.length ?? 0) > 0 && (
                        <div className="sui-turn-suggestions" aria-label="Suggested follow-ups">
                          {msg.suggestions!.map((suggestion, si) => (
                            <button
                              key={si}
                              type="button"
                              className="sui-chip sui-chip-suggestion"
                              onClick={() => handleSend(undefined, suggestion)}
                            >
                              {suggestion}
                            </button>
                          ))}
                        </div>
                      )}
                    </div>
                  </article>
                );
              })}
              {state.loading && (
                <div className="sui-turn sui-turn-ai">
                  <div className="sui-avatar" aria-hidden="true">S</div>
                  <div className="sui-turn-body">
                    {state.streamingState ? <ProgressIndicator streamingState={state.streamingState} /> : (
                      <div className="sui-progress">
                        <span className="sui-progress-label">Generating your story<span className="sui-loading" /></span>
                      </div>
                    )}
                  </div>
                </div>
              )}
              <div ref={chatEndRef} />
            </div>
          )}
        </section>

        {/* Composer: bordered card; the prompt on top, controls underneath —
            attach, voice, model chip, and the round send at the right. */}
        <div className="sui-composer-area">
          <form onSubmit={handleSend} className="sui-composer">
            <input ref={fileInputRef} type="file" accept={ACCEPT} multiple style={{ display: 'none' }} onChange={handleFileSelect} />
            {state.attachedDocs.length > 0 && (
              <div className="sui-doc-chips" aria-label="Attached documents">
                {state.attachedDocs.map(d => (
                  <span key={d.id} className="sui-doc-chip">
                    {Icons.file} {d.name} <span className="sui-doc-chip-size">{formatBytes(d.size)}</span>
                    <button type="button" className="sui-doc-chip-remove" onClick={() => dispatch({ type: 'REMOVE_ATTACHED_DOC', payload: d.id })} aria-label={`Remove ${d.name}`}>{Icons.x}</button>
                  </span>
                ))}
              </div>
            )}
            {state.attachedImages.length > 0 && (
              <div className="sui-image-previews">
                <span className="sui-image-preview-label">{Icons.image} {state.attachedImages.length} image{state.attachedImages.length > 1 ? 's' : ''}</span>
                {state.attachedImages.map(img => (
                  <div key={img.id} className="sui-image-preview-item">
                    <img src={img.preview} alt="Attached image preview" className="sui-image-preview-thumb" />
                    <button type="button" className="sui-image-preview-remove" onClick={() => removeAttachedImage(img.id)} aria-label="Remove attached image">{Icons.x}</button>
                  </div>
                ))}
              </div>
            )}
            <textarea
              ref={inputRef}
              rows={1}
              className="sui-composer-field"
              value={state.input}
              onChange={e => dispatch({ type: 'SET_INPUT', payload: e.target.value })}
              onKeyDown={e => {
                // Submit on Enter, newline on Shift+Enter
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault();
                  if (!state.loading && (state.input.trim() || state.attachedImages.length > 0 || state.attachedDocs.length > 0)) {
                    handleSend(e as unknown as React.FormEvent);
                  }
                }
              }}
              onPaste={handlePaste}
              placeholder={composerPlaceholder}
              aria-label="Prompt"
            />
            <div className="sui-composer-row">
              <button
                type="button"
                className="sui-icon-btn"
                onClick={() => fileInputRef.current?.click()}
                disabled={state.loading || state.attachedImages.length >= MAX_IMAGES}
                aria-label="Attach images"
                title="Attach images"
              >
                {Icons.plus}
              </button>
              <VoiceControls
                onTranscript={handleVoiceTranscript}
                onCommand={handleVoiceCommand}
                onSubmit={handleVoiceSubmit}
                onListeningChange={(listening) => { voiceModeActiveRef.current = listening; }}
                disabled={state.loading}
              />
              {connected && state.availableProviders.length > 0 && (
                <div className="sui-menu-anchor">
                  <button
                    type="button"
                    className="sui-model-chip"
                    aria-haspopup="menu"
                    aria-expanded={openMenu === 'model'}
                    onClick={() => setOpenMenu(m => (m === 'model' ? null : 'model'))}
                    title="Choose provider and model"
                  >
                    <span>{state.selectedModel ? getModelDisplayName(state.selectedModel) : 'Model'}</span>
                    {Icons.chevronDown}
                  </button>
                  {openMenu === 'model' && (
                    <div className="sui-menu sui-menu--up" role="menu" aria-label="Provider and model">
                      {state.availableProviders.map(p => (
                        <div key={p.type} className="sui-menu-group" role="group" aria-label={p.name}>
                          <div className="sui-menu-heading">{p.name}</div>
                          {p.models.map(model => {
                            const selected = p.type === state.selectedProvider && model === state.selectedModel;
                            return (
                              <button
                                key={model}
                                type="button"
                                role="menuitemradio"
                                aria-checked={selected}
                                className={`sui-menu-item ${selected ? 'sui-menu-item--active' : ''}`}
                                onClick={() => {
                                  dispatch({ type: 'SET_SELECTED_PROVIDER', payload: p.type });
                                  dispatch({ type: 'SET_SELECTED_MODEL', payload: model });
                                  setOpenMenu(null);
                                }}
                              >
                                <span className="sui-menu-item-label">{getModelDisplayName(model)}</span>
                                {selected && Icons.check}
                              </button>
                            );
                          })}
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}
              <span className="sui-composer-spacer" />
              <button type="submit" className="sui-composer-send" disabled={state.loading || (!state.input.trim() && state.attachedImages.length === 0)} aria-label="Send">
                {Icons.send}
              </button>
            </div>
          </form>
        </div>
        </>
        )}
      </main>
    </div>
  );
}

export default StoryUIPanel;
export { StoryUIPanel };
