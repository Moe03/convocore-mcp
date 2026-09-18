/**
 * Safe node PATCH merge. The API replaces the nodes[] array and any node
 * fields that are present. MCP used to run create-time defaults on partial
 * updates, which set instructions to "" and wiped the live prompt.
 */

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function cloneNode(node: Record<string, unknown>): Record<string, unknown> {
  try {
    return structuredClone(node);
  } catch {
    return { ...node };
  }
}

export function startNodeIndex(nodes: Record<string, unknown>[]): number {
  const byType = nodes.findIndex((n) => n.type === 'start' || n.id === '__start__');
  return byType >= 0 ? byType : 0;
}

function looksPartialNode(node: Record<string, unknown>): boolean {
  const instructions = node.instructions;
  const hasInstructions = typeof instructions === 'string' && instructions.length > 0;
  const keys = Object.keys(node).filter((k) => node[k] !== undefined);
  if (hasInstructions && keys.length >= 4) return false;
  if (hasInstructions && (node.type === 'start' || node.id === '__start__')) return false;
  return !hasInstructions;
}

function mergeRecord(
  base: Record<string, unknown>,
  patch: Record<string, unknown>
): Record<string, unknown> {
  const out = { ...base };
  for (const [key, value] of Object.entries(patch)) {
    if (value === undefined) continue;
    if (
      key === 'instructions' &&
      value === '' &&
      typeof base.instructions === 'string' &&
      base.instructions.length > 0
    ) {
      continue;
    }
    if (isPlainRecord(value) && isPlainRecord(out[key])) {
      out[key] = { ...(out[key] as Record<string, unknown>), ...value };
    } else {
      out[key] = value;
    }
  }
  return out;
}

function asNodeList(value: unknown): Record<string, unknown>[] {
  return Array.isArray(value) ? value.filter(isPlainRecord).map(cloneNode) : [];
}

/** Merge a partial `nodes` PATCH onto the agent's current nodes (by id, else index). */
export function mergeAgentNodesForUpdate(existing: unknown, incoming: unknown): Record<string, unknown>[] {
  const current = asNodeList(existing);
  const patch = asNodeList(incoming);
  if (patch.length === 0) return current;

  if (current.length === 0) {
    const incomplete = patch.some(looksPartialNode);
    if (incomplete) {
      throw new Error(
        'Refusing to PATCH nodes: get_agent did not return the live node graph, and the incoming nodes[] is partial (missing start-node instructions). That would wipe the prompt. Retry get_agent, or set systemPrompt to the FULL prompt — never a snippet.'
      );
    }
    return patch;
  }

  const byId = new Map<string, number>();
  current.forEach((n, i) => {
    if (typeof n.id === 'string' && n.id.trim()) byId.set(n.id, i);
  });

  for (let i = 0; i < patch.length; i++) {
    const p = patch[i];
    const id = typeof p.id === 'string' && p.id.trim() ? p.id : undefined;
    let idx = id && byId.has(id) ? byId.get(id)! : -1;
    if (idx < 0 && i === 0 && current.length > 0) {
      idx = startNodeIndex(current);
    } else if (idx < 0 && i < current.length && !id) {
      idx = i;
    }
    if (idx >= 0 && idx < current.length) {
      current[idx] = mergeRecord(current[idx], p);
    } else {
      current.push(p);
      if (id) byId.set(id, current.length - 1);
    }
  }

  const prevStart = asNodeList(existing);
  if (prevStart.length > 0) {
    const prev = prevStart[startNodeIndex(prevStart)];
    const next = current[startNodeIndex(current)];
    const prevText = typeof prev?.instructions === 'string' ? prev.instructions : '';
    const nextText = typeof next?.instructions === 'string' ? next.instructions : '';
    if (prevText.length > 0 && nextText.length === 0 && next) {
      next.instructions = prevText;
    }
  }

  if (current.length < prevStart.length) {
    throw new Error(
      `Refusing to PATCH nodes: merge would drop nodes (${prevStart.length} → ${current.length}). Pass a full graph or patch by node id.`
    );
  }

  return current;
}

export function applySystemPromptToExistingNodes(
  existing: unknown,
  systemPrompt: string
): Record<string, unknown>[] {
  const nodes = asNodeList(existing);
  if (nodes.length === 0) {
    return [
      {
        id: '__start__',
        type: 'start',
        name: 'Start',
        instructions: systemPrompt,
      },
    ];
  }
  const idx = startNodeIndex(nodes);
  nodes[idx] = { ...nodes[idx], instructions: systemPrompt };
  return nodes;
}

export function readStartNodeInstructions(agent: Record<string, unknown>): {
  text: string;
  label: string;
  source: 'start' | 'vg_instructions' | 'vg_systemPrompt' | 'empty';
} {
  const nodes = asNodeList(agent.nodes);
  if (nodes.length > 0) {
    const idx = startNodeIndex(nodes);
    const text = nodes[idx]?.instructions;
    if (typeof text === 'string' && text.length > 0) {
      return {
        text,
        label: idx === 0 ? 'nodes[0].instructions' : `nodes[${idx}].instructions`,
        source: 'start',
      };
    }
  }
  if (typeof agent.vg_instructions === 'string' && agent.vg_instructions.length > 0) {
    return { text: agent.vg_instructions, label: 'vg_instructions (read fallback)', source: 'vg_instructions' };
  }
  if (typeof agent.vg_systemPrompt === 'string' && agent.vg_systemPrompt.length > 0) {
    return { text: agent.vg_systemPrompt, label: 'vg_systemPrompt (read fallback)', source: 'vg_systemPrompt' };
  }
  return { text: '', label: 'nodes[start].instructions', source: 'empty' };
}

export function writeStartNodeInstructions(
  agent: Record<string, unknown>,
  instructions: string
): Record<string, unknown>[] {
  const nodes = asNodeList(agent.nodes);
  if (nodes.length === 0) {
    return [
      {
        id: '__start__',
        type: 'start',
        name: 'Start',
        instructions,
      },
    ];
  }
  const idx = startNodeIndex(nodes);
  nodes[idx] = { ...nodes[idx], instructions };
  return nodes;
}

export function agentHasLiveNodeGraph(agent: Record<string, unknown>): boolean {
  return asNodeList(agent.nodes).length > 0;
}
