/**
 * Extract workspace secret from Authorization Bearer, allowlisted alt headers,
 * path `/t/<secret>/mcp`, or query ?token= (Claude connectors).
 */

import { extractPathSecret } from './connector-url.js';

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

/** Pull secret from /t/<base64url>/mcp path on the request URL. */
export function extractUrlPathSecret(
  requestUrl: string | undefined,
  hostHeader?: string
): string | null {
  if (!requestUrl) return null;
  try {
    const url = new URL(requestUrl, `http://${hostHeader || 'localhost'}`);
    return extractPathSecret(url.pathname);
  } catch {
    return null;
  }
}

/**
 * Resolve workspace secret for a hosted MCP request.
 * Prefer Authorization: Bearer (Cursor). Fall back to x-api-key / x-auth-token,
 * then path /t/.../mcp, then ?token= query.
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

  const pathSecret = extractUrlPathSecret(options?.requestUrl, options?.hostHeader);
  if (pathSecret) return pathSecret;

  return extractQuerySecret(options?.requestUrl, options?.hostHeader);
}
