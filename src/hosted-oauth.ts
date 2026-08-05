/**
 * Minimal OAuth 2.1 + DCR for Claude custom connectors.
 *
 * Claude always attempts Dynamic Client Registration against the MCP host.
 * Without /register + authorize + token, users see:
 *   "Couldn't register with ConvoCore's sign-in service"
 *
 * Access tokens ARE the workspace secret (Bearer), with ~10y expiry + refresh,
 * so MCP auth stays Authorization: Bearer <WORKSPACE_SECRET>.
 *
 * Claude often strips ?token= from OAuth `resource`. Secrets live in the path:
 *   /t/<base64url(secret)>/mcp
 * When present → redirect (or one-click Connect). No paste form.
 */

import { createHash, randomBytes, randomUUID } from 'node:crypto';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { extractSecretFromConnectorUrl } from './connector-url.js';

const TEN_YEARS_SEC = 10 * 365 * 24 * 60 * 60;
const CODE_TTL_MS = 10 * 60 * 1000;
const REFRESH_TTL_MS = TEN_YEARS_SEC * 1000;

type RegisteredClient = {
  clientId: string;
  redirectUris: string[];
  tokenEndpointAuthMethod: string;
};

type AuthCode = {
  workspaceSecret: string;
  region?: string;
  clientId: string;
  redirectUri: string;
  codeChallenge: string;
  codeChallengeMethod: string;
  expiresAt: number;
};

type RefreshRecord = {
  workspaceSecret: string;
  region?: string;
  clientId: string;
  expiresAt: number;
};

const clients = new Map<string, RegisteredClient>();
const authCodes = new Map<string, AuthCode>();
const refreshTokens = new Map<string, RefreshRecord>();

function base64Url(buf: Buffer): string {
  return buf
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/g, '');
}

function pkceS256(verifier: string): string {
  return base64Url(createHash('sha256').update(verifier).digest());
}

export function publicBaseUrl(req: IncomingMessage): string {
  const env = process.env.CONVOCORE_PUBLIC_BASE_URL?.trim().replace(/\/$/, '');
  if (env) return env;

  const xfProto = req.headers['x-forwarded-proto'];
  const protoRaw = Array.isArray(xfProto) ? xfProto[0] : xfProto;
  const proto = (protoRaw?.split(',')[0]?.trim() || 'https').replace(/:$/, '');
  const host =
    (typeof req.headers['x-forwarded-host'] === 'string'
      ? req.headers['x-forwarded-host'].split(',')[0]?.trim()
      : undefined) ||
    (typeof req.headers.host === 'string' ? req.headers.host : 'localhost');
  return `${proto}://${host}`;
}

function sendJson(res: ServerResponse, status: number, payload: unknown): void {
  res.setHeader('Content-Type', 'application/json');
  res.setHeader('Cache-Control', 'no-store');
  res.writeHead(status);
  res.end(JSON.stringify(payload));
}

function sendHtml(res: ServerResponse, status: number, html: string): void {
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  res.writeHead(status);
  res.end(html);
}

function asMetadata(issuer: string, mcpPath: string) {
  return {
    issuer,
    authorization_endpoint: `${issuer}/oauth/authorize`,
    token_endpoint: `${issuer}/oauth/token`,
    registration_endpoint: `${issuer}/oauth/register`,
    response_types_supported: ['code'],
    grant_types_supported: ['authorization_code', 'refresh_token'],
    code_challenge_methods_supported: ['S256'],
    token_endpoint_auth_methods_supported: ['none', 'client_secret_post'],
    scopes_supported: ['mcp', 'convocore'],
    client_id_metadata_document_supported: false,
    service_documentation: 'https://github.com/Moe03/convocore-mcp',
    // Hint for humans / Claude advanced settings
    mcp_resource: `${issuer}${mcpPath}`,
  };
}

function protectedResourceDoc(issuer: string, mcpPath: string) {
  return {
    resource: `${issuer}${mcpPath}`,
    authorization_servers: [issuer],
    bearer_methods_supported: ['header'],
    scopes_supported: ['mcp', 'convocore'],
    resource_documentation: 'https://github.com/Moe03/convocore-mcp',
  };
}

async function readBody(req: IncomingMessage): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  return Buffer.concat(chunks).toString('utf8');
}

function parseFormOrJson(text: string, contentType: string | undefined): Record<string, string> {
  const ct = (contentType || '').toLowerCase();
  if (ct.includes('application/json')) {
    const obj = JSON.parse(text || '{}') as Record<string, unknown>;
    const out: Record<string, string> = {};
    for (const [k, v] of Object.entries(obj)) {
      if (typeof v === 'string') out[k] = v;
      else if (typeof v === 'number' || typeof v === 'boolean') out[k] = String(v);
      else if (Array.isArray(v) && typeof v[0] === 'string') out[k] = v[0];
    }
    return out;
  }
  const params = new URLSearchParams(text);
  const out: Record<string, string> = {};
  for (const [k, v] of params.entries()) out[k] = v;
  return out;
}

function issueAuthCode(input: Omit<AuthCode, 'expiresAt'>): string {
  const code = base64Url(randomBytes(32));
  authCodes.set(code, { ...input, expiresAt: Date.now() + CODE_TTL_MS });
  return code;
}

function issueTokens(workspaceSecret: string, clientId: string, region?: string) {
  const refresh = base64Url(randomBytes(32));
  refreshTokens.set(refresh, {
    workspaceSecret,
    region,
    clientId,
    expiresAt: Date.now() + REFRESH_TTL_MS,
  });
  return {
    access_token: workspaceSecret,
    token_type: 'bearer',
    expires_in: TEN_YEARS_SEC,
    refresh_token: refresh,
    scope: 'mcp convocore',
  };
}

function hiddenFieldsHtml(params: URLSearchParams, extra?: Record<string, string>): string {
  const merged = new URLSearchParams(params);
  if (extra) {
    for (const [k, v] of Object.entries(extra)) merged.set(k, v);
  }
  return [...merged.entries()]
    .map(
      ([k, v]) =>
        `<input type="hidden" name="${escapeHtml(k)}" value="${escapeHtml(v)}" />`
    )
    .join('\n');
}

/** One-click Connect — secret already known from connector URL / path. */
function connectOnlyHtml(params: URLSearchParams, workspaceSecret: string): string {
  const hidden = hiddenFieldsHtml(params, { workspace_secret: workspaceSecret });
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"/><meta name="viewport" content="width=device-width,initial-scale=1"/>
<title>Connect ConvoCore</title>
<style>
  body{font-family:ui-sans-serif,system-ui,sans-serif;background:#0b1220;color:#e5e7eb;display:flex;min-height:100vh;align-items:center;justify-content:center;margin:0}
  .card{width:min(380px,92vw);background:#111827;border:1px solid #1f2937;border-radius:16px;padding:28px;text-align:center}
  h1{font-size:1.25rem;margin:0 0 8px} p{color:#9ca3af;font-size:.95rem;line-height:1.45;margin:0 0 20px}
  button{width:100%;padding:14px;border:0;border-radius:10px;background:#2563eb;color:#fff;font-weight:600;font-size:1rem;cursor:pointer}
  button:hover{background:#1d4ed8}
</style></head><body><div class="card">
  <h1>Connect ConvoCore</h1>
  <p>Your workspace is ready. Click Connect to finish linking Claude.</p>
  <form id="connect" method="POST" action="/oauth/authorize">
    ${hidden}
    <button type="submit">Connect</button>
  </form>
  <script>setTimeout(function(){var f=document.getElementById('connect');if(f)f.submit();},50);</script>
</div></body></html>`;
}

/** Last-resort paste form — only if Claude omitted the connector secret entirely. */
function authorizeFormHtml(params: URLSearchParams, error?: string): string {
  const err = error
    ? `<p style="color:#b91c1c;margin:0 0 12px">${escapeHtml(error)}</p>`
    : '';
  const hidden = hiddenFieldsHtml(params);
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"/><meta name="viewport" content="width=device-width,initial-scale=1"/>
<title>Connect ConvoCore MCP</title>
<style>
  body{font-family:ui-sans-serif,system-ui,sans-serif;background:#0b1220;color:#e5e7eb;display:flex;min-height:100vh;align-items:center;justify-content:center;margin:0}
  .card{width:min(420px,92vw);background:#111827;border:1px solid #1f2937;border-radius:16px;padding:28px;box-shadow:0 20px 50px rgba(0,0,0,.35)}
  h1{font-size:1.25rem;margin:0 0 8px} p{color:#9ca3af;font-size:.95rem;line-height:1.45;margin:0 0 16px}
  label{display:block;font-size:.8rem;margin-bottom:6px;color:#d1d5db}
  input[type=password],input[type=text]{width:100%;box-sizing:border-box;padding:12px 14px;border-radius:10px;border:1px solid #374151;background:#0b1220;color:#fff}
  button{margin-top:16px;width:100%;padding:12px 14px;border:0;border-radius:10px;background:#2563eb;color:#fff;font-weight:600;cursor:pointer}
  button:hover{background:#1d4ed8}
</style></head><body><div class="card">
  <h1>Connect ConvoCore</h1>
  <p>We could not read your workspace secret from the connector URL. Paste it once to finish.</p>
  ${err}
  <form method="POST" action="/oauth/authorize">
    ${hidden}
    <label for="workspace_secret">Workspace secret</label>
    <input id="workspace_secret" name="workspace_secret" type="password" autocomplete="off" required placeholder="vg_…" />
    <button type="submit">Connect</button>
  </form>
</div></body></html>`;
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function redirectWithCode(
  res: ServerResponse,
  redirectUri: string,
  code: string,
  state: string | undefined
): void {
  const url = new URL(redirectUri);
  url.searchParams.set('code', code);
  if (state) url.searchParams.set('state', state);
  res.writeHead(302, { Location: url.toString() });
  res.end();
}

async function handleRegister(req: IncomingMessage, res: ServerResponse): Promise<void> {
  if (req.method !== 'POST') {
    res.writeHead(405, { Allow: 'POST' });
    res.end();
    return;
  }
  let body: Record<string, unknown> = {};
  try {
    const text = await readBody(req);
    body = text ? (JSON.parse(text) as Record<string, unknown>) : {};
  } catch {
    body = {};
  }

  const redirectUris = Array.isArray(body.redirect_uris)
    ? body.redirect_uris.filter((u): u is string => typeof u === 'string')
    : typeof body.redirect_uris === 'string'
      ? [body.redirect_uris]
      : ['https://claude.ai/api/mcp/auth_callback'];

  const clientId = randomUUID();
  clients.set(clientId, {
    clientId,
    redirectUris,
    tokenEndpointAuthMethod:
      typeof body.token_endpoint_auth_method === 'string'
        ? body.token_endpoint_auth_method
        : 'none',
  });

  sendJson(res, 201, {
    client_id: clientId,
    client_id_issued_at: Math.floor(Date.now() / 1000),
    client_name: typeof body.client_name === 'string' ? body.client_name : 'claude',
    redirect_uris: redirectUris,
    grant_types: body.grant_types ?? ['authorization_code', 'refresh_token'],
    response_types: body.response_types ?? ['code'],
    token_endpoint_auth_method:
      typeof body.token_endpoint_auth_method === 'string'
        ? body.token_endpoint_auth_method
        : 'none',
  });
}

async function handleAuthorize(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const host = typeof req.headers.host === 'string' ? req.headers.host : 'localhost';
  const url = new URL(req.url || '/', `http://${host}`);

  let params = url.searchParams;
  if (req.method === 'POST') {
    const text = await readBody(req);
    const form = parseFormOrJson(text, req.headers['content-type']);
    params = new URLSearchParams(form);
  }

  const clientId = params.get('client_id') || '';
  const redirectUri = params.get('redirect_uri') || '';
  const responseType = params.get('response_type') || 'code';
  const codeChallenge = params.get('code_challenge') || '';
  const codeChallengeMethod = params.get('code_challenge_method') || 'S256';
  const state = params.get('state') || undefined;
  const resource = params.get('resource');
  const workspaceSecretParam =
    params.get('workspace_secret')?.trim() ||
    params.get('token')?.trim() ||
    '';

  if (responseType !== 'code') {
    sendJson(res, 400, { error: 'unsupported_response_type' });
    return;
  }
  if (!clientId || !redirectUri || !codeChallenge) {
    sendHtml(
      res,
      400,
      authorizeFormHtml(params, 'Missing OAuth parameters from Claude. Close and try Add again.')
    );
    return;
  }

  const client = clients.get(clientId);
  if (client && !client.redirectUris.includes(redirectUri)) {
    // Allow Claude callbacks even if registration race; still prefer registered list.
    const allowed =
      redirectUri.startsWith('https://claude.ai/') ||
      redirectUri.startsWith('http://127.0.0.1:') ||
      redirectUri.startsWith('http://localhost:');
    if (!allowed) {
      sendJson(res, 400, { error: 'invalid_redirect_uri' });
      return;
    }
  }

  const fromResource = extractSecretFromConnectorUrl(resource);
  const secret = workspaceSecretParam || fromResource.secret;
  const region = fromResource.region;

  if (!secret) {
    if (req.method === 'POST') {
      sendHtml(res, 400, authorizeFormHtml(params, 'Workspace secret is required.'));
      return;
    }
    sendHtml(res, 200, authorizeFormHtml(params));
    return;
  }

  // GET with secret already in resource/path: one-click Connect (auto-submits).
  // POST continues to issue the auth code.
  if (req.method === 'GET') {
    sendHtml(res, 200, connectOnlyHtml(params, secret));
    return;
  }

  const code = issueAuthCode({
    workspaceSecret: secret,
    region,
    clientId,
    redirectUri,
    codeChallenge,
    codeChallengeMethod,
  });
  redirectWithCode(res, redirectUri, code, state);
}

async function handleToken(req: IncomingMessage, res: ServerResponse): Promise<void> {
  if (req.method !== 'POST') {
    res.writeHead(405, { Allow: 'POST' });
    res.end();
    return;
  }

  const text = await readBody(req);
  const body = parseFormOrJson(text, req.headers['content-type']);
  const grantType = body.grant_type;

  if (grantType === 'authorization_code') {
    const code = body.code;
    const redirectUri = body.redirect_uri;
    const codeVerifier = body.code_verifier;
    const record = code ? authCodes.get(code) : undefined;
    if (!record || Date.now() > record.expiresAt) {
      sendJson(res, 400, { error: 'invalid_grant', error_description: 'code expired or unknown' });
      return;
    }
    authCodes.delete(code!);

    if (redirectUri && redirectUri !== record.redirectUri) {
      sendJson(res, 400, { error: 'invalid_grant', error_description: 'redirect_uri mismatch' });
      return;
    }

    if (record.codeChallengeMethod === 'S256') {
      if (!codeVerifier || pkceS256(codeVerifier) !== record.codeChallenge) {
        sendJson(res, 400, { error: 'invalid_grant', error_description: 'pkce failed' });
        return;
      }
    } else if (codeVerifier !== record.codeChallenge) {
      sendJson(res, 400, { error: 'invalid_grant', error_description: 'pkce failed' });
      return;
    }

    sendJson(res, 200, issueTokens(record.workspaceSecret, record.clientId, record.region));
    return;
  }

  if (grantType === 'refresh_token') {
    const refresh = body.refresh_token;
    const record = refresh ? refreshTokens.get(refresh) : undefined;
    if (!record || Date.now() > record.expiresAt) {
      sendJson(res, 400, { error: 'invalid_grant', error_description: 'refresh expired' });
      return;
    }
    // Rotate refresh token
    refreshTokens.delete(refresh!);
    sendJson(res, 200, issueTokens(record.workspaceSecret, record.clientId, record.region));
    return;
  }

  sendJson(res, 400, { error: 'unsupported_grant_type' });
}

/** Returns true if the request was handled as OAuth / discovery. */
export async function handleHostedOAuth(
  req: IncomingMessage,
  res: ServerResponse,
  pathname: string,
  mcpPath: string
): Promise<boolean> {
  const base = publicBaseUrl(req);

  if (
    req.method === 'GET' &&
    (pathname === '/.well-known/oauth-authorization-server' ||
      pathname === '/.well-known/openid-configuration')
  ) {
    sendJson(res, 200, asMetadata(base, mcpPath));
    return true;
  }

  if (req.method === 'GET' && pathname.startsWith('/.well-known/oauth-protected-resource')) {
    const suffix = pathname.slice('/.well-known/oauth-protected-resource'.length);
    const resourcePath =
      !suffix || suffix === '/'
        ? mcpPath
        : suffix; // e.g. /mcp or /t/<seg>/mcp
    sendJson(res, 200, protectedResourceDoc(base, resourcePath));
    return true;
  }

  if (pathname === '/oauth/register' || pathname === '/register') {
    await handleRegister(req, res);
    return true;
  }

  if (pathname === '/oauth/authorize') {
    await handleAuthorize(req, res);
    return true;
  }

  if (pathname === '/oauth/token') {
    await handleToken(req, res);
    return true;
  }

  return false;
}

export function wwwAuthenticateChallenge(req: IncomingMessage): string {
  const base = publicBaseUrl(req);
  const metadata = `${base}/.well-known/oauth-protected-resource`;
  return `Bearer realm="convocore-mcp", resource_metadata="${metadata}"`;
}

/** Test helper — clear in-memory OAuth state. */
export function __resetHostedOAuthForTests(): void {
  clients.clear();
  authCodes.clear();
  refreshTokens.clear();
}

export function __pkceS256ForTests(verifier: string): string {
  return pkceS256(verifier);
}
