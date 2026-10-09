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
  action: z.enum(['list', 'get']),
  agentId: z.string().min(1),
  campaignId: z.string().optional(),
  page: z.number().int().positive().optional(),
  limit: z.number().int().positive().max(100).optional(),
  mode: LightModeField,
});

const WriteSchema = z.object({
  action: z.enum(['create', 'update', 'delete', 'enable', 'disable', 'restart']),
  agentId: z.string().min(1),
  campaignId: z.string().optional(),
  campaign: z.record(z.unknown()).optional(),
  resetConversations: z.boolean().optional(),
  mode: LightModeField,
});

const base = (agentId: string) => `/agents/${encodeURIComponent(agentId)}/campaigns`;
const one = (agentId: string, campaignId: string) =>
  `${base(agentId)}/${encodeURIComponent(campaignId)}`;

const CAMPAIGN_FIELDS =
  'name, leadGroupName (a lead group name, or "all"), delayBetweenEachCall (seconds), concurrentSlots, initialPrompt, overrideInitialPrompt, postCallPrompt, postCallMetrics (custom metric ids), openTime / closeTime ("HH:mm" 24h), openDays (monday…sunday), timezone (IANA)';

const tools: Tool[] = [
  {
    name: 'campaigns_read',
    description:
      'Read outbound call campaigns of an agent. Actions: list (paginated, with progress counters: totalLeads, contactedLeads, successfulCalls, missingCalls, onGoingCalls), get (one campaign by campaignId). To change campaigns use campaigns_write. WhatsApp broadcast campaigns are not covered.',
    annotations: READ_ANNOTATIONS,
    inputSchema: {
      type: 'object',
      properties: {
        action: { type: 'string', enum: ['list', 'get'] },
        agentId: { type: 'string' },
        campaignId: { type: 'string', description: 'Required for get.' },
        page: { type: 'number' },
        limit: { type: 'number', description: 'Default 10.' },
        mode: LightModeProperty,
      },
      required: ['action', 'agentId'],
    },
  },
  {
    name: 'campaigns_write',
    description:
      'Create, edit, delete, start/stop or restart an outbound call campaign. Actions: ' +
      'create (campaign needs name + leadGroupName; created stopped unless enabled is true), ' +
      'update (partial: send only the fields to change in campaign), ' +
      'delete, ' +
      'enable (START dialing — places real phone calls to the lead group; resumes where it stopped), ' +
      'disable (stop), ' +
      'restart (start again from the first lead; resetConversations=true also clears earlier call conversations). ' +
      `Campaign fields: ${CAMPAIGN_FIELDS}. The agent needs an assigned phone number before a campaign can start.`,
    annotations: WRITE_ANNOTATIONS,
    inputSchema: {
      type: 'object',
      properties: {
        action: {
          type: 'string',
          enum: ['create', 'update', 'delete', 'enable', 'disable', 'restart'],
        },
        agentId: { type: 'string' },
        campaignId: { type: 'string', description: 'Required for every action except create.' },
        campaign: {
          type: 'object',
          description: `For create / update. ${CAMPAIGN_FIELDS}.`,
        },
        resetConversations: { type: 'boolean', description: 'For restart. Default false.' },
        mode: LightModeProperty,
      },
      required: ['action', 'agentId'],
    },
  },
];

export const campaignsModule: ToolModule = {
  tools,
  handlers: {
    campaigns_read: wrapHandler('campaigns_read', async (args) => {
      const v = ReadSchema.parse(args);
      const client = getActiveClient();
      if (v.action === 'get') {
        requireFor(v.action, v, 'campaignId');
        return applyLightMode(v.mode, await client.api('GET', one(v.agentId, v.campaignId!)));
      }
      return applyLightMode(
        v.mode,
        await client.api('GET', base(v.agentId), { query: { page: v.page, limit: v.limit } })
      );
    }),
    campaigns_write: wrapHandler('campaigns_write', async (args) => {
      const v = WriteSchema.parse(args);
      const client = getActiveClient();
      if (v.action !== 'create') requireFor(v.action, v, 'campaignId');

      switch (v.action) {
        case 'create': {
          requireFor(v.action, v, 'campaign');
          requireFor('create', v.campaign as Record<string, unknown>, 'name', 'leadGroupName');
          const body = { delayBetweenEachCall: 0, concurrentSlots: 1, enabled: false, ...v.campaign };
          return applyLightMode(v.mode, await client.api('POST', base(v.agentId), { body }));
        }
        case 'update': {
          requireFor(v.action, v, 'campaign');
          // The API replaces the whole campaign, so merge onto what is stored.
          const current = await client.api('GET', one(v.agentId, v.campaignId!));
          const campaignData = { ...current, ...v.campaign, id: v.campaignId };
          return applyLightMode(
            v.mode,
            await client.api('PATCH', base(v.agentId), { body: { campaignData } })
          );
        }
        case 'delete':
          return client.api('DELETE', base(v.agentId), { query: { campaignId: v.campaignId } });
        case 'enable':
        case 'disable': {
          const wantEnabled = v.action === 'enable';
          const current = await client.api('GET', one(v.agentId, v.campaignId!));
          if (Boolean(current?.enabled) === wantEnabled) {
            return { enabled: wantEnabled, changed: false, note: `Campaign was already ${wantEnabled ? 'running' : 'stopped'}.` };
          }
          // The API toggles the current state.
          const result = await client.api('PATCH', one(v.agentId, v.campaignId!), { body: {} });
          return { ...result, changed: Boolean(result?.enabled) === wantEnabled };
        }
        case 'restart':
          return client.api('PATCH', `${one(v.agentId, v.campaignId!)}/restart`, {
            body: { resetConversations: v.resetConversations ?? false },
          });
      }
    }),
  },
};
