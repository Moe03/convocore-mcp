import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { pickForwardedApiHeaders } from '../dist/forwarded-api-headers.js';

describe('pickForwardedApiHeaders', () => {
  it('copies only the Wizard passport + workspace id', () => {
    const headers = pickForwardedApiHeaders({
      headers: {
        authorization: 'Bearer vg_should_not_copy',
        'x-vg-ai-wizard': 'v1.1.abc',
        'x-vg-workspace-id': 'uid_1',
        'x-convocore-region': 'eu-gcp',
        'x-evil': '1',
      },
    });
    assert.deepEqual(headers, {
      'X-VG-Ai-Wizard': 'v1.1.abc',
      'X-VG-Workspace-Id': 'uid_1',
    });
  });

  it('returns empty when Cursor-style headers have no passport', () => {
    assert.deepEqual(
      pickForwardedApiHeaders({
        headers: {
          authorization: 'Bearer vg_secret',
          'x-convocore-region': 'na-gcp',
        },
      }),
      {}
    );
  });
});
