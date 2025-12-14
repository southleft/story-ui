# StoryUIPanel Complete Refactoring Plan

## Executive Summary

Transform the 3,200-line monolithic `StoryUIPanel.tsx` into a modern, maintainable component architecture using:
- **CSS Layers** for cascade management without `!important`
- **CSS Custom Properties** for theming
- **Component Extraction** to reduce complexity
- **State Management** via `useReducer` pattern
- **Accessibility** with ARIA attributes and semantic HTML
- **Performance** with CSS containment and transform-based animations

---

## 1. File Structure

```
templates/StoryUI/
├── StoryUIPanel.tsx                    # Main orchestrator (200-300 lines)
├── StoryUIPanel.css                    # All styles with CSS layers
├── StoryUIPanel.mdx                    # Existing wrapper (no changes)
├── manager.tsx                          # Existing (no changes)
├── index.tsx                            # Existing (no changes)
│
├── components/
│   ├── Sidebar/
│   │   ├── Sidebar.tsx                 # Sidebar container
│   │   ├── ChatList.tsx                # Recent chats list
│   │   ├── ChatItem.tsx                # Individual chat item
│   │   ├── OrphanStories.tsx           # Generated files section
│   │   └── OrphanStoryItem.tsx         # Individual orphan story
│   │
│   ├── ChatArea/
│   │   ├── ChatArea.tsx                # Main chat container
│   │   ├── ChatHeader.tsx              # MCP status + provider/model selectors
│   │   ├── MessageList.tsx             # Conversation display with scroll
│   │   ├── MessageBubble.tsx           # User/AI message rendering
│   │   ├── StreamingIndicator.tsx      # Progress bars during generation
│   │   └── ChatInput.tsx               # Prompt input + image upload + send button
│   │
│   ├── Common/
│   │   ├── StatusIndicator.tsx         # MCP connection status dot
│   │   ├── ModelSelector.tsx           # Provider + model dropdown
│   │   ├── IconButton.tsx              # Reusable icon button
│   │   └── ImagePreview.tsx            # Attached image thumbnail
│   │
│   └── MarkdownRenderer/
│       └── MarkdownRenderer.tsx        # Existing renderMarkdown logic
│
├── hooks/
│   ├── useChatState.ts                 # Chat state reducer + actions
│   ├── useProviders.ts                 # Provider/model fetching
│   ├── useConnectionStatus.ts          # MCP server health check
│   ├── useImageUpload.ts               # Image attachment logic
│   └── useStreamingGeneration.ts       # SSE streaming handler
│
├── types/
│   └── index.ts                        # All TypeScript interfaces
│
└── utils/
    ├── localStorage.ts                 # Chat persistence
    ├── storyNavigation.ts              # titleToStoryPath, navigateToNewStory
    └── apiHelpers.ts                   # getApiBaseUrl, fetch wrappers
```

---

## 2. Component Breakdown

### 2.1 Main Orchestrator: `StoryUIPanel.tsx`

**Responsibilities**:
- Compose all sub-components
- Provide context via `ChatStateProvider`
- Load initial data (chats, providers)
- Inject global stylesheet once

**Size**: ~200-300 lines

```tsx
import React, { useEffect } from 'react';
import './StoryUIPanel.css';
import Sidebar from './components/Sidebar/Sidebar';
import ChatArea from './components/ChatArea/ChatArea';
import { ChatStateProvider } from './hooks/useChatState';
import { injectStylesheet } from './utils/styleInjection';

export default function StoryUIPanel() {
  useEffect(() => {
    injectStylesheet(); // Inject once on mount
  }, []);

  return (
    <ChatStateProvider>
      <div className="story-ui-panel">
        <Sidebar />
        <ChatArea />
      </div>
    </ChatStateProvider>
  );
}
```

---

### 2.2 Sidebar Components

#### **`Sidebar.tsx`** (~150 lines)
- Container with collapse/expand state
- Renders ChatList + OrphanStories
- Collapse button
- New Chat button

```tsx
interface SidebarProps {}

export default function Sidebar() {
  const { state, dispatch } = useChatState();
  const { sidebarOpen } = state;

  return (
    <aside
      className={`sidebar ${sidebarOpen ? '' : 'sidebar--collapsed'}`}
      aria-label="Chat history"
    >
      {sidebarOpen && (
        <>
          <header className="sidebar__header">
            <IconButton
              icon="collapse"
              label="Collapse sidebar"
              onClick={() => dispatch({ type: 'TOGGLE_SIDEBAR' })}
            />
            <IconButton
              icon="new-chat"
              label="New Chat"
              onClick={() => dispatch({ type: 'NEW_CHAT' })}
            />
          </header>
          <ChatList />
          <OrphanStories />
        </>
      )}
      {!sidebarOpen && (
        <IconButton
          icon="expand"
          label="Expand sidebar"
          onClick={() => dispatch({ type: 'TOGGLE_SIDEBAR' })}
        />
      )}
    </aside>
  );
}
```

#### **`ChatList.tsx`** (~80 lines)
- Maps over `recentChats`
- Renders ChatItem components
- Section header

```tsx
export default function ChatList() {
  const { state } = useChatState();
  const { recentChats } = state;

  if (recentChats.length === 0) return null;

  return (
    <section className="chat-list" aria-label="Recent chats">
      <h2 className="chat-list__header">Recent Chats</h2>
      {recentChats.map(chat => (
        <ChatItem key={chat.id} chat={chat} />
      ))}
    </section>
  );
}
```

#### **`ChatItem.tsx`** (~60 lines)
- Individual chat entry
- Active state styling
- Delete button
- Time display

```tsx
interface ChatItemProps {
  chat: ChatSession;
}

export default function ChatItem({ chat }: ChatItemProps) {
  const { state, dispatch } = useChatState();
  const isActive = state.activeChatId === chat.id;

  return (
    <article
      className={`chat-item ${isActive ? 'chat-item--active' : ''}`}
      onClick={() => dispatch({ type: 'SELECT_CHAT', payload: chat })}
      role="button"
      tabIndex={0}
      aria-label={`Chat: ${chat.title}`}
      aria-current={isActive ? 'true' : undefined}
    >
      <h3 className="chat-item__title">{chat.title}</h3>
      <time className="chat-item__time" dateTime={new Date(chat.lastUpdated).toISOString()}>
        {formatTime(chat.lastUpdated)}
      </time>
      <IconButton
        className="chat-item__delete"
        icon="delete"
        label="Delete chat"
        onClick={(e) => {
          e.stopPropagation();
          dispatch({ type: 'DELETE_CHAT', payload: chat.id });
        }}
      />
    </article>
  );
}
```

#### **`OrphanStories.tsx`** (~120 lines)
- Generated files section
- Select all checkbox
- Bulk delete / Clear all buttons
- Maps OrphanStoryItem

```tsx
export default function OrphanStories() {
  const { state, dispatch } = useChatState();
  const { orphanStories, selectedStoryIds, isBulkDeleting } = state;

  if (orphanStories.length === 0) return null;

  return (
    <section className="orphan-stories" aria-label="Generated story files">
      <header className="orphan-stories__header">
        <label className="orphan-stories__select-all">
          <input
            type="checkbox"
            checked={selectedStoryIds.size === orphanStories.length}
            onChange={() => dispatch({ type: 'TOGGLE_SELECT_ALL' })}
            aria-label="Select all generated files"
          />
          <span>Generated Files ({orphanStories.length})</span>
        </label>
      </header>

      {selectedStoryIds.size > 0 && (
        <div className="orphan-stories__actions">
          <button
            onClick={() => dispatch({ type: 'BULK_DELETE' })}
            disabled={isBulkDeleting}
            className="btn btn--danger"
          >
            {isBulkDeleting ? 'Deleting...' : `Delete (${selectedStoryIds.size})`}
          </button>
        </div>
      )}

      <button
        onClick={() => dispatch({ type: 'CLEAR_ALL' })}
        disabled={isBulkDeleting}
        className="btn btn--secondary"
      >
        Clear All Stories
      </button>

      <div className="orphan-stories__list">
        {orphanStories.map(story => (
          <OrphanStoryItem key={story.id} story={story} />
        ))}
      </div>
    </section>
  );
}
```

---

### 2.3 ChatArea Components

#### **`ChatArea.tsx`** (~100 lines)
- Main content area
- Renders ChatHeader, MessageList, ChatInput
- Handles drag-and-drop for image upload

```tsx
export default function ChatArea() {
  const { state, dispatch } = useChatState();
  const { isDragging } = useImageUpload();

  return (
    <main
      className={`chat-area ${isDragging ? 'chat-area--dragging' : ''}`}
      aria-label="Chat conversation"
    >
      <ChatHeader />
      <MessageList />
      <ChatInput />
    </main>
  );
}
```

#### **`ChatHeader.tsx`** (~80 lines)
- MCP server status indicator
- Provider selector
- Model selector
- Active chat title

```tsx
export default function ChatHeader() {
  const { state } = useChatState();
  const { connectionStatus, activeTitle } = state;
  const { providers, selectedProvider, selectedModel, setProvider, setModel } = useProviders();

  return (
    <header className="chat-header">
      <div className="chat-header__title">
        <h1>{activeTitle || 'Story UI Generator'}</h1>
      </div>
      <div className="chat-header__controls">
        <StatusIndicator status={connectionStatus} />
        <ModelSelector
          providers={providers}
          selectedProvider={selectedProvider}
          selectedModel={selectedModel}
          onProviderChange={setProvider}
          onModelChange={setModel}
        />
      </div>
    </header>
  );
}
```

#### **`MessageList.tsx`** (~100 lines)
- Scrollable conversation area
- Auto-scroll to bottom
- Renders MessageBubble components
- ARIA live region for accessibility

```tsx
export default function MessageList() {
  const { state } = useChatState();
  const { conversation } = state;
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    scrollRef.current?.scrollTo({
      top: scrollRef.current.scrollHeight,
      behavior: 'smooth'
    });
  }, [conversation]);

  return (
    <div
      ref={scrollRef}
      className="message-list"
      role="log"
      aria-live="polite"
      aria-atomic="false"
    >
      {conversation.map((msg, idx) => (
        <MessageBubble key={idx} message={msg} />
      ))}
    </div>
  );
}
```

#### **`MessageBubble.tsx`** (~120 lines)
- User vs AI styling
- Markdown rendering for AI messages
- Attached images display
- Streaming indicator integration

```tsx
interface MessageBubbleProps {
  message: Message;
}

export default function MessageBubble({ message }: MessageBubbleProps) {
  const isUser = message.role === 'user';

  return (
    <article
      className={`message ${isUser ? 'message--user' : 'message--ai'}`}
      aria-label={isUser ? 'Your message' : 'AI response'}
    >
      {message.attachedImages && message.attachedImages.length > 0 && (
        <div className="message__images">
          {message.attachedImages.map(img => (
            <ImagePreview key={img.id} image={img} />
          ))}
        </div>
      )}

      {isUser ? (
        <p>{message.content}</p>
      ) : (
        <MarkdownRenderer content={message.content} />
      )}

      {message.isStreaming && message.streamingData && (
        <StreamingIndicator state={message.streamingData} />
      )}
    </article>
  );
}
```

#### **`StreamingIndicator.tsx`** (~150 lines)
- Progress bars for generation phases
- Validation feedback display
- Retry attempt indicator
- Component/layout choices summary

```tsx
interface StreamingIndicatorProps {
  state: StreamingState;
}

export default function StreamingIndicator({ state }: StreamingIndicatorProps) {
  const { progress, validation, retry, completion } = state;

  return (
    <div className="streaming-indicator" aria-live="polite">
      {progress && (
        <div className="streaming-indicator__progress">
          <div className="progress-bar">
            <div
              className="progress-bar__fill"
              style={{ width: `${(progress.step / progress.totalSteps) * 100}%` }}
              role="progressbar"
              aria-valuenow={progress.step}
              aria-valuemin={0}
              aria-valuemax={progress.totalSteps}
            />
          </div>
          <p className="streaming-indicator__message">{progress.message}</p>
        </div>
      )}

      {validation && !validation.isValid && (
        <div className="streaming-indicator__validation">
          <h4>Validation Errors:</h4>
          <ul>
            {validation.errors.map((err, i) => (
              <li key={i}>{err}</li>
            ))}
          </ul>
        </div>
      )}

      {retry && (
        <div className="streaming-indicator__retry">
          Retry attempt {retry.attempt} of {retry.maxAttempts}...
        </div>
      )}

      {completion && (
        <div className="streaming-indicator__completion">
          <p>{completion.summary.description}</p>
        </div>
      )}
    </div>
  );
}
```

#### **`ChatInput.tsx`** (~200 lines)
- Textarea for prompt input
- Image upload button + file input
- Attached images preview with remove
- Send button
- Loading state handling

```tsx
export default function ChatInput() {
  const { state, dispatch } = useChatState();
  const { input, loading, attachedImages } = state;
  const { uploadImage, removeImage } = useImageUpload();
  const { generateStory } = useStreamingGeneration();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!input.trim() && attachedImages.length === 0) return;

    await generateStory(input, attachedImages);
  };

  return (
    <form
      className="chat-input"
      onSubmit={handleSubmit}
      aria-label="Message input form"
    >
      {attachedImages.length > 0 && (
        <div className="chat-input__images">
          {attachedImages.map(img => (
            <ImagePreview
              key={img.id}
              image={img}
              onRemove={() => removeImage(img.id)}
            />
          ))}
        </div>
      )}

      <div className="chat-input__controls">
        <label className="chat-input__upload">
          <input
            type="file"
            accept="image/*"
            multiple
            onChange={(e) => uploadImage(e.target.files)}
            aria-label="Attach images"
          />
          <svg>...</svg>
        </label>

        <textarea
          value={input}
          onChange={(e) => dispatch({ type: 'SET_INPUT', payload: e.target.value })}
          placeholder="Describe your component..."
          rows={3}
          disabled={loading}
          aria-label="Component description"
        />

        <button
          type="submit"
          disabled={loading || (!input.trim() && attachedImages.length === 0)}
          className="btn btn--primary"
          aria-label="Send message"
        >
          {loading ? 'Generating...' : 'Send'}
        </button>
      </div>
    </form>
  );
}
```

---

## 3. CSS Architecture

### 3.1 CSS Layer Organization

```css
/* StoryUIPanel.css */

/* Layer definitions - order determines cascade priority */
@layer reset, base, theme, layout, components, utilities, overrides;

/* ===== LAYER: RESET ===== */
/* Normalize and reset Storybook's default styles */
@layer reset {
  .story-ui-panel,
  .story-ui-panel * {
    box-sizing: border-box;
    margin: 0;
    padding: 0;
  }

  .story-ui-panel button {
    border: none;
    background: none;
    cursor: pointer;
    font: inherit;
  }
}

/* ===== LAYER: BASE ===== */
/* Base typography and element defaults */
@layer base {
  .story-ui-panel {
    font-family: var(--font-family-base);
    font-size: var(--font-size-base);
    line-height: var(--line-height-base);
    color: var(--color-text-primary);
    background: var(--color-bg-primary);
  }
}

/* ===== LAYER: THEME ===== */
/* CSS Custom Properties for theming */
@layer theme {
  .story-ui-panel {
    /* Color scheme */
    color-scheme: light dark;

    /* Typography */
    --font-family-base: "IBM Plex Sans", -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
    --font-family-mono: ui-monospace, SFMono-Regular, "SF Mono", Menlo, Consolas, monospace;
    --font-size-xs: 11px;
    --font-size-sm: 13px;
    --font-size-base: 14px;
    --font-size-lg: 16px;
    --font-size-xl: 24px;
    --line-height-base: 1.5;
    --line-height-tight: 1.45;

    /* Spacing */
    --space-xs: 4px;
    --space-sm: 8px;
    --space-md: 16px;
    --space-lg: 24px;
    --space-xl: 32px;

    /* Colors - Light mode */
    --color-bg-primary: #f8fafc;
    --color-bg-secondary: #ffffff;
    --color-bg-sidebar: #1e293b;
    --color-text-primary: #1f2937;
    --color-text-secondary: #64748b;
    --color-text-inverse: #e2e8f0;
    --color-border: rgba(0, 0, 0, 0.08);
    --color-brand: #3b82f6;
    --color-brand-hover: #2563eb;
    --color-success: #22c55e;
    --color-error: #ef4444;
    --color-warning: #f59e0b;

    /* Shadows */
    --shadow-sm: 0 1px 3px rgba(0, 0, 0, 0.08);
    --shadow-md: 0 2px 8px rgba(59, 130, 246, 0.25);
    --shadow-lg: 0 4px 12px rgba(59, 130, 246, 0.4);

    /* Border radius */
    --radius-sm: 4px;
    --radius-md: 6px;
    --radius-lg: 8px;
    --radius-xl: 18px;

    /* Transitions */
    --transition-fast: 0.15s ease;
    --transition-base: 0.2s ease;

    /* Z-index */
    --z-dropdown: 100;
    --z-modal: 200;
    --z-tooltip: 300;

    /* Layout */
    --sidebar-width: 280px;
    --sidebar-collapsed-width: 0px;
    --header-height: 72px;
    --input-height: auto;

    /* Touch targets */
    --touch-target-min: 44px;
  }

  /* Dark mode overrides */
  @media (prefers-color-scheme: dark) {
    .story-ui-panel {
      --color-bg-primary: #0f172a;
      --color-bg-secondary: #1e293b;
      --color-text-primary: #e2e8f0;
      --color-text-secondary: #94a3b8;
      --color-border: rgba(255, 255, 255, 0.1);
    }
  }
}

/* ===== LAYER: LAYOUT ===== */
/* Page structure and grid */
@layer layout {
  .story-ui-panel {
    display: flex;
    height: 100vh;
    contain: layout style paint; /* CSS containment for performance */
  }

  .sidebar {
    width: var(--sidebar-width);
    background: var(--color-bg-sidebar);
    color: var(--color-text-inverse);
    transition: width var(--transition-base);
    display: flex;
    flex-direction: column;
    overflow: hidden;
  }

  .sidebar--collapsed {
    width: var(--sidebar-collapsed-width);
  }

  .chat-area {
    flex: 1;
    display: flex;
    flex-direction: column;
    overflow: hidden;
  }

  .chat-header {
    height: var(--header-height);
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: var(--space-md);
    border-bottom: 1px solid var(--color-border);
    background: var(--color-bg-secondary);
  }

  .message-list {
    flex: 1;
    overflow-y: auto;
    padding: var(--space-md);
    scroll-behavior: smooth;
  }

  .chat-input {
    padding: var(--space-md);
    background: var(--color-bg-secondary);
    border-top: 1px solid var(--color-border);
  }
}

/* ===== LAYER: COMPONENTS ===== */
/* Individual component styles */
@layer components {
  /* Buttons */
  .btn {
    min-height: var(--touch-target-min);
    min-width: var(--touch-target-min);
    padding: var(--space-sm) var(--space-md);
    border-radius: var(--radius-md);
    font-weight: 600;
    transition: all var(--transition-fast);
    display: inline-flex;
    align-items: center;
    gap: var(--space-sm);
  }

  .btn--primary {
    background: var(--color-brand);
    color: white;
    box-shadow: var(--shadow-md);
  }

  .btn--primary:hover:not(:disabled) {
    background: var(--color-brand-hover);
    box-shadow: var(--shadow-lg);
    transform: translateY(-1px); /* GPU-accelerated */
  }

  .btn--danger {
    background: rgba(239, 68, 68, 0.15);
    color: #f87171;
    border: 1px solid rgba(239, 68, 68, 0.3);
  }

  .btn:disabled {
    opacity: 0.6;
    cursor: not-allowed;
  }

  /* Chat Items */
  .chat-item {
    padding: var(--space-sm) var(--space-md);
    margin-bottom: var(--space-xs);
    border-radius: var(--radius-md);
    background: rgba(255, 255, 255, 0.08);
    cursor: pointer;
    transition: background var(--transition-fast);
    position: relative;
  }

  .chat-item:hover {
    background: rgba(255, 255, 255, 0.12);
  }

  .chat-item--active {
    background: rgba(59, 130, 246, 0.2);
    border-left: 3px solid var(--color-brand);
  }

  .chat-item__title {
    font-size: var(--font-size-base);
    font-weight: 600;
    margin-bottom: var(--space-xs);
  }

  .chat-item__time {
    font-size: var(--font-size-xs);
    color: var(--color-text-secondary);
  }

  .chat-item__delete {
    position: absolute;
    top: var(--space-sm);
    right: var(--space-sm);
    opacity: 0;
    transition: opacity var(--transition-fast);
  }

  .chat-item:hover .chat-item__delete,
  .chat-item:focus-within .chat-item__delete {
    opacity: 1;
  }

  /* Message Bubbles */
  .message {
    margin-bottom: var(--space-md);
    padding: 12px 16px;
    border-radius: var(--radius-xl);
    max-width: 85%;
    animation: fadeIn 0.2s ease;
  }

  @keyframes fadeIn {
    from { opacity: 0; transform: translateY(8px); }
    to { opacity: 1; transform: translateY(0); }
  }

  .message--user {
    background: rgba(59, 130, 246, 0.12);
    color: var(--color-text-primary);
    border: 1px solid rgba(59, 130, 246, 0.2);
    border-radius: var(--radius-xl) var(--radius-xl) var(--radius-sm) var(--radius-xl);
    margin-left: auto;
  }

  .message--ai {
    background: var(--color-bg-secondary);
    color: var(--color-text-primary);
    border: 1px solid var(--color-border);
    border-radius: var(--radius-xl) var(--radius-xl) var(--radius-xl) var(--radius-sm);
    box-shadow: var(--shadow-sm);
  }

  /* Status Indicator */
  .status-indicator {
    display: flex;
    align-items: center;
    gap: var(--space-sm);
    font-size: var(--font-size-sm);
  }

  .status-indicator__dot {
    width: 8px;
    height: 8px;
    border-radius: 50%;
    background: var(--color-success);
    animation: pulse 2s infinite;
  }

  @keyframes pulse {
    0%, 100% { opacity: 1; }
    50% { opacity: 0.5; }
  }

  .status-indicator--disconnected .status-indicator__dot {
    background: var(--color-error);
  }

  /* Progress Bar */
  .progress-bar {
    height: 4px;
    background: rgba(0, 0, 0, 0.1);
    border-radius: var(--radius-sm);
    overflow: hidden;
  }

  .progress-bar__fill {
    height: 100%;
    background: var(--color-brand);
    transition: width var(--transition-base);
  }

  /* Image Preview */
  .image-preview {
    position: relative;
    width: 80px;
    height: 80px;
    border-radius: var(--radius-md);
    overflow: hidden;
    border: 1px solid var(--color-border);
  }

  .image-preview img {
    width: 100%;
    height: 100%;
    object-fit: cover;
  }

  .image-preview__remove {
    position: absolute;
    top: var(--space-xs);
    right: var(--space-xs);
    background: rgba(0, 0, 0, 0.6);
    color: white;
    border-radius: 50%;
    width: 20px;
    height: 20px;
    display: flex;
    align-items: center;
    justify-content: center;
  }
}

/* ===== LAYER: UTILITIES ===== */
/* Helper classes */
@layer utilities {
  .sr-only {
    position: absolute;
    width: 1px;
    height: 1px;
    padding: 0;
    margin: -1px;
    overflow: hidden;
    clip: rect(0, 0, 0, 0);
    white-space: nowrap;
    border-width: 0;
  }

  .truncate {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
}

/* ===== LAYER: OVERRIDES ===== */
/* Last resort overrides for Storybook conflicts (NO !important needed) */
@layer overrides {
  .story-ui-panel a {
    color: var(--color-brand);
    text-decoration: none;
  }

  .story-ui-panel code {
    font-family: var(--font-family-mono);
    font-size: var(--font-size-sm);
    background: rgba(0, 0, 0, 0.06);
    padding: 2px 6px;
    border-radius: var(--radius-sm);
  }
}
```

**Key CSS Benefits**:
- **No `!important`** - Layers provide cascade control
- **Themeable** - Custom properties for easy design changes
- **Accessible** - Semantic focus states, prefers-color-scheme
- **Performant** - CSS containment, transform animations
- **Maintainable** - Organized by concern, not by component

---

## 4. State Management

### 4.1 State Reducer Pattern

**Problem**: 22 `useState` hooks create complex state update logic.

**Solution**: Single `useReducer` with typed actions.

```tsx
// hooks/useChatState.ts

import { createContext, useContext, useReducer, ReactNode } from 'react';

// State interface
interface ChatState {
  // UI state
  sidebarOpen: boolean;
  showCode: boolean;
  isDragging: boolean;
  loading: boolean;
  isBulkDeleting: boolean;

  // Data state
  conversation: Message[];
  recentChats: ChatSession[];
  orphanStories: OrphanStory[];
  activeChatId: string | null;
  activeTitle: string;

  // Input state
  input: string;
  attachedImages: AttachedImage[];
  selectedStoryIds: Set<string>;

  // Provider state
  availableProviders: ProviderInfo[];
  selectedProvider: string;
  selectedModel: string;

  // Connection state
  connectionStatus: { connected: boolean; error?: string };
  streamingState: StreamingState | null;
  error: string | null;

  // Config state
  considerations: string;
}

// Action types
type ChatAction =
  | { type: 'TOGGLE_SIDEBAR' }
  | { type: 'SET_SIDEBAR_OPEN'; payload: boolean }
  | { type: 'NEW_CHAT' }
  | { type: 'SELECT_CHAT'; payload: ChatSession }
  | { type: 'DELETE_CHAT'; payload: string }
  | { type: 'SET_INPUT'; payload: string }
  | { type: 'ADD_MESSAGE'; payload: Message }
  | { type: 'UPDATE_STREAMING'; payload: StreamingState }
  | { type: 'SET_LOADING'; payload: boolean }
  | { type: 'SET_ERROR'; payload: string | null }
  | { type: 'SET_PROVIDERS'; payload: ProviderInfo[] }
  | { type: 'SET_PROVIDER'; payload: string }
  | { type: 'SET_MODEL'; payload: string }
  | { type: 'ATTACH_IMAGE'; payload: AttachedImage }
  | { type: 'REMOVE_IMAGE'; payload: string }
  | { type: 'TOGGLE_SELECT_ALL' }
  | { type: 'TOGGLE_STORY_SELECTION'; payload: string }
  | { type: 'BULK_DELETE' }
  | { type: 'CLEAR_ALL' }
  | { type: 'SET_ORPHAN_STORIES'; payload: OrphanStory[] }
  | { type: 'SET_CONNECTION_STATUS'; payload: { connected: boolean; error?: string } }
  | { type: 'SET_IS_DRAGGING'; payload: boolean };

// Initial state
const initialState: ChatState = {
  sidebarOpen: true,
  showCode: true,
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
};

// Reducer function
function chatReducer(state: ChatState, action: ChatAction): ChatState {
  switch (action.type) {
    case 'TOGGLE_SIDEBAR':
      return { ...state, sidebarOpen: !state.sidebarOpen };

    case 'SET_SIDEBAR_OPEN':
      return { ...state, sidebarOpen: action.payload };

    case 'NEW_CHAT':
      return {
        ...state,
        activeChatId: null,
        activeTitle: '',
        conversation: [],
        attachedImages: [],
        input: '',
        streamingState: null,
      };

    case 'SELECT_CHAT':
      return {
        ...state,
        activeChatId: action.payload.id,
        activeTitle: action.payload.title,
        conversation: action.payload.conversation,
        attachedImages: [],
        input: '',
      };

    case 'DELETE_CHAT': {
      const updatedChats = state.recentChats.filter(c => c.id !== action.payload);
      return {
        ...state,
        recentChats: updatedChats,
        ...(state.activeChatId === action.payload ? {
          activeChatId: null,
          activeTitle: '',
          conversation: [],
        } : {}),
      };
    }

    case 'SET_INPUT':
      return { ...state, input: action.payload };

    case 'ADD_MESSAGE':
      return { ...state, conversation: [...state.conversation, action.payload] };

    case 'UPDATE_STREAMING':
      return { ...state, streamingState: action.payload };

    case 'SET_LOADING':
      return { ...state, loading: action.payload };

    case 'SET_ERROR':
      return { ...state, error: action.payload };

    case 'SET_PROVIDERS':
      return { ...state, availableProviders: action.payload };

    case 'SET_PROVIDER':
      return { ...state, selectedProvider: action.payload };

    case 'SET_MODEL':
      return { ...state, selectedModel: action.payload };

    case 'ATTACH_IMAGE':
      return { ...state, attachedImages: [...state.attachedImages, action.payload] };

    case 'REMOVE_IMAGE':
      return {
        ...state,
        attachedImages: state.attachedImages.filter(img => img.id !== action.payload),
      };

    case 'TOGGLE_SELECT_ALL': {
      const allSelected = state.selectedStoryIds.size === state.orphanStories.length;
      return {
        ...state,
        selectedStoryIds: allSelected
          ? new Set()
          : new Set(state.orphanStories.map(s => s.id)),
      };
    }

    case 'TOGGLE_STORY_SELECTION': {
      const newSet = new Set(state.selectedStoryIds);
      if (newSet.has(action.payload)) {
        newSet.delete(action.payload);
      } else {
        newSet.add(action.payload);
      }
      return { ...state, selectedStoryIds: newSet };
    }

    case 'BULK_DELETE':
      // Actual deletion handled by async action
      return { ...state, isBulkDeleting: true };

    case 'CLEAR_ALL':
      // Actual clearing handled by async action
      return { ...state, isBulkDeleting: true };

    case 'SET_ORPHAN_STORIES':
      return { ...state, orphanStories: action.payload };

    case 'SET_CONNECTION_STATUS':
      return { ...state, connectionStatus: action.payload };

    case 'SET_IS_DRAGGING':
      return { ...state, isDragging: action.payload };

    default:
      return state;
  }
}

// Context
const ChatStateContext = createContext<{
  state: ChatState;
  dispatch: React.Dispatch<ChatAction>;
} | null>(null);

// Provider
export function ChatStateProvider({ children }: { children: ReactNode }) {
  const [state, dispatch] = useReducer(chatReducer, initialState);

  return (
    <ChatStateContext.Provider value={{ state, dispatch }}>
      {children}
    </ChatStateContext.Provider>
  );
}

// Hook
export function useChatState() {
  const context = useContext(ChatStateContext);
  if (!context) {
    throw new Error('useChatState must be used within ChatStateProvider');
  }
  return context;
}
```

**Benefits**:
- **Predictable state updates** - Single reducer function
- **Type safety** - Discriminated union for actions
- **Easy testing** - Pure reducer function
- **Performance** - Fewer re-renders with batched updates

---

### 4.2 Custom Hooks for Side Effects

#### **`useProviders.ts`**
```tsx
import { useState, useEffect } from 'react';
import { useChatState } from './useChatState';

export function useProviders() {
  const { state, dispatch } = useChatState();
  const { availableProviders, selectedProvider, selectedModel } = state;

  useEffect(() => {
    fetchProviders();
  }, []);

  const fetchProviders = async () => {
    try {
      const res = await fetch(PROVIDERS_API);
      const data: ProvidersResponse = await res.json();
      dispatch({ type: 'SET_PROVIDERS', payload: data.providers });
      dispatch({ type: 'SET_PROVIDER', payload: data.current.provider });
      dispatch({ type: 'SET_MODEL', payload: data.current.model });
    } catch (err) {
      console.error('Failed to fetch providers:', err);
    }
  };

  const setProvider = (provider: string) => {
    dispatch({ type: 'SET_PROVIDER', payload: provider });
  };

  const setModel = (model: string) => {
    dispatch({ type: 'SET_MODEL', payload: model });
  };

  return {
    providers: availableProviders,
    selectedProvider,
    selectedModel,
    setProvider,
    setModel,
  };
}
```

#### **`useConnectionStatus.ts`**
```tsx
import { useEffect } from 'react';
import { useChatState } from './useChatState';

export function useConnectionStatus() {
  const { dispatch } = useChatState();

  useEffect(() => {
    checkConnection();
    const interval = setInterval(checkConnection, 30000); // Check every 30s
    return () => clearInterval(interval);
  }, []);

  const checkConnection = async () => {
    try {
      const res = await fetch(`${API_BASE}/story-ui/health`, { signal: AbortSignal.timeout(5000) });
      if (res.ok) {
        dispatch({ type: 'SET_CONNECTION_STATUS', payload: { connected: true } });
      } else {
        dispatch({ type: 'SET_CONNECTION_STATUS', payload: { connected: false, error: 'Server error' } });
      }
    } catch (err) {
      dispatch({ type: 'SET_CONNECTION_STATUS', payload: { connected: false, error: 'Connection failed' } });
    }
  };
}
```

#### **`useImageUpload.ts`**
```tsx
import { useState } from 'react';
import { useChatState } from './useChatState';

export function useImageUpload() {
  const { dispatch } = useChatState();

  const uploadImage = async (files: FileList | null) => {
    if (!files) return;

    for (const file of Array.from(files)) {
      const id = `img-${Date.now()}-${Math.random()}`;
      const preview = URL.createObjectURL(file);

      // Convert to base64
      const reader = new FileReader();
      reader.onload = () => {
        const base64 = reader.result as string;
        const mediaType = file.type;

        dispatch({
          type: 'ATTACH_IMAGE',
          payload: { id, file, preview, base64, mediaType },
        });
      };
      reader.readAsDataURL(file);
    }
  };

  const removeImage = (id: string) => {
    dispatch({ type: 'REMOVE_IMAGE', payload: id });
  };

  return { uploadImage, removeImage };
}
```

#### **`useStreamingGeneration.ts`**
```tsx
import { useChatState } from './useChatState';

export function useStreamingGeneration() {
  const { state, dispatch } = useChatState();

  const generateStory = async (prompt: string, images: AttachedImage[]) => {
    dispatch({ type: 'SET_LOADING', payload: true });
    dispatch({ type: 'SET_ERROR', payload: null });

    // Add user message
    dispatch({
      type: 'ADD_MESSAGE',
      payload: {
        role: 'user',
        content: prompt,
        attachedImages: images,
      },
    });

    // Add streaming AI message
    dispatch({
      type: 'ADD_MESSAGE',
      payload: {
        role: 'ai',
        content: '',
        isStreaming: true,
        streamingData: {},
      },
    });

    try {
      const res = await fetch(MCP_STREAM_API, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          prompt,
          provider: state.selectedProvider,
          model: state.selectedModel,
          conversation: state.conversation.slice(0, -2), // Exclude just-added messages
          images: images.map(img => ({ base64: img.base64, mediaType: img.mediaType })),
        }),
      });

      const reader = res.body?.getReader();
      if (!reader) throw new Error('No reader');

      const decoder = new TextDecoder();
      let buffer = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n\n');
        buffer = lines.pop() || '';

        for (const line of lines) {
          if (line.startsWith('data: ')) {
            const event: StreamEvent = JSON.parse(line.slice(6));
            dispatch({ type: 'UPDATE_STREAMING', payload: event.data });
          }
        }
      }

      dispatch({ type: 'SET_LOADING', payload: false });
      dispatch({ type: 'SET_INPUT', payload: '' });
      dispatch({ type: 'REMOVE_IMAGE', payload: '' }); // Clear all images

    } catch (err) {
      dispatch({ type: 'SET_ERROR', payload: (err as Error).message });
      dispatch({ type: 'SET_LOADING', payload: false });
    }
  };

  return { generateStory };
}
```

---

## 5. Accessibility Plan

### 5.1 ARIA Attributes

| Element | ARIA Attributes |
|---------|-----------------|
| Sidebar | `role="complementary"`, `aria-label="Chat history"` |
| ChatArea | `role="main"`, `aria-label="Chat conversation"` |
| MessageList | `role="log"`, `aria-live="polite"`, `aria-atomic="false"` |
| ChatItem | `role="button"`, `tabIndex={0}`, `aria-current={isActive}` |
| ProgressBar | `role="progressbar"`, `aria-valuenow`, `aria-valuemin`, `aria-valuemax` |
| Buttons | `aria-label`, `aria-disabled` |
| Form | `aria-label="Message input form"` |

### 5.2 Semantic HTML

- `<aside>` for sidebar
- `<main>` for chat area
- `<header>` for chat header
- `<article>` for message bubbles
- `<time>` for timestamps with `dateTime` attribute
- `<form>` for chat input
- `<section>` for chat list and orphan stories

### 5.3 Keyboard Navigation

- All interactive elements have `tabIndex`
- Enter key activates chat items
- Escape key closes modals/dropdowns
- Focus indicators via CSS `:focus-visible`
- Skip links for screen readers

### 5.4 Touch Targets

- Minimum 44×44px for all buttons (CSS custom property)
- Adequate spacing between interactive elements
- Hover states also work on touch (via `:active`)

---

## 6. Implementation Phases

### Phase 1: Foundation (Week 1)
- [ ] Create file structure
- [ ] Set up CSS layers in `StoryUIPanel.css`
- [ ] Define custom properties
- [ ] Implement `useChatState` reducer
- [ ] Create type definitions

### Phase 2: Core Components (Week 2)
- [ ] Build Sidebar components
  - [ ] Sidebar.tsx
  - [ ] ChatList.tsx
  - [ ] ChatItem.tsx
- [ ] Build Common components
  - [ ] IconButton.tsx
  - [ ] StatusIndicator.tsx
  - [ ] ImagePreview.tsx

### Phase 3: Chat Components (Week 3)
- [ ] Build ChatArea components
  - [ ] ChatArea.tsx
  - [ ] ChatHeader.tsx
  - [ ] MessageList.tsx
  - [ ] MessageBubble.tsx
  - [ ] ChatInput.tsx

### Phase 4: Advanced Features (Week 4)
- [ ] StreamingIndicator.tsx
- [ ] ModelSelector.tsx
- [ ] OrphanStories.tsx + OrphanStoryItem.tsx
- [ ] Implement all custom hooks

### Phase 5: Polish & Testing (Week 5)
- [ ] Accessibility audit with axe-core
- [ ] Keyboard navigation testing
- [ ] Cross-browser testing
- [ ] Performance optimization
- [ ] Documentation

---

## 7. Migration Strategy

### 7.1 Parallel Development

**Option A**: Build new structure alongside old file
- Keep `StoryUIPanel.tsx` (old)
- Create `StoryUIPanelRefactored.tsx` (new)
- Switch via feature flag
- Remove old file after testing

### 7.2 Incremental Extraction

**Option B**: Extract components one by one
1. Start with `ChatItem.tsx` extraction
2. Test in isolation
3. Integrate back into main component
4. Repeat for each component
5. Move to reducer last

### 7.3 Recommended: Option A

- **Safer**: Old code stays functional
- **Faster**: Parallel development
- **Testable**: Easy A/B comparison
- **Rollback**: Simple revert if issues

---

## 8. Testing Plan

### 8.1 Unit Tests

```tsx
// ChatItem.test.tsx
import { render, screen, fireEvent } from '@testing-library/react';
import ChatItem from './ChatItem';

describe('ChatItem', () => {
  const mockChat = {
    id: '123',
    title: 'Test Chat',
    fileName: 'test.stories.tsx',
    conversation: [],
    lastUpdated: Date.now(),
  };

  it('renders chat title', () => {
    render(<ChatItem chat={mockChat} />);
    expect(screen.getByText('Test Chat')).toBeInTheDocument();
  });

  it('dispatches SELECT_CHAT on click', () => {
    const { container } = render(<ChatItem chat={mockChat} />);
    fireEvent.click(container.firstChild!);
    // Assert dispatch called
  });

  it('shows delete button on hover', () => {
    const { container } = render(<ChatItem chat={mockChat} />);
    const item = container.firstChild as HTMLElement;
    fireEvent.mouseEnter(item);
    const deleteBtn = screen.getByLabelText('Delete chat');
    expect(deleteBtn).toHaveStyle({ opacity: '1' });
  });
});
```

### 8.2 Integration Tests

```tsx
// StoryUIPanel.integration.test.tsx
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import StoryUIPanel from './StoryUIPanel';

describe('StoryUIPanel Integration', () => {
  it('creates new chat and sends message', async () => {
    render(<StoryUIPanel />);

    // Click "New Chat"
    const newChatBtn = screen.getByLabelText('New Chat');
    await userEvent.click(newChatBtn);

    // Type message
    const input = screen.getByLabelText('Component description');
    await userEvent.type(input, 'Create a card component');

    // Submit
    const sendBtn = screen.getByLabelText('Send message');
    await userEvent.click(sendBtn);

    // Assert message appears
    await waitFor(() => {
      expect(screen.getByText('Create a card component')).toBeInTheDocument();
    });
  });
});
```

### 8.3 Accessibility Tests

```tsx
// a11y.test.tsx
import { render } from '@testing-library/react';
import { axe, toHaveNoViolations } from 'jest-axe';
import StoryUIPanel from './StoryUIPanel';

expect.extend(toHaveNoViolations);

describe('Accessibility', () => {
  it('has no axe violations', async () => {
    const { container } = render(<StoryUIPanel />);
    const results = await axe(container);
    expect(results).toHaveNoViolations();
  });
});
```

---

## 9. Performance Optimizations

### 9.1 React Optimizations

```tsx
// Memoize expensive components
const MessageBubble = React.memo(({ message }: MessageBubbleProps) => {
  // ...
}, (prev, next) => prev.message.content === next.message.content);

// Virtualize long lists
import { FixedSizeList } from 'react-window';

function ChatList() {
  const { recentChats } = useChatState();

  return (
    <FixedSizeList
      height={600}
      itemCount={recentChats.length}
      itemSize={60}
    >
      {({ index, style }) => (
        <div style={style}>
          <ChatItem chat={recentChats[index]} />
        </div>
      )}
    </FixedSizeList>
  );
}
```

### 9.2 CSS Optimizations

```css
/* Use CSS containment */
.chat-item {
  contain: layout style paint;
}

/* Use will-change for animations */
.btn--primary:hover {
  will-change: transform, box-shadow;
  transform: translateY(-1px);
}

/* Lazy load images */
.image-preview img {
  loading: lazy;
}
```

### 9.3 Code Splitting

```tsx
// Lazy load heavy components
const StreamingIndicator = React.lazy(() => import('./components/ChatArea/StreamingIndicator'));

// Use in component
<Suspense fallback={<LoadingSpinner />}>
  <StreamingIndicator state={streamingData} />
</Suspense>
```

---

## 10. Success Metrics

| Metric | Current | Target |
|--------|---------|--------|
| Lines of code (main file) | 3,200 | <300 |
| Number of files | 1 | ~25 |
| Inline styles | 100+ | 0 |
| `!important` declarations | 30+ | 0 |
| `useState` hooks | 22 | 1 (useReducer) |
| Accessibility score (Lighthouse) | Unknown | >95 |
| Bundle size | Baseline | -10% |
| First paint time | Baseline | -20% |

---

## 11. Next Steps

1. **Review this plan** with team/stakeholders
2. **Create feature branch**: `refactor/story-ui-panel`
3. **Set up testing environment** with Jest + React Testing Library
4. **Begin Phase 1** (Foundation)
5. **Weekly progress reviews** and adjust plan as needed

---

## Appendix: Quick Reference

### Component Responsibility Matrix

| Component | Lines | Responsibilities |
|-----------|-------|------------------|
| StoryUIPanel.tsx | ~250 | Orchestration, context provider, stylesheet injection |
| Sidebar.tsx | ~150 | Sidebar container, collapse state |
| ChatList.tsx | ~80 | Render chat history |
| ChatItem.tsx | ~60 | Individual chat display |
| OrphanStories.tsx | ~120 | Orphan stories list, bulk actions |
| OrphanStoryItem.tsx | ~50 | Individual orphan story |
| ChatArea.tsx | ~100 | Main content container |
| ChatHeader.tsx | ~80 | Status, provider/model selectors |
| MessageList.tsx | ~100 | Scrollable conversation |
| MessageBubble.tsx | ~120 | User/AI message rendering |
| StreamingIndicator.tsx | ~150 | Progress, validation, retry feedback |
| ChatInput.tsx | ~200 | Prompt input, image upload, send |
| StatusIndicator.tsx | ~40 | Connection status dot |
| ModelSelector.tsx | ~80 | Provider + model dropdowns |
| IconButton.tsx | ~30 | Reusable button |
| ImagePreview.tsx | ~40 | Image thumbnail |
| MarkdownRenderer.tsx | ~100 | Existing logic |

**Total estimated lines**: ~1,850 (down from 3,200, -42% reduction)

---

## Conclusion

This refactoring plan transforms the monolithic `StoryUIPanel.tsx` into a modern, maintainable component architecture. By leveraging CSS layers, custom properties, the reducer pattern, and semantic HTML, we achieve:

- **Better maintainability** through separation of concerns
- **Improved accessibility** with ARIA and semantic elements
- **Enhanced performance** via CSS containment and code splitting
- **Easier testing** with isolated, pure components
- **Cleaner code** without inline styles or `!important`

The phased approach allows for incremental progress while maintaining a working system throughout the refactoring process.
