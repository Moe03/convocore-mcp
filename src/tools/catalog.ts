import type { Tool } from '@modelcontextprotocol/sdk/types.js';
import { z } from 'zod';
import { type ToolModule, wrapHandler } from './helpers.js';

const SearchSchema = z.object({
  query: z
    .string()
    .min(1)
    .describe('Keyword(s) to match against tool names and descriptions.'),
  detail: z
    .enum(['names', 'brief', 'schema'])
    .optional()
    .default('brief')
    .describe(
      'names=name list only; brief=name+description; schema=full tool definition.'
    ),
  limit: z.number().int().min(1).max(50).optional().default(20),
  domain: z
    .string()
    .optional()
    .describe(
      'Optional domain hint: orgs, clients, agency, leads, tools, variables, kb, testing, clone, conversations, agents, voice.'
    ),
});

/**
 * Progressive discovery helper — hosts often load every tool schema into context;
 * this lets the model filter the catalog before picking a tool.
 */
export function createSearchCatalogModule(
  getCatalog: () => Tool[]
): ToolModule {
  const tool: Tool = {
    name: 'search_mcp_tools',
    description:
      'Search this MCP server\'s tool catalog by keyword/domain before calling other tools. Use when unsure which tool to pick among orgs/clients/leads/agent_tools/variables/kb/testing. detail=names|brief|schema. Does not call the Convocore API.',
    annotations: {
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    },
    inputSchema: {
      type: 'object',
      properties: {
        query: { type: 'string' },
        detail: {
          type: 'string',
          enum: ['names', 'brief', 'schema'],
        },
        limit: { type: 'number' },
        domain: { type: 'string' },
      },
      required: ['query'],
    },
  };

  return {
    tools: [tool],
    handlers: {
      search_mcp_tools: wrapHandler('search_mcp_tools', async (args) => {
        const v = SearchSchema.parse(args);
        const catalog = getCatalog();
        const q = v.query.toLowerCase();
        const domain = v.domain?.toLowerCase().trim();

        const domainHints: Record<string, string[]> = {
          orgs: ['orgs_', 'org'],
          clients: ['clients_'],
          agency: ['agency_'],
          leads: ['leads_'],
          tools: ['agent_tool', 'test_agent_tool', 'list_agent_tools'],
          variables: ['agent_variable'],
          kb: ['kb_', 'search_kb', 'create_kb', 'import_file_to_kb'],
          testing: ['test_agent', 'auto_test', 'interact_with_agent'],
          clone: ['clone_agent'],
          conversations: ['conversation', 'send_channel'],
          agents: ['agent', 'create_agent', 'get_agent', 'update_agent'],
          voice: ['voice', 'twilio'],
        };

        const scored = catalog
          .map((t) => {
            const name = t.name.toLowerCase();
            const desc = (t.description || '').toLowerCase();
            let score = 0;
            for (const token of q.split(/\s+/).filter(Boolean)) {
              if (name.includes(token)) score += 5;
              if (desc.includes(token)) score += 2;
            }
            if (domain) {
              const hints = domainHints[domain] || [domain];
              if (hints.some((h) => name.includes(h) || desc.includes(h))) {
                score += 4;
              } else {
                score -= 1;
              }
            }
            return { tool: t, score };
          })
          .filter((x) => x.score > 0)
          .sort((a, b) => b.score - a.score)
          .slice(0, v.limit);

        const matches = scored.map(({ tool: t, score }) => {
          if (v.detail === 'names') return { name: t.name, score };
          if (v.detail === 'schema')
            return {
              name: t.name,
              description: t.description,
              inputSchema: t.inputSchema,
              annotations: (t as any).annotations,
              score,
            };
          return {
            name: t.name,
            description: t.description,
            score,
          };
        });

        return {
          success: true,
          query: v.query,
          domain: domain ?? null,
          detail: v.detail,
          count: matches.length,
          matches,
          tip: 'Call the chosen tool next with its required args. Prefer namespaced tools (orgs_*, leads_*, list_agent_tools) over guessing.',
        };
      }),
    },
  };
}
