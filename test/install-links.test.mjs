import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  buildInstallLinks,
  mcpUrlWithRegion,
  normalizeRegion,
} from '../dist/install-links.js';

describe('install-links', () => {
  it('normalizes region aliases', () => {
    assert.equal(normalizeRegion('eu'), 'eu-gcp');
    assert.equal(normalizeRegion('na-gcp'), 'na-gcp');
  });

  it('bakes region into Claude connector URL', () => {
    assert.equal(
      mcpUrlWithRegion('https://mcp.convocore.ai/mcp', 'na-gcp'),
      'https://mcp.convocore.ai/mcp?region=na-gcp'
    );
  });

  it('builds Cursor deeplink with base64 remote config', () => {
    const links = buildInstallLinks({
      mcpUrl: 'https://mcp.convocore.ai/mcp',
      workspaceSecret: 'vg_test_secret',
      region: 'eu-gcp',
      name: 'ConvoCore',
    });

    assert.equal(links.cursor.oneClick, true);
    assert.match(links.cursor.deeplink, /^cursor:\/\/anysphere\.cursor-deeplink\/mcp\/install\?/);
    assert.match(links.cursor.webFallback, /^https:\/\/cursor\.com\/en\/install-mcp\?/);
    assert.equal(
      links.cursor.config.headers.Authorization,
      'Bearer vg_test_secret'
    );
    assert.equal(links.cursor.config.headers['X-ConvoCore-Region'], 'eu-gcp');

    const configParam = new URL(links.cursor.deeplink).searchParams.get('config');
    assert.ok(configParam);
    const decoded = JSON.parse(Buffer.from(configParam, 'base64').toString('utf8'));
    assert.equal(decoded.url, 'https://mcp.convocore.ai/mcp');
    assert.equal(decoded.headers.Authorization, 'Bearer vg_test_secret');
  });

  it('builds Claude install URL with region query and auth header hint', () => {
    const links = buildInstallLinks({
      mcpUrl: 'https://mcp.convocore.ai/mcp',
      workspaceSecret: 'vg_test_secret',
      region: 'na',
    });

    assert.equal(links.claude.oneClick, false);
    assert.equal(links.claude.requiresAuthHeader, true);
    assert.equal(
      links.claude.connectorUrl,
      'https://mcp.convocore.ai/mcp?region=na-gcp'
    );
    assert.match(
      links.claude.installUrl,
      /^https:\/\/claude\.ai\/customize\/connectors\?/
    );
    const u = new URL(links.claude.installUrl);
    assert.equal(u.searchParams.get('modal'), 'add-custom-connector');
    assert.equal(u.searchParams.get('connectorName'), 'ConvoCore');
    assert.equal(
      u.searchParams.get('connectorUrl'),
      'https://mcp.convocore.ai/mcp?region=na-gcp'
    );
    assert.equal(links.claude.requestHeaders[0].name, 'authorization');
    assert.equal(links.claude.requestHeaders[0].value, 'Bearer vg_test_secret');
  });
});
