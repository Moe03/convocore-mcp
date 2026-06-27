#!/usr/bin/env node

/**
 * ConvoCore MCP — hosted Streamable HTTP transport
 *
 * Deploy behind HTTPS (e.g. https://mcp.convocore.ai/mcp). Clients authenticate with:
 *   Authorization: Bearer <WORKSPACE_SECRET>
 *
 * Stdio / npx entrypoint (dist/index.js) is unchanged.
 */

import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { randomUUID } from 'node:crypto';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { isInitializeRequest } from '@modelcontextprotocol/sdk/types.js';
import type { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { createMcpServer } from './index.js';
import { buildConfig } from './config.js';
import {
  createRequestContext,
  runWithRequestContext,
  type RequestContextStore,
} from './request-context.js';
import { resolveHostedWorkspaceSecret } from './hosted-auth.js';

const PORT = Number(process.env.PORT || 3009);
const HOST = process.env.HOST || '0.0.0.0';
const MCP_PATH = process.env.MCP_HTTP_PATH || '/mcp';

type SessionRecord = {
  transport: StreamableHTTPServerTransport;
  server: Server;
  context: RequestContextStore;
};

const sessions = new Map<string, SessionRecord>();

function parseAllowedHosts(): string[] | undefined {
  const raw = process.env.CONVOCORE_HOSTED_ALLOWED_HOSTS?.trim();
  if (!raw) return undefined;
  return raw.split(',').map((h) => h.trim()).filter(Boolean);
}

function isInitBody(body: unknown): boolean {
  if (!body || typeof body !== 'object') return false;
  if (isInitializeRequest(body)) return true;
  if (Array.isArray(body)) {
    return body.some((item) => isInitializeRequest(item));
  }
  return false;
}

async function readJsonBody(req: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  const text = Buffer.concat(chunks).toString('utf8').trim();
  if (!text) return undefined;
  return JSON.parse(text) as unknown;
}

function sendJson(res: ServerResponse, status: number, payload: unknown): void {
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(payload));
}

async function createSession(workspaceSecret: string): Promise<SessionRecord> {
  const config = buildConfig({ workspaceSecret });
  const context = createRequestContext(config);

  let record!: SessionRecord;

  const transport = new StreamableHTTPServerTransport({
    sessionIdGenerator: () => randomUUID(),
    enableDnsRebindingProtection: process.env.CONVOCORE_HOSTED_DNS_PROTECTION === 'true',
    allowedHosts: parseAllowedHosts(),
    onsessioninitialized: (sessionId) => {
      sessions.set(sessionId, record);
    },
    onsessionclosed: (sessionId) => {
      sessions.delete(sessionId);
    },
  });

  const server = createMcpServer();
  record = { transport, server, context };
  await server.connect(transport);
  return record;
}

async function resolveSession(
  req: IncomingMessage,
  res: ServerResponse,
  parsedBody?: unknown
): Promise<SessionRecord | null> {
  const headerSessionId = req.headers['mcp-session-id'];
  const sessionId =
    typeof headerSessionId === 'string'
      ? headerSessionId
      : Array.isArray(headerSessionId)
        ? headerSessionId[0]
        : undefined;

  if (sessionId) {
    const existing = sessions.get(sessionId);
    if (!existing) {
      sendJson(res, 404, {
        jsonrpc: '2.0',
        error: { code: -32001, message: 'Unknown MCP session' },
        id: null,
      });
      return null;
    }
    return existing;
  }

  if (!isInitBody(parsedBody)) {
    sendJson(res, 400, {
      jsonrpc: '2.0',
      error: {
        code: -32000,
        message: 'Missing Mcp-Session-Id header. Send an initialize request with Authorization first.',
      },
      id: null,
    });
    return null;
  }

  const workspaceSecret = resolveHostedWorkspaceSecret(req.headers.authorization);
  if (!workspaceSecret) {
    sendJson(res, 401, {
      jsonrpc: '2.0',
      error: {
        code: -32001,
        message: 'Authorization required: Bearer <WORKSPACE_SECRET>',
      },
      id: null,
    });
    return null;
  }

  return createSession(workspaceSecret);
}

async function handleMcpRequest(
  req: IncomingMessage,
  res: ServerResponse,
  parsedBody?: unknown
): Promise<void> {
  const session = await resolveSession(req, res, parsedBody);
  if (!session) return;

  await runWithRequestContext(session.context, async () => {
    await session.transport.handleRequest(req, res, parsedBody);
  });
}

function normalizePath(url: string | undefined): string {
  if (!url) return '/';
  const q = url.indexOf('?');
  return q === -1 ? url : url.slice(0, q);
}

const httpServer = createServer(async (req, res) => {
  const pathname = normalizePath(req.url);

  if (req.method === 'GET' && pathname === '/health') {
    sendJson(res, 200, {
      ok: true,
      service: 'convocore-mcp-hosted',
      sessions: sessions.size,
    });
    return;
  }

  if (pathname !== MCP_PATH) {
    sendJson(res, 404, { error: 'Not found' });
    return;
  }

  try {
    if (req.method === 'POST') {
      const body = await readJsonBody(req);
      await handleMcpRequest(req, res, body);
      return;
    }

    if (req.method === 'GET' || req.method === 'DELETE') {
      await handleMcpRequest(req, res);
      return;
    }

    res.writeHead(405, { Allow: 'GET, POST, DELETE' });
    res.end();
  } catch (error) {
    console.error('[hosted] request error:', error);
    if (!res.headersSent) {
      sendJson(res, 500, {
        jsonrpc: '2.0',
        error: { code: -32603, message: 'Internal server error' },
        id: null,
      });
    }
  }
});

httpServer.listen(PORT, HOST, () => {
  console.error(
    `ConvoCore MCP hosted server listening on http://${HOST}:${PORT}${MCP_PATH}`
  );
});

process.on('SIGTERM', () => {
  httpServer.close(() => process.exit(0));
});
