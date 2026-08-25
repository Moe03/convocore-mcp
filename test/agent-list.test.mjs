import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { compactAgentsListResult } from '../dist/agent-list.js';

describe('compactAgentsListResult', () => {
  it('strips heavy fields from data[] and keeps short fields', () => {
    const result = compactAgentsListResult({
      success: true,
      message: 'ok',
      total: 1,
      data: [
        {
          ID: 'abc',
          title: 'Demo',
          description: 'x'.repeat(200),
          theme: 'blue-light',
          ownerID: 'ws1',
          nodes: [{ instructions: 'HUGE PROMPT '.repeat(100) }],
          vg_instructions: 'legacy huge',
          voiceConfig: { provider: 'eleven', voiceId: 'v1', nested: { a: 1 } },
          customCSS: '.vg-root{color:red}',
          vg_enableUIEngine: true,
          createdAtUNIX: 1710000000,
          disabled: false,
        },
      ],
    });

    assert.equal(typeof result, 'object');
    const out = result;
    assert.equal(out.mode, 'compact');
    assert.ok(typeof out.note === 'string' && out.note.includes('mode="full"'));
    assert.equal(out.data.length, 1);
    const agent = out.data[0];
    assert.equal(agent.ID, 'abc');
    assert.equal(agent.title, 'Demo');
    assert.equal(agent.theme, 'blue-light');
    assert.equal(agent.vg_enableUIEngine, true);
    assert.equal(agent.nodes, undefined);
    assert.equal(agent.vg_instructions, undefined);
    assert.equal(agent.voiceConfig, undefined);
    assert.equal(agent.customCSS, undefined);
    assert.ok(String(agent.description).endsWith('...'));
    assert.ok(String(agent.description).length <= 160);
  });

  it('compacts bare agent arrays', () => {
    const out = compactAgentsListResult([
      { ID: '1', title: 'A', nodes: [{ instructions: 'big' }] },
    ]);
    assert.equal(out.length, 1);
    assert.equal(out[0].ID, '1');
    assert.equal(out[0].nodes, undefined);
  });
});
