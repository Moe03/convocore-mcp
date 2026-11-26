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
  action: z.enum(['list_dnc', 'list_callbacks']),
  agentId: z.string().min(1),
  campaignId: z.string().optional(),
  status: z.enum(['pending', 'dialing', 'done', 'cancelled', 'failed', 'skipped_dnc']).optional(),
  onlyThisAgent: z.boolean().optional(),
  mode: LightModeField,
});

const WriteSchema = z.object({
  action: z.enum(['add_dnc', 'remove_dnc', 'schedule_callback', 'reschedule_callback', 'cancel_callback']),
  agentId: z.string().min(1),
  phone: z.string().optional(),
  reason: z.string().optional(),
  localDateTime: z.string().optional(),
  timezone: z.string().optional(),
  campaignId: z.string().optional(),
  leadName: z.string().optional(),
  note: z.string().optional(),
  callbackId: z.string().optional(),
  mode: LightModeField,
});

const agentPath = (agentId: string) => `/agents/${encodeURIComponent(agentId)}`;

const tools: Tool[] = [
  {
    name: 'call_outcomes_read',
    description:
      "Read the Do Not Call list and scheduled callbacks (Call Back Later) for an agent's outbound calls. Actions: list_dnc (numbers that are never dialed by any campaign or outbound call; workspace-wide, onlyThisAgent=true to narrow), list_callbacks (scheduled follow-up calls with time, lead, status pending/dialing/done/cancelled/failed/skipped_dnc; optional campaignId and status filters). Campaign status breakdown: campaigns_read action=outcomes.",
    annotations: READ_ANNOTATIONS,
    inputSchema: {
      type: 'object',
      properties: {
        action: { type: 'string', enum: ['list_dnc', 'list_callbacks'] },
        agentId: { type: 'string' },
        campaignId: { type: 'string', description: 'For list_callbacks.' },
        status: { type: 'string', enum: ['pending', 'dialing', 'done', 'cancelled', 'failed', 'skipped_dnc'] },
        onlyThisAgent: { type: 'boolean', description: 'For list_dnc.' },
        mode: LightModeProperty,
      },
      required: ['action', 'agentId'],
    },
  },
  {
    name: 'call_outcomes_write',
    description:
      'Manage Do Not Call numbers and scheduled callbacks. Actions: add_dnc (phone, reason: block a number for every campaign and outbound call), remove_dnc (phone), schedule_callback (phone + localDateTime "YYYY-MM-DDTHH:mm" in the lead\'s local time; optional timezone (IANA, default campaign then workspace timezone), campaignId to use that campaign\'s prompt, leadName, note: the call is placed automatically at that time), reschedule_callback (callbackId + localDateTime and/or timezone/note), cancel_callback (callbackId). A number on the Do Not Call list cannot get a callback.',
    annotations: WRITE_ANNOTATIONS,
    inputSchema: {
      type: 'object',
      properties: {
        action: {
          type: 'string',
          enum: ['add_dnc', 'remove_dnc', 'schedule_callback', 'reschedule_callback', 'cancel_callback'],
        },
        agentId: { type: 'string' },
        phone: { type: 'string', description: 'International format, e.g. +97333001122.' },
        reason: { type: 'string', description: 'For add_dnc.' },
        localDateTime: { type: 'string', description: 'YYYY-MM-DDTHH:mm in local time.' },
        timezone: { type: 'string', description: 'IANA timezone, e.g. Asia/Bahrain.' },
        campaignId: { type: 'string' },
        leadName: { type: 'string' },
        note: { type: 'string' },
        callbackId: { type: 'string', description: 'For reschedule_callback / cancel_callback.' },
        mode: LightModeProperty,
      },
      required: ['action', 'agentId'],
    },
  },
];

export const callOutcomesModule: ToolModule = {
  tools,
  handlers: {
    call_outcomes_read: wrapHandler('call_outcomes_read', async (args) => {
      const v = ReadSchema.parse(args);
      const client = getActiveClient();
      if (v.action === 'list_dnc') {
        return applyLightMode(
          v.mode,
          await client.api('GET', `${agentPath(v.agentId)}/do-not-call`, { query: { onlyThisAgent: v.onlyThisAgent } })
        );
      }
      return applyLightMode(
        v.mode,
        await client.api('GET', `${agentPath(v.agentId)}/callbacks`, {
          query: { campaignId: v.campaignId, status: v.status },
        })
      );
    }),
    call_outcomes_write: wrapHandler('call_outcomes_write', async (args) => {
      const v = WriteSchema.parse(args);
      const client = getActiveClient();
      switch (v.action) {
        case 'add_dnc':
          requireFor(v.action, v, 'phone');
          return client.api('POST', `${agentPath(v.agentId)}/do-not-call`, { body: { phone: v.phone, reason: v.reason } });
        case 'remove_dnc':
          requireFor(v.action, v, 'phone');
          return client.api('POST', `${agentPath(v.agentId)}/do-not-call/remove`, { body: { phone: v.phone } });
        case 'schedule_callback':
          requireFor(v.action, v, 'phone');
          requireFor(v.action, v, 'localDateTime');
          return client.api('POST', `${agentPath(v.agentId)}/callbacks`, {
            body: {
              phone: v.phone,
              localDateTime: v.localDateTime,
              timezone: v.timezone,
              campaignId: v.campaignId,
              leadName: v.leadName,
              note: v.note,
            },
          });
        case 'reschedule_callback':
          requireFor(v.action, v, 'callbackId');
          return client.api('PATCH', `${agentPath(v.agentId)}/callbacks/${encodeURIComponent(v.callbackId!)}`, {
            body: { localDateTime: v.localDateTime, timezone: v.timezone, note: v.note },
          });
        case 'cancel_callback':
          requireFor(v.action, v, 'callbackId');
          return client.api('PATCH', `${agentPath(v.agentId)}/callbacks/${encodeURIComponent(v.callbackId!)}`, {
            body: { cancel: true },
          });
      }
    }),
  },
};
