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
  attachToStartNode: z.boolean().optional().default(true),
});

/**
 * A saved tool is only callable once its id is in a node's toolsIds. Creating it through
 * the API alone left it unattached, so the model could never call it.
 */
async function attachToolToStartNode(agentId: string, toolId: string) {
  const client = getActiveClient();
  const agentRes: any = await client.getAgent(agentId);
  const agent = (agentRes && typeof agentRes === 'object' && agentRes.data) || agentRes;
  const nodes: any[] = Array.isArray(agent?.nodes) ? agent.nodes : [];
  const startNode =
    nodes.find((node) => node?.id === '__start__' || node?.type === 'start') || nodes[0];
  if (!startNode?.id) {
    return { attached: false, reason: 'Agent has no start node to attach the tool to.' };
  }
  const current: string[] = Array.isArray(startNode.toolsIds) ? startNode.toolsIds : [];
  if (current.includes(toolId)) {
    return { attached: true, nodeId: startNode.id, toolsIds: current };
  }
  const toolsIds = [...current, toolId];
  // Only id + toolsIds: the API merges nodes by id, so instructions and the rest stay as-is.
  await client.updateAgent(agentId, {
    agent: { nodes: [{ id: startNode.id, toolsIds }] },
  } as any);
  return { attached: true, nodeId: startNode.id, toolsIds };
}
const UpdateSchema = z.object({
  toolId: z.string(),
  tool: AgentToolBody,
});
const DeleteSchema = z.object({ toolId: z.string() });

const tools: Tool[] = [
  {
    name: 'list_agent_tools',
    description:
      'List HTTP/API tools saved on a Convocore agent (serverUrl integrations). These are NOT MCP tools. A saved tool is only callable when its id is also in a node toolsIds (see get_agent). For MCP catalog discovery use search_mcp_tools. To test a tool use test_agent_tool or test_agent_tool_request.',
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
      'Add an HTTP/API tool to a Convocore agent. Requires tool.name + tool.description. ' +
      'INPUTS — either (a) tool.variablesIds: ids of existing agent variables (create_agent_variable first), or (b) tool.fields[]: each entry needs key (the argument name — NOT "name"), type (string|number|boolean), in (body|query|header|path), plus description and required. ' +
      'REQUEST — simple tools: method + serverUrl (inputs are sent by their "in" location). Exact request shape: tool.httpRequest = { enabled: true, method, url, headers, query, bodyType: "json", bodyTemplate, bodyTemplateMode: "exact" }. In bodyTemplate/headers/query/url reference a variable with {{var:VARIABLE_ID}}; a value that is only that token keeps its number/boolean type. Fixed values are written literally. ' +
      'SECRETS — store an API key as an environment variable (create_agent_variable with isEnv: true; the value lives in defaultValue) and reference it with {{var:ID}}. Env variables must NOT be listed in variablesIds: they are resolved automatically and never shown to the model. ' +
      'An unfilled optional input sends its defaultValue; an input with no value and no default blocks the call with "Unresolved request values". ' +
      'By default the new tool is attached to the start node (nodes[].toolsIds) so the model can call it; pass attachToStartNode: false to skip. Verify with test_agent_tool_request.',
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
            'Tool definition: name, description, method, serverUrl, serverUrlSecret, variablesIds[] or fields[] ({key,type,in,description,required}), httpRequest{enabled,method,url,headers,query,bodyType,bodyTemplate,bodyTemplateMode}, channels[], etc.',
        },
        attachToStartNode: {
          type: 'boolean',
          description:
            'Default true: adds the new tool id to the start node toolsIds so the agent can call it. A tool that is not in any node toolsIds is never offered to the model.',
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
      const created: any = await getActiveClient().createAgentTool(v.agentId, v.tool);
      if (v.attachToStartNode === false) return created;
      const toolId = created?.data?.id || created?.id;
      if (!toolId) return created;
      let nodeAttachment: Record<string, unknown>;
      try {
        nodeAttachment = await attachToolToStartNode(v.agentId, String(toolId));
      } catch (error) {
        nodeAttachment = {
          attached: false,
          reason: `Tool was created but could not be attached to the start node: ${
            error instanceof Error ? error.message : String(error)
          }. Add its id to nodes[].toolsIds with update_agent.`,
        };
      }
      return created && typeof created === 'object'
        ? { ...created, nodeAttachment }
        : { result: created, nodeAttachment };
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
