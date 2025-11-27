import React, { useState, useRef, useEffect, useCallback, ReactNode } from 'react';

// Get the Edge MCP URL from environment or use default
const EDGE_MCP_URL = (import.meta as any).env?.VITE_EDGE_MCP_URL || 'https://story-ui-mcp-edge.southleft-llc.workers.dev';

// MCP JSON-RPC client for communicating with Edge worker
interface MCPRequest {
  jsonrpc: '2.0';
  id: number;
  method: string;
  params?: Record<string, unknown>;
}

interface MCPResponse {
  jsonrpc: '2.0';
  id: number;
  result?: unknown;
  error?: { code: number; message: string; data?: unknown };
}

// Message type
interface Message {
  role: 'user' | 'ai';
  content: string;
}

// Chat session type
interface ChatSession {
  id: string;
  title: string;
  conversation: Message[];
  lastUpdated: number;
}

// MCP Client class for edge communication
class EdgeMCPClient {
  private baseUrl: string;
  private sessionId: string | null = null;
  private requestId = 0;

  constructor(baseUrl: string) {
    this.baseUrl = baseUrl;
  }

  private getNextId(): number {
    return ++this.requestId;
  }

  async initialize(): Promise<{ sessionId: string; serverInfo: unknown }> {
    const response = await fetch(`${this.baseUrl}/mcp-remote/mcp`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: this.getNextId(),
        method: 'initialize',
        params: {
          protocolVersion: '2024-11-05',
          capabilities: {},
          clientInfo: { name: 'story-ui-chat', version: '1.0.0' }
        }
      } as MCPRequest)
    });

    const sessionId = response.headers.get('mcp-session-id');
    if (sessionId) {
      this.sessionId = sessionId;
    }

    const data: MCPResponse = await response.json();
    if (data.error) {
      throw new Error(data.error.message);
    }

    return { sessionId: this.sessionId || '', serverInfo: data.result };
  }

  async listTools(): Promise<{ tools: Array<{ name: string; description: string }> }> {
    const response = await fetch(`${this.baseUrl}/mcp-remote/mcp`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(this.sessionId ? { 'mcp-session-id': this.sessionId } : {})
      },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: this.getNextId(),
        method: 'tools/list',
        params: {}
      } as MCPRequest)
    });

    const data: MCPResponse = await response.json();
    if (data.error) {
      throw new Error(data.error.message);
    }

    return data.result as { tools: Array<{ name: string; description: string }> };
  }

  async callTool(name: string, args: Record<string, unknown>): Promise<unknown> {
    const response = await fetch(`${this.baseUrl}/mcp-remote/mcp`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(this.sessionId ? { 'mcp-session-id': this.sessionId } : {})
      },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: this.getNextId(),
        method: 'tools/call',
        params: { name, arguments: args }
      } as MCPRequest)
    });

    const data: MCPResponse = await response.json();
    if (data.error) {
      throw new Error(data.error.message);
    }

    return data.result;
  }

  async checkHealth(): Promise<boolean> {
    try {
      const response = await fetch(`${this.baseUrl}/mcp-remote/health`);
      return response.ok;
    } catch {
      return false;
    }
  }
}

// Simple markdown renderer
const renderMarkdown = (text: string): ReactNode => {
  const paragraphs = text.split(/\n\n+/);

  const parseInline = (str: string, paragraphIndex: number): ReactNode[] => {
    const parts: ReactNode[] = [];
    let remaining = str;
    let keyIndex = 0;

    while (remaining.length > 0) {
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
        parts.push(<em key={`i-${paragraphIndex}-${keyIndex++}`}>{italicMatch[1]}</em>);
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
              padding: '1px 5px',
              borderRadius: '3px',
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

      if (remaining.startsWith('\n')) {
        parts.push(' ');
        remaining = remaining.slice(1);
        continue;
      }

      const nextSpecial = remaining.search(/[*_`\n]/);
      if (nextSpecial === -1) {
        parts.push(remaining);
        remaining = '';
      } else if (nextSpecial === 0) {
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
        <div key={`p-${index}`} style={{ marginBottom: index < paragraphs.length - 1 ? '12px' : 0 }}>
          {parseInline(paragraph.trim(), index)}
        </div>
      ))}
    </>
  );
};

// Storage helpers
const STORAGE_KEY = 'story-ui-edge-chats';
const MAX_RECENT_CHATS = 20;

const loadChats = (): ChatSession[] => {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (!stored) return [];
    return JSON.parse(stored).sort((a: ChatSession, b: ChatSession) => b.lastUpdated - a.lastUpdated).slice(0, MAX_RECENT_CHATS);
  } catch {
    return [];
  }
};

const saveChats = (chats: ChatSession[]) => {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(chats.slice(0, MAX_RECENT_CHATS)));
  } catch (e) {
    console.error('Failed to save chats:', e);
  }
};

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

// Component styles
const STYLES = {
  container: {
    display: 'flex',
    flexDirection: 'row' as const,
    fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", "Roboto", sans-serif',
    height: '100vh',
    overflow: 'hidden',
    background: 'linear-gradient(135deg, #1e293b 0%, #334155 100%)',
    color: '#e2e8f0',
  },
  sidebar: {
    width: '240px',
    background: 'rgba(255, 255, 255, 0.03)',
    borderRight: '1px solid rgba(255, 255, 255, 0.08)',
    display: 'flex',
    flexDirection: 'column' as const,
    backdropFilter: 'blur(10px)',
  },
  sidebarCollapsed: {
    width: '56px',
  },
  newChatButton: {
    width: '100%',
    padding: '10px 14px',
    background: '#3b82f6',
    color: 'white',
    border: 'none',
    borderRadius: '8px',
    fontSize: '14px',
    fontWeight: '500',
    cursor: 'pointer',
    marginBottom: '16px',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    gap: '8px',
  },
  chatItem: {
    padding: '10px 12px',
    marginBottom: '4px',
    background: 'rgba(255, 255, 255, 0.05)',
    borderRadius: '8px',
    cursor: 'pointer',
    position: 'relative' as const,
  },
  chatItemActive: {
    background: 'rgba(59, 130, 246, 0.15)',
    borderLeft: '3px solid #3b82f6',
  },
  mainContent: {
    flex: 1,
    display: 'flex',
    flexDirection: 'column' as const,
    overflow: 'hidden',
  },
  chatHeader: {
    padding: '16px 20px',
    borderBottom: '1px solid rgba(255, 255, 255, 0.08)',
    background: 'rgba(255, 255, 255, 0.03)',
  },
  chatContainer: {
    flex: 1,
    padding: '20px',
    overflowY: 'auto' as const,
  },
  messageContainer: {
    display: 'flex',
    marginBottom: '12px',
  },
  userMessage: {
    background: '#3b82f6',
    color: '#ffffff',
    borderRadius: '16px 16px 4px 16px',
    padding: '12px 16px',
    maxWidth: '85%',
    marginLeft: 'auto',
    fontSize: '14px',
    lineHeight: '1.5',
  },
  aiMessage: {
    background: 'rgba(255, 255, 255, 0.95)',
    color: '#1f2937',
    borderRadius: '16px 16px 16px 4px',
    padding: '12px 16px',
    maxWidth: '85%',
    fontSize: '14px',
    lineHeight: '1.5',
    boxShadow: '0 1px 3px rgba(0, 0, 0, 0.08)',
  },
  inputForm: {
    display: 'flex',
    alignItems: 'center',
    gap: '12px',
    margin: '0 20px 20px 20px',
    padding: '12px',
    background: 'rgba(255, 255, 255, 0.03)',
    borderRadius: '12px',
    border: '1px solid rgba(255, 255, 255, 0.08)',
  },
  textInput: {
    flex: 1,
    padding: '12px 16px',
    borderRadius: '8px',
    border: '1px solid rgba(255, 255, 255, 0.15)',
    fontSize: '14px',
    color: '#1f2937',
    background: '#ffffff',
    outline: 'none',
  },
  sendButton: {
    padding: '12px 20px',
    borderRadius: '8px',
    border: 'none',
    background: '#10b981',
    color: '#ffffff',
    fontSize: '14px',
    fontWeight: '500',
    cursor: 'pointer',
    display: 'flex',
    alignItems: 'center',
    gap: '6px',
  },
  errorMessage: {
    background: 'rgba(248, 113, 113, 0.1)',
    color: '#f87171',
    padding: '10px 14px',
    borderRadius: '8px',
    fontSize: '14px',
    marginBottom: '12px',
    border: '1px solid rgba(248, 113, 113, 0.2)',
  },
};

// Add loading animation
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

// Main App component
function App() {
  const [input, setInput] = useState('');
  const [conversation, setConversation] = useState<Message[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [recentChats, setRecentChats] = useState<ChatSession[]>([]);
  const [activeChatId, setActiveChatId] = useState<string | null>(null);
  const [activeTitle, setActiveTitle] = useState<string>('');
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [connectionStatus, setConnectionStatus] = useState<{ connected: boolean; error?: string }>({ connected: false });
  const [mcpClient] = useState(() => new EdgeMCPClient(EDGE_MCP_URL));
  const [availableTools, setAvailableTools] = useState<Array<{ name: string; description: string }>>([]);
  const chatEndRef = useRef<HTMLDivElement | null>(null);

  // Initialize connection and load chats
  useEffect(() => {
    const initializeApp = async () => {
      // Check health first
      const isHealthy = await mcpClient.checkHealth();
      if (!isHealthy) {
        setConnectionStatus({ connected: false, error: 'Edge server not reachable' });
        setRecentChats(loadChats());
        return;
      }

      try {
        // Initialize MCP session
        await mcpClient.initialize();

        // Get available tools
        const { tools } = await mcpClient.listTools();
        setAvailableTools(tools);

        setConnectionStatus({ connected: true });

        // Load chats
        const chats = loadChats();
        setRecentChats(chats);

        if (chats.length > 0) {
          setConversation(chats[0].conversation);
          setActiveChatId(chats[0].id);
          setActiveTitle(chats[0].title);
        }
      } catch (err) {
        setConnectionStatus({ connected: false, error: err instanceof Error ? err.message : 'Connection failed' });
        setRecentChats(loadChats());
      }
    };

    initializeApp();
  }, [mcpClient]);

  // Scroll to bottom on new message
  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [conversation, loading]);

  const handleSend = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    if (!input.trim()) return;

    const userInput = input.trim();
    setError(null);
    setLoading(true);

    const userMessage: Message = { role: 'user', content: userInput };
    const newConversation = [...conversation, userMessage];
    setConversation(newConversation);
    setInput('');

    try {
      // Use MCP to generate story
      const result = await mcpClient.callTool('generate-story', {
        prompt: userInput,
        framework: 'react', // Default framework
        targetPath: './stories'
      });

      const response = result as { content: Array<{ type: string; text: string }> };
      const textContent = response.content?.find(c => c.type === 'text');
      const aiResponse = textContent?.text || 'Story generation completed!';

      const aiMessage: Message = { role: 'ai', content: aiResponse };
      const updatedConversation = [...newConversation, aiMessage];
      setConversation(updatedConversation);

      // Update chat session
      const chatId = activeChatId || Date.now().toString();
      const chatTitle = activeTitle || userInput.slice(0, 50);

      if (!activeChatId) {
        setActiveChatId(chatId);
        setActiveTitle(chatTitle);
      }

      const session: ChatSession = {
        id: chatId,
        title: chatTitle,
        conversation: updatedConversation,
        lastUpdated: Date.now(),
      };

      const chats = loadChats().filter(c => c.id !== chatId);
      chats.unshift(session);
      saveChats(chats);
      setRecentChats(chats);
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'Unknown error';
      setError(errorMessage);
      const errorConversation = [...newConversation, { role: 'ai' as const, content: `Error: ${errorMessage}` }];
      setConversation(errorConversation);
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

  const handleDeleteChat = (chatId: string, e: React.MouseEvent) => {
    e.stopPropagation();
    if (confirm('Delete this chat?')) {
      const updatedChats = recentChats.filter(chat => chat.id !== chatId);
      setRecentChats(updatedChats);
      saveChats(updatedChats);

      if (activeChatId === chatId) {
        if (updatedChats.length > 0) {
          handleSelectChat(updatedChats[0]);
        } else {
          handleNewChat();
        }
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
        {sidebarOpen && (
          <div style={{ flex: 1, overflowY: 'auto', padding: '16px' }}>
            <button
              onClick={() => setSidebarOpen(false)}
              style={{ ...STYLES.newChatButton, background: 'rgba(255,255,255,0.1)', marginBottom: '8px' }}
            >
              <span>☰</span>
              <span>Chats</span>
            </button>
            <button onClick={handleNewChat} style={STYLES.newChatButton}>
              <span>+</span>
              <span>New Chat</span>
            </button>
            {recentChats.length > 0 && (
              <div style={{ color: '#64748b', fontSize: '12px', marginBottom: '8px', fontWeight: '500', textTransform: 'uppercase' }}>
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
              >
                <div style={{ fontSize: '13px', fontWeight: '500', marginBottom: '2px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {chat.title}
                </div>
                <div style={{ fontSize: '11px', color: '#94a3b8' }}>{formatTime(chat.lastUpdated)}</div>
                <button
                  onClick={(e) => handleDeleteChat(chat.id, e)}
                  style={{
                    position: 'absolute',
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
                  }}
                  onMouseEnter={(e) => { (e.target as HTMLElement).style.opacity = '1'; }}
                  onMouseLeave={(e) => { (e.target as HTMLElement).style.opacity = '0'; }}
                >
                  ✕
                </button>
              </div>
            ))}
          </div>
        )}
        {!sidebarOpen && (
          <div style={{ padding: '8px', display: 'flex', justifyContent: 'center' }}>
            <button
              onClick={() => setSidebarOpen(true)}
              style={{ ...STYLES.newChatButton, width: '40px', height: '40px', padding: '0', borderRadius: '8px' }}
            >
              ☰
            </button>
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
            Generate Storybook stories with AI (Edge Deployment)
          </p>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginTop: '8px', fontSize: '12px' }}>
            <div style={{
              width: '8px',
              height: '8px',
              borderRadius: '50%',
              backgroundColor: connectionStatus.connected ? '#10b981' : '#f87171'
            }} />
            <span style={{ color: connectionStatus.connected ? '#10b981' : '#f87171' }}>
              {connectionStatus.connected
                ? `Connected to Edge MCP`
                : `Disconnected: ${connectionStatus.error || 'Server not running'}`
              }
            </span>
          </div>
          {availableTools.length > 0 && (
            <div style={{ fontSize: '11px', color: '#64748b', marginTop: '4px' }}>
              Available tools: {availableTools.map(t => t.name).join(', ')}
            </div>
          )}
        </div>

        <div style={STYLES.chatContainer}>
          {error && <div style={STYLES.errorMessage}>{error}</div>}

          {conversation.length === 0 && !loading && (
            <div style={{ color: '#94a3b8', textAlign: 'center', marginTop: '60px' }}>
              <div style={{ fontSize: '16px', fontWeight: '500', marginBottom: '8px', color: '#cbd5e1' }}>
                Start a new conversation
              </div>
              <div style={{ fontSize: '13px', color: '#64748b' }}>
                Describe the UI component you'd like to create
              </div>
            </div>
          )}

          {conversation.map((msg, i) => (
            <div key={i} style={STYLES.messageContainer}>
              <div style={msg.role === 'user' ? STYLES.userMessage : STYLES.aiMessage}>
                {msg.role === 'ai' ? renderMarkdown(msg.content) : msg.content}
              </div>
            </div>
          ))}

          {loading && (
            <div style={STYLES.messageContainer}>
              <div style={{ ...STYLES.aiMessage, color: '#6b7280', display: 'flex', alignItems: 'center', gap: '6px' }}>
                <span>Generating story</span>
                <span className="loading-dots"></span>
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
            placeholder="Describe a UI component..."
            style={STYLES.textInput}
            disabled={!connectionStatus.connected}
          />
          <button
            type="submit"
            disabled={loading || !input.trim() || !connectionStatus.connected}
            style={{
              ...STYLES.sendButton,
              ...(loading || !input.trim() || !connectionStatus.connected ? {
                opacity: 0.5,
                cursor: 'not-allowed',
                background: '#6b7280',
              } : {})
            }}
          >
            <span>Send</span>
            <svg width={16} height={16} viewBox="0 0 24 24" fill="currentColor">
              <path d="M2.01 21L23 12 2.01 3 2 10l15 2-15 2z"/>
            </svg>
          </button>
        </form>
      </div>
    </div>
  );
}

export default App;
