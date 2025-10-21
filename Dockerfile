# ConvoCore MCP Server - Docker Image
# Multi-stage build for optimized image size

# Stage 1: Build
FROM node:20-alpine AS builder

# Install pnpm
RUN corepack enable && corepack prepare pnpm@latest --activate

# Set working directory
WORKDIR /app

# Copy package files
COPY package.json pnpm-lock.yaml ./

# Copy source code and config (needed before install)
COPY src ./src
COPY tsconfig.json ./

# Install dependencies (skip prepare script)
RUN pnpm install --frozen-lockfile --ignore-scripts

# Build TypeScript manually
RUN pnpm exec tsc

# Stage 2: Production
FROM node:20-alpine

# Install pnpm
RUN corepack enable && corepack prepare pnpm@latest --activate

# Set working directory
WORKDIR /app

# Copy package files
COPY package.json pnpm-lock.yaml ./

# Install production dependencies only (skip scripts to avoid prepare)
RUN pnpm install --frozen-lockfile --prod --ignore-scripts

# Copy built files from builder stage
COPY --from=builder /app/dist ./dist

# Set environment variables (can be overridden at runtime)
ENV NODE_ENV=production

# Set the entrypoint
ENTRYPOINT ["node", "dist/index.js"]

# Labels
LABEL maintainer="moe003"
LABEL description="ConvoCore MCP Server for AI Agent Management"
LABEL version="1.0.0"

