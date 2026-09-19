#!/usr/bin/env node
/**
 * Local proof: hosted MCP forwards X-VG-Ai-Wizard onto /v3, and does not
 * invent it for a Cursor-style session.
 */
import { createServer } from 'node:http';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const MOCK_PORT = 18765;
const MCP_PORT = 3011;
const PASSPORT = 'v1.1700000000.local-test-passport';

function parseSseOrJson(text) {
  const trimmed = text.trim();
  if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
    try {
      return JSON.parse(trimmed);
    } catch {
      /* fall through */
    }
  }
  const dataLines = trimmed
    .split('\n')
    .filter((line) => line.startsWith('data:'))
    .map((line) => line.slice(5).trim())
    .filter(Boolean);
  for (const line of dataLines.reverse()) {
    try {
      return JSON.parse(line);
    } catch {
      /* next */
    }
  }
  return { raw: trimmed.slice(0, 400) };
}

async function mcpRequest(mcpUrl, { secret, passport, sessionId, body }) {
  const headers = {
    'Content-Type': 'application/json',
    Accept: 'application/json, text/event-stream',
    Authorization: `Bearer ${secret}`,
  };
  if (passport) headers['X-VG-Ai-Wizard'] = passport;
  if (sessionId) headers['Mcp-Session-Id'] = sessionId;
  const res = await fetch(mcpUrl, {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
  });
  const text = await res.text();
  return {
    ok: res.ok,
    status: res.status,
    sessionId: res.headers.get('mcp-session-id') || sessionId,
    body: parseSseOrJson(text),
    raw: text,
  };
}

async function waitForHealth(url, ms = 15_000) {
  const start = Date.now();
  while (Date.now() - start < ms) {
    try {
      const res = await fetch(url);
      if (res.ok) return;
    } catch {
      /* retry */
    }
    await new Promise((r) => setTimeout(r, 150));
  }
  throw new Error(`MCP health never came up: ${url}`);
}

function startMockApi(hits) {
  return new Promise((resolve) => {
    const server = createServer((req, res) => {
      hits.push({
        url: req.url || '',
        wizard: req.headers['x-vg-ai-wizard'] || null,
        workspaceId: req.headers['x-vg-workspace-id'] || null,
      });
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ agents: [], data: [] }));
    });
    server.listen(MOCK_PORT, '127.0.0.1', () => resolve(server));
  });
}

async function sessionCall(mcpUrl, secret, passport, label) {
  const init = await mcpRequest(mcpUrl, {
    secret,
    passport,
    body: {
      jsonrpc: '2.0',
      id: 1,
      method: 'initialize',
      params: {
        protocolVersion: '2024-11-05',
        capabilities: {},
        clientInfo: { name: 'wizard-passport-local', version: '1.0.0' },
      },
    },
  });
  if (!init.ok || !init.sessionId) {
    throw new Error(`${label} initialize failed HTTP ${init.status}: ${init.raw.slice(0, 240)}`);
  }
  await mcpRequest(mcpUrl, {
    secret,
    passport,
    sessionId: init.sessionId,
    body: { jsonrpc: '2.0', method: 'notifications/initialized' },
  });
  const call = await mcpRequest(mcpUrl, {
    secret,
    passport,
    sessionId: init.sessionId,
    body: {
      jsonrpc: '2.0',
      id: 3,
      method: 'tools/call',
      params: { name: 'list_agents', arguments: { limit: 1 } },
    },
  });
  await fetch(mcpUrl, {
    method: 'DELETE',
    headers: {
      Authorization: `Bearer ${secret}`,
      'Mcp-Session-Id': init.sessionId,
    },
  });
  if (!call.ok) {
    throw new Error(`${label} tools/call failed HTTP ${call.status}: ${call.raw.slice(0, 240)}`);
  }
  return call;
}

async function main() {
  const hits = [];
  const mock = await startMockApi(hits);
  const child = spawn(process.execPath, ['dist/hosted.js'], {
    cwd: root,
    env: {
      ...process.env,
      PORT: String(MCP_PORT),
      HOST: '127.0.0.1',
      CONVOCORE_API_BASE_URL: `http://127.0.0.1:${MOCK_PORT}/v3`,
      CONVOCORE_HOSTED_DNS_PROTECTION: 'false',
    },
    stdio: ['ignore', 'ignore', 'pipe'],
  });
  let stderr = '';
  child.stderr.on('data', (buf) => {
    stderr += buf.toString();
  });

  const mcpUrl = `http://127.0.0.1:${MCP_PORT}/mcp`;
  try {
    await waitForHealth(`http://127.0.0.1:${MCP_PORT}/health`);

    hits.length = 0;
    await sessionCall(mcpUrl, 'vg_wizard_local', PASSPORT, 'wizard');
    const wizardHits = hits.filter((h) => h.url.includes('/agents'));
    if (!wizardHits.length) {
      throw new Error(`wizard session never hit /agents. stderr=${stderr.slice(0, 400)}`);
    }
    if (wizardHits.some((h) => h.wizard !== PASSPORT)) {
      throw new Error(
        `wizard passport not forwarded: ${JSON.stringify(wizardHits)}`
      );
    }

    hits.length = 0;
    await sessionCall(mcpUrl, 'vg_cursor_local', '', 'cursor');
    const cursorHits = hits.filter((h) => h.url.includes('/agents'));
    if (!cursorHits.length) {
      throw new Error(`cursor session never hit /agents. stderr=${stderr.slice(0, 400)}`);
    }
    if (cursorHits.some((h) => h.wizard)) {
      throw new Error(`cursor session leaked a passport: ${JSON.stringify(cursorHits)}`);
    }

    console.log('PASS local MCP forwards X-VG-Ai-Wizard on wizard sessions only');
    console.log(`  wizard /agents hits=${wizardHits.length} passport=yes`);
    console.log(`  cursor /agents hits=${cursorHits.length} passport=no`);
  } finally {
    child.kill('SIGTERM');
    mock.close();
  }
}

main().catch((err) => {
  console.error('FAIL', err.message || err);
  process.exit(1);
});
