/**
 * Extract workspace bearer token from Authorization header or optional env fallback.
 */

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

export function resolveHostedWorkspaceSecret(
  authorizationHeader: string | string[] | undefined
): string | null {
  return extractBearerToken(authorizationHeader) ?? null;
}
