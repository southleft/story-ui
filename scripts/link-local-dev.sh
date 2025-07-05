#!/bin/bash

# Script to link local Story UI development version to test storybooks

echo "🔗 Linking local Story UI development version..."

# Get the script directory
SCRIPT_DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" && pwd )"
ROOT_DIR="$( cd "$SCRIPT_DIR/.." && pwd )"

# First, ensure we're built
echo "📦 Building Story UI..."
cd "$ROOT_DIR"
npm run build

# Create npm link
echo "🔗 Creating npm link for @tpitre/story-ui..."
npm link

# Find all test storybooks
echo "🔍 Finding test storybooks..."
TEST_DIRS=$(find "$ROOT_DIR/test-storybooks" -maxdepth 1 -type d ! -path "$ROOT_DIR/test-storybooks")

# Link in each test storybook
for dir in $TEST_DIRS; do
    if [ -f "$dir/package.json" ]; then
        echo "🔗 Linking in $(basename "$dir")..."
        cd "$dir"
        npm link @tpitre/story-ui
    fi
done

# Kill any running MCP servers
echo "🔄 Restarting MCP servers..."
pkill -f "mcp-server/index.js" || true

echo "✅ Done! Local development version is now linked."
echo ""
echo "⚠️  Note: Running 'npm install' in test storybooks will break the link."
echo "    Run this script again if that happens."
