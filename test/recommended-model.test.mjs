import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  FALLBACK_CHAT_MODEL_ID,
  RECOMMENDED_CHAT_MODEL_ID,
  TEMPLATE_START_NODE_DEFAULTS,
  isLegacyChatModelId,
  normalizeTemplateStartNodeArray,
} from '../dist/template-start-node.js';
import { PRICING } from '../dist/pricing.js';

describe('recommended chat model', () => {
  it('defaults new start nodes to gpt-5.6-luna', () => {
    assert.equal(RECOMMENDED_CHAT_MODEL_ID, 'gpt-5.6-luna');
    assert.equal(FALLBACK_CHAT_MODEL_ID, 'gemini-3.1-flash-lite');
    assert.equal(TEMPLATE_START_NODE_DEFAULTS.llmConfig.modelId, 'gpt-5.6-luna');
    const created = normalizeTemplateStartNodeArray([]);
    assert.equal(created.nodes[0].llmConfig.modelId, 'gpt-5.6-luna');
  });

  it('treats gpt-4o family as legacy', () => {
    assert.equal(isLegacyChatModelId('gpt-4o'), true);
    assert.equal(isLegacyChatModelId('gpt-4o-mini'), true);
    assert.equal(isLegacyChatModelId('gpt-5.6-luna'), false);
  });

  it('includes Luna and Flash-Lite in the pricing catalog', () => {
    const ids = PRICING.models.map((m) => m.modelId);
    assert.ok(ids.includes('gpt-5.6-luna'));
    assert.ok(ids.includes('gemini-3.1-flash-lite'));
  });
});
