#!/usr/bin/env node

/**
 * ConvoCore MCP Server
 * Provides Model Context Protocol tools for managing ConvoCore AI agents
 */

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  Tool,
} from '@modelcontextprotocol/sdk/types.js';
import { z } from 'zod';
import { getConfig } from './config.js';
import { ConvoCoreClient } from './convocore-client.js';

// Initialize configuration and client
const config = getConfig();
const client = new ConvoCoreClient(config);

// Define tool schemas
const CreateAgentSchema = z.object({
  title: z.string().describe('The title of the agent'),
  description: z.string().optional().describe('A brief description of the agent'),
  theme: z.string().optional().describe('Visual theme (e.g., blue-light, custom-blue-dark)'),
  disabled: z.boolean().optional().describe('Whether the agent should be disabled'),
  light: z.boolean().optional().describe('Enable light mode (no chat history retention)'),
  enableVertex: z.boolean().optional().describe('Enable Vertex AI'),
  autoOpenWidget: z.boolean().optional().describe('Auto-open widget on load'),
  voiceConfig: z.record(z.any()).optional().describe('Voice configuration object'),
  additionalConfig: z.record(z.any()).optional().describe('Additional agent configuration'),
});

const GetAgentSchema = z.object({
  agentId: z.string().describe('The unique identifier of the agent'),
});

const UpdateAgentSchema = z.object({
  agentId: z.string().describe('The unique identifier of the agent to update'),
  title: z.string().optional().describe('Updated title'),
  description: z.string().optional().describe('Updated description'),
  theme: z.string().optional().describe('Updated theme'),
  disabled: z.boolean().optional().describe('Updated disabled status'),
  light: z.boolean().optional().describe('Updated light mode setting'),
  enableVertex: z.boolean().optional().describe('Updated Vertex AI setting'),
  autoOpenWidget: z.boolean().optional().describe('Updated auto-open widget setting'),
  voiceConfig: z.record(z.any()).optional().describe('Updated voice configuration'),
  additionalConfig: z.record(z.any()).optional().describe('Additional configuration updates'),
});

const DeleteAgentSchema = z.object({
  agentId: z.string().describe('The unique identifier of the agent to delete'),
});

const ListAgentsSchema = z.object({
  // No parameters needed - just lists all agents!
});

const SearchAgentsSchema = z.object({
  workspaceId: z.string().describe('Your workspace/org ID from ConvoCore dashboard'),
  search: z.string().optional().describe('Search query to find agents'),
  page: z.number().optional().default(1).describe('Page number'),
  limit: z.number().optional().default(50).describe('Results per page'),
  sortBy: z.string().optional().default('newest').describe('Sort by: newest, oldest, alphabetical'),
  starredOnly: z.boolean().optional().default(false).describe('Show only starred agents'),
});

const ExportAgentSchema = z.object({
  agentId: z.string().describe('The agent ID to export'),
});

const ImportAgentSchema = z.object({
  agentTemplate: z.any().describe('The agent template object to import'),
  agentName: z.string().describe('Name for the imported agent'),
  fromAgentId: z.string().optional().describe('Source agent ID'),
});

const AgentUsageSchema = z.object({
  agentId: z.string().describe('The agent ID to get usage for'),
  range: z.object({
    from: z.string().describe('Start date (ISO format)'),
    to: z.string().describe('End date (ISO format)'),
  }).optional().describe('Optional date range for usage stats'),
});

// ==================== CONVERSATION SCHEMAS ====================

const ListConversationsSchema = z.object({
  agentId: z.string().describe('The agent ID to list conversations for'),
  page: z.number().optional().default(1).describe('Page number'),
  limit: z.number().optional().default(20).describe('Results per page'),
});

const CreateConversationSchema = z.object({
  agentId: z.string().describe('The agent ID to create conversation for'),
  conversation: z.any().describe('Conversation object (at minimum needs ts field)'),
});

const GetConversationSchema = z.object({
  agentId: z.string().describe('The agent ID'),
  convoId: z.string().describe('The conversation ID'),
});

const UpdateConversationSchema = z.object({
  agentId: z.string().describe('The agent ID'),
  convoId: z.string().describe('The conversation ID'),
  conversation: z.any().describe('Conversation fields to update'),
});

const DeleteConversationSchema = z.object({
  agentId: z.string().describe('The agent ID'),
  convoId: z.string().describe('The conversation ID'),
});

const ExportAllConversationsSchema = z.object({
  agentId: z.string().describe('The agent ID to export conversations from'),
  format: z.enum(['json', 'csv']).optional().default('json').describe('Export format'),
});

const ExportConversationSchema = z.object({
  agentId: z.string().describe('The agent ID'),
  convoId: z.string().describe('The conversation ID'),
  format: z.enum(['json', 'csv']).optional().default('json').describe('Export format'),
});

const AssignConversationSchema = z.object({
  agentId: z.string().describe('The agent ID'),
  convoId: z.string().describe('The conversation ID'),
  assignToUserId: z.string().describe('User ID to assign conversation to'),
  delegatedBy: z.string().optional().describe('ID of user delegating this chat'),
});

// ==================== KNOWLEDGE BASE SCHEMAS ====================

const CreateKBDocSchema = z.object({
  agentId: z.string().describe('The agent ID'),
  name: z.string().describe('Document name'),
  sourceType: z.enum(['doc', 'url', 'sitemap']).describe('Source type'),
  content: z.string().optional().describe('Document content (for doc type)'),
  metadata: z.any().optional().describe('Additional metadata'),
  tags: z.array(z.string()).optional().describe('Tags for organization'),
  refreshRate: z.enum(['6h', '12h', '24h', '7d', 'never']).optional().default('never').describe('Auto-refresh rate'),
  urls: z.array(z.string()).optional().describe('URLs to process (for url type)'),
  sitemapUrl: z.string().optional().describe('Sitemap URL (for sitemap type)'),
  maxPages: z.number().optional().describe('Max pages from sitemap'),
  scrapeContent: z.boolean().optional().describe('Whether to scrape content'),
});

const ListKBDocsSchema = z.object({
  agentId: z.string().describe('The agent ID'),
  page: z.number().optional().default(1).describe('Page number'),
  pageSize: z.number().optional().default(20).describe('Results per page'),
});

const GetKBDocSchema = z.object({
  agentId: z.string().describe('The agent ID'),
  docId: z.string().describe('The document ID'),
});

const UpdateKBDocSchema = z.object({
  agentId: z.string().describe('The agent ID'),
  docId: z.string().describe('The document ID'),
  name: z.string().optional().describe('Updated document name'),
  content: z.string().optional().describe('Updated content'),
  metadata: z.any().optional().describe('Updated metadata'),
  tags: z.array(z.string()).optional().describe('Updated tags'),
  refreshRate: z.enum(['6h', '12h', '24h', '7d', 'never']).optional().describe('Updated refresh rate'),
  url: z.string().optional().describe('Updated URL'),
});

const DeleteKBDocSchema = z.object({
  agentId: z.string().describe('The agent ID'),
  docId: z.string().describe('The document ID'),
});

const GetKBStatsSchema = z.object({
  agentId: z.string().describe('The agent ID'),
});

// Define MCP tools
const tools: Tool[] = [
  {
    name: 'create_agent',
    description: 'Create a new ConvoCore AI agent. IMPORTANT: ConvoCore uses "nodes" for advanced AI - the FIRST node in the nodes array contains the MAIN prompt/instructions that control the agent. When creating an agent, set nodes[0].instructions for the primary behavior.',
    inputSchema: {
      type: 'object',
      properties: {
        title: {
          type: 'string',
          description: 'The title of the agent',
        },
        description: {
          type: 'string',
          description: 'A brief description of the agent',
        },
        theme: {
          type: 'string',
          description: 'Visual theme (e.g., blue-light, custom-blue-dark)',
        },
        disabled: {
          type: 'boolean',
          description: 'Whether the agent should be disabled',
        },
        light: {
          type: 'boolean',
          description: 'Enable light mode (no chat history retention for privacy)',
        },
        enableVertex: {
          type: 'boolean',
          description: 'Enable Vertex AI for the agent',
        },
        autoOpenWidget: {
          type: 'boolean',
          description: 'Auto-open widget when agent loads',
        },
        voiceConfig: {
          type: 'object',
          description: 'Voice configuration for the agent (transcriber, speechGen, etc.)',
        },
        nodes: {
          type: 'array',
          description: 'Agent nodes array. The FIRST node (nodes[0]) should contain the main prompt in its instructions field. Example: [{ instructions: "Main agent prompt", name: "Main Node" }]',
        },
        additionalConfig: {
          type: 'object',
          description: 'Additional agent configuration fields',
        },
      },
      required: ['title'],
    },
  },
  {
    name: 'get_agent',
    description: 'Retrieve details of a specific ConvoCore agent. NOTE: The agent\'s main prompt is in nodes[0].instructions (first node in nodes array).',
    inputSchema: {
      type: 'object',
      properties: {
        agentId: {
          type: 'string',
          description: 'The unique identifier of the agent',
        },
      },
      required: ['agentId'],
    },
  },
  {
    name: 'update_agent',
    description: 'Update an existing ConvoCore agent. CRITICAL: To change the agent\'s main prompt/instructions, update nodes[0].instructions (first node in nodes array). This is the PRIMARY prompt that controls agent behavior. Other nodes are for advanced multi-step workflows.',
    inputSchema: {
      type: 'object',
      properties: {
        agentId: {
          type: 'string',
          description: 'The unique identifier of the agent to update',
        },
        title: {
          type: 'string',
          description: 'Updated title',
        },
        description: {
          type: 'string',
          description: 'Updated description',
        },
        theme: {
          type: 'string',
          description: 'Updated theme',
        },
        disabled: {
          type: 'boolean',
          description: 'Updated disabled status',
        },
        light: {
          type: 'boolean',
          description: 'Updated light mode setting',
        },
        enableVertex: {
          type: 'boolean',
          description: 'Updated Vertex AI setting',
        },
        autoOpenWidget: {
          type: 'boolean',
          description: 'Updated auto-open widget setting',
        },
        voiceConfig: {
          type: 'object',
          description: 'Updated voice configuration',
        },
        nodes: {
          type: 'array',
          description: 'IMPORTANT: Agent nodes array. To update the main prompt, modify nodes[0].instructions. Example: [{ instructions: "Your new prompt here" }]',
        },
        additionalConfig: {
          type: 'object',
          description: 'Additional configuration updates',
        },
      },
      required: ['agentId'],
    },
  },
  {
    name: 'delete_agent',
    description: 'Delete a ConvoCore agent permanently',
    inputSchema: {
      type: 'object',
      properties: {
        agentId: {
          type: 'string',
          description: 'The unique identifier of the agent to delete',
        },
      },
      required: ['agentId'],
    },
  },
  {
    name: 'list_agents',
    description: 'List all your ConvoCore agents - no parameters needed!',
    inputSchema: {
      type: 'object',
      properties: {},
      required: [],
    },
  },
  {
    name: 'search_agents',
    description: 'Search for ConvoCore agents (requires workspaceId from dashboard)',
    inputSchema: {
      type: 'object',
      properties: {
        workspaceId: {
          type: 'string',
          description: 'Your workspace/org ID (get this from ConvoCore dashboard)',
        },
        search: {
          type: 'string',
          description: 'Search query to find agents',
        },
        page: {
          type: 'number',
          description: 'Page number (default: 1)',
        },
        limit: {
          type: 'number',
          description: 'Results per page (default: 50)',
        },
        sortBy: {
          type: 'string',
          description: 'Sort by: newest, oldest, alphabetical (default: newest)',
        },
        starredOnly: {
          type: 'boolean',
          description: 'Show only starred agents (default: false)',
        },
      },
      required: ['workspaceId'],
    },
  },
  {
    name: 'export_agent',
    description: 'Export an agent template for backup or migration',
    inputSchema: {
      type: 'object',
      properties: {
        agentId: {
          type: 'string',
          description: 'The agent ID to export',
        },
      },
      required: ['agentId'],
    },
  },
  {
    name: 'import_agent',
    description: 'Import an agent from a template',
    inputSchema: {
      type: 'object',
      properties: {
        agentTemplate: {
          type: 'object',
          description: 'The agent template object (from export)',
        },
        agentName: {
          type: 'string',
          description: 'Name for the imported agent',
        },
        fromAgentId: {
          type: 'string',
          description: 'Optional source agent ID',
        },
      },
      required: ['agentTemplate', 'agentName'],
    },
  },
  {
    name: 'get_agent_usage',
    description: 'Get agent usage statistics and credits consumed',
    inputSchema: {
      type: 'object',
      properties: {
        agentId: {
          type: 'string',
          description: 'The agent ID to get usage for',
        },
        range: {
          type: 'object',
          description: 'Optional date range for usage stats',
          properties: {
            from: {
              type: 'string',
              description: 'Start date (ISO format, e.g., 2024-01-01)',
            },
            to: {
              type: 'string',
              description: 'End date (ISO format, e.g., 2024-01-31)',
            },
          },
        },
      },
      required: ['agentId'],
    },
  },
  // ==================== CONVERSATION TOOLS ====================
  {
    name: 'list_conversations',
    description: 'List all conversations for an agent',
    inputSchema: {
      type: 'object',
      properties: {
        agentId: {
          type: 'string',
          description: 'The agent ID to list conversations for',
        },
        page: {
          type: 'number',
          description: 'Page number (default: 1)',
        },
        limit: {
          type: 'number',
          description: 'Results per page (default: 20)',
        },
      },
      required: ['agentId'],
    },
  },
  {
    name: 'create_conversation',
    description: 'Create a new conversation for an agent',
    inputSchema: {
      type: 'object',
      properties: {
        agentId: {
          type: 'string',
          description: 'The agent ID',
        },
        conversation: {
          type: 'object',
          description: 'Conversation object (minimum: { ts: timestamp })',
        },
      },
      required: ['agentId', 'conversation'],
    },
  },
  {
    name: 'get_conversation',
    description: 'Get details of a single conversation',
    inputSchema: {
      type: 'object',
      properties: {
        agentId: {
          type: 'string',
          description: 'The agent ID',
        },
        convoId: {
          type: 'string',
          description: 'The conversation ID',
        },
      },
      required: ['agentId', 'convoId'],
    },
  },
  {
    name: 'update_conversation',
    description: 'Update an existing conversation',
    inputSchema: {
      type: 'object',
      properties: {
        agentId: {
          type: 'string',
          description: 'The agent ID',
        },
        convoId: {
          type: 'string',
          description: 'The conversation ID',
        },
        conversation: {
          type: 'object',
          description: 'Conversation fields to update',
        },
      },
      required: ['agentId', 'convoId', 'conversation'],
    },
  },
  {
    name: 'delete_conversation',
    description: 'Delete a conversation',
    inputSchema: {
      type: 'object',
      properties: {
        agentId: {
          type: 'string',
          description: 'The agent ID',
        },
        convoId: {
          type: 'string',
          description: 'The conversation ID',
        },
      },
      required: ['agentId', 'convoId'],
    },
  },
  {
    name: 'export_all_conversations',
    description: 'Export all conversations for an agent',
    inputSchema: {
      type: 'object',
      properties: {
        agentId: {
          type: 'string',
          description: 'The agent ID',
        },
        format: {
          type: 'string',
          enum: ['json', 'csv'],
          description: 'Export format (default: json)',
        },
      },
      required: ['agentId'],
    },
  },
  {
    name: 'export_conversation',
    description: 'Export a single conversation',
    inputSchema: {
      type: 'object',
      properties: {
        agentId: {
          type: 'string',
          description: 'The agent ID',
        },
        convoId: {
          type: 'string',
          description: 'The conversation ID',
        },
        format: {
          type: 'string',
          enum: ['json', 'csv'],
          description: 'Export format (default: json)',
        },
      },
      required: ['agentId', 'convoId'],
    },
  },
  {
    name: 'assign_conversation',
    description: 'Assign a conversation to a user for manual delegation',
    inputSchema: {
      type: 'object',
      properties: {
        agentId: {
          type: 'string',
          description: 'The agent ID',
        },
        convoId: {
          type: 'string',
          description: 'The conversation ID',
        },
        assignToUserId: {
          type: 'string',
          description: 'User ID to assign to',
        },
        delegatedBy: {
          type: 'string',
          description: 'Optional: ID of user delegating',
        },
      },
      required: ['agentId', 'convoId', 'assignToUserId'],
    },
  },
  // ==================== KNOWLEDGE BASE TOOLS ====================
  {
    name: 'create_kb_doc',
    description: 'Add a document to an agent\'s knowledge base (VG agents only)',
    inputSchema: {
      type: 'object',
      properties: {
        agentId: {
          type: 'string',
          description: 'The agent ID',
        },
        name: {
          type: 'string',
          description: 'Document name',
        },
        sourceType: {
          type: 'string',
          enum: ['doc', 'url', 'sitemap'],
          description: 'Source type: doc (text content), url (single URL), sitemap (multiple pages)',
        },
        content: {
          type: 'string',
          description: 'Document content (required for sourceType: doc)',
        },
        metadata: {
          type: 'object',
          description: 'Additional metadata',
        },
        tags: {
          type: 'array',
          items: { type: 'string' },
          description: 'Tags for organization',
        },
        refreshRate: {
          type: 'string',
          enum: ['6h', '12h', '24h', '7d', 'never'],
          description: 'Auto-refresh rate (default: never)',
        },
        urls: {
          type: 'array',
          items: { type: 'string' },
          description: 'Array of URLs (for sourceType: url)',
        },
        sitemapUrl: {
          type: 'string',
          description: 'Sitemap URL (for sourceType: sitemap)',
        },
        maxPages: {
          type: 'number',
          description: 'Max pages from sitemap',
        },
        scrapeContent: {
          type: 'boolean',
          description: 'Whether to scrape content from URLs',
        },
      },
      required: ['agentId', 'name', 'sourceType'],
    },
  },
  {
    name: 'list_kb_docs',
    description: 'List all knowledge base documents for an agent',
    inputSchema: {
      type: 'object',
      properties: {
        agentId: {
          type: 'string',
          description: 'The agent ID',
        },
        page: {
          type: 'number',
          description: 'Page number (default: 1)',
        },
        pageSize: {
          type: 'number',
          description: 'Results per page (default: 20)',
        },
      },
      required: ['agentId'],
    },
  },
  {
    name: 'get_kb_doc',
    description: 'Get a single knowledge base document',
    inputSchema: {
      type: 'object',
      properties: {
        agentId: {
          type: 'string',
          description: 'The agent ID',
        },
        docId: {
          type: 'string',
          description: 'The document ID',
        },
      },
      required: ['agentId', 'docId'],
    },
  },
  {
    name: 'update_kb_doc',
    description: 'Update a knowledge base document (VG agents only)',
    inputSchema: {
      type: 'object',
      properties: {
        agentId: {
          type: 'string',
          description: 'The agent ID',
        },
        docId: {
          type: 'string',
          description: 'The document ID',
        },
        name: {
          type: 'string',
          description: 'Updated name',
        },
        content: {
          type: 'string',
          description: 'Updated content',
        },
        metadata: {
          type: 'object',
          description: 'Updated metadata',
        },
        tags: {
          type: 'array',
          items: { type: 'string' },
          description: 'Updated tags',
        },
        refreshRate: {
          type: 'string',
          enum: ['6h', '12h', '24h', '7d', 'never'],
          description: 'Updated refresh rate',
        },
        url: {
          type: 'string',
          description: 'Updated URL',
        },
      },
      required: ['agentId', 'docId'],
    },
  },
  {
    name: 'delete_kb_doc',
    description: 'Delete a knowledge base document (VG agents only)',
    inputSchema: {
      type: 'object',
      properties: {
        agentId: {
          type: 'string',
          description: 'The agent ID',
        },
        docId: {
          type: 'string',
          description: 'The document ID',
        },
      },
      required: ['agentId', 'docId'],
    },
  },
  {
    name: 'get_kb_stats',
    description: 'Get knowledge base statistics for an agent (VG agents only)',
    inputSchema: {
      type: 'object',
      properties: {
        agentId: {
          type: 'string',
          description: 'The agent ID',
        },
      },
      required: ['agentId'],
    },
  },
];

// Create MCP server
const server = new Server(
  {
    name: 'convocore-mcp-server',
    version: '1.0.0',
  },
  {
    capabilities: {
      tools: {},
    },
  }
);

// Handle list tools request
server.setRequestHandler(ListToolsRequestSchema, async () => {
  return { tools };
});

// Handle tool calls
server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;

  try {
    switch (name) {
      case 'create_agent': {
        const validated = CreateAgentSchema.parse(args);
        const { additionalConfig, ...agentFields } = validated;
        
        const payload = {
          agent: {
            ...agentFields,
            ...(additionalConfig || {}),
          },
        };

        const result = await client.createAgent(payload);
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify(result, null, 2),
            },
          ],
        };
      }

      case 'get_agent': {
        const validated = GetAgentSchema.parse(args);
        const result = await client.getAgent(validated.agentId);
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify(result, null, 2),
            },
          ],
        };
      }

      case 'update_agent': {
        const validated = UpdateAgentSchema.parse(args);
        const { agentId, additionalConfig, ...updateFields } = validated;
        
        const payload = {
          agent: {
            ...updateFields,
            ...(additionalConfig || {}),
          },
        };

        const result = await client.updateAgent(agentId, payload);
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify(result, null, 2),
            },
          ],
        };
      }

      case 'delete_agent': {
        const validated = DeleteAgentSchema.parse(args);
        const result = await client.deleteAgent(validated.agentId);
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify(result, null, 2),
            },
          ],
        };
      }

      case 'list_agents': {
        ListAgentsSchema.parse(args); // No params needed
        const result = await client.listAgents();
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify(result, null, 2),
            },
          ],
        };
      }

      case 'search_agents': {
        const validated = SearchAgentsSchema.parse(args);
        const result = await client.searchAgents(
          validated.workspaceId,
          validated.search,
          validated.page,
          validated.limit,
          validated.sortBy,
          validated.starredOnly
        );
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify(result, null, 2),
            },
          ],
        };
      }

      case 'export_agent': {
        const validated = ExportAgentSchema.parse(args);
        const result = await client.exportAgentTemplate(validated.agentId);
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify(result, null, 2),
            },
          ],
        };
      }

      case 'import_agent': {
        const validated = ImportAgentSchema.parse(args);
        const result = await client.importAgentTemplate(
          validated.agentTemplate,
          validated.agentName,
          validated.fromAgentId
        );
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify(result, null, 2),
            },
          ],
        };
      }

      case 'get_agent_usage': {
        const validated = AgentUsageSchema.parse(args);
        const result = await client.getAgentUsage(
          validated.agentId,
          validated.range
        );
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify(result, null, 2),
            },
          ],
        };
      }

      // ==================== CONVERSATION HANDLERS ====================

      case 'list_conversations': {
        const validated = ListConversationsSchema.parse(args);
        const result = await client.listConversations(
          validated.agentId,
          validated.page,
          validated.limit
        );
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify(result, null, 2),
            },
          ],
        };
      }

      case 'create_conversation': {
        const validated = CreateConversationSchema.parse(args);
        const result = await client.createConversation(
          validated.agentId,
          validated.conversation
        );
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify(result, null, 2),
            },
          ],
        };
      }

      case 'get_conversation': {
        const validated = GetConversationSchema.parse(args);
        const result = await client.getConversation(
          validated.agentId,
          validated.convoId
        );
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify(result, null, 2),
            },
          ],
        };
      }

      case 'update_conversation': {
        const validated = UpdateConversationSchema.parse(args);
        const result = await client.updateConversation(
          validated.agentId,
          validated.convoId,
          validated.conversation
        );
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify(result, null, 2),
            },
          ],
        };
      }

      case 'delete_conversation': {
        const validated = DeleteConversationSchema.parse(args);
        const result = await client.deleteConversation(
          validated.agentId,
          validated.convoId
        );
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify(result, null, 2),
            },
          ],
        };
      }

      case 'export_all_conversations': {
        const validated = ExportAllConversationsSchema.parse(args);
        const result = await client.exportAllConversations(
          validated.agentId,
          validated.format
        );
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify(result, null, 2),
            },
          ],
        };
      }

      case 'export_conversation': {
        const validated = ExportConversationSchema.parse(args);
        const result = await client.exportConversation(
          validated.agentId,
          validated.convoId,
          validated.format
        );
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify(result, null, 2),
            },
          ],
        };
      }

      case 'assign_conversation': {
        const validated = AssignConversationSchema.parse(args);
        const result = await client.assignConversation(
          validated.agentId,
          validated.convoId,
          validated.assignToUserId,
          validated.delegatedBy
        );
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify(result, null, 2),
            },
          ],
        };
      }

      // ==================== KNOWLEDGE BASE HANDLERS ====================

      case 'create_kb_doc': {
        const validated = CreateKBDocSchema.parse(args);
        const { agentId, ...kbData } = validated;
        const result = await client.createKBDoc(agentId, kbData);
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify(result, null, 2),
            },
          ],
        };
      }

      case 'list_kb_docs': {
        const validated = ListKBDocsSchema.parse(args);
        const result = await client.listKBDocs(
          validated.agentId,
          validated.page,
          validated.pageSize
        );
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify(result, null, 2),
            },
          ],
        };
      }

      case 'get_kb_doc': {
        const validated = GetKBDocSchema.parse(args);
        const result = await client.getKBDoc(validated.agentId, validated.docId);
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify(result, null, 2),
            },
          ],
        };
      }

      case 'update_kb_doc': {
        const validated = UpdateKBDocSchema.parse(args);
        const { agentId, docId, ...kbData } = validated;
        const result = await client.updateKBDoc(agentId, docId, kbData);
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify(result, null, 2),
            },
          ],
        };
      }

      case 'delete_kb_doc': {
        const validated = DeleteKBDocSchema.parse(args);
        const result = await client.deleteKBDoc(validated.agentId, validated.docId);
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify(result, null, 2),
            },
          ],
        };
      }

      case 'get_kb_stats': {
        const validated = GetKBStatsSchema.parse(args);
        const result = await client.getKBStats(validated.agentId);
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify(result, null, 2),
            },
          ],
        };
      }

      default:
        throw new Error(`Unknown tool: ${name}`);
    }
  } catch (error) {
    if (error instanceof z.ZodError) {
      throw new Error(`Invalid arguments: ${error.message}`);
    }
    throw error;
  }
});

// Start the server
async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error('ConvoCore MCP Server running on stdio');
}

main().catch((error) => {
  console.error('Fatal error in main():', error);
  process.exit(1);
});

