/**
 * Story UI MCP Edge Worker
 *
 * Entry point for Cloudflare Workers deployment.
 * Routes requests to Durable Objects for session management.
 */

import type { Env, HealthResponse } from './types.js';

// Re-export Durable Object
export { MCPSessionDO } from './mcp-session.js';

export default {
  async fetch(request: Request, env: Env, _ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);

    // Handle CORS preflight
    if (request.method === 'OPTIONS') {
      return handleCORS();
    }

    try {
      // Route based on path
      if (url.pathname === '/mcp-remote/health' || url.pathname === '/health') {
        return handleHealthCheck(env);
      }

      if (url.pathname.startsWith('/mcp-remote/')) {
        return handleMCPRequest(request, env, url);
      }

      // Default response
      return new Response(
        JSON.stringify({
          service: 'story-ui-mcp-edge',
          version: env.STORY_UI_VERSION,
          endpoints: {
            health: '/mcp-remote/health',
            sse: '/mcp-remote/sse',
            messages: '/mcp-remote/messages',
            streamable: '/mcp-remote/mcp',
          },
        }),
        {
          headers: {
            'Content-Type': 'application/json',
            'Access-Control-Allow-Origin': '*',
          },
        }
      );
    } catch (error) {
      console.error('Worker error:', error);
      return new Response(
        JSON.stringify({ error: 'Internal Server Error' }),
        {
          status: 500,
          headers: {
            'Content-Type': 'application/json',
            'Access-Control-Allow-Origin': '*',
          }
        }
      );
    }
  },
};

/**
 * Handle CORS preflight requests
 */
function handleCORS(): Response {
  return new Response(null, {
    status: 204,
    headers: {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, DELETE, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization',
      'Access-Control-Max-Age': '86400',
    },
  });
}

/**
 * Handle health check at gateway level
 */
function handleHealthCheck(env: Env): Response {
  const health: HealthResponse = {
    status: 'ok',
    service: 'story-ui-mcp-edge',
    version: env.STORY_UI_VERSION,
    transport: 'cloudflare-workers',
    activeSessions: 0, // Gateway doesn't track sessions
    timestamp: new Date().toISOString(),
  };

  return new Response(JSON.stringify(health), {
    headers: {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': '*',
    },
  });
}

/**
 * Route MCP requests to Durable Object
 */
async function handleMCPRequest(
  request: Request,
  env: Env,
  url: URL
): Promise<Response> {
  // Determine session ID for DO routing
  // For SSE, use a fixed ID per client (could be from auth token)
  // For messages, extract from query string
  const sessionId = url.searchParams.get('sessionId') || 'default-session';

  // Get Durable Object stub
  const doId = env.MCP_SESSIONS.idFromName(sessionId);
  const stub = env.MCP_SESSIONS.get(doId);

  // Map URL path for DO
  const doPath = url.pathname.replace('/mcp-remote', '');
  const doUrl = new URL(doPath + url.search, 'http://internal');

  // Forward request to Durable Object
  return stub.fetch(new Request(doUrl.toString(), {
    method: request.method,
    headers: request.headers,
    body: request.body,
  }));
}
