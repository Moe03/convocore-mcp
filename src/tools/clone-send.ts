import type { Tool } from '@modelcontextprotocol/sdk/types.js';
import { z } from 'zod';
import { getActiveClient } from '../request-context.js';
import { type ToolModule, wrapHandler } from './helpers.js';

const CloneSchema = z.object({
  agentId: z.string(),
  overrides: z
    .object({
      title: z.string().optional(),
      description: z.string().optional(),
      systemPrompt: z.string().optional(),
      theme: z
        .object({
          primaryColor: z.string().optional(),
          themeType: z.enum(['light', 'dark']).optional(),
        })
        .optional(),
      vg_initMessages: z.array(z.string()).optional(),
    })
    .optional(),
  carryOver: z
    .object({
      kb: z.boolean().optional(),
      voiceConfig: z.boolean().optional(),
      uiEngineConfig: z.boolean().optional(),
    })
    .optional(),
});

const SendSchema = z
  .object({
    agentId: z.string(),
    convoId: z.string(),
    message: z.string().min(1).optional(),
    messages: z.array(z.record(z.unknown())).optional(),
    sourceLabel: z.string().optional(),
    options: z.record(z.unknown()).optional(),
  })
  .superRefine((v, ctx) => {
    if (!v.message && (!v.messages || v.messages.length === 0)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Provide message or messages[]',
        path: ['message'],
      });
    }
  });

const tools: Tool[] = [
  {
    name: 'clone_agent',
    description:
      'Clone an existing Convocore agent with optional overrides and carryOver flags (kb, voiceConfig, uiEngineConfig). Never inherits branding or funnel recipients. Prefer this over manually recreating. Distinct from create_agent_from_template / import_agent.',
    annotations: {
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: false,
      openWorldHint: true,
    },
    inputSchema: {
      type: 'object',
      properties: {
        agentId: { type: 'string', description: 'Source agent to clone.' },
        overrides: {
          type: 'object',
          properties: {
            title: { type: 'string' },
            description: { type: 'string' },
            systemPrompt: { type: 'string' },
            theme: {
              type: 'object',
              properties: {
                primaryColor: { type: 'string' },
                themeType: { type: 'string', enum: ['light', 'dark'] },
              },
            },
            vg_initMessages: { type: 'array', items: { type: 'string' } },
          },
        },
        carryOver: {
          type: 'object',
          properties: {
            kb: { type: 'boolean', description: 'Default false.' },
            voiceConfig: { type: 'boolean', description: 'Default true.' },
            uiEngineConfig: { type: 'boolean', description: 'Default true.' },
          },
        },
      },
      required: ['agentId'],
    },
  },
  {
    name: 'send_channel_message',
    description:
      'Push an agent-initiated message onto the conversation channel (WhatsApp, Messenger, Instagram, Telegram, SMS, Discord). Does NOT run the LLM — text is sent as-is. Subject to provider rules (e.g. Meta 24h window). Do NOT use update_conversation_messages for channel delivery (that only updates stored history).',
    annotations: {
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: false,
      openWorldHint: true,
    },
    inputSchema: {
      type: 'object',
      properties: {
        agentId: { type: 'string' },
        convoId: { type: 'string' },
        message: {
          type: 'string',
          description: 'Plain text body (required unless messages is set).',
        },
        messages: {
          type: 'array',
          items: { type: 'object' },
          description: 'Structured channel messages when not using message.',
        },
        sourceLabel: { type: 'string' },
        options: { type: 'object' },
      },
      required: ['agentId', 'convoId'],
    },
  },
];

export const cloneSendModule: ToolModule = {
  tools,
  handlers: {
    clone_agent: wrapHandler('clone_agent', async (args) => {
      const v = CloneSchema.parse(args);
      return getActiveClient().cloneAgent(v.agentId, {
        overrides: v.overrides,
        carryOver: v.carryOver,
      });
    }),
    send_channel_message: wrapHandler('send_channel_message', async (args) => {
      const v = SendSchema.parse(args);
      return getActiveClient().sendChannelMessage(v.agentId, v.convoId, {
        message: v.message,
        messages: v.messages,
        sourceLabel: v.sourceLabel,
        options: v.options,
      });
    }),
  },
};
