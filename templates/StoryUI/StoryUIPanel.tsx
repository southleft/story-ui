import React, { useState, useRef, useEffect } from 'react';

const MCP_API = 'http://localhost:4001/mcp/generate-story';
const SYNC_API = 'http://localhost:4001/mcp/sync';
const LOCAL_STORAGE_KEY = 'story_ui_chat_history_v2'; // Updated version for sync
const MAX_RECENT_CHATS = 20;

interface Message {
  role: 'user' | 'ai';
  content: string;
}

interface ChatSession {
  id: string; // fileName or hash
  title: string;
  fileName: string;
  conversation: Message[];
  lastUpdated: number;
  isValid?: boolean; // Whether the story still exists
}

// Professional, self-contained styles - no external dependencies
const STYLES = {
  // Typography - Professional font stack like ChatGPT
  fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", "Roboto", "Oxygen", "Ubuntu", "Cantarell", "Fira Sans", "Droid Sans", "Helvetica Neue", sans-serif',

  // Base container with CSS reset
  container: {
    fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", "Roboto", "Oxygen", "Ubuntu", "Cantarell", "Fira Sans", "Droid Sans", "Helvetica Neue", sans-serif',
    fontSize: '14px',
    lineHeight: '1.5',
    color: '#ffffff',
    margin: 0,
    padding: 0,
    boxSizing: 'border-box' as const,
    display: 'flex',
    height: '600px',
    background: 'linear-gradient(135deg, #1a1a2e 0%, #16213e 100%)',
    borderRadius: '12px',
    boxShadow: '0 8px 32px rgba(0, 0, 0, 0.3)',
    overflow: 'hidden',
    border: '1px solid rgba(255, 255, 255, 0.1)',
  },

  // Sidebar styles
  sidebar: {
    width: '280px',
    background: 'linear-gradient(180deg, #0f172a 0%, #1e293b 100%)',
    borderRight: '1px solid rgba(255, 255, 255, 0.1)',
    display: 'flex',
    flexDirection: 'column' as const,
    transition: 'all 0.3s cubic-bezier(0.4, 0, 0.2, 1)',
  },

  sidebarCollapsed: {
    width: '60px',
  },

  sidebarToggle: {
    fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", "Roboto", "Oxygen", "Ubuntu", "Cantarell", "Fira Sans", "Droid Sans", "Helvetica Neue", sans-serif',
    background: 'linear-gradient(135deg, #3b82f6 0%, #1d4ed8 100%)',
    color: '#ffffff',
    border: 'none',
    borderRadius: '8px',
    margin: '16px',
    padding: '12px 16px',
    fontWeight: '600',
    fontSize: '14px',
    cursor: 'pointer',
    transition: 'all 0.2s ease',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    boxShadow: '0 2px 8px rgba(59, 130, 246, 0.3)',
  },

  newChatButton: {
    fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", "Roboto", "Oxygen", "Ubuntu", "Cantarell", "Fira Sans", "Droid Sans", "Helvetica Neue", sans-serif',
    width: '100%',
    padding: '12px 16px',
    marginBottom: '12px',
    borderRadius: '8px',
    border: '1px solid rgba(59, 130, 246, 0.3)',
    background: 'linear-gradient(135deg, #3b82f6 0%, #1d4ed8 100%)',
    color: '#ffffff',
    fontWeight: '600',
    fontSize: '14px',
    cursor: 'pointer',
    transition: 'all 0.2s ease',
    boxShadow: '0 2px 8px rgba(59, 130, 246, 0.2)',
  },

  chatItem: {
    fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", "Roboto", "Oxygen", "Ubuntu", "Cantarell", "Fira Sans", "Droid Sans", "Helvetica Neue", sans-serif',
    width: '100%',
    textAlign: 'left' as const,
    padding: '12px 40px 12px 16px',
    borderRadius: '8px',
    border: '1px solid transparent',
    background: 'rgba(255, 255, 255, 0.05)',
    color: '#e2e8f0',
    fontWeight: '400',
    fontSize: '13px',
    cursor: 'pointer',
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap' as const,
    transition: 'all 0.2s ease',
    marginBottom: '4px',
  },

  chatItemActive: {
    border: '1px solid rgba(59, 130, 246, 0.5)',
    background: 'rgba(59, 130, 246, 0.1)',
    color: '#60a5fa',
    fontWeight: '500',
  },

  // Main chat area
  mainArea: {
    flex: 1,
    display: 'flex',
    flexDirection: 'column' as const,
    background: 'rgba(255, 255, 255, 0.02)',
  },

  header: {
    fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", "Roboto", "Oxygen", "Ubuntu", "Cantarell", "Fira Sans", "Droid Sans", "Helvetica Neue", sans-serif',
    color: '#f8fafc',
    margin: '0',
    padding: '24px 24px 16px 24px',
    fontSize: '20px',
    fontWeight: '600',
    letterSpacing: '-0.01em',
    background: 'linear-gradient(135deg, #f8fafc 0%, #e2e8f0 100%)',
    WebkitBackgroundClip: 'text',
    WebkitTextFillColor: 'transparent',
    backgroundClip: 'text',
  },

  chatContainer: {
    flex: 1,
    overflowY: 'auto' as const,
    background: 'rgba(0, 0, 0, 0.2)',
    borderRadius: '12px',
    padding: '20px',
    margin: '0 24px 16px 24px',
    border: '1px solid rgba(255, 255, 255, 0.1)',
    backdropFilter: 'blur(10px)',
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
    fontWeight: '600',
    fontSize: '14px',
    cursor: 'pointer',
    transition: 'all 0.2s ease',
    boxShadow: '0 2px 8px rgba(16, 185, 129, 0.3)',
  },

  sendButtonDisabled: {
    background: 'rgba(107, 114, 128, 0.5)',
    cursor: 'not-allowed',
    boxShadow: 'none',
  },

  errorMessage: {
    color: '#ef4444',
    margin: '0 24px 16px 24px',
    padding: '12px 16px',
    background: 'rgba(239, 68, 68, 0.1)',
    borderRadius: '8px',
    border: '1px solid rgba(239, 68, 68, 0.3)',
    fontSize: '13px',
    fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", "Roboto", "Oxygen", "Ubuntu", "Cantarell", "Fira Sans", "Droid Sans", "Helvetica Neue", sans-serif',
  },

  deleteButton: {
    position: 'absolute' as const,
    right: '8px',
    top: '50%',
    transform: 'translateY(-50%)',
    width: '20px',
    height: '20px',
    borderRadius: '4px',
    border: 'none',
    background: 'rgba(239, 68, 68, 0.8)',
    color: '#ffffff',
    fontSize: '12px',
    fontWeight: 'bold',
    cursor: 'pointer',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    transition: 'all 0.2s ease',
    zIndex: 10,
    fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", "Roboto", "Oxygen", "Ubuntu", "Cantarell", "Fira Sans", "Droid Sans", "Helvetica Neue", sans-serif',
  },
};

function loadChats(): ChatSession[] {
  try {
    const raw = localStorage.getItem(LOCAL_STORAGE_KEY);
    if (!raw) return [];
    return JSON.parse(raw) as ChatSession[];
  } catch {
    return [];
  }
}

function saveChats(chats: ChatSession[]) {
  localStorage.setItem(LOCAL_STORAGE_KEY, JSON.stringify(chats));
}

function removeDuplicateChats(chats: ChatSession[]): ChatSession[] {
  const seen = new Set<string>();
  const seenTitles = new Map<string, ChatSession>();

  return chats.filter(chat => {
    // Remove exact ID duplicates
    if (seen.has(chat.id)) {
      return false;
    }
    seen.add(chat.id);

    // For title duplicates, keep the most recent one
    const existingChat = seenTitles.get(chat.title);
    if (existingChat) {
      if (chat.lastUpdated > existingChat.lastUpdated) {
        // Remove the older chat and keep this newer one
        const oldIndex = chats.findIndex(c => c.id === existingChat.id);
        if (oldIndex !== -1) {
          seen.delete(existingChat.id);
        }
        seenTitles.set(chat.title, chat);
        return true;
      } else {
        // Keep the existing newer chat, skip this one
        return false;
      }
    } else {
      seenTitles.set(chat.title, chat);
      return true;
    }
  });
}

async function syncWithActualStories(): Promise<ChatSession[]> {
  try {
    // Get actual stories from the server
    const response = await fetch(`${SYNC_API}/stories`);
    const data = await response.json();

    if (!data.success) {
      console.warn('Failed to sync with actual stories:', data.error);
      return loadChats();
    }

    const actualStories = data.stories;
    const existingChats = loadChats();

    // More robust matching: check multiple ID formats to prevent duplicates
    const validChats = existingChats.filter(chat => {
      return actualStories.some((story: { id: string; fileName: string }) => {
        // Direct ID match
        if (story.id === chat.id) return true;

        // Filename match
        if (story.fileName === chat.fileName) return true;

        // Check if chat ID matches story filename (old format)
        if (story.fileName === chat.id) return true;

        // Check if story ID matches chat filename (common mismatch)
        if (story.id === chat.fileName) return true;

        return false;
      });
    });

    // Only add stories that truly don't have chat sessions after robust checking
    const newChats: ChatSession[] = actualStories
      .filter((story: { id: string; fileName: string }) => {
        return !existingChats.some(chat => {
          // Check all possible matches to avoid creating duplicates
          return chat.id === story.id ||
                 chat.fileName === story.fileName ||
                 chat.id === story.fileName ||
                 chat.fileName === story.id;
        });
      })
      .map((story: { id: string; title: string; fileName: string; createdAt: string }) => ({
        id: story.id,
        title: story.title,
        fileName: story.fileName,
        conversation: [
          { role: 'ai' as const, content: `Story "${story.title}" was found.\nGenerated: ${new Date(story.createdAt).toLocaleString()}` }
        ],
        lastUpdated: new Date(story.createdAt).getTime(),
        isValid: true
      }));

    // Mark all chats as valid and combine
    const combinedChats = [...validChats.map(chat => ({ ...chat, isValid: true })), ...newChats];

    // Remove any duplicates that might have been created
    const syncedChats = removeDuplicateChats(combinedChats);

    // Save the synchronized chats
    saveChats(syncedChats);

    console.log('Sync completed:', {
      totalStories: actualStories.length,
      existingChats: existingChats.length,
      validChats: validChats.length,
      newChats: newChats.length,
      finalChats: syncedChats.length
    });

    return syncedChats;
  } catch (error) {
    console.warn('Failed to sync with server:', error);
    return loadChats();
  }
}

async function deleteStoryAndChat(storyId: string): Promise<boolean> {
  try {
    const response = await fetch(`${SYNC_API}/stories/${storyId}`, {
      method: 'DELETE'
    });
    const data = await response.json();

    if (data.success) {
      // Remove from localStorage
      const chats = loadChats().filter(chat => chat.id !== storyId);
      saveChats(chats);
      return true;
    }

    return false;
  } catch (error) {
    console.warn('Failed to delete story:', error);
    return false;
  }
}

const StoryUIPanel: React.FC = () => {
  const [conversation, setConversation] = useState<Message[]>([]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [recentChats, setRecentChats] = useState<ChatSession[]>([]);
  const [activeChatId, setActiveChatId] = useState<string | null>(null);
  const [activeTitle, setActiveTitle] = useState<string>('');
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const chatEndRef = useRef<HTMLDivElement | null>(null);

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
      if (data.isUpdate) {
        responseMessage = `✅ Updated your story: "${data.title}"\n\nI've made the requested changes while keeping the same layout structure. You can view the updated component in Storybook.`;
      } else {
        responseMessage = `✅ Created new story: "${data.title}"\n\nI've generated the component with the requested features. You can view it in Storybook where you'll see both the rendered component and its markup in the Docs tab.`;
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
                fontFamily: STYLES.fontFamily,
              }}>
                Recent
              </div>
            )}
            {recentChats.map(chat => (
              <div
                key={chat.id}
                style={{
                  position: 'relative',
                  marginBottom: '4px',
                }}
              >
                <button
                  onClick={() => handleSelectChat(chat)}
                  style={{
                    ...STYLES.chatItem,
                    ...(chat.id === activeChatId ? STYLES.chatItemActive : {}),
                  }}
                  title={chat.title}
                  onMouseEnter={(e) => {
                    if (chat.id !== activeChatId) {
                      e.currentTarget.style.background = 'rgba(255, 255, 255, 0.1)';
                    }
                  }}
                  onMouseLeave={(e) => {
                    if (chat.id !== activeChatId) {
                      e.currentTarget.style.background = 'rgba(255, 255, 255, 0.05)';
                    }
                  }}
                >
                  {chat.title}
                </button>
                <button
                  onClick={(e) => handleDeleteChat(chat.id, e)}
                  style={STYLES.deleteButton}
                  title="Delete story and chat"
                  onMouseEnter={(e) => {
                    e.currentTarget.style.background = '#ef4444';
                    e.currentTarget.style.transform = 'translateY(-50%) scale(1.1)';
                  }}
                  onMouseLeave={(e) => {
                    e.currentTarget.style.background = 'rgba(239, 68, 68, 0.8)';
                    e.currentTarget.style.transform = 'translateY(-50%) scale(1)';
                  }}
                >
                  ×
                </button>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Main chat area */}
      <div style={STYLES.mainArea}>
        <h2 style={STYLES.header}>Story UI: AI Story Generator</h2>

        <div style={STYLES.chatContainer}>
          {conversation.length === 0 && (
            <div style={STYLES.emptyState}>
              <div style={STYLES.emptyStateTitle}>Start a conversation to generate a Storybook story</div>
              <div style={STYLES.emptyStateSubtitle}>
                (e.g. &quot;Build a login form with two fields and a button&quot;)
              </div>
            </div>
          )}

          {conversation.map((msg, i) => (
            <div key={i} style={{
              ...STYLES.messageContainer,
              justifyContent: msg.role === 'user' ? 'flex-end' : 'flex-start',
            }}>
              <div style={msg.role === 'user' ? STYLES.userMessage : STYLES.aiMessage}>
                {msg.content}
              </div>
            </div>
          ))}

          {loading && (
            <div style={{ ...STYLES.messageContainer, justifyContent: 'flex-start' }}>
              <div style={STYLES.loadingMessage}>
                <div style={{
                  width: '6px',
                  height: '6px',
                  backgroundColor: '#6b7280',
                  borderRadius: '50%',
                  animation: 'pulse 1.5s ease-in-out infinite',
                }}></div>
                Generating...
              </div>
            </div>
          )}

          <div ref={chatEndRef} />
        </div>

        <form onSubmit={handleSend} style={STYLES.inputForm}>
          <input
            type="text"
            value={input}
            onChange={e => setInput(e.target.value)}
            placeholder="Describe your UI or give feedback..."
            style={STYLES.textInput}
            disabled={loading}
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
              ...(loading || !input.trim() ? STYLES.sendButtonDisabled : {}),
            }}
            onMouseEnter={(e) => {
              if (!loading && input.trim()) {
                e.currentTarget.style.transform = 'translateY(-1px)';
                e.currentTarget.style.boxShadow = '0 4px 16px rgba(16, 185, 129, 0.4)';
              }
            }}
            onMouseLeave={(e) => {
              if (!loading && input.trim()) {
                e.currentTarget.style.transform = 'translateY(0)';
                e.currentTarget.style.boxShadow = '0 2px 8px rgba(16, 185, 129, 0.3)';
              }
            }}
          >
            {loading ? '...' : 'Send'}
          </button>
        </form>

        {error && <div style={STYLES.errorMessage}>{error}</div>}
      </div>

      {/* Add keyframes animation for loading pulse */}
      <style>
        {`
          @keyframes pulse {
            0%, 100% { opacity: 0.4; }
            50% { opacity: 1; }
          }
        `}
      </style>
    </div>
  );
};

export default StoryUIPanel;
