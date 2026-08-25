import type { Tool } from '@modelcontextprotocol/sdk/types.js';
import { z } from 'zod';
import { applyListMode, compactClientsListResult } from '../list-compact.js';
import { getActiveClient } from '../request-context.js';
import {
  type ToolModule,
  wrapHandler,
  PageFields,
  ListModeField,
  ListModeSchemaDescribe,
} from './helpers.js';

const ClientsReadSchema = z
  .object({
    action: z.enum(['list', 'get', 'check_email']),
    clientId: z.string().optional(),
    orgId: z.string().optional(),
    email: z.string().optional(),
    mode: ListModeField,
    ...PageFields,
  })
  .superRefine((v, ctx) => {
    if (v.action === 'get' && !v.clientId) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'clientId is required for action=get',
        path: ['clientId'],
      });
    }
    if (v.action === 'check_email' && !v.email) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'email is required for action=check_email',
        path: ['email'],
      });
    }
  });

const ClientsWriteSchema = z
  .object({
    action: z.enum(['create', 'update', 'delete']),
    clientId: z.string().optional(),
    clientData: z.record(z.unknown()).optional(),
  })
  .superRefine((v, ctx) => {
    if (['create', 'update'].includes(v.action) && !v.clientData) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `clientData is required for action=${v.action}`,
        path: ['clientData'],
      });
    }
    if (v.action === 'delete' && !v.clientId) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'clientId is required for action=delete',
        path: ['clientId'],
      });
    }
  });

const tools: Tool[] = [
  {
    name: 'clients_read',
    description:
      'Read Convocore client accounts (end-user workspaces under an agency/org). Actions: list, get, check_email. ' +
      'For action=list, default mode=compact (id/name/email/orgId). Use mode=full only when you need complete client objects; prefer action=get for one client. ' +
      'Not for organizations (use orgs_read) or CRM leads (use leads_read).',
    annotations: {
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: true,
    },
    inputSchema: {
      type: 'object',
      properties: {
        action: { type: 'string', enum: ['list', 'get', 'check_email'] },
        clientId: { type: 'string' },
        orgId: { type: 'string', description: 'Optional filter for list / check_email.' },
        email: { type: 'string', description: 'For check_email.' },
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
    name: 'clients_write',
    description:
      'Create/update/delete client accounts. Actions: create, update, delete. Pass clientData object for create/update. For reads use clients_read.',
    annotations: {
      readOnlyHint: false,
      destructiveHint: true,
      idempotentHint: false,
      openWorldHint: true,
    },
    inputSchema: {
      type: 'object',
      properties: {
        action: { type: 'string', enum: ['create', 'update', 'delete'] },
        clientId: {
          type: 'string',
          description: 'Required for delete; recommended for update.',
        },
        clientData: {
          type: 'object',
          description: 'Client fields for create/update.',
        },
      },
      required: ['action'],
    },
  },
];

export const clientsModule: ToolModule = {
  tools,
  handlers: {
    clients_read: wrapHandler('clients_read', async (args) => {
      const v = ClientsReadSchema.parse(args);
      const client = getActiveClient();
      switch (v.action) {
        case 'list':
          return applyListMode(
            v.mode,
            await client.listClients({
              orgId: v.orgId,
              page: v.page,
              pageSize: v.pageSize,
            }),
            compactClientsListResult
          );
        case 'get':
          return client.getClient(v.clientId!);
        case 'check_email':
          return client.checkClientEmail({
            email: v.email!,
            clientId: v.clientId,
            orgId: v.orgId,
          });
      }
    }),
    clients_write: wrapHandler('clients_write', async (args) => {
      const v = ClientsWriteSchema.parse(args);
      const client = getActiveClient();
      switch (v.action) {
        case 'create':
          return client.createClient(v.clientData!);
        case 'update':
          return client.updateClient(v.clientId, v.clientData!);
        case 'delete':
          return client.deleteClient(v.clientId!);
      }
    }),
  },
};
