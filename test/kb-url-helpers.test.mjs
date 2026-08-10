import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { kbDocNameFromUrl, normalizeKbUrl } from '../dist/convocore-client.js';

describe('kb url helpers', () => {
  it('normalizes host case and trailing slash', () => {
    assert.equal(
      normalizeKbUrl('https://Example.com/rooms/'),
      'https://example.com/rooms'
    );
  });

  it('derives a readable name from the path', () => {
    assert.equal(
      kbDocNameFromUrl('https://hotel.example/en/dining-and-bars'),
      'dining and bars'
    );
  });
});
