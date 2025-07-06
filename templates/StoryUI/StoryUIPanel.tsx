import React, { useState, useRef, useEffect } from 'react';
import { MdSend } from 'react-icons/md';

// Message type
interface Message {
  role: 'user' | 'ai';
  content: string;
}

// Session type
interface ChatSession {
  id: string;
  title: string;
  fileName: string;
  conversation: Message[];
  lastUpdated: number;
}

// Determine the MCP API port.
// 1. If the host application sets `window.__STORY_UI_PORT__`, prefer that.
// 2. Otherwise fall back to the default 4001.
const getApiPort = () => {
  const override = (window as any).__STORY_UI_PORT__;
  if (override) return String(override);
  return '4001';
};

const MCP_API = `http://localhost:${getApiPort()}/story-ui/generate`;
const STORIES_API = `http://localhost:${getApiPort()}/story-ui/stories`;
const DELETE_API = `http://localhost:${getApiPort()}/story-ui/delete`;
const STORAGE_KEY = `story-ui-chats-${window.location.port}`;
const MAX_RECENT_CHATS = 20;

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

    const data = await response.json();
    const memoryStories = data.stories || [];

    // Load existing chats
    const existingChats = loadChats();

    // Create a map for quick lookup
    const chatMap = new Map<string, ChatSession>();
    existingChats.forEach(chat => {
      chatMap.set(chat.id, chat);
      if (chat.fileName) {
        chatMap.set(chat.fileName, chat);
      }
    });

    // Update or add memory stories
    memoryStories.forEach((story: any) => {
      const storyId = story.storyId || story.fileName;
      const existingChat = chatMap.get(storyId) || chatMap.get(story.fileName);

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
            content: `✅ Created story: "${story.title}"\n\nThis story was recovered from memory. You can continue updating it or view it in Storybook.`
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
    // First try to delete from backend
    const response = await fetch(DELETE_API, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ storyId: chatId })
    });

    if (!response.ok) {
      console.error('Failed to delete story from backend');
      return false;
    }

    // Then remove from local storage
    const chats = loadChats().filter(chat => chat.id !== chatId);
    saveChats(chats);

    return true;
  } catch (error) {
    console.error('Error deleting story:', error);
    return false;
  }
};

// Component styles
const STYLES = {
  container: {
    display: 'flex',
    flexDirection: 'row' as const,
    fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", "Roboto", "Oxygen", "Ubuntu", "Cantarell", "Fira Sans", "Droid Sans", "Helvetica Neue", sans-serif',
    height: '100vh',
    overflow: 'hidden',
    background: 'linear-gradient(135deg, #1e293b 0%, #334155 100%)',
    color: '#e2e8f0',
  },

  // Sidebar
  sidebar: {
    width: '280px',
    background: 'rgba(255, 255, 255, 0.05)',
    borderRight: '1px solid rgba(255, 255, 255, 0.1)',
    display: 'flex',
    flexDirection: 'column' as const,
    backdropFilter: 'blur(10px)',
    transition: 'width 0.3s ease',
    position: 'relative' as const,
  },

  sidebarCollapsed: {
    width: '60px',
  },

  sidebarToggle: {
    position: 'absolute' as const,
    top: '16px',
    right: '16px',
    zIndex: 10,
    background: 'linear-gradient(135deg, #3b82f6 0%, #1d4ed8 100%)',
    color: 'white',
    border: 'none',
    borderRadius: '8px',
    padding: '8px 12px',
    fontSize: '14px',
    cursor: 'pointer',
    display: 'flex',
    alignItems: 'center',
    gap: '8px',
    transition: 'all 0.2s ease',
    boxShadow: '0 2px 8px rgba(59, 130, 246, 0.3)',
  },

  newChatButton: {
    width: '100%',
    padding: '10px 16px',
    background: 'linear-gradient(135deg, #3b82f6 0%, #1d4ed8 100%)',
    color: 'white',
    border: 'none',
    borderRadius: '8px',
    fontSize: '14px',
    fontWeight: '500',
    cursor: 'pointer',
    marginBottom: '16px',
    transition: 'all 0.2s ease',
    boxShadow: '0 2px 8px rgba(59, 130, 246, 0.2)',
  },

  chatItem: {
    padding: '12px 16px',
    marginBottom: '8px',
    background: 'rgba(255, 255, 255, 0.08)',
    borderRadius: '8px',
    cursor: 'pointer',
    transition: 'all 0.2s ease',
    position: 'relative' as const,
    paddingRight: '40px',
  },

  chatItemActive: {
    background: 'rgba(59, 130, 246, 0.2)',
    borderLeft: '3px solid #3b82f6',
  },

  chatItemTitle: {
    fontSize: '14px',
    fontWeight: '500',
    marginBottom: '4px',
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
    padding: '20px 24px',
    borderBottom: '1px solid rgba(255, 255, 255, 0.1)',
    background: 'rgba(255, 255, 255, 0.05)',
    backdropFilter: 'blur(10px)',
  },

  chatContainer: {
    flex: 1,
    padding: '24px',
    overflowY: 'auto' as const,
    scrollBehavior: 'smooth' as const,
  },

  emptyState: {
    color: '#94a3b8',
    textAlign: 'center' as const,
    marginTop: '60px',
    fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", "Roboto", "Oxygen", "Ubuntu", "Cantarell", "Fira Sans", "Droid Sans", "Helvetica Neue", sans-serif',
  },

  emptyStateTitle: {
    fontSize: '16px',
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
    marginBottom: '16px',
  },

  userMessage: {
    background: 'linear-gradient(135deg, #3b82f6 0%, #1d4ed8 100%)',
    color: '#ffffff',
    borderRadius: '18px 18px 4px 18px',
    padding: '12px 16px',
    maxWidth: '80%',
    marginLeft: 'auto',
    fontSize: '14px',
    lineHeight: '1.5',
    fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", "Roboto", "Oxygen", "Ubuntu", "Cantarell", "Fira Sans", "Droid Sans", "Helvetica Neue", sans-serif',
    boxShadow: '0 2px 12px rgba(59, 130, 246, 0.3)',
    wordWrap: 'break-word' as const,
  },

  aiMessage: {
    background: 'rgba(255, 255, 255, 0.95)',
    color: '#1f2937',
    borderRadius: '18px 18px 18px 4px',
    padding: '12px 16px',
    maxWidth: '80%',
    fontSize: '14px',
    lineHeight: '1.5',
    fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", "Roboto", "Oxygen", "Ubuntu", "Cantarell", "Fira Sans", "Droid Sans", "Helvetica Neue", sans-serif',
    boxShadow: '0 2px 12px rgba(0, 0, 0, 0.1)',
    wordWrap: 'break-word' as const,
    whiteSpace: 'pre-wrap' as const,
  },

  loadingMessage: {
    background: 'rgba(255, 255, 255, 0.9)',
    color: '#6b7280',
    borderRadius: '18px 18px 18px 4px',
    padding: '12px 16px',
    fontSize: '14px',
    fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", "Roboto", "Oxygen", "Ubuntu", "Cantarell", "Fira Sans", "Droid Sans", "Helvetica Neue", sans-serif',
    display: 'flex',
    alignItems: 'center',
    gap: '8px',
  },

  // Input form
  inputForm: {
    display: 'flex',
    alignItems: 'center',
    gap: '12px',
    margin: '0 24px 24px 24px',
    padding: '16px',
    background: 'rgba(255, 255, 255, 0.05)',
    borderRadius: '12px',
    border: '1px solid rgba(255, 255, 255, 0.1)',
    backdropFilter: 'blur(10px)',
  },

  textInput: {
    fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", "Roboto", "Oxygen", "Ubuntu", "Cantarell", "Fira Sans", "Droid Sans", "Helvetica Neue", sans-serif',
    flex: 1,
    padding: '12px 16px',
    borderRadius: '8px',
    border: '1px solid rgba(255, 255, 255, 0.2)',
    fontSize: '14px',
    color: '#1f2937',
    background: '#ffffff',
    outline: 'none',
    transition: 'all 0.2s ease',
    boxSizing: 'border-box' as const,
  },

  sendButton: {
    fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", "Roboto", "Oxygen", "Ubuntu", "Cantarell", "Fira Sans", "Droid Sans", "Helvetica Neue", sans-serif',
    padding: '12px 20px',
    borderRadius: '8px',
    border: 'none',
    background: 'linear-gradient(135deg, #10b981 0%, #059669 100%)',
    color: '#ffffff',
    fontSize: '14px',
    fontWeight: '500',
    cursor: 'pointer',
    display: 'flex',
    alignItems: 'center',
    gap: '6px',
    transition: 'all 0.2s ease',
    boxShadow: '0 2px 8px rgba(16, 185, 129, 0.3)',
  },

  errorMessage: {
    background: 'rgba(248, 113, 113, 0.1)',
    color: '#f87171',
    padding: '12px 16px',
    borderRadius: '8px',
    fontSize: '14px',
    marginBottom: '16px',
    border: '1px solid rgba(248, 113, 113, 0.3)',
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
    padding: '12px 16px',
    borderRadius: '8px',
    fontFamily: 'Consolas, Monaco, "Andale Mono", "Ubuntu Mono", monospace',
    fontSize: '13px',
    lineHeight: '1.6',
    overflowX: 'auto' as const,
    marginTop: '8px',
    border: '1px solid rgba(255, 255, 255, 0.1)',
  },
};

// Add custom style for loading animation
const styleSheet = document.createElement('style');
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
`;
document.head.appendChild(styleSheet);

// Helper function to format timestamp
const formatTime = (timestamp: number): string => {
  const date = new Date(timestamp);
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

// Main component
export function StoryUIPanel() {
  const [input, setInput] = useState('');
  const [conversation, setConversation] = useState<Message[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [recentChats, setRecentChats] = useState<ChatSession[]>([]);
  const [activeChatId, setActiveChatId] = useState<string | null>(null);
  const [activeTitle, setActiveTitle] = useState<string>('');
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const chatEndRef = useRef<HTMLDivElement | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);

  // Load and sync chats on mount
  useEffect(() => {
    const initializeChats = async () => {
      const syncedChats = await syncWithActualStories();
      const sortedChats = syncedChats.sort((a, b) => b.lastUpdated - a.lastUpdated).slice(0, MAX_RECENT_CHATS);
      setRecentChats(sortedChats);

      if (sortedChats.length > 0) {
        setConversation(sortedChats[0].conversation);
        setActiveChatId(sortedChats[0].id);
        setActiveTitle(sortedChats[0].title);
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

  const handleSend = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    if (!input.trim()) return;
    setError(null);
    setLoading(true);
    const newConversation = [...conversation, { role: 'user' as const, content: input }];
    setConversation(newConversation);
    setInput('');
    try {
      const res = await fetch(MCP_API, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          prompt: input,
          conversation: newConversation,
          fileName: activeChatId || undefined,
        }),
      });
      const data = await res.json();
      if (!res.ok || !data.success) throw new Error(data.error || 'Story generation failed');

      // Create user-friendly response message instead of showing raw markup
      let responseMessage: string;
      let statusIcon = '✅';

      // Check for validation issues
      if (data.validation && data.validation.hasWarnings) {
        statusIcon = '⚠️';
        const warningCount = data.validation.warnings.length;
        const errorCount = data.validation.errors.length;

        if (errorCount > 0) {
          statusIcon = '🔧';
        }
      }

      if (data.isUpdate) {
        responseMessage = `${statusIcon} Updated your story: "${data.title}"\n\nI've made the requested changes while keeping the same layout structure. You can view the updated component in Storybook.`;
      } else {
        responseMessage = `${statusIcon} Created new story: "${data.title}"\n\nI've generated the component with the requested features. You can view it in Storybook where you'll see both the rendered component and its markup in the Docs tab.`;

        // IMPORTANT: Add a note about refreshing for new stories
        responseMessage += '\n\n💡 **Note**: If you don\'t see the story immediately, you may need to refresh your Storybook page (Cmd/Ctrl + R) for new stories to appear in the sidebar.';
      }

      // Add validation information if there are issues
      if (data.validation && data.validation.hasWarnings) {
        responseMessage += '\n\n';

        if (data.validation.errors.length > 0) {
          responseMessage += `🔧 **Auto-fixed ${data.validation.errors.length} syntax error(s):**\n`;
          responseMessage += data.validation.errors.slice(0, 3).map(error => `  • ${error}`).join('\n');
          if (data.validation.errors.length > 3) {
            responseMessage += `\n  • ... and ${data.validation.errors.length - 3} more`;
          }
          responseMessage += '\n';
        }

        if (data.validation.warnings.length > 0) {
          responseMessage += `⚠️ **Warnings:**\n`;
          responseMessage += data.validation.warnings.slice(0, 2).map(warning => `  • ${warning}`).join('\n');
          if (data.validation.warnings.length > 2) {
            responseMessage += `\n  • ... and ${data.validation.warnings.length - 2} more`;
          }
        }
      }

      const aiMsg = { role: 'ai' as const, content: responseMessage };
      const updatedConversation = [...newConversation, aiMsg];
      setConversation(updatedConversation);

      // Determine if this is an update or new chat
      // Check if we have an active chat AND the backend indicates this is an update
      const isUpdate = activeChatId && conversation.length > 0 && (
        data.isUpdate ||
        data.fileName === activeChatId ||
        // Also check if fileName matches any existing chat's fileName
        recentChats.some(chat => chat.fileName === data.fileName && chat.id === activeChatId)
      );

      console.log('Update detection:', {
        activeChatId,
        conversationLength: conversation.length,
        dataIsUpdate: data.isUpdate,
        dataFileName: data.fileName,
        isUpdate
      });

      if (isUpdate) {
        // Update existing chat session
        const chatTitle = activeTitle; // Keep existing title for updates
        const updatedSession: ChatSession = {
          id: activeChatId,
          title: chatTitle,
          fileName: data.fileName || activeChatId,
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
        console.log('Updated existing chat:', activeChatId);
      } else {
        // Create new chat session - use storyId from backend for consistency
        const chatId = data.storyId || data.fileName || data.outPath || Date.now().toString();
        const chatTitle = data.title || input;
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
        if (chats.length > MAX_RECENT_CHATS) {
          chats.splice(MAX_RECENT_CHATS);
        }
        saveChats(chats);
        setRecentChats(chats);
        console.log('Created new chat:', chatId);
      }

    } catch (err: unknown) {
      const errorMessage = err instanceof Error ? err.message : 'Unknown error';
      setError(errorMessage);
      const errorConversation = [...newConversation, { role: 'ai' as const, content: `Error: ${errorMessage}` }];
      setConversation(errorConversation);

      // IMPORTANT: Create/update chat session even on error so retries continue the same conversation
      const isUpdate = activeChatId && conversation.length > 0;

      if (isUpdate) {
        // Update existing chat with error
        const updatedSession: ChatSession = {
          id: activeChatId,
          title: activeTitle,
          fileName: activeChatId,
          conversation: errorConversation,
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
        // Create new chat session for error (so retries can continue it)
        const chatId = `error-${Date.now()}`;
        const chatTitle = input.length > 30 ? input.substring(0, 30) + '...' : input;
        setActiveChatId(chatId);
        setActiveTitle(chatTitle);

        const newSession: ChatSession = {
          id: chatId,
          title: chatTitle,
          fileName: '',
          conversation: errorConversation,
          lastUpdated: Date.now(),
        };

        const chats = loadChats();
        chats.unshift(newSession);
        if (chats.length > MAX_RECENT_CHATS) {
          chats.splice(MAX_RECENT_CHATS);
        }
        saveChats(chats);
        setRecentChats(chats);
      }
    } finally {
      setLoading(false);
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
    <div style={STYLES.container}>
      {/* Sidebar */}
      <div style={{
        ...STYLES.sidebar,
        ...(sidebarOpen ? {} : STYLES.sidebarCollapsed),
      }}>
        <button
          onClick={() => setSidebarOpen(o => !o)}
          style={{
            ...STYLES.sidebarToggle,
            ...(sidebarOpen ? {} : { width: '40px', height: '40px', padding: '0' }),
          }}
          title={sidebarOpen ? 'Collapse sidebar' : 'Expand sidebar'}
          onMouseEnter={(e) => {
            e.currentTarget.style.transform = 'scale(1.05)';
            e.currentTarget.style.boxShadow = '0 4px 16px rgba(59, 130, 246, 0.4)';
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.transform = 'scale(1)';
            e.currentTarget.style.boxShadow = '0 2px 8px rgba(59, 130, 246, 0.3)';
          }}
        >
          {sidebarOpen ? '☰ Chats' : '☰'}
        </button>
        {sidebarOpen && (
          <div style={{ flex: 1, overflowY: 'auto', padding: '0 16px 16px 16px' }}>
            <button
              onClick={handleNewChat}
              style={STYLES.newChatButton}
              onMouseEnter={(e) => {
                e.currentTarget.style.transform = 'translateY(-1px)';
                e.currentTarget.style.boxShadow = '0 4px 16px rgba(59, 130, 246, 0.4)';
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.transform = 'translateY(0)';
                e.currentTarget.style.boxShadow = '0 2px 8px rgba(59, 130, 246, 0.2)';
              }}
            >
              + New Chat
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
                  ✕
                </button>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Main content */}
      <div style={STYLES.mainContent}>
        <div style={STYLES.chatHeader}>
          <h1 style={{
            fontSize: '24px',
            margin: 0,
            fontWeight: '600',
            background: 'linear-gradient(135deg, #60a5fa 0%, #3b82f6 100%)',
            WebkitBackgroundClip: 'text',
            WebkitTextFillColor: 'transparent',
            display: 'inline-block'
          }}>
            Story UI
          </h1>
          <p style={{ fontSize: '14px', margin: '4px 0 0 0', color: '#94a3b8' }}>
            Generate Storybook stories with AI
          </p>
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
              <div style={msg.role === 'user' ? STYLES.userMessage : STYLES.aiMessage}>
                {msg.content}
              </div>
            </div>
          ))}

          {loading && (
            <div style={STYLES.messageContainer}>
              <div style={STYLES.loadingMessage}>
                <span>Generating story</span>
                <span className="loading-dots"></span>
              </div>
            </div>
          )}

          <div ref={chatEndRef} />
        </div>

        <form onSubmit={handleSend} style={STYLES.inputForm}>
          <input
            ref={inputRef}
            type="text"
            value={input}
            onChange={e => setInput(e.target.value)}
            placeholder="Describe a UI component..."
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
            disabled={loading || !input.trim()}
            style={{
              ...STYLES.sendButton,
              ...(loading || !input.trim() ? {
                opacity: 0.5,
                cursor: 'not-allowed',
                background: '#6b7280',
                boxShadow: 'none'
              } : {})
            }}
            onMouseEnter={(e) => {
              if (!loading && input.trim()) {
                e.currentTarget.style.transform = 'scale(1.05)';
                e.currentTarget.style.boxShadow = '0 4px 16px rgba(16, 185, 129, 0.4)';
              }
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.transform = 'scale(1)';
              e.currentTarget.style.boxShadow = '0 2px 8px rgba(16, 185, 129, 0.3)';
            }}
          >
            <span>Send</span>
            <MdSend size={16} />
          </button>
        </form>
      </div>
    </div>
  );
}
