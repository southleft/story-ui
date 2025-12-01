# Story UI Production Deployment Guide

This guide explains how to deploy Story UI to production so non-developers can access it via a public URL.

> **Last Updated**: December 1, 2025

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

For production deployments, stories persist through:

1. **Git Commits**: Generated stories are real `.stories.tsx` files that can be committed
2. **Volume Mounts**: Configure persistent storage in Railway for non-git persistence
3. **Re-generation**: Stories can be regenerated from saved prompts if needed

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

**Cause**: Railway containers are ephemeral
**Fix**:
1. Commit generated stories to your git repository
2. Or configure a persistent volume in Railway
3. Stories are automatically re-discovered on restart if files exist

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
