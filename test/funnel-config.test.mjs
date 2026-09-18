import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildDefaultLeadFunnelConfig,
  stripDeprecatedAgentFields,
  DEFAULT_LEAD_COLLECTION_RULES,
} from '../dist/funnel-config.js';

test('strips vg_instructions and vg_systemPrompt so PATCH does not send rejected fields', () => {
  const out = stripDeprecatedAgentFields({
    title: 'PlasmaPen',
    enableNodes: true,
    vg_instructions: 'legacy',
    vg_systemPrompt: 'legacy2',
    nodes: [{ instructions: 'keep' }],
  });
  assert.equal(out.vg_instructions, undefined);
  assert.equal(out.vg_systemPrompt, undefined);
  assert.equal(out.title, 'PlasmaPen');
  assert.equal(out.nodes[0].instructions, 'keep');
});

test('default funnel emails recipients on hot-lead score — not an HTTP webhook', () => {
  const funnel = buildDefaultLeadFunnelConfig(['sales@example.com']);
  assert.equal(funnel.enabled, true);
  assert.ok(funnel.steps.length >= 3);
  assert.equal(funnel.notificationRules.length, 1);
  assert.equal(funnel.notificationRules[0].type, 'score_threshold');
  assert.deepEqual(funnel.notificationRules[0].recipients, ['sales@example.com']);
  assert.equal(DEFAULT_LEAD_COLLECTION_RULES.enabled, true);
});

test('default funnel without emails still scores but does not invent notify recipients', () => {
  const funnel = buildDefaultLeadFunnelConfig([]);
  assert.equal(funnel.enabled, true);
  assert.equal(funnel.notificationRules.length, 0);
});
