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
