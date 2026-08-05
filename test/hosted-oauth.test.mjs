import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { describe, it, before, after } from 'node:test';
import {
  __pkceS256ForTests,
  __resetHostedOAuthForTests,
  handleHostedOAuth,
} from '../dist/hosted-oauth.js';

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

  it('auto-approves authorize when resource has ?token= and exchanges code', async () => {
    __resetHostedOAuthForTests();
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
    const resource = encodeURIComponent(
      `${base}/mcp?token=vg_oauth_secret&region=eu-gcp`
    );
    const authorizeUrl =
      `${base}/oauth/authorize?response_type=code` +
      `&client_id=${encodeURIComponent(clientId)}` +
      `&redirect_uri=${encodeURIComponent('https://claude.ai/api/mcp/auth_callback')}` +
      `&code_challenge=${encodeURIComponent(challenge)}` +
      `&code_challenge_method=S256` +
      `&state=xyz` +
      `&resource=${resource}`;

    const authRes = await fetch(authorizeUrl, { redirect: 'manual' });
    assert.equal(authRes.status, 302);
    const location = authRes.headers.get('location');
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
    assert.equal(tokens.token_type, 'bearer');
    assert.ok(tokens.expires_in >= 365 * 24 * 60 * 60);
    assert.ok(tokens.refresh_token);
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
