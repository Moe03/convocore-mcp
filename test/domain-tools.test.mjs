import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { tools } from '../dist/index.js';
import { buildDomainTools } from '../dist/tools/index.js';
import { createSearchCatalogModule } from '../dist/tools/catalog.js';

const EXPECTED_DOMAIN_TOOLS = [
  'orgs_read',
  'orgs_write',
  'agency_read',
  'agency_write',
  'clients_read',
  'clients_write',
  'leads_read',
  'leads_write',
  'list_agent_tools',
  'get_agent_tool',
  'create_agent_tool',
  'update_agent_tool',
  'delete_agent_tool',
  'list_agent_variables',
  'get_agent_variable',
  'create_agent_variable',
  'update_agent_variable',
  'delete_agent_variable',
  'test_agent_tool',
  'test_agent_tool_request',
  'run_agent_auto_test',
  'clone_agent',
  'send_channel_message',
  'search_kb_docs',
  'bulk_delete_kb_docs',
  'bulk_create_kb_docs',
  'create_kb_image',
  'get_kb_quota',
  'search_mcp_tools',
];

describe('domain tools catalog', () => {
  it('exports all planned domain tool names on the composed catalog', () => {
    const names = new Set(tools.map((t) => t.name));
    for (const name of EXPECTED_DOMAIN_TOOLS) {
      assert.ok(names.has(name), `missing tool: ${name}`);
    }
  });

  it('keeps domain handlers registered for every domain tool', () => {
    const { tools: domainTools, handlers } = buildDomainTools(() => tools);
    for (const t of domainTools) {
      assert.equal(typeof handlers[t.name], 'function', `handler missing for ${t.name}`);
    }
  });

  it('search_mcp_tools finds leads and agent tools by keyword', async () => {
    const mod = createSearchCatalogModule(() => tools);
    const handler = mod.handlers.search_mcp_tools;
    assert.ok(handler);

    const leadsRaw = await handler({ query: 'leads', detail: 'names', limit: 10 });
    const leads = JSON.parse(leadsRaw.content[0].text);
    assert.equal(leads.success, true);
    assert.ok(
      leads.matches.some((m) => m.name === 'leads_read' || m.name === 'leads_write'),
      'expected leads_* in search results'
    );

    const toolsRaw = await handler({
      query: 'http tool',
      domain: 'tools',
      detail: 'brief',
      limit: 15,
    });
    const toolHits = JSON.parse(toolsRaw.content[0].text);
    assert.ok(
      toolHits.matches.some((m) => String(m.name).includes('agent_tool')),
      'expected agent_tool* in search results'
    );
  });

  it('disambiguates channel send from conversation message update in descriptions', () => {
    const send = tools.find((t) => t.name === 'send_channel_message');
    const update = tools.find((t) => t.name === 'update_conversation_messages');
    assert.ok(send);
    assert.ok(update);
    assert.match(send.description, /WhatsApp|channel/i);
    assert.match(send.description, /update_conversation_messages/);
  });
});
