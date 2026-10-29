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

  it('compacts bare agent arrays into { mode, data }', () => {
    const out = compactAgentsListResult([
      { ID: '1', title: 'A', nodes: [{ instructions: 'big' }] },
    ]);
    assert.equal(out.mode, 'compact');
    assert.equal(out.data.length, 1);
    assert.equal(out.data[0].ID, '1');
    assert.equal(out.data[0].nodes, undefined);
  });

  it('uses the agent ID for id when search rows carry a row UUID', () => {
    const out = compactAgentsListResult({
      agents: [{ ID: 'O49Gg4Jz5fApkJW85WJg', id: '0a99575c-1122-4f00-92ff-14bbc9d61b3b', title: 'T' }],
      starredAgents: [{ ID: 'HUPdykI3Vla2T83Tc0AV', id: 'cb045fb0-a841-4384-b9b0-eb4e77bf4942' }],
    });
    assert.equal(out.agents[0].id, 'O49Gg4Jz5fApkJW85WJg');
    assert.equal(out.starredAgents[0].id, 'HUPdykI3Vla2T83Tc0AV');
  });
});
