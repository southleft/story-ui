#!/bin/bash

# Smart push script that handles automatic rebasing
# Usage: ./scripts/push.sh [branch-name]

set -e

BRANCH=${1:-main}

echo "🔄 Pulling latest changes with rebase..."
git pull --rebase origin $BRANCH

echo "🚀 Pushing to origin/$BRANCH..."
git push origin $BRANCH

echo "✅ Successfully pushed to $BRANCH!"
