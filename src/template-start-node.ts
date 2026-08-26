import { DEFAULT_TEMPLATE_NODE_TOOL_IDS, mergeNodeToolsIds } from './builtin-system-tools.js';

/** Default chat model for every new agent. */
export const RECOMMENDED_CHAT_MODEL_ID = 'deepseek-ai/DeepSeek-V4-Flash';
/** Fallback if DeepSeek V4 Flash underperforms or is unavailable — GPT-5.6 Luna. */
export const FALLBACK_CHAT_MODEL_ID = 'gpt-5.6-luna';

const LEGACY_CHAT_MODEL_IDS = new Set([
  'gpt-4o',
  'gpt-4o-mini',
  'gpt-4.1',
  'gpt-4.1-mini',
  'gpt-4.1-mini-2025-04-14',
  'gpt-4.1-2025-04-14',
  'zai-org/GLM-5',
  'glm-5',
]);

export function isLegacyChatModelId(modelId: string | undefined): boolean {
  if (!modelId) return true;
  const id = modelId.trim().toLowerCase();
  if (!id) return true;
  if (LEGACY_CHAT_MODEL_IDS.has(id) || LEGACY_CHAT_MODEL_IDS.has(modelId.trim())) return true;
  return id.includes('gpt-4o') || id.includes('glm-4') || id.includes('glm-5');
}

/** OpenAPI nodes[].kb — enables automatic KB retrieval on the start node. */
export const DEFAULT_NODE_KB_CONFIG = {
  enabled: true,
  maxChunks: 8,
  maxQueries: 3,
  smartSearch: true,
  searchOnStart: true,
} as const;

export const TEMPLATE_START_NODE_DEFAULTS = {
  id: '__start__',
  type: 'start',
  name: 'Start',
  description: 'Start node',
  instructions: '',
  llmConfig: {
    modelId: RECOMMENDED_CHAT_MODEL_ID,
    temperature: 0.5,
    maxTokens: 2024,
  },
  kb: { ...DEFAULT_NODE_KB_CONFIG },
  /** Built-in Convocore system tools (e.g. web-search) — not HTTP create_agent_tool. */
  toolsIds: [...DEFAULT_TEMPLATE_NODE_TOOL_IDS] as string[],
} as const;

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function isStartNodeCandidate(node: unknown): boolean {
  if (!isPlainRecord(node)) return false;

  if (node.type === 'start') return true;
  if (node.id === TEMPLATE_START_NODE_DEFAULTS.id) return true;
  return typeof node.name === 'string' && node.name.trim().toLowerCase() === 'start';
}

export function normalizeTemplateStartNodeArray(
  input: unknown
): {
  nodes: unknown[];
  startNodeIndex: number;
  createdStartNode: boolean;
  patchedFields: string[];
} {
  const nodes = Array.isArray(input) ? [...input] : [];
  const startNodeIndex = nodes.findIndex(isStartNodeCandidate);
  const patchedFields: string[] = [];

  if (startNodeIndex === -1) {
    return {
      nodes: [
        {
          ...TEMPLATE_START_NODE_DEFAULTS,
          llmConfig: { ...TEMPLATE_START_NODE_DEFAULTS.llmConfig },
          kb: { ...TEMPLATE_START_NODE_DEFAULTS.kb },
          toolsIds: [...TEMPLATE_START_NODE_DEFAULTS.toolsIds],
        },
        ...nodes,
      ],
      startNodeIndex: 0,
      createdStartNode: true,
      patchedFields: [
        'id',
        'type',
        'name',
        'description',
        'instructions',
        'llmConfig.modelId',
        'llmConfig.temperature',
        'llmConfig.maxTokens',
        'kb.enabled',
        'kb.maxChunks',
        'toolsIds',
      ],
    };
  }

  const rawNode = nodes[startNodeIndex];
  const startNode = isPlainRecord(rawNode) ? { ...rawNode } : {};

  if (!isNonEmptyString(startNode.id)) {
    startNode.id = TEMPLATE_START_NODE_DEFAULTS.id;
    patchedFields.push('id');
  }

  if (startNode.type !== 'start') {
    startNode.type = 'start';
    patchedFields.push('type');
  }

  if (!isNonEmptyString(startNode.name)) {
    startNode.name = TEMPLATE_START_NODE_DEFAULTS.name;
    patchedFields.push('name');
  }

  if (!isNonEmptyString(startNode.description)) {
    startNode.description = TEMPLATE_START_NODE_DEFAULTS.description;
    patchedFields.push('description');
  }

  if (typeof startNode.instructions !== 'string') {
    startNode.instructions = TEMPLATE_START_NODE_DEFAULTS.instructions;
    patchedFields.push('instructions');
  }

  const llmConfig = isPlainRecord(startNode.llmConfig) ? { ...startNode.llmConfig } : {};
  if (!isPlainRecord(startNode.llmConfig)) {
    patchedFields.push('llmConfig');
  }

  if (!isNonEmptyString(llmConfig.modelId)) {
    llmConfig.modelId = TEMPLATE_START_NODE_DEFAULTS.llmConfig.modelId;
    patchedFields.push('llmConfig.modelId');
  }

  if (!isFiniteNumber(llmConfig.temperature)) {
    llmConfig.temperature = TEMPLATE_START_NODE_DEFAULTS.llmConfig.temperature;
    patchedFields.push('llmConfig.temperature');
  }

  if (!isFiniteNumber(llmConfig.maxTokens)) {
    llmConfig.maxTokens = TEMPLATE_START_NODE_DEFAULTS.llmConfig.maxTokens;
    patchedFields.push('llmConfig.maxTokens');
  }

  startNode.llmConfig = llmConfig;

  const kb = isPlainRecord(startNode.kb) ? { ...startNode.kb } : {};
  if (!isPlainRecord(startNode.kb)) {
    patchedFields.push('kb');
  }
  if (typeof kb.enabled !== 'boolean') {
    kb.enabled = DEFAULT_NODE_KB_CONFIG.enabled;
    patchedFields.push('kb.enabled');
  }
  if (!isFiniteNumber(kb.maxChunks)) {
    kb.maxChunks = DEFAULT_NODE_KB_CONFIG.maxChunks;
    patchedFields.push('kb.maxChunks');
  }
  if (!isFiniteNumber(kb.maxQueries)) {
    kb.maxQueries = DEFAULT_NODE_KB_CONFIG.maxQueries;
    patchedFields.push('kb.maxQueries');
  }
  if (typeof kb.smartSearch !== 'boolean') {
    kb.smartSearch = DEFAULT_NODE_KB_CONFIG.smartSearch;
    patchedFields.push('kb.smartSearch');
  }
  if (typeof kb.searchOnStart !== 'boolean') {
    kb.searchOnStart = DEFAULT_NODE_KB_CONFIG.searchOnStart;
    patchedFields.push('kb.searchOnStart');
  }
  startNode.kb = kb;

  const beforeTools = Array.isArray(startNode.toolsIds) ? [...(startNode.toolsIds as unknown[])] : [];
  const mergedTools = mergeNodeToolsIds(startNode.toolsIds, DEFAULT_TEMPLATE_NODE_TOOL_IDS);
  if (JSON.stringify(beforeTools) !== JSON.stringify(mergedTools)) {
    patchedFields.push('toolsIds');
  }
  startNode.toolsIds = mergedTools;

  nodes[startNodeIndex] = startNode;

  return {
    nodes,
    startNodeIndex,
    createdStartNode: false,
    patchedFields,
  };
}
