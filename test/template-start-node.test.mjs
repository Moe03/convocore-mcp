import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeTemplateStartNodeArray } from '../dist/template-start-node.js';

test('normalizes a start node missing type to type:start without dropping existing data', () => {
  const inputNodes = [
    {
      id: '__start__',
      name: 'Start',
      description: 'Existing start node description',
      instructions: 'Keep this prompt',
      llmConfig: {
        modelId: 'gemini-2.5-flash',
        temperature: 0.2,
        maxTokens: 1500,
      },
    },
  ];

  const result = normalizeTemplateStartNodeArray(inputNodes);
  const startNode = result.nodes[0];

  assert.equal(result.createdStartNode, false);
  assert.equal(startNode.type, 'start');
  assert.equal(startNode.id, '__start__');
  assert.equal(startNode.name, 'Start');
  assert.equal(startNode.description, 'Existing start node description');
  assert.equal(startNode.instructions, 'Keep this prompt');
  assert.deepEqual(startNode.llmConfig, {
    modelId: 'gemini-2.5-flash',
    temperature: 0.2,
    maxTokens: 1500,
  });
  assert.deepEqual(result.patchedFields, ['type']);
});
