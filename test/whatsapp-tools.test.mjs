import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { after, before, describe, it } from 'node:test';
import { createRequestContext, runWithRequestContext } from '../dist/request-context.js';
import { whatsappModule } from '../dist/tools/whatsapp.js';

/** Fake Convocore API that records every request the tools send. */
const requests = [];
let server;
let store;

before(async () => {
  server = createServer((req, res) => {
    let raw = '';
    req.on('data', (chunk) => (raw += chunk));
    req.on('end', () => {
      requests.push({
        method: req.method,
        url: req.url,
        auth: req.headers.authorization,
        body: raw ? JSON.parse(raw) : null,
      });
      if (req.url.includes('missing-agent')) {
        res.writeHead(404, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ message: 'Agent not found', code: 'NOT_FOUND' }));
        return;
      }
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ success: true }));
    });
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  store = createRequestContext({
    workspaceSecret: 'test-secret',
    apiRegion: 'eu-gcp',
    baseUrl: `http://127.0.0.1:${server.address().port}/v3`,
  });
});

after(() => new Promise((resolve) => server.close(resolve)));

async function call(name, args) {
  requests.length = 0;
  const result = await runWithRequestContext(store, () => whatsappModule.handlers[name](args));
  return JSON.parse(result.content[0].text);
}

describe('whatsapp AI rules tools', () => {
  it('get_whatsapp_ai_rules reads the agent rules endpoint', async () => {
    const out = await call('get_whatsapp_ai_rules', { agentId: 'agent 1' });
    assert.equal(out.success, true);
    assert.deepEqual(requests, [
      {
        method: 'GET',
        url: '/v3/agents/agent%201/whatsapp/ai-rules',
        auth: 'Bearer test-secret',
        body: null,
      },
    ]);
  });

  it('update_whatsapp_ai_rules sends only the given fields as inboundEngagement', async () => {
    const rules = {
      matchMode: 'ai_only',
      aiRule: 'Only booking questions',
      availability: { enabled: true, startTime: '09:00', endTime: '18:00', days: ['monday'] },
    };
    await call('update_whatsapp_ai_rules', { agentId: 'a1', rules });
    assert.equal(requests.length, 1);
    assert.equal(requests[0].method, 'PATCH');
    assert.equal(requests[0].url, '/v3/agents/a1/whatsapp/ai-rules');
    assert.deepEqual(requests[0].body, { inboundEngagement: rules });
  });

  it('update_whatsapp_ai_rules rejects typos, bad values and empty patches before any request', async () => {
    for (const rules of [
      { aiRules: 'typo key' },
      { matchMode: 'sometimes' },
      { availability: { startTime: '9am' } },
      { availability: { days: ['funday'] } },
      {},
    ]) {
      const out = await call('update_whatsapp_ai_rules', { agentId: 'a1', rules });
      assert.equal(out.success, false, JSON.stringify(rules));
      assert.equal(out.data.errorType, 'input_validation_error');
      assert.equal(requests.length, 0);
    }
  });

  it('update_whatsapp_number_settings patches the number settings endpoint', async () => {
    const settings = { aiPaused: true, coexistenceSettings: { aiTakeoverMode: 'announce' } };
    await call('update_whatsapp_number_settings', { agentId: 'a1', phoneId: '123', settings });
    assert.equal(requests[0].method, 'PATCH');
    assert.equal(requests[0].url, '/v3/agents/a1/whatsapp/numbers/123/settings');
    assert.deepEqual(requests[0].body, settings);
  });

  it('update_whatsapp_number_settings refuses credentials and unknown fields', async () => {
    for (const settings of [{ longAccessToken: 'x' }, { agentId: 'other' }, {}]) {
      const out = await call('update_whatsapp_number_settings', {
        agentId: 'a1',
        phoneId: '123',
        settings,
      });
      assert.equal(out.success, false);
      assert.equal(requests.length, 0);
    }
  });

  it('surfaces API errors as a structured failure', async () => {
    const out = await call('get_whatsapp_ai_rules', { agentId: 'missing-agent' });
    assert.equal(out.success, false);
    assert.equal(out.message, 'Agent not found');
    assert.equal(out.data.status, 404);
  });

  it('every tool input schema matches its handler', () => {
    for (const tool of whatsappModule.tools) {
      assert.equal(typeof whatsappModule.handlers[tool.name], 'function');
      assert.ok(tool.inputSchema.required.includes('agentId'));
    }
  });
});
