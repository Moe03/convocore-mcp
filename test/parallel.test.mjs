import test from 'node:test';
import assert from 'node:assert/strict';
import { mapWithConcurrency } from '../dist/parallel.js';

test('mapWithConcurrency settles failures without aborting', async () => {
  const result = await mapWithConcurrency(
    ['a', 'b', 'c'],
    async (id) => {
      if (id === 'b') throw new Error('nope');
      return id.toUpperCase();
    },
    { concurrency: 2 }
  );
  assert.equal(result.succeeded.length, 2);
  assert.equal(result.failed.length, 1);
  assert.equal(result.failed[0].id, 'b');
  assert.match(result.failed[0].error, /nope/);
});
