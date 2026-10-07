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
  it('defaults new start nodes to Claude Haiku 4.5 with kb + web-search', () => {
    assert.equal(RECOMMENDED_CHAT_MODEL_ID, 'claude-haiku-4-5-20251001');
    assert.equal(FALLBACK_CHAT_MODEL_ID, 'deepseek-ai/DeepSeek-V4-Flash');
    assert.equal(TEMPLATE_START_NODE_DEFAULTS.llmConfig.modelId, 'claude-haiku-4-5-20251001');
    const created = normalizeTemplateStartNodeArray([]);
    assert.equal(created.nodes[0].llmConfig.modelId, 'claude-haiku-4-5-20251001');
    assert.equal(created.nodes[0].kb.enabled, true);
    assert.equal(created.nodes[0].kb.maxChunks, 3);
    assert.ok(created.nodes[0].toolsIds.includes('web-search'));
  });

  it('treats gpt-4o family as legacy', () => {
    assert.equal(isLegacyChatModelId('gpt-4o'), true);
    assert.equal(isLegacyChatModelId('gpt-4o-mini'), true);
    assert.equal(isLegacyChatModelId('claude-haiku-4-5-20251001'), false);
    assert.equal(isLegacyChatModelId('gpt-5.6-luna'), false);
    assert.equal(isLegacyChatModelId('deepseek-ai/DeepSeek-V4-Flash'), false);
  });

  it('marks Claude Haiku 4.5 as the only recommended model', () => {
    const recommended = PRICING.models.filter((m) => m.recommended).map((m) => m.modelId);
    assert.deepEqual(recommended, ['claude-haiku-4-5-20251001']);
  });

  it('appends standard prompt clauses idempotently', () => {
    const once = appendStandardPromptSections('You are a hotel concierge.');
    assert.ok(once.includes('Anti-repetition'));
    assert.ok(once.includes('Buying / booking intent'));
    const twice = appendStandardPromptSections(once);
    assert.equal(twice, once);
  });
});
