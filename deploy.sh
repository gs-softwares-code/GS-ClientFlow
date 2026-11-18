#!/bin/bash
# ==============================================================================
# GS ClientFlow — Production Deployment Automation Script
# ==============================================================================

set -euo pipefail

echo "🚀 Starting GS-ClientFlow Production Deployment..."

# 1. Pre-flight Environment Checks
if [ ! -f ".env.production" ]; then
    echo "❌ Error: .env.production file not found!"
    echo "👉 Copy .env.production.example to .env.production and configure your credentials."
    exit 1
fi

if ! command -v docker >/dev/null 2>&1; then
    echo "❌ Error: Docker is not installed or not in PATH."
    exit 1
fi

echo "✅ Environment file and Docker engine detected."

# 2. Build and Start Containers
echo "📦 Building and starting production containers..."
docker compose build --pull
docker compose up -d --remove-orphans

# 3. Wait for Application Warmup
echo "⏳ Waiting for Next.js service to report healthy..."
for i in {1..30}; do
    if docker compose ps web | grep -q "healthy"; then
        echo "✅ Web service is healthy and accepting traffic!"
        break
    fi
    echo -n "."
    sleep 2
done

echo ""
echo "🎉 Deployment completed successfully!"
echo "🌐 Access your application via Caddy reverse proxy on your configured domain/port."
