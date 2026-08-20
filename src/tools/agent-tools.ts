import type { Tool } from '@modelcontextprotocol/sdk/types.js';
import { z } from 'zod';
import { getActiveClient } from '../request-context.js';
import { type ToolModule, wrapHandler } from './helpers.js';

const AgentToolBody = z
  .object({
    name: z.string().optional(),
    description: z.string().optional(),
    method: z.enum(['GET', 'POST', 'PUT', 'PATCH']).optional(),
    serverUrl: z.string().optional(),
    serverUrlSecret: z.string().optional(),
    disabled: z.boolean().optional(),
    isDefault: z.boolean().optional(),
    isGlobal: z.boolean().optional(),
    isVapiTool: z.boolean().optional(),
    vapiId: z.string().optional(),
    toolsSettings: z.unknown().optional(),
    fields: z.array(z.record(z.unknown())).optional(),
    channels: z.array(z.string()).optional(),
  })
  .passthrough();

const ListSchema = z.object({ agentId: z.string() });
const GetSchema = z.object({ toolId: z.string() });
const CreateSchema = z.object({
  agentId: z.string(),
  tool: AgentToolBody,
});
const UpdateSchema = z.object({
  toolId: z.string(),
  tool: AgentToolBody,
});
const DeleteSchema = z.object({ toolId: z.string() });

const tools: Tool[] = [
  {
    name: 'list_agent_tools',
    description:
      'List HTTP/API tools attached to a Convocore agent (serverUrl integrations). These are NOT MCP tools. For MCP catalog discovery use search_mcp_tools. To test a tool use test_agent_tool or test_agent_tool_request.',
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
    name: 'get_agent_tool',
    description:
      'Get one Convocore agent HTTP tool by toolId (includes fields, serverUrl, method). Does not call the remote URL — use test_agent_tool_request for that.',
    annotations: {
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: true,
    },
    inputSchema: {
      type: 'object',
      properties: { toolId: { type: 'string' } },
      required: ['toolId'],
    },
  },
  {
    name: 'create_agent_tool',
    description:
      'Add an HTTP/API tool to a Convocore agent. Requires tool.name + tool.description; typically set method, serverUrl, and fields[]. After create, prefer test_agent_tool_request before relying on it in chat.',
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
        tool: {
          type: 'object',
          description:
            'Tool definition: name, description, method, serverUrl, serverUrlSecret, fields[], channels[], etc.',
        },
      },
      required: ['agentId', 'tool'],
    },
  },
  {
    name: 'update_agent_tool',
    description:
      'Patch an existing Convocore agent HTTP tool by toolId. Pass only fields to change inside tool{}.',
    annotations: {
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: true,
    },
    inputSchema: {
      type: 'object',
      properties: {
        toolId: { type: 'string' },
        tool: { type: 'object' },
      },
      required: ['toolId', 'tool'],
    },
  },
  {
    name: 'delete_agent_tool',
    description:
      'Permanently delete a Convocore agent HTTP tool by toolId. Does not delete MCP tools.',
    annotations: {
      readOnlyHint: false,
      destructiveHint: true,
      idempotentHint: true,
      openWorldHint: true,
    },
    inputSchema: {
      type: 'object',
      properties: { toolId: { type: 'string' } },
      required: ['toolId'],
    },
  },
];

export const agentToolsModule: ToolModule = {
  tools,
  handlers: {
    list_agent_tools: wrapHandler('list_agent_tools', async (args) => {
      const v = ListSchema.parse(args);
      return getActiveClient().listAgentTools(v.agentId);
    }),
    get_agent_tool: wrapHandler('get_agent_tool', async (args) => {
      const v = GetSchema.parse(args);
      return getActiveClient().getAgentTool(v.toolId);
    }),
    create_agent_tool: wrapHandler('create_agent_tool', async (args) => {
      const v = CreateSchema.parse(args);
      return getActiveClient().createAgentTool(v.agentId, v.tool);
    }),
    update_agent_tool: wrapHandler('update_agent_tool', async (args) => {
      const v = UpdateSchema.parse(args);
      return getActiveClient().updateAgentTool(v.toolId, v.tool);
    }),
    delete_agent_tool: wrapHandler('delete_agent_tool', async (args) => {
      const v = DeleteSchema.parse(args);
      return getActiveClient().deleteAgentTool(v.toolId);
    }),
  },
};
