# Story UI MCP Server - Production Dockerfile
# Deploys the backend API server for Story UI

FROM node:20-alpine

# Set working directory
WORKDIR /app

# Copy package files
COPY package*.json ./
COPY yarn.lock* ./

# Install ALL dependencies (needed for build)
RUN npm install

# Copy source files
COPY . .

# Build the project
RUN npm run build

# Prune dev dependencies after build
RUN npm prune --production

# Environment variables (set these in Railway/Render dashboard)
# CLAUDE_API_KEY - Anthropic API key
# OPENAI_API_KEY - OpenAI API key
# GEMINI_API_KEY - Google Gemini API key
# PORT - Server port (default: 4001)

# Expose the port
EXPOSE ${PORT:-4001}

# Health check
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD wget --no-verbose --tries=1 --spider http://localhost:${PORT:-4001}/story-ui/providers || exit 1

# Start the MCP server
CMD ["node", "dist/mcp-server/index.js"]
