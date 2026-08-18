import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { encodePathSecret } from '../dist/connector-url.js';
import {
  buildInstallLinks,
  formatMcpDisplayName,
  mcpUrlForClaudeConnector,
  mcpUrlWithRegion,
  normalizeRegion,
} from '../dist/install-links.js';

describe('install-links', () => {
  it('normalizes region aliases', () => {
    assert.equal(normalizeRegion('eu'), 'eu-gcp');
    assert.equal(normalizeRegion('na-gcp'), 'na-gcp');
  });

  it('bakes region into helper URL', () => {
    assert.equal(
      mcpUrlWithRegion('https://mcp.convocore.ai/mcp', 'na-gcp'),
      'https://mcp.convocore.ai/mcp?region=na-gcp'
    );
  });

  it('formats Convocore {workspaceName} display names', () => {
    assert.equal(formatMcpDisplayName({}), 'Convocore');
    assert.equal(
      formatMcpDisplayName({ workspaceName: 'Acme Agency' }),
      'Convocore Acme Agency'
    );
    assert.equal(
      formatMcpDisplayName({ name: 'Custom Name', workspaceName: 'Ignored' }),
      'Custom Name'
    );
  });

  it('puts secret in PATH for Claude connector URL', () => {
    const url = mcpUrlForClaudeConnector(
      'https://mcp.convocore.ai/mcp',
      'eu-gcp',
      'vg_test_secret',
      { workspaceName: 'Acme', displayName: 'Convocore Acme' }
    );
    const parsed = new URL(url);
    const encoded = encodePathSecret('vg_test_secret');
    assert.equal(parsed.pathname, `/t/${encoded}/mcp`);
    assert.equal(parsed.searchParams.get('region'), 'eu-gcp');
    assert.equal(parsed.searchParams.get('token'), 'vg_test_secret');
    assert.equal(parsed.searchParams.get('workspaceName'), 'Acme');
    assert.equal(parsed.searchParams.get('mcpName'), 'Convocore Acme');
  });

  it('builds Cursor deeplink with base64 remote config', () => {
    const links = buildInstallLinks({
      mcpUrl: 'https://mcp.convocore.ai/mcp',
      workspaceSecret: 'vg_test_secret',
      region: 'eu-gcp',
      workspaceName: 'Acme',
    });

    assert.equal(links.name, 'Convocore Acme');
    assert.equal(links.cursor.oneClick, true);
    assert.match(links.cursor.deeplink, /^cursor:\/\/anysphere\.cursor-deeplink\/mcp\/install\?/);
    const deeplink = new URL(links.cursor.deeplink);
    assert.equal(deeplink.searchParams.get('name'), 'Convocore Acme');
    const configParam = deeplink.searchParams.get('config');
    assert.ok(configParam);
    const decoded = JSON.parse(Buffer.from(configParam, 'base64').toString('utf8'));
    assert.equal(decoded.url, 'https://mcp.convocore.ai/mcp');
    assert.equal(decoded.headers.Authorization, 'Bearer vg_test_secret');
  });

  it('builds Claude install URL with path secret and workspace display name', () => {
    const links = buildInstallLinks({
      mcpUrl: 'https://mcp.convocore.ai/mcp',
      workspaceSecret: 'vg_test_secret',
      region: 'na',
      workspaceName: 'Northwind',
    });

    assert.equal(links.claude.authInConnectorUrl, true);
    assert.equal(links.name, 'Convocore Northwind');
    const encoded = encodePathSecret('vg_test_secret');
    assert.equal(
      links.claude.connectorUrl,
      `https://mcp.convocore.ai/t/${encoded}/mcp?region=na-gcp&token=vg_test_secret&workspaceName=Northwind&mcpName=Convocore+Northwind`
    );
    const u = new URL(links.claude.installUrl);
    assert.equal(u.searchParams.get('connectorName'), 'Convocore Northwind');
    assert.equal(u.searchParams.get('connectorUrl'), links.claude.connectorUrl);
  });
});
