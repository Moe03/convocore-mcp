/**
 * Minimal OAuth 2.1 + DCR for Claude custom connectors.
 *
 * Claude always attempts Dynamic Client Registration against the MCP host.
 * Without /register + authorize + token, users see:
 *   "Couldn't register with Convocore's sign-in service"
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
import { extractSecretFromConnectorUrl, isOfficialMcpHost } from './connector-url.js';
import { formatMcpDisplayName } from './mcp-display-name.js';
import { buildConfig } from './config.js';
import { ConvocoreClient } from './convocore-client.js';
import {
  grayLabelDisplayName,
  isClientToken,
  isGrayLabelHost,
  parseGrayLabelSession,
  regionFromClientToken,
} from './gray-label.js';

const TEN_YEARS_SEC = 10 * 365 * 24 * 60 * 60;
const CODE_TTL_MS = 10 * 60 * 1000;
const REFRESH_TTL_MS = TEN_YEARS_SEC * 1000;

type RegisteredClient = {
  clientId: string;
  redirectUris: string[];
  tokenEndpointAuthMethod: string;
  clientName?: string;
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

/**
 * Callbacks of the AI apps we support. Used when we hold no registration for the
 * client (registrations are in memory and drop on restart) so those clients keep
 * working without letting a made-up client_id send a code anywhere.
 */
const KNOWN_APP_CALLBACK_PREFIXES = [
  'https://claude.ai/',
  'https://claude.com/',
  'https://chatgpt.com/',
  'https://chat.openai.com/',
  'cursor://',
  'vscode://',
  'vscode-insiders://',
];

function isLoopbackRedirect(uri: string): boolean {
  try {
    const u = new URL(uri);
    return (
      u.protocol === 'http:' &&
      (u.hostname === 'localhost' || u.hostname === '127.0.0.1' || u.hostname === '[::1]')
    );
  } catch {
    return false;
  }
}

/** RFC 8252 7.3: loopback redirects match on everything but the port. */
function sameLoopbackIgnoringPort(a: string, b: string): boolean {
  try {
    const x = new URL(a);
    const y = new URL(b);
    return x.protocol === y.protocol && x.hostname === y.hostname && x.pathname === y.pathname;
  } catch {
    return false;
  }
}

function isKnownAppRedirect(uri: string): boolean {
  return isLoopbackRedirect(uri) || KNOWN_APP_CALLBACK_PREFIXES.some((p) => uri.startsWith(p));
}

export function isRedirectAllowed(client: RegisteredClient | undefined, redirectUri: string): boolean {
  if (!redirectUri) return false;
  if (client) {
    if (client.redirectUris.includes(redirectUri)) return true;
    if (
      isLoopbackRedirect(redirectUri) &&
      client.redirectUris.some((r) => isLoopbackRedirect(r) && sameLoopbackIgnoringPort(r, redirectUri))
    ) {
      return true;
    }
  }
  return isKnownAppRedirect(redirectUri);
}

/** Client ID Metadata Documents (MCP 2025-11-25): client_id is an https URL to the client's metadata. */
const CIMD_TTL_MS = 60 * 60 * 1000;
const CIMD_TIMEOUT_MS = 5000;
const CIMD_MAX_BYTES = 64 * 1024;
const cimdCache = new Map<string, { client: RegisteredClient | null; expiresAt: number }>();

function isCimdClientId(clientId: string): boolean {
  try {
    const u = new URL(clientId);
    if (u.protocol !== 'https:' || u.pathname === '/' || u.hash) return false;
    const host = u.hostname.toLowerCase();
    // Never let a client_id point the server at itself or a private network.
    return !(
      host === 'localhost' ||
      /^\d{1,3}(\.\d{1,3}){3}$/.test(host) ||
      host.includes(':') ||
      host.endsWith('.internal') ||
      host.endsWith('.local')
    );
  } catch {
    return false;
  }
}

async function fetchCimdClient(clientId: string): Promise<RegisteredClient | null> {
  const cached = cimdCache.get(clientId);
  if (cached && cached.expiresAt > Date.now()) return cached.client;
  let client: RegisteredClient | null = null;
  try {
    const res = await fetch(clientId, {
      headers: { Accept: 'application/json' },
      redirect: 'error',
      signal: AbortSignal.timeout(CIMD_TIMEOUT_MS),
    });
    const text = res.ok ? await res.text() : '';
    if (text && text.length <= CIMD_MAX_BYTES) {
      const doc = JSON.parse(text) as Record<string, unknown>;
      const redirectUris = Array.isArray(doc.redirect_uris)
        ? doc.redirect_uris.filter((u): u is string => typeof u === 'string')
        : [];
      if (doc.client_id === clientId && redirectUris.length > 0) {
        client = {
          clientId,
          redirectUris,
          tokenEndpointAuthMethod: 'none',
          clientName: typeof doc.client_name === 'string' ? doc.client_name.slice(0, 80) : undefined,
        };
      }
    }
  } catch {
    client = null;
  }
  cimdCache.set(clientId, { client, expiresAt: Date.now() + CIMD_TTL_MS });
  return client;
}

async function resolveClient(clientId: string): Promise<RegisteredClient | undefined> {
  const registered = clients.get(clientId);
  if (registered) return registered;
  if (isCimdClientId(clientId)) return (await fetchCimdClient(clientId)) ?? undefined;
  return undefined;
}

/**
 * Checks a workspace secret against the API before a code is issued, so a typo fails
 * here instead of on every tool call later. Only a clear 401/403 rejects it; network
 * errors let it through (the API stays the real gate).
 */
type SecretValidator = (secret: string, region?: string) => Promise<boolean>;

const defaultSecretValidator: SecretValidator = async (secret, region) => {
  try {
    const config = buildConfig({
      workspaceSecret: secret,
      apiRegion: region === 'na-gcp' || region === 'eu-gcp' ? region : undefined,
    });
    const res = await fetch(`${config.baseUrl}/workspaces`, {
      headers: { Authorization: `Bearer ${secret}` },
      signal: AbortSignal.timeout(6000),
    });
    return res.status !== 401 && res.status !== 403;
  } catch {
    return true;
  }
};

let secretValidator: SecretValidator = defaultSecretValidator;

/**
 * Account sign-in: plain-URL connections (no secret) go to the Convocore dashboard to sign in
 * and approve, which posts a dedicated, revocable workspace secret back to /oauth/authorize.
 */
function consoleOriginFor(mcpHost: string): string {
  const bare = mcpHost.toLowerCase().split(':')[0];
  if (bare === 'mcp.convocore.ai') return 'https://convocore.ai';
  if (bare === 'mcp.convocore.app') return 'https://convocore.app';
  return (process.env.CONVOCORE_CONSOLE_URL?.trim() || 'https://convocore.app').replace(/\/$/, '');
}

function normalizeRegionParam(raw: string | null): 'eu-gcp' | 'na-gcp' | undefined {
  const v = (raw || '').trim().toLowerCase();
  if (v === 'eu' || v === 'eu-gcp') return 'eu-gcp';
  if (v === 'na' || v === 'na-gcp') return 'na-gcp';
  return undefined;
}

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

export function requestHost(req: IncomingMessage): string {
  const xfHost = req.headers['x-forwarded-host'];
  const forwarded = Array.isArray(xfHost) ? xfHost[0] : xfHost;
  return (
    forwarded?.split(',')[0]?.trim() ||
    (typeof req.headers.host === 'string' ? req.headers.host : 'localhost')
  );
}

export function publicBaseUrl(req: IncomingMessage): string {
  const host = requestHost(req);
  // Keep OAuth issuer on the hostname the client actually used (.ai / .app / agency host).
  if (isOfficialMcpHost(host) || isGrayLabelHost(host)) {
    const bare = host.toLowerCase().split(':')[0];
    return `https://${bare}`;
  }

  const env = process.env.CONVOCORE_PUBLIC_BASE_URL?.trim().replace(/\/$/, '');
  if (env) return env;

  const xfProto = req.headers['x-forwarded-proto'];
  const protoRaw = Array.isArray(xfProto) ? xfProto[0] : xfProto;
  const proto = (protoRaw?.split(',')[0]?.trim() || 'https').replace(/:$/, '');
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

function asMetadata(issuer: string, mcpPath: string, grayLabel = false) {
  if (grayLabel) {
    return {
      issuer,
      authorization_endpoint: `${issuer}/oauth/authorize`,
      token_endpoint: `${issuer}/oauth/token`,
      registration_endpoint: `${issuer}/oauth/register`,
      response_types_supported: ['code'],
      grant_types_supported: ['authorization_code', 'refresh_token'],
      code_challenge_methods_supported: ['S256'],
      token_endpoint_auth_methods_supported: ['none', 'client_secret_post'],
      scopes_supported: ['mcp'],
      client_id_metadata_document_supported: false,
      mcp_resource: `${issuer}${mcpPath}`,
    };
  }
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
    client_id_metadata_document_supported: true,
    service_documentation: 'https://github.com/Moe03/convocore-mcp',
    // Hint for humans / Claude advanced settings
    mcp_resource: `${issuer}${mcpPath}`,
  };
}

function protectedResourceDoc(issuer: string, mcpPath: string, grayLabel = false) {
  if (grayLabel) {
    return {
      resource: `${issuer}${mcpPath}`,
      authorization_servers: [issuer],
      bearer_methods_supported: ['header'],
      scopes_supported: ['mcp'],
    };
  }
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
  const scope = isClientToken(workspaceSecret) ? 'mcp' : 'mcp convocore';
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
    scope,
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

/** Page look: platform default, or the agency's logo / colour on the gray-label host. */
type PageBrand = { logoUrl?: string | null; primaryColor?: string | null; grayLabel?: boolean };

function brandStyles(brand?: PageBrand): { accent: string; accentHover: string; logo: string } {
  const color = brand?.primaryColor && /^#[0-9a-f]{3,8}$/i.test(brand.primaryColor) ? brand.primaryColor : '#2563eb';
  const logo =
    brand?.logoUrl && /^https:\/\//i.test(brand.logoUrl)
      ? `<img src="${escapeHtml(brand.logoUrl)}" alt="" style="width:56px;height:56px;border-radius:50%;object-fit:cover;margin:0 auto 14px;display:block"/>`
      : '';
  return { accent: color, accentHover: color, logo };
}

/** One-click Connect — secret already known from connector URL / path. */
function connectOnlyHtml(
  params: URLSearchParams,
  workspaceSecret: string,
  displayName: string,
  brand?: PageBrand
): string {
  const hidden = hiddenFieldsHtml(params, { workspace_secret: workspaceSecret });
  const title = escapeHtml(displayName);
  const look = brandStyles(brand);
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"/><meta name="viewport" content="width=device-width,initial-scale=1"/>
<title>Connect ${title}</title>
<style>
  body{font-family:ui-sans-serif,system-ui,sans-serif;background:#0b1220;color:#e5e7eb;display:flex;min-height:100vh;align-items:center;justify-content:center;margin:0}
  .card{width:min(380px,92vw);background:#111827;border:1px solid #1f2937;border-radius:16px;padding:28px;text-align:center}
  h1{font-size:1.25rem;margin:0 0 8px} p{color:#9ca3af;font-size:.95rem;line-height:1.45;margin:0 0 20px}
  button{width:100%;padding:14px;border:0;border-radius:10px;background:${look.accent};color:#fff;font-weight:600;font-size:1rem;cursor:pointer}
  button:hover{filter:brightness(.92)}
</style></head><body><div class="card">
  ${look.logo}
  <h1>Connect ${title}</h1>
  <p>${brand?.grayLabel ? 'Your account is ready. Click Connect to link your AI assistant.' : 'Your workspace is ready. Click Connect to finish linking this MCP.'}</p>
  <form id="connect" method="POST" action="/oauth/authorize">
    ${hidden}
    <button type="submit">Connect</button>
  </form>
  <script>setTimeout(function(){var f=document.getElementById('connect');if(f)f.submit();},50);</script>
</div></body></html>`;
}

/** Last-resort paste form — only if Claude omitted the connector secret entirely. */
function authorizeFormHtml(
  params: URLSearchParams,
  displayName: string,
  error?: string,
  brand?: PageBrand
): string {
  const look = brandStyles(brand);
  const err = error
    ? `<p style="color:#b91c1c;margin:0 0 12px">${escapeHtml(error)}</p>`
    : '';
  // Never echo a previously submitted secret back as a hidden field: it would be read before
  // the corrected one typed into the visible input.
  const carried = new URLSearchParams(params);
  for (const k of ['workspace_secret', 'token', 'deny']) carried.delete(k);
  const hidden = hiddenFieldsHtml(carried);
  const title = escapeHtml(displayName);
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"/><meta name="viewport" content="width=device-width,initial-scale=1"/>
<title>Connect ${title}</title>
<style>
  body{font-family:ui-sans-serif,system-ui,sans-serif;background:#0b1220;color:#e5e7eb;display:flex;min-height:100vh;align-items:center;justify-content:center;margin:0}
  .card{width:min(420px,92vw);background:#111827;border:1px solid #1f2937;border-radius:16px;padding:28px;box-shadow:0 20px 50px rgba(0,0,0,.35)}
  h1{font-size:1.25rem;margin:0 0 8px} p{color:#9ca3af;font-size:.95rem;line-height:1.45;margin:0 0 16px}
  label{display:block;font-size:.8rem;margin-bottom:6px;color:#d1d5db}
  input[type=password],input[type=text]{width:100%;box-sizing:border-box;padding:12px 14px;border-radius:10px;border:1px solid #374151;background:#0b1220;color:#fff}
  button{margin-top:16px;width:100%;padding:12px 14px;border:0;border-radius:10px;background:${look.accent};color:#fff;font-weight:600;cursor:pointer}
  button:hover{filter:brightness(.92)}
</style></head><body><div class="card">
  ${look.logo}
  <h1>Connect ${title}</h1>
  <p>${brand?.grayLabel ? 'We could not read your connection token from the link. Paste the token from your dashboard once to finish.' : 'We could not read your workspace secret from the connector URL. Paste it once to finish.'}</p>
  ${err}
  <form method="POST" action="/oauth/authorize">
    ${hidden}
    <label for="workspace_secret">${brand?.grayLabel ? 'Connection token' : 'Workspace secret'}</label>
    <input id="workspace_secret" name="workspace_secret" type="password" autocomplete="off" required placeholder="${brand?.grayLabel ? 'gl_…' : 'vg_…'}" />
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
    clientName: typeof body.client_name === 'string' ? body.client_name.slice(0, 80) : undefined,
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
  const fromResource = extractSecretFromConnectorUrl(resource);
  const grayLabel = isGrayLabelHost(requestHost(req));
  const hintedName =
    params.get('mcpName')?.trim() || params.get('name')?.trim() || fromResource.displayName;
  let brand: PageBrand | undefined = grayLabel ? { grayLabel: true } : undefined;
  let displayName = grayLabel
    ? (hintedName || 'AI Assistant').slice(0, 64)
    : formatMcpDisplayName({
        name: hintedName,
        workspaceName:
          params.get('workspaceName')?.trim() ||
          params.get('workspace_name')?.trim() ||
          fromResource.workspaceName,
      });

  if (responseType !== 'code') {
    sendJson(res, 400, { error: 'unsupported_response_type' });
    return;
  }
  if (!clientId || !redirectUri || !codeChallenge) {
    sendHtml(
      res,
      400,
      authorizeFormHtml(
        params,
        displayName,
        'Missing OAuth parameters from Claude. Close and try Add again.'
      )
    );
    return;
  }

  // A code must only ever go to a callback this client registered, or to a known AI app.
  // Unknown clients used to skip this check entirely.
  const client = await resolveClient(clientId);
  if (!isRedirectAllowed(client, redirectUri)) {
    sendJson(res, 400, { error: 'invalid_redirect_uri' });
    return;
  }

  // "Cancel" on the dashboard consent page.
  if (req.method === 'POST' && params.get('deny') === '1') {
    const url = new URL(redirectUri);
    url.searchParams.set('error', 'access_denied');
    if (state) url.searchParams.set('state', state);
    res.writeHead(302, { Location: url.toString() });
    res.end();
    return;
  }

  const secret = workspaceSecretParam || fromResource.secret;
  const region = normalizeRegionParam(params.get('region')) || fromResource.region;

  // No secret on the official host: sign in with a Convocore account instead of pasting one.
  // `manual=1` keeps the paste form reachable (self-hosters, scripts).
  if (!secret && !grayLabel && req.method === 'GET' && params.get('manual') !== '1') {
    const consent = new URL(`${consoleOriginFor(requestHost(req))}/app/mcp-authorize`);
    for (const [k, v] of params.entries()) consent.searchParams.set(k, v);
    consent.searchParams.set('mcp_origin', publicBaseUrl(req));
    if (client?.clientName) consent.searchParams.set('client_name', client.clientName);
    res.writeHead(302, { Location: consent.toString() });
    res.end();
    return;
  }

  if (!secret) {
    const missing = grayLabel ? 'Connection token is required.' : 'Workspace secret is required.';
    if (req.method === 'POST') {
      sendHtml(res, 400, authorizeFormHtml(params, displayName, missing, brand));
      return;
    }
    sendHtml(res, 200, authorizeFormHtml(params, displayName, undefined, brand));
    return;
  }

  // Agency host: client connection tokens only, branded from the connection itself.
  if (grayLabel !== isClientToken(secret)) {
    sendHtml(
      res,
      400,
      authorizeFormHtml(
        params,
        displayName,
        grayLabel
          ? 'Use the connection link from your dashboard.'
          : 'This is a client connection token; use the link it was issued with.',
        brand
      )
    );
    return;
  }
  if (grayLabel) {
    try {
      const api = new ConvocoreClient(
        buildConfig({ workspaceSecret: secret, apiRegion: regionFromClientToken(secret), clientScoped: true })
      );
      const session = parseGrayLabelSession(await api.getClientMcpSession());
      displayName = grayLabelDisplayName(session);
      brand = { grayLabel: true, logoUrl: session.brand.logoUrl, primaryColor: session.brand.primaryColor };
    } catch (error) {
      const message = error instanceof Error && error.message ? error.message : 'This connection is no longer valid.';
      sendHtml(res, 401, authorizeFormHtml(params, displayName, message, brand));
      return;
    }
  }

  // GET with secret already in resource/path: one-click Connect (auto-submits).
  // POST continues to issue the auth code.
  if (req.method === 'GET') {
    sendHtml(res, 200, connectOnlyHtml(params, secret, displayName, brand));
    return;
  }

  if (!grayLabel && !(await secretValidator(secret, region))) {
    sendHtml(
      res,
      401,
      authorizeFormHtml(
        params,
        displayName,
        'That workspace secret was not accepted. Copy it again from Account → API Secrets.',
        brand
      )
    );
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

/** Dashboards allowed to call /oauth/approve (the consent page runs there). */
function consoleOrigins(): Set<string> {
  const extra = (process.env.CONVOCORE_CONSOLE_ORIGINS || '')
    .split(',')
    .map((s) => s.trim().replace(/\/$/, ''))
    .filter(Boolean);
  return new Set([
    'https://convocore.app',
    'https://www.convocore.app',
    'https://convocore.ai',
    'https://www.convocore.ai',
    ...extra,
  ]);
}

/**
 * Consent page "Allow" / "Cancel". The page calls this with fetch and then navigates to the
 * returned callback itself: a form post that ends in a redirect to claude.ai / localhost /
 * cursor:// is blocked by the dashboard's CSP form-action, which also covers redirects.
 * Same checks as /oauth/authorize; answers JSON instead of redirecting.
 */
async function handleApprove(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const origin = typeof req.headers.origin === 'string' ? req.headers.origin : '';
  if (!origin || !consoleOrigins().has(origin) || isGrayLabelHost(requestHost(req))) {
    sendJson(res, 403, { error: 'forbidden_origin' });
    return;
  }
  // CORS headers and preflight are handled for every route by hosted.ts (applyCors).
  if (req.method !== 'POST') {
    sendJson(res, 405, { error: 'method_not_allowed' });
    return;
  }

  const params = new URLSearchParams(parseFormOrJson(await readBody(req), req.headers['content-type']));
  const clientId = params.get('client_id') || '';
  const redirectUri = params.get('redirect_uri') || '';
  const codeChallenge = params.get('code_challenge') || '';
  const state = params.get('state') || undefined;
  if ((params.get('response_type') || 'code') !== 'code' || !clientId || !redirectUri || !codeChallenge) {
    sendJson(res, 400, { error: 'invalid_request', message: 'This connection request is incomplete. Start again from your AI app.' });
    return;
  }
  if (!isRedirectAllowed(await resolveClient(clientId), redirectUri)) {
    sendJson(res, 400, { error: 'invalid_redirect_uri', message: 'This app is not allowed to receive access.' });
    return;
  }

  const callback = new URL(redirectUri);
  if (state) callback.searchParams.set('state', state);
  if (params.get('deny') === '1') {
    callback.searchParams.set('error', 'access_denied');
    sendJson(res, 200, { redirect: callback.toString() });
    return;
  }

  const secret = params.get('workspace_secret')?.trim() || '';
  const region = normalizeRegionParam(params.get('region'));
  if (!secret || isClientToken(secret)) {
    sendJson(res, 400, { error: 'invalid_request', message: 'Missing workspace access. Try Allow again.' });
    return;
  }
  if (!(await secretValidator(secret, region))) {
    sendJson(res, 401, { error: 'invalid_secret', message: 'Convocore did not accept this workspace. Try Allow again.' });
    return;
  }

  const code = issueAuthCode({
    workspaceSecret: secret,
    region,
    clientId,
    redirectUri,
    codeChallenge,
    codeChallengeMethod: params.get('code_challenge_method') || 'S256',
  });
  callback.searchParams.set('code', code);
  sendJson(res, 200, { redirect: callback.toString() });
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
  const grayLabel = isGrayLabelHost(requestHost(req));

  if (
    req.method === 'GET' &&
    (pathname === '/.well-known/oauth-authorization-server' ||
      pathname === '/.well-known/openid-configuration')
  ) {
    sendJson(res, 200, asMetadata(base, mcpPath, grayLabel));
    return true;
  }

  if (req.method === 'GET' && pathname.startsWith('/.well-known/oauth-protected-resource')) {
    const suffix = pathname.slice('/.well-known/oauth-protected-resource'.length);
    const resourcePath =
      !suffix || suffix === '/'
        ? mcpPath
        : suffix; // e.g. /mcp or /t/<seg>/mcp
    sendJson(res, 200, protectedResourceDoc(base, resourcePath, grayLabel));
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

  if (pathname === '/oauth/approve') {
    await handleApprove(req, res);
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
  const realm = isGrayLabelHost(requestHost(req)) ? 'mcp' : 'convocore-mcp';
  return `Bearer realm="${realm}", resource_metadata="${metadata}"`;
}

/** Test helper — clear in-memory OAuth state. */
export function __resetHostedOAuthForTests(): void {
  clients.clear();
  authCodes.clear();
  refreshTokens.clear();
  cimdCache.clear();
  secretValidator = defaultSecretValidator;
}

export function __setSecretValidatorForTests(fn: SecretValidator): void {
  secretValidator = fn;
}

export function __pkceS256ForTests(verifier: string): string {
  return pkceS256(verifier);
}
