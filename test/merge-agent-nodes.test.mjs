import test from 'node:test';
import assert from 'node:assert/strict';
import {
  mergeAgentNodesForUpdate,
  applySystemPromptToExistingNodes,
  readStartNodeInstructions,
} from '../dist/merge-agent-nodes.js';

test('partial toolsIds patch keeps existing instructions', () => {
  const existing = [
    {
      id: '__start__',
      type: 'start',
      instructions: 'Ivy prompt — do not wipe',
      toolsIds: ['web-search', 'dead-http-tool'],
      kb: { enabled: true, maxChunks: 8 },
    },
    { id: 'note-1', type: 'note', instructions: '' },
  ];
  const merged = mergeAgentNodesForUpdate(existing, [
    { id: '__start__', toolsIds: ['web-search'] },
  ]);
  assert.equal(merged[0].instructions, 'Ivy prompt — do not wipe');
  assert.deepEqual(merged[0].toolsIds, ['web-search']);
  assert.equal(merged[0].kb.maxChunks, 8);
  assert.equal(merged.length, 2);
  assert.equal(merged[1].id, 'note-1');
});

test('empty incoming instructions do not overwrite a live prompt', () => {
  const existing = [{ id: '__start__', type: 'start', instructions: 'keep me' }];
  const merged = mergeAgentNodesForUpdate(existing, [
    { id: '__start__', instructions: '', toolsIds: ['web-search'] },
  ]);
  assert.equal(merged[0].instructions, 'keep me');
});

test('systemPrompt writes onto existing start node without dropping siblings', () => {
  const existing = [
    { id: '__start__', type: 'start', instructions: '' },
    { id: 'note-1', type: 'note' },
  ];
  const nodes = applySystemPromptToExistingNodes(existing, 'You are Ivy.');
  assert.equal(nodes[0].instructions, 'You are Ivy.');
  assert.equal(nodes[1].id, 'note-1');
});

test('refuses a partial nodes patch when the live graph was not loaded', () => {
  assert.throws(
    () => mergeAgentNodesForUpdate([], [{ toolsIds: ['web-search'] }]),
    /Refusing to PATCH nodes/
  );
});

test('start-node-not-at-zero keeps instructions on the real start node', () => {
  const existing = [
    { id: 'note-1', type: 'note', instructions: '' },
    { id: '__start__', type: 'start', instructions: 'Ivy prompt — do not wipe', toolsIds: ['dead'] },
  ];
  const merged = mergeAgentNodesForUpdate(existing, [{ id: '__start__', toolsIds: ['web-search'] }]);
  assert.equal(merged[1].instructions, 'Ivy prompt — do not wipe');
  assert.deepEqual(merged[1].toolsIds, ['web-search']);
  assert.equal(merged[0].id, 'note-1');
});

test('readStartNodeInstructions falls back to vg_instructions when start is empty', () => {
  const read = readStartNodeInstructions({
    nodes: [{ id: '__start__', type: 'start', instructions: '' }],
    vg_instructions: 'legacy live prompt',
  });
  assert.equal(read.text, 'legacy live prompt');
  assert.equal(read.source, 'vg_instructions');
});
