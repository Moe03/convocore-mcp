/**
 * One-click / assisted install URL builders for Cursor + Claude.
 *
 * Cursor: real deeplink with remote URL + Authorization + region headers in base64 config.
 * Claude: official prefilled custom-connector modal (name + URL only). Headers are not
 * supported on the install link — region is baked into the connector URL as ?region=.
 */

export type ConvoCoreRegion = 'eu-gcp' | 'na-gcp';

export type InstallLinksInput = {
  /** Hosted MCP endpoint, e.g. https://mcp.convocore.ai/mcp */
  mcpUrl: string;
  workspaceSecret: string;
  region: ConvoCoreRegion | 'eu' | 'na';
  /** Display name in Cursor / Claude (default: ConvoCore) */
  name?: string;
};

export type CursorRemoteMcpConfig = {
  url: string;
  headers: {
    Authorization: string;
    'X-ConvoCore-Region': ConvoCoreRegion;
  };
};

export type InstallLinksResult = {
  name: string;
  region: ConvoCoreRegion;
  mcpUrl: string;
  /** Connector URL for Claude (includes ?region=) */
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
    /** Prefills Add custom connector (user must confirm; then add Authorization header) */
    installUrl: string;
    adminInstallUrl: string;
    connectorUrl: string;
    /** Values to paste into Claude Request headers (beta allowlist) */
    requestHeaders: Array<{ name: string; value: string; required: boolean }>;
    oneClick: false;
    requiresUserConfirm: true;
    requiresAuthHeader: true;
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

const DEFAULT_NAME = 'ConvoCore';

export function normalizeRegion(
  region: ConvoCoreRegion | 'eu' | 'na' | string
): ConvoCoreRegion {
  const value = region.trim().toLowerCase();
  if (value === 'eu' || value === 'eu-gcp') return 'eu-gcp';
  if (value === 'na' || value === 'na-gcp') return 'na-gcp';
  throw new Error(`Invalid region "${region}". Use eu-gcp or na-gcp.`);
}

/** Append or replace ?region= on the MCP URL (for Claude + optional hosted query auth path). */
export function mcpUrlWithRegion(mcpUrl: string, region: ConvoCoreRegion): string {
  const url = new URL(mcpUrl);
  url.searchParams.set('region', region);
  return url.toString();
}

export function buildCursorRemoteConfig(input: {
  mcpUrl: string;
  workspaceSecret: string;
  region: ConvoCoreRegion;
}): CursorRemoteMcpConfig {
  return {
    url: input.mcpUrl,
    headers: {
      Authorization: `Bearer ${input.workspaceSecret}`,
      'X-ConvoCore-Region': input.region,
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
  region: ConvoCoreRegion;
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
          'X-ConvoCore-Region: ${CONVOCORE_API_REGION}',
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
  const name = (input.name?.trim() || DEFAULT_NAME).slice(0, 64);
  const region = normalizeRegion(input.region);
  const mcpUrl = input.mcpUrl.trim();
  if (!mcpUrl) throw new Error('mcpUrl is required');
  const secret = input.workspaceSecret.trim();
  if (!secret) throw new Error('workspaceSecret is required');

  // Validate URL early
  void new URL(mcpUrl);

  const cursorConfig = buildCursorRemoteConfig({
    mcpUrl,
    workspaceSecret: secret,
    region,
  });
  const claudeConnectorUrl = mcpUrlWithRegion(mcpUrl, region);

  return {
    name,
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
          required: true,
        },
      ],
      oneClick: false,
      requiresUserConfirm: true,
      requiresAuthHeader: true,
      steps: [
        'Open the Claude install URL (signs in if needed).',
        'Confirm the prefilled ConvoCore connector name and URL.',
        'In Request headers (beta), add authorization = Bearer <workspace secret>.',
        'Region is already in the connector URL (?region=); no X-ConvoCore-Region header needed.',
        'After confirm, the connector appears in Claude Desktop / web as a remote connector.',
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
