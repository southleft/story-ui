# Story UI Combined Deployment
# Runs Storybook in DEV MODE with MCP server for dynamic story generation
# - Storybook dev server (internal port 6006) for hot-reloading
# - MCP server (Railway PORT) serves API + proxies Storybook

FROM node:20-slim

WORKDIR /app

# Install dependencies needed for Storybook
RUN apt-get update && apt-get install -y \
    git \
    && rm -rf /var/lib/apt/lists/*

# Copy root package files first
COPY package*.json ./
COPY yarn.lock* ./

# Install story-ui dependencies
RUN npm install

# Copy story-ui source
COPY . .

# Build story-ui from source
RUN npm run build

# Now set up the mantine-storybook
WORKDIR /app/test-storybooks/mantine-storybook

# Install mantine-storybook dependencies (uses @tpitre/story-ui from npm)
RUN npm install

# Link the local story-ui build instead of npm version
# This ensures we use the latest source code
RUN npm link /app

# Go back to app root
WORKDIR /app

# Make start script executable
COPY start-live.sh ./
RUN chmod +x ./start-live.sh

# Environment variables (set these in Railway dashboard)
# ANTHROPIC_API_KEY - Claude API key
# OPENAI_API_KEY - OpenAI API key (optional)
# GEMINI_API_KEY - Google Gemini API key (optional)
# PORT - Server port (set by Railway, default: 4001)

# Expose the port (Railway sets PORT)
EXPOSE ${PORT:-4001}

# Health check - verify MCP server is responding
# Use shell form for runtime $PORT expansion (Railway sets PORT dynamically)
HEALTHCHECK --interval=30s --timeout=10s --start-period=60s --retries=3 \
  CMD /bin/sh -c 'wget --no-verbose --tries=1 --spider http://localhost:${PORT:-4001}/story-ui/providers || exit 1'

# Start both servers
CMD ["./start-live.sh"]
