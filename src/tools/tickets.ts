import type { Tool } from '@modelcontextprotocol/sdk/types.js';
import { z } from 'zod';
import { getActiveClient } from '../request-context.js';
import {
  type ToolModule,
  wrapHandler,
  LightModeField,
  LightModeProperty,
  applyLightMode,
  requireFor,
  READ_ANNOTATIONS,
  WRITE_ANNOTATIONS,
} from './helpers.js';

const ReadSchema = z.object({
  action: z.enum(['list', 'get', 'comments', 'settings', 'stats']),
  orgId: z.string().optional(),
  clientId: z.string().optional(),
  ticketId: z.string().optional(),
  status: z.string().optional(),
  assignedTo: z.string().optional(),
  customerId: z.string().optional(),
  page: z.number().int().positive().optional(),
  pageSize: z.number().int().positive().max(200).optional(),
  sortBy: z.enum(['ts', 'lastModified', 'priority']).optional(),
  sortOrder: z.enum(['asc', 'desc']).optional(),
  mode: LightModeField,
});

const WriteSchema = z.object({
  action: z.enum([
    'create',
    'update',
    'delete',
    'add_comment',
    'update_settings',
    'regenerate_api_key',
  ]),
  orgId: z.string().optional(),
  ticketId: z.string().optional(),
  ticket: z.record(z.unknown()).optional(),
  content: z.string().optional(),
  isInternal: z.boolean().optional(),
  attachments: z
    .array(z.object({ name: z.string(), url: z.string(), type: z.string().optional(), size: z.number().optional() }))
    .optional(),
  settings: z.record(z.unknown()).optional(),
  mode: LightModeField,
});

const ticketPath = (ticketId: string) => `/support/tickets/${encodeURIComponent(ticketId)}`;

const tools: Tool[] = [
  {
    name: 'tickets_read',
    description:
      'Read support tickets. Actions: list (orgId required — get it from orgs_read; filter by status / assignedTo / customerId, paginated), get (ticketId), comments (ticketId, paginated), settings (ticketing settings; optional orgId / clientId), stats (ticket counts for orgId).',
    annotations: READ_ANNOTATIONS,
    inputSchema: {
      type: 'object',
      properties: {
        action: { type: 'string', enum: ['list', 'get', 'comments', 'settings', 'stats'] },
        orgId: { type: 'string', description: 'Required for list and stats.' },
        clientId: { type: 'string', description: 'For settings.' },
        ticketId: { type: 'string', description: 'Required for get and comments.' },
        status: { type: 'string', description: 'For list, e.g. open, in_progress, resolved, closed.' },
        assignedTo: { type: 'string' },
        customerId: { type: 'string' },
        page: { type: 'number' },
        pageSize: { type: 'number', description: 'Default 20 (comments: 50).' },
        sortBy: { type: 'string', enum: ['ts', 'lastModified', 'priority'] },
        sortOrder: { type: 'string', enum: ['asc', 'desc'] },
        mode: LightModeProperty,
      },
      required: ['action'],
    },
  },
  {
    name: 'tickets_write',
    description:
      'Create, edit, delete or comment on support tickets, and manage ticketing settings. Actions: ' +
      'create (ticket needs title + description; optional category, priority, relatedAgentId, relatedConvoId, tags, assignedTo, assignedToName), ' +
      'update (ticketId + ticket with only the fields to change, e.g. { status: "resolved" }), ' +
      'delete (ticketId; permanent), ' +
      'add_comment (ticketId + content; isInternal=true hides it from the customer), ' +
      'update_settings (settings: enabled, autoAssign, defaultAssignee, allowCustomerClose, notifyOnNewTicket, notifyOnUpdate), ' +
      'regenerate_api_key (invalidates the current external ticket API key — confirm first).',
    annotations: WRITE_ANNOTATIONS,
    inputSchema: {
      type: 'object',
      properties: {
        action: {
          type: 'string',
          enum: ['create', 'update', 'delete', 'add_comment', 'update_settings', 'regenerate_api_key'],
        },
        orgId: { type: 'string', description: 'Optional org scope for create / update_settings / regenerate_api_key.' },
        ticketId: { type: 'string' },
        ticket: { type: 'object', description: 'For create / update.' },
        content: { type: 'string', description: 'Comment text for add_comment.' },
        isInternal: { type: 'boolean' },
        attachments: { type: 'array', items: { type: 'object' }, description: 'For add_comment: [{ name, url, type?, size? }].' },
        settings: { type: 'object', description: 'For update_settings.' },
        mode: LightModeProperty,
      },
      required: ['action'],
    },
  },
];

export const ticketsModule: ToolModule = {
  tools,
  handlers: {
    tickets_read: wrapHandler('tickets_read', async (args) => {
      const v = ReadSchema.parse(args);
      const client = getActiveClient();
      switch (v.action) {
        case 'list':
          requireFor(v.action, v, 'orgId');
          return applyLightMode(
            v.mode,
            await client.api('GET', '/support/tickets', {
              query: {
                orgId: v.orgId,
                status: v.status,
                assignedTo: v.assignedTo,
                customerId: v.customerId,
                page: v.page,
                pageSize: v.pageSize,
                sortBy: v.sortBy,
                sortOrder: v.sortOrder,
              },
            })
          );
        case 'get':
          requireFor(v.action, v, 'ticketId');
          return applyLightMode(v.mode, await client.api('GET', ticketPath(v.ticketId!)));
        case 'comments':
          requireFor(v.action, v, 'ticketId');
          return applyLightMode(
            v.mode,
            await client.api('GET', `${ticketPath(v.ticketId!)}/comments`, {
              query: { page: v.page, pageSize: v.pageSize },
            })
          );
        case 'settings':
          return applyLightMode(
            v.mode,
            await client.api('GET', '/support/settings', {
              query: { orgId: v.orgId, clientId: v.clientId },
            })
          );
        case 'stats':
          requireFor(v.action, v, 'orgId');
          return applyLightMode(
            v.mode,
            await client.api('GET', '/support/stats', { query: { orgId: v.orgId } })
          );
      }
    }),
    tickets_write: wrapHandler('tickets_write', async (args) => {
      const v = WriteSchema.parse(args);
      const client = getActiveClient();
      switch (v.action) {
        case 'create':
          requireFor(v.action, v, 'ticket');
          requireFor('create', v.ticket as Record<string, unknown>, 'title', 'description');
          return applyLightMode(
            v.mode,
            await client.api('POST', '/support/tickets', {
              body: { ...(v.orgId ? { orgId: v.orgId } : {}), ...v.ticket },
            })
          );
        case 'update':
          requireFor(v.action, v, 'ticketId', 'ticket');
          return applyLightMode(
            v.mode,
            await client.api('PATCH', ticketPath(v.ticketId!), { body: { data: v.ticket } })
          );
        case 'delete':
          requireFor(v.action, v, 'ticketId');
          return client.api('DELETE', ticketPath(v.ticketId!));
        case 'add_comment':
          requireFor(v.action, v, 'ticketId', 'content');
          return applyLightMode(
            v.mode,
            await client.api('POST', `${ticketPath(v.ticketId!)}/comments`, {
              body: {
                content: v.content,
                isInternal: v.isInternal ?? false,
                ...(v.attachments ? { attachments: v.attachments } : {}),
              },
            })
          );
        case 'update_settings':
          requireFor(v.action, v, 'settings');
          return applyLightMode(
            v.mode,
            await client.api('PATCH', '/support/settings', {
              body: { ...(v.orgId ? { orgId: v.orgId } : {}), settings: v.settings },
            })
          );
        case 'regenerate_api_key':
          return client.api('POST', '/support/settings/regenerate-key', {
            body: v.orgId ? { orgId: v.orgId } : {},
          });
      }
    }),
  },
};
