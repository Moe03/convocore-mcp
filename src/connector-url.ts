/**
 * Claude connector URL helpers.
 *
 * Claude's OAuth `resource` parameter typically keeps the pathname but strips
 * query credentials (?token=). Put the workspace secret in the path instead:
 *   https://mcp.convocore.ai/t/<base64url(secret)>/mcp?region=eu-gcp
 */

export type ConvocoreRegion = 'eu-gcp' | 'na-gcp';

const PATH_TOKEN_RE = /^\/t\/([^/]+)\/mcp\/?$/i;

export function encodePathSecret(secret: string): string {
  return Buffer.from(secret, 'utf8').toString('base64url');
}

export function decodePathSecret(segment: string): string | null {
  const raw = segment.trim();
  if (!raw) return null;
  try {
    const decoded = Buffer.from(raw, 'base64url').toString('utf8').trim();
    if (decoded) return decoded;
  } catch {
    // fall through
  }
  try {
    const uriDecoded = decodeURIComponent(raw).trim();
    return uriDecoded || null;
  } catch {
    return raw;
  }
}

/** Extract workspace secret from /t/<seg>/mcp pathname. */
export function extractPathSecret(pathname: string): string | null {
  const match = pathname.match(PATH_TOKEN_RE);
  if (!match) return null;
  return decodePathSecret(match[1]);
}

/** True when pathname is /mcp or /t/.../mcp */
export function isMcpPathname(pathname: string, mcpPath = '/mcp'): boolean {
  if (pathname === mcpPath || pathname === `${mcpPath}/`) return true;
  return PATH_TOKEN_RE.test(pathname);
}

export type ClaudeConnectorUrlOptions = {
  /** Workspace label — used on OAuth Connect UI when Claude keeps query params. */
  workspaceName?: string;
  /** Full display name (e.g. `Convocore Acme`) for OAuth Connect UI. */
  displayName?: string;
};

/**
 * Claude connector URL: secret in PATH (survives OAuth resource canonicalization),
 * region in query. Also keeps ?token= as a backup for non-OAuth clients.
 * Optional workspaceName / displayName query params feed OAuth Connect page titles.
 */
export function mcpUrlForClaudeConnector(
  mcpUrl: string,
  region: ConvocoreRegion,
  workspaceSecret: string,
  options?: ClaudeConnectorUrlOptions
): string {
  const url = new URL(mcpUrl);
  const encoded = encodePathSecret(workspaceSecret);
  url.pathname = `/t/${encoded}/mcp`;
  // Clear prior search, then set region (+ backup token for MCP probes that keep query)
  url.search = '';
  url.searchParams.set('region', region);
  url.searchParams.set('token', workspaceSecret);
  const workspaceName = options?.workspaceName?.trim();
  if (workspaceName) url.searchParams.set('workspaceName', workspaceName);
  const displayName = options?.displayName?.trim();
  if (displayName) url.searchParams.set('mcpName', displayName);
  return url.toString();
}

/** Parse secret + region + display hints from a full connector / OAuth resource URL. */
export function extractSecretFromConnectorUrl(resource: string | null | undefined): {
  secret?: string;
  region?: string;
  workspaceName?: string;
  displayName?: string;
} {
  if (!resource) return {};
  try {
    const url = new URL(resource);
    const fromPath = extractPathSecret(url.pathname);
    const fromQuery =
      url.searchParams.get('token')?.trim() ||
      url.searchParams.get('workspaceSecret')?.trim() ||
      url.searchParams.get('secret')?.trim() ||
      url.searchParams.get('apiKey')?.trim() ||
      undefined;
    const secret = fromPath || fromQuery || undefined;
    const region = url.searchParams.get('region')?.trim() || undefined;
    const workspaceName =
      url.searchParams.get('workspaceName')?.trim() ||
      url.searchParams.get('workspace_name')?.trim() ||
      undefined;
    const displayName =
      url.searchParams.get('mcpName')?.trim() ||
      url.searchParams.get('name')?.trim() ||
      undefined;
    return { secret, region, workspaceName, displayName };
  } catch {
    return {};
  }
}
