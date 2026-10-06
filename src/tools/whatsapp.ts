import type { Tool } from '@modelcontextprotocol/sdk/types.js';
import { z } from 'zod';
import { getActiveClient } from '../request-context.js';
import { type ToolModule, wrapHandler } from './helpers.js';

const MATCH_MODES = ['always_reply_regardless', 'phrases_only', 'phrases_then_ai', 'ai_only'] as const;
const APPLY_WHEN = ['every_message', 'first_message_only'] as const;
const AFTER_OWNERSHIP_MODES = ['always_reply', 'continue_rules'] as const;
const PARTICIPANT_LIST_MODES = ['none', 'allowlist', 'denylist'] as const;
const WEEK_DAYS = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'] as const;
const TIME_OF_DAY = /^([01]\d|2[0-3]):([0-5]\d)$/;

// strict(): a misspelled key would otherwise be dropped silently and the rule left unchanged.
const AvailabilitySchema = z
  .object({
    enabled: z.boolean().optional(),
    timezone: z.string().optional(),
    days: z.array(z.enum(WEEK_DAYS)).optional(),
    startTime: z.string().regex(TIME_OF_DAY, 'Use 24h HH:mm').optional(),
    endTime: z.string().regex(TIME_OF_DAY, 'Use 24h HH:mm').optional(),
  })
  .strict();

const RulesSchema = z
  .object({
    enabled: z.boolean().optional(),
    matchMode: z.enum(MATCH_MODES).optional(),
    aiRule: z.string().optional(),
    aiModelId: z.string().optional(),
    triggerPhrases: z.array(z.string()).optional(),
    applyWhen: z.enum(APPLY_WHEN).optional(),
    afterOwnershipMode: z.enum(AFTER_OWNERSHIP_MODES).optional(),
    participantListMode: z.enum(PARTICIPANT_LIST_MODES).optional(),
    participantList: z.array(z.string()).optional(),
    availability: AvailabilitySchema.optional(),
    analyzeAttachmentsBeforeDecision: z.boolean().optional(),
    enableHumanHandoffTool: z.boolean().optional(),
  })
  .strict()
  .refine((rules) => Object.keys(rules).length > 0, {
    message: 'rules must contain at least one field to change',
  });

const NumberSettingsSchema = z
  .object({
    aiPaused: z.boolean().optional(),
    newContactsOnly: z.boolean().optional(),
    aiReplyRule: z.string().optional(),
    applyAiReplyRuleDuringHumanChatting: z.boolean().optional(),
    coexistenceSettings: z
      .object({
        humanInactivityTimeoutMinutes: z.number().min(0).optional(),
        aiTakeoverMode: z.enum(['silent', 'announce']).optional(),
        aiTakeoverMessage: z.string().optional(),
        ownerReplyWhileAiActiveMode: z
          .enum(['continue_rules', 'switch_to_human_chatting'])
          .optional(),
      })
      .strict()
      .optional(),
  })
  .strict()
  .refine((settings) => Object.keys(settings).length > 0, {
    message: 'settings must contain at least one field to change',
  });

const GetSchema = z.object({ agentId: z.string().min(1) });
const UpdateRulesSchema = z.object({ agentId: z.string().min(1), rules: RulesSchema });
const UpdateNumberSchema = z.object({
  agentId: z.string().min(1),
  phoneId: z.string().min(1),
  settings: NumberSettingsSchema,
});

const tools: Tool[] = [
  {
    name: 'get_whatsapp_ai_rules',
    description:
      'Read the WhatsApp "AI rules" of a Convocore agent: the rules that decide whether the AI replies to an inbound WhatsApp message (dashboard: Channels → WhatsApp → AI rules). ' +
      'Returns inboundEngagement (null when never configured — then the AI replies to everything except what the legacy per-number guards block), the defaults, every WhatsApp number assigned to the agent with its phoneId and AI settings (aiPaused, newContactsOnly, coexistenceSettings), and warnings for configurations that keep the AI silent. ' +
      'Meta credentials are never returned. Call this before update_whatsapp_ai_rules / update_whatsapp_number_settings.',
    annotations: {
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: true,
    },
    inputSchema: {
      type: 'object',
      properties: { agentId: { type: 'string' } },
      required: ['agentId'],
    },
  },
  {
    name: 'update_whatsapp_ai_rules',
    description:
      'Change the WhatsApp "AI rules" of a Convocore agent — when the AI should or should not reply to inbound WhatsApp messages. Partial update: send only the fields to change; lists (triggerPhrases, participantList, availability.days) are replaced as a whole, so read them first with get_whatsapp_ai_rules to add or remove one entry. ' +
      'Decision order for each inbound message: availability schedule → participant list → thread ownership → trigger phrases → aiRule. ' +
      'Does NOT change what the agent says (use update_agent / patch_agent_prompt) and does NOT pause a number (use update_whatsapp_number_settings aiPaused). ' +
      'The response carries warnings when the saved combination would keep the AI silent — relay them to the user.',
    annotations: {
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: true,
    },
    inputSchema: {
      type: 'object',
      properties: {
        agentId: { type: 'string' },
        rules: {
          type: 'object',
          additionalProperties: false,
          description: 'Fields to change. Omitted fields keep their current value.',
          properties: {
            enabled: {
              type: 'boolean',
              description:
                'Master switch. false turns the rules off: the AI replies to every message, subject only to the legacy per-number guards.',
            },
            matchMode: {
              type: 'string',
              enum: [...MATCH_MODES],
              description:
                'always_reply_regardless: reply to everything (ignores phrases, aiRule and the participant list; the schedule still applies). phrases_only: reply only when a trigger phrase is in the message. phrases_then_ai (default): a trigger phrase replies immediately, otherwise aiRule decides. ai_only: aiRule decides every time.',
            },
            aiRule: {
              type: 'string',
              description:
                'Plain-language rule an LLM evaluates against the message and recent history to decide whether to reply, e.g. "Reply only to questions about bookings or prices. Ignore personal chats and messages from suppliers." Required for ai_only; without it phrases_then_ai only replies on phrase matches.',
            },
            triggerPhrases: {
              type: 'array',
              items: { type: 'string' },
              description: 'Words/phrases/tags that trigger an immediate reply without consulting aiRule. Replaces the whole list.',
            },
            applyWhen: {
              type: 'string',
              enum: [...APPLY_WHEN],
              description:
                'every_message (default): decide on each message. first_message_only: decide once per conversation — if the first decision is "do not reply", the whole thread is ignored from then on.',
            },
            afterOwnershipMode: {
              type: 'string',
              enum: [...AFTER_OWNERSHIP_MODES],
              description:
                'After the AI has replied once in a conversation: always_reply (default) keeps replying without re-checking, continue_rules re-applies the rules to every later message.',
            },
            participantListMode: {
              type: 'string',
              enum: [...PARTICIPANT_LIST_MODES],
              description:
                'none (default), allowlist: reply only to numbers in participantList, denylist: never reply to numbers in participantList. Checked before phrases and aiRule.',
            },
            participantList: {
              type: 'array',
              items: { type: 'string' },
              description: 'Customer WhatsApp numbers in international format (e.g. "+201001234567"). Replaces the whole list.',
            },
            availability: {
              type: 'object',
              additionalProperties: false,
              description:
                'Reply schedule. Outside it the AI stays silent (messages are still stored). Sub-fields are merged individually.',
              properties: {
                enabled: { type: 'boolean', description: 'false (default) = reply at any time.' },
                timezone: { type: 'string', description: 'IANA timezone, e.g. "Africa/Cairo".' },
                days: { type: 'array', items: { type: 'string', enum: [...WEEK_DAYS] } },
                startTime: { type: 'string', description: '24h HH:mm, e.g. "09:00".' },
                endTime: { type: 'string', description: '24h HH:mm, e.g. "18:00".' },
              },
            },
            analyzeAttachmentsBeforeDecision: {
              type: 'boolean',
              description: 'Default true: images/files are summarized and included in the reply decision.',
            },
            enableHumanHandoffTool: {
              type: 'boolean',
              description:
                'Adds (true) or removes (false) the built-in human-handoff tool on the agent start node, so the AI can hand the chat to a human.',
            },
            aiModelId: {
              type: 'string',
              description: 'Model that evaluates aiRule. Leave unset unless the user asks (default gemini-3.1-flash-lite).',
            },
          },
        },
      },
      required: ['agentId', 'rules'],
    },
  },
  {
    name: 'update_whatsapp_number_settings',
    description:
      'Change the AI behaviour of ONE WhatsApp number assigned to a Convocore agent (get phoneId from get_whatsapp_ai_rules). Partial update: send only the fields to change. ' +
      'Use aiPaused to stop/resume all AI replies on the number, and coexistenceSettings for numbers shared with the WhatsApp Business app. ' +
      'Does not connect, reassign or remove numbers, and never touches Meta credentials. For reply conditions (phrases, AI rule, schedule, allow/deny list) use update_whatsapp_ai_rules.',
    annotations: {
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: true,
    },
    inputSchema: {
      type: 'object',
      properties: {
        agentId: { type: 'string', description: 'Agent the number is assigned to.' },
        phoneId: { type: 'string', description: 'Meta WhatsApp phone number ID (not the phone number itself).' },
        settings: {
          type: 'object',
          additionalProperties: false,
          properties: {
            aiPaused: {
              type: 'boolean',
              description: 'true: inbound messages are stored but the AI never replies on this number, whatever the AI rules say.',
            },
            newContactsOnly: {
              type: 'boolean',
              description:
                'Legacy guard, only used while AI rules are not enabled: when not false, contacts synced from the WhatsApp Business app are skipped. Set false to let the AI reply to existing contacts too.',
            },
            aiReplyRule: {
              type: 'string',
              description:
                'Legacy free-text reply rule, only used while AI rules are not enabled. Prefer update_whatsapp_ai_rules aiRule.',
            },
            applyAiReplyRuleDuringHumanChatting: { type: 'boolean' },
            coexistenceSettings: {
              type: 'object',
              additionalProperties: false,
              description: 'Chat-ownership settings for coexistence numbers. Sub-fields are merged individually.',
              properties: {
                humanInactivityTimeoutMinutes: {
                  type: 'number',
                  description: 'Minutes of human silence before a human-claimed chat returns to the AI. 0 = never (manual only).',
                },
                aiTakeoverMode: {
                  type: 'string',
                  enum: ['silent', 'announce'],
                  description: 'Whether the AI announces itself when it takes a chat back.',
                },
                aiTakeoverMessage: { type: 'string', description: 'Text sent when aiTakeoverMode is "announce".' },
                ownerReplyWhileAiActiveMode: {
                  type: 'string',
                  enum: ['continue_rules', 'switch_to_human_chatting'],
                  description:
                    'When the owner replies from the WhatsApp Business app while the AI is active: continue_rules keeps the AI rules active, switch_to_human_chatting hands the chat to the human.',
                },
              },
            },
          },
        },
      },
      required: ['agentId', 'phoneId', 'settings'],
    },
  },
];

export const whatsappModule: ToolModule = {
  tools,
  handlers: {
    get_whatsapp_ai_rules: wrapHandler('get_whatsapp_ai_rules', async (args) => {
      const v = GetSchema.parse(args);
      return getActiveClient().getWhatsappAiRules(v.agentId);
    }),
    update_whatsapp_ai_rules: wrapHandler('update_whatsapp_ai_rules', async (args) => {
      const v = UpdateRulesSchema.parse(args);
      return getActiveClient().updateWhatsappAiRules(v.agentId, v.rules);
    }),
    update_whatsapp_number_settings: wrapHandler('update_whatsapp_number_settings', async (args) => {
      const v = UpdateNumberSchema.parse(args);
      return getActiveClient().updateWhatsappNumberSettings(v.agentId, v.phoneId, v.settings);
    }),
  },
};
