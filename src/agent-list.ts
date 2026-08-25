/**
 * Trim heavy agent list payloads for MCP context.
 * Full agent docs often include nodes[], prompts, voiceConfig, CSS, etc.
 */

const COMPACT_AGENT_KEYS = [
  'ID',
  'id',
  'title',
  'description',
  'theme',
  'ownerID',
  'agentPlatform',
  'disabled',
  'isDeployed',
  'enableNodes',
  'vg_enableUIEngine',
  'createdAtUNIX',
  'lastModified',
  'starred',
  'isStarred',
] as const;

export type AgentListMode = 'compact' | 'full';

function pickCompactAgent(agent: unknown): Record<string, unknown> | unknown {
  if (!agent || typeof agent !== 'object' || Array.isArray(agent)) return agent;
  const src = agent as Record<string, unknown>;
  const out: Record<string, unknown> = {};
  for (const key of COMPACT_AGENT_KEYS) {
    if (src[key] !== undefined) out[key] = src[key];
  }
  // Prefer a single id field if both exist
  if (out.ID == null && out.id != null) out.ID = out.id;
  if (typeof out.description === 'string' && out.description.length > 160) {
    out.description = `${out.description.slice(0, 157)}...`;
  }
  return out;
}

function compactAgentArray(agents: unknown[]): unknown[] {
  return agents.map(pickCompactAgent);
}

/**
 * Compact a list_agents / search-style API envelope in place (shallow copy).
 * Leaves non-agent payloads untouched.
 */
export function compactAgentsListResult(result: unknown): unknown {
  if (result == null) return result;

  if (Array.isArray(result)) {
    return compactAgentArray(result);
  }

  if (typeof result !== 'object') return result;

  const src = result as Record<string, unknown>;
  const out: Record<string, unknown> = { ...src };

  if (Array.isArray(src.data)) {
    out.data = compactAgentArray(src.data);
  }
  if (Array.isArray(src.agents)) {
    out.agents = compactAgentArray(src.agents);
  }
  if (Array.isArray(src.starredAgents)) {
    out.starredAgents = compactAgentArray(src.starredAgents);
  }

  out.mode = 'compact';
  out.note =
    'Compact list: only id/title/description/theme/flags/timestamps. Call list_agents with mode="full" (and prefer a small limit) for complete agent documents, or get_agent for one agent.';

  return out;
}

export { COMPACT_AGENT_KEYS };
