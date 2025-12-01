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

      // LLM proxy endpoints (multi-provider support)
      if (url.pathname === '/story-ui/claude') {
        return handleClaudeRoute(request, env);
      }

      if (url.pathname === '/story-ui/openai') {
        return handleOpenAIRoute(request, env);
      }

      if (url.pathname === '/story-ui/gemini') {
        return handleGeminiRoute(request, env);
      }

      // Chat title generation endpoint
      if (url.pathname === '/story-ui/title') {
        return handleTitleRoute(request, env);
      }

      // Design system considerations endpoint (for environment parity)
      if (url.pathname === '/story-ui/considerations') {
        return handleConsiderationsRoute(request, env);
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
            considerations: '/story-ui/considerations',
            claude: '/story-ui/claude',
            openai: '/story-ui/openai',
            gemini: '/story-ui/gemini',
            title: '/story-ui/title',
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
 * Handle /story-ui/considerations route
 * GET: Return design system considerations for environment parity
 *
 * Considerations are dynamically fetched from the Storybook origin's bundled JSON file.
 * This ensures they sync automatically with Git-tracked changes when Storybook is deployed.
 *
 * The request must include a 'storybookOrigin' query parameter (the Storybook deployment URL).
 * Example: /story-ui/considerations?storybookOrigin=https://my-storybook.pages.dev
 */
async function handleConsiderationsRoute(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url);
  const storybookOrigin = url.searchParams.get('storybookOrigin');

  // If no origin provided, return empty (the panel should provide its own origin)
  if (!storybookOrigin) {
    return new Response(JSON.stringify({
      hasConsiderations: false,
      source: null,
      considerations: '',
      error: 'Missing storybookOrigin query parameter. The Storybook panel should provide its deployment URL.',
    }), {
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
      }
    });
  }

  try {
    // Fetch the bundled considerations from the Storybook deployment
    const considerationsUrl = `${storybookOrigin}/story-ui-considerations.json`;
    const response = await fetch(considerationsUrl, {
      headers: {
        'Accept': 'application/json',
      },
    });

    if (!response.ok) {
      // Fallback: No bundled considerations file exists at this Storybook
      return new Response(JSON.stringify({
        hasConsiderations: false,
        source: null,
        considerations: '',
        error: `Failed to fetch considerations from ${considerationsUrl}: ${response.status}`,
      }), {
        headers: {
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': '*',
        }
      });
    }

    const bundle = await response.json() as {
      version?: string;
      generatedAt?: string;
      source?: string;
      combinedContent?: string;
      files?: Array<{ path: string; content: string; type: string }>;
    };

    // Return the combined considerations content
    return new Response(JSON.stringify({
      hasConsiderations: !!bundle.combinedContent,
      source: 'storybook-bundle',
      storybookOrigin,
      generatedAt: bundle.generatedAt,
      fileCount: bundle.files?.length || 0,
      considerations: bundle.combinedContent || '',
    }), {
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
        // Cache for 5 minutes to reduce fetch overhead
        'Cache-Control': 'public, max-age=300',
      }
    });

  } catch (error) {
    console.error('Failed to fetch considerations:', error);
    return new Response(JSON.stringify({
      hasConsiderations: false,
      source: null,
      considerations: '',
      error: `Failed to fetch considerations: ${error instanceof Error ? error.message : 'Unknown error'}`,
    }), {
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
      }
    });
  }
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

  const body = await request.json() as { prompt?: string; componentPath?: string; framework?: string; considerations?: string };
  const { prompt, componentPath, framework, considerations } = body;

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
      arguments: { prompt, componentPath, framework: framework || 'react', considerations }
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

  const body = await request.json() as { prompt?: string; componentPath?: string; framework?: string; considerations?: string };
  const { prompt, componentPath, framework, considerations } = body;

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
          arguments: { prompt, componentPath, framework: framework || 'react', considerations }
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
 * Returns dynamically based on which API keys are configured
 */
function handleProvidersRoute(env: Env): Response {
  // Build available providers based on configured API keys
  const available: string[] = [];
  const models: Record<string, string[]> = {};

  if (env.ANTHROPIC_API_KEY) {
    available.push('claude');
    models['claude'] = ['claude-sonnet-4-5-20250929', 'claude-opus-4-5-20251101', 'claude-haiku-4-5-20251001'];
  }

  if (env.OPENAI_API_KEY) {
    available.push('openai');
    models['openai'] = ['gpt-5.1', 'gpt-5-mini', 'gpt-5-nano'];
  }

  if (env.GEMINI_API_KEY) {
    available.push('gemini');
    models['gemini'] = ['gemini-3-pro-preview', 'gemini-2.5-pro', 'gemini-2.5-flash'];
  }

  // Determine default provider
  const defaultProvider = env.DEFAULT_PROVIDER ||
    (available.includes('claude') ? 'claude' :
     available.includes('openai') ? 'openai' :
     available.includes('gemini') ? 'gemini' : null);

  const providers = {
    current: {
      provider: defaultProvider,
      model: defaultProvider ? models[defaultProvider]?.[0] : null,
    },
    available,
    models,
    configured: available.length > 0,
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
/**
 * Extract component names used in JSX code
 */
function extractComponentsFromJSX(jsxCode: string): string[] {
  // Match component tags: <ComponentName or <ComponentName.SubComponent
  const componentRegex = /<([A-Z][A-Za-z0-9]*(?:\.[A-Z][A-Za-z0-9]*)?)/g;
  const components = new Set<string>();
  let match;
  while ((match = componentRegex.exec(jsxCode)) !== null) {
    // Get the base component name (before any dot)
    const componentName = match[1].split('.')[0];
    components.add(componentName);
  }
  return Array.from(components);
}

/**
 * Validate components used in JSX against available components
 */
function validateComponents(
  jsxCode: string,
  availableComponents: string[]
): { valid: boolean; invalidComponents: string[]; suggestions: Record<string, string> } {
  const usedComponents = extractComponentsFromJSX(jsxCode);
  const availableSet = new Set(availableComponents);
  const invalidComponents: string[] = [];
  const suggestions: Record<string, string> = {};

  for (const comp of usedComponents) {
    if (!availableSet.has(comp)) {
      invalidComponents.push(comp);
      // Find a similar component as suggestion
      const similar = availableComponents.find(a =>
        a.toLowerCase().includes(comp.toLowerCase()) ||
        comp.toLowerCase().includes(a.toLowerCase())
      );
      if (similar) {
        suggestions[comp] = similar;
      }
    }
  }

  return {
    valid: invalidComponents.length === 0,
    invalidComponents,
    suggestions,
  };
}

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
      model?: string;
      images?: Array<{ type: string; data: string }>;
      availableComponents?: string[];
    };

    const { prompt, messages = [], systemPrompt, prefillAssistant, maxTokens = 4096, model, images = [], availableComponents = [] } = body;

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

    // Validation and retry loop
    const maxRetries = 3;
    let lastResponse = '';
    let lastValidation = { valid: true, invalidComponents: [] as string[], suggestions: {} as Record<string, string> };

    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      // Call Claude API
      const claudeResponse = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': env.ANTHROPIC_API_KEY,
          'anthropic-version': '2023-06-01',
        },
        body: JSON.stringify({
          model: model || env.DEFAULT_MODEL || 'claude-sonnet-4-5-20250929',
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

      lastResponse = responseText;

      // If no available components provided, skip validation
      if (availableComponents.length === 0) {
        return new Response(JSON.stringify({
          content: responseText,
          usage: claudeData.usage,
        }), {
          headers: {
            'Content-Type': 'application/json',
            'Access-Control-Allow-Origin': '*',
          }
        });
      }

      // Validate components
      lastValidation = validateComponents(responseText, availableComponents);

      if (lastValidation.valid) {
        // All components are valid, return the response
        console.log(`Attempt ${attempt}: All components valid`);
        return new Response(JSON.stringify({
          content: responseText,
          usage: claudeData.usage,
          validated: true,
        }), {
          headers: {
            'Content-Type': 'application/json',
            'Access-Control-Allow-Origin': '*',
          }
        });
      }

      // Components are invalid, prepare retry prompt
      console.log(`Attempt ${attempt}: Invalid components found:`, lastValidation.invalidComponents);

      if (attempt < maxRetries) {
        // Build correction prompt with suggestions
        const suggestionsList = lastValidation.invalidComponents.map(comp => {
          const suggestion = lastValidation.suggestions[comp];
          return suggestion
            ? `"${comp}" - use "${suggestion}" instead`
            : `"${comp}" - remove or replace with an available component`;
        }).join('\n');

        const correctionPrompt = `Your previous response used components that don't exist: ${lastValidation.invalidComponents.join(', ')}.

Please fix by replacing or removing these invalid components:
${suggestionsList}

Available components: ${availableComponents.slice(0, 50).join(', ')}${availableComponents.length > 50 ? '...' : ''}

Output the corrected JSX starting with < :`;

        // Remove the prefill for retry (we'll add it again)
        if (prefillAssistant && claudeMessages[claudeMessages.length - 1]?.role === 'assistant') {
          claudeMessages.pop();
        }

        // Add the invalid response and correction request
        claudeMessages.push({
          role: 'assistant',
          content: responseText,
        });
        claudeMessages.push({
          role: 'user',
          content: correctionPrompt,
        });

        // Add prefill again
        if (prefillAssistant) {
          claudeMessages.push({
            role: 'assistant',
            content: prefillAssistant,
          });
        }
      }
    }

    // All retries exhausted, return the last response with validation warning
    console.log(`All ${maxRetries} attempts failed validation. Returning last response with warning.`);
    return new Response(JSON.stringify({
      content: lastResponse,
      validated: false,
      validationWarning: `Response may contain invalid components: ${lastValidation.invalidComponents.join(', ')}`,
      invalidComponents: lastValidation.invalidComponents,
      suggestions: lastValidation.suggestions,
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
 * Handle /story-ui/openai route
 * POST: Proxy requests to OpenAI API for component generation
 */
async function handleOpenAIRoute(request: Request, env: Env): Promise<Response> {
  if (request.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'Method not allowed' }), {
      status: 405,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
      }
    });
  }

  if (!env.OPENAI_API_KEY) {
    return new Response(JSON.stringify({ error: 'OPENAI_API_KEY not configured' }), {
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
      model?: string;
      images?: Array<{ type: string; data: string }>;
    };

    const { prompt, messages = [], systemPrompt, prefillAssistant, maxTokens = 4096, model, images = [] } = body;

    if (!prompt) {
      return new Response(JSON.stringify({ error: 'Missing prompt' }), {
        status: 400,
        headers: {
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': '*',
        }
      });
    }

    // Build messages for OpenAI API
    const openaiMessages: Array<{
      role: 'system' | 'user' | 'assistant';
      content: string | Array<{ type: string; text?: string; image_url?: { url: string } }>;
    }> = [];

    // Add system message
    if (systemPrompt) {
      openaiMessages.push({ role: 'system', content: systemPrompt });
    }

    // Add conversation history
    for (const msg of messages) {
      openaiMessages.push({
        role: msg.role as 'user' | 'assistant',
        content: msg.content,
      });
    }

    // Add the current user message (with images if any)
    if (images.length > 0) {
      const content: Array<{ type: string; text?: string; image_url?: { url: string } }> = [];

      // Add images first
      for (const img of images) {
        content.push({
          type: 'image_url',
          image_url: {
            url: `data:${img.type};base64,${img.data}`,
          },
        });
      }

      // Add the text prompt
      content.push({
        type: 'text',
        text: prompt,
      });

      openaiMessages.push({
        role: 'user',
        content,
      });
    } else {
      openaiMessages.push({
        role: 'user',
        content: prompt,
      });
    }

    // Add assistant prefill if provided
    if (prefillAssistant) {
      openaiMessages.push({
        role: 'assistant',
        content: prefillAssistant,
      });
    }

    // Call OpenAI API
    const openaiResponse = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${env.OPENAI_API_KEY}`,
      },
      body: JSON.stringify({
        model: model || env.DEFAULT_OPENAI_MODEL || 'gpt-5.1',
        max_tokens: maxTokens,
        messages: openaiMessages,
      }),
    });

    if (!openaiResponse.ok) {
      const errorText = await openaiResponse.text();
      console.error('OpenAI API error:', errorText);
      return new Response(JSON.stringify({
        error: `OpenAI API error: ${openaiResponse.status}`,
        details: errorText,
      }), {
        status: openaiResponse.status,
        headers: {
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': '*',
        }
      });
    }

    const openaiData = await openaiResponse.json() as {
      choices: Array<{ message: { content: string } }>;
      usage?: { prompt_tokens: number; completion_tokens: number; total_tokens: number };
    };

    let responseText = openaiData.choices[0]?.message?.content || '';

    // If we used prefill, prepend it back
    if (prefillAssistant) {
      responseText = prefillAssistant + responseText;
    }

    return new Response(JSON.stringify({
      content: responseText,
      usage: openaiData.usage,
    }), {
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
      }
    });

  } catch (error) {
    console.error('OpenAI proxy error:', error);
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
 * Handle /story-ui/gemini route
 * POST: Proxy requests to Google Gemini API for component generation
 */
async function handleGeminiRoute(request: Request, env: Env): Promise<Response> {
  if (request.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'Method not allowed' }), {
      status: 405,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
      }
    });
  }

  if (!env.GEMINI_API_KEY) {
    return new Response(JSON.stringify({ error: 'GEMINI_API_KEY not configured' }), {
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
      model?: string;
      images?: Array<{ type: string; data: string }>;
    };

    const { prompt, messages = [], systemPrompt, prefillAssistant, maxTokens = 4096, model, images = [] } = body;

    if (!prompt) {
      return new Response(JSON.stringify({ error: 'Missing prompt' }), {
        status: 400,
        headers: {
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': '*',
        }
      });
    }

    // Build contents for Gemini API
    const contents: Array<{
      role: 'user' | 'model';
      parts: Array<{ text?: string; inline_data?: { mime_type: string; data: string } }>;
    }> = [];

    // Add conversation history
    for (const msg of messages) {
      contents.push({
        role: msg.role === 'assistant' ? 'model' : 'user',
        parts: [{ text: msg.content }],
      });
    }

    // Add the current user message (with images if any)
    const userParts: Array<{ text?: string; inline_data?: { mime_type: string; data: string } }> = [];

    for (const img of images) {
      userParts.push({
        inline_data: {
          mime_type: img.type,
          data: img.data,
        },
      });
    }

    userParts.push({ text: prompt });
    contents.push({ role: 'user', parts: userParts });

    // Add assistant prefill if provided
    if (prefillAssistant) {
      contents.push({
        role: 'model',
        parts: [{ text: prefillAssistant }],
      });
    }

    const geminiModel = model || env.DEFAULT_GEMINI_MODEL || 'gemini-2.5-pro';
    const geminiUrl = `https://generativelanguage.googleapis.com/v1beta/models/${geminiModel}:generateContent?key=${env.GEMINI_API_KEY}`;

    // Call Gemini API
    const geminiResponse = await fetch(geminiUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        contents,
        systemInstruction: systemPrompt ? { parts: [{ text: systemPrompt }] } : undefined,
        generationConfig: {
          maxOutputTokens: maxTokens,
        },
      }),
    });

    if (!geminiResponse.ok) {
      const errorText = await geminiResponse.text();
      console.error('Gemini API error:', errorText);
      return new Response(JSON.stringify({
        error: `Gemini API error: ${geminiResponse.status}`,
        details: errorText,
      }), {
        status: geminiResponse.status,
        headers: {
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': '*',
        }
      });
    }

    const geminiData = await geminiResponse.json() as {
      candidates: Array<{ content: { parts: Array<{ text: string }> } }>;
      usageMetadata?: { promptTokenCount: number; candidatesTokenCount: number; totalTokenCount: number };
    };

    let responseText = geminiData.candidates[0]?.content?.parts?.[0]?.text || '';

    // If we used prefill, prepend it back
    if (prefillAssistant) {
      responseText = prefillAssistant + responseText;
    }

    return new Response(JSON.stringify({
      content: responseText,
      usage: geminiData.usageMetadata ? {
        input_tokens: geminiData.usageMetadata.promptTokenCount,
        output_tokens: geminiData.usageMetadata.candidatesTokenCount,
      } : undefined,
    }), {
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
      }
    });

  } catch (error) {
    console.error('Gemini proxy error:', error);
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
 * Handle /story-ui/title route
 * POST: Generate a smart title for a conversation using LLM
 */
async function handleTitleRoute(request: Request, env: Env): Promise<Response> {
  if (request.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'Method not allowed' }), {
      status: 405,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
      }
    });
  }

  try {
    const body = await request.json() as {
      description?: string;
      provider?: 'claude' | 'openai' | 'gemini';
    };

    const { description, provider = 'claude' } = body;

    if (!description) {
      return new Response(JSON.stringify({ error: 'Missing description' }), {
        status: 400,
        headers: {
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': '*',
        }
      });
    }

    const titlePrompt = `Given the following UI description, generate a short, clear, human-friendly title suitable for a chat/conversation name.

Requirements:
- Do not include words like "Generate", "Build", or "Create"
- Keep it under 40 characters
- Use simple, clear language
- Describe what the UI IS, not what action was taken
- Examples: "Pricing Card", "Login Form", "User Dashboard", "Contact Page"

UI description:
${description}

Title:`;

    let title = '';

    // Use whichever provider is available
    if (provider === 'claude' && env.ANTHROPIC_API_KEY) {
      const response = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': env.ANTHROPIC_API_KEY,
          'anthropic-version': '2023-06-01',
        },
        body: JSON.stringify({
          model: 'claude-haiku-4-5-20251001',
          max_tokens: 50,
          messages: [{ role: 'user', content: titlePrompt }],
        }),
      });

      if (response.ok) {
        const data = await response.json() as { content: Array<{ type: string; text: string }> };
        title = data.content?.[0]?.text || '';
      }
    } else if (provider === 'openai' && env.OPENAI_API_KEY) {
      const response = await fetch('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${env.OPENAI_API_KEY}`,
        },
        body: JSON.stringify({
          model: 'gpt-5-mini',
          max_tokens: 50,
          messages: [{ role: 'user', content: titlePrompt }],
        }),
      });

      if (response.ok) {
        const data = await response.json() as { choices: Array<{ message: { content: string } }> };
        title = data.choices[0]?.message?.content || '';
      }
    } else if (provider === 'gemini' && env.GEMINI_API_KEY) {
      const response = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-pro:generateContent?key=${env.GEMINI_API_KEY}`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            contents: [{ role: 'user', parts: [{ text: titlePrompt }] }],
            generationConfig: { maxOutputTokens: 50 },
          }),
        }
      );

      if (response.ok) {
        const data = await response.json() as { candidates: Array<{ content: { parts: Array<{ text: string }> } }> };
        title = data.candidates?.[0]?.content?.parts?.[0]?.text || '';
      }
    }

    // Clean up the title
    title = title
      .trim()
      .replace(/^["']|["']$/g, '')  // Remove quotes
      .replace(/[^\w\s'"?!-]/g, ' ')  // Remove special chars
      .replace(/\s+/g, ' ')  // Normalize whitespace
      .trim()
      .slice(0, 40);  // Limit length

    // Fallback to simple truncation if LLM failed
    if (!title) {
      title = description.slice(0, 40).trim();
      if (description.length > 40) title += '...';
    }

    return new Response(JSON.stringify({ title }), {
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
      }
    });

  } catch (error) {
    console.error('Title generation error:', error);
    return new Response(JSON.stringify({
      error: 'Failed to generate title',
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
