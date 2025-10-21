#!/bin/bash

# Push ConvoCore MCP Server to Docker Hub
# Usage: ./push-to-dockerhub.sh

set -e

echo "🐳 Pushing ConvoCore MCP Server to Docker Hub..."
echo ""

# Check if user is logged in
if ! docker info >/dev/null 2>&1; then
    echo "❌ Docker is not running. Please start Docker Desktop."
    exit 1
fi

# Check if images exist
if ! docker images | grep -q "moe003/convocore-mcp"; then
    echo "❌ Images not found. Please build first:"
    echo "   docker build -t moe003/convocore-mcp:latest -t moe003/convocore-mcp:1.0.0 ."
    exit 1
fi

echo "📦 Found images:"
docker images | grep convocore-mcp
echo ""

# Prompt for login if needed
echo "🔐 Checking Docker Hub authentication..."
if ! docker info 2>&1 | grep -q "Username"; then
    echo "⚠️  Not logged in to Docker Hub."
    echo "   Please log in now (use your Docker Hub password or access token):"
    docker login
    echo ""
fi

# Push latest tag
echo "⬆️  Pushing moe003/convocore-mcp:latest..."
docker push moe003/convocore-mcp:latest

# Push version tag  
echo "⬆️  Pushing moe003/convocore-mcp:1.0.0..."
docker push moe003/convocore-mcp:1.0.0

echo ""
echo "✅ Successfully pushed to Docker Hub!"
echo ""
echo "📍 Image available at:"
echo "   https://hub.docker.com/r/moe003/convocore-mcp"
echo ""
echo "🚀 Anyone can now pull your image:"
echo "   docker pull moe003/convocore-mcp:latest"
echo ""

