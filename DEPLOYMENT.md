# Story UI Production Deployment Guide

This guide explains how to deploy Story UI to production so non-developers can access it via a public URL.

> **Last Updated**: December 14, 2025

---

## Architecture Overview

Story UI production deployment consists of:

1. **Backend (MCP Server)**: Node.js Express server on Railway
   - Handles AI story generation via multiple LLM providers
   - Supports Claude (Anthropic), OpenAI, and Gemini (Google)
   - Stories are generated as `.stories.tsx` files

2. **Frontend**: React app served by the same Express server
   - Built with Vite, bundled into `dist/`
   - Served as static files from the MCP server

3. **Story Storage**: File-based (`.stories.tsx` files)
   - Stories are written to the configured `generatedStoriesPath`
   - Storybook's native file system watching discovers them automatically
   - Files can be committed to your repository for persistence

```
┌─────────────────────────────────────────────────────────────┐
│                    Railway Deployment                        │
│  ┌─────────────────────────────────────────────────────────┐│
│  │              Express MCP Server (Node.js)                ││
│  │  - Serves React frontend                                 ││
│  │  - API routes for story generation                       ││
│  │  - Multi-provider LLM support                            ││
│  │  - File-based story storage                              ││
│  └─────────────────────────────────────────────────────────┘│
│                            │                                 │
│                            ▼                                 │
│  ┌─────────────────────────────────────────────────────────┐│
│  │              Generated Stories (File System)             ││
│  │  - src/stories/generated/*.stories.tsx                   ││
│  │  - Commit to repo for persistence                        ││
│  └─────────────────────────────────────────────────────────┘│
└──────────────────────────────────────────────────────────────┘
```

---

## Quick Start: Railway Deployment

### Step 1: Install Railway CLI

```bash
npm install -g @railway/cli
railway login
```

### Step 2: Create Project

```bash
# Initialize Railway project
railway init
```

### Step 3: Configure Environment Variables

In the [Railway Dashboard](https://railway.app/dashboard), add these variables:

| Variable | Description | Required |
|----------|-------------|----------|
| `ANTHROPIC_API_KEY` | Claude API key | One of these |
| `OPENAI_API_KEY` | OpenAI API key | One of these |
| `GEMINI_API_KEY` | Google Gemini API key | One of these |
| `PORT` | Server port | Auto-set by Railway |

**Note**: You need at least one LLM API key configured.

### Step 4: Deploy

```bash
# Deploy to Railway
railway up

# Or push to connected git repository for auto-deploy
git push origin main
```

### Step 5: Get Your URL

```bash
railway domain
```

This gives you a public URL like `your-app.railway.app`.

---

## Story Storage

### How It Works

Story UI uses a simple file-based storage approach:

1. Stories are generated as `.stories.tsx` files
2. Files are written to the configured `generatedStoriesPath` (default: `./src/stories/generated`)
3. Storybook's native file system watching automatically discovers new stories
4. Commit generated stories to your repository for persistence across deployments

### Configuration

In your `story-ui.config.js`:

```javascript
export default {
  generatedStoriesPath: './src/stories/generated',
  storyPrefix: 'Generated/',
  // ... other options
};
```

### Persistence Strategy

For production deployments, stories persist through **Railway Volumes**:

#### Local vs Production Separation

- **Local environment**: Stories written to `./src/stories/generated/` (gitignored)
- **Production**: Stories written to Railway Volume mounted at `/app/src/stories/generated`
- **No conflicts**: Local stories never get committed, production stories persist independently

#### Setting Up Railway Volumes (Recommended)

Railway Volumes provide persistent storage that survives deployments. This requires the **Hobby plan** ($5/month).

**Step 1: Open Railway Dashboard**
1. Go to [railway.app/dashboard](https://railway.app/dashboard)
2. Select your project (e.g., `story-ui-mantine-live`)

**Step 2: Create Volume**
1. Press `⌘K` (or `Ctrl+K`) to open command palette
2. Type "Create Volume" and select it
3. Configure the volume:
   - **Name**: `generated-stories`
   - **Mount Path**: `/app/src/stories/generated`
   - **Size**: Start with 1GB (can expand later)

**Step 3: Connect to Service**
1. Click on your service in the project
2. Go to the "Volumes" tab
3. Attach the `generated-stories` volume

**Step 4: Redeploy**
1. Trigger a redeploy from the Railway dashboard
2. The volume will be mounted at runtime

> **Note**: Volumes are NOT mounted during build time, only at runtime. This is expected behavior.

#### Alternative Persistence Options

1. **Git Commits**: Commit generated stories to your repository (not recommended for production deployments)
2. **Re-generation**: Stories can be regenerated from saved prompts if needed

---

## Environment Variables Reference

### Required (at least one LLM provider)

| Variable | Description |
|----------|-------------|
| `ANTHROPIC_API_KEY` | Anthropic API key for Claude models |
| `OPENAI_API_KEY` | OpenAI API key for GPT models |
| `GEMINI_API_KEY` | Google API key for Gemini models |

### Recommended

| Variable | Description |
|----------|-------------|
| `DEFAULT_MODEL` | Default model to use (e.g., `claude-sonnet-4-5-20250929`) |

### Optional

| Variable | Description |
|----------|-------------|
| `PORT` | Server port (Railway sets automatically) |
| `NODE_ENV` | Set to `production` for production deployments |
| `STORY_UI_ALLOWED_ORIGINS` | Comma-separated allowed CORS origins |

---

## Storybook Live Mode Deployment

For projects that want to deploy Storybook with Story UI integrated (enabling AI-powered story generation directly in the deployed Storybook), use the **Live Mode** deployment pattern.

### Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                    Railway Deployment                        │
│  ┌─────────────────────────────────────────────────────────┐│
│  │         Storybook Dev Server (internal port 6006)        ││
│  │  - Hot-reloading components                              ││
│  │  - Story UI panel in sidebar                             ││
│  └─────────────────────────────────────────────────────────┘│
│                            ▲                                 │
│                            │ Proxy                           │
│  ┌─────────────────────────────────────────────────────────┐│
│  │              MCP Server (Railway PORT)                   ││
│  │  - Proxies Storybook requests                            ││
│  │  - API routes for story generation                       ││
│  │  - Multi-provider LLM support                            ││
│  └─────────────────────────────────────────────────────────┘│
└──────────────────────────────────────────────────────────────┘
```

### Prerequisites

1. **StoryUI Panel Must Be Committed to Git**

   The Story UI panel files (`src/stories/StoryUI/`) MUST be committed to your repository:

   ```bash
   # Check if StoryUI is in gitignore (it should NOT be)
   grep -r "StoryUI" .gitignore

   # If it's there, remove it from .gitignore
   # Then commit the StoryUI panel files
   git add src/stories/StoryUI/
   git commit -m "Add StoryUI panel for production deployment"
   ```

   > **Important**: Versions of Story UI prior to 4.10.0 incorrectly added `src/stories/StoryUI/` to `.gitignore`. If you initialized Story UI with an older version, you need to manually remove this entry and commit the StoryUI panel files.

2. **Create start-live.sh Script**

   ```bash
   #!/bin/bash

   # Story UI Live Production Start Script
   echo "🚀 Starting Story UI Live Environment..."

   STORYBOOK_PORT=6006
   MCP_PORT=${PORT:-4001}

   # Start Storybook dev server
   pnpm storybook --port "$STORYBOOK_PORT" --host 0.0.0.0 --ci --no-open &
   STORYBOOK_PID=$!

   sleep 15

   if ! kill -0 $STORYBOOK_PID 2>/dev/null; then
       echo "❌ Storybook failed to start"
       exit 1
   fi

   # Set proxy environment variables
   export STORYBOOK_PROXY_PORT=$STORYBOOK_PORT
   export STORYBOOK_PROXY_ENABLED=true

   # Start MCP server with Storybook proxy
   npx story-ui start --port "$MCP_PORT" &
   MCP_PID=$!

   # Graceful shutdown handler
   cleanup() {
       kill $STORYBOOK_PID $MCP_PID 2>/dev/null
       exit 0
   }
   trap cleanup SIGTERM SIGINT

   wait $STORYBOOK_PID $MCP_PID
   ```

3. **Create Dockerfile**

   ```dockerfile
   FROM node:20-slim

   WORKDIR /app

   RUN apt-get update && apt-get install -y git wget && rm -rf /var/lib/apt/lists/*
   RUN npm install -g pnpm

   COPY package.json pnpm-lock.yaml ./
   RUN pnpm install --frozen-lockfile

   COPY . .
   RUN chmod +x ./start-live.sh

   ENV NODE_OPTIONS="--max-old-space-size=4096"

   EXPOSE ${PORT:-4001}

   HEALTHCHECK --interval=30s --timeout=10s --start-period=180s --retries=5 \
     CMD /bin/sh -c 'wget --no-verbose --tries=1 --spider http://localhost:${PORT:-4001}/story-ui/providers || exit 1'

   CMD ["./start-live.sh"]
   ```

### Common Issues

#### Story UI Panel Not Visible

**Symptom**: Storybook deploys but Story UI panel doesn't appear in sidebar

**Cause**: `src/stories/StoryUI/` is in `.gitignore` and not deployed

**Fix**:
1. Remove `src/stories/StoryUI/` from `.gitignore`
2. Commit the StoryUI panel files:
   ```bash
   git add src/stories/StoryUI/
   git commit -m "Add StoryUI panel for production"
   git push
   ```

#### MCP Server Not Starting

**Symptom**: API endpoints not responding

**Cause**: Using direct node invocation instead of CLI

**Fix**: Use `npx story-ui start --port "$MCP_PORT"` in your start script (not direct node invocation)

---

## Testing Your Deployment

### Health Check

```bash
curl https://your-app.railway.app/story-ui/providers
```

Should return available LLM providers:
```json
{
  "providers": [
    {"id": "anthropic", "name": "Claude (Anthropic)", "models": [...]}
  ]
}
```

---

## Troubleshooting

### No LLM Providers Available

**Cause**: No API keys configured
**Fix**: Add at least one of `ANTHROPIC_API_KEY`, `OPENAI_API_KEY`, or `GEMINI_API_KEY`

### CORS Errors

**Cause**: Frontend domain not allowed
**Fix**: Add domain to `STORY_UI_ALLOWED_ORIGINS` environment variable

### Generation Fails Silently

**Cause**: Invalid API key or rate limiting
**Fix**:
1. Verify API key is valid
2. Check Railway logs: `railway logs`
3. Test API key directly with provider's API

### Stories Not Persisting

**Cause**: Railway containers are ephemeral by default
**Fix**:
1. Set up a Railway Volume (see "Setting Up Railway Volumes" above)
2. Mount the volume at `/app/src/stories/generated`
3. Stories will persist across deployments automatically
4. Requires Hobby plan ($5/month) for volume support

---

## CI/CD with GitHub Actions

Example workflow for automatic deployments:

```yaml
name: Deploy to Railway

on:
  push:
    branches: [main]

jobs:
  deploy:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4

      - name: Install Railway CLI
        run: npm install -g @railway/cli

      - name: Deploy
        env:
          RAILWAY_TOKEN: ${{ secrets.RAILWAY_TOKEN }}
        run: railway up --detach
```

---

## Local Development vs Production

| Feature | Local | Production |
|---------|-------|------------|
| Story storage | File system | File system (commit for persistence) |
| API base | `localhost:4001` | Your Railway URL |
| Hot reload | Yes | No |
| HTTPS | No | Yes (automatic) |

---

## Security Considerations

1. **Never commit API keys** - Use environment variables
2. **Use HTTPS** - Railway provides automatic SSL
3. **Limit CORS origins** - Set `STORY_UI_ALLOWED_ORIGINS` in production

---

## Notes for AI Developers

### Key Files for Deployment

| File | Purpose |
|------|---------|
| `mcp-server/index.ts` | Express server entry point |
| `story-generator/generateStory.ts` | File-based story generation |
| `package.json` | Build and start scripts |

### Build and Start Commands

```json
{
  "scripts": {
    "build": "tsc && vite build",
    "story-ui": "node dist/mcp-server/index.js"
  }
}
```

Railway uses `npm run build` then `npm run story-ui` by default.
