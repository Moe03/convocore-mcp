import type { Tool } from '@modelcontextprotocol/sdk/types.js';
import { z } from 'zod';
import { getActiveClient } from '../request-context.js';
import { type ToolModule, wrapHandler } from './helpers.js';

const VariableBody = z
  .object({
    key: z.string().optional(),
    description: z.string().optional(),
    type: z.enum(['string', 'number', 'boolean', 'system']).optional(),
    in: z.string().optional(),
    value: z.unknown().optional(),
    defaultValue: z.unknown().optional(),
    required: z.boolean().optional(),
    reusable: z.boolean().optional(),
    isEnv: z.boolean().optional(),
    isSystem: z.boolean().optional(),
    isGlobal: z.boolean().optional(),
  })
  .passthrough();

const ENV_VALUE_MASK = '•••••••• (hidden — environment variable)';

/**
 * Environment variables usually hold API keys. Never hand their values back to the
 * model: mask value/defaultValue on every variable flagged isEnv, at any depth.
 */
function maskEnvVariableValues<T>(payload: T): T {
  if (Array.isArray(payload)) {
    return payload.map((entry) => maskEnvVariableValues(entry)) as unknown as T;
  }
  if (!payload || typeof payload !== 'object') return payload;
  const record = payload as Record<string, unknown>;
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(record)) {
    out[key] = maskEnvVariableValues(value);
  }
  if (record.isEnv === true) {
    for (const key of ['value', 'defaultValue'] as const) {
      const current = record[key];
      if (current !== undefined && current !== null && current !== '') {
        out[key] = ENV_VALUE_MASK;
      }
    }
  }
  return out as T;
}

const ListSchema = z.object({ agentId: z.string() });
const GetSchema = z.object({ variableId: z.string() });
const CreateSchema = z.object({
  agentId: z.string(),
  variable: VariableBody,
});
const UpdateSchema = z.object({
  variableId: z.string(),
  variable: VariableBody,
});
const DeleteSchema = z.object({ variableId: z.string() });

const tools: Tool[] = [
  {
    name: 'list_agent_variables',
    description:
      'List variables on a Convocore agent (env/global/system keys used in prompts and tools). Not MCP variables. Values of environment variables (isEnv) are masked. To trial overrides in a chat turn use interact_with_agent with variablesOverrides / initNodesOptions.',
    annotations: {
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: true,
    },
    inputSchema: {
      type: 'object',
      properties: { agentId: { type: 'string' } },
      required: ['agentId'],
    },
  },
  {
    name: 'get_agent_variable',
    description: 'Get one Convocore agent variable by variableId. The value of an environment variable (isEnv) is masked.',
    annotations: {
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: true,
    },
    inputSchema: {
      type: 'object',
      properties: { variableId: { type: 'string' } },
      required: ['variableId'],
    },
  },
  {
    name: 'create_agent_variable',
    description:
      'Add a variable to a Convocore agent. Typical fields: key, type, defaultValue, description, in (body|query|header|path), required, isEnv, isGlobal. ' +
      'AI inputs: the model fills them; list their ids in a tool variablesIds. An optional input that is not filled sends its defaultValue. ' +
      'Environment variables (isEnv: true) hold fixed config/secrets: the value is stored in defaultValue, is never shown to the model, and is referenced in a tool request as {{var:VARIABLE_ID}} — do not add them to variablesIds. ' +
      'To keep a secret out of this chat, create it with a placeholder defaultValue and have the owner enter the real value in the dashboard: open the tool editor, type { in a request field (or use Variables), open the variable, keep ENV on and fill "Value". Responses mask env values.',
    annotations: {
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: false,
      openWorldHint: true,
    },
    inputSchema: {
      type: 'object',
      properties: {
        agentId: { type: 'string' },
        variable: { type: 'object' },
      },
      required: ['agentId', 'variable'],
    },
  },
  {
    name: 'update_agent_variable',
    description: 'Patch an existing Convocore agent variable by variableId. Pass only fields to change. Never send back a masked env value as defaultValue — omit it to keep the stored value.',
    annotations: {
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: true,
    },
    inputSchema: {
      type: 'object',
      properties: {
        variableId: { type: 'string' },
        variable: { type: 'object' },
      },
      required: ['variableId', 'variable'],
    },
  },
  {
    name: 'delete_agent_variable',
    description: 'Permanently delete a Convocore agent variable by variableId.',
    annotations: {
      readOnlyHint: false,
      destructiveHint: true,
      idempotentHint: true,
      openWorldHint: true,
    },
    inputSchema: {
      type: 'object',
      properties: { variableId: { type: 'string' } },
      required: ['variableId'],
    },
  },
];

export const agentVariablesModule: ToolModule = {
  tools,
  handlers: {
    list_agent_variables: wrapHandler('list_agent_variables', async (args) => {
      const v = ListSchema.parse(args);
      return maskEnvVariableValues(await getActiveClient().listAgentVariables(v.agentId));
    }),
    get_agent_variable: wrapHandler('get_agent_variable', async (args) => {
      const v = GetSchema.parse(args);
      return maskEnvVariableValues(await getActiveClient().getAgentVariable(v.variableId));
    }),
    create_agent_variable: wrapHandler('create_agent_variable', async (args) => {
      const v = CreateSchema.parse(args);
      return maskEnvVariableValues(await getActiveClient().createAgentVariable(v.agentId, v.variable));
    }),
    update_agent_variable: wrapHandler('update_agent_variable', async (args) => {
      const v = UpdateSchema.parse(args);
      for (const key of ['value', 'defaultValue'] as const) {
        if ((v.variable as Record<string, unknown>)[key] === ENV_VALUE_MASK) {
          delete (v.variable as Record<string, unknown>)[key];
        }
      }
      return maskEnvVariableValues(await getActiveClient().updateAgentVariable(v.variableId, v.variable));
    }),
    delete_agent_variable: wrapHandler('delete_agent_variable', async (args) => {
      const v = DeleteSchema.parse(args);
      return getActiveClient().deleteAgentVariable(v.variableId);
    }),
  },
};
