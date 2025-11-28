# Story UI Production Deployment Guide

This guide explains how to deploy Story UI to production so non-developers can access it via a public URL.

## Architecture Overview

Story UI production deployment consists of two parts:

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

## Troubleshooting

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

## Architecture Decision

This deployment approach was chosen over Cloudflare Edge Workers because:

1. **Existing Code**: The MCP server already has 60+ working routes with full LLM provider integration
2. **Multi-Provider Support**: Complete support for Claude, OpenAI, and Gemini
3. **No Duplication**: Reuses proven, tested code instead of rewriting for edge
4. **Flexibility**: Organizations can choose their preferred hosting platform
5. **Cost Efficiency**: Traditional servers are often more cost-effective for AI workloads

The `VITE_STORY_UI_EDGE_URL` environment variable was already built into Storybook's configuration, making this deployment approach plug-and-play.
