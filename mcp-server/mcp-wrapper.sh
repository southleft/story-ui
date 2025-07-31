#!/bin/bash

# Wrapper script for MCP server to ensure clean stdio communication
# All diagnostic output goes to stderr

# Set environment to suppress all console.log output
export STORY_UI_MCP_MODE=true

# Run the actual MCP server
exec node "$1" mcp "$@"
