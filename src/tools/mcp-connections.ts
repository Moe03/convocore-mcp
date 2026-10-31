import type { Tool } from '@modelcontextprotocol/sdk/types.js';
import { z } from 'zod';
import { getActiveClient } from '../request-context.js';
import { type ToolModule, wrapHandler, READ_ANNOTATIONS, WRITE_ANNOTATIONS } from './helpers.js';

// MCP server connections: other MCP servers (Notion, Linear, Atlassian, ...) that an agent can use as tools.
// A connection is signed in once (OAuth, in the user's own browser) and belongs to the workspace, or to the
// client's organization on a gray-label connection; any of its agents can then use it.

const LinkSchema = z.object({
  serverUrl: z.string().min(1),
  serverName: z.string().max(60).optional(),
  agentIds: z.array(z.string().min(1)).max(50).optional(),
  allNodes: z.boolean().optional(),
  connectionId: z.string().min(1).optional(),
  ttlMinutes: z.number().int().min(5).max(7 * 24 * 60).optional(),
});

const ListSchema = z.object({ agentId: z.string().min(1).optional() });

const IdSchema = z.object({ connectionId: z.string().min(1) });

const AttachSchema = z.object({
  connectionId: z.string().min(1),
  agentId: z.string().min(1),
  nodeIds: z.array(z.string().min(1)).max(100).optional(),
  allNodes: z.boolean().optional(),
});

const DetachSchema = z.object({ connectionId: z.string().min(1), agentId: z.string().min(1) });

const enc = encodeURIComponent;

const tools: Tool[] = [
  {
    name: 'create_mcp_connect_link',
    description:
      'Connect another MCP server (e.g. https://mcp.notion.com/mcp, https://mcp.linear.app/mcp, https://mcp.atlassian.com/v1/sse) so agents can use its tools. Signing in to that server needs the USER in their own browser, so you cannot do it for them: create the link, show the returned url as a clickable link, and ask them to say when they are done. The page needs no dashboard login, opens on the agency\'s own domain for whitelabel workspaces, and has one Connect button. ' +
      'Pass agentIds to put the server on those agents automatically once the sign-in finishes (start node; allNodes=true for every node). Pass connectionId to re-sign an existing connection whose sign-in expired. ' +
      'When the user says they finished, call get_mcp_connection and only say it works when status is "connected".',
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true },
    inputSchema: {
      type: 'object',
      properties: {
        serverUrl: { type: 'string', description: 'The MCP server URL (streamable HTTP or SSE).' },
        serverName: { type: 'string', description: 'Short name used in tool names (letters, digits, _ and -). Defaults from the URL.' },
        agentIds: { type: 'array', items: { type: 'string' }, description: 'Agents to attach the connection to after sign-in.' },
        allNodes: { type: 'boolean', description: 'Attach to every node of those agents instead of only the start node.' },
        connectionId: { type: 'string', description: 'Re-sign this existing connection instead of creating a new one.' },
        ttlMinutes: { type: 'number', description: 'How long the link works. Default 60, max 10080 (7 days).' },
      },
      required: ['serverUrl'],
    },
  },
  {
    name: 'list_mcp_connections',
    description:
      'List the MCP server connections (name, URL, sign-in status: pending / connected / needs_reauth / error) and the agents that use each one. Tokens are never returned. Pass agentId to list only the ones on that agent. Reuse a connected one with attach_mcp_connection instead of asking the user to sign in again.',
    annotations: READ_ANNOTATIONS,
    inputSchema: {
      type: 'object',
      properties: { agentId: { type: 'string' } },
    },
  },
  {
    name: 'get_mcp_connection',
    description:
      'Sign-in status of one MCP server connection and the agents that use it. Use it after the user finished a connect link. needs_reauth means the sign-in expired or was revoked: create_mcp_connect_link with this connectionId.',
    annotations: READ_ANNOTATIONS,
    inputSchema: {
      type: 'object',
      properties: { connectionId: { type: 'string' } },
      required: ['connectionId'],
    },
  },
  {
    name: 'attach_mcp_connection',
    description:
      'Give an agent a signed-in MCP server: adds it to the agent\'s start node (nodeIds for specific nodes, allNodes for every node). Safe to repeat. The agent can use the server\'s tools from its next message.',
    annotations: { ...WRITE_ANNOTATIONS, idempotentHint: true },
    inputSchema: {
      type: 'object',
      properties: {
        connectionId: { type: 'string' },
        agentId: { type: 'string' },
        nodeIds: { type: 'array', items: { type: 'string' } },
        allNodes: { type: 'boolean' },
      },
      required: ['connectionId', 'agentId'],
    },
  },
  {
    name: 'detach_mcp_connection',
    description:
      'Remove an MCP server from an agent. The connection stays signed in for other agents; to sign out everywhere use delete_mcp_connection.',
    annotations: WRITE_ANNOTATIONS,
    inputSchema: {
      type: 'object',
      properties: { connectionId: { type: 'string' }, agentId: { type: 'string' } },
      required: ['connectionId', 'agentId'],
    },
  },
  {
    name: 'delete_mcp_connection',
    description:
      'Sign out of an MCP server and remove it from EVERY agent that uses it. Confirm with the user first and say which agents lose it (get_mcp_connection lists them).',
    annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: false },
    inputSchema: {
      type: 'object',
      properties: { connectionId: { type: 'string' } },
      required: ['connectionId'],
    },
  },
];

export const mcpConnectionsModule: ToolModule = {
  tools,
  handlers: {
    create_mcp_connect_link: wrapHandler('create_mcp_connect_link', async (args) => {
      const v = LinkSchema.parse(args);
      const result = await getActiveClient().api('POST', '/mcp-connections/connect-links', { body: v });
      const expiresAt = result?.expiresAtMs ? new Date(result.expiresAtMs).toISOString() : undefined;
      return {
        ...result,
        expiresAt,
        nextSteps: [
          'Show the url to the user as a clickable link: it opens a page with one Connect button (no dashboard login needed).',
          'They sign in on the MCP server\'s own page and come back. Ask them to tell you when they are done.',
          `Then call get_mcp_connection with connectionId ${result?.connectionId || ''} and only say it works when status is "connected".`,
          v.agentIds?.length
            ? 'The server is attached to the requested agents automatically after the sign-in.'
            : 'Then attach it to an agent with attach_mcp_connection.',
        ],
      };
    }),
    list_mcp_connections: wrapHandler('list_mcp_connections', async (args) => {
      const v = ListSchema.parse(args ?? {});
      return getActiveClient().api('GET', '/mcp-connections', { query: v.agentId ? { agentId: v.agentId } : {} });
    }),
    get_mcp_connection: wrapHandler('get_mcp_connection', async (args) => {
      const v = IdSchema.parse(args);
      return getActiveClient().api('GET', `/mcp-connections/${enc(v.connectionId)}`);
    }),
    attach_mcp_connection: wrapHandler('attach_mcp_connection', async (args) => {
      const { connectionId, ...body } = AttachSchema.parse(args);
      return getActiveClient().api('POST', `/mcp-connections/${enc(connectionId)}/attach`, { body });
    }),
    detach_mcp_connection: wrapHandler('detach_mcp_connection', async (args) => {
      const { connectionId, ...body } = DetachSchema.parse(args);
      return getActiveClient().api('POST', `/mcp-connections/${enc(connectionId)}/detach`, { body });
    }),
    delete_mcp_connection: wrapHandler('delete_mcp_connection', async (args) => {
      const v = IdSchema.parse(args);
      return getActiveClient().api('DELETE', `/mcp-connections/${enc(v.connectionId)}`);
    }),
  },
};
