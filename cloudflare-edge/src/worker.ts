/**
 * Story UI MCP Edge Worker
 *
 * Entry point for Cloudflare Workers deployment.
 * Routes requests to Durable Objects for session management.
 * Also provides HTTP REST API for Story UI panel integration.
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

      // Story UI HTTP API routes (for StoryUIPanel integration)
      if (url.pathname === '/story-ui/stories') {
        return handleStoriesRoute(request, env);
      }

      if (url.pathname === '/story-ui/generate') {
        return handleGenerateRoute(request, env);
      }

      if (url.pathname === '/story-ui/generate-stream') {
        return handleGenerateStreamRoute(request, env);
      }

      if (url.pathname.startsWith('/story-ui/stories/')) {
        return handleStoryByIdRoute(request, env, url);
      }

      if (url.pathname === '/story-ui/delete') {
        return handleDeleteRoute(request, env);
      }

      if (url.pathname === '/story-ui/providers') {
        return handleProvidersRoute(env);
      }

      // Claude LLM proxy endpoint (for production app)
      if (url.pathname === '/story-ui/claude') {
        return handleClaudeRoute(request, env);
      }

      // Story preview - renders the generated story as a live page
      if (url.pathname.startsWith('/story-ui/preview/')) {
        return handlePreviewRoute(request, env, url);
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
            stories: '/story-ui/stories',
            generate: '/story-ui/generate',
            generateStream: '/story-ui/generate-stream',
            providers: '/story-ui/providers',
            preview: '/story-ui/preview/:id',
            claude: '/story-ui/claude',
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

/**
 * Handle /story-ui/stories route
 * GET: List all stories
 * POST: Create a new story (redirect to generate)
 */
async function handleStoriesRoute(request: Request, env: Env): Promise<Response> {
  const sessionId = 'default-session';
  const doId = env.MCP_SESSIONS.idFromName(sessionId);
  const stub = env.MCP_SESSIONS.get(doId);

  if (request.method === 'GET') {
    // List stories via MCP tool call
    const mcpRequest = {
      jsonrpc: '2.0',
      id: Date.now(),
      method: 'tools/call',
      params: {
        name: 'list-stories',
        arguments: { limit: 100 }
      }
    };

    const response = await stub.fetch(new Request('http://internal/mcp', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(mcpRequest)
    }));

    const result = await response.json() as { result?: { content?: Array<{ text?: string }> } };
    const content = result.result?.content?.[0]?.text;
    const stories = content ? JSON.parse(content) : { stories: [] };

    return new Response(JSON.stringify(stories.stories || []), {
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
      }
    });
  }

  return new Response(JSON.stringify({ error: 'Method not allowed' }), {
    status: 405,
    headers: {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': '*',
    }
  });
}

/**
 * Handle /story-ui/generate route
 * POST: Generate a story (non-streaming)
 */
async function handleGenerateRoute(request: Request, env: Env): Promise<Response> {
  if (request.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'Method not allowed' }), {
      status: 405,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
      }
    });
  }

  const body = await request.json() as { prompt?: string; componentPath?: string; framework?: string };
  const { prompt, componentPath, framework } = body;

  if (!prompt) {
    return new Response(JSON.stringify({ error: 'Missing prompt' }), {
      status: 400,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
      }
    });
  }

  const sessionId = 'default-session';
  const doId = env.MCP_SESSIONS.idFromName(sessionId);
  const stub = env.MCP_SESSIONS.get(doId);

  const mcpRequest = {
    jsonrpc: '2.0',
    id: Date.now(),
    method: 'tools/call',
    params: {
      name: 'generate-story',
      arguments: { prompt, componentPath, framework: framework || 'react' }
    }
  };

  const response = await stub.fetch(new Request('http://internal/mcp', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(mcpRequest)
  }));

  const result = await response.json() as { result?: { content?: Array<{ text?: string }> } };
  const content = result.result?.content?.[0]?.text;
  const storyResult = content ? JSON.parse(content) : { error: 'Generation failed' };

  return new Response(JSON.stringify(storyResult), {
    headers: {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': '*',
    }
  });
}

/**
 * Handle /story-ui/generate-stream route
 * POST: Generate a story with streaming (SSE)
 */
async function handleGenerateStreamRoute(request: Request, env: Env): Promise<Response> {
  if (request.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'Method not allowed' }), {
      status: 405,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
      }
    });
  }

  const body = await request.json() as { prompt?: string; componentPath?: string; framework?: string };
  const { prompt, componentPath, framework } = body;

  if (!prompt) {
    return new Response(JSON.stringify({ error: 'Missing prompt' }), {
      status: 400,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
      }
    });
  }

  // Create SSE stream
  const { readable, writable } = new TransformStream();
  const writer = writable.getWriter();
  const encoder = new TextEncoder();

  // Generate story in background and stream progress
  (async () => {
    try {
      // Send initial progress (using correct StreamEvent format)
      await writer.write(encoder.encode(`data: ${JSON.stringify({
        type: 'progress',
        timestamp: Date.now(),
        data: { step: 'initializing', message: 'Starting generation...', progress: 0.1 }
      })}\n\n`));

      const sessionId = 'default-session';
      const doId = env.MCP_SESSIONS.idFromName(sessionId);
      const stub = env.MCP_SESSIONS.get(doId);

      await writer.write(encoder.encode(`data: ${JSON.stringify({
        type: 'progress',
        timestamp: Date.now(),
        data: { step: 'generating', message: 'Generating story...', progress: 0.5 }
      })}\n\n`));

      const mcpRequest = {
        jsonrpc: '2.0',
        id: Date.now(),
        method: 'tools/call',
        params: {
          name: 'generate-story',
          arguments: { prompt, componentPath, framework: framework || 'react' }
        }
      };

      const response = await stub.fetch(new Request('http://internal/mcp', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(mcpRequest)
      }));

      const result = await response.json() as { result?: { content?: Array<{ text?: string }> } };
      const content = result.result?.content?.[0]?.text;
      const storyResult = content ? JSON.parse(content) : { error: 'Generation failed' };

      // Send completion (using correct StreamEvent format with data wrapper)
      await writer.write(encoder.encode(`data: ${JSON.stringify({
        type: 'completion',
        timestamp: Date.now(),
        data: storyResult
      })}\n\n`));
    } catch (error) {
      await writer.write(encoder.encode(`data: ${JSON.stringify({
        type: 'error',
        timestamp: Date.now(),
        data: {
          code: 'GENERATION_FAILED',
          message: 'Generation failed',
          details: error instanceof Error ? error.message : 'Unknown error',
          recoverable: true,
          suggestion: 'Please try again'
        }
      })}\n\n`));
    } finally {
      await writer.close();
    }
  })();

  return new Response(readable, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
      'Access-Control-Allow-Origin': '*',
    }
  });
}

/**
 * Handle /story-ui/stories/:id route
 * GET: Get a specific story
 * DELETE: Delete a specific story
 */
async function handleStoryByIdRoute(request: Request, env: Env, url: URL): Promise<Response> {
  const storyId = url.pathname.replace('/story-ui/stories/', '');

  if (!storyId) {
    return new Response(JSON.stringify({ error: 'Missing story ID' }), {
      status: 400,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
      }
    });
  }

  const sessionId = 'default-session';
  const doId = env.MCP_SESSIONS.idFromName(sessionId);
  const stub = env.MCP_SESSIONS.get(doId);

  if (request.method === 'GET') {
    const mcpRequest = {
      jsonrpc: '2.0',
      id: Date.now(),
      method: 'tools/call',
      params: {
        name: 'get-story',
        arguments: { id: storyId }
      }
    };

    const response = await stub.fetch(new Request('http://internal/mcp', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(mcpRequest)
    }));

    const result = await response.json() as { result?: { content?: Array<{ text?: string }> } };
    const content = result.result?.content?.[0]?.text;
    const story = content ? JSON.parse(content) : null;

    if (!story) {
      return new Response(JSON.stringify({ error: 'Story not found' }), {
        status: 404,
        headers: {
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': '*',
        }
      });
    }

    return new Response(JSON.stringify(story), {
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
      }
    });
  }

  if (request.method === 'DELETE') {
    const mcpRequest = {
      jsonrpc: '2.0',
      id: Date.now(),
      method: 'tools/call',
      params: {
        name: 'delete-story',
        arguments: { id: storyId }
      }
    };

    const response = await stub.fetch(new Request('http://internal/mcp', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(mcpRequest)
    }));

    const result = await response.json() as { result?: { content?: Array<{ text?: string }> } };
    const content = result.result?.content?.[0]?.text;
    const deleteResult = content ? JSON.parse(content) : { success: false };

    return new Response(JSON.stringify(deleteResult), {
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
      }
    });
  }

  return new Response(JSON.stringify({ error: 'Method not allowed' }), {
    status: 405,
    headers: {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': '*',
    }
  });
}

/**
 * Handle /story-ui/delete route (legacy)
 * POST: Delete a story by ID in body
 */
async function handleDeleteRoute(request: Request, env: Env): Promise<Response> {
  if (request.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'Method not allowed' }), {
      status: 405,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
      }
    });
  }

  const body = await request.json() as { id?: string };
  const { id } = body;

  if (!id) {
    return new Response(JSON.stringify({ error: 'Missing story ID' }), {
      status: 400,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
      }
    });
  }

  const sessionId = 'default-session';
  const doId = env.MCP_SESSIONS.idFromName(sessionId);
  const stub = env.MCP_SESSIONS.get(doId);

  const mcpRequest = {
    jsonrpc: '2.0',
    id: Date.now(),
    method: 'tools/call',
    params: {
      name: 'delete-story',
      arguments: { id }
    }
  };

  const response = await stub.fetch(new Request('http://internal/mcp', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(mcpRequest)
  }));

  const result = await response.json() as { result?: { content?: Array<{ text?: string }> } };
  const content = result.result?.content?.[0]?.text;
  const deleteResult = content ? JSON.parse(content) : { success: false };

  return new Response(JSON.stringify(deleteResult), {
    headers: {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': '*',
    }
  });
}

/**
 * Handle /story-ui/providers route
 * GET: Return provider configuration (for UI to show connected status)
 */
function handleProvidersRoute(env: Env): Response {
  // Return a simplified provider config for the edge deployment
  const providers = {
    current: {
      provider: 'claude',
      model: 'claude-sonnet-4-20250514',
    },
    available: ['claude'],
    configured: true,
    edge: true,
    version: env.STORY_UI_VERSION,
  };

  return new Response(JSON.stringify(providers), {
    headers: {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': '*',
    }
  });
}

/**
 * Handle /story-ui/claude route
 * POST: Proxy requests to Claude API for component generation
 */
async function handleClaudeRoute(request: Request, env: Env): Promise<Response> {
  if (request.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'Method not allowed' }), {
      status: 405,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
      }
    });
  }

  // Check for API key
  if (!env.ANTHROPIC_API_KEY) {
    return new Response(JSON.stringify({ error: 'ANTHROPIC_API_KEY not configured' }), {
      status: 500,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
      }
    });
  }

  try {
    const body = await request.json() as {
      prompt?: string;
      messages?: Array<{ role: string; content: string }>;
      systemPrompt?: string;
      prefillAssistant?: string;
      maxTokens?: number;
      images?: Array<{ type: string; data: string }>;
    };

    const { prompt, messages = [], systemPrompt, prefillAssistant, maxTokens = 4096, images = [] } = body;

    if (!prompt) {
      return new Response(JSON.stringify({ error: 'Missing prompt' }), {
        status: 400,
        headers: {
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': '*',
        }
      });
    }

    // Build the messages array for Claude API
    const claudeMessages: Array<{
      role: 'user' | 'assistant';
      content: string | Array<{ type: string; text?: string; source?: { type: string; media_type: string; data: string } }>;
    }> = [];

    // Add conversation history
    for (const msg of messages) {
      claudeMessages.push({
        role: msg.role as 'user' | 'assistant',
        content: msg.content,
      });
    }

    // Add the current user message (with images if any)
    if (images.length > 0) {
      const content: Array<{ type: string; text?: string; source?: { type: string; media_type: string; data: string } }> = [];

      // Add images first
      for (const img of images) {
        content.push({
          type: 'image',
          source: {
            type: 'base64',
            media_type: img.type,
            data: img.data,
          },
        });
      }

      // Add the text prompt
      content.push({
        type: 'text',
        text: prompt,
      });

      claudeMessages.push({
        role: 'user',
        content,
      });
    } else {
      claudeMessages.push({
        role: 'user',
        content: prompt,
      });
    }

    // Add assistant prefill if provided (forces specific output format)
    if (prefillAssistant) {
      claudeMessages.push({
        role: 'assistant',
        content: prefillAssistant,
      });
    }

    // Call Claude API
    const claudeResponse = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': env.ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: env.DEFAULT_MODEL || 'claude-sonnet-4-20250514',
        max_tokens: maxTokens,
        system: systemPrompt || 'You are a helpful assistant.',
        messages: claudeMessages,
      }),
    });

    if (!claudeResponse.ok) {
      const errorText = await claudeResponse.text();
      console.error('Claude API error:', errorText);
      return new Response(JSON.stringify({
        error: `Claude API error: ${claudeResponse.status}`,
        details: errorText,
      }), {
        status: claudeResponse.status,
        headers: {
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': '*',
        }
      });
    }

    const claudeData = await claudeResponse.json() as {
      content: Array<{ type: string; text: string }>;
      usage?: { input_tokens: number; output_tokens: number };
    };

    // Extract the text content
    let responseText = '';
    if (claudeData.content && Array.isArray(claudeData.content)) {
      responseText = claudeData.content
        .filter((block): block is { type: 'text'; text: string } => block.type === 'text')
        .map(block => block.text)
        .join('');
    }

    // If we used prefill, prepend it back to the response
    if (prefillAssistant) {
      responseText = prefillAssistant + responseText;
    }

    return new Response(JSON.stringify({
      content: responseText,
      usage: claudeData.usage,
    }), {
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
      }
    });

  } catch (error) {
    console.error('Claude proxy error:', error);
    return new Response(JSON.stringify({
      error: 'Failed to process request',
      details: error instanceof Error ? error.message : 'Unknown error',
    }), {
      status: 500,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
      }
    });
  }
}

/**
 * Handle /story-ui/preview/:id route
 * GET: Render the generated story as an interactive HTML page
 */
async function handlePreviewRoute(_request: Request, env: Env, url: URL): Promise<Response> {
  const storyId = url.pathname.replace('/story-ui/preview/', '');

  if (!storyId) {
    return new Response('Missing story ID', { status: 400 });
  }

  const sessionId = 'default-session';
  const doId = env.MCP_SESSIONS.idFromName(sessionId);
  const stub = env.MCP_SESSIONS.get(doId);

  // Fetch the story from Durable Objects
  const mcpRequest = {
    jsonrpc: '2.0',
    id: Date.now(),
    method: 'tools/call',
    params: {
      name: 'get-story',
      arguments: { id: storyId }
    }
  };

  const response = await stub.fetch(new Request('http://internal/mcp', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(mcpRequest)
  }));

  const result = await response.json() as { result?: { content?: Array<{ text?: string }> } };
  const content = result.result?.content?.[0]?.text;

  if (!content) {
    return new Response(renderErrorPage('Story not found', storyId), {
      status: 404,
      headers: { 'Content-Type': 'text/html' }
    });
  }

  const story = JSON.parse(content) as { title?: string; content?: string; framework?: string };

  if (!story.content) {
    return new Response(renderErrorPage('Story has no content', storyId), {
      status: 404,
      headers: { 'Content-Type': 'text/html' }
    });
  }

  // Extract JSX from the story content
  const jsxContent = extractJSXFromStory(story.content);

  // Render the preview HTML page
  const html = renderPreviewPage(story.title || 'Generated Story', jsxContent, storyId);

  return new Response(html, {
    headers: {
      'Content-Type': 'text/html',
      'Access-Control-Allow-Origin': '*',
    }
  });
}

/**
 * Extract the JSX render content from a story file
 */
function extractJSXFromStory(storyContent: string): string {
  // Try to extract the render function content
  const renderMatch = storyContent.match(/render:\s*\(\)\s*=>\s*\(([\s\S]*?)\),?\s*}/);
  if (renderMatch) {
    return renderMatch[1].trim();
  }

  // Try to extract JSX from args-based story
  const argsMatch = storyContent.match(/args:\s*\{([\s\S]*?)\},?\s*}/);
  if (argsMatch) {
    return `<div style={{ padding: '20px' }}>
      <p>Story uses args-based rendering.</p>
      <pre>${JSON.stringify(argsMatch[1], null, 2)}</pre>
    </div>`;
  }

  // Fallback: return placeholder
  return `<div style={{ padding: '20px', textAlign: 'center' }}>
    <p>Unable to extract renderable content from this story.</p>
    <details>
      <summary>View raw story code</summary>
      <pre style={{ textAlign: 'left', overflow: 'auto' }}>${escapeHtml(storyContent)}</pre>
    </details>
  </div>`;
}

/**
 * Escape HTML special characters
 */
function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

/**
 * Render the preview HTML page with React and Babel for live JSX rendering
 */
function renderPreviewPage(title: string, jsxContent: string, storyId: string): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${escapeHtml(title)} - Story UI Preview</title>
  <script src="https://unpkg.com/react@18/umd/react.development.js" crossorigin></script>
  <script src="https://unpkg.com/react-dom@18/umd/react-dom.development.js" crossorigin></script>
  <script src="https://unpkg.com/@babel/standalone/babel.min.js"></script>
  <style>
    * {
      box-sizing: border-box;
    }
    body {
      margin: 0;
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Oxygen, Ubuntu, Cantarell, sans-serif;
      background: #f5f5f5;
      min-height: 100vh;
    }
    .preview-header {
      background: #1e1e1e;
      color: white;
      padding: 12px 20px;
      display: flex;
      align-items: center;
      justify-content: space-between;
      border-bottom: 2px solid #4fc3f7;
    }
    .preview-header h1 {
      margin: 0;
      font-size: 16px;
      font-weight: 500;
    }
    .preview-header .badge {
      background: #4fc3f7;
      color: #1e1e1e;
      padding: 4px 12px;
      border-radius: 12px;
      font-size: 12px;
      font-weight: 600;
    }
    .preview-container {
      padding: 40px;
      display: flex;
      justify-content: center;
      align-items: flex-start;
      min-height: calc(100vh - 50px);
    }
    .preview-content {
      background: white;
      border-radius: 8px;
      box-shadow: 0 2px 8px rgba(0,0,0,0.1);
      padding: 40px;
      max-width: 100%;
      min-width: 300px;
    }
    .error-message {
      color: #d32f2f;
      padding: 20px;
      background: #ffebee;
      border-radius: 8px;
      margin: 20px;
    }
    .loading {
      text-align: center;
      padding: 40px;
      color: #666;
    }
    /* Card styles for common patterns */
    .card {
      border: 1px solid #e0e0e0;
      border-radius: 8px;
      padding: 16px;
      margin: 8px;
      background: white;
      box-shadow: 0 1px 3px rgba(0,0,0,0.1);
    }
    .card-grid {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(250px, 1fr));
      gap: 16px;
    }
    button {
      padding: 8px 16px;
      border-radius: 4px;
      border: none;
      cursor: pointer;
      font-size: 14px;
    }
    button.primary {
      background: #1976d2;
      color: white;
    }
    button.primary:hover {
      background: #1565c0;
    }
  </style>
</head>
<body>
  <div class="preview-header">
    <h1>${escapeHtml(title)}</h1>
    <span class="badge">Story UI Preview</span>
  </div>
  <div class="preview-container">
    <div class="preview-content" id="root">
      <div class="loading">Loading preview...</div>
    </div>
  </div>

  <script type="text/babel" data-presets="react">
    const { useState, useEffect } = React;

    // Simple Card component for common patterns
    const Card = ({ children, title, ...props }) => (
      <div className="card" {...props}>
        {title && <h3 style={{ margin: '0 0 12px 0' }}>{title}</h3>}
        {children}
      </div>
    );

    // Button component
    const Button = ({ children, variant = 'default', onClick, ...props }) => (
      <button
        className={variant === 'primary' ? 'primary' : ''}
        onClick={onClick}
        {...props}
      >
        {children}
      </button>
    );

    // The generated story component
    const StoryPreview = () => {
      try {
        return (
          ${jsxContent}
        );
      } catch (error) {
        return (
          <div className="error-message">
            <strong>Render Error:</strong> {error.message}
          </div>
        );
      }
    };

    // Error boundary for the preview
    class ErrorBoundary extends React.Component {
      constructor(props) {
        super(props);
        this.state = { hasError: false, error: null };
      }

      static getDerivedStateFromError(error) {
        return { hasError: true, error };
      }

      render() {
        if (this.state.hasError) {
          return (
            <div className="error-message">
              <strong>Preview Error:</strong> {this.state.error?.message || 'Unknown error'}
              <br /><br />
              <small>Story ID: ${storyId}</small>
            </div>
          );
        }
        return this.props.children;
      }
    }

    // Render the app
    const root = ReactDOM.createRoot(document.getElementById('root'));
    root.render(
      <ErrorBoundary>
        <StoryPreview />
      </ErrorBoundary>
    );
  </script>
</body>
</html>`;
}

/**
 * Render an error page
 */
function renderErrorPage(message: string, storyId: string): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Error - Story UI Preview</title>
  <style>
    body {
      margin: 0;
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      background: #f5f5f5;
      min-height: 100vh;
      display: flex;
      align-items: center;
      justify-content: center;
    }
    .error-container {
      background: white;
      padding: 40px;
      border-radius: 8px;
      box-shadow: 0 2px 8px rgba(0,0,0,0.1);
      text-align: center;
      max-width: 400px;
    }
    .error-icon {
      font-size: 48px;
      margin-bottom: 20px;
    }
    h1 {
      color: #d32f2f;
      margin: 0 0 12px 0;
      font-size: 24px;
    }
    p {
      color: #666;
      margin: 0;
    }
    .story-id {
      margin-top: 20px;
      padding: 8px 12px;
      background: #f5f5f5;
      border-radius: 4px;
      font-family: monospace;
      font-size: 12px;
      color: #999;
    }
  </style>
</head>
<body>
  <div class="error-container">
    <div class="error-icon">⚠️</div>
    <h1>Preview Error</h1>
    <p>${escapeHtml(message)}</p>
    <div class="story-id">ID: ${escapeHtml(storyId)}</div>
  </div>
</body>
</html>`;
}
