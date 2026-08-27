import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  applyExactStringReplace,
  countExactOccurrences,
  findWhitespaceFlexibleMatches,
  nearestMatchHint,
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
      assert.equal(result.mode, 'exact');
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
      assert.equal(all.mode, 'exact');
    }
  });

  it('falls back to line-ending normalization', () => {
    const content = 'line1\r\nPricing: 300,000 EGP\r\nline3';
    const oldString = 'Pricing: 300,000 EGP';
    const result = applyExactStringReplace(content, oldString, 'Pricing: UPDATED');
    assert.equal(result.ok, true);
    if (result.ok) {
      assert.equal(result.mode, 'exact'); // substring still exact inside CRLF content
      assert.match(result.updated, /Pricing: UPDATED/);
    }

    const blockOld = 'line1\nPricing: 300,000 EGP\nline3';
    const blockResult = applyExactStringReplace(
      content,
      blockOld,
      'line1\nPricing: FIXED\nline3'
    );
    assert.equal(blockResult.ok, true);
    if (blockResult.ok) {
      assert.equal(blockResult.mode, 'line_endings');
      assert.equal(blockResult.updated, 'line1\nPricing: FIXED\nline3');
    }
  });

  it('falls back to whitespace-flexible matching for indent drift', () => {
    const content = [
      '- Pricing: 300,000 EGP for 100-guest wedding event including:',
      '1. Venue rental',
      '2. Bridal & groom suite',
      'Extra person: 2,000 EGP',
      'Always show pictures for the venues when you are displaying any card showing the venue options.',
    ].join('\n');

    // LLM-copied old_string with different indentation / blank line
    const oldString = [
      '- Pricing: 300,000 EGP for 100-guest wedding event including:',
      '  1. Venue rental',
      '  2. Bridal & groom suite',
      '',
      'Extra person: 2,000 EGP',
      'Always show pictures for the venues when you are displaying any card showing the venue options.',
    ].join('\n');

    const newString = '- Pricing: ONLY ONE structure — 300,000 EGP flat for first 100 guests.';

    const result = applyExactStringReplace(content, oldString, newString);
    assert.equal(result.ok, true);
    if (result.ok) {
      assert.equal(result.mode, 'whitespace_flexible');
      assert.equal(result.updated, newString);
      assert.equal(result.occurrences, 1);
    }
  });

  it('includes a nearest excerpt when old_string is not found', () => {
    const content =
      'Intro text\n- Pricing: 300,000 EGP for 100-guest wedding event including:\n1. Venue rental\nOutro';
    const result = applyExactStringReplace(
      content,
      '- Pricing: 999,999 EGP for 100-guest wedding event including:\n1. Venue rental',
      'replacement'
    );
    assert.equal(result.ok, false);
    if (!result.ok) {
      assert.match(result.error, /Nearest similar excerpt/i);
      assert.match(result.error, /300,000 EGP/);
    }
  });

  it('findWhitespaceFlexibleMatches locates indented variants', () => {
    const matches = findWhitespaceFlexibleMatches(
      'alpha\n  beta gamma\ndelta',
      'beta   gamma'
    );
    assert.equal(matches.length, 1);
    assert.equal(matches[0].matched, 'beta gamma');
  });

  it('nearestMatchHint returns nearby text', () => {
    const hint = nearestMatchHint(
      'aaa\nExtra person: 2,000 EGP\nbbb',
      'Extra person: 2,000 EGP\nAlways show pictures'
    );
    assert.ok(hint);
    assert.match(hint, /Extra person: 2,000 EGP/);
  });

  it('unwraps data envelopes', () => {
    assert.deepEqual(unwrapRecord({ data: { ID: 'a' } }), { ID: 'a' });
    assert.deepEqual(unwrapRecord({ ID: 'b' }), { ID: 'b' });
  });
});
