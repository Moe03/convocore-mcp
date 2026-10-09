import type { Tool } from '@modelcontextprotocol/sdk/types.js';
import { z } from 'zod';
import { getActiveClient } from '../request-context.js';
import {
  type ToolModule,
  wrapHandler,
  LightModeField,
  LightModeProperty,
  applyLightMode,
  READ_ANNOTATIONS,
  WRITE_ANNOTATIONS,
} from './helpers.js';

const CHANNELS = ['whatsapp', 'messenger', 'instagram'] as const;

const ChannelsSchema = z.object({ agentId: z.string().min(1), mode: LightModeField });

const LinkSchema = z.object({
  channel: z.enum(CHANNELS),
  agentId: z.string().min(1),
  whatsappConnectionMode: z.enum(['metaCloudApi', 'metaCoexistence']).optional(),
  ttlMinutes: z.number().int().min(5).max(1440).optional(),
});

const StatusSchema = z.object({ sessionId: z.string().min(1) });

const DisconnectSchema = z.object({ agentId: z.string().min(1), pageId: z.string().min(1) });

const CHANNEL_LABEL: Record<(typeof CHANNELS)[number], string> = {
  whatsapp: 'WhatsApp',
  messenger: 'Facebook Messenger',
  instagram: 'Instagram',
};

const tools: Tool[] = [
  {
    name: 'get_agent_channels',
    description:
      'Check which channels are connected to an agent: WhatsApp numbers and Facebook pages (Messenger, plus Instagram when an Instagram account is linked to the page). Use it to answer "is my WhatsApp / Instagram connected?" and to confirm a connection after the user finished a connect link. Credentials are never returned. For WhatsApp reply rules use get_whatsapp_ai_rules.',
    annotations: READ_ANNOTATIONS,
    inputSchema: {
      type: 'object',
      properties: { agentId: { type: 'string' }, mode: LightModeProperty },
      required: ['agentId'],
    },
  },
  {
    name: 'create_channel_connect_link',
    description:
      'Create a private link the USER opens to connect WhatsApp, Messenger or Instagram to an agent. Connecting needs the user to log in with Meta in their own browser, so you cannot do it for them: create the link, show the returned url to the user as a clickable link, and tell them to come back and say when they are done. The page needs no Convocore login and expires (default 30 minutes). ' +
      'When the user says they finished, call get_agent_channels to confirm the channel is really connected before saying it works. ' +
      'messenger and instagram use the same page: the user picks a Facebook page; Instagram is connected when an Instagram account is linked to that page. ' +
      'whatsappConnectionMode: metaCloudApi (default, a number used only by the AI) or metaCoexistence (a number already used in the WhatsApp Business app, shared with the AI).',
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true },
    inputSchema: {
      type: 'object',
      properties: {
        channel: { type: 'string', enum: [...CHANNELS] },
        agentId: { type: 'string' },
        whatsappConnectionMode: { type: 'string', enum: ['metaCloudApi', 'metaCoexistence'] },
        ttlMinutes: { type: 'number', description: 'How long the link works. Default 30, max 1440.' },
      },
      required: ['channel', 'agentId'],
    },
  },
  {
    name: 'get_connect_link_status',
    description:
      'Check a connect link created with create_channel_connect_link: pending (not opened), opened / redeemed (the user is on the page), connected, error or expired. To verify the channel itself use get_agent_channels.',
    annotations: READ_ANNOTATIONS,
    inputSchema: {
      type: 'object',
      properties: { sessionId: { type: 'string', description: 'sessionId returned by create_channel_connect_link.' } },
      required: ['sessionId'],
    },
  },
  {
    name: 'disconnect_meta_page',
    description:
      'Disconnect a Facebook page from an agent: the agent stops answering Messenger and Instagram for that page. pageId comes from get_agent_channels. Confirm with the user first. To connect a page use create_channel_connect_link.',
    annotations: WRITE_ANNOTATIONS,
    inputSchema: {
      type: 'object',
      properties: { agentId: { type: 'string' }, pageId: { type: 'string' } },
      required: ['agentId', 'pageId'],
    },
  },
];

export const channelsModule: ToolModule = {
  tools,
  handlers: {
    get_agent_channels: wrapHandler('get_agent_channels', async (args) => {
      const v = ChannelsSchema.parse(args);
      return applyLightMode(
        v.mode,
        await getActiveClient().api('GET', `/agents/${encodeURIComponent(v.agentId)}/channels`)
      );
    }),
    create_channel_connect_link: wrapHandler('create_channel_connect_link', async (args) => {
      const v = LinkSchema.parse(args);
      const { channel, whatsappConnectionMode, ...rest } = v;
      const result = await getActiveClient().api('POST', '/connect-links', {
        body: {
          channel,
          ...rest,
          ...(channel === 'whatsapp' && whatsappConnectionMode ? { whatsappConnectionMode } : {}),
        },
      });
      const expiresAt = result?.expiresAtMs ? new Date(result.expiresAtMs).toISOString() : undefined;
      return {
        ...result,
        expiresAt,
        nextSteps: [
          `Show the url to the user as a clickable link: it opens the ${CHANNEL_LABEL[channel]} connect page (no Convocore login needed).`,
          'Ask the user to tell you when they have finished.',
          'Then call get_agent_channels to confirm the connection before telling them it works.',
        ],
      };
    }),
    get_connect_link_status: wrapHandler('get_connect_link_status', async (args) => {
      const v = StatusSchema.parse(args);
      return getActiveClient().api('GET', `/connect-links/${encodeURIComponent(v.sessionId)}`);
    }),
    disconnect_meta_page: wrapHandler('disconnect_meta_page', async (args) => {
      const v = DisconnectSchema.parse(args);
      return getActiveClient().api(
        'DELETE',
        `/agents/${encodeURIComponent(v.agentId)}/channels/meta-pages/${encodeURIComponent(v.pageId)}`
      );
    }),
  },
};
