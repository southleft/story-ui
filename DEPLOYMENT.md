# Story UI Production Deployment Guide

This guide explains how to deploy Story UI to production so non-developers can access it via a public URL.

---

## CRITICAL: Build-Time Environment Variable

**The most common deployment failure is forgetting to set `VITE_STORY_UI_EDGE_URL` during the Storybook build.**

```bash
# CORRECT: Build with Edge URL
VITE_STORY_UI_EDGE_URL=https://your-edge-worker.workers.dev npm run build-storybook

# WRONG: Build without Edge URL (will show "port 4001" in production)
npm run build-storybook
```

**Why this matters**: The Edge URL is injected at BUILD TIME, not runtime. If you build without it, the compiled JavaScript will hardcode `localhost:4001` as the API endpoint, which won't work in production.

---

## Understanding the Two Interfaces

Story UI has **two ways to access the generation panel**:

### 1. Standalone Story Panel (RECOMMENDED)
- URL pattern: `?path=/story/storyui-panel--default`
- Dark custom UI, full-screen experience
- Works independently of Storybook addons system
- **This is the primary, reliable interface**

### 2. Storybook Addon Panel (Legacy)
- URL pattern: `?path=/story/story-ui-story-generator--default`
- Appears in the Storybook addons panel (bottom/right)
- More tightly integrated with Storybook navigation
- **Only visible when Edge mode is detected**

For most deployments, use the **Standalone Story Panel** as it's more reliable and provides a better user experience.

---

## Architecture Overview

Story UI production deployment consists of two parts:

1. **Edge Worker (Backend)**: Cloudflare Workers that handles AI story generation
   - Stateless, globally distributed
   - Deployed to Cloudflare Workers
   - Fetches design considerations from the deployed Storybook

2. **Frontend (Storybook)**: Static site with Story UI panel
   - Deployed to Cloudflare Pages
   - Connects to the Edge Worker via `VITE_STORY_UI_EDGE_URL`
   - Bundles design considerations at build time

### Alternative: Traditional Backend

For organizations preferring traditional hosting:

1. **Backend (MCP Server)**: Node.js Express server that handles AI story generation
   - Supports multiple LLM providers: Claude (Anthropic), OpenAI, and Gemini (Google)
   - Deployed to Railway, Render, or Fly.io

2. **Frontend (Storybook)**: Static site with Story UI panel
   - Deployed to Cloudflare Pages
   - Connects to the backend via `VITE_STORY_UI_EDGE_URL`

## Quick Start

### Option 1: Full Deployment (Recommended)

```bash
# Deploy both backend and frontend
npx story-ui deploy --backend --frontend
```

This will:
1. Deploy the MCP server backend to Railway
2. Build Storybook with the backend URL
3. Deploy Storybook to Cloudflare Pages

### Option 2: Step-by-Step Deployment

#### Step 1: Deploy Backend

```bash
# Deploy to Railway (default)
npx story-ui deploy --backend --platform=railway

# Or deploy to Render
npx story-ui deploy --backend --platform=render

# Or deploy to Fly.io
npx story-ui deploy --backend --platform=fly
```

#### Step 2: Configure Environment Variables

After deploying the backend, configure these environment variables on your platform:

| Variable | Description | Required |
|----------|-------------|----------|
| `CLAUDE_API_KEY` | Anthropic API key for Claude | One of these |
| `OPENAI_API_KEY` | OpenAI API key | One of these |
| `GEMINI_API_KEY` | Google Gemini API key | One of these |
| `PORT` | Server port (default: 4001) | No |

**Note**: You need at least one API key configured. Users can select which provider to use in the Story UI panel.

#### Step 3: Deploy Frontend

```bash
# Deploy Storybook with your backend URL
npx story-ui deploy --frontend --backend-url=https://your-backend.railway.app
```

## Platform-Specific Instructions

### Railway

1. **Install Railway CLI**:
   ```bash
   npm install -g @railway/cli
   ```

2. **Login**:
   ```bash
   railway login
   ```

3. **Deploy**:
   ```bash
   npx story-ui deploy --backend --platform=railway
   ```

4. **Set Environment Variables** (in Railway dashboard):
   - Go to your project in [Railway Dashboard](https://railway.app/dashboard)
   - Click on your service
   - Go to "Variables" tab
   - Add your API keys

5. **Get Deployment URL**:
   ```bash
   railway domain
   ```

### Render

1. **Deploy**:
   ```bash
   npx story-ui deploy --backend --platform=render
   ```
   This creates a `render.yaml` file in your project.

2. **Connect to Render**:
   - Push your code to GitHub/GitLab
   - Go to [Render Dashboard](https://dashboard.render.com)
   - Create new Web Service from your repo
   - Render auto-detects the `render.yaml` config

3. **Set Environment Variables** (in Render dashboard):
   - Go to your service
   - Click "Environment" tab
   - Add your API keys

### Fly.io

1. **Install Fly CLI**:
   ```bash
   curl -L https://fly.io/install.sh | sh
   ```

2. **Login**:
   ```bash
   fly auth login
   ```

3. **Deploy**:
   ```bash
   npx story-ui deploy --backend --platform=fly
   ```

4. **Set Secrets**:
   ```bash
   fly secrets set CLAUDE_API_KEY=your-key
   fly secrets set OPENAI_API_KEY=your-key
   fly secrets set GEMINI_API_KEY=your-key
   ```

5. **Deploy**:
   ```bash
   fly deploy
   ```

## Frontend Deployment

### Cloudflare Pages

1. **Login to Cloudflare**:
   ```bash
   npx wrangler login
   ```

2. **Deploy**:
   ```bash
   npx story-ui deploy --frontend --backend-url=https://your-backend-url.com
   ```

3. **Custom Storybook Location**:
   ```bash
   npx story-ui deploy --frontend \
     --backend-url=https://your-backend-url.com \
     --storybook-dir=./path/to/your/storybook
   ```

## Testing Your Deployment

1. **Health Check**:
   ```bash
   curl https://your-backend-url.com/story-ui/providers
   ```
   Should return a list of available LLM providers.

2. **Access Storybook**:
   Open your Cloudflare Pages URL in a browser. The Story UI panel should be visible in the addons panel.

## CLI Reference

```
Usage: story-ui deploy [options]

Options:
  --backend              Deploy MCP server backend
  --frontend             Deploy Storybook frontend
  --platform <platform>  Backend platform: railway, render, fly (default: railway)
  --backend-url <url>    Use existing backend URL for frontend deployment
  --storybook-dir <dir>  Path to Storybook project
  --project-name <name>  Project name prefix (default: story-ui)
  --dry-run              Show what would be deployed without deploying
```

## Edge Worker Deployment (Recommended)

For the current production architecture using Cloudflare Edge Workers:

### Step 1: Deploy Edge Worker

```bash
cd cloudflare-edge
npx wrangler deploy
```

This deploys to: `https://story-ui-mcp-edge.<your-subdomain>.workers.dev`

### Step 2: Build Storybook with Edge URL

```bash
cd test-storybooks/your-storybook
VITE_STORY_UI_EDGE_URL=https://story-ui-mcp-edge.<your-subdomain>.workers.dev npm run build-storybook
```

### Step 3: Deploy Storybook to Cloudflare Pages

```bash
npx wrangler pages deploy storybook-static --project-name=story-ui-storybook
```

### Step 4: Verify Deployment

1. Open the Cloudflare Pages URL
2. Navigate to `?path=/story/storyui-panel--default`
3. Should show "Connected to Edge Worker" (not "port 4001")

---

## Troubleshooting

### "Connected to MCP server (port 4001)" in Production

**This is wrong!** It means the Storybook was built without the Edge URL.

**Fix**: Rebuild with the environment variable:
```bash
VITE_STORY_UI_EDGE_URL=https://your-edge-worker.workers.dev npm run build-storybook
npx wrangler pages deploy storybook-static --project-name=story-ui-storybook
```

### Backend Not Responding

1. Check if the service is running in your platform's dashboard
2. Verify environment variables are set correctly
3. Check the health endpoint: `GET /story-ui/providers`

### Frontend Can't Connect to Backend

1. Verify the backend URL is correct
2. Check CORS headers (backend should allow your frontend domain)
3. Ensure HTTPS is used for both frontend and backend

### Story Generation Fails

1. Verify at least one API key is configured
2. Check the provider is available: `GET /story-ui/providers`
3. Check server logs in your platform's dashboard

### Design Considerations Not Loading

The Edge Worker fetches considerations from the deployed Storybook's `/story-ui-considerations.json`.

1. Verify the file exists in `storybook-static/story-ui-considerations.json`
2. Check if `story-ui-docs/` directory has content
3. Rebuild Storybook to regenerate the considerations bundle

## Architecture Decision

The current architecture uses Cloudflare Edge Workers for:

1. **Global Distribution**: Edge locations reduce latency worldwide
2. **Stateless Design**: Easy horizontal scaling
3. **Cost Efficiency**: Pay-per-request model
4. **Integration**: Native Cloudflare ecosystem with Pages

Alternative traditional backend deployment (Railway, Render, Fly.io) is still supported for organizations with specific requirements.

---

## Notes for AI Developers

**IMPORTANT**: Read this section to avoid common deployment confusion.

### The Environment Variable is BUILD-TIME

The `VITE_STORY_UI_EDGE_URL` environment variable is **compiled into the JavaScript at build time**. This is controlled by Vite's `define` configuration in `.storybook/main.ts`:

```typescript
config.define = {
  'import.meta.env.VITE_STORY_UI_EDGE_URL': JSON.stringify(
    process.env.VITE_STORY_UI_EDGE_URL || ''  // Empty if not set!
  ),
};
```

If you build without setting the variable, the compiled JavaScript will contain an empty string, causing the fallback to `localhost:4001`.

### Key Files for Deployment

| File | Purpose |
|------|---------|
| `.storybook/main.ts` | Injects `VITE_STORY_UI_EDGE_URL` at build time |
| `.storybook/considerations-plugin.ts` | Bundles `story-ui-docs/` into JSON |
| `templates/StoryUI/StoryUIPanel.tsx` | Main panel, checks for Edge URL |
| `templates/StoryUI/manager.tsx` | Storybook addon registration |
| `cloudflare-edge/src/worker.ts` | Edge Worker API endpoints |

### The `getApiBase()` Function

In `StoryUIPanel.tsx`, the API base URL is determined by this priority:

1. `import.meta.env.VITE_STORY_UI_EDGE_URL` (build-time env var)
2. `window.__STORY_UI_EDGE_URL__` (runtime injection from manager head)
3. Fallback to `http://localhost:4001` (local development)

### Correct Deployment Commands

```bash
# 1. Deploy Edge Worker (one time or when updating)
cd cloudflare-edge && npx wrangler deploy

# 2. Build Storybook with Edge URL (REQUIRED!)
cd test-storybooks/your-storybook
VITE_STORY_UI_EDGE_URL=https://story-ui-mcp-edge.your-subdomain.workers.dev npm run build-storybook

# 3. Deploy to Cloudflare Pages
npx wrangler pages deploy storybook-static --project-name=story-ui-storybook

# 4. Verify (check compiled JS has correct URL)
grep -o "localhost:4001\|workers.dev" storybook-static/assets/*.js
# Should show workers.dev, NOT localhost:4001
```

### Common Mistakes

1. **Building without env var**: Running `npm run build-storybook` without `VITE_STORY_UI_EDGE_URL`
2. **Wrong interface**: Using the addon panel URL instead of the standalone panel
3. **Stale cache**: Browser caching old JavaScript with wrong URL
4. **Missing considerations**: Not having `story-ui-docs/` directory with content
