import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  applyExactStringReplace,
  countExactOccurrences,
  unwrapRecord,
} from '../dist/text-patch.js';

describe('text-patch', () => {
  it('counts non-overlapping occurrences', () => {
    assert.equal(countExactOccurrences('aaa', 'aa'), 1);
    assert.equal(countExactOccurrences('ababab', 'ab'), 3);
  });

  it('replaces a unique span', () => {
    const result = applyExactStringReplace(
      'Hello WORLD and friends',
      'WORLD',
      'Convocore'
    );
    assert.equal(result.ok, true);
    if (result.ok) {
      assert.equal(result.updated, 'Hello Convocore and friends');
      assert.equal(result.occurrences, 1);
    }
  });

  it('fails when old_string is missing', () => {
    const result = applyExactStringReplace('abc', 'zzz', 'yyy');
    assert.equal(result.ok, false);
    if (!result.ok) {
      assert.match(result.error, /not found/i);
      assert.equal(result.occurrences, 0);
    }
  });

  it('fails on ambiguous match unless replace_all', () => {
    const ambiguous = applyExactStringReplace('x x x', 'x', 'y', false);
    assert.equal(ambiguous.ok, false);
    if (!ambiguous.ok) {
      assert.equal(ambiguous.occurrences, 3);
      assert.match(ambiguous.error, /replace_all/i);
    }

    const all = applyExactStringReplace('x x x', 'x', 'y', true);
    assert.equal(all.ok, true);
    if (all.ok) {
      assert.equal(all.updated, 'y y y');
      assert.equal(all.occurrences, 3);
    }
  });

  it('unwraps data envelopes', () => {
    assert.deepEqual(unwrapRecord({ data: { ID: 'a' } }), { ID: 'a' });
    assert.deepEqual(unwrapRecord({ ID: 'b' }), { ID: 'b' });
  });
});
