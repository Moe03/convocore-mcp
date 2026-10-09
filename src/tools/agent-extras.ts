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

const AuditSchema = z.object({
  agentId: z.string().min(1),
  limit: z.number().int().positive().max(100).optional(),
  cursorTs: z.number().optional(),
  mode: LightModeField,
});

const ReminderSchema = z.object({ agentId: z.string().min(1), userId: z.string().min(1) });

const SummariesSchema = z.object({
  agentId: z.string().optional(),
  convoIds: z.array(z.string().min(1)).max(25).optional(),
  items: z
    .array(z.object({ convoId: z.string().min(1), transcript: z.string() }))
    .max(25)
    .optional(),
  mode: LightModeField,
});

const TemplatesSchema = z.object({
  action: z.enum(['list', 'create']),
  templateId: z.string().optional(),
  title: z.string().optional(),
  description: z.string().optional(),
  mode: LightModeField,
});

const NotificationSchema = z.object({
  action: z.enum(['request_code', 'verify_code', 'set_subscription', 'unsubscribe']),
  email: z.string().email().optional(),
  code: z.string().regex(/^[0-9]{6}$/, 'The code is 6 digits').optional(),
  token: z.string().optional(),
  subscribed: z.boolean().optional(),
});

function messageText(message: any): string {
  const payload = message?.item?.payload ?? message?.payload;
  if (typeof payload === 'string') return payload;
  if (typeof payload?.message === 'string') return payload.message;
  if (typeof payload?.text === 'string') return payload.text;
  return '';
}

/** Plain "speaker: text" transcript from a stored conversation. */
function transcriptOf(conversation: any): string {
  const doc = conversation?.data ?? conversation ?? {};
  const turns: any[] = doc.turns || doc.messages || doc.history || doc.convo?.turns || [];
  return turns
    .map((turn) => {
      const texts = (Array.isArray(turn?.messages) ? turn.messages : [turn])
        .map(messageText)
        .filter(Boolean);
      return texts.length ? `${turn?.from || 'unknown'}: ${texts.join(' ')}` : '';
    })
    .filter(Boolean)
    .join('\n');
}

const tools: Tool[] = [
  {
    name: 'get_agent_audit_log',
    description:
      'Read the change history of an agent: who changed what and when (newest first). Use it to explain an unexpected behaviour change or find when a setting was edited. Paginate by passing the ts of the last entry as cursorTs.',
    annotations: READ_ANNOTATIONS,
    inputSchema: {
      type: 'object',
      properties: {
        agentId: { type: 'string' },
        limit: { type: 'number', description: 'Max 100.' },
        cursorTs: { type: 'number', description: 'Return entries older than this timestamp.' },
        mode: LightModeProperty,
      },
      required: ['agentId'],
    },
  },
  {
    name: 'send_handoff_reminder',
    description:
      'Re-send the human-handoff notification for a conversation that is waiting for a human (emails the team again). userId is the conversation / end-user id. Sends a real email.',
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true },
    inputSchema: {
      type: 'object',
      properties: {
        agentId: { type: 'string' },
        userId: { type: 'string', description: 'Conversation / end-user id waiting for a human.' },
      },
      required: ['agentId', 'userId'],
    },
  },
  {
    name: 'generate_conversation_summaries',
    description:
      'Generate one-paragraph AI summaries for up to 25 conversations, in each conversation language. Simple form: agentId + convoIds (transcripts are loaded for you). Advanced: items [{ convoId, transcript }] with your own text. Returns the summaries only — it does not store them (use update_conversation to save one).',
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: false, openWorldHint: true },
    inputSchema: {
      type: 'object',
      properties: {
        agentId: { type: 'string', description: 'Required with convoIds.' },
        convoIds: { type: 'array', items: { type: 'string' }, description: 'Up to 25 conversation ids.' },
        items: {
          type: 'array',
          items: {
            type: 'object',
            properties: { convoId: { type: 'string' }, transcript: { type: 'string' } },
            required: ['convoId', 'transcript'],
          },
        },
        mode: LightModeProperty,
      },
    },
  },
  {
    name: 'agent_gallery_templates',
    description:
      'The ready-made agent templates shown in the dashboard gallery. Actions: list (available templates with their templateId), create (templateId, optional title / description: creates a new agent from that template as-is). To build a custom agent for a specific business use create_agent_from_template instead.',
    annotations: WRITE_ANNOTATIONS,
    inputSchema: {
      type: 'object',
      properties: {
        action: { type: 'string', enum: ['list', 'create'] },
        templateId: { type: 'string', description: 'Required for create.' },
        title: { type: 'string' },
        description: { type: 'string' },
        mode: LightModeProperty,
      },
      required: ['action'],
    },
  },
  {
    name: 'notification_email',
    description:
      'Manage an email address subscription to Convocore notification emails. The address owner must confirm with a 6-digit code. Actions: request_code (email: sends the code), verify_code (email + code: returns a token), set_subscription (token + subscribed true/false), unsubscribe (token). You cannot read the code yourself — ask the user for it.',
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true },
    inputSchema: {
      type: 'object',
      properties: {
        action: {
          type: 'string',
          enum: ['request_code', 'verify_code', 'set_subscription', 'unsubscribe'],
        },
        email: { type: 'string' },
        code: { type: 'string', description: '6 digits from the email.' },
        token: { type: 'string', description: 'From verify_code.' },
        subscribed: { type: 'boolean' },
      },
      required: ['action'],
    },
  },
];

export const agentExtrasModule: ToolModule = {
  tools,
  handlers: {
    get_agent_audit_log: wrapHandler('get_agent_audit_log', async (args) => {
      const v = AuditSchema.parse(args);
      return applyLightMode(
        v.mode,
        await getActiveClient().api('GET', `/agents/${encodeURIComponent(v.agentId)}/audit-log`, {
          query: { limit: v.limit, cursorTs: v.cursorTs },
        })
      );
    }),
    send_handoff_reminder: wrapHandler('send_handoff_reminder', async (args) => {
      const v = ReminderSchema.parse(args);
      return getActiveClient().api(
        'POST',
        `/agents/${encodeURIComponent(v.agentId)}/handoff/send-reminder`,
        { body: { userId: v.userId } }
      );
    }),
    generate_conversation_summaries: wrapHandler('generate_conversation_summaries', async (args) => {
      const v = SummariesSchema.parse(args);
      const client = getActiveClient();
      let items = v.items || [];
      const skipped: Array<{ convoId: string; reason: string }> = [];

      if (items.length === 0) {
        if (!v.agentId || !v.convoIds?.length) {
          throw new Error('Pass agentId + convoIds, or items [{ convoId, transcript }]');
        }
        const loaded = await Promise.allSettled(
          v.convoIds.map((convoId) => client.getConversation(v.agentId!, convoId))
        );
        loaded.forEach((result, index) => {
          const convoId = v.convoIds![index];
          if (result.status === 'rejected') {
            skipped.push({ convoId, reason: result.reason?.message || 'Could not load conversation' });
            return;
          }
          const transcript = transcriptOf(result.value);
          if (!transcript) {
            skipped.push({ convoId, reason: 'Conversation has no text messages' });
            return;
          }
          items.push({ convoId, transcript });
        });
      }

      if (items.length === 0) {
        return { success: false, message: 'No conversation could be summarized', skipped };
      }
      const result = await client.api('POST', '/agents/convos/generate-summaries', { body: { items } });
      return applyLightMode(v.mode, { ...result, ...(skipped.length ? { skipped } : {}) });
    }),
    agent_gallery_templates: wrapHandler('agent_gallery_templates', async (args) => {
      const v = TemplatesSchema.parse(args);
      const client = getActiveClient();
      if (v.action === 'list') {
        return applyLightMode(v.mode, await client.api('GET', '/agent-templates'));
      }
      requireFor(v.action, v, 'templateId');
      return applyLightMode(
        v.mode,
        await client.api('POST', `/agent-templates/${encodeURIComponent(v.templateId!)}/create`, {
          body: {
            ...(v.title ? { title: v.title } : {}),
            ...(v.description ? { description: v.description } : {}),
          },
        })
      );
    }),
    notification_email: wrapHandler('notification_email', async (args) => {
      const v = NotificationSchema.parse(args);
      const client = getActiveClient();
      switch (v.action) {
        case 'request_code':
          requireFor(v.action, v, 'email');
          return client.api('POST', '/notifications/email/request-code', { body: { email: v.email } });
        case 'verify_code':
          requireFor(v.action, v, 'email', 'code');
          return client.api('POST', '/notifications/email/verify-code', {
            body: { email: v.email, code: v.code },
          });
        case 'set_subscription':
          requireFor(v.action, v, 'token', 'subscribed');
          return client.api('POST', '/notifications/email/set', {
            body: { token: v.token, subscribed: v.subscribed },
          });
        case 'unsubscribe':
          requireFor(v.action, v, 'token');
          return client.api('POST', '/notifications/email/unsubscribe', { body: { token: v.token } });
      }
    }),
  },
};
