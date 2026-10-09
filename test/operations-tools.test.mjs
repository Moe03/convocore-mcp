import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { after, before, describe, it } from 'node:test';
import { createRequestContext, runWithRequestContext } from '../dist/request-context.js';
import { applyLightMode } from '../dist/light-mode.js';
import { buildDomainTools } from '../dist/tools/index.js';

/** Fake Convocore API: records every request and answers from `responses` (by "METHOD path"). */
const requests = [];
const responses = new Map();
let server;
let store;
const { tools, handlers } = buildDomainTools(() => []);

before(async () => {
  server = createServer((req, res) => {
    let raw = '';
    req.on('data', (chunk) => (raw += chunk));
    req.on('end', () => {
      const url = new URL(req.url, 'http://x');
      const path = url.pathname.replace(/^\/v3/, '');
      requests.push({
        method: req.method,
        path,
        query: Object.fromEntries(url.searchParams),
        body: raw ? JSON.parse(raw) : undefined,
      });
      const canned = responses.get(`${req.method} ${path}`);
      const payload = typeof canned === 'function' ? canned(url, requests.length) : canned;
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify(payload ?? { success: true }));
    });
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  store = createRequestContext({
    workspaceSecret: 'test-secret',
    apiRegion: 'eu-gcp',
    workspaceId: 'ws1',
    baseUrl: `http://127.0.0.1:${server.address().port}/v3`,
  });
});

after(() => new Promise((resolve) => server.close(resolve)));

async function call(name, args) {
  requests.length = 0;
  const result = await runWithRequestContext(store, () => handlers[name](args));
  return JSON.parse(result.content[0].text);
}

/** Run a tool and return the single request it made. */
async function one(name, args) {
  const out = await call(name, args);
  assert.notEqual(out.success, false, `${name} ${JSON.stringify(args)} → ${out.message}`);
  assert.equal(requests.length, 1, `${name} ${args.action ?? ''} should make one request`);
  return { ...requests[0], out };
}

const sent = (r) => `${r.method} ${r.path}`;

describe('light mode', () => {
  const heavy = {
    data: [
      {
        id: 'c1',
        summary: 'x'.repeat(1000),
        transcript: [{ role: 'user', text: 'hi' }, { role: 'agent', text: 'hello' }],
        nested: { tags: Array.from({ length: 50 }, (_, i) => `t${i}`) },
      },
    ],
  };

  it('compact keeps records and scalars but trims bulk', () => {
    const light = applyLightMode(undefined, heavy);
    assert.equal(light.mode, 'compact');
    assert.equal(light.data.length, 1);
    assert.equal(light.data[0].id, 'c1');
    assert.ok(light.data[0].summary.length < 400);
    assert.match(light.data[0].transcript, /2 items omitted/);
    assert.equal(light.data[0].nested.tags.length, 21);
  });

  it('full returns the response untouched, and a CSV string is never cut', () => {
    assert.deepEqual(applyLightMode('full', heavy), heavy);
    const csv = 'a,b\n'.repeat(500);
    assert.equal(applyLightMode('compact', csv), csv);
  });

  it('every new tool that returns data exposes mode', () => {
    const withoutMode = ['send_handoff_reminder', 'notification_email'];
    const names = [
      'campaigns_read', 'campaigns_write', 'call_logs_read', 'call_logs_write', 'get_agent_phone',
      'start_outbound_call', 'send_sms', 'contact_leads',
      'custom_metrics_read', 'custom_metrics_write', 'lead_groups_read', 'lead_groups_write',
      'folders_read', 'folders_write', 'get_agent_audit_log',
      'send_handoff_reminder', 'generate_conversation_summaries', 'agent_gallery_templates',
      'notification_email',
    ];
    for (const name of names) {
      const tool = tools.find((t) => t.name === name);
      assert.ok(tool, `missing tool ${name}`);
      assert.equal(typeof handlers[name], 'function');
      if (!withoutMode.includes(name)) {
        assert.deepEqual(tool.inputSchema.properties.mode.enum, ['compact', 'full'], name);
      }
    }
  });
});

describe('campaigns', () => {
  it('reads', async () => {
    let r = await one('campaigns_read', { action: 'list', agentId: 'a1', page: 2, limit: 5 });
    assert.equal(sent(r), 'GET /agents/a1/campaigns');
    assert.deepEqual(r.query, { page: '2', limit: '5' });
    r = await one('campaigns_read', { action: 'get', agentId: 'a1', campaignId: 'c1' });
    assert.equal(sent(r), 'GET /agents/a1/campaigns/c1');
  });

  it('create applies safe defaults and stays stopped', async () => {
    const r = await one('campaigns_write', {
      action: 'create', agentId: 'a1', campaign: { name: 'Promo', leadGroupName: 'vip' },
    });
    assert.equal(sent(r), 'POST /agents/a1/campaigns');
    assert.deepEqual(r.body, {
      delayBetweenEachCall: 0, concurrentSlots: 1, enabled: false, name: 'Promo', leadGroupName: 'vip',
    });
  });

  it('update merges onto the stored campaign', async () => {
    responses.set('GET /agents/a1/campaigns/c1', { id: 'c1', name: 'Promo', leadGroupName: 'vip', concurrentSlots: 1, enabled: false });
    await call('campaigns_write', { action: 'update', agentId: 'a1', campaignId: 'c1', campaign: { concurrentSlots: 3 } });
    assert.deepEqual(requests.map(sent), ['GET /agents/a1/campaigns/c1', 'PATCH /agents/a1/campaigns']);
    assert.deepEqual(requests[1].body.campaignData, {
      id: 'c1', name: 'Promo', leadGroupName: 'vip', concurrentSlots: 3, enabled: false,
    });
  });

  it('enable toggles only when the state differs', async () => {
    responses.set('GET /agents/a1/campaigns/c1', { id: 'c1', enabled: false });
    responses.set('PATCH /agents/a1/campaigns/c1', { enabled: true });
    let out = await call('campaigns_write', { action: 'enable', agentId: 'a1', campaignId: 'c1' });
    assert.deepEqual(requests.map(sent), ['GET /agents/a1/campaigns/c1', 'PATCH /agents/a1/campaigns/c1']);
    assert.equal(out.changed, true);

    out = await call('campaigns_write', { action: 'disable', agentId: 'a1', campaignId: 'c1' });
    assert.deepEqual(requests.map(sent), ['GET /agents/a1/campaigns/c1']);
    assert.equal(out.changed, false);
  });

  it('delete and restart', async () => {
    let r = await one('campaigns_write', { action: 'delete', agentId: 'a1', campaignId: 'c1' });
    assert.equal(sent(r), 'DELETE /agents/a1/campaigns');
    assert.deepEqual(r.query, { campaignId: 'c1' });
    r = await one('campaigns_write', { action: 'restart', agentId: 'a1', campaignId: 'c1', resetConversations: true });
    assert.equal(sent(r), 'PATCH /agents/a1/campaigns/c1/restart');
    assert.deepEqual(r.body, { resetConversations: true });
  });

  it('rejects missing inputs before any request', async () => {
    for (const args of [
      { action: 'get', agentId: 'a1' },
      { action: 'create', agentId: 'a1', campaign: { name: 'x' } },
      { action: 'enable', agentId: 'a1' },
    ]) {
      const tool = args.action === 'get' ? 'campaigns_read' : 'campaigns_write';
      const out = await call(tool, args);
      assert.equal(out.success, false);
      assert.equal(requests.length, 0);
    }
  });
});

describe('call logs', () => {
  it('list / get / export map filters to the API names', async () => {
    let r = await one('call_logs_read', {
      action: 'list', agentId: 'a1', type: 'outbound', customerPhone: '+1555', startFrom: '2026-10-01T00:00:00.000Z', limit: 50,
    });
    assert.equal(sent(r), 'GET /call-logs');
    assert.deepEqual(r.query, {
      agent_id: 'a1', type: 'outbound', customer_phone_number: '+1555',
      start_time_from: '2026-10-01T00:00:00.000Z', limit: '50',
    });
    r = await one('call_logs_read', { action: 'get', callLogId: 'id1' });
    assert.equal(sent(r), 'GET /call-logs/id1');
    r = await one('call_logs_read', { action: 'export', format: 'csv', callLogIds: ['x', 'y'], includeTranscripts: true });
    assert.equal(sent(r), 'GET /call-logs/export');
    assert.deepEqual(r.query, { format: 'csv', ids_csv: 'x,y', include_transcripts: 'true' });
  });

  it('create / update / delete', async () => {
    let r = await one('call_logs_write', { action: 'create', callLog: { agent_id: 'a1', type: 'web' } });
    assert.equal(sent(r), 'POST /call-logs');
    assert.deepEqual(r.body, { call_log: { agent_id: 'a1', type: 'web' } });
    r = await one('call_logs_write', { action: 'update', callLogId: 'id1', callLog: { summary: 's' } });
    assert.equal(sent(r), 'PATCH /call-logs/id1');
    assert.deepEqual(r.body, { patch: { summary: 's' } });
    r = await one('call_logs_write', { action: 'delete', callLogId: 'id1' });
    assert.equal(sent(r), 'DELETE /call-logs/id1');
  });
});

describe('outbound calls and SMS', () => {
  it('call, sms, phone', async () => {
    let r = await one('start_outbound_call', { agentId: 'a1', to: '+15551234567', leadInfo: { username: 'Sam' } });
    assert.equal(sent(r), 'POST /calls');
    assert.deepEqual(r.body, { agentId: 'a1', to: '+15551234567', leadInfo: { username: 'Sam' } });
    r = await one('send_sms', { agentId: 'a1', to: '+15551234567', message: 'Hi' });
    assert.equal(sent(r), 'POST /sms');
    assert.deepEqual(r.body, { agentId: 'a1', to: '+15551234567', message: 'Hi', mode: 'direct' });
    r = await one('get_agent_phone', { agentId: 'a1' });
    assert.equal(sent(r), 'GET /agents/a1/phone');
  });

  it('contact_leads by call and by sms', async () => {
    const leads = [{ userPhone: '+15551234567' }];
    let r = await one('contact_leads', { channel: 'call', agentId: 'a1', leads });
    assert.equal(sent(r), 'POST /callLeads');
    assert.deepEqual(r.body, {
      agentId: 'a1', leads, leadsPerCampaign: 1, contactMethodsPriorty: ['userPhone', 'phone', 'userID'],
    });
    r = await one('contact_leads', { channel: 'sms', agentId: 'a1', leads, message: 'Hi' });
    assert.equal(sent(r), 'POST /smsLeads');
    assert.equal(r.body.message, 'Hi');
    assert.equal(r.body.mode, 'direct');
  });

  it('refuses bad numbers and an empty direct SMS', async () => {
    for (const [tool, args] of [
      ['start_outbound_call', { agentId: 'a1', to: '5551234567' }],
      ['send_sms', { agentId: 'a1', to: '+15551234567' }],
      ['contact_leads', { channel: 'sms', agentId: 'a1', leads: [{ userPhone: '+1555' }] }],
    ]) {
      const out = await call(tool, args);
      assert.equal(out.success, false, tool);
      assert.equal(requests.length, 0, tool);
    }
  });
});

describe('custom metrics', () => {
  it('reads, defaulting the range to the last 30 days', async () => {
    assert.equal(sent(await one('custom_metrics_read', { action: 'list', agentId: 'a1' })), 'GET /agents/a1/custom-metrics');
    assert.equal(sent(await one('custom_metrics_read', { action: 'get', agentId: 'a1', metricId: 'm1' })), 'GET /agents/a1/custom-metrics/m1');
    let r = await one('custom_metrics_read', { action: 'data', agentId: 'a1', metricKey: 'csat' });
    assert.equal(sent(r), 'GET /agents/a1/custom-metrics/csat/data');
    assert.equal(Number(r.query.endTs) - Number(r.query.startTs), 30 * 86400);
    r = await one('custom_metrics_read', { action: 'all_data', agentId: 'a1', startTs: 1, endTs: 2 });
    assert.equal(sent(r), 'GET /v3/agents/a1/custom-metrics/data');
    assert.deepEqual(r.query, { startTs: '1', endTs: '2', includeTimeSeries: 'false' });
  });

  it('writes', async () => {
    const metric = { key: 'csat', type: 'enum', options: ['good', 'bad'], description: 'Was the customer happy?' };
    let r = await one('custom_metrics_write', { action: 'create', agentId: 'a1', metric });
    assert.equal(sent(r), 'POST /agents/a1/custom-metrics');
    assert.deepEqual(r.body, { metric });
    r = await one('custom_metrics_write', { action: 'update', agentId: 'a1', metricId: 'm1', metric: { description: 'New' } });
    assert.equal(sent(r), 'PUT /agents/a1/custom-metrics/m1');
    assert.equal(sent(await one('custom_metrics_write', { action: 'delete', agentId: 'a1', metricId: 'm1' })), 'DELETE /agents/a1/custom-metrics/m1');
    const out = await call('custom_metrics_write', { action: 'create', agentId: 'a1', metric: { key: 'k', type: 'enum' } });
    assert.equal(out.success, false);
    assert.equal(requests.length, 0);
  });
});

describe('lead groups', () => {
  it('list, create, assign', async () => {
    responses.set('GET /agents/a1/groups', [{ name: 'vip', leadCount: 2 }]);
    let r = await one('lead_groups_read', { agentId: 'a1', tags: ['x', 'y'] });
    assert.equal(sent(r), 'GET /agents/a1/groups');
    assert.deepEqual(r.query, { tags: 'x,y' });
    assert.deepEqual(r.out.groups, [{ name: 'vip', leadCount: 2 }]);
    r = await one('lead_groups_write', { action: 'create', agentId: 'a1', groupName: 'VIP', leads: [{ userPhone: '+1' }] });
    assert.equal(sent(r), 'POST /agents/a1/groups');
    assert.deepEqual(r.body, { groupName: 'vip', leads: [{ userPhone: '+1' }] });
    r = await one('lead_groups_write', { action: 'assign_leads', agentId: 'a1', groupName: 'vip', leadIds: ['l1', 'l2'] });
    assert.equal(sent(r), 'PUT /agents/a1/groups/vip');
    assert.deepEqual(r.body, { leadIds: 'l1,l2' });
  });

  it('rename moves every lead, page by page', async () => {
    const pages = [Array.from({ length: 100 }, (_, i) => ({ id: `a${i}` })), [{ id: 'z1' }, { id: 'z2' }]];
    let reads = 0;
    responses.set('GET /agents/a1/leads', () => ({ leads: pages[reads++] ?? [] }));
    const out = await call('lead_groups_write', { action: 'rename', agentId: 'a1', groupName: 'Old', newGroupName: 'New' });
    assert.deepEqual(out, { success: true, from: 'old', to: 'new', leadsMoved: 102 });
    assert.deepEqual(requests.map(sent), [
      'GET /agents/a1/leads', 'PUT /agents/a1/groups/new', 'GET /agents/a1/leads', 'PUT /agents/a1/groups/new',
    ]);
    assert.equal(requests[0].query.groupName, 'old');
    assert.equal(requests[3].body.leadIds, 'z1,z2');
  });

  it('delete keeps the leads unless deleteLeads is set', async () => {
    let reads = 0;
    responses.set('GET /agents/a1/leads', () => ({ leads: reads++ === 0 ? [{ id: 'l1' }] : [] }));
    let out = await call('lead_groups_write', { action: 'delete', agentId: 'a1', groupName: 'vip' });
    assert.deepEqual(requests.map(sent), ['GET /agents/a1/leads', 'PUT /agents/a1/groups/all']);
    assert.equal(out.leadsUngrouped, 1);

    out = await call('lead_groups_write', { action: 'delete', agentId: 'a1', groupName: 'vip', deleteLeads: true });
    assert.deepEqual(requests.map(sent), ['DELETE /agents/a1/leads/group']);
    assert.deepEqual(requests[0].query, { groupId: 'vip' });
  });

  it('stops instead of looping when leads do not leave the group', async () => {
    responses.set('GET /agents/a1/leads', { leads: Array.from({ length: 100 }, (_, i) => ({ id: `s${i}` })) });
    const out = await call('lead_groups_write', { action: 'rename', agentId: 'a1', groupName: 'old', newGroupName: 'new' });
    assert.equal(out.success, false);
    assert.ok(requests.length <= 4);
  });
});

describe('folders', () => {
  it('list and get by id or name', async () => {
    responses.set('GET /folders', { success: true, folders: [{ ID: 'f1', name: 'Sales' }, { ID: 'f2', name: 'Ops' }] });
    let r = await one('folders_read', { action: 'list' });
    assert.equal(r.out.count, 2);
    r = await one('folders_read', { action: 'get', name: 'Ops' });
    assert.equal(r.out.folder.ID, 'f2');
    const out = await call('folders_read', { action: 'get', folderId: 'nope' });
    assert.equal(out.success, false);
  });

  it('writes', async () => {
    let r = await one('folders_write', { action: 'create', folder: { name: 'Sales', color: '#fff' } });
    assert.equal(sent(r), 'POST /folders/create');
    assert.deepEqual(r.body, { name: 'Sales', color: '#fff' });
    r = await one('folders_write', { action: 'update', folderId: 'f1', folder: { name: 'Renamed' } });
    assert.equal(sent(r), 'PATCH /folders/f1');
    assert.deepEqual(r.body, { name: 'Renamed' });
    assert.equal(sent(await one('folders_write', { action: 'delete', folderId: 'f1' })), 'DELETE /folders/f1');
    assert.equal(sent(await one('folders_write', { action: 'add_agent', folderId: 'f1', agentId: 'a1' })), 'POST /folders/f1/agents/a1');
    assert.equal(sent(await one('folders_write', { action: 'remove_agent', folderId: 'f1', agentId: 'a1' })), 'DELETE /folders/f1/agents/a1');
    const out = await call('folders_write', { action: 'create', folder: { name: 'x', ownerID: 'someone-else' } });
    assert.equal(out.success, false);
  });
});

describe('agent extras', () => {
  it('audit log, handoff reminder, gallery templates, notification email', async () => {
    let r = await one('get_agent_audit_log', { agentId: 'a1', limit: 10 });
    assert.equal(sent(r), 'GET /agents/a1/audit-log');
    r = await one('send_handoff_reminder', { agentId: 'a1', userId: 'u1' });
    assert.equal(sent(r), 'POST /agents/a1/handoff/send-reminder');
    assert.deepEqual(r.body, { userId: 'u1' });
    assert.equal(sent(await one('agent_gallery_templates', { action: 'list' })), 'GET /agent-templates');
    r = await one('agent_gallery_templates', { action: 'create', templateId: 't1', title: 'Mine' });
    assert.equal(sent(r), 'POST /agent-templates/t1/create');
    assert.deepEqual(r.body, { title: 'Mine' });
    assert.equal(sent(await one('notification_email', { action: 'request_code', email: 'a@b.co' })), 'POST /notifications/email/request-code');
    assert.equal(sent(await one('notification_email', { action: 'verify_code', email: 'a@b.co', code: '123456' })), 'POST /notifications/email/verify-code');
    r = await one('notification_email', { action: 'set_subscription', token: 'tok-1234567890', subscribed: false });
    assert.equal(sent(r), 'POST /notifications/email/set');
    assert.deepEqual(r.body, { token: 'tok-1234567890', subscribed: false });
    assert.equal(sent(await one('notification_email', { action: 'unsubscribe', token: 'tok-1234567890' })), 'POST /notifications/email/unsubscribe');
  });

  it('summaries load transcripts concurrently and report conversations that could not be used', async () => {
    responses.set('GET /agents/a1/convos/c1', {
      data: { turns: [
        { from: 'human', messages: [{ type: 'text', item: { payload: { message: 'Do you deliver?' } } }] },
        { from: 'bot', messages: [{ type: 'text', item: { payload: { message: 'Yes, daily.' } } }] },
      ] },
    });
    responses.set('GET /agents/a1/convos/c2', { data: { turns: [] } });
    responses.set('POST /agents/convos/generate-summaries', { success: true, data: [{ convoId: 'c1', summary: 'Asked about delivery.' }] });
    const out = await call('generate_conversation_summaries', { agentId: 'a1', convoIds: ['c1', 'c2'] });
    const post = requests.find((r) => r.method === 'POST');
    assert.deepEqual(post.body, { items: [{ convoId: 'c1', transcript: 'human: Do you deliver?\nbot: Yes, daily.' }] });
    assert.deepEqual(out.data, [{ convoId: 'c1', summary: 'Asked about delivery.' }]);
    assert.deepEqual(out.skipped, [{ convoId: 'c2', reason: 'Conversation has no text messages' }]);
  });
});
