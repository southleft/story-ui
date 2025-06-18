#!/bin/bash

# Story UI Cleanup Script
# Removes all Story UI installations, configurations, and generated files

echo "🧹 Story UI Cleanup Script"
echo "=========================="
echo ""

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Function to safely remove files/directories
safe_remove() {
    local path="$1"
    local description="$2"

    if [ -e "$path" ]; then
        echo -e "${YELLOW}🗑️  Removing $description: ${NC}$path"
        rm -rf "$path"
        echo -e "${GREEN}✅ Removed${NC}"
    else
        echo -e "${BLUE}ℹ️  Not found: ${NC}$path"
    fi
}

# Function to remove lines from .gitignore
clean_gitignore() {
    local gitignore_file=".gitignore"

    if [ -f "$gitignore_file" ]; then
        echo -e "${YELLOW}📝 Cleaning .gitignore...${NC}"

        # Create a temporary file
        local temp_file=$(mktemp)

        # Remove Story UI related patterns
        grep -v -E "(# Story UI|src/stories/generated|generated/|StoryUI/|story-ui)" "$gitignore_file" > "$temp_file"

        # Replace original file if changes were made
        if ! cmp -s "$gitignore_file" "$temp_file"; then
            mv "$temp_file" "$gitignore_file"
            echo -e "${GREEN}✅ Cleaned .gitignore${NC}"
        else
            rm "$temp_file"
            echo -e "${BLUE}ℹ️  No Story UI entries found in .gitignore${NC}"
        fi
    else
        echo -e "${BLUE}ℹ️  No .gitignore file found${NC}"
    fi
}

# Function to clean package.json
clean_package_json() {
    local package_file="package.json"

    if [ -f "$package_file" ]; then
        echo -e "${YELLOW}📝 Cleaning package.json...${NC}"

        # Check if Story UI is in dependencies or devDependencies
        if grep -q '"@tpitre/story-ui"\|"story-ui"' "$package_file"; then
            echo -e "${YELLOW}⚠️  Found Story UI in package.json dependencies.${NC}"
            echo -e "${YELLOW}   Run: ${NC}npm uninstall @tpitre/story-ui story-ui"
        fi

        # Check for Story UI scripts
        if grep -q '"story-ui"\|"storybook-with-ui"' "$package_file"; then
            echo -e "${YELLOW}⚠️  Found Story UI scripts in package.json.${NC}"
            echo -e "${YELLOW}   You may want to manually remove:${NC}"
            echo -e "${YELLOW}   - story-ui script${NC}"
            echo -e "${YELLOW}   - storybook-with-ui script${NC}"
        fi

        # Check for storyUI config in package.json
        if grep -q '"storyUI"' "$package_file"; then
            echo -e "${YELLOW}⚠️  Found Story UI configuration in package.json.${NC}"
            echo -e "${YELLOW}   You may want to manually remove the 'storyUI' section${NC}"
        fi
    else
        echo -e "${BLUE}ℹ️  No package.json file found${NC}"
    fi
}

echo -e "${BLUE}🔍 Scanning for Story UI files...${NC}"
echo ""

# 1. Remove Story UI configuration files
echo -e "${BLUE}📋 Configuration Files:${NC}"
safe_remove "story-ui.config.js" "Story UI config file"
safe_remove "story-ui.config.ts" "Story UI TypeScript config file"
safe_remove ".env" "Environment file (if created by Story UI)"

echo ""

# 2. Remove generated stories directories (common locations)
echo -e "${BLUE}📁 Generated Stories Directories:${NC}"
safe_remove "src/stories/generated" "Generated stories (src/stories/generated)"
safe_remove "stories/generated" "Generated stories (stories/generated)"
safe_remove ".storybook/generated" "Generated stories (.storybook/generated)"
safe_remove "src/components/generated" "Generated stories (src/components/generated)"
safe_remove "libs/*/src/components/generated" "Generated stories (libs/*/src/components/generated)"

echo ""

# 3. Remove StoryUI component directories (installed by Story UI)
echo -e "${BLUE}🎛️  Story UI Components:${NC}"
safe_remove "src/stories/StoryUI" "Story UI Panel component (src/stories/StoryUI)"
safe_remove "stories/StoryUI" "Story UI Panel component (stories/StoryUI)"
safe_remove ".storybook/StoryUI" "Story UI Panel component (.storybook/StoryUI)"
safe_remove "src/stories/generated/StoryUI" "Story UI Panel component (src/stories/generated/StoryUI)"

echo ""

# 4. Remove any .story-ui directories (cache/temp)
echo -e "${BLUE}💾 Cache and Temp Files:${NC}"
safe_remove ".story-ui" "Story UI cache directory"
safe_remove "node_modules/.story-ui" "Story UI node modules cache"

echo ""

# 5. Remove any story tracking files
echo -e "${BLUE}📊 Story Tracking Files:${NC}"
safe_remove "src/stories/.story-mappings.json" "Story mappings file"
safe_remove "stories/.story-mappings.json" "Story mappings file"
safe_remove ".storybook/.story-mappings.json" "Story mappings file"

echo ""

# 6. Clean .gitignore
echo -e "${BLUE}📝 Git Configuration:${NC}"
clean_gitignore

echo ""

# 7. Check package.json
echo -e "${BLUE}📦 Package Configuration:${NC}"
clean_package_json

echo ""

# 8. Look for any remaining Story UI files
echo -e "${BLUE}🔍 Scanning for remaining Story UI files...${NC}"
remaining_files=$(find . -name "*story-ui*" -o -name "*StoryUI*" 2>/dev/null | grep -v node_modules | grep -v .git | head -10)

if [ -n "$remaining_files" ]; then
    echo -e "${YELLOW}⚠️  Found additional files that may be related to Story UI:${NC}"
    echo "$remaining_files" | while read -r file; do
        echo -e "${YELLOW}   - $file${NC}"
    done
    echo -e "${YELLOW}   Review these files manually if needed.${NC}"
else
    echo -e "${GREEN}✅ No additional Story UI files found${NC}"
fi

echo ""
echo -e "${GREEN}🎉 Story UI cleanup completed!${NC}"
echo ""
echo -e "${BLUE}📋 Manual steps (if applicable):${NC}"
echo -e "${YELLOW}1. Uninstall Story UI package:${NC}"
echo "   npm uninstall @tpitre/story-ui story-ui"
echo ""
echo -e "${YELLOW}2. Remove Story UI scripts from package.json:${NC}"
echo '   - "story-ui": "story-ui start"'
echo '   - "storybook-with-ui": "concurrently ..."'
echo ""
echo -e "${YELLOW}3. Remove Story UI configuration from package.json:${NC}"
echo '   - "storyUI": { ... } section'
echo ""
echo -e "${YELLOW}4. Clean npm/yarn cache (optional):${NC}"
echo "   npm cache clean --force"
echo "   # or"
echo "   yarn cache clean"
echo ""
echo -e "${GREEN}✨ Your project is now clean and ready for a fresh Story UI installation!${NC}"
