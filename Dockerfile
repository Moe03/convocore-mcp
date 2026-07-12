# ConvoCore MCP — remote Streamable HTTP (default for Docker / mcp.convocore.ai)
# Listens on port 3009. Users pass WORKSPACE_SECRET as:
#   Authorization: Bearer <WORKSPACE_SECRET>
# Do NOT set WORKSPACE_SECRET in the container — multi-tenant per request.
#
# Build: docker build -t convocore-mcp-hosted .
# Run:   docker run -p 3009:3009 convocore-mcp-hosted
# Health: curl http://127.0.0.1:3009/health

FROM node:20-alpine AS builder

RUN corepack enable && corepack prepare pnpm@9.15.4 --activate

WORKDIR /app

COPY package.json pnpm-lock.yaml ./
COPY src ./src
COPY tsconfig.json ./

RUN pnpm install --frozen-lockfile --ignore-scripts
RUN pnpm exec tsc

FROM node:20-alpine

RUN apk add --no-cache wget \
  && corepack enable \
  && corepack prepare pnpm@9.15.4 --activate

WORKDIR /app

COPY package.json pnpm-lock.yaml ./

RUN pnpm install --frozen-lockfile --prod --ignore-scripts

COPY --from=builder /app/dist ./dist

ENV NODE_ENV=production
ENV HOST=0.0.0.0
ENV PORT=3009
ENV MCP_HTTP_PATH=/mcp
ENV MCP_TRANSPORT=http
ENV CONVOCORE_API_REGION=eu-gcp
ENV CONVOCORE_HOSTED_DNS_PROTECTION=false

EXPOSE 3009

HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
  CMD wget -qO- http://127.0.0.1:3009/health || exit 1

# Hosted HTTP — NOT stdio. Never require WORKSPACE_SECRET at boot.
CMD ["node", "dist/hosted.js"]
