import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { createMcpServer, tools } from '../dist/index.js';
import { CORE_TOOL_HINTS, OPEN_WORLD_TOOLS, TOOL_TITLES } from '../dist/tool-annotations.js';

// The Claude Connectors Directory rejects tools without a title and a readOnlyHint / destructiveHint.
async function listTools(options) {
  const server = createMcpServer(options);
  const [a, b] = InMemoryTransport.createLinkedPair();
  await server.connect(a);
  const client = new Client({ name: 't', version: '1' });
  await client.connect(b);
  const { tools: listed } = await client.listTools();
  await client.close();
  return listed;
}

function annotationProblems(listed) {
  const problems = [];
  for (const tool of listed) {
    const a = tool.annotations || {};
    if (typeof a.title !== 'string' || !a.title.trim()) problems.push(`${tool.name}: no annotations.title`);
    if (typeof a.readOnlyHint !== 'boolean' && typeof a.destructiveHint !== 'boolean') {
      problems.push(`${tool.name}: no readOnlyHint / destructiveHint`);
    }
    for (const hint of ['readOnlyHint', 'destructiveHint', 'openWorldHint']) {
      if (typeof a[hint] !== 'boolean') problems.push(`${tool.name}: ${hint} not set explicitly`);
    }
    if (a.readOnlyHint === true && a.destructiveHint === true) problems.push(`${tool.name}: read-only and destructive`);
  }
  return problems;
}

describe('tool annotations (Connectors Directory)', () => {
  it('every tool on the stdio server has a title and a safety hint', async () => {
    assert.deepEqual(annotationProblems(await listTools()), []);
  });

  it('every tool on the hosted server has a title and a safety hint', async () => {
    const listed = await listTools({ hosted: true });
    assert.ok(listed.length > 100);
    assert.deepEqual(annotationProblems(listed), []);
  });

  it('titles are unique', () => {
    const seen = new Map();
    for (const tool of tools) {
      const title = tool.annotations.title;
      assert.ok(!seen.has(title), `${tool.name} and ${seen.get(title)} share the title "${title}"`);
      seen.set(title, tool.name);
    }
  });

  it('has no entries for tools that no longer exist', () => {
    const names = new Set(tools.map((t) => t.name));
    const stale = [...Object.keys(TOOL_TITLES), ...Object.keys(CORE_TOOL_HINTS), ...OPEN_WORLD_TOOLS].filter(
      (n) => !names.has(n)
    );
    assert.deepEqual(stale, []);
  });

  it('marks deletes as destructive and pure reads as read-only', () => {
    const byName = Object.fromEntries(tools.map((t) => [t.name, t.annotations]));
    for (const name of ['delete_agent', 'delete_conversation', 'delete_kb_doc', 'release_twilio_number', 'run_command']) {
      assert.equal(byName[name].destructiveHint, true, name);
      assert.equal(byName[name].readOnlyHint, false, name);
    }
    for (const name of ['get_agent', 'list_agents', 'list_conversations', 'get_kb_doc']) {
      assert.equal(byName[name].readOnlyHint, true, name);
    }
    for (const name of ['create_agent', 'update_agent', 'create_kb_doc']) {
      assert.equal(byName[name].readOnlyHint, false, name);
      assert.equal(byName[name].destructiveHint, false, name);
    }
  });

  it('marks only web-reaching and outbound tools as open world', () => {
    const byName = Object.fromEntries(tools.map((t) => [t.name, t.annotations]));
    for (const name of ['scrape_url', 'send_sms', 'start_outbound_call']) assert.equal(byName[name].openWorldHint, true, name);
    for (const name of ['list_agents', 'get_agent', 'delete_agent', 'leads_write']) assert.equal(byName[name].openWorldHint, false, name);
  });

  it('hides plan pricing and secret-carrying tools on the hosted server', async () => {
    const names = (await listTools({ hosted: true })).map((t) => t.name);
    for (const name of ['get_pricing_info', 'import_twilio_number', 'run_command']) assert.ok(!names.includes(name), name);
  });
});
