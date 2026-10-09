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
} from './helpers.js';

const E164 = z.string().regex(/^\+[1-9]\d{6,14}$/, 'Use E.164 format, e.g. +15551234567');

const CallSchema = z.object({
  agentId: z.string().min(1),
  to: E164,
  from: E164.optional(),
  campaignId: z.string().optional(),
  leadInfo: z.record(z.unknown()).optional(),
  options: z.record(z.unknown()).optional(),
  mode: LightModeField,
});

const SmsSchema = z.object({
  agentId: z.string().min(1),
  to: E164,
  message: z.string().optional(),
  sendMode: z.enum(['direct', 'agent']).optional(),
  from: E164.optional(),
  mediaUrls: z.array(z.string().url()).max(10).optional(),
  campaignId: z.string().optional(),
  convoId: z.string().optional(),
  leadInfo: z.record(z.unknown()).optional(),
  options: z.record(z.unknown()).optional(),
  mode: LightModeField,
});

const LeadsSchema = z.object({
  channel: z.enum(['call', 'sms']),
  agentId: z.string().min(1),
  leads: z.array(z.record(z.unknown())).min(1).max(500),
  message: z.string().optional(),
  sendMode: z.enum(['direct', 'agent']).optional(),
  from: E164.optional(),
  campaignId: z.string().optional(),
  contactMethodsPriority: z.array(z.string()).optional(),
  options: z.record(z.unknown()).optional(),
  mode: LightModeField,
});

const PhoneSchema = z.object({ agentId: z.string().min(1), mode: LightModeField });

// These place real calls / send real messages and bill the workspace: not idempotent.
const OUTBOUND_ANNOTATIONS = {
  readOnlyHint: false,
  destructiveHint: false,
  idempotentHint: false,
  openWorldHint: true,
} as const;

const leadInfoProperty = {
  type: 'object',
  description:
    'Optional details about the person (username, email, address, company, notes…) the agent can use to personalize.',
} as const;

const tools: Tool[] = [
  {
    name: 'get_agent_phone',
    description:
      'Get the phone number(s) assigned to an agent for voice calls. Check this before start_outbound_call — an agent without a number cannot call.',
    annotations: READ_ANNOTATIONS,
    inputSchema: {
      type: 'object',
      properties: { agentId: { type: 'string' }, mode: LightModeProperty },
      required: ['agentId'],
    },
  },
  {
    name: 'start_outbound_call',
    description:
      'Place a REAL outbound phone call now: the agent calls the "to" number from its assigned number and talks to whoever answers. Bills voice minutes. Confirm the number with the user first. For many leads at once use contact_leads or a campaign (campaigns_write).',
    annotations: OUTBOUND_ANNOTATIONS,
    inputSchema: {
      type: 'object',
      properties: {
        agentId: { type: 'string' },
        to: { type: 'string', description: 'Number to call, E.164 (e.g. +15551234567).' },
        from: { type: 'string', description: "Optional: one of the agent's numbers. Defaults to its primary number." },
        campaignId: { type: 'string', description: 'Optional: attribute the call to a campaign.' },
        leadInfo: leadInfoProperty,
        options: {
          type: 'object',
          description: 'Optional per-call agent overrides (e.g. initialPrompt, variables).',
        },
        mode: LightModeProperty,
      },
      required: ['agentId', 'to'],
    },
  },
  {
    name: 'send_sms',
    description:
      "Send a REAL SMS from the agent's connected SMS number. sendMode=direct (default) sends message as written; sendMode=agent lets the agent write the text (message is then optional). mediaUrls sends MMS. Bills the workspace. For WhatsApp / Messenger / Instagram replies use send_channel_message instead.",
    annotations: OUTBOUND_ANNOTATIONS,
    inputSchema: {
      type: 'object',
      properties: {
        agentId: { type: 'string' },
        to: { type: 'string', description: 'Recipient, E.164.' },
        message: { type: 'string', description: 'Text to send. Required for sendMode=direct.' },
        sendMode: { type: 'string', enum: ['direct', 'agent'] },
        from: { type: 'string', description: "Optional: a specific connected number. Defaults to the agent's primary SMS number." },
        mediaUrls: { type: 'array', items: { type: 'string' }, description: 'Up to 10 MMS media URLs.' },
        campaignId: { type: 'string' },
        convoId: { type: 'string', description: 'Optional custom conversation id. Defaults to the recipient digits.' },
        leadInfo: leadInfoProperty,
        options: { type: 'object', description: 'Optional per-message agent overrides.' },
        mode: LightModeProperty,
      },
      required: ['agentId', 'to'],
    },
  },
  {
    name: 'contact_leads',
    description:
      'Call or text a LIST of leads in one go (real calls / real SMS, billed). channel=call queues an outbound call to each lead; channel=sms sends each lead a message (message required unless sendMode=agent). leads are lead objects from leads_read (they must carry a phone, e.g. userPhone). Max 500 per call. Confirm the audience with the user first. For scheduled, throttled dialing use a campaign (campaigns_write).',
    annotations: OUTBOUND_ANNOTATIONS,
    inputSchema: {
      type: 'object',
      properties: {
        channel: { type: 'string', enum: ['call', 'sms'] },
        agentId: { type: 'string' },
        leads: { type: 'array', items: { type: 'object' } },
        message: { type: 'string', description: 'For channel=sms.' },
        sendMode: { type: 'string', enum: ['direct', 'agent'], description: 'For channel=sms.' },
        from: { type: 'string', description: 'For channel=sms: specific sender number.' },
        campaignId: { type: 'string' },
        contactMethodsPriority: {
          type: 'array',
          items: { type: 'string' },
          description: 'Lead fields to read the phone from, in order. Default ["userPhone", "phone", "userID"].',
        },
        options: { type: 'object' },
        mode: LightModeProperty,
      },
      required: ['channel', 'agentId', 'leads'],
    },
  },
];

const DEFAULT_PHONE_FIELDS = ['userPhone', 'phone', 'userID'];

export const outboundModule: ToolModule = {
  tools,
  handlers: {
    get_agent_phone: wrapHandler('get_agent_phone', async (args) => {
      const v = PhoneSchema.parse(args);
      return applyLightMode(
        v.mode,
        await getActiveClient().api('GET', `/agents/${encodeURIComponent(v.agentId)}/phone`)
      );
    }),
    start_outbound_call: wrapHandler('start_outbound_call', async (args) => {
      const { mode, ...body } = CallSchema.parse(args);
      return applyLightMode(mode, await getActiveClient().api('POST', '/calls', { body }));
    }),
    send_sms: wrapHandler('send_sms', async (args) => {
      const { mode, sendMode, ...rest } = SmsSchema.parse(args);
      if ((sendMode ?? 'direct') === 'direct') requireFor('send_sms (sendMode=direct)', rest, 'message');
      return applyLightMode(
        mode,
        await getActiveClient().api('POST', '/sms', { body: { ...rest, mode: sendMode ?? 'direct' } })
      );
    }),
    contact_leads: wrapHandler('contact_leads', async (args) => {
      const v = LeadsSchema.parse(args);
      const client = getActiveClient();
      const priority = v.contactMethodsPriority?.length ? v.contactMethodsPriority : DEFAULT_PHONE_FIELDS;
      if (v.channel === 'call') {
        return applyLightMode(
          v.mode,
          await client.api('POST', '/callLeads', {
            body: {
              agentId: v.agentId,
              leads: v.leads,
              leadsPerCampaign: v.leads.length,
              // (sic) the API field is spelled this way.
              contactMethodsPriorty: priority,
            },
          })
        );
      }
      if ((v.sendMode ?? 'direct') === 'direct') requireFor('contact_leads (sms, sendMode=direct)', v, 'message');
      return applyLightMode(
        v.mode,
        await client.api('POST', '/smsLeads', {
          body: {
            agentId: v.agentId,
            leads: v.leads,
            message: v.message,
            mode: v.sendMode ?? 'direct',
            from: v.from,
            campaignId: v.campaignId,
            options: v.options,
            contactMethodsPriority: priority,
          },
        })
      );
    }),
  },
};
