#!/bin/bash
# Clean Testing Workflow for Story UI
# This script ensures a clean test environment by:
# 1. Building story-ui from source
# 2. Clearing bundler caches in test environment
# 3. Re-linking the package
# 4. Starting Storybook with fresh state

set -e

# Configuration
STORY_UI_DIR="/Users/tjpitre/Sites/story-ui"
TEST_STORYBOOKS_DIR="/Users/tjpitre/Sites/test-storybooks"
DEFAULT_TEST_ENV="react-mantine"

# Color output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Parse arguments
TEST_ENV="${1:-$DEFAULT_TEST_ENV}"
SKIP_BUILD="${2:-false}"

echo -e "${BLUE}=== Story UI Clean Test Workflow ===${NC}"
echo -e "Test environment: ${YELLOW}$TEST_ENV${NC}"

# Validate test environment exists
TEST_DIR="$TEST_STORYBOOKS_DIR/$TEST_ENV"
if [ ! -d "$TEST_DIR" ]; then
    echo -e "${RED}Error: Test environment '$TEST_ENV' not found at $TEST_DIR${NC}"
    echo "Available environments:"
    ls -1 "$TEST_STORYBOOKS_DIR"
    exit 1
fi

# Step 1: Build story-ui
if [ "$SKIP_BUILD" != "skip-build" ]; then
    echo -e "\n${YELLOW}Step 1: Building story-ui package...${NC}"
    cd "$STORY_UI_DIR"
    npm run build
    echo -e "${GREEN}Build complete!${NC}"
else
    echo -e "\n${YELLOW}Step 1: Skipping build (--skip-build)${NC}"
fi

# Step 2: Verify dist files exist
echo -e "\n${YELLOW}Step 2: Verifying compiled files...${NC}"
PANEL_FILE="$STORY_UI_DIR/dist/templates/StoryUI/StoryUIPanel.js"
if [ -f "$PANEL_FILE" ]; then
    echo -e "${GREEN}StoryUIPanel.js exists${NC}"
    # Check for emoji removal
    if grep -q "✅\|🔧\|⚠️\|💡" "$PANEL_FILE" 2>/dev/null; then
        echo -e "${YELLOW}Warning: Emojis still found in compiled output${NC}"
    else
        echo -e "${GREEN}No emojis found in compiled output${NC}"
    fi
else
    echo -e "${RED}Error: StoryUIPanel.js not found${NC}"
    exit 1
fi

# Step 3: Kill any running processes on test ports
echo -e "\n${YELLOW}Step 3: Stopping any running servers...${NC}"
case "$TEST_ENV" in
    "react-mantine")     STORYBOOK_PORT=6101; MCP_PORT=4101 ;;
    "angular-material")  STORYBOOK_PORT=6102; MCP_PORT=4102 ;;
    "vue-vuetify")       STORYBOOK_PORT=6103; MCP_PORT=4103 ;;
    "svelte-flowbite")   STORYBOOK_PORT=6104; MCP_PORT=4104 ;;
    "web-components-shoelace") STORYBOOK_PORT=6105; MCP_PORT=4105 ;;
    *) STORYBOOK_PORT=6106; MCP_PORT=4106 ;;
esac

lsof -ti :$STORYBOOK_PORT | xargs kill -9 2>/dev/null || true
lsof -ti :$MCP_PORT | xargs kill -9 2>/dev/null || true
sleep 1
echo -e "${GREEN}Servers stopped${NC}"

# Step 4: Clear bundler caches
echo -e "\n${YELLOW}Step 4: Clearing bundler caches...${NC}"
cd "$TEST_DIR"
rm -rf node_modules/.cache 2>/dev/null || true
rm -rf .storybook/cache 2>/dev/null || true
rm -rf storybook-static 2>/dev/null || true
echo -e "${GREEN}Caches cleared${NC}"

# Step 5: Verify symlink is correct
echo -e "\n${YELLOW}Step 5: Verifying npm link...${NC}"
LINK_PATH="$TEST_DIR/node_modules/@tpitre/story-ui"
if [ -L "$LINK_PATH" ]; then
    LINK_TARGET=$(readlink "$LINK_PATH")
    echo -e "${GREEN}Symlink exists: $LINK_PATH -> $LINK_TARGET${NC}"
else
    echo -e "${RED}Warning: @tpitre/story-ui is not symlinked${NC}"
    echo "Running npm link..."
    npm link @tpitre/story-ui
fi

# Step 6: Start servers
echo -e "\n${YELLOW}Step 6: Starting servers...${NC}"
echo "Starting Storybook on port $STORYBOOK_PORT..."
npm run storybook -- --port $STORYBOOK_PORT &
STORYBOOK_PID=$!

sleep 3

echo "Starting Story UI MCP server on port $MCP_PORT..."
npm run story-ui &
MCP_PID=$!

# Wait for servers to be ready
echo -e "\n${YELLOW}Waiting for servers to be ready...${NC}"
for i in {1..30}; do
    if curl -s "http://localhost:$STORYBOOK_PORT" > /dev/null 2>&1; then
        echo -e "${GREEN}Storybook is ready!${NC}"
        break
    fi
    sleep 1
    echo -n "."
done

for i in {1..10}; do
    if curl -s "http://localhost:$MCP_PORT/health" > /dev/null 2>&1; then
        echo -e "${GREEN}MCP server is ready!${NC}"
        break
    fi
    sleep 1
    echo -n "."
done

# Print summary
echo -e "\n${BLUE}=== Test Environment Ready ===${NC}"
echo -e "Storybook: ${GREEN}http://localhost:$STORYBOOK_PORT${NC}"
echo -e "Story UI Panel: ${GREEN}http://localhost:$STORYBOOK_PORT/?path=/docs/story-ui-story-generator--docs${NC}"
echo -e "MCP Server: ${GREEN}http://localhost:$MCP_PORT${NC}"
echo -e "\n${YELLOW}Important: To test with fresh localStorage, open browser in incognito mode${NC}"
echo -e "${YELLOW}or clear localStorage in DevTools: localStorage.clear()${NC}"
echo -e "\nPress Ctrl+C to stop servers"

# Wait for interrupt
wait $STORYBOOK_PID $MCP_PID
