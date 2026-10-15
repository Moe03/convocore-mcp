import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import {
  classifyToolResult,
  flushTelemetry,
  isTelemetryEnabled,
  recordToolCall,
} from '../dist/telemetry.js';

const text = (payload) => ({ content: [{ type: 'text', text: JSON.stringify(payload, null, 2) }] });

describe('telemetry', () => {
  let server;
  let baseUrl;
  const received = [];

  before(async () => {
    server = createServer((req, res) => {
      let body = '';
      req.on('data', (c) => (body += c));
      req.on('end', () => {
        received.push({ url: req.url, headers: req.headers, body: JSON.parse(body) });
        res.end('{"success":true}');
      });
    });
    await new Promise((r) => server.listen(0, '127.0.0.1', r));
    baseUrl = `http://127.0.0.1:${server.address().port}/v3`;
  });

  after(() => server.close());

  it('classifies success, isError and { success: false } results', () => {
    assert.deepEqual(classifyToolResult(text({ agents: [] })), { success: true });
    assert.deepEqual(
      classifyToolResult(text({ success: false, message: 'x', data: { errorType: 'api_request_error' } })),
      { success: false, errorType: 'api_request_error' }
    );
    assert.deepEqual(classifyToolResult({ isError: true, content: [{ type: 'text', text: 'nope' }] }), {
      success: false,
      errorType: 'error',
    });
  });

  it('is on by default and off with CONVOCORE_TELEMETRY=0 or DO_NOT_TRACK=1', () => {
    const saved = { t: process.env.CONVOCORE_TELEMETRY, d: process.env.DO_NOT_TRACK };
    delete process.env.CONVOCORE_TELEMETRY;
    delete process.env.DO_NOT_TRACK;
    assert.equal(isTelemetryEnabled(), true);
    process.env.CONVOCORE_TELEMETRY = '0';
    assert.equal(isTelemetryEnabled(), false);
    delete process.env.CONVOCORE_TELEMETRY;
    process.env.DO_NOT_TRACK = '1';
    assert.equal(isTelemetryEnabled(), false);
    if (saved.t === undefined) delete process.env.CONVOCORE_TELEMETRY;
    else process.env.CONVOCORE_TELEMETRY = saved.t;
    if (saved.d === undefined) delete process.env.DO_NOT_TRACK;
    else process.env.DO_NOT_TRACK = saved.d;
  });

  it('batches events to the region base URL with the workspace secret, without arguments', async () => {
    delete process.env.CONVOCORE_TELEMETRY;
    delete process.env.DO_NOT_TRACK;
    const config = { workspaceSecret: 'secret-1', apiRegion: 'eu-gcp', baseUrl, workspaceId: 'ws-1' };
    const event = { success: true, durationMs: 12.4, transport: 'stdio', clientName: 'claude-ai' };
    recordToolCall(config, { ...event, tool: 'list_agents' });
    recordToolCall(config, { ...event, tool: 'get_agent' });
    await flushTelemetry();

    assert.equal(received.length, 1);
    const [req] = received;
    assert.equal(req.url, '/v3/mcp/telemetry');
    assert.equal(req.headers.authorization, 'Bearer secret-1');
    assert.equal(req.headers['x-vg-workspace-id'], 'ws-1');
    assert.deepEqual(req.body.events.map((e) => e.tool), ['list_agents', 'get_agent']);
    assert.equal(req.body.events[0].durationMs, 12);
    assert.equal('arguments' in req.body.events[0], false);
  });

  it('sends nothing when opted out', async () => {
    received.length = 0;
    process.env.CONVOCORE_TELEMETRY = '0';
    recordToolCall(
      { workspaceSecret: 's', apiRegion: 'eu-gcp', baseUrl },
      { tool: 'list_agents', success: true, durationMs: 1, transport: 'stdio' }
    );
    await flushTelemetry();
    delete process.env.CONVOCORE_TELEMETRY;
    assert.equal(received.length, 0);
  });
});
