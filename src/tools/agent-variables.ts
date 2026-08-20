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
      'List variables on a Convocore agent (env/global/system keys used in prompts and tools). Not MCP variables. To trial overrides in a chat turn use interact_with_agent with variablesOverrides / initNodesOptions.',
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
    description: 'Get one Convocore agent variable by variableId.',
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
      'Add a variable to a Convocore agent. Typical fields: key, type, defaultValue, description, isEnv, isGlobal.',
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
    description: 'Patch an existing Convocore agent variable by variableId.',
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
      return getActiveClient().listAgentVariables(v.agentId);
    }),
    get_agent_variable: wrapHandler('get_agent_variable', async (args) => {
      const v = GetSchema.parse(args);
      return getActiveClient().getAgentVariable(v.variableId);
    }),
    create_agent_variable: wrapHandler('create_agent_variable', async (args) => {
      const v = CreateSchema.parse(args);
      return getActiveClient().createAgentVariable(v.agentId, v.variable);
    }),
    update_agent_variable: wrapHandler('update_agent_variable', async (args) => {
      const v = UpdateSchema.parse(args);
      return getActiveClient().updateAgentVariable(v.variableId, v.variable);
    }),
    delete_agent_variable: wrapHandler('delete_agent_variable', async (args) => {
      const v = DeleteSchema.parse(args);
      return getActiveClient().deleteAgentVariable(v.variableId);
    }),
  },
};
