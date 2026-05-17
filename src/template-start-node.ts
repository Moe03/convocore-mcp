export const TEMPLATE_START_NODE_DEFAULTS = {
  id: '__start__',
  type: 'start',
  name: 'Start',
  description: 'Start node',
  instructions: '',
  llmConfig: {
    modelId: 'gpt-4o-mini',
    temperature: 0.5,
    maxTokens: 2024,
  },
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
      nodes: [{ ...TEMPLATE_START_NODE_DEFAULTS, llmConfig: { ...TEMPLATE_START_NODE_DEFAULTS.llmConfig } }, ...nodes],
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
  nodes[startNodeIndex] = startNode;

  return {
    nodes,
    startNodeIndex,
    createdStartNode: false,
    patchedFields,
  };
}
