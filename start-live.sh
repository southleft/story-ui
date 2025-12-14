#!/bin/bash

# Story UI Live Production Start Script
# Runs Storybook in dev mode + MCP server with Storybook proxy

echo "🚀 Starting Story UI Live Environment..."
echo ""

# Configuration
STORYBOOK_PORT=6006
MCP_PORT=${PORT:-4001}
STORYBOOK_DIR="/app/test-storybooks/mantine-storybook"

# Start Storybook dev server in background
echo "📖 Starting Storybook dev server on internal port ${STORYBOOK_PORT}..."
cd "$STORYBOOK_DIR"
npm run storybook -- --port "$STORYBOOK_PORT" --host 0.0.0.0 --ci --no-open &
STORYBOOK_PID=$!

# Wait for Storybook to be ready (up to 60 seconds)
echo "⏳ Waiting for Storybook to start..."
MAX_WAIT=60
WAIT_INTERVAL=2
ELAPSED=0

while [ $ELAPSED -lt $MAX_WAIT ]; do
    # Check if process is still running
    if ! kill -0 $STORYBOOK_PID 2>/dev/null; then
        echo "❌ Storybook process exited unexpectedly"
        exit 1
    fi

    # Check if Storybook is responding to HTTP requests
    if wget -q --spider http://localhost:${STORYBOOK_PORT}/ 2>/dev/null; then
        echo "✅ Storybook dev server is ready on port ${STORYBOOK_PORT}"
        break
    fi

    # Wait and retry
    sleep $WAIT_INTERVAL
    ELAPSED=$((ELAPSED + WAIT_INTERVAL))
    echo "   Still waiting... (${ELAPSED}s/${MAX_WAIT}s)"
done

# Final check - if we exhausted the wait time
if [ $ELAPSED -ge $MAX_WAIT ]; then
    echo "❌ Storybook failed to start within ${MAX_WAIT} seconds"
    kill $STORYBOOK_PID 2>/dev/null
    exit 1
fi

# Start MCP server with Storybook proxy enabled
echo "🤖 Starting MCP server on port ${MCP_PORT}..."
cd /app

# Set environment variable to enable Storybook proxy
export STORYBOOK_PROXY_PORT=$STORYBOOK_PORT
export STORYBOOK_PROXY_ENABLED=true

# Change to mantine-storybook directory for proper config loading
cd "$STORYBOOK_DIR"

# Run the MCP server (it will pick up configs from current directory)
node /app/dist/mcp-server/index.js &
MCP_PID=$!

echo ""
echo "═══════════════════════════════════════════════════════════"
echo "✅ Story UI Live Environment is running!"
echo "═══════════════════════════════════════════════════════════"
echo ""
echo "   📖 Storybook (internal): http://localhost:${STORYBOOK_PORT}"
echo "   🤖 MCP Server (public):  http://localhost:${MCP_PORT}"
echo ""
echo "   API Endpoints:"
echo "   - /story-ui/providers    - List available LLM providers"
echo "   - /story-ui/generate     - Generate stories"
echo "   - /mcp-remote/mcp        - Claude Desktop MCP endpoint"
echo ""
echo "   Storybook UI is proxied through the MCP server."
echo "   Visit the public URL to access Storybook with Story UI panel."
echo ""
echo "═══════════════════════════════════════════════════════════"

# Handle shutdown gracefully
cleanup() {
    echo ""
    echo "🛑 Shutting down..."
    kill $STORYBOOK_PID 2>/dev/null
    kill $MCP_PID 2>/dev/null
    exit 0
}

trap cleanup SIGTERM SIGINT

# Wait for either process to exit
wait $STORYBOOK_PID $MCP_PID
