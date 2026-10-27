import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import {
  assertGrayLabelToolCall,
  GRAY_LABEL_TOOLS,
  grayLabelDisplayName,
  isClientToken,
  isGrayLabelHost,
  parseGrayLabelSession,
  rebrandText,
  regionFromClientToken,
} from '../dist/gray-label.js';
import { createMcpServer, tools } from '../dist/index.js';
import { buildInstallLinks } from '../dist/install-links.js';

const brand = {
  name: 'Acme AI',
  appBaseUrl: 'https://portal.acme.com',
  prototypeBaseUrl: 'https://portal.acme.com/eu/prototype',
  cdnBaseUrl: 'https://cdn.acme-widgets.net',
};
const session = {
  workspaceId: 'ws1',
  clientId: 'c1',
  clientName: 'Bobs Bakery',
  agents: [{ id: 'agentA', title: 'Bakery bot' }],
  brand,
};
const PLATFORM = /convo\s*-?\s*core|voice\s*glow|tixae/i;

const token = (r) => `gl_${Buffer.from(`${r}:ws1:conn1`).toString('base64url')}.${'x'.repeat(43)}`;

describe('gray-label basics', () => {
  it('recognises hosts and tokens', () => {
    assert.equal(isGrayLabelHost('mcp-project.vg-stuff.com'), true);
    assert.equal(isGrayLabelHost('MCP-PROJECT.vg-stuff.com:443'), true);
    assert.equal(isGrayLabelHost('mcp.convocore.ai'), false);
    assert.equal(isClientToken(token('e')), true);
    assert.equal(isClientToken('vg_abc'), false);
    assert.equal(regionFromClientToken(token('e')), 'eu-gcp');
    assert.equal(regionFromClientToken(token('n')), 'na-gcp');
    assert.equal(regionFromClientToken('gl_nope'), undefined);
  });

  it('names the connection "{Agency} - {Client}"', () => {
    assert.equal(grayLabelDisplayName(session), 'Acme AI - Bobs Bakery');
    assert.equal(grayLabelDisplayName({ brand, clientName: null }), 'Acme AI');
  });

  it('parses the whoami payload', () => {
    const parsed = parseGrayLabelSession({ ...session, brand: { ...brand, appBaseUrl: 'https://portal.acme.com/' } });
    assert.equal(parsed.brand.appBaseUrl, 'https://portal.acme.com');
    assert.deepEqual(parsed.agents, session.agents);
    assert.throws(() => parseGrayLabelSession({}));
  });
});

describe('rebrandText', () => {
  it('rewrites platform links and names to the agency', () => {
    const out = rebrandText(
      'Try https://app.convocore.ai/eu/prototype/x — load https://cdn.convocore.ai/vg_live_build/vg_bundle.js. Convocore and ConvoCore and VoiceGlow, @tixae-labs/web-sdk, X-Convocore-Region.',
      brand
    );
    assert.match(out, /https:\/\/portal\.acme\.com\/eu\/prototype\/x/);
    assert.match(out, /https:\/\/cdn\.acme-widgets\.net\/vg_live_build\/vg_bundle\.js/);
    assert.doesNotMatch(out, PLATFORM);
    assert.match(out, /Acme AI and Acme AI and Acme AI/);
  });

  it('keeps an agency subdomain on the platform domain intact', () => {
    const sub = { ...brand, appBaseUrl: 'https://acme.convocore.ai' };
    const out = rebrandText('Open https://app.convocore.ai/eu/prototype/x on Convocore', sub);
    assert.equal(out, 'Open https://acme.convocore.ai/eu/prototype/x on Acme AI');
  });
});

describe('assertGrayLabelToolCall', () => {
  it('allows client tools on their own agents only', () => {
    assert.deepEqual(assertGrayLabelToolCall('get_agent', { agentId: 'agentA' }, session), { agentId: 'agentA' });
    assert.throws(() => assertGrayLabelToolCall('get_agent', { agentId: 'agentB' }, session), /not one of your agents/);
    assert.throws(() => assertGrayLabelToolCall('get_agent_usage_bulk', { agentIds: ['agentA', 'agentB'] }, session), /agentB/);
    assert.throws(() => assertGrayLabelToolCall('create_agent', {}, session), /not available/);
    assert.throws(() => assertGrayLabelToolCall('clients_read', { action: 'list' }, session), /not available/);
  });

  it('drops server-side overrides from interact', () => {
    const out = assertGrayLabelToolCall('interact_with_agent', { agentId: 'agentA', prompt: 'hi', workspaceData: { x: 1 }, agentData: {} }, session);
    assert.deepEqual(out, { agentId: 'agentA', prompt: 'hi' });
  });

  it('only lists tools that exist', () => {
    const names = new Set(tools.map((t) => t.name));
    for (const name of GRAY_LABEL_TOOLS) assert.ok(names.has(name), `${name} is not a real tool`);
  });
});

describe('gray-label MCP server', () => {
  async function connect() {
    const server = createMcpServer({ name: grayLabelDisplayName(session), hosted: true, grayLabel: session });
    const [a, b] = InMemoryTransport.createLinkedPair();
    await server.connect(a);
    const client = new Client({ name: 't', version: '1' });
    await client.connect(b);
    return client;
  }

  it('shows no platform branding anywhere the assistant reads', async () => {
    const client = await connect();
    assert.equal(client.getServerVersion().name, 'Acme AI - Bobs Bakery');
    const instructions = client.getInstructions();
    assert.doesNotMatch(instructions, PLATFORM);
    assert.match(instructions, /agentA/);
    const { tools: listed } = await client.listTools();
    assert.ok(listed.every((t) => GRAY_LABEL_TOOLS.has(t.name)));
    const leak = JSON.stringify(listed).match(/.{0,60}(convo\s*-?\s*core|voice\s*glow|tixae).{0,30}/i);
    assert.equal(leak, null, leak?.[0]);
    const { prompts } = await client.listPrompts();
    assert.doesNotMatch(JSON.stringify(prompts), PLATFORM);
    const css = await client.getPrompt({ name: 'generate_widget_css', arguments: {} });
    assert.doesNotMatch(JSON.stringify(css), PLATFORM);
  });

  it('does not mention tools the client cannot use', async () => {
    const client = await connect();
    const { tools: listed } = await client.listTools();
    const hidden = tools.map((t) => t.name).filter((n) => !GRAY_LABEL_TOOLS.has(n));
    const text = JSON.stringify(listed) + client.getInstructions();
    for (const name of hidden) assert.doesNotMatch(text, new RegExp(`\\b${name}\\b`), name);
  });

  it('refuses other agents and hidden tools without calling the API', async () => {
    const client = await connect();
    const other = await client.callTool({ name: 'get_agent', arguments: { agentId: 'agentB' } });
    assert.equal(other.isError, true);
    assert.match(other.content[0].text, /not one of your agents/);
    const hidden = await client.callTool({ name: 'workspace_read', arguments: { action: 'credits' } });
    assert.equal(hidden.isError, true);
    const voice = await client.callTool({ name: 'get_website_embed_code', arguments: { agentId: 'agentA', mode: 'voice-react' } });
    assert.equal(voice.isError, true);
    const search = await client.callTool({ name: 'search_mcp_tools', arguments: { query: 'clients organizations workspace billing agency' } });
    assert.doesNotMatch(search.content[0].text, /clients_read|orgs_read|workspace_read|agency_read/);
  });
});

describe('gray-label install links', () => {
  it('carries no platform header or env names', () => {
    const links = buildInstallLinks({
      mcpUrl: 'https://mcp-project.vg-stuff.com/mcp',
      workspaceSecret: token('e'),
      region: 'eu-gcp',
      name: 'Acme AI - Bobs Bakery',
      grayLabel: true,
    });
    assert.equal(links.name, 'Acme AI - Bobs Bakery');
    assert.doesNotMatch(JSON.stringify(links), /convocore/i);
  });
});
