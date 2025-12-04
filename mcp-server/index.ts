import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';
import { createProxyMiddleware } from 'http-proxy-middleware';

// Get __dirname equivalent for ES modules
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Load .env from current working directory (where the MCP server is run from)
// This allows each environment to have its own API key configuration
dotenv.config({ path: path.resolve(process.cwd(), '.env') });
import express from 'express';
import cors from 'cors';
import { getComponents, getProps } from './routes/components.js';
import { claudeProxy } from './routes/claude.js';
import { generateStoryFromPrompt } from './routes/generateStory.js';
import { generateStoryFromPromptStream } from './routes/generateStoryStream.js';
import { loadUserConfig } from '../story-generator/configLoader.js';
import { loadConsiderations, considerationsToPrompt } from '../story-generator/considerationsLoader.js';
import { DocumentationLoader } from '../story-generator/documentationLoader.js';
import fs from 'fs';
import { UrlRedirectService } from '../story-generator/urlRedirectService.js';
import {
  getProviders,
  getModels,
  configureProviderRoute,
  validateApiKey,
  setDefaultProvider,
  setModel,
  getUISettings,
  applyUISettings,
  getSettingsConfig
} from './routes/providers.js';
import {
  listFrameworks,
  detectCurrentFramework,
  getFrameworkDetails,
  validateStoryForFramework,
  postProcessStoryForFramework,
} from './routes/frameworks.js';
import mcpRemoteRouter from './routes/mcpRemote.js';

const app = express();

// CORS configuration
// - Allow all origins for /story-ui/* routes (public API for production Storybooks)
// - Restrict to localhost + configured origins for other routes
const corsOptions = {
  origin: (origin: string | undefined, callback: (err: Error | null, allow?: boolean) => void) => {
    // Allow requests with no origin (like mobile apps or curl)
    if (!origin) return callback(null, true);

    // Allow localhost on any port (development)
    const localhostPattern = /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/;
    if (localhostPattern.test(origin)) {
      return callback(null, true);
    }

    // Allow Cloudflare Pages domains (*.pages.dev)
    const cloudflarePattern = /^https:\/\/[a-z0-9-]+\.pages\.dev$/;
    if (cloudflarePattern.test(origin)) {
      return callback(null, true);
    }

    // Allow custom origins from environment
    const allowedOrigins = process.env.STORY_UI_ALLOWED_ORIGINS?.split(',') || [];
    if (allowedOrigins.includes(origin)) {
      return callback(null, true);
    }

    // For production, allow any origin to access /story-ui/* endpoints
    // These are public read-only endpoints for accessing generated stories
    callback(null, true);
  },
  credentials: true,
};
app.use(cors(corsOptions));
app.use(express.json({ limit: '10mb' })); // Increased limit for file uploads

// Component discovery routes
app.get('/mcp/components', getComponents);
app.get('/mcp/props', getProps);

// AI generation routes
app.post('/mcp/claude', claudeProxy);
app.post('/mcp/generate-story', generateStoryFromPrompt);
app.post('/mcp/generate-story-stream', generateStoryFromPromptStream);

// LLM Provider management routes
app.get('/mcp/providers', getProviders);
app.get('/mcp/providers/models', getModels);
app.post('/mcp/providers/configure', configureProviderRoute);
app.post('/mcp/providers/validate', validateApiKey);
app.post('/mcp/providers/default', setDefaultProvider);
app.post('/mcp/providers/model', setModel);

// UI Settings routes (hybrid model selection for non-technical users)
app.get('/mcp/providers/settings', getUISettings);
app.post('/mcp/providers/settings', applyUISettings);
app.get('/mcp/providers/config', getSettingsConfig);

// Framework detection and adapter routes
app.get('/mcp/frameworks', listFrameworks);
app.get('/mcp/frameworks/detect', detectCurrentFramework);
app.get('/mcp/frameworks/:type', getFrameworkDetails);
app.post('/mcp/frameworks/validate', validateStoryForFramework);
app.post('/mcp/frameworks/post-process', postProcessStoryForFramework);

// File-based story routes - stories are generated as .stories.tsx files
// Storybook discovers these automatically via its native file system watching

// Proxy routes for frontend compatibility (maps /story-ui/ to /mcp/)
app.post('/story-ui/generate', generateStoryFromPrompt);
app.post('/story-ui/generate-stream', generateStoryFromPromptStream);
app.post('/story-ui/claude', claudeProxy);
app.get('/story-ui/components', getComponents);
app.get('/story-ui/props', getProps);

// Design system considerations endpoint - serves considerations for environment parity
app.get('/story-ui/considerations', async (req, res) => {
  try {
    const projectRoot = process.cwd();

    // First try directory-based documentation (story-ui-docs/)
    const docLoader = new DocumentationLoader(projectRoot);
    if (docLoader.hasDocumentation()) {
      const docs = await docLoader.loadDocumentation();
      // Use the formatForPrompt method to properly format all documentation
      const considerationsText = docLoader.formatForPrompt(docs);

      return res.json({
        hasConsiderations: considerationsText.length > 0,
        source: 'story-ui-docs',
        considerations: considerationsText
      });
    }

    // Fall back to legacy single-file considerations
    const considerations = loadConsiderations(config.considerationsPath);
    if (considerations) {
      const considerationsText = considerationsToPrompt(considerations);
      return res.json({
        hasConsiderations: true,
        source: 'story-ui-considerations',
        considerations: considerationsText
      });
    }

    // No considerations found
    return res.json({
      hasConsiderations: false,
      source: null,
      considerations: ''
    });
  } catch (error) {
    console.error('Error loading considerations:', error);
    return res.json({
      hasConsiderations: false,
      source: null,
      considerations: '',
      error: error instanceof Error ? error.message : 'Unknown error'
    });
  }
});

// Provider management proxy routes
app.get('/story-ui/providers', getProviders);
app.get('/story-ui/providers/models', getModels);
app.post('/story-ui/providers/configure', configureProviderRoute);
app.post('/story-ui/providers/validate', validateApiKey);
app.post('/story-ui/providers/default', setDefaultProvider);
app.post('/story-ui/providers/model', setModel);

// UI Settings proxy routes (for non-technical users)
app.get('/story-ui/providers/settings', getUISettings);
app.post('/story-ui/providers/settings', applyUISettings);
app.get('/story-ui/providers/config', getSettingsConfig);

// Framework management proxy routes
app.get('/story-ui/frameworks', listFrameworks);
app.get('/story-ui/frameworks/detect', detectCurrentFramework);
app.get('/story-ui/frameworks/:type', getFrameworkDetails);
app.post('/story-ui/frameworks/validate', validateStoryForFramework);
app.post('/story-ui/frameworks/post-process', postProcessStoryForFramework);

// List generated stories from file system
app.get('/story-ui/stories', async (req, res) => {
  try {
    const storiesPath = config.generatedStoriesPath;
    console.log(`📋 Listing stories from: ${storiesPath}`);

    if (!fs.existsSync(storiesPath)) {
      return res.json({ stories: [] });
    }

    const files = fs.readdirSync(storiesPath);
    const stories = files
      .filter(file => file.endsWith('.stories.tsx'))
      .map(file => {
        const filePath = path.join(storiesPath, file);
        const stats = fs.statSync(filePath);
        const content = fs.readFileSync(filePath, 'utf-8');

        // Extract title from story file
        const titleMatch = content.match(/title:\s*['"]([^'"]+)['"]/);
        const title = titleMatch ? titleMatch[1].replace('Generated/', '') : file.replace('.stories.tsx', '');

        return {
          id: file.replace('.stories.tsx', ''),
          fileName: file,
          title,
          lastUpdated: stats.mtime.getTime(),
          code: content
        };
      })
      .sort((a, b) => b.lastUpdated - a.lastUpdated);

    console.log(`✅ Found ${stories.length} stories`);
    return res.json({ stories });
  } catch (error) {
    console.error('Error listing stories:', error);
    return res.status(500).json({ error: 'Failed to list stories' });
  }
});

// Save story to file system
app.post('/story-ui/stories', async (req, res) => {
  try {
    const { id, title, code } = req.body;

    if (!id || !code) {
      return res.status(400).json({ error: 'id and code are required' });
    }

    const storiesPath = config.generatedStoriesPath;

    // Ensure stories directory exists
    if (!fs.existsSync(storiesPath)) {
      fs.mkdirSync(storiesPath, { recursive: true });
    }

    const fileName = `${id}.stories.tsx`;
    const filePath = path.join(storiesPath, fileName);

    fs.writeFileSync(filePath, code, 'utf-8');
    console.log(`✅ Saved story: ${filePath}`);

    return res.json({
      success: true,
      id,
      fileName,
      title
    });
  } catch (error) {
    console.error('Error saving story:', error);
    return res.status(500).json({ error: 'Failed to save story' });
  }
});

// Delete story by ID (RESTful endpoint)
app.delete('/story-ui/stories/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const storiesPath = config.generatedStoriesPath;

    const fileName = id.endsWith('.stories.tsx') ? id : `${id}.stories.tsx`;
    const filePath = path.join(storiesPath, fileName);

    if (fs.existsSync(filePath)) {
      fs.unlinkSync(filePath);
      console.log(`✅ Deleted story: ${filePath}`);
      return res.json({ success: true, message: 'Story deleted successfully' });
    }

    return res.status(404).json({ success: false, error: 'Story not found' });
  } catch (error) {
    console.error('Error deleting story:', error);
    return res.status(500).json({ error: 'Failed to delete story' });
  }
});

// Delete story from file system (legacy POST endpoint)
app.post('/story-ui/delete', async (req, res) => {
  try {
    const { chatId, storyId } = req.body;
    const id = chatId || storyId;

    if (!id) {
      return res.status(400).json({ error: 'chatId or storyId is required' });
    }

    console.log(`🗑️ Attempting to delete story: ${id}`);

    const storiesPath = config.generatedStoriesPath;
    console.log(`🔍 Searching for story in: ${storiesPath}`);

    if (fs.existsSync(storiesPath)) {
      const files = fs.readdirSync(storiesPath);
      const matchingFile = files.find(file =>
        file.includes(id) || file.replace('.stories.tsx', '') === id
      );

      if (matchingFile) {
        const filePath = path.join(storiesPath, matchingFile);
        fs.unlinkSync(filePath);
        console.log(`✅ Deleted story file: ${filePath}`);
        return res.json({
          success: true,
          message: 'Story deleted successfully'
        });
      }
    }

    console.log(`❌ Story not found: ${id}`);
    return res.status(404).json({
      success: false,
      error: 'Story not found'
    });
  } catch (error) {
    console.error('Error deleting story:', error);
    res.status(500).json({ error: 'Failed to delete story' });
  }
});

// Bulk delete stories
app.post('/story-ui/stories/delete-bulk', async (req, res) => {
  try {
    const { ids } = req.body;

    if (!ids || !Array.isArray(ids) || ids.length === 0) {
      return res.status(400).json({ error: 'ids array is required' });
    }

    console.log(`🗑️ Bulk deleting ${ids.length} stories`);

    const storiesPath = config.generatedStoriesPath;
    const deleted: string[] = [];
    const notFound: string[] = [];
    const errors: string[] = [];

    for (const id of ids) {
      try {
        const fileName = id.endsWith('.stories.tsx') ? id : `${id}.stories.tsx`;
        const filePath = path.join(storiesPath, fileName);

        if (fs.existsSync(filePath)) {
          fs.unlinkSync(filePath);
          deleted.push(id);
          console.log(`✅ Deleted: ${fileName}`);
        } else {
          notFound.push(id);
        }
      } catch (err) {
        errors.push(id);
        console.error(`❌ Error deleting ${id}:`, err);
      }
    }

    console.log(`📊 Bulk delete complete: ${deleted.length} deleted, ${notFound.length} not found, ${errors.length} errors`);

    return res.json({
      success: true,
      deleted,
      notFound,
      errors,
      summary: {
        requested: ids.length,
        deleted: deleted.length,
        notFound: notFound.length,
        errors: errors.length
      }
    });
  } catch (error) {
    console.error('Error in bulk delete:', error);
    return res.status(500).json({ error: 'Failed to bulk delete stories' });
  }
});

// Clear all generated stories
app.delete('/story-ui/stories', async (req, res) => {
  try {
    const storiesPath = config.generatedStoriesPath;
    console.log(`🗑️ Clearing all stories from: ${storiesPath}`);

    if (!fs.existsSync(storiesPath)) {
      return res.json({ success: true, deleted: 0, message: 'No stories directory found' });
    }

    const files = fs.readdirSync(storiesPath);
    const storyFiles = files.filter(file => file.endsWith('.stories.tsx'));
    let deleted = 0;

    for (const file of storyFiles) {
      try {
        fs.unlinkSync(path.join(storiesPath, file));
        deleted++;
      } catch (err) {
        console.error(`Error deleting ${file}:`, err);
      }
    }

    console.log(`✅ Cleared ${deleted} stories`);
    return res.json({
      success: true,
      deleted,
      message: `Cleared ${deleted} stories`
    });
  } catch (error) {
    console.error('Error clearing stories:', error);
    return res.status(500).json({ error: 'Failed to clear stories' });
  }
});

// MCP Remote HTTP transport routes (for Claude Desktop remote connections)
// Provides Streamable HTTP and legacy SSE endpoints for remote MCP access
app.use('/mcp-remote', mcpRemoteRouter);
app.use('/story-ui/mcp-remote', mcpRemoteRouter); // Also available at story-ui prefix

// Redirect service endpoint
app.get('/mcp/redirects.js', (req, res) => {
  res.set('Content-Type', 'application/javascript');
  res.send(redirectService.getRedirectScript());
});

// Also serve at story-ui path for compatibility
app.get('/story-ui/redirects.js', (req, res) => {
  res.set('Content-Type', 'application/javascript');
  res.send(redirectService.getRedirectScript());
});

// Load user config and initialize services
const config = loadUserConfig();

// Initialize URL redirect service
const redirectService = new UrlRedirectService(process.cwd());

const PORT = parseInt(process.env.PORT || '4001', 10);

// Storybook proxy configuration for production deployment
// When STORYBOOK_PROXY_ENABLED is set, proxy all non-API requests to Storybook dev server
const storybookProxyPort = process.env.STORYBOOK_PROXY_PORT || '6006';
const storybookProxyEnabled = process.env.STORYBOOK_PROXY_ENABLED === 'true';

if (storybookProxyEnabled) {
  console.log(`📖 Storybook proxy enabled - forwarding to localhost:${storybookProxyPort}`);

  // Proxy all requests that don't match API routes to Storybook
  // This must be added AFTER all API routes so they take precedence
  app.use(
    '/',
    createProxyMiddleware({
      target: `http://localhost:${storybookProxyPort}`,
      changeOrigin: true,
      ws: true, // Enable WebSocket proxying for HMR
      logger: console,
      // Don't proxy API routes
      pathFilter: (path: string) => {
        const isApiRoute =
          path.startsWith('/mcp') ||
          path.startsWith('/story-ui') ||
          path.startsWith('/mcp-remote');
        return !isApiRoute;
      },
      on: {
        error: (err: Error, req: any, res: any) => {
          console.error('Storybook proxy error:', err.message);
          if (res && typeof res.writeHead === 'function' && !res.headersSent) {
            res.writeHead(502, { 'Content-Type': 'text/plain' });
            res.end('Storybook is starting up, please wait...');
          }
        }
      }
    })
  );
}

// Start server
app.listen(PORT, () => {
  console.log(`MCP server running on port ${PORT}`);
  console.log(`Stories will be generated to: ${config.generatedStoriesPath}`);
}).on('error', (err: any) => {
  if (err.code === 'EADDRINUSE') {
    console.error(`\n❌ Port ${PORT} is already in use!`);
    console.error(`\n💡 To fix this:`);
    console.error(`   1. Kill the process using port ${PORT}: lsof -ti:${PORT} | xargs kill`);
    console.error(`   2. Or use a different port: story-ui start --port=4002`);
    console.error(`   3. Make sure to update your Storybook StoryUI panel to use the same port\n`);
    process.exit(1);
  } else {
    console.error('❌ Server failed to start:', err);
    process.exit(1);
  }
});
