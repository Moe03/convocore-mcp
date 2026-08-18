/**
 * Human-facing MCP / connector display names for Claude, Cursor, ChatGPT, etc.
 * Pattern: "Convocore {workspaceName}" (falls back to "Convocore").
 */

export const MCP_DISPLAY_NAME_PREFIX = 'Convocore';
export const MCP_DISPLAY_NAME_MAX_LEN = 64;

/** Sanitize a workspace label for use in connector / install names. */
export function sanitizeWorkspaceName(workspaceName: string | null | undefined): string | undefined {
  if (typeof workspaceName !== 'string') return undefined;
  const cleaned = workspaceName
    .replace(/[\r\n\t]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return cleaned.length > 0 ? cleaned : undefined;
}

/**
 * Build the display name shown in Claude connectors, Cursor install, OAuth pages, etc.
 * Explicit `name` overrides win; otherwise `Convocore {workspaceName}` or `Convocore`.
 */
export function formatMcpDisplayName(input?: {
  name?: string | null;
  workspaceName?: string | null;
}): string {
  const explicit = typeof input?.name === 'string' ? input.name.trim() : '';
  if (explicit) return explicit.slice(0, MCP_DISPLAY_NAME_MAX_LEN);

  const workspace = sanitizeWorkspaceName(input?.workspaceName);
  const composed = workspace
    ? `${MCP_DISPLAY_NAME_PREFIX} ${workspace}`
    : MCP_DISPLAY_NAME_PREFIX;
  return composed.slice(0, MCP_DISPLAY_NAME_MAX_LEN);
}

/** Pull a workspace name out of common Convocore workspace API shapes. */
export function extractWorkspaceNameFromPayload(payload: unknown): string | undefined {
  if (!payload || typeof payload !== 'object') return undefined;
  const root = payload as Record<string, unknown>;
  const candidates: unknown[] = [
    root.workspaceName,
    root.name,
    root.title,
    root.workspace_name,
  ];

  const data = root.data;
  if (data && typeof data === 'object' && !Array.isArray(data)) {
    const d = data as Record<string, unknown>;
    candidates.push(d.workspaceName, d.name, d.title, d.workspace_name);
  }

  if (Array.isArray(data) && data.length > 0 && data[0] && typeof data[0] === 'object') {
    const first = data[0] as Record<string, unknown>;
    candidates.push(first.workspaceName, first.name, first.title, first.workspace_name);
  }

  if (Array.isArray(root.workspaces) && root.workspaces[0] && typeof root.workspaces[0] === 'object') {
    const first = root.workspaces[0] as Record<string, unknown>;
    candidates.push(first.workspaceName, first.name, first.title, first.workspace_name);
  }

  for (const c of candidates) {
    const sanitized = sanitizeWorkspaceName(typeof c === 'string' ? c : undefined);
    if (sanitized) return sanitized;
  }
  return undefined;
}
