import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFileSync } from 'node:fs';
import { after, before, describe, it } from 'node:test';
import { createRequestContext, runWithRequestContext } from '../dist/request-context.js';
import { dashboardChannelsModule } from '../dist/tools/dashboard-channels.js';
import { dashboardWorkspaceModule } from '../dist/tools/dashboard-workspace.js';

/** Fake gateway: records each POST /rpc/{procedure} and answers from `responses`. */
const calls = [];
const responses = new Map();
let server;
let store;
const handlers = { ...dashboardChannelsModule.handlers, ...dashboardWorkspaceModule.handlers };
const tools = [...dashboardChannelsModule.tools, ...dashboardWorkspaceModule.tools];

before(async () => {
  server = createServer((req, res) => {
    let raw = '';
    req.on('data', (chunk) => (raw += chunk));
    req.on('end', () => {
      const procedure = decodeURIComponent(req.url.replace('/v3/rpc/', ''));
      calls.push({ method: req.method, procedure, input: JSON.parse(raw || '{}').input });
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ success: true, procedure, data: responses.get(procedure) ?? { ok: true } }));
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
  calls.length = 0;
  const result = await runWithRequestContext(store, () => handlers[name](args));
  return JSON.parse(result.content[0].text);
}

async function one(name, args) {
  const out = await call(name, args);
  assert.notEqual(out.success, false, `${name} ${JSON.stringify(args)} → ${out.message}`);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].method, 'POST');
  return { ...calls[0], out };
}

describe('gateway-backed tools', () => {
  it('unwrap the gateway envelope and apply light mode', async () => {
    responses.set('getWhatsappNumbers', [{ phoneId: 'p1', about: 'x'.repeat(900) }]);
    const light = await call('whatsapp_numbers_read', { action: 'list', agentId: 'a1' });
    assert.equal(light.mode, 'compact');
    assert.ok(light.data[0].about.length < 400);
    const full = await call('whatsapp_numbers_read', { action: 'list', agentId: 'a1', mode: 'full' });
    assert.equal(full[0].about.length, 900);
  });

  it('never forward credentials-shaped arguments the tool does not declare', async () => {
    const r = await one('whatsapp_templates_read', {
      action: 'list', agentId: 'a1', phoneId: 'p1', longAccessToken: 'x', wabaId: 'y',
    });
    assert.equal(r.procedure, 'listTemplates');
    assert.deepEqual(r.input, { agentId: 'a1', phoneId: 'p1' });
  });

  it('map friendly arguments to the procedure input', async () => {
    let r = await one('whatsapp_numbers_write', { action: 'reassign', agentId: 'a1', phoneId: 'p1', newAgentId: 'a2' });
    assert.equal(r.procedure, 'reassignWhatsappNumber');
    assert.deepEqual(r.input, { currentAgentId: 'a1', newAgentId: 'a2', phoneId: 'p1' });

    r = await one('whatsapp_numbers_write', { action: 'update_display_name', agentId: 'a1', phoneId: 'p1', displayName: 'Bakery' });
    assert.deepEqual(r.input, { agentId: 'a1', phoneId: 'p1', verified_name: 'Bakery' });

    r = await one('whatsapp_templates_write', { action: 'delete', agentId: 'a1', phoneId: 'p1', name: 'promo' });
    assert.equal(r.procedure, 'deleteTemplate');
    assert.deepEqual(r.input, { agentId: 'a1', phoneId: 'p1', templateName: 'promo' });

    r = await one('whatsapp_campaigns_write', { action: 'run', agentId: 'a1', campaignId: 'c1' });
    assert.equal(r.procedure, 'waCampaignRouter.runWACampaign');
    assert.deepEqual(r.input, { agentId: 'a1', campaignId: 'c1', dryRun: false });

    r = await one('workspace_read', { action: 'log', logId: 7 });
    assert.deepEqual(r.input, { id: 7 });

    r = await one('workspace_write', { action: 'set_provider_keys', keys: { anthropic_api_key: 'k' } });
    assert.equal(r.procedure, 'setupSecrets');
    assert.deepEqual(r.input, { anthrpic_api_key: 'k' });

    r = await one('code_tools', { action: 'ai_edit', agentId: 'a1', code: 'return 1', userRequest: 'add tax' });
    assert.equal(r.procedure, 'codeTool.aiEdit');
    assert.deepEqual(r.input, { agentId: 'a1', userRequest: 'add tax', currentCode: 'return 1' });

    r = await one('tool_sharing', { action: 'copy', toolId: 't1', targetAgentId: 'a2' });
    assert.deepEqual(r.input, { sourceToolId: 't1', targetAgentId: 'a2' });

    r = await one('agent_backups_write', { action: 'create', agentId: 'a1' });
    assert.equal(r.procedure, 'saveAgentBackup');
    assert.deepEqual(r.input, { agentId: 'a1' });
  });

  it('fill the WhatsApp account id of a new campaign from the sending number', async () => {
    responses.set('getWhatsappNumbers', [{ phoneId: 'p1', wabaId: 'waba-1', phoneNumber: '+2010' }]);
    const out = await call('whatsapp_campaigns_write', {
      action: 'create',
      agentId: 'a1',
      campaign: { name: 'Promo', leadGroupName: 'vip', phoneId: 'p1', templateId: 't', templateName: 'promo', templateLanguage: 'en' },
    });
    assert.notEqual(out.success, false);
    assert.deepEqual(calls.map((c) => c.procedure), ['getWhatsappNumbers', 'waCampaignRouter.createWACampaign']);
    assert.deepEqual(calls[1].input, {
      channelType: 'whatsapp', name: 'Promo', leadGroupName: 'vip', phoneId: 'p1', templateId: 't',
      templateName: 'promo', templateLanguage: 'en', wabaId: 'waba-1', phoneNumber: '+2010', agentId: 'a1',
    });

    const bad = await call('whatsapp_campaigns_write', { action: 'create', agentId: 'a1', campaign: { name: 'x', phoneId: 'other' } });
    assert.equal(bad.success, false);
  });

  it('reject unknown actions and missing inputs before any request', async () => {
    for (const [tool, args] of [
      ['whatsapp_numbers_write', { action: 'remove', agentId: 'a1' }],
      ['whatsapp_numbers_write', { action: 'explode', agentId: 'a1', phoneId: 'p1' }],
      ['whatsapp_numbers_write', { action: 'constructor', agentId: 'a1', phoneId: 'p1' }],
      ['contacts_write', { action: 'merge', agentId: 'a1', sourceIdentityId: 's' }],
      ['email_channel_write', { action: 'create_inbox', domainId: 'd1' }],
      ['workspace_write', { action: 'set_auto_billing' }],
    ]) {
      const out = await call(tool, args);
      assert.equal(out.success, false, `${tool} ${args.action}`);
      assert.equal(calls.length, 0);
    }
  });

  it('every action runs, and only calls procedures the API gateway allows', async () => {
    const allowlistPath = '../custom-vf-nextjs/vg-docker/src/+v3/trpc-routers/dashboard-rpc-router.ts';
    let allowed = null;
    try {
      const source = readFileSync(new URL(`../${allowlistPath}`, import.meta.url), 'utf8');
      const block = source.slice(source.indexOf('export const RPC_ALLOWLIST'), source.indexOf('/** Credential fields'));
      allowed = new Set([...block.matchAll(/^\s+"?([A-Za-z0-9_.]+)"?: (?:plain|\{)/gm)].map((m) => m[1]));
    } catch {
      // Backend repo not checked out next to this one: skip the cross-repo part.
    }

    const sample = {
      agentId: 'a1', phoneId: 'p1', newAgentId: 'a2', displayName: 'n', enabled: true, name: 'n', category: 'UTILITY',
      language: 'en', templateId: 't', components: [], campaignId: 'c', campaign: { phoneId: 'p1', wabaId: 'w' },
      pageId: 'pg', userId: 'u', phoneNumber: '+1', testPhoneNumber: '+1', domain: 'd.com', domainId: 'd', inboxId: 'i',
      localPart: 'support', reply: {}, connectionId: 'cn', moduleApiName: 'Leads', agentIds: ['a1'],
      selectedEventTypes: [], config: {}, identityId: 'id', sourceIdentityId: 's', targetIdentityId: 't',
      convoIds: ['c'], consentStatus: 'granted', backupId: 'b', snapshotId: 's', code: 'return 1', userRequest: 'r',
      tool: {}, toolId: 't', targetAgentId: 'a2', targetAgentIds: ['a2'], access: 'workspace', scope: 'workspace',
      agentPrompt: 'p', logId: 1, traceId: 'tr', autoBilling: false, keys: {},
    };
    let actions = 0;
    for (const tool of tools) {
      for (const action of tool.inputSchema.properties.action.enum) {
        const out = await call(tool.name, { ...sample, action });
        assert.notEqual(out.success, false, `${tool.name} ${action} → ${out.message}`);
        const last = calls[calls.length - 1];
        if (allowed) assert.ok(allowed.has(last.procedure), `${tool.name} ${action} calls ${last.procedure}, not allow-listed`);
        actions += 1;
      }
    }
    assert.ok(actions >= 85, `expected the full action set, ran ${actions}`);
  });
});
