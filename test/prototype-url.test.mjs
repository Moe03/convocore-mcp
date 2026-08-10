import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { buildPrototypeAgentUrl } from '../dist/mcp-server-instructions.js';

describe('buildPrototypeAgentUrl', () => {
  it('builds eu and na prototype URLs', () => {
    assert.equal(
      buildPrototypeAgentUrl('6TUWPdhWvPPssnca5z78', 'eu-gcp'),
      'https://app.convocore.ai/eu/prototype/6TUWPdhWvPPssnca5z78'
    );
    assert.equal(
      buildPrototypeAgentUrl('abc123', 'na'),
      'https://app.convocore.ai/na/prototype/abc123'
    );
  });

  it('never uses /agents/', () => {
    const url = buildPrototypeAgentUrl('x', 'eu');
    assert.match(url, /\/prototype\//);
    assert.doesNotMatch(url, /\/agents\//);
  });
});
