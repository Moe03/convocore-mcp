#!/usr/bin/env node

/**
 * ConvoCore MCP — hosted Streamable HTTP transport
 *
 * Deploy behind HTTPS (e.g. https://mcp.convocore.ai/mcp). Clients authenticate with:
 *   Authorization: Bearer <WORKSPACE_SECRET>
 *   or (Claude connectors) ?token=<WORKSPACE_SECRET> on the MCP URL
 *   or x-api-key / x-auth-token headers
 *
 * Optional per-request region override:
 *   X-ConvoCore-Region: eu-gcp | na-gcp
 *   or ?region=eu-gcp|na-gcp
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
import { isMcpPathname } from './connector-url.js';
import { resolveHostedWorkspaceSecret } from './hosted-auth.js';
import { handleHostedOAuth, wwwAuthenticateChallenge } from './hosted-oauth.js';
import { buildInstallLinks, normalizeRegion } from './install-links.js';

const PORT = Number(process.env.PORT || 3009);
const HOST = process.env.HOST || '0.0.0.0';
const MCP_PATH = process.env.MCP_HTTP_PATH || '/mcp';
/** Default ~1 year. Set CONVOCORE_HOSTED_SESSION_IDLE_MS=0 to disable idle eviction. */
const ONE_YEAR_MS = 365 * 24 * 60 * 60 * 1000;
const SESSION_IDLE_MS = (() => {
  const raw = process.env.CONVOCORE_HOSTED_SESSION_IDLE_MS;
  if (raw === undefined || raw === '') return ONE_YEAR_MS;
  const n = Number(raw);
  return Number.isFinite(n) && n >= 0 ? n : ONE_YEAR_MS;
})();
const STARTED_AT = Date.now();
const PACKAGE_VERSION = '2.4.2';
const INSTALL_LINKS_PATH = '/v1/install-links';

function resolveRequestSecret(req: IncomingMessage): string | null {
  return resolveHostedWorkspaceSecret(req.headers.authorization, {
    requestUrl: req.url,
    hostHeader: typeof req.headers.host === 'string' ? req.headers.host : undefined,
    apiKeyHeader: req.headers['x-api-key'],
    authTokenHeader: req.headers['x-auth-token'],
  });
}

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

function parseRegionValue(raw: string | undefined): 'eu-gcp' | 'na-gcp' | undefined {
  if (!raw) return undefined;
  const value = raw.trim().toLowerCase();
  if (value === 'eu-gcp' || value === 'eu') return 'eu-gcp';
  if (value === 'na-gcp' || value === 'na') return 'na-gcp';
  return undefined;
}

/** Prefer X-ConvoCore-Region; fall back to ?region= on the request URL (Claude connectors). */
function parseApiRegion(req: IncomingMessage): 'eu-gcp' | 'na-gcp' | undefined {
  const headerRaw = req.headers['x-convocore-region'];
  const fromHeader = parseRegionValue(
    Array.isArray(headerRaw) ? headerRaw[0] : headerRaw
  );
  if (fromHeader) return fromHeader;

  try {
    const host = req.headers.host || 'localhost';
    const url = new URL(req.url || '/', `http://${host}`);
    return parseRegionValue(url.searchParams.get('region') ?? undefined);
  } catch {
    return undefined;
  }
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
      'X-Api-Key',
      'X-Auth-Token',
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

function sendUnauthorized(
  req: IncomingMessage,
  res: ServerResponse,
  message: string
): void {
  res.setHeader('WWW-Authenticate', wwwAuthenticateChallenge(req));
  sendJson(res, 401, {
    jsonrpc: '2.0',
    error: { code: -32001, message },
    id: null,
  });
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
  const secret = resolveRequestSecret(req);

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

    if (!secret || !secretsEqual(secret, existing.workspaceSecret)) {
      sendUnauthorized(
        req,
        res,
        'Authorization required: Bearer <WORKSPACE_SECRET> or ?token=<WORKSPACE_SECRET>'
      );
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
          'Missing Mcp-Session-Id header. Send an initialize request with Authorization (or ?token=) first.',
      },
      id: null,
    });
    return null;
  }

  if (!secret) {
    // Claude custom connectors require OAuth DCR. WWW-Authenticate points at our AS.
    // Install links include ?token= so /oauth/authorize can auto-approve.
    sendUnauthorized(
      req,
      res,
      'Authorization required: Bearer <WORKSPACE_SECRET> or ?token=<WORKSPACE_SECRET> on the MCP URL'
    );
    return null;
  }

  return createSession(secret, parseApiRegion(req));
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

if (SESSION_IDLE_MS > 0) {
  setInterval(() => {
    const now = Date.now();
    for (const [sessionId, record] of sessions.entries()) {
      if (now - record.lastSeenAt > SESSION_IDLE_MS) {
        void destroySession(sessionId);
      }
    }
  }, Math.min(60_000, Math.max(5_000, Math.floor(SESSION_IDLE_MS / 6)))).unref();
}

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
      installLinksPath: INSTALL_LINKS_PATH,
      oauth: true,
      sessionIdleMs: SESSION_IDLE_MS,
      port: PORT,
      sessions: sessions.size,
      uptimeSec: Math.floor((Date.now() - STARTED_AT) / 1000),
    });
    return;
  }

  if (await handleHostedOAuth(req, res, pathname, MCP_PATH)) {
    return;
  }

  if (pathname === INSTALL_LINKS_PATH) {
    if (req.method === 'GET') {
      sendJson(res, 200, {
        ok: true,
        method: 'POST',
        path: INSTALL_LINKS_PATH,
        body: {
          mcpUrl: 'https://mcp.convocore.ai/mcp',
          workspaceSecret: '<WORKSPACE_SECRET>',
          region: 'eu-gcp | na-gcp',
          name: 'ConvoCore (optional)',
        },
        notes: [
          'Cursor deeplink embeds Authorization + X-ConvoCore-Region (true one-click).',
          'Claude connectorUrl uses /t/<base64url(secret)>/mcp?region=… (path survives OAuth resource stripping of ?token=).',
          'Authorize shows a one-click Connect page (auto-submits); no secret paste when path token is present.',
          'OAuth access_token is the workspace secret; expires_in ~10 years + refresh_token.',
        ],
      });
      return;
    }

    if (req.method === 'POST') {
      try {
        const body = (await readJsonBody(req)) as Record<string, unknown> | undefined;
        if (!body || typeof body !== 'object') {
          sendJson(res, 400, { error: 'JSON body required' });
          return;
        }

        const mcpUrl =
          typeof body.mcpUrl === 'string'
            ? body.mcpUrl
            : typeof body.url === 'string'
              ? body.url
              : '';
        const workspaceSecret =
          typeof body.workspaceSecret === 'string'
            ? body.workspaceSecret
            : typeof body.secret === 'string'
              ? body.secret
              : '';
        const regionRaw =
          typeof body.region === 'string' ? body.region : '';
        const name = typeof body.name === 'string' ? body.name : undefined;

        const region = normalizeRegion(regionRaw);
        const links = buildInstallLinks({
          mcpUrl,
          workspaceSecret,
          region,
          name,
        });
        sendJson(res, 200, { ok: true, ...links });
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Invalid request';
        sendJson(res, 400, { error: message });
      }
      return;
    }

    res.writeHead(405, { Allow: 'GET, POST, OPTIONS' });
    res.end();
    return;
  }

  // /mcp or /t/<secret>/mcp (Claude connector path form)
  if (!isMcpPathname(pathname, MCP_PATH)) {
    sendJson(res, 404, {
      error: 'Not found',
      hint: `MCP endpoint is ${MCP_PATH} or /t/<token>/mcp; install links at ${INSTALL_LINKS_PATH}`,
    });
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
