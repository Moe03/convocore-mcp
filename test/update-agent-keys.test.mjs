import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { assertAgentUpdateKeys, tools } from '../dist/index.js';

describe('update_agent additionalConfig', () => {
  it('accepts fields the backend allowlist accepts', () => {
    assert.doesNotThrow(() =>
      assertAgentUpdateKeys({ ADVANCED_customCSS: 'a{}', nodesSettings: { haikuToolOnlyRuntime: true }, proactiveMessage: 'hi' })
    );
  });

  it('explains a wrong key before any request (customCSS -> ADVANCED_customCSS)', () => {
    assert.throws(() => assertAgentUpdateKeys({ customCSS: 'a{}' }), (e) => {
      const msg = e.issues.map((i) => i.message).join(' ');
      assert.match(msg, /ADVANCED_customCSS/);
      assert.deepEqual(e.issues[0].path, ['additionalConfig', 'customCSS']);
      return true;
    });
  });

  it('rejects forbidden fields and suggests near names for unknown ones', () => {
    assert.throws(() => assertAgentUpdateKeys({ ownerID: 'x' }), /can never be set/);
    assert.throws(() => assertAgentUpdateKeys({ welcomeMessage: 'x' }), /not an agent field/);
  });

  it('the update_agent schema types additionalConfig from the agent schema, incl. nodesSettings.haikuToolOnlyRuntime', () => {
    const tool = tools.find((t) => t.name === 'update_agent');
    const cfg = tool.inputSchema.properties.additionalConfig;
    assert.ok(cfg.properties.ADVANCED_customCSS.description);
    assert.ok(cfg.properties.nodesSettings.properties.haikuToolOnlyRuntime.description);
  });
});

describe('agent write responses', () => {
  it('mask API keys but keep the rest of the agent', async () => {
    const { createServer } = await import('node:http');
    const { ConvocoreClient } = await import('../dist/convocore-client.js');
    const server = createServer((req, res) => {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ success: true, data: { ID: 'a1', title: 'T', SECRET_API_KEY: 'vg_AXSfB9OQP2jq0Xtbut68' } }));
    });
    await new Promise((r) => server.listen(0, '127.0.0.1', r));
    try {
      const client = new ConvocoreClient({ workspaceSecret: 's', apiRegion: 'eu-gcp', baseUrl: `http://127.0.0.1:${server.address().port}/v3` });
      for (const result of [await client.updateAgent('a1', { agent: { title: 'T' } }), await client.createAgent({ agent: { title: 'T' } })]) {
        assert.equal(result.data.title, 'T');
        assert.ok(!JSON.stringify(result).includes('Xtbut68'), 'secret leaked');
        assert.match(result.data.SECRET_API_KEY, /hidden/);
      }
    } finally {
      server.close();
    }
  });
});

describe('secret masking', () => {
  it('masks token / secret / api key / password strings at any depth, not counters', async () => {
    const { maskSecretFields } = await import('../dist/convocore-client.js');
    const out = maskSecretFields({
      title: 'T',
      whatsappToken: 'EAAFBn6bMaNoBSR2',
      SECRET_API_KEY: 'vg_abc123',
      maxTokensUsage: 5,
      vg_maxTokens: 1024,
      nested: { igAccessToken: 'IGQ123', serverUrlSecret: 'shh', ok: 'yes' },
      list: [{ password: 'pw' }],
    });
    const text = JSON.stringify(out);
    for (const leaked of ['EAAFBn6bMaNoBSR2', 'vg_abc123', 'IGQ123', 'shh', '"pw"']) assert.ok(!text.includes(leaked), leaked);
    assert.equal(out.title, 'T');
    assert.equal(out.maxTokensUsage, 5);
    assert.equal(out.vg_maxTokens, 1024);
    assert.equal(out.nested.ok, 'yes');
  });
});
