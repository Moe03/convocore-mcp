import test from 'node:test';
import assert from 'node:assert/strict';
import { computeTemplateIdempotencyKey } from '../dist/template-idempotency.js';

const scope = {
  baseUrl: 'http://127.0.0.1:5000/v3',
  workspaceSecret: 'vg_test_secret',
};

test('computeTemplateIdempotencyKey is stable for same payload regardless of key order', () => {
  const a = {
    title: 'Agent A',
    systemPrompt: 'Help users',
    voiceConfig: {
      speechGen: { provider: 'google-live', voiceId: 'Puck' },
      config: { enableWebCalling: true, recordAudio: true },
    },
  };

  const b = {
    voiceConfig: {
      config: { recordAudio: true, enableWebCalling: true },
      speechGen: { voiceId: 'Puck', provider: 'google-live' },
    },
    systemPrompt: 'Help users',
    title: 'Agent A',
  };

  assert.equal(computeTemplateIdempotencyKey(a, scope), computeTemplateIdempotencyKey(b, scope));
});

test('computeTemplateIdempotencyKey uses requestId when provided', () => {
  const key = computeTemplateIdempotencyKey(
    {
      requestId: 'harness-123',
      title: 'Should not affect request-id mode',
    },
    scope
  );

  assert.match(key, /:req:harness-123$/);
});
