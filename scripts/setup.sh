#!/bin/bash

# Story UI Development Setup Script

echo "🎨 Setting up Story UI development environment..."

# Install dependencies
echo "📦 Installing dependencies..."
npm install

# Build the project
echo "🔨 Building TypeScript files..."
npm run build

# Create .env file if it doesn't exist
if [ ! -f .env ]; then
    echo "📝 Creating .env file from template..."
    cp .env.sample .env
    echo "⚠️  Don't forget to add your Claude API key to .env!"
fi

echo "✅ Setup complete!"
echo ""
echo "Next steps:"
echo "1. Add your Claude API key to .env"
echo "2. Run 'npm run dev' to start development"
echo "3. Run 'npm run build' to build for production"
echo ""
echo "Happy coding! 🚀"
