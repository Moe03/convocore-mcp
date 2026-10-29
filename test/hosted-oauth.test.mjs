import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { describe, it, before, after } from 'node:test';
import {
  __pkceS256ForTests,
  __resetHostedOAuthForTests,
  __setSecretValidatorForTests,
  handleHostedOAuth,
  isRedirectAllowed,
  publicBaseUrl,
} from '../dist/hosted-oauth.js';

/** Secrets the stubbed API accepts; anything else is a 401. */
const VALID_SECRETS = new Set(['vg_oauth_secret', 'vg_good_secret']);
function stubSecretCheck() {
  __setSecretValidatorForTests(async (secret) => VALID_SECRETS.has(secret));
}

function normalizePath(url) {
  const q = url.indexOf('?');
  return q === -1 ? url : url.slice(0, q);
}

describe('hosted-oauth', () => {
  /** @type {import('node:http').Server} */
  let server;
  /** @type {string} */
  let base;

  before(async () => {
    __resetHostedOAuthForTests();
    server = createServer(async (req, res) => {
      const pathname = normalizePath(req.url || '/');
      const handled = await handleHostedOAuth(req, res, pathname, '/mcp');
      if (!handled) {
        res.writeHead(404);
        res.end('no');
      }
    });
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    const addr = server.address();
    base = `http://127.0.0.1:${addr.port}`;
  });

  after(async () => {
    await new Promise((resolve) => server.close(resolve));
  });

  it('registers a client via DCR', async () => {
    const res = await fetch(`${base}/oauth/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        client_name: 'claudeai',
        redirect_uris: ['https://claude.ai/api/mcp/auth_callback'],
        token_endpoint_auth_method: 'none',
        grant_types: ['authorization_code', 'refresh_token'],
        response_types: ['code'],
      }),
    });
    assert.equal(res.status, 201);
    const body = await res.json();
    assert.ok(body.client_id);
    assert.deepEqual(body.redirect_uris, [
      'https://claude.ai/api/mcp/auth_callback',
    ]);
  });

  it('Connect page + token exchange when resource has /t/<secret>/mcp path', async () => {
    __resetHostedOAuthForTests();
    stubSecretCheck();
    const { encodePathSecret } = await import('../dist/connector-url.js');
    const reg = await fetch(`${base}/oauth/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        redirect_uris: ['https://claude.ai/api/mcp/auth_callback'],
        token_endpoint_auth_method: 'none',
      }),
    });
    const { client_id: clientId } = await reg.json();

    const verifier = 'a'.repeat(64);
    const challenge = __pkceS256ForTests(verifier);
    const encoded = encodePathSecret('vg_oauth_secret');
    // Simulate Claude stripping ?token= but keeping the path
    const resource = `${base}/t/${encoded}/mcp?region=eu-gcp`;
    const common = {
      response_type: 'code',
      client_id: clientId,
      redirect_uri: 'https://claude.ai/api/mcp/auth_callback',
      code_challenge: challenge,
      code_challenge_method: 'S256',
      state: 'xyz',
      resource,
    };

    const getRes = await fetch(
      `${base}/oauth/authorize?${new URLSearchParams(common)}`,
      { redirect: 'manual' }
    );
    assert.equal(getRes.status, 200);
    const html = await getRes.text();
    assert.match(html, /Connect/);
    assert.doesNotMatch(html, /Paste your workspace secret/);

    const postRes = await fetch(`${base}/oauth/authorize`, {
      method: 'POST',
      redirect: 'manual',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        ...common,
        workspace_secret: 'vg_oauth_secret',
      }),
    });
    assert.equal(postRes.status, 302);
    const location = postRes.headers.get('location');
    assert.ok(location);
    const code = new URL(location).searchParams.get('code');
    assert.ok(code);

    const tokenRes = await fetch(`${base}/oauth/token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'authorization_code',
        code,
        redirect_uri: 'https://claude.ai/api/mcp/auth_callback',
        client_id: clientId,
        code_verifier: verifier,
      }),
    });
    assert.equal(tokenRes.status, 200);
    const tokens = await tokenRes.json();
    assert.equal(tokens.access_token, 'vg_oauth_secret');
    assert.ok(tokens.expires_in >= 365 * 24 * 60 * 60);
    assert.ok(tokens.refresh_token);
  });

  const CLAUDE_CB = 'https://claude.ai/api/mcp/auth_callback';
  function authParams(clientId, extra = {}) {
    return {
      response_type: 'code',
      client_id: clientId,
      redirect_uri: CLAUDE_CB,
      code_challenge: __pkceS256ForTests('b'.repeat(64)),
      code_challenge_method: 'S256',
      state: 'st1',
      resource: `${base}/mcp`,
      ...extra,
    };
  }

  it('rejects an unknown client sending the code to an arbitrary site', async () => {
    __resetHostedOAuthForTests();
    stubSecretCheck();
    const res = await fetch(`${base}/oauth/authorize`, {
      method: 'POST',
      redirect: 'manual',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams(
        authParams('made-up-client', { redirect_uri: 'https://evil.example/cb', workspace_secret: 'vg_good_secret' })
      ),
    });
    assert.equal(res.status, 400);
    assert.equal((await res.json()).error, 'invalid_redirect_uri');
  });

  it('rejects a registered client using a callback it did not register', async () => {
    __resetHostedOAuthForTests();
    stubSecretCheck();
    const reg = await fetch(`${base}/oauth/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ redirect_uris: ['https://app.example/cb'] }),
    });
    const { client_id } = await reg.json();
    const res = await fetch(
      `${base}/oauth/authorize?${new URLSearchParams(authParams(client_id, { redirect_uri: 'https://evil.example/cb' }))}`,
      { redirect: 'manual' }
    );
    assert.equal(res.status, 400);
  });

  it('still lets a client we lost after a restart finish on a known AI app callback', async () => {
    __resetHostedOAuthForTests();
    stubSecretCheck();
    const res = await fetch(`${base}/oauth/authorize`, {
      method: 'POST',
      redirect: 'manual',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams(authParams('lost-after-restart', { workspace_secret: 'vg_good_secret' })),
    });
    assert.equal(res.status, 302);
    assert.ok(res.headers.get('location').startsWith(CLAUDE_CB + '?code='));
  });

  it('sends a plain-URL connection to the dashboard to sign in, carrying every OAuth param', async () => {
    __resetHostedOAuthForTests();
    stubSecretCheck();
    const reg = await fetch(`${base}/oauth/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ client_name: 'Claude', redirect_uris: [CLAUDE_CB] }),
    });
    const { client_id } = await reg.json();
    const res = await fetch(`${base}/oauth/authorize?${new URLSearchParams(authParams(client_id))}`, {
      redirect: 'manual',
    });
    assert.equal(res.status, 302);
    const loc = new URL(res.headers.get('location'));
    assert.equal(loc.origin + loc.pathname, 'https://convocore.app/mcp/authorize');
    assert.equal(loc.searchParams.get('client_id'), client_id);
    assert.equal(loc.searchParams.get('redirect_uri'), CLAUDE_CB);
    assert.equal(loc.searchParams.get('state'), 'st1');
    assert.equal(loc.searchParams.get('mcp_origin'), base.replace('http://', 'https://'));
    assert.equal(loc.searchParams.get('client_name'), 'Claude');
  });

  it('keeps the paste form reachable with manual=1', async () => {
    __resetHostedOAuthForTests();
    stubSecretCheck();
    const res = await fetch(
      `${base}/oauth/authorize?${new URLSearchParams(authParams('c1', { manual: '1' }))}`,
      { redirect: 'manual' }
    );
    assert.equal(res.status, 200);
    assert.match(await res.text(), /workspace_secret/);
  });

  it('rejects a secret the API does not accept, without echoing it back', async () => {
    __resetHostedOAuthForTests();
    stubSecretCheck();
    const res = await fetch(`${base}/oauth/authorize`, {
      method: 'POST',
      redirect: 'manual',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams(authParams('c1', { workspace_secret: 'vg_typo' })),
    });
    assert.equal(res.status, 401);
    const html = await res.text();
    assert.match(html, /not accepted/);
    assert.doesNotMatch(html, /vg_typo/);
  });

  it('issues a code for the dashboard-approved secret and keeps its region', async () => {
    __resetHostedOAuthForTests();
    stubSecretCheck();
    const verifier = 'b'.repeat(64);
    const post = await fetch(`${base}/oauth/authorize`, {
      method: 'POST',
      redirect: 'manual',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams(authParams('c1', { workspace_secret: 'vg_good_secret', region: 'na' })),
    });
    assert.equal(post.status, 302);
    const code = new URL(post.headers.get('location')).searchParams.get('code');
    const tok = await fetch(`${base}/oauth/token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'authorization_code',
        code,
        redirect_uri: CLAUDE_CB,
        code_verifier: verifier,
      }),
    });
    assert.equal(tok.status, 200);
    assert.equal((await tok.json()).access_token, 'vg_good_secret');
  });

  it('Cancel on the consent page returns access_denied to the client', async () => {
    __resetHostedOAuthForTests();
    stubSecretCheck();
    const res = await fetch(`${base}/oauth/authorize`, {
      method: 'POST',
      redirect: 'manual',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams(authParams('c1', { deny: '1' })),
    });
    assert.equal(res.status, 302);
    const loc = new URL(res.headers.get('location'));
    assert.equal(loc.searchParams.get('error'), 'access_denied');
    assert.equal(loc.searchParams.get('state'), 'st1');
  });

  async function approve(body, origin = 'https://convocore.app') {
    return fetch(`${base}/oauth/approve`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Origin: origin },
      body: JSON.stringify(body),
    });
  }

  it('approve: returns the callback with a code instead of redirecting (CSP-safe)', async () => {
    __resetHostedOAuthForTests();
    stubSecretCheck();
    const verifier = 'b'.repeat(64);
    const res = await approve({ ...authParams('c1'), workspace_secret: 'vg_good_secret', region: 'eu' });
    assert.equal(res.status, 200);
    const { redirect } = await res.json();
    const cb = new URL(redirect);
    assert.equal(cb.origin + cb.pathname, CLAUDE_CB);
    assert.equal(cb.searchParams.get('state'), 'st1');
    const tok = await fetch(`${base}/oauth/token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ grant_type: 'authorization_code', code: cb.searchParams.get('code'), redirect_uri: CLAUDE_CB, code_verifier: verifier }),
    });
    assert.equal((await tok.json()).access_token, 'vg_good_secret');
  });

  it('approve: works for Claude Code loopback callbacks', async () => {
    __resetHostedOAuthForTests();
    stubSecretCheck();
    const res = await approve({ ...authParams('c1', { redirect_uri: 'http://localhost:53111/callback' }), workspace_secret: 'vg_good_secret' });
    assert.equal(res.status, 200);
    assert.ok((await res.json()).redirect.startsWith('http://localhost:53111/callback?'));
  });

  it('approve: cancel returns access_denied', async () => {
    __resetHostedOAuthForTests();
    stubSecretCheck();
    const { redirect } = await (await approve({ ...authParams('c1'), deny: '1' })).json();
    assert.equal(new URL(redirect).searchParams.get('error'), 'access_denied');
  });

  it('approve: rejects other origins, bad secrets and foreign callbacks', async () => {
    __resetHostedOAuthForTests();
    stubSecretCheck();
    assert.equal((await approve({ ...authParams('c1'), workspace_secret: 'vg_good_secret' }, 'https://evil.example')).status, 403);
    assert.equal((await approve({ ...authParams('c1'), workspace_secret: 'vg_typo' })).status, 401);
    assert.equal(
      (await approve({ ...authParams('madeup', { redirect_uri: 'https://evil.example/cb' }), workspace_secret: 'vg_good_secret' })).status,
      400
    );
  });

  it('advertises Client ID Metadata Documents', async () => {
    const meta = await (await fetch(`${base}/.well-known/oauth-authorization-server`)).json();
    assert.equal(meta.client_id_metadata_document_supported, true);
    assert.ok(meta.token_endpoint_auth_methods_supported.includes('none'));
  });

  it('serves authorization server metadata', async () => {
    const res = await fetch(`${base}/.well-known/oauth-authorization-server`);
    assert.equal(res.status, 200);
    const meta = await res.json();
    assert.ok(meta.authorization_endpoint.includes('/oauth/authorize'));
    assert.ok(meta.registration_endpoint.includes('/oauth/register'));
    assert.deepEqual(meta.code_challenge_methods_supported, ['S256']);
  });
});

describe('public MCP hosts', () => {
  it('keeps OAuth issuer on mcp.convocore.app when that host is used', () => {
    const prev = process.env.CONVOCORE_PUBLIC_BASE_URL;
    process.env.CONVOCORE_PUBLIC_BASE_URL = 'https://mcp.convocore.ai';
    try {
      const url = publicBaseUrl({
        headers: { 'x-forwarded-host': 'mcp.convocore.app', host: '127.0.0.1' },
      });
      assert.equal(url, 'https://mcp.convocore.app');
    } finally {
      if (prev === undefined) delete process.env.CONVOCORE_PUBLIC_BASE_URL;
      else process.env.CONVOCORE_PUBLIC_BASE_URL = prev;
    }
  });
});

describe('redirect rules', () => {
  const reg = { clientId: 'x', redirectUris: ['http://127.0.0.1/callback', 'https://app.example/cb'], tokenEndpointAuthMethod: 'none' };
  it('matches loopback callbacks on any port (Claude Code)', () => {
    assert.equal(isRedirectAllowed(reg, 'http://127.0.0.1:53111/callback'), true);
    assert.equal(isRedirectAllowed(undefined, 'http://localhost:3118/callback'), true);
  });
  it('allows exactly what a client registered', () => {
    assert.equal(isRedirectAllowed(reg, 'https://app.example/cb'), true);
    assert.equal(isRedirectAllowed(reg, 'https://app.example/other'), false);
  });
  it('only allows known AI app callbacks for unknown clients', () => {
    assert.equal(isRedirectAllowed(undefined, 'https://claude.ai/api/mcp/auth_callback'), true);
    assert.equal(isRedirectAllowed(undefined, 'https://chatgpt.com/connector_platform_oauth_redirect'), true);
    assert.equal(isRedirectAllowed(undefined, 'https://evil.example/cb'), false);
    assert.equal(isRedirectAllowed(undefined, 'https://claude.ai.evil.example/cb'), false);
  });
});
