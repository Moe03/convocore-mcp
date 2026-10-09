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

const METRIC_TYPES = ['number', 'boolean', 'enum', 'string'] as const;

const ReadSchema = z.object({
  action: z.enum(['list', 'get', 'data', 'all_data']),
  agentId: z.string().min(1),
  metricId: z.string().optional(),
  metricKey: z.string().optional(),
  startTs: z.number().optional(),
  endTs: z.number().optional(),
  includeTimeSeries: z.boolean().optional(),
  limit: z.number().int().positive().max(100).optional(),
  startAfterId: z.string().optional(),
  mode: LightModeField,
});

const MetricSchema = z
  .object({
    key: z.string().min(1).max(100).optional(),
    type: z.enum(METRIC_TYPES).optional(),
    options: z.array(z.string()).optional(),
    description: z.string().max(500).optional(),
  })
  .strict();

const WriteSchema = z.object({
  action: z.enum(['create', 'update', 'delete']),
  agentId: z.string().min(1),
  metricId: z.string().optional(),
  metric: MetricSchema.optional(),
  mode: LightModeField,
});

const base = (agentId: string) => `/agents/${encodeURIComponent(agentId)}/custom-metrics`;
const DAY = 86_400;

/** Default reporting window: the last 30 days (unix seconds). */
function range(v: { startTs?: number; endTs?: number }) {
  const endTs = v.endTs ?? Math.floor(Date.now() / 1000);
  return { startTs: v.startTs ?? endTs - 30 * DAY, endTs };
}

const tools: Tool[] = [
  {
    name: 'custom_metrics_read',
    description:
      'Read the custom analytics metrics of an agent (values the AI extracts from each conversation or call, e.g. customer_satisfaction, booked_meeting). Actions: list, get (metricId), data (aggregated values for one metricKey in a time range: averages/sums for numbers, counts for boolean/enum/string), all_data (same for every metric). Time range defaults to the last 30 days; startTs/endTs are unix seconds. includeTimeSeries adds per-day points.',
    annotations: READ_ANNOTATIONS,
    inputSchema: {
      type: 'object',
      properties: {
        action: { type: 'string', enum: ['list', 'get', 'data', 'all_data'] },
        agentId: { type: 'string' },
        metricId: { type: 'string', description: 'Required for get.' },
        metricKey: { type: 'string', description: 'Required for data (the metric key, not its id).' },
        startTs: { type: 'number', description: 'Unix seconds. Default: 30 days ago.' },
        endTs: { type: 'number', description: 'Unix seconds. Default: now.' },
        includeTimeSeries: { type: 'boolean' },
        limit: { type: 'number', description: 'For list. Default 50, max 100.' },
        startAfterId: { type: 'string', description: 'For list pagination.' },
        mode: LightModeProperty,
      },
      required: ['action', 'agentId'],
    },
  },
  {
    name: 'custom_metrics_write',
    description:
      'Create, edit or delete a custom analytics metric on an agent. Actions: create (metric needs key + type + description; type enum also needs options), update (metricId + metric with only the fields to change; changing type can make old data inconsistent), delete (metricId; historical data stays but the metric stops being tracked). Metric: { key, type: number|boolean|enum|string, options?, description? }.',
    annotations: WRITE_ANNOTATIONS,
    inputSchema: {
      type: 'object',
      properties: {
        action: { type: 'string', enum: ['create', 'update', 'delete'] },
        agentId: { type: 'string' },
        metricId: { type: 'string', description: 'Required for update / delete.' },
        metric: {
          type: 'object',
          additionalProperties: false,
          properties: {
            key: { type: 'string', description: 'snake_case identifier, e.g. "customer_satisfaction".' },
            type: { type: 'string', enum: [...METRIC_TYPES] },
            options: { type: 'array', items: { type: 'string' }, description: 'Allowed values for type=enum.' },
            description: { type: 'string', description: 'What the AI should measure (max 500 chars). Required for create.' },
          },
        },
        mode: LightModeProperty,
      },
      required: ['action', 'agentId'],
    },
  },
];

export const customMetricsModule: ToolModule = {
  tools,
  handlers: {
    custom_metrics_read: wrapHandler('custom_metrics_read', async (args) => {
      const v = ReadSchema.parse(args);
      const client = getActiveClient();
      switch (v.action) {
        case 'list':
          return applyLightMode(
            v.mode,
            await client.api('GET', base(v.agentId), {
              query: { limit: v.limit, startAfterId: v.startAfterId },
            })
          );
        case 'get':
          requireFor(v.action, v, 'metricId');
          return applyLightMode(
            v.mode,
            await client.api('GET', `${base(v.agentId)}/${encodeURIComponent(v.metricId!)}`)
          );
        case 'data':
          requireFor(v.action, v, 'metricKey');
          return applyLightMode(
            v.mode,
            await client.api('GET', `${base(v.agentId)}/${encodeURIComponent(v.metricKey!)}/data`, {
              query: { ...range(v), includeTimeSeries: v.includeTimeSeries ?? false },
            })
          );
        case 'all_data':
          // This route is registered with its own /v3 prefix on the API.
          return applyLightMode(
            v.mode,
            await client.api('GET', `/v3${base(v.agentId)}/data`, {
              query: { ...range(v), includeTimeSeries: v.includeTimeSeries ?? false },
            })
          );
      }
    }),
    custom_metrics_write: wrapHandler('custom_metrics_write', async (args) => {
      const v = WriteSchema.parse(args);
      const client = getActiveClient();
      switch (v.action) {
        case 'create':
          requireFor(v.action, v, 'metric');
          requireFor('create', v.metric as Record<string, unknown>, 'key', 'type', 'description');
          if (v.metric!.type === 'enum' && !v.metric!.options?.length) {
            throw new Error('metric.options is required for type=enum');
          }
          return applyLightMode(
            v.mode,
            await client.api('POST', base(v.agentId), { body: { metric: v.metric } })
          );
        case 'update':
          requireFor(v.action, v, 'metricId', 'metric');
          return applyLightMode(
            v.mode,
            await client.api('PUT', `${base(v.agentId)}/${encodeURIComponent(v.metricId!)}`, {
              body: { metric: v.metric },
            })
          );
        case 'delete':
          requireFor(v.action, v, 'metricId');
          return client.api('DELETE', `${base(v.agentId)}/${encodeURIComponent(v.metricId!)}`);
      }
    }),
  },
};
