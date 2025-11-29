import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

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
import {
  getStoriesMetadata,
  getStoryById as getMemoryStoryById,
  getStoryContent as getMemoryStoryContent,
  deleteStory as deleteMemoryStory,
  clearAllStories,
  getMemoryStats
} from './routes/memoryStories.js';
import {
  getAllStories,
  getStoryById,
  getStoryContent,
  deleteStory
} from './routes/hybridStories.js';
import {
  getSyncedStories,
  deleteSyncedStory,
  clearAllSyncedStories,
  syncChatHistory,
  validateChatSession,
  getSyncedStoryById
} from './routes/storySync.js';
import { setupProductionGitignore, ProductionGitignoreManager } from '../story-generator/productionGitignoreManager.js';
import { getInMemoryStoryService } from '../story-generator/inMemoryStoryService.js';
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

// Hybrid story management routes (works in both dev and production)
app.get('/mcp/stories', getAllStories);
app.get('/mcp/stories/:id', getStoryById);
app.get('/mcp/stories/:id/content', getStoryContent);
app.delete('/mcp/stories/:id', deleteStory);
app.delete('/mcp/stories', clearAllStories);
app.get('/mcp/memory-stats', getMemoryStats);

// Synchronized story management routes (works in both dev and production)
app.get('/mcp/sync/stories', getSyncedStories);
app.get('/mcp/sync/stories/:id', getSyncedStoryById);
app.delete('/mcp/sync/stories/:id', deleteSyncedStory);
app.delete('/mcp/sync/stories', clearAllSyncedStories);
app.get('/mcp/sync/chat-history', syncChatHistory);
app.get('/mcp/sync/validate/:id', validateChatSession);

// Proxy routes for frontend compatibility (maps /story-ui/ to /mcp/)
app.get('/story-ui/stories', getAllStories);
app.get('/story-ui/stories/:id', getStoryById);
app.get('/story-ui/stories/:id/content', getStoryContent);
app.delete('/story-ui/stories/:id', deleteStory);
app.delete('/story-ui/stories', clearAllStories);
app.post('/story-ui/generate', generateStoryFromPrompt);
app.post('/story-ui/generate-stream', generateStoryFromPromptStream);
app.post('/story-ui/claude', claudeProxy);
app.get('/story-ui/components', getComponents);
app.get('/story-ui/props', getProps);
app.get('/story-ui/memory-stats', getMemoryStats);

// Design system considerations endpoint - serves considerations for environment parity
app.get('/story-ui/considerations', (req, res) => {
  try {
    const projectRoot = process.cwd();

    // First try directory-based documentation (story-ui-docs/)
    const docLoader = new DocumentationLoader(projectRoot);
    if (docLoader.hasDocumentation()) {
      const docs = docLoader.loadDocumentation();
      // Format documentation as considerations text
      const considerationsText = Object.entries(docs).map(([category, content]) => {
        if (typeof content === 'string') {
          return `## ${category}\n${content}`;
        }
        return `## ${category}\n${JSON.stringify(content, null, 2)}`;
      }).join('\n\n');

      return res.json({
        hasConsiderations: true,
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

// Legacy delete route for backwards compatibility
app.post('/story-ui/delete', async (req, res) => {
  try {
    const { chatId, storyId } = req.body;
    const id = chatId || storyId; // Support both parameter names
    
    if (!id) {
      return res.status(400).json({ error: 'chatId or storyId is required' });
    }
    
    console.log(`🗑️ Attempting to delete story: ${id}`);
    
    // First try in-memory deletion (production mode)
    const storyService = getInMemoryStoryService(config);
    const inMemoryDeleted = storyService.deleteStory(id);
    
    if (inMemoryDeleted) {
      console.log(`✅ Deleted story from memory: ${id}`);
      return res.json({
        success: true,
        message: 'Story deleted successfully from memory'
      });
    }
    
    // If not found in memory, try file-system deletion (development mode)
    if (gitignoreManager && !gitignoreManager.isProductionMode()) {
      const storiesPath = config.generatedStoriesPath;
      console.log(`🔍 Searching for file-system story in: ${storiesPath}`);
      
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
            message: 'Story deleted successfully from file system'
          });
        }
      }
    }
    
    console.log(`❌ Story not found: ${id}`);
    return res.status(404).json({
      success: false,
      error: 'Story not found'
    });
  } catch (error) {
    console.error('Error in legacy delete route:', error);
    res.status(500).json({ error: 'Failed to delete story' });
  }
});

// Synchronized story proxy routes
app.get('/story-ui/sync/stories', getSyncedStories);
app.get('/story-ui/sync/stories/:id', getSyncedStoryById);
app.delete('/story-ui/sync/stories/:id', deleteSyncedStory);
app.delete('/story-ui/sync/stories', clearAllSyncedStories);
app.get('/story-ui/sync/chat-history', syncChatHistory);
app.get('/story-ui/sync/validate/:id', validateChatSession);

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

// Set up production-ready gitignore and directory structure on startup
const config = loadUserConfig();
const gitignoreManager = setupProductionGitignore(config);
const storyService = getInMemoryStoryService(config);

// Initialize URL redirect service
const redirectService = new UrlRedirectService(process.cwd());

const PORT = parseInt(process.env.PORT || '4001', 10);

// Start server
app.listen(PORT, () => {
  console.log(`MCP server running on port ${PORT}`);
  console.log(`Environment: ${gitignoreManager.isProductionMode() ? 'Production' : 'Development'}`);
  console.log(`Story generation: ${gitignoreManager.isProductionMode() ? 'In-memory' : 'File-system'}`);
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
