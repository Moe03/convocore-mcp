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
import { appendStandardPromptSections } from '../dist/agent-prompt-standards.js';

describe('recommended chat model', () => {
  it('defaults new start nodes to DeepSeek-V4-Flash with kb + web-search', () => {
    assert.equal(RECOMMENDED_CHAT_MODEL_ID, 'deepseek-ai/DeepSeek-V4-Flash');
    assert.equal(FALLBACK_CHAT_MODEL_ID, 'gpt-5.6-luna');
    assert.equal(TEMPLATE_START_NODE_DEFAULTS.llmConfig.modelId, 'deepseek-ai/DeepSeek-V4-Flash');
    const created = normalizeTemplateStartNodeArray([]);
    assert.equal(created.nodes[0].llmConfig.modelId, 'deepseek-ai/DeepSeek-V4-Flash');
    assert.equal(created.nodes[0].kb.enabled, true);
    assert.equal(created.nodes[0].kb.maxChunks, 8);
    assert.ok(created.nodes[0].toolsIds.includes('web-search'));
  });

  it('treats gpt-4o family as legacy', () => {
    assert.equal(isLegacyChatModelId('gpt-4o'), true);
    assert.equal(isLegacyChatModelId('gpt-4o-mini'), true);
    assert.equal(isLegacyChatModelId('gpt-5.6-luna'), false);
    assert.equal(isLegacyChatModelId('deepseek-ai/DeepSeek-V4-Flash'), false);
  });

  it('includes DeepSeek Flash and Luna in the pricing catalog', () => {
    const ids = PRICING.models.map((m) => m.modelId);
    assert.ok(ids.includes('deepseek-ai/DeepSeek-V4-Flash'));
    assert.ok(ids.includes('gpt-5.6-luna'));
  });

  it('appends standard prompt clauses idempotently', () => {
    const once = appendStandardPromptSections('You are a hotel concierge.');
    assert.ok(once.includes('Anti-repetition'));
    assert.ok(once.includes('Buying / booking intent'));
    const twice = appendStandardPromptSections(once);
    assert.equal(twice, once);
  });
});
