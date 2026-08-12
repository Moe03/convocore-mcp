import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { checkUrl, checkUrls } from '../dist/url-check.js';

describe('url-check', () => {
  it('marks invalid URLs', async () => {
    const r = await checkUrl('not-a-url');
    assert.equal(r.ok, false);
    assert.match(r.error || '', /Invalid URL/i);
  });

  it('checks a known public URL (example.com)', async () => {
    const r = await checkUrl('https://example.com');
    assert.equal(r.reachable, true);
    assert.ok(typeof r.status === 'number');
    assert.ok(r.status >= 200 && r.status < 500);
  });

  it('batch check returns counts', async () => {
    const batch = await checkUrls([
      'https://example.com',
      'https://example.com/this-page-should-404-convocore-mcp-test',
    ]);
    assert.equal(batch.checked, 2);
    assert.equal(batch.results.length, 2);
    assert.ok(batch.okCount + batch.failedCount === 2);
  });
});
