# Story UI Production Deployment Guide

This guide explains how to deploy Story UI to production so non-developers can access it via a public URL.

> **Last Updated**: December 1, 2025

---

## Architecture Overview

Story UI production deployment consists of:

1. **Backend (MCP Server)**: Node.js Express server on Railway
   - Handles AI story generation via multiple LLM providers
   - PostgreSQL database for persistent story storage
   - Supports Claude (Anthropic), OpenAI, and Gemini (Google)

2. **Frontend**: React app served by the same Express server
   - Built with Vite, bundled into `dist/`
   - Served as static files from the MCP server

```
┌─────────────────────────────────────────────────────────────┐
│                    Railway Deployment                        │
│  ┌─────────────────────────────────────────────────────────┐│
│  │              Express MCP Server (Node.js)                ││
│  │  - Serves React frontend                                 ││
│  │  - API routes for story generation                       ││
│  │  - Multi-provider LLM support                            ││
│  └─────────────────────────────────────────────────────────┘│
│                            │                                 │
│                            ▼                                 │
│  ┌─────────────────────────────────────────────────────────┐│
│  │              PostgreSQL Database                         ││
│  │  - Story persistence across deployments                  ││
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

### Step 2: Create Project and Database

```bash
# Initialize Railway project
railway init

# Add PostgreSQL database
railway add --plugin postgresql
```

### Step 3: Configure Environment Variables

In the [Railway Dashboard](https://railway.app/dashboard), add these variables:

| Variable | Description | Required |
|----------|-------------|----------|
| `DATABASE_URL` | PostgreSQL connection string | Auto-set by Railway |
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

## PostgreSQL Setup for Story Persistence

**Why PostgreSQL?**: Railway containers are ephemeral. Without a database, all generated stories are lost when the container restarts or redeploys.

### Automatic Setup

When `DATABASE_URL` is present, Story UI automatically:
1. Creates the `stories` table on first connection
2. Stores all generated stories with metadata
3. Persists across container restarts

### Schema

```sql
CREATE TABLE IF NOT EXISTS stories (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  content TEXT NOT NULL,
  chat_id TEXT,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  metadata JSONB DEFAULT '{}'
);
```

### Verify Database Connection

Check the server logs after deployment:
```
🗄️  Using PostgreSQL for story persistence
✅ PostgreSQL stories table ready
```

If you see this instead, `DATABASE_URL` is not set:
```
💾 Using in-memory storage (no DATABASE_URL configured)
```

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
| `DATABASE_URL` | PostgreSQL connection string for persistent storage |
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

### Story Persistence Check

```bash
curl https://your-app.railway.app/story-ui/stories
```

Should return stored stories (empty array if none yet):
```json
[]
```

### Database Connection Check

```bash
curl https://your-app.railway.app/story-ui/memory-stats
```

Should show storage type:
```json
{
  "success": true,
  "stats": {...},
  "storage": "postgresql"  // or "memory" if DATABASE_URL not set
}
```

---

## Troubleshooting

### Stories Disappear After Redeploy

**Cause**: `DATABASE_URL` not configured
**Fix**: Add PostgreSQL database to Railway and verify `DATABASE_URL` is set

### "Failed to connect to database"

**Cause**: Invalid `DATABASE_URL` or database not accessible
**Fix**:
1. Verify PostgreSQL addon is attached in Railway dashboard
2. Check `DATABASE_URL` format: `postgresql://user:pass@host:5432/db`
3. Ensure database is in same Railway project (private networking)

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
| Story storage | In-memory (file system in dev mode) | PostgreSQL |
| API base | `localhost:4001` | Your Railway URL |
| Hot reload | Yes | No |
| HTTPS | No | Yes (automatic) |

---

## Security Considerations

1. **Never commit API keys** - Use environment variables
2. **Use HTTPS** - Railway provides automatic SSL
3. **Limit CORS origins** - Set `STORY_UI_ALLOWED_ORIGINS` in production
4. **Database security** - Railway's private networking keeps PostgreSQL internal

---

## Notes for AI Developers

### Key Files for Deployment

| File | Purpose |
|------|---------|
| `mcp-server/index.ts` | Express server entry point |
| `story-generator/storyServiceFactory.ts` | Chooses storage backend |
| `story-generator/postgresStoryService.ts` | PostgreSQL implementation |
| `package.json` | Build and start scripts |

### Storage Backend Selection

The `storyServiceFactory.ts` automatically selects storage:

```typescript
if (process.env.DATABASE_URL) {
  // Use PostgreSQL
  return new PostgresStoryService(databaseUrl);
} else {
  // Fall back to in-memory
  return new AsyncInMemoryStoryService(config);
}
```

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
