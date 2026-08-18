import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  extractWorkspaceNameFromPayload,
  formatMcpDisplayName,
  sanitizeWorkspaceName,
} from '../dist/mcp-display-name.js';

describe('mcp-display-name', () => {
  it('sanitizes workspace labels', () => {
    assert.equal(sanitizeWorkspaceName('  Acme\nCorp  '), 'Acme Corp');
    assert.equal(sanitizeWorkspaceName('   '), undefined);
  });

  it('builds Convocore {workspaceName}', () => {
    assert.equal(formatMcpDisplayName(), 'Convocore');
    assert.equal(formatMcpDisplayName({ workspaceName: 'Beta' }), 'Convocore Beta');
  });

  it('extracts workspaceName from API-ish payloads', () => {
    assert.equal(
      extractWorkspaceNameFromPayload({ data: { workspaceName: 'Orbit' } }),
      'Orbit'
    );
    assert.equal(
      extractWorkspaceNameFromPayload({
        workspaces: [{ name: 'From List' }],
      }),
      'From List'
    );
  });
});
