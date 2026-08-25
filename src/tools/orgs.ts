import type { Tool } from '@modelcontextprotocol/sdk/types.js';
import { z } from 'zod';
import {
  applyListMode,
  compactAgentsListResult,
  compactClientsListResult,
  compactOrgsListResult,
} from '../list-compact.js';
import { getActiveClient } from '../request-context.js';
import {
  type ToolModule,
  wrapHandler,
  PageFields,
  ListModeField,
  ListModeSchemaDescribe,
} from './helpers.js';

const OrgsReadSchema = z
  .object({
    action: z.enum([
      'list',
      'search',
      'get',
      'list_clients',
      'list_agents',
      'list_members_and_teams',
      'list_agent_org_clients',
    ]),
    orgId: z.string().optional(),
    agentId: z.string().optional(),
    search: z.string().optional(),
    mode: ListModeField,
    ...PageFields,
  })
  .superRefine((v, ctx) => {
    if (
      ['get', 'list_clients', 'list_agents', 'list_members_and_teams'].includes(
        v.action
      ) &&
      !v.orgId
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `orgId is required for action=${v.action}`,
        path: ['orgId'],
      });
    }
    if (v.action === 'list_agent_org_clients' && !v.agentId) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'agentId is required for action=list_agent_org_clients',
        path: ['agentId'],
      });
    }
  });

const OrgsWriteSchema = z
  .object({
    action: z.enum(['create', 'update', 'delete', 'assign_agent']),
    orgId: z.string().optional(),
    agentId: z.string().optional(),
    name: z.string().optional(),
    email: z.string().optional(),
    squarePhotoURL: z.string().optional(),
    org: z.record(z.unknown()).optional(),
    assignAction: z.enum(['assign', 'unassign']).optional(),
  })
  .superRefine((v, ctx) => {
    if (v.action === 'create' && !v.name) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'name is required for action=create',
        path: ['name'],
      });
    }
    if (['update', 'delete'].includes(v.action) && !v.orgId) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `orgId is required for action=${v.action}`,
        path: ['orgId'],
      });
    }
    if (v.action === 'update' && !v.org) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'org object is required for action=update',
        path: ['org'],
      });
    }
    if (v.action === 'assign_agent') {
      if (!v.orgId) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: 'orgId is required for action=assign_agent',
          path: ['orgId'],
        });
      }
      if (!v.agentId) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: 'agentId is required for action=assign_agent',
          path: ['agentId'],
        });
      }
      if (!v.assignAction) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: 'assignAction (assign|unassign) is required for action=assign_agent',
          path: ['assignAction'],
        });
      }
    }
  });

const tools: Tool[] = [
  {
    name: 'orgs_read',
    description:
      'Read organizations and related membership. Actions: list, search, get, list_clients, list_agents, list_members_and_teams, list_agent_org_clients. ' +
      'List/search actions default mode=compact (short fields). Use mode=full only when you need complete objects; prefer action=get for one org. ' +
      'Does NOT create/update/delete — use orgs_write. For end-user client accounts use clients_read.',
    annotations: {
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: true,
    },
    inputSchema: {
      type: 'object',
      properties: {
        action: {
          type: 'string',
          enum: [
            'list',
            'search',
            'get',
            'list_clients',
            'list_agents',
            'list_members_and_teams',
            'list_agent_org_clients',
          ],
        },
        orgId: { type: 'string', description: 'Required for get / list_* (except list_agent_org_clients).' },
        agentId: {
          type: 'string',
          description: 'Required for list_agent_org_clients.',
        },
        search: { type: 'string', description: 'Search query for action=search.' },
        mode: {
          type: 'string',
          enum: ['compact', 'full'],
          description: ListModeSchemaDescribe,
        },
        page: { type: 'number' },
        pageSize: { type: 'number' },
      },
      required: ['action'],
    },
  },
  {
    name: 'orgs_write',
    description:
      'Create/update/delete organizations or assign/unassign an agent to an org. Actions: create, update, delete, assign_agent. For reads use orgs_write siblings orgs_read. Destructive: delete removes the org and associated clients.',
    annotations: {
      readOnlyHint: false,
      destructiveHint: true,
      idempotentHint: false,
      openWorldHint: true,
    },
    inputSchema: {
      type: 'object',
      properties: {
        action: {
          type: 'string',
          enum: ['create', 'update', 'delete', 'assign_agent'],
        },
        orgId: { type: 'string' },
        agentId: { type: 'string', description: 'For assign_agent.' },
        name: { type: 'string', description: 'For create.' },
        email: { type: 'string' },
        squarePhotoURL: { type: 'string' },
        org: { type: 'object', description: 'Fields to patch for action=update.' },
        assignAction: {
          type: 'string',
          enum: ['assign', 'unassign'],
          description: 'For assign_agent.',
        },
      },
      required: ['action'],
    },
  },
];

export const orgsModule: ToolModule = {
  tools,
  handlers: {
    orgs_read: wrapHandler('orgs_read', async (args) => {
      const v = OrgsReadSchema.parse(args);
      const client = getActiveClient();
      switch (v.action) {
        case 'list':
          return applyListMode(
            v.mode,
            await client.listOrgs({ page: v.page, pageSize: v.pageSize }),
            compactOrgsListResult
          );
        case 'search':
          return applyListMode(
            v.mode,
            await client.searchOrgs({
              search: v.search,
              page: v.page,
              pageSize: v.pageSize,
            }),
            compactOrgsListResult
          );
        case 'get':
          return client.getOrg(v.orgId!);
        case 'list_clients':
          return applyListMode(
            v.mode,
            await client.listOrgClients(v.orgId!, {
              page: v.page,
              pageSize: v.pageSize,
            }),
            compactClientsListResult
          );
        case 'list_agents':
          return applyListMode(
            v.mode,
            await client.listOrgAgents(v.orgId!, {
              page: v.page,
              pageSize: v.pageSize,
            }),
            compactAgentsListResult
          );
        case 'list_members_and_teams':
          return client.listOrgMembersAndTeams(v.orgId!);
        case 'list_agent_org_clients':
          return applyListMode(
            v.mode,
            await client.getAgentOrgClients(v.agentId!),
            compactClientsListResult
          );
      }
    }),
    orgs_write: wrapHandler('orgs_write', async (args) => {
      const v = OrgsWriteSchema.parse(args);
      const client = getActiveClient();
      switch (v.action) {
        case 'create':
          return client.createOrg({
            name: v.name!,
            email: v.email,
            squarePhotoURL: v.squarePhotoURL,
          });
        case 'update':
          return client.updateOrg(v.orgId!, v.org!);
        case 'delete':
          return client.deleteOrg(v.orgId!);
        case 'assign_agent':
          return client.assignOrgAgent(v.orgId!, v.agentId!, v.assignAction!);
      }
    }),
  },
};
