import type { Tool } from '@modelcontextprotocol/sdk/types.js';
import { z } from 'zod';
import { applyListMode, compactLeadsListResult } from '../list-compact.js';
import { getActiveClient } from '../request-context.js';
import { type ToolModule, wrapHandler, ListModeField, ListModeSchemaDescribe } from './helpers.js';

const LeadsReadSchema = z
  .object({
    action: z.enum(['list', 'get', 'export', 'export_filtered']),
    agentId: z.string(),
    mode: ListModeField,
    leadId: z.string().optional(),
    page: z.number().int().positive().optional(),
    limit: z.number().int().positive().max(500).optional(),
    cursor: z.string().optional(),
    groupName: z.string().optional(),
    searchTerm: z.string().optional(),
    searchField: z.string().optional(),
    propertyFilter: z.string().optional(),
    leadFilters: z.string().optional(),
    timeRange: z.string().optional(),
    useAgentLeadsEndpoint: z
      .boolean()
      .optional()
      .describe(
        'When true (default for list with filters), uses GET /agents/{id}/leads. When false, uses GET /leads?agentId=.'
      ),
    filters: z.record(z.unknown()).optional(),
  })
  .superRefine((v, ctx) => {
    if (v.action === 'get' && !v.leadId) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'leadId is required for action=get',
        path: ['leadId'],
      });
    }
  });

const LeadsWriteSchema = z
  .object({
    action: z.enum([
      'create',
      'update',
      'delete',
      'import_bulk',
      'magic_import',
      'clear_all',
      'delete_group',
      'delete_many',
    ]),
    agentId: z.string(),
    leadId: z.string().optional(),
    leadIds: z.array(z.string()).optional(),
    lead: z.record(z.unknown()).optional(),
    leads: z.array(z.record(z.unknown())).optional(),
    rawText: z.string().optional(),
    leadGroupId: z.string().optional(),
    groupId: z.string().optional(),
    additionalInstructions: z.string().optional(),
  })
  .superRefine((v, ctx) => {
    if (v.action === 'create' && !v.lead) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'lead is required for action=create',
        path: ['lead'],
      });
    }
    if (v.action === 'update') {
      if (!v.leadId) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: 'leadId is required for action=update',
          path: ['leadId'],
        });
      }
      if (!v.lead) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: 'lead is required for action=update',
          path: ['lead'],
        });
      }
    }
    if (v.action === 'delete' && !v.leadId) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'leadId is required for action=delete',
        path: ['leadId'],
      });
    }
    if (v.action === 'delete_many' && (!v.leadIds || v.leadIds.length === 0)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'leadIds is required for action=delete_many',
        path: ['leadIds'],
      });
    }
    if (v.action === 'import_bulk' && (!v.leads || v.leads.length === 0)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'leads array is required for action=import_bulk',
        path: ['leads'],
      });
    }
    if (v.action === 'magic_import' && !v.rawText) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'rawText is required for action=magic_import',
        path: ['rawText'],
      });
    }
    if (v.action === 'delete_group' && !v.groupId) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'groupId is required for action=delete_group',
        path: ['groupId'],
      });
    }
  });

const tools: Tool[] = [
  {
    name: 'leads_read',
    description:
      'Read CRM leads for an agent. Actions: list, get, export, export_filtered. ' +
      'For action=list, default mode=compact (id/name/email/phone/ts — no metaData blobs). Use mode=full only when you need complete lead objects; prefer action=get for one lead. ' +
      'Does not create/update — use leads_write. Not for client accounts (clients_read).',
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
          enum: ['list', 'get', 'export', 'export_filtered'],
        },
        agentId: { type: 'string' },
        mode: {
          type: 'string',
          enum: ['compact', 'full'],
          description: ListModeSchemaDescribe,
        },
        leadId: { type: 'string' },
        page: { type: 'number' },
        limit: { type: 'number' },
        cursor: { type: 'string' },
        groupName: { type: 'string' },
        searchTerm: { type: 'string' },
        searchField: { type: 'string' },
        propertyFilter: { type: 'string' },
        leadFilters: { type: 'string' },
        timeRange: { type: 'string' },
        useAgentLeadsEndpoint: { type: 'boolean' },
        filters: {
          type: 'object',
          description: 'Body for export_filtered (groupName, searchTerm, etc.).',
        },
      },
      required: ['action', 'agentId'],
    },
  },
  {
    name: 'leads_write',
    description:
      'Create/update/delete/import CRM leads. Actions: create, update, delete, delete_many, import_bulk, magic_import, clear_all, delete_group. Destructive: clear_all deletes every lead on the agent.',
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
          enum: [
            'create',
            'update',
            'delete',
            'delete_many',
            'import_bulk',
            'magic_import',
            'clear_all',
            'delete_group',
          ],
        },
        agentId: { type: 'string' },
        leadId: { type: 'string' },
        leadIds: { type: 'array', items: { type: 'string' } },
        lead: { type: 'object' },
        leads: { type: 'array', items: { type: 'object' } },
        rawText: { type: 'string', description: 'For magic_import.' },
        leadGroupId: { type: 'string' },
        groupId: { type: 'string', description: 'For delete_group.' },
        additionalInstructions: { type: 'string' },
      },
      required: ['action', 'agentId'],
    },
  },
];

export const leadsModule: ToolModule = {
  tools,
  handlers: {
    leads_read: wrapHandler('leads_read', async (args) => {
      const v = LeadsReadSchema.parse(args);
      const client = getActiveClient();
      switch (v.action) {
        case 'list': {
          const useAgent =
            v.useAgentLeadsEndpoint !== false &&
            Boolean(
              v.groupName ||
                v.searchTerm ||
                v.searchField ||
                v.propertyFilter ||
                v.leadFilters ||
                v.useAgentLeadsEndpoint === true
            );
          const raw =
            useAgent || v.useAgentLeadsEndpoint === true
              ? await client.listAgentLeads(v.agentId, {
                  page: v.page,
                  limit: v.limit,
                  groupName: v.groupName,
                  searchTerm: v.searchTerm,
                  searchField: v.searchField,
                  propertyFilter: v.propertyFilter,
                  leadFilters: v.leadFilters,
                })
              : await client.listLeads({
                  agentId: v.agentId,
                  page: v.page,
                  limit: v.limit,
                  cursor: v.cursor,
                });
          return applyListMode(v.mode, raw, compactLeadsListResult);
        }
        case 'get':
          return client.getLead(v.leadId!, v.agentId);
        case 'export':
          return client.exportAgentLeads(v.agentId, { timeRange: v.timeRange });
        case 'export_filtered':
          return client.exportFilteredAgentLeads(v.agentId, {
            ...(v.filters || {}),
            ...(v.groupName ? { groupName: v.groupName } : {}),
            ...(v.searchTerm ? { searchTerm: v.searchTerm } : {}),
            ...(v.searchField ? { searchField: v.searchField } : {}),
            ...(v.propertyFilter ? { propertyFilter: v.propertyFilter } : {}),
            ...(v.leadFilters ? { leadFilters: v.leadFilters } : {}),
            ...(v.timeRange ? { timeRange: v.timeRange } : {}),
          });
      }
    }),
    leads_write: wrapHandler('leads_write', async (args) => {
      const v = LeadsWriteSchema.parse(args);
      const client = getActiveClient();
      switch (v.action) {
        case 'create':
          return client.createLead({
            ...v.lead!,
            agentId: (v.lead as any)?.agentId ?? v.agentId,
          });
        case 'update':
          return client.updateLead(v.leadId!, v.agentId, v.lead!);
        case 'delete':
          return client.deleteLead(v.leadId!, v.agentId);
        case 'delete_many':
          return client.deleteAgentLeads(v.agentId, v.leadIds!);
        case 'import_bulk':
          return client.importAgentLeadsBulk(v.agentId, v.leads!);
        case 'magic_import':
          return client.magicImportLeads(v.agentId, {
            rawText: v.rawText!,
            leadGroupId: v.leadGroupId,
            additionalInstructions: v.additionalInstructions,
          });
        case 'clear_all':
          return client.deleteAllAgentLeads(v.agentId);
        case 'delete_group':
          return client.deleteLeadsByGroup(v.agentId, v.groupId!);
      }
    }),
  },
};
