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

const CALL_TYPES = ['web', 'inbound', 'outbound'] as const;

const ReadSchema = z.object({
  action: z.enum(['list', 'get', 'export']),
  callLogId: z.string().optional(),
  agentId: z.string().optional(),
  sessionId: z.string().optional(),
  type: z.enum(CALL_TYPES).optional(),
  customerPhone: z.string().optional(),
  agentPhone: z.string().optional(),
  startFrom: z.string().optional(),
  startTo: z.string().optional(),
  search: z.string().optional(),
  page: z.number().int().positive().optional(),
  limit: z.number().int().positive().max(100).optional(),
  format: z.enum(['json', 'csv']).optional(),
  maxRows: z.number().int().positive().max(5000).optional(),
  callLogIds: z.array(z.string()).optional(),
  includeTranscripts: z.boolean().optional(),
  mode: LightModeField,
});

const WriteSchema = z.object({
  action: z.enum(['create', 'update', 'delete']),
  callLogId: z.string().optional(),
  callLog: z.record(z.unknown()).optional(),
  mode: LightModeField,
});

const filterProperties = {
  agentId: { type: 'string' },
  sessionId: { type: 'string' },
  type: { type: 'string', enum: [...CALL_TYPES] },
  customerPhone: { type: 'string' },
  agentPhone: { type: 'string' },
  startFrom: { type: 'string', description: 'ISO datetime, e.g. "2026-10-01T00:00:00.000Z".' },
  startTo: { type: 'string', description: 'ISO datetime.' },
  search: { type: 'string' },
} as const;

const tools: Tool[] = [
  {
    name: 'call_logs_read',
    description:
      'Read voice call logs of the workspace (web, inbound and outbound calls). Actions: list (filter by agent, type, phone numbers, date range, search; paginated), get (one call by callLogId — transcript and latency data only with mode="full"), export (JSON or CSV of many calls; includeTranscripts=true to add transcripts). Chat conversations are in list_conversations, not here.',
    annotations: READ_ANNOTATIONS,
    inputSchema: {
      type: 'object',
      properties: {
        action: { type: 'string', enum: ['list', 'get', 'export'] },
        callLogId: { type: 'string', description: 'Required for get (UUID).' },
        ...filterProperties,
        page: { type: 'number' },
        limit: { type: 'number', description: 'List page size, default 20, max 100.' },
        format: { type: 'string', enum: ['json', 'csv'], description: 'For export. Default json.' },
        maxRows: { type: 'number', description: 'For export. Default 1000, max 5000.' },
        callLogIds: {
          type: 'array',
          items: { type: 'string' },
          description: 'For export: only these call log ids.',
        },
        includeTranscripts: { type: 'boolean', description: 'For export. Default false.' },
        mode: LightModeProperty,
      },
      required: ['action'],
    },
  },
  {
    name: 'call_logs_write',
    description:
      'Create, edit or delete a call log record. Actions: create (callLog needs agent_id, type web|inbound|outbound, start_time ISO, agent_phone_number and customer_phone_number — null for web calls), update (callLogId + callLog with only the fields to change; agent_id and start_time cannot change), delete (callLogId; permanent). This edits records only — to place a call use start_outbound_call.',
    annotations: WRITE_ANNOTATIONS,
    inputSchema: {
      type: 'object',
      properties: {
        action: { type: 'string', enum: ['create', 'update', 'delete'] },
        callLogId: { type: 'string', description: 'Required for update / delete.' },
        callLog: {
          type: 'object',
          description: 'Call log fields (snake_case, as returned by call_logs_read).',
        },
        mode: LightModeProperty,
      },
      required: ['action'],
    },
  },
];

function listQuery(v: z.infer<typeof ReadSchema>) {
  return {
    agent_id: v.agentId,
    session_id: v.sessionId,
    type: v.type,
    customer_phone_number: v.customerPhone,
    agent_phone_number: v.agentPhone,
    start_time_from: v.startFrom,
    start_time_to: v.startTo,
    search: v.search,
  };
}

export const callLogsModule: ToolModule = {
  tools,
  handlers: {
    call_logs_read: wrapHandler('call_logs_read', async (args) => {
      const v = ReadSchema.parse(args);
      const client = getActiveClient();
      switch (v.action) {
        case 'list':
          return applyLightMode(
            v.mode,
            await client.api('GET', '/call-logs', {
              query: { ...listQuery(v), page: v.page, limit: v.limit },
            })
          );
        case 'get':
          requireFor(v.action, v, 'callLogId');
          return applyLightMode(
            v.mode,
            await client.api('GET', `/call-logs/${encodeURIComponent(v.callLogId!)}`)
          );
        case 'export':
          return applyLightMode(
            v.mode,
            await client.api('GET', '/call-logs/export', {
              query: {
                ...listQuery(v),
                format: v.format,
                max_rows: v.maxRows,
                ids_csv: v.callLogIds?.join(','),
                include_transcripts: v.includeTranscripts,
              },
            })
          );
      }
    }),
    call_logs_write: wrapHandler('call_logs_write', async (args) => {
      const v = WriteSchema.parse(args);
      const client = getActiveClient();
      switch (v.action) {
        case 'create':
          requireFor(v.action, v, 'callLog');
          return applyLightMode(
            v.mode,
            await client.api('POST', '/call-logs', { body: { call_log: v.callLog } })
          );
        case 'update':
          requireFor(v.action, v, 'callLogId', 'callLog');
          return applyLightMode(
            v.mode,
            await client.api('PATCH', `/call-logs/${encodeURIComponent(v.callLogId!)}`, {
              body: { patch: v.callLog },
            })
          );
        case 'delete':
          requireFor(v.action, v, 'callLogId');
          return client.api('DELETE', `/call-logs/${encodeURIComponent(v.callLogId!)}`);
      }
    }),
  },
};
