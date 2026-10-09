/**
 * Workspace id for workspace-scoped endpoints (crawler jobs).
 * Uses CONVOCORE_WORKSPACE_ID when set, otherwise the owner of the first agent.
 */

import type { ConvocoreClient } from './convocore-client.js';
import { getActiveClient, getActiveConfig } from './request-context.js';

const resolvedByClient = new WeakMap<ConvocoreClient, string>();

export async function resolveActiveWorkspaceId(): Promise<string> {
  const configured = getActiveConfig().workspaceId?.trim();
  if (configured) return configured;

  const client = getActiveClient();
  const cached = resolvedByClient.get(client);
  if (cached) return cached;

  const listed: any = await client.listAgents({ limit: 1 });
  const agents: any[] = Array.isArray(listed)
    ? listed
    : listed?.data?.agents || listed?.agents || (Array.isArray(listed?.data) ? listed.data : []);
  const owner = agents.map((agent) => agent?.ownerID || agent?.ownerId).find(Boolean);
  if (typeof owner !== 'string' || !owner.trim()) {
    throw new Error(
      'Could not detect the workspace id (no agents found). Set CONVOCORE_WORKSPACE_ID in the MCP config.'
    );
  }
  resolvedByClient.set(client, owner.trim());
  return owner.trim();
}
