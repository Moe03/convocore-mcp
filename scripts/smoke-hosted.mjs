#!/usr/bin/env node
/**
 * Smoke-test the hosted Streamable HTTP MCP on port 3009 (or SMOKE_BASE_URL).
 *
 * Usage:
 *   node scripts/smoke-hosted.mjs
 *   WORKSPACE_SECRET=vg_xxx node scripts/smoke-hosted.mjs
 *   SMOKE_BASE_URL=http://127.0.0.1:3009 WORKSPACE_SECRET=vg_xxx node scripts/smoke-hosted.mjs
 */

const base = (process.env.SMOKE_BASE_URL || 'http://127.0.0.1:3009').replace(/\/$/, '');
const mcpUrl = `${base}/mcp`;
const secret = process.env.WORKSPACE_SECRET || '';

function fail(msg) {
  console.error(`FAIL: ${msg}`);
  process.exit(1);
}

async function main() {
  const health = await fetch(`${base}/health`);
  if (!health.ok) fail(`/health returned ${health.status}`);
  const healthJson = await health.json();
  if (!healthJson.ok) fail(`/health body not ok: ${JSON.stringify(healthJson)}`);
  console.log('OK health', healthJson);

  if (!secret) {
    console.log('SKIP initialize (set WORKSPACE_SECRET to test MCP auth + tools/list)');
    process.exit(0);
  }

  const initRes = await fetch(mcpUrl, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json, text/event-stream',
      Authorization: `Bearer ${secret}`,
    },
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: 1,
      method: 'initialize',
      params: {
        protocolVersion: '2024-11-05',
        capabilities: {},
        clientInfo: { name: 'smoke-hosted', version: '1.0.0' },
      },
    }),
  });

  if (!initRes.ok) {
    fail(`initialize HTTP ${initRes.status}: ${await initRes.text()}`);
  }

  const sessionId = initRes.headers.get('mcp-session-id');
  if (!sessionId) fail('missing Mcp-Session-Id on initialize response');

  const initBody = await initRes.text();
  console.log('OK initialize session', sessionId.slice(0, 8) + '…', 'bytes', initBody.length);

  const listRes = await fetch(mcpUrl, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json, text/event-stream',
      Authorization: `Bearer ${secret}`,
      'Mcp-Session-Id': sessionId,
    },
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: 2,
      method: 'tools/list',
      params: {},
    }),
  });

  if (!listRes.ok) {
    fail(`tools/list HTTP ${listRes.status}: ${await listRes.text()}`);
  }

  const listText = await listRes.text();
  if (!listText.includes('get_website_embed_code') && !listText.includes('"tools"')) {
    fail(`tools/list unexpected body: ${listText.slice(0, 300)}`);
  }
  console.log('OK tools/list bytes', listText.length);

  await fetch(mcpUrl, {
    method: 'DELETE',
    headers: {
      Authorization: `Bearer ${secret}`,
      'Mcp-Session-Id': sessionId,
    },
  });
  console.log('OK session deleted');
  console.log('SMOKE PASSED');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
