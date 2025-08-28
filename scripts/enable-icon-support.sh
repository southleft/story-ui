#!/bin/bash

echo "🎨 Enabling Universal Icon Support for Story UI"
echo "================================================"

# Create backup of current enhancedComponentDiscovery.ts if it exists
if [ -f "story-generator/enhancedComponentDiscovery.ts" ]; then
    echo "📦 Creating backup of current enhancedComponentDiscovery.ts..."
    cp story-generator/enhancedComponentDiscovery.ts story-generator/enhancedComponentDiscovery.ts.backup
    echo "✅ Backup created: enhancedComponentDiscovery.ts.backup"
fi

# Enable the new enhanced component discovery with icon support
if [ -f "story-generator/enhancedComponentDiscovery.ts.new" ]; then
    echo "🔄 Activating new enhancedComponentDiscovery with icon support..."
    mv story-generator/enhancedComponentDiscovery.ts.new story-generator/enhancedComponentDiscovery.ts
    echo "✅ Icon support activated!"
else
    echo "⚠️  New enhancedComponentDiscovery.ts.new not found"
    echo "   Please ensure all icon support files have been created"
    exit 1
fi

# Create .story-ui directory if it doesn't exist
if [ ! -d ".story-ui" ]; then
    echo "📁 Creating .story-ui directory for icon cache..."
    mkdir -p .story-ui
    echo "✅ Created .story-ui directory"
fi

# Add .story-ui to .gitignore if not already there
if [ -f ".gitignore" ]; then
    if ! grep -q "^\.story-ui" .gitignore; then
        echo "📝 Adding .story-ui to .gitignore..."
        echo "" >> .gitignore
        echo "# Story UI cache" >> .gitignore
        echo ".story-ui/" >> .gitignore
        echo "✅ Updated .gitignore"
    fi
else
    echo "📝 Creating .gitignore with .story-ui entry..."
    echo "# Story UI cache" > .gitignore
    echo ".story-ui/" >> .gitignore
    echo "✅ Created .gitignore"
fi

echo ""
echo "🎉 Icon support has been successfully enabled!"
echo ""
echo "Next steps:"
echo "1. Install any icon libraries you want to use:"
echo "   npm install lucide-react"
echo "   npm install @heroicons/react"
echo "   npm install @workday/canvas-system-icons-web"
echo ""
echo "2. Run Story UI to auto-detect icons:"
echo "   npx story-ui"
echo ""
echo "3. Use icons in your stories with the Icon: prefix:"
echo "   'Create a button with Icon:ChevronRight'"
echo ""
echo "📚 See docs/ICON_SUPPORT_GUIDE.md for full documentation"
