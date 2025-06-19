#!/bin/bash

# Test Project Management Script
# Helps manage Story UI installations across test projects

set -e

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(dirname "$SCRIPT_DIR")"
TEST_PROJECTS_DIR="$ROOT_DIR/test-storybooks"

# Function to list available test projects
list_projects() {
    echo -e "${BLUE}Available test projects:${NC}"
    for dir in "$TEST_PROJECTS_DIR"/*; do
        if [ -d "$dir" ]; then
            project_name=$(basename "$dir")
            echo "  - $project_name"
        fi
    done
}

# Function to setup cleanup scripts in a project
setup_cleanup() {
    local project_name="$1"
    local project_dir="$TEST_PROJECTS_DIR/$project_name"

    if [ ! -d "$project_dir" ]; then
        echo -e "${RED}❌ Project '$project_name' not found${NC}"
        return 1
    fi

    echo -e "${YELLOW}📋 Setting up cleanup scripts for $project_name...${NC}"

    # Copy cleanup scripts
    cp "$SCRIPT_DIR/cleanup-story-ui.js" "$project_dir/"
    cp "$SCRIPT_DIR/cleanup-story-ui.sh" "$project_dir/"
    chmod +x "$project_dir/cleanup-story-ui.sh"

    # Add npm scripts to package.json if they don't exist
    local package_json="$project_dir/package.json"
    if [ -f "$package_json" ]; then
        if ! grep -q '"cleanup"' "$package_json"; then
            # Create a temporary file with the updated package.json
            node -e "
                const fs = require('fs');
                const pkg = JSON.parse(fs.readFileSync('$package_json', 'utf8'));
                pkg.scripts = pkg.scripts || {};
                pkg.scripts.cleanup = 'node cleanup-story-ui.js';
                pkg.scripts['cleanup:bash'] = './cleanup-story-ui.sh';
                fs.writeFileSync('$package_json', JSON.stringify(pkg, null, 2) + '\n');
            "
            echo -e "${GREEN}✅ Added cleanup scripts to package.json${NC}"
        else
            echo -e "${BLUE}ℹ️  Cleanup scripts already exist in package.json${NC}"
        fi
    fi

    echo -e "${GREEN}✅ Setup complete for $project_name${NC}"
}

# Function to run cleanup in a project
cleanup_project() {
    local project_name="$1"
    local project_dir="$TEST_PROJECTS_DIR/$project_name"

    if [ ! -d "$project_dir" ]; then
        echo -e "${RED}❌ Project '$project_name' not found${NC}"
        return 1
    fi

    echo -e "${YELLOW}🧹 Cleaning up Story UI in $project_name...${NC}"

    cd "$project_dir"

    if [ -f "cleanup-story-ui.js" ]; then
        node cleanup-story-ui.js
    elif [ -f "package.json" ] && grep -q '"cleanup"' package.json; then
        npm run cleanup
    else
        echo -e "${RED}❌ No cleanup script found. Run setup first: $0 setup $project_name${NC}"
        return 1
    fi
}

# Function to setup all projects
setup_all() {
    echo -e "${BLUE}🔧 Setting up cleanup scripts for all test projects...${NC}"
    for dir in "$TEST_PROJECTS_DIR"/*; do
        if [ -d "$dir" ]; then
            project_name=$(basename "$dir")
            setup_cleanup "$project_name"
            echo ""
        fi
    done
    echo -e "${GREEN}✅ All projects setup complete!${NC}"
}

# Function to cleanup all projects
cleanup_all() {
    echo -e "${BLUE}🧹 Cleaning up all test projects...${NC}"
    for dir in "$TEST_PROJECTS_DIR"/*; do
        if [ -d "$dir" ]; then
            project_name=$(basename "$dir")
            cleanup_project "$project_name"
            echo ""
        fi
    done
    echo -e "${GREEN}✅ All projects cleaned up!${NC}"
}

# Main script logic
case "${1:-}" in
    "list"|"ls")
        list_projects
        ;;
    "setup")
        if [ -z "${2:-}" ]; then
            echo -e "${YELLOW}Usage: $0 setup <project-name>${NC}"
            echo -e "${YELLOW}   or: $0 setup all${NC}"
            echo ""
            list_projects
        elif [ "$2" = "all" ]; then
            setup_all
        else
            setup_cleanup "$2"
        fi
        ;;
    "cleanup")
        if [ -z "${2:-}" ]; then
            echo -e "${YELLOW}Usage: $0 cleanup <project-name>${NC}"
            echo -e "${YELLOW}   or: $0 cleanup all${NC}"
            echo ""
            list_projects
        elif [ "$2" = "all" ]; then
            cleanup_all
        else
            cleanup_project "$2"
        fi
        ;;
    "help"|"-h"|"--help")
        echo "Test Project Management Script"
        echo ""
        echo "Usage: $0 <command> [options]"
        echo ""
        echo "Commands:"
        echo "  list, ls                    List available test projects"
        echo "  setup <project>            Setup cleanup scripts for a project"
        echo "  setup all                  Setup cleanup scripts for all projects"
        echo "  cleanup <project>          Clean up Story UI from a project"
        echo "  cleanup all                Clean up Story UI from all projects"
        echo "  help, -h, --help           Show this help message"
        echo ""
        echo "Examples:"
        echo "  $0 list"
        echo "  $0 setup ant-design-test"
        echo "  $0 cleanup ant-design-test"
        echo "  $0 setup all"
        echo "  $0 cleanup all"
        ;;
    *)
        echo -e "${RED}❌ Unknown command: ${1:-}${NC}"
        echo ""
        echo "Available commands: list, setup, cleanup, help"
        echo "Run '$0 help' for more information"
        exit 1
        ;;
esac
