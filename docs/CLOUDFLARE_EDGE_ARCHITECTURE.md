# Story UI Edge Deployment Architecture

## Cloudflare Workers + Durable Objects MCP Remote Server

**Version:** 1.0.0
**Last Updated:** 2025-11-27
**Status:** Technical Design Document

---

## Executive Summary

This document outlines the architecture for deploying Story UI's MCP (Model Context Protocol) server to Cloudflare's edge network. The design leverages Cloudflare Workers for request routing, Durable Objects for stateful session management, and the new Streamable HTTP transport for MCP communication.

### Key Benefits
- **Global Edge Distribution**: ~200ms latency reduction for international users
- **Cost-Optimized Sessions**: WebSocket Hibernation reduces costs by 90%+
- **Scalable Architecture**: Horizontal scaling via globally distributed Durable Objects
- **Backward Compatible**: Supports both SSE (legacy) and Streamable HTTP (new) transports

---

## Architecture Overview

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                          MCP CLIENT LAYER                                    │
│         Claude Desktop / Cursor / Custom Clients via mcp-remote             │
└──────────────────────────────────┬──────────────────────────────────────────┘
                                   │
                    ┌──────────────┴──────────────┐
                    │  Streamable HTTP / SSE      │
                    │  (Dual Transport Support)   │
                    └──────────────┬──────────────┘
                                   │
┌──────────────────────────────────▼──────────────────────────────────────────┐
│                    CLOUDFLARE WORKERS (Gateway)                              │
│  ┌────────────────────────────────────────────────────────────────────────┐ │
│  │  • HTTP request routing & validation                                   │ │
│  │  • OAuth authentication (workers-oauth-provider)                       │ │
│  │  • Rate limiting & abuse protection                                    │ │
│  │  • Session routing to appropriate Durable Object                       │ │
│  │  • Health checks & monitoring                                          │ │
│  └────────────────────────────────────────────────────────────────────────┘ │
└──────────────────────────────────┬──────────────────────────────────────────┘
                                   │
                        ┌──────────┴──────────┐
                        │  Durable Object ID  │
                        │  (Session Routing)  │
                        └──────────┬──────────┘
                                   │
┌──────────────────────────────────▼──────────────────────────────────────────┐
│              DURABLE OBJECTS (Per-Session MCP Coordinator)                   │
│  ┌────────────────────────────────────────────────────────────────────────┐ │
│  │  McpAgent Instance (one per authenticated session)                     │ │
│  │  ┌──────────────────────────────────────────────────────────────────┐  │ │
│  │  │  • WebSocket Hibernation (cost-optimized idle state)             │  │ │
│  │  │  • SQLite Storage (conversation history, component metadata)      │  │ │
│  │  │  • Single-threaded message coordination                          │  │ │
│  │  │  • Tool execution orchestration                                  │  │ │
│  │  │  • State persistence across reconnections                        │  │ │
│  │  └──────────────────────────────────────────────────────────────────┘  │ │
│  └────────────────────────────────────────────────────────────────────────┘ │
└──────────────────────────────────┬──────────────────────────────────────────┘
                                   │
              ┌────────────────────┼────────────────────┐
              │                    │                    │
              ▼                    ▼                    ▼
    ┌─────────────────┐  ┌─────────────────┐  ┌─────────────────┐
    │  LLM PROVIDERS  │  │  CLOUDFLARE KV  │  │  CLOUDFLARE R2  │
    │                 │  │                 │  │                 │
    │  • Anthropic    │  │  • Component    │  │  • Generated    │
    │  • OpenAI       │  │    metadata     │  │    stories      │
    │  • Google AI    │  │  • Config cache │  │  • Large assets │
    │  • Workers AI   │  │  • User prefs   │  │  • Backups      │
    └─────────────────┘  └─────────────────┘  └─────────────────┘
```

---

## Component Details

### 1. Gateway Worker (`src/worker.ts`)

The entry point for all MCP requests. Handles:

```typescript
export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);

    // Health check endpoint
    if (url.pathname === '/mcp-remote/health') {
      return handleHealthCheck(env);
    }

    // MCP endpoints - route to Durable Object
    if (url.pathname.startsWith('/mcp-remote/')) {
      return handleMCPRequest(request, env);
    }

    return new Response('Not Found', { status: 404 });
  }
};
```

**Key Responsibilities:**
- Request validation and sanitization
- Authentication via OAuth or API keys
- Rate limiting per client/session
- Routing to appropriate Durable Object instance

### 2. MCP Session Durable Object (`src/mcp-session.ts`)

Maintains per-session state and handles MCP protocol:

```typescript
export class MCPSessionDO implements DurableObject {
  private state: DurableObjectState;
  private env: Env;
  private mcpServer: Server;
  private sessions: Map<string, WebSocket> = new Map();

  constructor(state: DurableObjectState, env: Env) {
    this.state = state;
    this.env = env;
    this.mcpServer = this.createMcpServer();
  }

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);

    switch (url.pathname) {
      case '/sse':
        return this.handleSSE(request);
      case '/messages':
        return this.handleMessages(request);
      case '/mcp':
        return this.handleStreamableHTTP(request);
      default:
        return new Response('Not Found', { status: 404 });
    }
  }

  // WebSocket hibernation for cost optimization
  async webSocketMessage(ws: WebSocket, message: ArrayBuffer | string) {
    // Process MCP message
    const data = JSON.parse(message as string);
    const response = await this.mcpServer.handleMessage(data);
    ws.send(JSON.stringify(response));
  }

  async webSocketClose(ws: WebSocket, code: number, reason: string) {
    // Cleanup session state
    await this.state.storage.delete(`session:${ws.id}`);
  }
}
```

**Storage Schema (SQLite):**
```sql
-- Session metadata
CREATE TABLE sessions (
  id TEXT PRIMARY KEY,
  client_id TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  last_active INTEGER NOT NULL,
  config JSON
);

-- Generated stories (temporary, sync to R2 periodically)
CREATE TABLE stories (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL,
  title TEXT,
  content TEXT,
  component_path TEXT,
  created_at INTEGER NOT NULL,
  FOREIGN KEY (session_id) REFERENCES sessions(id)
);

-- Component metadata cache
CREATE TABLE components (
  path TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  props JSON,
  discovered_at INTEGER NOT NULL
);
```

### 3. Storage Layer

**Cloudflare KV (Low-latency reads):**
- Component metadata cache
- User configuration
- Framework detection results

**Cloudflare R2 (Persistent storage):**
- Generated story files
- Large assets
- Backup/export data

**Durable Object SQLite (Session-scoped):**
- Active conversation state
- Pending tool executions
- Recent story history

### 4. MCP Tool Implementation

```typescript
const STORY_UI_TOOLS: Tool[] = [
  {
    name: 'generate-story',
    description: 'Generate a Storybook story for a component',
    inputSchema: {
      type: 'object',
      properties: {
        prompt: { type: 'string', description: 'Description of the story to generate' },
        componentPath: { type: 'string', description: 'Path to the component' },
        framework: { type: 'string', enum: ['react', 'vue', 'angular', 'svelte'] }
      },
      required: ['prompt']
    }
  },
  {
    name: 'list-components',
    description: 'List all discovered components in the project',
    inputSchema: {
      type: 'object',
      properties: {
        filter: { type: 'string', description: 'Filter components by name pattern' }
      }
    }
  },
  {
    name: 'list-stories',
    description: 'List all generated stories',
    inputSchema: {
      type: 'object',
      properties: {
        limit: { type: 'number', default: 50 }
      }
    }
  },
  {
    name: 'get-story',
    description: 'Get content of a specific story',
    inputSchema: {
      type: 'object',
      properties: {
        id: { type: 'string', description: 'Story ID' }
      },
      required: ['id']
    }
  },
  {
    name: 'delete-story',
    description: 'Delete a generated story',
    inputSchema: {
      type: 'object',
      properties: {
        id: { type: 'string', description: 'Story ID' }
      },
      required: ['id']
    }
  },
  {
    name: 'get-component-props',
    description: 'Get TypeScript props for a component',
    inputSchema: {
      type: 'object',
      properties: {
        componentPath: { type: 'string', description: 'Path to component file' }
      },
      required: ['componentPath']
    }
  }
];
```

---

## Transport Protocol Support

### Streamable HTTP (Recommended - MCP 2025 Standard)

```typescript
async handleStreamableHTTP(request: Request): Promise<Response> {
  if (request.method === 'POST') {
    const message = await request.json();

    // Check if response should be streamed
    if (this.requiresStreaming(message)) {
      const { readable, writable } = new TransformStream();
      const writer = writable.getWriter();

      // Process with streaming callback
      this.mcpServer.handleMessage(message, async (chunk) => {
        await writer.write(new TextEncoder().encode(JSON.stringify(chunk) + '\n'));
      }).then(() => writer.close());

      return new Response(readable, {
        headers: { 'Content-Type': 'application/x-ndjson' }
      });
    }

    // Standard JSON response
    const response = await this.mcpServer.handleMessage(message);
    return new Response(JSON.stringify(response), {
      headers: { 'Content-Type': 'application/json' }
    });
  }

  return new Response('Method Not Allowed', { status: 405 });
}
```

### SSE (Legacy Support)

```typescript
async handleSSE(request: Request): Promise<Response> {
  const sessionId = crypto.randomUUID();

  const { readable, writable } = new TransformStream();
  const writer = writable.getWriter();
  const encoder = new TextEncoder();

  // Send endpoint event
  await writer.write(encoder.encode(
    `event: endpoint\ndata: /mcp-remote/messages?sessionId=${sessionId}\n\n`
  ));

  // Store session for message handling
  await this.state.storage.put(`sse:${sessionId}`, {
    writer,
    createdAt: Date.now()
  });

  return new Response(readable, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive'
    }
  });
}
```

---

## Cost Analysis

### Pricing Breakdown (100 concurrent sessions)

| Component | Without Hibernation | With Hibernation | Savings |
|-----------|---------------------|------------------|---------|
| **Workers Requests** | ~$0.15/month | ~$0.15/month | - |
| **DO Duration** | ~$3,000/month | ~$7/month | 99.8% |
| **DO Requests** | ~$1.35/month | ~$1.35/month | - |
| **KV Storage** | ~$0.50/month | ~$0.50/month | - |
| **R2 Storage** | ~$0.015/GB/month | ~$0.015/GB/month | - |
| **Total** | ~$3,002/month | ~$9/month | **99.7%** |

### Cost Optimization Strategies

1. **WebSocket Hibernation** (Essential)
   - Durable Objects hibernate during idle periods
   - Only charged for active message processing
   - Automatic in McpAgent class

2. **Aggressive Caching**
   - Component metadata in KV (15-minute TTL)
   - Story content in R2 with edge caching
   - Framework detection cached per-project

3. **Batch Operations**
   - Group multiple tool calls into single RPC
   - Reduce WebSocket message count (20:1 billing ratio)

4. **Session Consolidation**
   - Reuse DO instances for related sessions
   - Share component cache across sessions

---

## Security Architecture

### Authentication Flow

```
┌─────────────┐     ┌─────────────────┐     ┌─────────────────┐
│   Claude    │────▶│  OAuth Provider │────▶│  Story UI Edge  │
│   Desktop   │     │  (Cloudflare)   │     │     Worker      │
└─────────────┘     └─────────────────┘     └─────────────────┘
                            │
                            ▼
                    ┌─────────────────┐
                    │   JWT Token     │
                    │   Validation    │
                    └─────────────────┘
```

### Security Measures

1. **OAuth 2.0 with PKCE**
   - Using `workers-oauth-provider` package
   - Secure token exchange
   - Refresh token rotation

2. **API Key Authentication** (Alternative)
   - For headless/automated clients
   - Scoped permissions per key
   - Rate limiting per key

3. **Request Validation**
   - JSON-RPC 2.0 schema validation
   - Input sanitization
   - Maximum payload size enforcement

4. **Transport Security**
   - HTTPS only (Cloudflare enforced)
   - TLS 1.3 minimum
   - Certificate pinning optional

---

## Deployment Configuration

### wrangler.toml

```toml
name = "story-ui-mcp-edge"
main = "src/worker.ts"
compatibility_date = "2024-11-01"
compatibility_flags = ["nodejs_compat"]

[vars]
STORY_UI_VERSION = "3.0.0"

[[kv_namespaces]]
binding = "COMPONENTS_KV"
id = "YOUR_KV_NAMESPACE_ID"

[[r2_buckets]]
binding = "STORIES_R2"
bucket_name = "story-ui-stories"

[[durable_objects.bindings]]
name = "MCP_SESSIONS"
class_name = "MCPSessionDO"

[[migrations]]
tag = "v1"
new_classes = ["MCPSessionDO"]

[ai]
binding = "AI"
```

### Environment Variables

```bash
# Required
ANTHROPIC_API_KEY=sk-ant-...
OPENAI_API_KEY=sk-...

# Optional
GOOGLE_AI_API_KEY=...
DEFAULT_LLM_PROVIDER=anthropic
DEFAULT_MODEL=claude-sonnet-4-20250514

# OAuth (if enabled)
OAUTH_CLIENT_ID=...
OAUTH_CLIENT_SECRET=...
```

---

## Implementation Phases

### Phase 1: Core Infrastructure (Week 1-2)
- [ ] Set up Cloudflare Workers project structure
- [ ] Implement Durable Object session manager
- [ ] Create Cloudflare-compatible SSE transport
- [ ] Port existing MCP tools to edge-compatible format
- [ ] Basic health check and monitoring

### Phase 2: Storage Integration (Week 2-3)
- [ ] Implement KV-backed component cache
- [ ] Create R2 story storage adapter
- [ ] SQLite session state management
- [ ] Implement storage abstraction layer

### Phase 3: Transport & Protocol (Week 3-4)
- [ ] Add Streamable HTTP transport support
- [ ] Implement WebSocket hibernation
- [ ] Message queue for reliability
- [ ] Connection recovery handling

### Phase 4: Security & Auth (Week 4-5)
- [ ] OAuth integration with workers-oauth-provider
- [ ] API key authentication alternative
- [ ] Rate limiting implementation
- [ ] Audit logging

### Phase 5: Testing & Deployment (Week 5-6)
- [ ] Unit tests for all components
- [ ] Integration tests with mock DO
- [ ] Load testing (target: 1000 concurrent sessions)
- [ ] Staging deployment and validation
- [ ] Production rollout with canary

---

## Monitoring & Observability

### Metrics to Track

```typescript
// Custom analytics
interface MCPMetrics {
  sessionCount: number;
  activeConnections: number;
  toolExecutions: Record<string, number>;
  avgResponseTime: number;
  errorRate: number;
  storageUsage: {
    kv: number;
    r2: number;
    sqlite: number;
  };
}
```

### Logging Strategy

- **Worker logs**: Request routing, auth events
- **DO logs**: Session lifecycle, tool executions
- **Tail workers**: Real-time debugging in production

### Alerting

- Session failure rate > 1%
- Average latency > 500ms
- Storage approaching limits
- Authentication failures spike

---

## Migration Path from Current Implementation

### Compatibility Layer

The edge deployment maintains backward compatibility with existing clients:

```typescript
// URL mapping
/mcp-remote/sse        → Edge SSE transport
/mcp-remote/messages   → Edge message handler
/mcp-remote/health     → Edge health check
/mcp-remote/mcp        → NEW: Streamable HTTP transport

// Tool compatibility
All 8 existing tools remain available with identical schemas
```

### Client Configuration

**Claude Desktop (claude_desktop_config.json):**
```json
{
  "mcpServers": {
    "story-ui": {
      "url": "https://story-ui-mcp-edge.YOUR_SUBDOMAIN.workers.dev/mcp-remote/sse",
      "transport": "sse"
    }
  }
}
```

**New Streamable HTTP (recommended):**
```json
{
  "mcpServers": {
    "story-ui": {
      "url": "https://story-ui-mcp-edge.YOUR_SUBDOMAIN.workers.dev/mcp-remote/mcp",
      "transport": "streamable-http"
    }
  }
}
```

---

## References

- [Cloudflare Agents SDK - MCP Documentation](https://developers.cloudflare.com/agents/model-context-protocol/)
- [Build and Deploy Remote MCP Servers to Cloudflare](https://blog.cloudflare.com/remote-model-context-protocol-servers-mcp/)
- [Streamable HTTP Transport and Python Support](https://blog.cloudflare.com/streamable-http-mcp-servers-python/)
- [Durable Objects - WebSocket Hibernation](https://developers.cloudflare.com/durable-objects/examples/websocket-hibernation-server/)
- [MCP Specification - Transports](https://modelcontextprotocol.io/docs/concepts/transports)
- [Cloudflare Workers Pricing](https://developers.cloudflare.com/workers/platform/pricing/)
