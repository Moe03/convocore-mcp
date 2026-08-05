/**
 * Claude connector URL helpers.
 *
 * Claude's OAuth `resource` parameter typically keeps the pathname but strips
 * query credentials (?token=). Put the workspace secret in the path instead:
 *   https://mcp.convocore.ai/t/<base64url(secret)>/mcp?region=eu-gcp
 */

export type ConvoCoreRegion = 'eu-gcp' | 'na-gcp';

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

/**
 * Claude connector URL: secret in PATH (survives OAuth resource canonicalization),
 * region in query. Also keeps ?token= as a backup for non-OAuth clients.
 */
export function mcpUrlForClaudeConnector(
  mcpUrl: string,
  region: ConvoCoreRegion,
  workspaceSecret: string
): string {
  const url = new URL(mcpUrl);
  const encoded = encodePathSecret(workspaceSecret);
  url.pathname = `/t/${encoded}/mcp`;
  // Clear prior search, then set region (+ backup token for MCP probes that keep query)
  url.search = '';
  url.searchParams.set('region', region);
  url.searchParams.set('token', workspaceSecret);
  return url.toString();
}

/** Parse secret + region from a full connector / OAuth resource URL. */
export function extractSecretFromConnectorUrl(resource: string | null | undefined): {
  secret?: string;
  region?: string;
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
    return { secret, region };
  } catch {
    return {};
  }
}
