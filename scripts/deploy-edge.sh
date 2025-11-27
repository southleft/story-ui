#!/bin/bash

# Story UI Edge Deployment Script
# Deploys both the Edge MCP Worker and the Cloudflare Pages Chat UI

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

echo -e "${BLUE}╔═══════════════════════════════════════════════════════════════╗${NC}"
echo -e "${BLUE}║         Story UI - Edge Deployment Script                     ║${NC}"
echo -e "${BLUE}╚═══════════════════════════════════════════════════════════════╝${NC}"
echo ""

# Parse arguments
DEPLOY_EDGE=true
DEPLOY_PAGES=true
DRY_RUN=false

while [[ "$#" -gt 0 ]]; do
    case $1 in
        --edge-only) DEPLOY_PAGES=false ;;
        --pages-only) DEPLOY_EDGE=false ;;
        --dry-run) DRY_RUN=true ;;
        -h|--help)
            echo "Usage: $0 [options]"
            echo ""
            echo "Options:"
            echo "  --edge-only    Deploy only the Edge MCP Worker"
            echo "  --pages-only   Deploy only the Cloudflare Pages UI"
            echo "  --dry-run      Show what would be deployed without deploying"
            echo "  -h, --help     Show this help message"
            exit 0
            ;;
        *) echo "Unknown parameter: $1"; exit 1 ;;
    esac
    shift
done

# Check for wrangler (via npx or global install)
check_wrangler() {
    if command -v wrangler &> /dev/null; then
        return 0
    elif npx wrangler --version &> /dev/null; then
        return 0
    else
        return 1
    fi
}

if ! check_wrangler; then
    echo -e "${RED}Error: wrangler CLI not found.${NC}"
    echo "Install it with: npm install -g wrangler"
    exit 1
fi

# Check authentication
echo -e "${YELLOW}Checking Cloudflare authentication...${NC}"
if ! npx wrangler whoami &> /dev/null; then
    echo -e "${RED}Error: Not logged in to Cloudflare.${NC}"
    echo "Run: wrangler login"
    exit 1
fi
echo -e "${GREEN}✓ Authenticated${NC}"
echo ""

# Deploy Edge MCP Worker
if [ "$DEPLOY_EDGE" = true ]; then
    echo -e "${BLUE}═══ Deploying Edge MCP Worker ═══${NC}"

    EDGE_DIR="$PROJECT_ROOT/cloudflare-edge"

    if [ ! -d "$EDGE_DIR" ]; then
        echo -e "${RED}Error: Edge worker directory not found at $EDGE_DIR${NC}"
        exit 1
    fi

    cd "$EDGE_DIR"

    # Install dependencies if needed
    if [ ! -d "node_modules" ]; then
        echo -e "${YELLOW}Installing edge worker dependencies...${NC}"
        npm install
    fi

    if [ "$DRY_RUN" = true ]; then
        echo -e "${YELLOW}[DRY RUN] Would deploy edge worker from $EDGE_DIR${NC}"
    else
        echo -e "${YELLOW}Deploying edge worker...${NC}"
        npx wrangler deploy
        echo -e "${GREEN}✓ Edge MCP Worker deployed!${NC}"
    fi

    echo ""
fi

# Deploy Cloudflare Pages UI
if [ "$DEPLOY_PAGES" = true ]; then
    echo -e "${BLUE}═══ Deploying Cloudflare Pages UI ═══${NC}"

    PAGES_DIR="$PROJECT_ROOT/cloudflare-pages"

    if [ ! -d "$PAGES_DIR" ]; then
        echo -e "${RED}Error: Pages directory not found at $PAGES_DIR${NC}"
        exit 1
    fi

    cd "$PAGES_DIR"

    # Install dependencies if needed
    if [ ! -d "node_modules" ]; then
        echo -e "${YELLOW}Installing pages dependencies...${NC}"
        npm install
    fi

    if [ "$DRY_RUN" = true ]; then
        echo -e "${YELLOW}[DRY RUN] Would build and deploy pages from $PAGES_DIR${NC}"
    else
        echo -e "${YELLOW}Building pages...${NC}"
        npm run build

        echo -e "${YELLOW}Deploying to Cloudflare Pages...${NC}"
        npx wrangler pages deploy dist --project-name=story-ui-chat
        echo -e "${GREEN}✓ Cloudflare Pages UI deployed!${NC}"
    fi

    echo ""
fi

# Summary
echo -e "${GREEN}╔═══════════════════════════════════════════════════════════════╗${NC}"
echo -e "${GREEN}║                    Deployment Complete!                       ║${NC}"
echo -e "${GREEN}╚═══════════════════════════════════════════════════════════════╝${NC}"
echo ""

if [ "$DEPLOY_EDGE" = true ]; then
    echo -e "Edge MCP Worker: ${BLUE}https://story-ui-mcp-edge.southleft-llc.workers.dev${NC}"
fi

if [ "$DEPLOY_PAGES" = true ]; then
    echo -e "Chat UI:         ${BLUE}https://story-ui-chat.pages.dev${NC}"
fi

echo ""
echo -e "${YELLOW}Note: First Pages deployment may take a few minutes to propagate.${NC}"
