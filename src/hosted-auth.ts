/**
 * Extract workspace secret from Authorization Bearer, allowlisted alt headers,
 * or connector URL query (Claude custom connectors cannot embed headers in install links).
 *
 * Query keys (first match wins): token | workspaceSecret | secret | apiKey
 */

const QUERY_SECRET_KEYS = ['token', 'workspaceSecret', 'secret', 'apiKey'] as const;

export function extractBearerToken(
  authorizationHeader: string | string[] | undefined
): string | null {
  const raw = Array.isArray(authorizationHeader)
    ? authorizationHeader[0]
    : authorizationHeader;
  if (!raw || typeof raw !== 'string') {
    return null;
  }
  const match = raw.match(/^Bearer\s+(.+)$/i);
  const token = match?.[1]?.trim();
  return token && token.length > 0 ? token : null;
}

function headerValue(
  header: string | string[] | undefined
): string | null {
  const raw = Array.isArray(header) ? header[0] : header;
  const value = raw?.trim();
  return value && value.length > 0 ? value : null;
}

/** Pull secret from ?token= / ?workspaceSecret= / etc. on the request URL. */
export function extractQuerySecret(
  requestUrl: string | undefined,
  hostHeader?: string
): string | null {
  if (!requestUrl) return null;
  try {
    const url = new URL(requestUrl, `http://${hostHeader || 'localhost'}`);
    for (const key of QUERY_SECRET_KEYS) {
      const value = url.searchParams.get(key)?.trim();
      if (value) return value;
    }
  } catch {
    return null;
  }
  return null;
}

/**
 * Resolve workspace secret for a hosted MCP request.
 * Prefer Authorization: Bearer (Cursor). Fall back to x-api-key / x-auth-token
 * (Claude request-header allowlist), then URL query token (Claude install links).
 */
export function resolveHostedWorkspaceSecret(
  authorizationHeader: string | string[] | undefined,
  options?: {
    requestUrl?: string;
    hostHeader?: string;
    apiKeyHeader?: string | string[];
    authTokenHeader?: string | string[];
  }
): string | null {
  const bearer = extractBearerToken(authorizationHeader);
  if (bearer) return bearer;

  const apiKey = headerValue(options?.apiKeyHeader);
  if (apiKey) return apiKey;

  const authToken = headerValue(options?.authTokenHeader);
  if (authToken) return authToken;

  return extractQuerySecret(options?.requestUrl, options?.hostHeader);
}
