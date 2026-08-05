import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  extractQuerySecret,
  resolveHostedWorkspaceSecret,
} from '../dist/hosted-auth.js';

describe('hosted-auth', () => {
  it('reads Bearer first', () => {
    assert.equal(
      resolveHostedWorkspaceSecret('Bearer vg_from_header', {
        requestUrl: '/mcp?token=vg_from_query',
      }),
      'vg_from_header'
    );
  });

  it('falls back to ?token=', () => {
    assert.equal(
      extractQuerySecret('/mcp?region=eu-gcp&token=vg_q'),
      'vg_q'
    );
    assert.equal(
      resolveHostedWorkspaceSecret(undefined, {
        requestUrl: '/mcp?token=vg_q&region=eu-gcp',
      }),
      'vg_q'
    );
  });

  it('reads secret from /t/<base64url>/mcp path', async () => {
    const { encodePathSecret } = await import('../dist/connector-url.js');
    const encoded = encodePathSecret('vg_path');
    assert.equal(
      resolveHostedWorkspaceSecret(undefined, {
        requestUrl: `/t/${encoded}/mcp?region=eu-gcp`,
      }),
      'vg_path'
    );
  });

  it('accepts x-api-key', () => {
    assert.equal(
      resolveHostedWorkspaceSecret(undefined, {
        apiKeyHeader: 'vg_key',
      }),
      'vg_key'
    );
  });
});
