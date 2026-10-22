import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { after, before, describe, it } from 'node:test';
import { createRequestContext, runWithRequestContext } from '../dist/request-context.js';
import { usageModule } from '../dist/tools/usage.js';
import { resolveRange } from '../dist/tools/usage.js';

const calls = [];
const responses = new Map();
let server;
let store;

before(async () => {
  server = createServer((req, res) => {
    let raw = '';
    req.on('data', (c) => (raw += c));
    req.on('end', () => {
      if (req.url.startsWith('/v3/rpc/')) {
        const procedure = decodeURIComponent(req.url.replace('/v3/rpc/', ''));
        calls.push({ procedure, input: JSON.parse(raw || '{}').input });
        const data = responses.get(procedure);
        if (data instanceof Error) {
          res.writeHead(500, { 'content-type': 'application/json' });
          return res.end(JSON.stringify({ message: data.message, code: 'INTERNAL_SERVER_ERROR' }));
        }
        res.writeHead(200, { 'content-type': 'application/json' });
        return res.end(JSON.stringify({ success: true, procedure, data: data ?? { ok: true } }));
      }
      // GET /v3/agents/{id}
      const id = req.url.split('/').pop();
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ success: true, data: { ID: id, title: `Agent ${id}` } }));
    });
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  store = createRequestContext({ workspaceSecret: 's', apiRegion: 'eu-gcp', baseUrl: `http://127.0.0.1:${server.address().port}/v3` });
});
after(() => new Promise((r) => server.close(r)));

async function call(args) {
  calls.length = 0;
  const result = await runWithRequestContext(store, () => usageModule.handlers.usage_read(args));
  return JSON.parse(result.content[0].text);
}

describe('usage_read', () => {
  it('turns days / from / to into unix seconds and rejects bad ranges', () => {
    const r = resolveRange({ days: 7 }, 1_000_000);
    assert.equal(r.end - r.start, 7 * 86_400);
    const d = resolveRange({ from: '2026-10-01', to: '2026-10-02' });
    assert.equal(d.start, Date.UTC(2026, 9, 1) / 1000);
    assert.equal(d.end, Date.UTC(2026, 9, 2, 23, 59, 59) / 1000);
    assert.throws(() => resolveRange({ from: '2026-10-05', to: '2026-10-01' }), /before/);
    assert.throws(() => resolveRange({ from: 'last tuesday' }), /ISO date/);
    assert.throws(() => resolveRange({ from: '2020-01-01', to: '2026-01-01' }), /maximum/);
  });

  it('overview runs its reads in parallel, ranks agents with names, and survives a failed part', async () => {
    responses.set('getWorkspaceCredits', { loadTokens: 1234 });
    responses.set('getV2QuotaSummary', new Error('quota unavailable'));
    responses.set('getUsage', {
      keyMetrics: {
        creditsCharged: 100,
        creditsConsumed: 90,
        llms: [{ modelId: 'm', inputTokens: 1, outputTokens: 2 }],
        agentsUsage: [
          { agentId: 'small', creditsConsumed: 10, llmsUsage: [] },
          { agentId: 'big', creditsConsumed: 80, llmsUsage: [] },
        ],
      },
    });
    responses.set('typedAgents.getWorkspaceAgentsAnalytics', { totals: { totalConversations: 5 } });
    const out = await call({ action: 'overview', days: 30 });
    assert.deepEqual(calls.map((c) => c.procedure).sort(), ['getUsage', 'getV2QuotaSummary', 'getWorkspaceCredits', 'typedAgents.getWorkspaceAgentsAnalytics']);
    assert.equal(out.credits.loadTokens, 1234);
    assert.equal(out.plan, null);
    assert.match(out.partialErrors.quota, /quota unavailable/);
    assert.equal(out.usage.topAgents[0].agentId, 'big');
    assert.equal(out.usage.topAgents[0].title, 'Agent big');
    assert.equal(out.usage.topAgents[0].share, 88.9);
    assert.equal(out.activity.totalConversations, 5);
    const usageCall = calls.find((c) => c.procedure === 'getUsage');
    assert.ok(usageCall.input.range.start < usageCall.input.range.end);
    responses.delete('getV2QuotaSummary');
  });

  it('agent actions need agentId and send the right procedure and range', async () => {
    const missing = await call({ action: 'agent_usage' });
    assert.equal(missing.success, false);
    assert.match(missing.message, /agentId is required/);
    responses.set('getAgentUsage', { creditsConsumed: 3 });
    await call({ action: 'agent_usage', agentId: 'a1', days: 7 });
    assert.equal(calls[0].procedure, 'getAgentUsage');
    assert.equal(calls[0].input.agent_id, 'a1');
    await call({ action: 'agent_analytics', agentId: 'a1' });
    assert.equal(calls[0].procedure, 'typedAgents.getAnalyticsByTimeRange');
    assert.equal(calls[0].input.agentId, 'a1');
    await call({ action: 'clients_analytics', clientIds: ['c1'] });
    assert.equal(calls[0].procedure, 'orgsRouter.getAgencyClientsAnalytics');
    assert.deepEqual(calls[0].input.clientIds, ['c1']);
  });

  it('workspace_usage leaves the log and charts out unless asked', async () => {
    responses.set('getUsage', { keyMetrics: { agentsUsage: [] }, logs: [{ amount: 1 }], charts: [{ key: 'credits-usage-global', type: 'line', data: [1] }] });
    const slim = await call({ action: 'workspace_usage' });
    assert.equal(slim.logs, undefined);
    assert.deepEqual(slim.chartsAvailable, ['credits-usage-global']);
    const full = await call({ action: 'workspace_usage', includeLogs: true, includeCharts: true });
    assert.equal(full.logs.length, 1);
    assert.equal(full.charts.length, 1);
  });

  it('only calls procedures the API gateway allows', async () => {
    let allowed = null;
    try {
      const source = readFileSync(new URL('../../custom-vf-nextjs/vg-docker/src/+v3/trpc-routers/dashboard-rpc-router.ts', import.meta.url), 'utf8');
      const block = source.slice(source.indexOf('export const RPC_ALLOWLIST'), source.indexOf('/** Credential fields'));
      allowed = new Set([...block.matchAll(/^\s+"?([A-Za-z0-9_.]+)"?: (?:plain|\{)/gm)].map((m) => m[1]));
    } catch {
      return; // backend repo not checked out next to this one
    }
    responses.set('getUsage', { keyMetrics: { agentsUsage: [] } });
    for (const args of [
      { action: 'overview' }, { action: 'top_agents' }, { action: 'credits' }, { action: 'quota' }, { action: 'workspace_usage' },
      { action: 'agent_usage', agentId: 'a' }, { action: 'agent_analytics', agentId: 'a' }, { action: 'agents_analytics' },
      { action: 'clients_analytics' }, { action: 'email_analytics', agentId: 'a' },
    ]) {
      await call(args);
      for (const c of calls) assert.ok(allowed.has(c.procedure), `${args.action} calls ${c.procedure}, not allow-listed`);
    }
  });
});
