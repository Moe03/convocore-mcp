#!/usr/bin/env node

/**
 * ConvoCore MCP — hosted Streamable HTTP transport
 *
 * Deploy behind HTTPS (e.g. https://mcp.convocore.ai/mcp). Clients authenticate with:
 *   Authorization: Bearer <WORKSPACE_SECRET>
 *
 * Optional per-request region override:
 *   X-ConvoCore-Region: eu-gcp | na-gcp
 *
 * Stdio / npx entrypoint (dist/index.js) is unchanged.
 */

import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { randomUUID, timingSafeEqual } from 'node:crypto';
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
const SESSION_IDLE_MS = Number(process.env.CONVOCORE_HOSTED_SESSION_IDLE_MS || 30 * 60 * 1000);
const STARTED_AT = Date.now();
const PACKAGE_VERSION = '2.3.8';

type SessionRecord = {
  transport: StreamableHTTPServerTransport;
  server: Server;
  context: RequestContextStore;
  workspaceSecret: string;
  lastSeenAt: number;
};

const sessions = new Map<string, SessionRecord>();

function parseAllowedHosts(): string[] | undefined {
  const raw = process.env.CONVOCORE_HOSTED_ALLOWED_HOSTS?.trim();
  if (!raw) return undefined;
  return raw.split(',').map((h) => h.trim()).filter(Boolean);
}

function secretsEqual(a: string, b: string): boolean {
  const aBuf = Buffer.from(a);
  const bBuf = Buffer.from(b);
  if (aBuf.length !== bBuf.length) return false;
  return timingSafeEqual(aBuf, bBuf);
}

function parseApiRegion(req: IncomingMessage): 'eu-gcp' | 'na-gcp' | undefined {
  const raw = req.headers['x-convocore-region'];
  const value = (Array.isArray(raw) ? raw[0] : raw)?.trim().toLowerCase();
  if (value === 'eu-gcp' || value === 'eu') return 'eu-gcp';
  if (value === 'na-gcp' || value === 'na') return 'na-gcp';
  return undefined;
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

function applyCors(req: IncomingMessage, res: ServerResponse): void {
  const origin = req.headers.origin;
  if (origin) {
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Vary', 'Origin');
  } else {
    res.setHeader('Access-Control-Allow-Origin', '*');
  }
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, DELETE, OPTIONS');
  res.setHeader(
    'Access-Control-Allow-Headers',
    [
      'Content-Type',
      'Accept',
      'Authorization',
      'Mcp-Session-Id',
      'MCP-Protocol-Version',
      'Last-Event-ID',
      'X-ConvoCore-Region',
    ].join(', ')
  );
  res.setHeader('Access-Control-Expose-Headers', 'Mcp-Session-Id, MCP-Protocol-Version');
  res.setHeader('Access-Control-Max-Age', '86400');
}

function sendJson(res: ServerResponse, status: number, payload: unknown): void {
  if (!res.getHeader('Content-Type')) {
    res.setHeader('Content-Type', 'application/json');
  }
  res.writeHead(status);
  res.end(JSON.stringify(payload));
}

function getHeaderSessionId(req: IncomingMessage): string | undefined {
  const headerSessionId = req.headers['mcp-session-id'];
  if (typeof headerSessionId === 'string') return headerSessionId;
  if (Array.isArray(headerSessionId)) return headerSessionId[0];
  return undefined;
}

async function destroySession(sessionId: string): Promise<void> {
  const record = sessions.get(sessionId);
  if (!record) return;
  sessions.delete(sessionId);
  try {
    await record.transport.close();
  } catch {
    // ignore
  }
  try {
    await record.server.close();
  } catch {
    // ignore
  }
}

async function createSession(
  workspaceSecret: string,
  apiRegion?: 'eu-gcp' | 'na-gcp'
): Promise<SessionRecord> {
  const config = buildConfig({ workspaceSecret, apiRegion });
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
  record = {
    transport,
    server,
    context,
    workspaceSecret,
    lastSeenAt: Date.now(),
  };
  await server.connect(transport);
  return record;
}

async function resolveSession(
  req: IncomingMessage,
  res: ServerResponse,
  parsedBody?: unknown
): Promise<SessionRecord | null> {
  const sessionId = getHeaderSessionId(req);
  const bearer = resolveHostedWorkspaceSecret(req.headers.authorization);

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

    if (!bearer || !secretsEqual(bearer, existing.workspaceSecret)) {
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

    existing.lastSeenAt = Date.now();
    return existing;
  }

  if (!isInitBody(parsedBody)) {
    sendJson(res, 400, {
      jsonrpc: '2.0',
      error: {
        code: -32000,
        message:
          'Missing Mcp-Session-Id header. Send an initialize request with Authorization first.',
      },
      id: null,
    });
    return null;
  }

  if (!bearer) {
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

  return createSession(bearer, parseApiRegion(req));
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

setInterval(() => {
  const now = Date.now();
  for (const [sessionId, record] of sessions.entries()) {
    if (now - record.lastSeenAt > SESSION_IDLE_MS) {
      void destroySession(sessionId);
    }
  }
}, Math.min(60_000, Math.max(5_000, Math.floor(SESSION_IDLE_MS / 6)))).unref();

const httpServer = createServer(async (req, res) => {
  applyCors(req, res);

  const pathname = normalizePath(req.url);

  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    res.end();
    return;
  }

  if (req.method === 'GET' && (pathname === '/health' || pathname === '/')) {
    sendJson(res, 200, {
      ok: true,
      service: 'convocore-mcp-hosted',
      version: PACKAGE_VERSION,
      path: MCP_PATH,
      port: PORT,
      sessions: sessions.size,
      uptimeSec: Math.floor((Date.now() - STARTED_AT) / 1000),
    });
    return;
  }

  if (pathname !== MCP_PATH) {
    sendJson(res, 404, { error: 'Not found', hint: `MCP endpoint is ${MCP_PATH}` });
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

    res.writeHead(405, { Allow: 'GET, POST, DELETE, OPTIONS' });
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

async function shutdown(): Promise<void> {
  for (const sessionId of [...sessions.keys()]) {
    await destroySession(sessionId);
  }
  httpServer.close(() => process.exit(0));
}

process.on('SIGTERM', () => {
  void shutdown();
});
process.on('SIGINT', () => {
  void shutdown();
});
