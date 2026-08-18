/**
 * One-click / assisted install URL builders for Cursor + Claude.
 *
 * Cursor: real deeplink with remote URL + Authorization + region headers in base64 config.
 * Claude: connector URL uses /t/<base64url(secret)>/mcp?region=… so OAuth `resource`
 * still carries the secret after Claude strips query credentials.
 */

import {
  mcpUrlForClaudeConnector,
  type ConvocoreRegion,
} from './connector-url.js';
import { formatMcpDisplayName } from './mcp-display-name.js';

export type { ConvocoreRegion };
export { mcpUrlForClaudeConnector };
export { formatMcpDisplayName } from './mcp-display-name.js';

export type InstallLinksInput = {
  /** Hosted MCP endpoint, e.g. https://mcp.convocore.ai/mcp */
  mcpUrl: string;
  workspaceSecret: string;
  region: ConvocoreRegion | 'eu' | 'na';
  /**
   * Full display-name override for Cursor / Claude / ChatGPT connectors.
   * Prefer `workspaceName` so hosts show `Convocore {workspaceName}`.
   */
  name?: string;
  /** Workspace label — used to build `Convocore {workspaceName}` when `name` is omitted. */
  workspaceName?: string;
};

export type CursorRemoteMcpConfig = {
  url: string;
  headers: {
    Authorization: string;
    'X-Convocore-Region': ConvocoreRegion;
  };
};

export type InstallLinksResult = {
  /** Display name shown in Claude / Cursor / ChatGPT (e.g. `Convocore Acme`) */
  name: string;
  /** Workspace label used to derive `name` when present */
  workspaceName?: string;
  region: ConvocoreRegion;
  mcpUrl: string;
  /** Connector URL for Claude (/t/<secret>/mcp?region=…&token=…) */
  claudeConnectorUrl: string;
  cursor: {
    /** True one-click: opens Cursor install dialog with auth + region embedded */
    deeplink: string;
    /** HTTPS bridge used by Cursor's "Copy web link" tooling */
    webFallback: string;
    config: CursorRemoteMcpConfig;
    oneClick: true;
  };
  claude: {
    /** Prefills Add custom connector (user confirms; secret is already in connector URL) */
    installUrl: string;
    adminInstallUrl: string;
    connectorUrl: string;
    /**
     * Optional Request headers if the UI exposes them. Prefer URL ?token= for Claude
     * because many accounts still hit OAuth when headers are missing.
     */
    requestHeaders: Array<{ name: string; value: string; required: boolean }>;
    oneClick: false;
    requiresUserConfirm: true;
    /** Secret is embedded in connectorUrl as ?token= */
    authInConnectorUrl: true;
    requiresAuthHeader: false;
    steps: string[];
  };
  /** Local Claude Desktop / mcp-remote JSON — not installable from a browser click */
  claudeDesktop: {
    mcpServers: Record<
      string,
      {
        command: string;
        args: string[];
        env: Record<string, string>;
      }
    >;
  };
};

export function normalizeRegion(
  region: ConvocoreRegion | 'eu' | 'na' | string
): ConvocoreRegion {
  const value = region.trim().toLowerCase();
  if (value === 'eu' || value === 'eu-gcp') return 'eu-gcp';
  if (value === 'na' || value === 'na-gcp') return 'na-gcp';
  throw new Error(`Invalid region "${region}". Use eu-gcp or na-gcp.`);
}

/** Append or replace ?region= on the MCP URL. */
export function mcpUrlWithRegion(mcpUrl: string, region: ConvocoreRegion): string {
  const url = new URL(mcpUrl);
  url.searchParams.set('region', region);
  return url.toString();
}

export function buildCursorRemoteConfig(input: {
  mcpUrl: string;
  workspaceSecret: string;
  region: ConvocoreRegion;
}): CursorRemoteMcpConfig {
  return {
    url: input.mcpUrl,
    headers: {
      Authorization: `Bearer ${input.workspaceSecret}`,
      'X-Convocore-Region': input.region,
    },
  };
}

function encodeConfigBase64(config: unknown): string {
  return Buffer.from(JSON.stringify(config), 'utf8').toString('base64');
}

export function buildCursorDeeplink(name: string, config: CursorRemoteMcpConfig): string {
  const encoded = encodeURIComponent(encodeConfigBase64(config));
  return `cursor://anysphere.cursor-deeplink/mcp/install?name=${encodeURIComponent(name)}&config=${encoded}`;
}

export function buildCursorWebFallback(name: string, config: CursorRemoteMcpConfig): string {
  const encoded = encodeURIComponent(encodeConfigBase64(config));
  return `https://cursor.com/en/install-mcp?name=${encodeURIComponent(name)}&config=${encoded}`;
}

export function buildClaudeInstallUrl(name: string, connectorUrl: string): string {
  const params = new URLSearchParams({
    modal: 'add-custom-connector',
    connectorName: name,
    connectorUrl,
  });
  return `https://claude.ai/customize/connectors?${params.toString()}`;
}

export function buildClaudeAdminInstallUrl(name: string, connectorUrl: string): string {
  const params = new URLSearchParams({
    modal: 'add-custom-connector',
    connectorName: name,
    connectorUrl,
  });
  return `https://claude.ai/admin-settings/connectors?${params.toString()}`;
}

export function buildClaudeDesktopRemoteConfig(input: {
  name: string;
  mcpUrl: string;
  workspaceSecret: string;
  region: ConvocoreRegion;
}): InstallLinksResult['claudeDesktop'] {
  // mcp-remote interpolates ${ENV} inside --header values from the env block.
  return {
    mcpServers: {
      [input.name]: {
        command: 'npx',
        args: [
          '-y',
          'mcp-remote',
          input.mcpUrl,
          '--header',
          'Authorization: Bearer ${WORKSPACE_SECRET}',
          '--header',
          'X-Convocore-Region: ${CONVOCORE_API_REGION}',
        ],
        env: {
          WORKSPACE_SECRET: input.workspaceSecret,
          CONVOCORE_API_REGION: input.region,
        },
      },
    },
  };
}

export function buildInstallLinks(input: InstallLinksInput): InstallLinksResult {
  const workspaceName = input.workspaceName?.trim() || undefined;
  const name = formatMcpDisplayName({
    name: input.name,
    workspaceName,
  });
  const region = normalizeRegion(input.region);
  const mcpUrl = input.mcpUrl.trim();
  if (!mcpUrl) throw new Error('mcpUrl is required');
  const secret = input.workspaceSecret.trim();
  if (!secret) throw new Error('workspaceSecret is required');

  void new URL(mcpUrl);

  const cursorConfig = buildCursorRemoteConfig({
    mcpUrl,
    workspaceSecret: secret,
    region,
  });
  const claudeConnectorUrl = mcpUrlForClaudeConnector(mcpUrl, region, secret, {
    workspaceName,
    displayName: name,
  });

  return {
    name,
    workspaceName,
    region,
    mcpUrl,
    claudeConnectorUrl,
    cursor: {
      deeplink: buildCursorDeeplink(name, cursorConfig),
      webFallback: buildCursorWebFallback(name, cursorConfig),
      config: cursorConfig,
      oneClick: true,
    },
    claude: {
      installUrl: buildClaudeInstallUrl(name, claudeConnectorUrl),
      adminInstallUrl: buildClaudeAdminInstallUrl(name, claudeConnectorUrl),
      connectorUrl: claudeConnectorUrl,
      requestHeaders: [
        {
          name: 'authorization',
          value: `Bearer ${secret}`,
          required: false,
        },
      ],
      oneClick: false,
      requiresUserConfirm: true,
      authInConnectorUrl: true,
      requiresAuthHeader: false,
      steps: [
        'Open the Claude install URL (sign in if needed).',
        `Confirm the prefilled name "${name}" and URL (secret is in the path /t/…/mcp).`,
        'Leave OAuth Client ID / Client Secret EMPTY — Claude auto-registers (DCR).',
        'If a Convocore page opens, click Connect once — no secret paste (already in the URL).',
        'Connection tokens last ~10 years (with refresh).',
      ],
    },
    claudeDesktop: buildClaudeDesktopRemoteConfig({
      name,
      mcpUrl,
      workspaceSecret: secret,
      region,
    }),
  };
}
