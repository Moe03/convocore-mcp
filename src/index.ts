#!/usr/bin/env node

/**
 * Convocore MCP Server
 * Provides Model Context Protocol tools for managing Convocore AI agents
 */

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  ListPromptsRequestSchema,
  GetPromptRequestSchema,
  Tool,
} from '@modelcontextprotocol/sdk/types.js';
import { z } from 'zod';
import { exec } from 'node:child_process';
import { promisify } from 'node:util';
import { getConfig } from './config.js';
import { ConvocoreApiRequestError, ConvocoreClient } from './convocore-client.js';
import {
  getActiveClient,
  getActiveConfig,
  initDefaultRequestContext,
} from './request-context.js';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { WIDGET_CSS_SYSTEM_PROMPT, buildWidgetCssPrompt } from './css-prompt.js';
import { PRICING, VOICE_PROVIDERS } from './pricing.js';
import {
  TemplateIdempotencyStore,
  computeTemplateIdempotencyKey,
  runTemplateIdempotent,
} from './template-idempotency.js';
import {
  FALLBACK_CHAT_MODEL_ID,
  RECOMMENDED_CHAT_MODEL_ID,
  TEMPLATE_START_NODE_DEFAULTS,
  normalizeTemplateStartNodeArray,
} from './template-start-node.js';
import { UI_ENGINE_PRIMER, UI_ENGINE_SPEC } from './ui-engine-spec.js';
import { CHANNEL_INTEGRATION_SPEC } from './channel-integration-spec.js';
import { handleAutoGenPallet } from './agent-theme-palette.js';
import {
  applyExactStringReplace,
  unwrapRecord,
} from './text-patch.js';
import {
  MCP_SERVER_INSTRUCTIONS,
  buildPrototypeAgentUrl,
  buildVoiceSdkExample,
  buildWidgetEmbedSnippet,
  widgetRegionFromApiRegion,
  type WidgetEmbedMode,
} from './mcp-server-instructions.js';
import { checkUrls } from './url-check.js';

const execAsync = promisify(exec);

/** Public try-it links for tool payloads (eu|na + /prototype/{id}). */
function prototypeLinksForAgent(agentId: string | null | undefined): {
  region: 'eu' | 'na';
  prototypeUrl: string | null;
  tryItUrl: string | null;
} {
  const region = widgetRegionFromApiRegion(getActiveConfig().apiRegion);
  const id = typeof agentId === 'string' ? agentId.trim() : '';
  if (!id) {
    return { region, prototypeUrl: null, tryItUrl: null };
  }
  const prototypeUrl = buildPrototypeAgentUrl(id, region);
  return { region, prototypeUrl, tryItUrl: prototypeUrl };
}

function extractAgentIdFromPayload(payload: unknown): string | null {
  if (!payload || typeof payload !== 'object') return null;
  const root = payload as Record<string, unknown>;
  const data =
    root.data && typeof root.data === 'object'
      ? (root.data as Record<string, unknown>)
      : root;
  for (const key of ['ID', 'id', 'agentId'] as const) {
    const v = data[key];
    if (typeof v === 'string' && v.trim()) return v.trim();
  }
  const nested = data.agent;
  if (nested && typeof nested === 'object') {
    const agent = nested as Record<string, unknown>;
    for (const key of ['ID', 'id'] as const) {
      const v = agent[key];
      if (typeof v === 'string' && v.trim()) return v.trim();
    }
  }
  return null;
}

// Initialize stdio/default API client when WORKSPACE_SECRET is set (stdio / optional hosted fallback).
if (process.env.WORKSPACE_SECRET) {
  const defaultConfig = getConfig();
  initDefaultRequestContext(new ConvocoreClient(defaultConfig), defaultConfig);
}
const templateIdempotencyStore = new TemplateIdempotencyStore();

// Define tool schemas
const AgentNodeSchema = z
  .object({
    instructions: z
      .string()
      .optional()
      .describe('Main node prompt/instructions. For enableNodes=true agents, nodes[0].instructions is the canonical system prompt.'),
    name: z.string().optional().describe('Human-readable node name.'),
  })
  .passthrough();

const AgentVoiceConfigSchema = z
  .object({
    transcriber: z
      .object({
        provider: z
          .string()
          .optional()
          .describe('Speech-to-text provider, e.g. deepgram, gladia, assemblyai, speechmatics, google-cloud-speech.'),
        modelId: z.string().optional().describe('Provider-specific transcription model ID.'),
        language: z.string().optional().describe('BCP-47 or provider language code, e.g. en, en-US.'),
        patienceFactor: z.number().optional().describe('Optional speech endpointing / patience tuning.'),
        speechConfig: z
          .object({
            format: z.string().optional(),
            sampleRate: z.number().optional(),
            language: z.string().optional(),
          })
          .passthrough()
          .optional()
          .describe('Provider-specific speech input configuration.'),
        randomOptions: z.any().optional().describe('Provider-specific passthrough options.'),
      })
      .passthrough()
      .optional()
      .describe('Speech-to-text / transcription settings.'),
    speechGen: z
      .object({
        provider: z
          .string()
          .optional()
          .describe('Text-to-speech provider, e.g. elevenlabs, deepgram, cartesia.'),
        modelId: z.string().optional().describe('Provider-specific TTS model ID.'),
        voiceId: z.string().optional().describe('Provider-specific voice ID.'),
        apiKey: z.string().optional().describe('Optional provider API key override. Prefer workspace integrations when available.'),
        region: z.string().optional().describe('Provider-specific region.'),
        highAudioQuality: z.boolean().optional().describe('Enable higher-quality audio generation where supported.'),
        backgroundNoise: z.enum(['restaurant', 'office', 'park', 'street']).optional(),
        punctuationBreaks: z.array(z.string()).optional().describe('Punctuation tokens that should create speech breaks.'),
        platformSpecific: z.any().optional().describe('Provider-specific passthrough options.'),
      })
      .passthrough()
      .optional()
      .describe('Text-to-speech / speech generation settings.'),
    config: z
      .object({
        recordAudio: z.boolean().optional().describe('Whether voice calls should be recorded.'),
        enableWebCalling: z.boolean().optional().describe('Enable browser/web calling for this agent.'),
        backgroundNoise: z.enum(['restaurant', 'office', 'park', 'street']).optional(),
        firstInputChunkUNIXMs: z.number().optional().describe('Runtime timing field; usually read-only.'),
        firstOutputChunkUNIXMs: z.number().optional().describe('Runtime timing field; usually read-only.'),
      })
      .passthrough()
      .optional()
      .describe('General voice/call settings.'),
  })
  .passthrough();

/**
 * Agent-level UI Engine feature flags + per-channel element allowlist.
 * Master switch: vg_enableUIEngine. Forms / invoice / calendar also need their
 * dedicated flags. Channel keys omitted = enabled for that type.
 */
const UiEngineChannelTypeFlagsSchema = z
  .record(z.boolean())
  .optional()
  .describe(
    'Per message-type toggles for one channel. Keys include: choice, visual, cardV2, carousel, iFrame, form, input, invoice, calendarBooking, file, VoiceNote, locationRequest, ctaUrl. Missing key = enabled.'
  );

const UiEngineChannelConfigSchema = z
  .object({
    web: UiEngineChannelTypeFlagsSchema,
    whatsapp: UiEngineChannelTypeFlagsSchema,
    instagram: UiEngineChannelTypeFlagsSchema,
    messenger: UiEngineChannelTypeFlagsSchema,
    telegram: UiEngineChannelTypeFlagsSchema,
  })
  .passthrough()
  .optional()
  .describe(
    'Per-channel UI Engine element allowlist. Master switch is still vg_enableUIEngine. form/input also require vg_enableUIEngineForms; invoice requires vg_enableUIEngineInvoice; calendarBooking requires vg_enableUIEngineCalendarBooking.'
  );

const AgentUiEngineFieldsSchema = z.object({
  vg_enableUIEngine: z
    .boolean()
    .optional()
    .describe(
      'Master switch for structured UI Engine output (cards, buttons/choice, carousels, visuals, iFrames, etc.). When true, /interact returns UI Engine snapshots unless disableUiEngine=true is passed for a turn. Call get_ui_engine_spec for the message schema.'
    ),
  vg_enableUIEngineForms: z
    .boolean()
    .optional()
    .describe(
      'Allow UI Engine form + input elements (web channel). Also toggle form/input under vg_uiEngineChannelConfig.web when configuring per-channel.'
    ),
  vg_enableUIEngineInvoice: z
    .boolean()
    .optional()
    .describe(
      'Allow UI Engine invoice cards (web). Pair with vg_uiEngineInvoiceConfig for notify emails on button click.'
    ),
  vg_enableUIEngineCalendarBooking: z
    .boolean()
    .optional()
    .describe(
      'Allow UI Engine interactive calendar booking widget (web). Requires Google Calendar connection + vg_uiEngineCalendarConfig.connectionId/calendarId.'
    ),
  vg_maxImagesPerCard: z
    .union([z.literal(1), z.literal(2), z.literal(3)])
    .optional()
    .describe(
      'Max images per cardV2/carousel card. 1 = single imageUrl only (no images[] gallery). 2–3 allow images[] up to that count. Omit for platform default (up to 3).'
    ),
  vg_uiEngineChannelConfig: UiEngineChannelConfigSchema,
  vg_uiEngineFormNotifyConfig: z
    .object({
      enabled: z
        .boolean()
        .optional()
        .describe(
          'When true (default if unset), form/input submits and chat-end ratings email workspace members + assigned org clients.'
        ),
      extraEmails: z
        .array(z.string())
        .max(10)
        .optional()
        .describe('Up to 10 extra notification recipients beyond workspace/org defaults.'),
    })
    .optional()
    .describe('Email notification settings for UI Engine forms/inputs.'),
  vg_uiEngineInvoiceConfig: z
    .object({
      notifyOnButtonClick: z
        .boolean()
        .optional()
        .describe(
          'When true, invoice action button clicks email notifyEmails (chat summary + invoice + contact + convo link).'
        ),
      notifyEmails: z
        .array(z.string())
        .optional()
        .describe('Recipients for invoice button-click notifications.'),
    })
    .optional()
    .describe('Post-booking/payment notification config for invoice cards.'),
  vg_uiEngineCalendarConfig: z
    .object({
      connectionId: z
        .string()
        .optional()
        .describe('Google Calendar connection ID for availability + booking.'),
      calendarId: z
        .string()
        .optional()
        .describe('Calendar ID within the connected Google account.'),
      timezoneMode: z
        .enum(['auto', 'fixed'])
        .optional()
        .describe('auto = detect visitor timezone; fixed = use fixedTimezone.'),
      fixedTimezone: z
        .string()
        .optional()
        .describe('IANA timezone when timezoneMode is fixed.'),
      defaultDurationMinutes: z
        .number()
        .optional()
        .describe('Default meeting duration in minutes (often 30).'),
      bufferMinutes: z
        .number()
        .optional()
        .describe('Buffer minutes between booked events.'),
      daysAhead: z
        .number()
        .optional()
        .describe('How many days ahead visitors may book.'),
      suggestedFields: z
        .array(
          z.object({
            id: z.string(),
            type: z.string(),
            label: z.string(),
            required: z.boolean().optional(),
          })
        )
        .optional()
        .describe('Confirmation fields (name, email, …) collected after a slot is picked.'),
    })
    .optional()
    .describe('Calendar booking widget configuration.'),
});

/** JSON Schema props shared by create_agent / update_agent tool definitions. */
const AgentUiEngineInputSchemaProperties = {
  vg_enableUIEngine: {
    type: 'boolean',
    description:
      'MASTER SWITCH for UI Engine. When true the agent can emit structured UI (text, choice/buttons, visual, cardV2, carousel, iFrame, and — if their flags are on — form/input, invoice, calendarBooking). Call get_ui_engine_spec for payloads. Prefer enabling this before toggling individual elements.',
  },
  vg_enableUIEngineForms: {
    type: 'boolean',
    description:
      'Allow form + input UI Engine elements (typically web). Set true to let the agent collect structured fields. Also set vg_uiEngineChannelConfig.web.form / .input as needed.',
  },
  vg_enableUIEngineInvoice: {
    type: 'boolean',
    description:
      'Allow invoice card UI Engine elements (web). Use with vg_uiEngineInvoiceConfig for click notifications.',
  },
  vg_enableUIEngineCalendarBooking: {
    type: 'boolean',
    description:
      'Allow interactive calendar booking widget (web). Requires Google Calendar connectionIds in vg_uiEngineCalendarConfig.',
  },
  vg_maxImagesPerCard: {
    type: 'number',
    enum: [1, 2, 3],
    description:
      'Max images per cardV2/carousel card: 1 = imageUrl only; 2–3 allow images[] gallery. Omit for platform default.',
  },
  vg_uiEngineChannelConfig: {
    type: 'object',
    description:
      'Per-channel allowlist of which UI Engine elements the agent may show. Channels: web, whatsapp, instagram, messenger, telegram. Each channel is an object of type→boolean (choice, visual, cardV2, carousel, iFrame, form, input, invoice, calendarBooking, file, VoiceNote, locationRequest, ctaUrl). Missing type = enabled. Example: { "web": { "choice": true, "cardV2": true, "form": true, "invoice": false }, "whatsapp": { "choice": true, "cardV2": true, "form": false } }. Forms/invoice/calendar still need their global vg_enableUIEngine* flags.',
    properties: {
      web: { type: 'object', additionalProperties: { type: 'boolean' } },
      whatsapp: { type: 'object', additionalProperties: { type: 'boolean' } },
      instagram: { type: 'object', additionalProperties: { type: 'boolean' } },
      messenger: { type: 'object', additionalProperties: { type: 'boolean' } },
      telegram: { type: 'object', additionalProperties: { type: 'boolean' } },
    },
    additionalProperties: true,
  },
  vg_uiEngineFormNotifyConfig: {
    type: 'object',
    description: 'Email notify settings when forms/inputs are submitted.',
    properties: {
      enabled: { type: 'boolean', description: 'Email workspace/org on form submit + chat-end ratings (default true if unset).' },
      extraEmails: {
        type: 'array',
        items: { type: 'string' },
        maxItems: 10,
        description: 'Up to 10 extra recipients.',
      },
    },
  },
  vg_uiEngineInvoiceConfig: {
    type: 'object',
    description: 'Invoice card notification settings.',
    properties: {
      notifyOnButtonClick: { type: 'boolean', description: 'Email notifyEmails when an invoice action button is clicked.' },
      notifyEmails: { type: 'array', items: { type: 'string' }, description: 'Invoice notification recipients.' },
    },
  },
  vg_uiEngineCalendarConfig: {
    type: 'object',
    description: 'Calendar booking widget config (Google Calendar connection + booking rules).',
    properties: {
      connectionId: { type: 'string', description: 'Google Calendar connection ID.' },
      calendarId: { type: 'string', description: 'Calendar ID to book against.' },
      timezoneMode: { type: 'string', enum: ['auto', 'fixed'] },
      fixedTimezone: { type: 'string', description: 'IANA timezone when timezoneMode=fixed.' },
      defaultDurationMinutes: { type: 'number' },
      bufferMinutes: { type: 'number' },
      daysAhead: { type: 'number' },
      suggestedFields: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            id: { type: 'string' },
            type: { type: 'string' },
            label: { type: 'string' },
            required: { type: 'boolean' },
          },
          required: ['id', 'type', 'label'],
        },
      },
    },
  },
} as const;

const CreateAgentSchema = z.object({
  title: z.string().describe('The title of the agent'),
  description: z.string().optional().describe('A brief description of the agent'),
  theme: z.string().optional().describe('Visual theme (e.g., blue-light, custom-blue-dark)'),
  disabled: z.boolean().optional().describe('Whether the agent should be disabled'),
  light: z.boolean().optional().describe('Enable light mode (no chat history retention)'),
  enableVertex: z.boolean().optional().describe('Enable Vertex AI'),
  autoOpenWidget: z.boolean().optional().describe('Auto-open widget on load'),
  enableNodes: z.boolean().optional().describe('If true, use node-based agent behavior and read the main prompt from nodes[0].instructions'),
  vg_instructions: z.string().optional().describe('Legacy main prompt field for old agents where enableNodes is false or nodes are absent'),
  voiceConfig: AgentVoiceConfigSchema.optional().describe('Agent voice configuration for transcription, speech generation, and call settings'),
  nodes: z.array(AgentNodeSchema).optional().describe('Agent nodes; when enableNodes=true, nodes[0].instructions is the canonical main/system prompt'),
  additionalConfig: z.record(z.any()).optional().describe('Escape hatch for raw agent fields not modeled by this MCP yet; not a primary API concept'),
}).merge(AgentUiEngineFieldsSchema);

const HexColorSchema = z
  .string()
  .trim()
  .transform((s) => (s.startsWith('#') ? s : `#${s}`))
  .refine(
    (s) => /^#[0-9A-Fa-f]{3}$|^#[0-9A-Fa-f]{6}$/.test(s),
    'primaryColor must be 3- or 6-digit hex, e.g. #226D7A'
  );

const CreateAgentFromTemplateSchema = z
  .object({
    title: z.string().min(1).optional().describe('Agent display title. Optional when sourceUrl/url is provided (auto-generated from domain).'),
    description: z.string().optional().describe('Short description'),
    systemPrompt: z
      .string()
      .min(1)
      .optional()
      .describe('Canonical chat / text system instructions. If omitted, MCP generates one from sourceUrl/url context.'),
    voicePrompt: z
      .string()
      .optional()
      .describe(
        'Optional realtime (Gemini Live) system instruction. If omitted, systemPrompt applies to voice too.'
      ),
    voiceConfig: AgentVoiceConfigSchema.optional().describe(
      'Complete voice configuration (transcriber + speechGen + config). Recommended speechGen.provider: `google-live` or `ultravox`.'
    ),
    primaryColor: HexColorSchema.optional().describe(
      'Brand hex from the site (pick one prominent color from scrape_url colour list). If omitted, MCP auto-detects or falls back.'
    ),
    themeType: z.enum(['light', 'dark']).optional().default('light').describe('Widget theme; defaults to light unless user asked for dark.'),
    widgetImageUrl: z
      .string()
      .url()
      .optional()
      .describe('Widget avatar/logo URL shown for the assistant — use scrape_url favicon or brand image when possible.'),
    image: z.string().url().optional().describe('Backward-compatible alias for widgetImageUrl.'),
    roundedImageURL: z.string().url().optional().describe('Backward-compatible alias for widgetImageUrl.'),
    defaultLanguage: z
      .string()
      .optional()
      .default('en')
      .describe('Default language. Must be a single language code/name (never "multilingual"). Defaults to "en".'),
    language: z.string().optional().describe('Backward-compatible alias for defaultLanguage.'),
    proactiveMessage: z.string().optional(),
    sourceUrl: z
      .string()
      .url()
      .optional()
      .describe(
        'Optional URL for KB attachment (and optional scrape). For colours/favicon, call scrape_url first yourself; this field is not required to create the agent.'
      ),
    url: z.string().url().optional().describe('Backward-compatible alias for sourceUrl.'),
    template: z.string().optional().describe('Backward-compatible field; currently ignored in favor of explicit prompts.'),
    createKbUrlDoc: z
      .boolean()
      .optional()
      .default(false)
      .describe('When true with sourceUrl/url, registers a URL KB doc after create (non-fatal on failure).'),
    requestId: z
      .string()
      .optional()
      .describe(
        'Optional idempotency key. Reusing the same requestId returns the already-created agent instead of creating a duplicate.'
      ),
    branding: z.string().optional(),
    chatBgURL: z.string().url().optional(),
    additionalConfig: z.record(z.any()).optional().describe('Optional non-vg advanced fields. Any key starting with `vg_` is ignored in template mode.'),
  })
  .superRefine((data, ctx) => {
    const source = data.sourceUrl ?? data.url;
    if (!data.title && !source) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['title'],
        message: 'title is required when sourceUrl/url is not provided.',
      });
    }
    if (data.createKbUrlDoc && !source) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['sourceUrl'],
        message: 'createKbUrlDoc requires sourceUrl or url.',
      });
    }
  });

const GetAgentSchema = z.object({
  agentId: z.string().describe('The unique identifier of the agent'),
});

const UpdateAgentSchema = z.object({
  agentId: z.string().describe('The unique identifier of the agent to update'),
  title: z.string().optional().describe('Updated title'),
  description: z.string().optional().describe('Updated description'),
  theme: z.string().optional().describe('Updated theme'),
  disabled: z.boolean().optional().describe('Updated disabled status'),
  light: z.boolean().optional().describe('Updated light mode setting'),
  enableVertex: z.boolean().optional().describe('Updated Vertex AI setting'),
  autoOpenWidget: z.boolean().optional().describe('Updated auto-open widget setting'),
  enableNodes: z.boolean().optional().describe('If true, use node-based agent behavior and read the main prompt from nodes[0].instructions'),
  vg_instructions: z.string().optional().describe('Legacy main prompt field for old agents where enableNodes is false or nodes are absent'),
  voiceConfig: AgentVoiceConfigSchema.optional().describe('Updated agent voice configuration'),
  nodes: z.array(AgentNodeSchema).optional().describe('Agent nodes; when enableNodes=true, nodes[0].instructions updates the canonical main/system prompt'),
  additionalConfig: z.record(z.any()).optional().describe('Escape hatch for raw agent fields not modeled by this MCP yet; use explicit fields when available'),
}).merge(AgentUiEngineFieldsSchema);

const DeleteAgentSchema = z.object({
  agentId: z.string().describe('The unique identifier of the agent to delete'),
});

const ListAgentsSchema = z.object({
  limit: z
    .number()
    .int()
    .positive()
    .max(500)
    .optional()
    .describe('When the API supports it, fetch at most this many agents. Omit for full list (can be very large).'),
});

const SearchAgentsSchema = z.object({
  search: z.string().optional().describe('Search query to find agents'),
  page: z.number().optional().default(1).describe('Page number'),
  limit: z.number().optional().default(50).describe('Results per page'),
  sortBy: z.string().optional().default('newest').describe('Sort by: newest, oldest, alphabetical'),
  starredOnly: z.boolean().optional().default(false).describe('Show only starred agents'),
});

const ExportAgentSchema = z.object({
  agentId: z.string().describe('The agent ID to export'),
});

const ImportAgentSchema = z.object({
  agentTemplate: z.any().describe('The agent template object to import'),
  agentName: z.string().describe('Name for the imported agent'),
  fromAgentId: z.string().optional().describe('Source agent ID'),
});

const AgentUsageSchema = z.object({
  agentId: z.string().describe('The agent ID to get usage for'),
  range: z.object({
    from: z.string().describe('Start date (ISO format)'),
    to: z.string().describe('End date (ISO format)'),
  }).optional().describe('Optional date range for usage stats'),
});

// ==================== CONVERSATION SCHEMAS ====================

const ListConversationsSchema = z.object({
  agentId: z.string().describe('The agent ID to list conversations for'),
  cursor: z
    .string()
    .optional()
    .describe(
      'Opaque cursor from the previous response `nextCursor`. Pass this to fetch the next page. Do not bump `page` alone — page>1 without cursor is rejected by the API.'
    ),
  limit: z
    .number()
    .int()
    .min(1)
    .max(20)
    .optional()
    .default(20)
    .describe('Results per page (default 20, max 20)'),
  page: z
    .number()
    .int()
    .min(1)
    .optional()
    .default(1)
    .describe(
      'Legacy. Only page=1 is valid without cursor. Prefer cursor/nextCursor/hasMore for pagination.'
    ),
});

const CreateConversationSchema = z.object({
  agentId: z.string().describe('The agent ID to create conversation for'),
  conversation: z.any().describe('Conversation object (at minimum needs ts field)'),
});

const GetConversationSchema = z.object({
  agentId: z.string().describe('The agent ID'),
  convoId: z.string().describe('The conversation ID'),
});

const UpdateConversationSchema = z.object({
  agentId: z.string().describe('The agent ID'),
  convoId: z.string().describe('The conversation ID'),
  conversation: z.any().describe('Conversation fields to update'),
});

const ConversationTurnFromValues = ['system', 'bot', 'human'] as const;
const ConversationMessageTypeValues = [
  'launch',
  'text',
  'choice',
  'MultiSelect',
  'cardV2',
  'carousel',
  'visual',
  'GetBrowserData',
  'Embed',
  'location',
  'iFrame',
  'FileUpload',
  'MultiFileUpload',
  'GoogleForm',
  'EmailForm',
  'SetConvoData',
  'VoiceNote',
  'SetRuntime',
  'no-reply',
  'VGVF_Channel',
  'VFVG_Channel',
  'VG_Response',
  'knowledgeBase',
  'jsx',
  'Flowise',
  'MultiDropdown',
  'Slider',
  'Attachment',
  'info:default',
  'info:success',
  'info:danger',
  'info:primary',
  'end',
  'debug',
  'stealth',
  'debug:success',
  'debug:error',
  'debug:tell',
  'context:form_submission',
  'file',
  'browser_capture',
] as const;

const ConversationMessageSchema = z
  .object({
    type: z.enum(ConversationMessageTypeValues).describe('Stored message type.'),
    mid: z.string().optional().describe('Channel/native message ID (MID/WAMID/etc.) when known.'),
    from: z.enum(ConversationTurnFromValues).optional().describe('Message sender.'),
    item: z
      .object({
        type: z.string().optional().describe('Inner UI/message item type. Often mirrors `type`.'),
        payload: z.any().optional().describe('Inner payload, e.g. { message: "..." } for text.'),
        time: z.number().optional(),
      })
      .passthrough()
      .optional(),
    delay: z.number().optional(),
    action: z.string().optional(),
    ts: z.number().optional().describe('Unix timestamp in seconds.'),
    feedback: z.boolean().optional(),
    VGPayload: z.record(z.any()).optional(),
    isLoading: z.boolean().optional(),
    isAIGenerated: z.boolean().optional(),
    sourceLabel: z.string().optional(),
    placeholderImage: z.string().optional(),
    mask: z
      .object({
        messageIndex: z.number(),
        turnIndex: z.number(),
      })
      .optional(),
    sendError: z
      .object({
        message: z.string(),
        ts: z.number(),
      })
      .optional(),
    replyTo: z
      .object({
        messageId: z.string(),
        messageContent: z.string(),
        messageFrom: z.string(),
        messageIndex: z.number(),
        turnIndex: z.number(),
      })
      .optional(),
  })
  .passthrough();

const ConversationTurnSchema = z
  .object({
    from: z.enum(ConversationTurnFromValues).describe('Turn sender.'),
    messages: z.array(ConversationMessageSchema).describe('Messages inside this turn.'),
    ts: z.number().optional().describe('Unix timestamp in seconds.'),
    session_id: z.string().optional(),
    isAIGenerated: z.boolean().optional(),
    modelId: z.string().optional(),
    sources: z.array(z.record(z.any())).optional(),
    langchainMessages: z.array(z.record(z.any())).optional(),
  })
  .passthrough();

const UpdateConversationMessagesSchema = z.object({
  agentId: z.string().describe('The agent ID'),
  convoId: z.string().describe('The conversation ID'),
  turns: z
    .array(ConversationTurnSchema)
    .describe(
      'Complete replacement turn history. This replaces voiceglow/{agentId}/convos/{convoId}/convo/JSON_STRING.'
    ),
  lgMessages: z.array(z.any()).optional().describe('Optional LangGraph/langchain message array passthrough.'),
  updateConversationMetadata: z
    .boolean()
    .optional()
    .default(true)
    .describe(
      'When true, refresh messagesNum, lastMessage, firstMessageTS, lastMessageTS, and lastModified on the light conversation document.'
    ),
  confirmReplace: z
    .literal(true)
    .describe('Must be true because this replaces the stored conversation message history.'),
});

const DeleteConversationSchema = z.object({
  agentId: z.string().describe('The agent ID'),
  convoId: z.string().describe('The conversation ID'),
});

const ExportAllConversationsSchema = z.object({
  agentId: z.string().describe('The agent ID to export conversations from'),
  format: z.enum(['json', 'csv']).optional().default('json').describe('Export format'),
  limit: z.number().int().min(1).optional().describe('Max conversations to export in this page'),
  sort: z.string().optional().describe('Sort order (API-defined, e.g. newest)'),
  fromTs: z.number().optional().describe('Unix timestamp lower bound (inclusive)'),
  toTs: z.number().optional().describe('Unix timestamp upper bound (inclusive)'),
  cursor: z
    .string()
    .optional()
    .describe('Opaque cursor from previous export response nextCursor for the next page'),
  convoIds: z
    .array(z.string())
    .optional()
    .describe('If set, export only these conversation IDs (selected mode)'),
});

const ExportConversationSchema = z.object({
  agentId: z.string().describe('The agent ID'),
  convoId: z.string().describe('The conversation ID'),
  format: z.enum(['json', 'csv']).optional().default('json').describe('Export format'),
});

const AssignConversationSchema = z.object({
  agentId: z.string().describe('The agent ID'),
  convoId: z.string().describe('The conversation ID'),
  assignToUserId: z.string().describe('User ID to assign conversation to'),
  delegatedBy: z.string().optional().describe('ID of user delegating this chat'),
});

const GetConversationsBulkSchema = z.object({
  agentId: z.string().describe('The agent ID'),
  convoIds: z
    .array(z.string().min(1))
    .min(1)
    .max(50)
    .describe('Conversation IDs to fetch (max 50 per call; chunk larger audits)'),
});

const QueryConversationsSchema = z.object({
  agentId: z.string().describe('The agent ID'),
  limit: z
    .number()
    .int()
    .min(1)
    .max(100)
    .optional()
    .default(50)
    .describe('Max matches to return (default 50, max 100)'),
  maxScan: z
    .number()
    .int()
    .min(1)
    .max(500)
    .optional()
    .default(200)
    .describe('Max conversations to scan via list pages (default 200, max 500)'),
  origin: z.string().optional().describe('Exact origin match (e.g. web-chat)'),
  tsFrom: z.number().optional().describe('Unix timestamp lower bound (inclusive)'),
  tsTo: z.number().optional().describe('Unix timestamp upper bound (inclusive)'),
  capturedVariableExists: z
    .string()
    .optional()
    .describe('Require this key in capturedVariables'),
  capturedVariableEquals: z
    .object({
      key: z.string(),
      value: z.string(),
    })
    .optional()
    .describe('Require capturedVariables[key] === value (string compare)'),
  summaryContains: z
    .string()
    .optional()
    .describe('Case-insensitive substring match on conversation summary'),
  hasUserName: z
    .boolean()
    .optional()
    .describe('If true, require non-empty userName; if false, require missing/empty'),
});

const GetAgentUsageBulkSchema = z.object({
  agentIds: z
    .array(z.string().min(1))
    .min(1)
    .max(20)
    .describe('Agent IDs to fetch usage for (max 20)'),
  range: z
    .object({
      from: z.string().describe('Start date (ISO string)'),
      to: z.string().describe('End date (ISO string)'),
    })
    .optional()
    .describe('Optional date range applied to every agent'),
});

const GetKbDocsBulkSchema = z.object({
  agentId: z.string().describe('The agent ID'),
  docIds: z
    .array(z.string().min(1))
    .min(1)
    .max(30)
    .describe('KB document IDs (max 30 per call)'),
  includeContent: z
    .boolean()
    .optional()
    .default(false)
    .describe('If true, include full chunks/content (can be large). Default false = compact preview.'),
});

// ==================== KNOWLEDGE BASE SCHEMAS ====================

const KbRefreshRateSchema = z
  .enum(['3d', '7d', 'never'])
  .describe('Auto re-crawl rate for URL/sitemap sources (API: 3d | 7d | never)');

const CreateKBDocSchema = z.object({
  agentId: z.string().describe('The agent ID'),
  name: z.string().describe('Document name'),
  sourceType: z.enum(['doc', 'url', 'sitemap']).describe('Source type'),
  content: z.string().optional().describe('Document content (for doc type)'),
  metadata: z.any().optional().describe('Additional metadata'),
  tags: z.array(z.string()).optional().describe('Tags for organization'),
  refreshRate: KbRefreshRateSchema.optional().default('never'),
  urls: z.array(z.string()).optional().describe('URLs to process (for url type)'),
  sitemapUrl: z.string().optional().describe('Sitemap URL (for sitemap type)'),
  maxPages: z.number().optional().describe('Max pages from sitemap'),
  scrapeContent: z
    .boolean()
    .optional()
    .describe('Let the KB router scrape URLs (preferred). Default true for url/sitemap.'),
});

/** Mass URL ingest via KB router — preferred over scrape_url + create_kb_doc loops. */
const CreateKbFromUrlsSchema = z.object({
  agentId: z.string().describe('The agent ID'),
  urls: z
    .array(z.string().url())
    .min(1)
    .max(50)
    .describe('Page URLs to ingest (max 50). KB router scrapes them — do not pre-scrape.'),
  mode: z
    .enum(['per_url', 'batch'])
    .optional()
    .default('per_url')
    .describe(
      'per_url: one KB doc per URL (default, best for hotels/multi-page). batch: single KB source with all urls[] (one API call).'
    ),
  name: z
    .string()
    .optional()
    .describe('batch: document name. per_url: optional prefix before auto title from URL path.'),
  tags: z.array(z.string()).optional().describe('Tags applied to created docs'),
  refreshRate: KbRefreshRateSchema.optional().default('never'),
  scrapeContent: z
    .boolean()
    .optional()
    .default(true)
    .describe('Must be true for the KB router to scrape (default true).'),
  skipExisting: z
    .boolean()
    .optional()
    .default(true)
    .describe('Skip URLs already present on the agent KB (default true).'),
  metadata: z
    .object({ description: z.string() })
    .optional()
    .describe('Optional metadata.description for created docs'),
});

const ListKBDocsSchema = z.object({
  agentId: z.string().describe('The agent ID'),
  page: z.number().optional().default(1).describe('Page number'),
  pageSize: z.number().optional().default(20).describe('Results per page'),
});

const GetKBDocSchema = z.object({
  agentId: z.string().describe('The agent ID'),
  docId: z.string().describe('The document ID'),
});

const UpdateKBDocSchema = z.object({
  agentId: z.string().describe('The agent ID'),
  docId: z.string().describe('The document ID'),
  name: z.string().optional().describe('Updated document name'),
  content: z.string().optional().describe('Updated content'),
  metadata: z.any().optional().describe('Updated metadata'),
  tags: z.array(z.string()).optional().describe('Updated tags'),
  refreshRate: KbRefreshRateSchema.optional().describe('Updated refresh rate'),
  url: z.string().optional().describe('Updated URL'),
});

const PatchAgentPromptSchema = z.object({
  agentId: z.string().describe('The agent ID whose prompt to patch'),
  old_string: z
    .string()
    .min(1)
    .describe(
      'Exact text to find in the prompt (whitespace-sensitive). Include enough surrounding context so the match is unique unless replace_all is true.'
    ),
  new_string: z
    .string()
    .describe('Replacement text. May be empty to delete the matched span.'),
  replace_all: z
    .boolean()
    .optional()
    .default(false)
    .describe(
      'If true, replace every occurrence of old_string. If false (default), fails when old_string matches more than once.'
    ),
  target: z
    .enum(['auto', 'nodes0', 'vg_instructions', 'vg_systemPrompt', 'proactiveMessage', 'customCSS'])
    .optional()
    .default('auto')
    .describe(
      'Which field to patch. auto = nodes[0].instructions when enableNodes/nodes exist, else vg_instructions. Use customCSS for widget CSS surgical edits.'
    ),
  sync_mirrors: z
    .boolean()
    .optional()
    .default(true)
    .describe(
      'When patching the main prompt (auto/nodes0/vg_*), also apply the same exact replace to the other main prompt mirrors (nodes[0].instructions, vg_instructions, vg_systemPrompt) when they contain old_string. Default true.'
    ),
});

const PatchKbDocSchema = z.object({
  agentId: z.string().describe('The agent ID'),
  docId: z.string().describe('The KB document ID'),
  old_string: z
    .string()
    .min(1)
    .describe(
      'Exact text to find in the KB field (whitespace-sensitive). Include enough surrounding context so the match is unique unless replace_all is true.'
    ),
  new_string: z
    .string()
    .describe('Replacement text. May be empty to delete the matched span.'),
  replace_all: z
    .boolean()
    .optional()
    .default(false)
    .describe(
      'If true, replace every occurrence of old_string. If false (default), fails when old_string matches more than once.'
    ),
  field: z
    .enum(['content', 'name'])
    .optional()
    .default('content')
    .describe('Which KB field to patch. Default content (the document body).'),
});

const DeleteKBDocSchema = z.object({
  agentId: z.string().describe('The agent ID'),
  docId: z.string().describe('The document ID'),
});

const GetKBStatsSchema = z.object({
  agentId: z.string().describe('The agent ID'),
});

// ==================== SCRAPE SCHEMAS ====================

const ScrapeUrlSchema = z
  .object({
    url: z.string().url().optional().describe('Single URL (alias for urls with one entry)'),
    urls: z
      .array(z.string().url())
      .min(1)
      .max(20)
      .optional()
      .describe('One or more URLs to check or scrape (max 20). Prefer for link/image validation.'),
    mode: z
      .enum(['check', 'scrape'])
      .optional()
      .default('check')
      .describe(
        'check (default): fast HTTP status ping (200/404/etc) for pages/images — no crawler. scrape: full Convocore page scrape (content/colours/favicon); use one URL.'
      ),
  })
  .superRefine((data, ctx) => {
    const list = [
      ...(data.urls ?? []),
      ...(data.url ? [data.url] : []),
    ];
    const unique = [...new Set(list.map((u) => u.trim()).filter(Boolean))];
    if (unique.length === 0) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['urls'],
        message: 'Provide url or urls (at least one).',
      });
    }
    if ((data.mode ?? 'check') === 'scrape' && unique.length > 1) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['urls'],
        message: 'mode=scrape supports exactly one URL. Use mode=check for multiple links.',
      });
    }
  });

// ==================== FILE I/O SCHEMAS ====================
// One-of source: { path } | { url } | { data + mimeType? }. Validated at runtime.
const FileSourceSchema = z.object({
  path: z.string().optional().describe('Absolute or relative local file path. Mutually exclusive with url/data.'),
  url: z.string().url().optional().describe('https:// URL to fetch. Mutually exclusive with path/data.'),
  data: z.string().optional().describe("Base64-encoded file contents (raw or 'data:<mime>;base64,<...>'). Mutually exclusive with path/url."),
  mimeType: z.string().optional().describe('Optional MIME hint, primarily for the data mode.'),
});

const InspectFileSchema = FileSourceSchema;

const ReadTextFileSchema = FileSourceSchema.extend({
  maxBytes: z.number().int().min(1).optional().describe('Optional cap on bytes to read from the file.'),
});

const ReadPdfSchema = FileSourceSchema.extend({
  pages: z.union([z.string(), z.array(z.number().int().min(1))]).optional().describe(
    'Optional page selection. String form like "1-3,5,7-9" or an explicit array of page numbers. Defaults to all pages.',
  ),
});

const ReadDocxSchema = FileSourceSchema.extend({
  asMarkdown: z.boolean().optional().describe('When true, returns markdown (preserves headings, lists, links). Default: false (plain text).'),
});

const ReadSpreadsheetSchema = FileSourceSchema.extend({
  sheet: z.union([z.string(), z.number().int().min(0)]).optional().describe(
    'Sheet name or zero-based index. Omit to just list available sheets without reading any.',
  ),
  range: z.string().optional().describe('Optional A1-style range, e.g. "A1:D50".'),
  format: z.enum(['json', 'csv', 'markdown']).optional().describe('Output format for the sheet (default: markdown).'),
  headerRow: z.boolean().optional().describe('For json output, treat row 1 as headers (default: true).'),
  maxRows: z.number().int().min(1).max(50000).optional().describe('Cap on rows returned (default: 1000).'),
});

const ReadImageSchema = FileSourceSchema.extend({
  maxDimension: z.number().int().min(64).max(4096).optional().describe(
    'Max width/height in pixels (default: 2048). Anything larger is downscaled before returning.',
  ),
});

const ImportFileToKbSchema = FileSourceSchema.extend({
  agentId: z.string().describe('Target agent ID whose knowledge base receives the document.'),
  name: z.string().optional().describe('KB document name. Defaults to the source filename.'),
  tags: z.array(z.string()).optional().describe('Optional tags applied to the KB doc.'),
  pages: z.union([z.string(), z.array(z.number().int().min(1))]).optional().describe('PDF only: page selection.'),
  sheet: z.union([z.string(), z.number().int().min(0)]).optional().describe('Spreadsheet only: which sheet to ingest. Defaults to the first sheet.'),
  asMarkdown: z.boolean().optional().describe('Prefer markdown output for docx/spreadsheet (default: true).'),
});

// ==================== WIDGET CSS SCHEMAS ====================

const WidgetCssStylingGuideSchema = z.object({
  agentId: z.string().optional().describe(
    "Optional agent ID. If provided, the agent's current customCSS is appended so you can refine/extend instead of duplicating rules."
  ),
});

const GetAgentCustomCssSchema = z.object({
  agentId: z.string().describe('The agent ID whose customCSS field you want to read'),
});

const UpdateAgentCustomCssSchema = z.object({
  agentId: z.string().describe('The agent ID whose customCSS field you want to overwrite'),
  customCSS: z.string().describe(
    "The full CSS to write to the agent's customCSS field. This REPLACES the existing value entirely — pass the merged CSS, not just a delta. Use an empty string to clear."
  ),
});

const GetWebsiteEmbedCodeSchema = z.object({
  agentId: z.string().describe('The Convocore agent ID to embed (from get_agent or dashboard URL).'),
  mode: z
    .enum(['popup-bottom-right', 'popup-bottom-left', 'full-width', 'modal', 'voice-react'])
    .optional()
    .default('popup-bottom-right')
    .describe(
      "Embed mode: popup-bottom-right (default chat bubble), popup-bottom-left, full-width (inline div), modal (center overlay), or voice-react (Next.js WebCall example only)."
    ),
  containerWidth: z.string().optional().describe('For full-width mode only, e.g. "500px".'),
  containerHeight: z.string().optional().describe('For full-width mode only, e.g. "500px".'),
});

const SleepSchema = z.object({
  seconds: z
    .number()
    .min(0)
    .max(300)
    .describe('Number of seconds to wait. Must be between 0 and 300 (5 minutes).'),
});

const VoiceFiltersBase = {
  language: z
    .string()
    .optional()
    .describe('Inclusive match: "en" matches "en-US", "en-GB", "English", etc.'),
  gender: z
    .string()
    .optional()
    .describe('male / female / neutral. Aliases m / f / masculine / feminine accepted (case-insensitive).'),
  accent: z
    .string()
    .optional()
    .describe('Case-insensitive substring match, e.g. "american" or "british".'),
  modelId: z
    .string()
    .optional()
    .describe('Filter to a specific TTS model id (e.g. "aura-2", "eleven_multilingual_v2") for providers with model-scoped voice catalogs.'),
  limit: z.number().min(1).max(500).optional().default(100).describe('Page size, 1–500. Default 100.'),
  offset: z.number().min(0).optional().default(0).describe('Pagination offset. Default 0.'),
};

const ListVoiceProvidersSchema = z.object({});

const ListVoiceModelsSchema = z.object({
  provider: z
    .string()
    .describe('Provider slug — one of: elevenlabs, deepgram, cartesia, rime-ai, openai, google-cloud, google-live, ultravox, minimax, playht, azure.'),
});

const SearchVoicesSchema = z.object({
  ...VoiceFiltersBase,
  providers: z
    .string()
    .optional()
    .describe('Comma-separated provider slugs to limit the search (e.g. "elevenlabs,cartesia"). Omit to search all providers.'),
});

const ListProviderVoicesSchema = z.object({
  provider: z
    .string()
    .describe('Provider slug to browse, e.g. "elevenlabs" or "cartesia".'),
  ...VoiceFiltersBase,
});

const GetVoiceSchema = z.object({
  provider: z.string().describe('Provider slug, e.g. "elevenlabs".'),
  voiceId: z
    .string()
    .describe('The provider-specific voice ID (e.g. "21m00Tcm4TlvDq8ikWAM" for ElevenLabs Rachel).'),
});

const BuyTwilioNumberSchema = z.object({
  number: z
    .string()
    .describe('The phone number to buy in E.164 format with the leading + and no spaces, e.g. "+14155551234".'),
  agentId: z
    .string()
    .optional()
    .describe('Optional agent ID to assign the number to. Leave empty to assign later.'),
  capabilities: z
    .array(z.enum(['voice', 'sms']))
    .optional()
    .default(['voice', 'sms'])
    .describe('Which capabilities to enable. Default: ["voice", "sms"].'),
});

const ImportTwilioNumberSchema = z.object({
  payload: z
    .record(z.any())
    .describe(
      'Body for /utils/import-twilio-number. Typically includes your Twilio account SID, auth token, the number to import, optional agentId, and capabilities. Pass the full request body as an object.'
    ),
});

const ReleaseTwilioNumberSchema = z.object({
  payload: z
    .record(z.any())
    .describe(
      'Body for /utils/twilio/release-number. Typically includes the phoneNumber or phoneNumberSid to release. Pass the full request body as an object.'
    ),
});

const CheckTwilioNumberSchema = z.object({
  payload: z
    .record(z.any())
    .describe(
      'Body for /utils/twilio/check-number. Used to repair / re-sync the Twilio webhook configuration for a number. Typically includes the phoneNumber or phoneNumberSid.'
    ),
});

const SyncSmsTwilioNumberSchema = z.object({
  payload: z
    .record(z.any())
    .describe(
      'Body for /utils/twilio/sync-sms. Assigns a Twilio number to an agent for SMS handling. Typically includes phoneNumber (or sid) and agentId.'
    ),
});

const InteractWithAgentSchema = z.object({
  agentId: z.string().min(1).describe('The ID of the agent to interact with.'),
  convoId: z
    .string()
    .min(1)
    .describe(
      'Conversation ID. Reuse across turns to keep history; use a fresh ID to start a new conversation.'
    ),
  prompt: z
    .string()
    .optional()
    .describe(
      'User message to send. Special values: "start" (trigger initial greeting), "@cancel:<reason>", "@rewind:<nodeId>" (v2/node agents only). If omitted on a fresh convo, the server may treat it as a no-op.'
    ),
  bucket: z
    .enum(['voiceglow-eu', '(default)'])
    .optional()
    .describe(
      'Region bucket. Auto-derived from CONVOCORE_API_REGION (eu-gcp -> "voiceglow-eu", na-gcp -> "(default)") when omitted.'
    ),
  sessionId: z.string().optional().describe('Optional session id; defaults to convoId server-side.'),
  messageType: z
    .enum(['text', 'visual'])
    .optional()
    .describe('Type of input. Use "visual" together with visualPayload to send images.'),
  visualPayload: z
    .object({
      image: z.string().url().optional(),
      images: z.array(z.string().url()).optional(),
      message: z.string().optional(),
      imageCount: z.number().int().min(0).optional(),
    })
    .optional()
    .describe('Image/visual content for messageType: "visual" turns.'),
  replyTo: z
    .object({
      messageId: z.string().optional(),
      messageContent: z.string().optional(),
      messageFrom: z.enum(['human', 'bot']).optional(),
      messageIndex: z.number().int().optional(),
      turnIndex: z.number().int().optional(),
    })
    .optional()
    .describe('Reply context when the user is replying to a previous message.'),
  lightConvoData: z
    .record(z.any())
    .optional()
    .describe(
      'Per-conversation user/context metadata (userName, userEmail, userPhone, origin, capturedVariables, ...). Surfaced to the agent system prompt where supported.'
    ),
  agentData: z
    .record(z.any())
    .optional()
    .describe(
      'Optional agent override. When provided with at least an `ID`, the server skips loading the agent doc from Firestore and uses this object instead.'
    ),
  workspaceData: z.record(z.any()).optional().describe('Optional workspace override.'),
  turnsHistory: z
    .array(z.any())
    .optional()
    .describe(
      'Optional override of conversation turns. When set, the server uses this instead of fetching from Firestore.'
    ),
  disableUiEngine: z.boolean().optional().describe('Disable UI-engine JSON output for this turn.'),
  disableRecordHistory: z
    .boolean()
    .optional()
    .describe('Skip persisting this turn to Firestore.'),
  v2: z.boolean().optional().describe('Force routing to the v2 (node-based) handler.'),
  isTest: z.boolean().optional().describe('Marks the turn as a test interaction.'),
  isLLMStudio: z.boolean().optional().describe('Marks the turn as originating from LLM Studio.'),
  kbPreview: z
    .boolean()
    .optional()
    .describe('Knowledge-base preview mode (skips node routing).'),
  agentProfileId: z
    .string()
    .optional()
    .describe('Internal profile id (e.g. agency_plan_builder_v1).'),
  toolTest: z
    .object({
      toolId: z.string(),
      toolName: z.string(),
      mode: z.enum(['validate', 'generate-and-test']),
    })
    .optional()
    .describe('Run a single tool in test mode.'),
  formSubmissionMetadata: z
    .record(z.any())
    .optional()
    .describe('Payload describing a UI-engine form / input submission.'),
  initNodesOptions: z
    .record(z.any())
    .optional()
    .describe('Optional overrides for tools / variables / messages history at session init.'),
  actionMetadata: z
    .object({ mid: z.string().optional() })
    .passthrough()
    .optional()
    .describe('Includes mid (client-supplied message id) used for de-duplication.'),
  timeoutMs: z
    .number()
    .int()
    .min(1000)
    .max(600_000)
    .optional()
    .default(120_000)
    .describe(
      'How long the MCP will wait for the streamed turn to complete before forcing the WebSocket closed. Default 120s, max 600s. Long voice/tool turns may need more.'
    ),
  raw: z
    .boolean()
    .optional()
    .default(false)
    .describe(
      'When true, include every raw streamed chunk in the response (debug events, indexes, etc.). When false (default) the response keeps only aggregated text + actions + metadata + final turns to stay token-cheap.'
    ),
});

const GetUiEngineSpecSchema = z.object({
  section: z
    .enum(['all', 'meta', 'envelopes', 'message_types', 'shared', 'rules', 'checklist', 'primer'])
    .optional()
    .default('all')
    .describe('Which slice of the UI Engine spec to return. Default: "all".'),
  messageType: z
    .enum(['text', 'choice', 'visual', 'cardV2', 'carousel', 'iFrame', 'form', 'input'])
    .optional()
    .describe(
      'When set, return only the schema for this UI Engine message type (overrides section).'
    ),
});

const GetChannelIntegrationSpecSchema = z.object({
  section: z
    .enum(['all', 'meta', 'whatsapp', 'metaPages', 'sms'])
    .optional()
    .default('all')
    .describe(
      'Which channel integration reference to return. meta=overview, whatsapp=waNumbers, metaPages=Facebook Messenger/Instagram, sms=Twilio SMS.'
    ),
});

const PricingSection = z.enum([
  'all',
  'plans',
  'add_ons',
  'credits',
  'rules_of_thumb',
  'models',
  'voice_providers',
  'faq',
]);

const GetPricingInfoSchema = z.object({
  section: PricingSection
    .optional()
    .default('all')
    .describe(
      'Which slice of pricing to return. "all" returns the full snapshot. Use a section to keep responses small when you only need plans, models, etc.'
    ),
  modelFilter: z
    .string()
    .optional()
    .describe(
      'Optional substring match on model name or provider when section="models" (e.g. "gpt", "claude", "gemini").'
    ),
});

const RunCommandSchema = z.object({
  command: z
    .string()
    .min(1)
    .describe(
      'Shell command to execute on the host machine. Runs through the platform default shell (cmd.exe on Windows, /bin/sh on Unix). Inherits the MCP server process environment.'
    ),
  cwd: z
    .string()
    .optional()
    .describe('Optional working directory to run the command in. Defaults to the MCP server cwd.'),
  timeoutSeconds: z
    .number()
    .min(1)
    .max(600)
    .optional()
    .default(30)
    .describe('Kill the process after this many seconds. Default 30, max 600.'),
});

const AgentNodeInputSchema = {
  type: 'object',
  description:
    'One agent node. For enableNodes=true agents, the FIRST node (nodes[0]) contains the canonical main/system prompt in instructions.',
  properties: {
    instructions: {
      type: 'string',
      description:
        'Node prompt/instructions. For enableNodes=true agents, nodes[0].instructions is the main behavior prompt.',
    },
    name: {
      type: 'string',
      description: 'Optional human-readable node name.',
    },
  },
  additionalProperties: true,
} as const;

const AgentVoiceConfigInputSchema = {
  type: 'object',
  description:
    'Agent voiceConfig for voice-capable agents. Integrations/API keys generally live at workspace/org level; this config selects providers, models, voices, and call behavior for the agent.',
  properties: {
    transcriber: {
      type: 'object',
      description: 'Speech-to-text / transcription settings.',
      properties: {
        provider: {
          type: 'string',
          description:
            'Transcriber provider, e.g. deepgram, gladia, assemblyai, speechmatics, google-cloud-speech.',
        },
        modelId: { type: 'string', description: 'Provider-specific transcription model ID.' },
        language: { type: 'string', description: 'Language code, e.g. en, en-US.' },
        patienceFactor: {
          type: 'number',
          description: 'Optional endpointing / patience tuning for transcription.',
        },
        speechConfig: {
          type: 'object',
          description: 'Provider-specific speech input config, e.g. format, sampleRate, language.',
          additionalProperties: true,
        },
        randomOptions: {
          description: 'Provider-specific passthrough options.',
        },
      },
      additionalProperties: true,
    },
    speechGen: {
      type: 'object',
      description: 'Text-to-speech / speech generation settings.',
      properties: {
        provider: {
          type: 'string',
          description: 'TTS provider, e.g. elevenlabs, deepgram, cartesia.',
        },
        modelId: { type: 'string', description: 'Provider-specific TTS model ID.' },
        voiceId: { type: 'string', description: 'Provider-specific voice ID.' },
        apiKey: {
          type: 'string',
          description: 'Optional provider API key override. Prefer workspace integrations when available.',
        },
        region: { type: 'string', description: 'Provider-specific region.' },
        highAudioQuality: {
          type: 'boolean',
          description: 'Enable higher-quality audio generation where supported.',
        },
        backgroundNoise: {
          type: 'string',
          enum: ['restaurant', 'office', 'park', 'street'],
        },
        punctuationBreaks: {
          type: 'array',
          items: { type: 'string' },
          description: 'Punctuation tokens that should create speech breaks.',
        },
        platformSpecific: {
          description: 'Provider-specific passthrough options.',
        },
      },
      additionalProperties: true,
    },
    config: {
      type: 'object',
      description: 'General voice/call settings for the agent.',
      properties: {
        recordAudio: { type: 'boolean', description: 'Whether voice calls should be recorded.' },
        enableWebCalling: { type: 'boolean', description: 'Enable browser/web calling for this agent.' },
        backgroundNoise: {
          type: 'string',
          enum: ['restaurant', 'office', 'park', 'street'],
        },
        firstInputChunkUNIXMs: {
          type: 'number',
          description: 'Runtime timing field; usually read-only.',
        },
        firstOutputChunkUNIXMs: {
          type: 'number',
          description: 'Runtime timing field; usually read-only.',
        },
      },
      additionalProperties: true,
    },
  },
  additionalProperties: true,
} as const;

const DEFAULT_MODEL_FOR_TEMPLATE_AGENTS = RECOMMENDED_CHAT_MODEL_ID;

const DEFAULT_GEMINI_LIVE_OPTIONS = {
  apiConfig: { apiKey: '' },
  sessionConfig: {
    model: 'gemini-3.1-flash-live-preview',
    responseModalities: ['AUDIO'],
    generationConfig: {
      temperature: 0.4,
      topP: 0.6,
      topK: 32,
      maxOutputTokens: 512,
      candidateCount: 1,
    },
    speechConfig: {
      voiceConfig: {
        prebuiltVoiceConfig: { voiceName: 'Puck' },
      },
    },
    inputAudioTranscription: {},
    outputAudioTranscription: {},
    realtimeInputConfig: {
      automaticActivityDetection: {
        disabled: false,
        startOfSpeechSensitivity: 'START_SENSITIVITY_HIGH',
        endOfSpeechSensitivity: 'END_SENSITIVITY_HIGH',
        prefixPaddingMs: 20,
        silenceDurationMs: 100,
      },
    },
  },
  internal: {
    enableToolPrefillAudio: false,
  },
} as const;

const DEFAULT_TEMPLATE_VOICE_CONFIG = {
  config: {
    recordAudio: true,
    enableWebCalling: true,
    backgroundNoise: 'restaurant',
  },
  transcriber: {
    provider: 'deepgram',
    modelId: 'nova-2-phonecall',
    utteranceThreshold: 150,
    language: 'en',
  },
  speechGen: {
    provider: 'google-live',
    voiceId: 'Puck',
  },
} as const;

function buildTemplateStartNode(systemPrompt: string) {
  return {
    ...TEMPLATE_START_NODE_DEFAULTS,
    llmConfig: { ...TEMPLATE_START_NODE_DEFAULTS.llmConfig },
    instructions: systemPrompt,
  };
}

function normalizeTemplateAgentNodesForCreate(nodes: unknown): unknown[] {
  const normalized = normalizeTemplateStartNodeArray(nodes);
  if (normalized.patchedFields.length > 0) {
    console.error(
      `[debug] create_agent_from_template normalized start node at index ${normalized.startNodeIndex}; autoFilledFields=${normalized.patchedFields.join(',')}`
    );
  }
  const start = normalized.nodes[normalized.startNodeIndex];
  if (start && typeof start === 'object') {
    const node = start as Record<string, unknown>;
    const llm =
      node.llmConfig && typeof node.llmConfig === 'object'
        ? { ...(node.llmConfig as Record<string, unknown>) }
        : {};
    llm.modelId = DEFAULT_MODEL_FOR_TEMPLATE_AGENTS;
    node.llmConfig = llm;
    normalized.nodes[normalized.startNodeIndex] = node;
  }
  return normalized.nodes;
}

function resolveSingleLanguage(input: unknown): string {
  if (typeof input !== 'string') {
    return 'en';
  }
  const trimmed = input.trim();
  if (!trimmed) return 'en';

  const normalized = trimmed.toLowerCase();
  if (normalized === 'multilingual' || normalized === 'multi-language' || normalized === 'multi language') {
    return 'en';
  }

  return trimmed;
}

function toDomainLabel(url: string): string {
  try {
    const hostname = new URL(url).hostname.replace(/^www\./i, '');
    const base = hostname.split('.')[0] || 'Website';
    return base
      .replace(/[-_]+/g, ' ')
      .replace(/\b\w/g, (m) => m.toUpperCase());
  } catch {
    return 'Website';
  }
}

function isPlainRecord(x: unknown): x is Record<string, unknown> {
  return typeof x === 'object' && x !== null && !Array.isArray(x);
}

/** Deep-merge plain objects; arrays and non-objects replace wholesale. */
function mergeDeep<T extends Record<string, unknown>>(base: T, override?: Record<string, unknown>): T {
  if (!override || !isPlainRecord(override)) return base;
  const out: Record<string, unknown> = { ...base };
  for (const key of Object.keys(override)) {
    const oVal = override[key];
    if (oVal === undefined) continue;
    const bVal = out[key];
    if (Array.isArray(oVal)) {
      out[key] = oVal;
      continue;
    }
    if (isPlainRecord(bVal) && isPlainRecord(oVal)) {
      out[key] = mergeDeep(bVal as Record<string, unknown>, oVal as Record<string, unknown>);
    } else {
      out[key] = oVal;
    }
  }
  return out as T;
}

let autoResolvedWorkspaceCache: string | null = null;

function extractAgentsFromListResult(listResult: any): any[] {
  if (Array.isArray(listResult)) return listResult;
  if (Array.isArray(listResult?.data)) return listResult.data;
  if (Array.isArray(listResult?.agents)) return listResult.agents;
  if (Array.isArray(listResult?.data?.agents)) return listResult.data.agents;
  return [];
}

function getAgentId(agent: any): string | null {
  const id = agent?.ID ?? agent?.id;
  return typeof id === 'string' && id.trim().length > 0 ? id.trim() : null;
}

async function findExistingAgentByExactTitle(title: string): Promise<any | null> {
  const listResult = await getActiveClient().listAgents({ limit: 500 });
  const agents = extractAgentsFromListResult(listResult);
  const matches = agents.filter(
    (agent: any) => typeof agent?.title === 'string' && agent.title.trim() === title
  );
  if (matches.length === 0) return null;

  const sorted = matches.sort((a: any, b: any) => {
    const ta = Number(a?.lastModified ?? a?.createdAtUNIX ?? 0);
    const tb = Number(b?.lastModified ?? b?.createdAtUNIX ?? 0);
    return tb - ta;
  });
  return sorted[0] ?? null;
}

async function resolveWorkspaceId(): Promise<string> {
  if (getActiveConfig().workspaceId && getActiveConfig().workspaceId!.trim().length > 0) {
    return getActiveConfig().workspaceId!.trim();
  }

  if (autoResolvedWorkspaceCache) {
    return autoResolvedWorkspaceCache;
  }

  const listResult = await getActiveClient().listAgents({ limit: 1 });
  const agents = extractAgentsFromListResult(listResult);
  const ownerCandidate = agents.find(
    (agent: any) =>
      (typeof agent?.ownerID === 'string' && agent.ownerID.trim().length > 0) ||
      (typeof agent?.ownerId === 'string' && agent.ownerId.trim().length > 0)
  );

  const workspaceId = ownerCandidate?.ownerID || ownerCandidate?.ownerId;
  if (typeof workspaceId === 'string' && workspaceId.trim().length > 0) {
    autoResolvedWorkspaceCache = workspaceId.trim();
    return autoResolvedWorkspaceCache;
  }

  throw new Error(
    'Could not auto-detect workspaceId from workspace secret context. Set CONVOCORE_WORKSPACE_ID in MCP config.'
  );
}

type AgentPromptTarget =
  | 'auto'
  | 'nodes0'
  | 'vg_instructions'
  | 'vg_systemPrompt'
  | 'proactiveMessage'
  | 'customCSS';

function resolveCanonicalPromptTarget(agent: Record<string, any>): 'nodes0' | 'vg_instructions' {
  const nodes = Array.isArray(agent.nodes) ? agent.nodes : null;
  const enableNodes = agent.enableNodes === true || (nodes != null && nodes.length > 0);
  if (enableNodes && nodes && nodes[0] && typeof nodes[0] === 'object') {
    return 'nodes0';
  }
  return 'vg_instructions';
}

function readAgentTextField(
  agent: Record<string, any>,
  target: Exclude<AgentPromptTarget, 'auto'>
): { text: string; label: string } {
  if (target === 'nodes0') {
    const nodes = Array.isArray(agent.nodes) ? agent.nodes : [];
    const first = nodes[0] && typeof nodes[0] === 'object' ? nodes[0] : null;
    const text = typeof first?.instructions === 'string' ? first.instructions : '';
    return { text, label: 'nodes[0].instructions' };
  }
  if (target === 'vg_instructions') {
    return {
      text: typeof agent.vg_instructions === 'string' ? agent.vg_instructions : '',
      label: 'vg_instructions',
    };
  }
  if (target === 'vg_systemPrompt') {
    return {
      text: typeof agent.vg_systemPrompt === 'string' ? agent.vg_systemPrompt : '',
      label: 'vg_systemPrompt',
    };
  }
  if (target === 'proactiveMessage') {
    return {
      text: typeof agent.proactiveMessage === 'string' ? agent.proactiveMessage : '',
      label: 'proactiveMessage',
    };
  }
  return {
    text: typeof agent.customCSS === 'string' ? agent.customCSS : '',
    label: 'customCSS',
  };
}

function applyPatchToAgentObject(
  agent: Record<string, any>,
  target: Exclude<AgentPromptTarget, 'auto'>,
  updatedText: string
): Record<string, any> {
  const patch: Record<string, any> = {};
  if (target === 'nodes0') {
    const nodes = Array.isArray(agent.nodes)
      ? agent.nodes.map((n: any) => (n && typeof n === 'object' ? { ...n } : n))
      : [];
    if (nodes.length === 0) {
      nodes.push({ name: 'Start', type: 'start', instructions: updatedText });
    } else {
      nodes[0] = { ...(nodes[0] || {}), instructions: updatedText };
    }
    patch.nodes = nodes;
    return patch;
  }
  if (target === 'vg_instructions') {
    patch.vg_instructions = updatedText;
    return patch;
  }
  if (target === 'vg_systemPrompt') {
    patch.vg_systemPrompt = updatedText;
    return patch;
  }
  if (target === 'proactiveMessage') {
    patch.proactiveMessage = updatedText;
    return patch;
  }
  patch.customCSS = updatedText;
  return patch;
}

const MAIN_PROMPT_TARGETS: Array<'nodes0' | 'vg_instructions' | 'vg_systemPrompt'> = [
  'nodes0',
  'vg_instructions',
  'vg_systemPrompt',
];

async function patchAgentPromptExact(args: {
  agentId: string;
  old_string: string;
  new_string: string;
  replace_all: boolean;
  target: AgentPromptTarget;
  sync_mirrors: boolean;
}): Promise<Record<string, unknown>> {
  const raw = await getActiveClient().getAgent(args.agentId);
  const agent = unwrapRecord(raw);
  if (!agent || Object.keys(agent).length === 0) {
    throw new Error(`Agent ${args.agentId} not found or returned empty payload`);
  }

  const primaryTarget =
    args.target === 'auto' ? resolveCanonicalPromptTarget(agent) : args.target;
  const primary = readAgentTextField(agent, primaryTarget);
  if (!primary.text) {
    throw new Error(
      `Target field ${primary.label} is empty or missing on agent ${args.agentId}. ` +
        'Re-check with get_agent, or pass an explicit target.'
    );
  }

  const primaryResult = applyExactStringReplace(
    primary.text,
    args.old_string,
    args.new_string,
    args.replace_all
  );
  if (!primaryResult.ok) {
    throw new Error(`${primary.label}: ${primaryResult.error}`);
  }

  let workingAgent: Record<string, any> = { ...agent };
  const agentPatch = applyPatchToAgentObject(
    workingAgent,
    primaryTarget,
    primaryResult.updated
  );
  workingAgent = { ...workingAgent, ...agentPatch };
  if (agentPatch.nodes) workingAgent.nodes = agentPatch.nodes;

  const patchedFields: Array<{ field: string; occurrences: number }> = [
    { field: primary.label, occurrences: primaryResult.occurrences },
  ];

  const shouldSync =
    args.sync_mirrors &&
    (primaryTarget === 'nodes0' ||
      primaryTarget === 'vg_instructions' ||
      primaryTarget === 'vg_systemPrompt');

  if (shouldSync) {
    for (const mirror of MAIN_PROMPT_TARGETS) {
      if (mirror === primaryTarget) continue;
      const current = readAgentTextField(workingAgent, mirror);
      if (!current.text || !current.text.includes(args.old_string)) continue;
      const mirrorResult = applyExactStringReplace(
        current.text,
        args.old_string,
        args.new_string,
        args.replace_all
      );
      if (!mirrorResult.ok) continue;
      const mirrorPatch = applyPatchToAgentObject(
        workingAgent,
        mirror,
        mirrorResult.updated
      );
      workingAgent = { ...workingAgent, ...mirrorPatch };
      if (mirrorPatch.nodes) workingAgent.nodes = mirrorPatch.nodes;
      Object.assign(agentPatch, mirrorPatch);
      patchedFields.push({
        field: current.label,
        occurrences: mirrorResult.occurrences,
      });
    }
  }

  const result = await getActiveClient().updateAgent(args.agentId, {
    agent: agentPatch,
  });

  return {
    success: true,
    message: `Patched ${patchedFields.map((f) => f.field).join(', ')}`,
    agentId: args.agentId,
    target: primaryTarget,
    patchedFields,
    replace_all: args.replace_all,
    old_string_length: args.old_string.length,
    new_string_length: args.new_string.length,
    preview: {
      beforeExcerpt: primary.text.slice(0, 240),
      afterExcerpt: primaryResult.updated.slice(0, 240),
    },
    result,
  };
}

async function patchKbDocExact(args: {
  agentId: string;
  docId: string;
  old_string: string;
  new_string: string;
  replace_all: boolean;
  field: 'content' | 'name';
}): Promise<Record<string, unknown>> {
  const raw = await getActiveClient().getKBDoc(args.agentId, args.docId);
  const doc = unwrapRecord(raw);
  const current =
    args.field === 'name'
      ? typeof doc.name === 'string'
        ? doc.name
        : ''
      : typeof doc.content === 'string'
        ? doc.content
        : typeof doc.text === 'string'
          ? doc.text
          : '';

  if (!current) {
    throw new Error(
      `KB doc ${args.docId} field "${args.field}" is empty or missing. Re-read with get_kb_doc (ensure content is present).`
    );
  }

  const patched = applyExactStringReplace(
    current,
    args.old_string,
    args.new_string,
    args.replace_all
  );
  if (!patched.ok) {
    throw new Error(`${args.field}: ${patched.error}`);
  }

  const payload =
    args.field === 'name'
      ? { name: patched.updated }
      : { content: patched.updated };
  const result = await getActiveClient().updateKBDoc(
    args.agentId,
    args.docId,
    payload
  );

  return {
    success: true,
    message: `Patched KB ${args.field}`,
    agentId: args.agentId,
    docId: args.docId,
    field: args.field,
    occurrences: patched.occurrences,
    replace_all: args.replace_all,
    old_string_length: args.old_string.length,
    new_string_length: args.new_string.length,
    preview: {
      beforeExcerpt: current.slice(0, 240),
      afterExcerpt: patched.updated.slice(0, 240),
    },
    result,
  };
}

function extractScrapedText(scrapeResult: any): string {
  const page = scrapeResult?.data?.page;
  const candidates: unknown[] = [
    page?.data?.markdown,
    page?.data?.md,
    page?.markdown,
    page?.md,
    page?.data?.content,
    page?.content,
    page?.data?.text,
    page?.text,
    page?.data?.html,
    page?.html,
  ];

  const firstText = candidates.find((value) => typeof value === 'string' && value.trim().length > 0);
  if (!firstText || typeof firstText !== 'string') {
    return '';
  }

  const normalized = firstText
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  return normalized.slice(0, 6000);
}

function splitSentences(text: string): string[] {
  return text
    .split(/(?<=[.!?])\s+/)
    .map((s) => s.trim())
    .filter((s) => s.length >= 24);
}

function uniqueByNormalized(items: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const item of items) {
    const key = item.toLowerCase().replace(/\s+/g, ' ').trim();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(item);
  }
  return out;
}

function scoreSentenceForBusinessFacts(sentence: string): number {
  const s = sentence.toLowerCase();
  let score = 0;
  const strongSignals = [
    'service',
    'services',
    'product',
    'products',
    'solution',
    'solutions',
    'membership',
    'subscription',
    'pricing',
    'plan',
    'plans',
    'support',
    'warranty',
    'guarantee',
    'shipping',
    'delivery',
    'hours',
    'location',
    'contact',
    'about',
    'founded',
    'experience',
    'specialize',
    'industr',
    'feature',
    'benefit',
  ];

  for (const token of strongSignals) {
    if (s.includes(token)) score += 2;
  }
  if (s.includes(':')) score += 1;
  if (s.includes(',')) score += 1;
  if (/\b(24\/7|same day|free|certified|licensed|award|official)\b/i.test(s)) score += 2;
  if (/\b\d{4}\b/.test(s)) score += 1; // founding year / milestones
  if (sentence.length > 260) score -= 1;
  return score;
}

function extractCompanyFacts(scrapedText: string, maxFacts: number = 14): string[] {
  const sentences = uniqueByNormalized(splitSentences(scrapedText));
  const ranked = sentences
    .map((sentence) => ({ sentence, score: scoreSentenceForBusinessFacts(sentence) }))
    .filter((x) => x.score > 0)
    .sort((a, b) => b.score - a.score);

  return ranked.slice(0, maxFacts).map((x) => x.sentence);
}

function extractServiceCatalogHints(scrapedText: string, maxItems: number = 12): string[] {
  const candidates = uniqueByNormalized(
    splitSentences(scrapedText).filter((s) =>
      /\b(service|services|product|products|offer|offers|provide|provides|specialize|solutions|plans|packages|membership|subscription)\b/i.test(
        s
      )
    )
  );

  return candidates.slice(0, maxItems);
}

function choosePersonaName(domainLabel: string): string {
  const names = ['Avery', 'Maya', 'Jordan', 'Riley', 'Casey', 'Taylor', 'Sam', 'Alex'];
  const seed = [...domainLabel].reduce((acc, ch) => acc + ch.charCodeAt(0), 0);
  return names[seed % names.length];
}

function inferBrandStyle(scrapedText: string): string {
  const s = scrapedText.toLowerCase();
  if (/\b(luxury|premium|exclusive|bespoke|concierge|high-end)\b/.test(s)) {
    return 'premium, polished, consultative, detail-oriented';
  }
  if (/\b(legal|law|medical|healthcare|finance|bank|insurance|compliance)\b/.test(s)) {
    return 'professional, precise, compliance-aware, risk-conscious';
  }
  if (/\b(game|gaming|play|entertainment|stream|community|creator)\b/.test(s)) {
    return 'energetic, clear, supportive, user-friendly';
  }
  if (/\b(education|school|learning|nonprofit|charity|community)\b/.test(s)) {
    return 'warm, encouraging, patient, explanatory';
  }
  return 'professional, friendly, concise, practical';
}

function bullets(items: string[], fallback: string): string {
  if (!items.length) return `- ${fallback}`;
  return items.map((item) => `- ${item}`).join('\n');
}

function buildPromptFromScrape(args: {
  url: string;
  domainLabel: string;
  template: string;
  scrapedText: string;
}): string {
  const personaName = choosePersonaName(args.domainLabel);
  const style = inferBrandStyle(args.scrapedText);
  const factBullets = extractCompanyFacts(args.scrapedText, 14);
  const serviceBullets = extractServiceCatalogHints(args.scrapedText, 12);

  return [
    `You are ${personaName}, the official AI assistant for ${args.domainLabel}.`,
    '',
    '## Character, Role, and Style',
    `- Identity: ${personaName}, a dedicated ${args.domainLabel} company representative.`,
    `- Core style: ${style}.`,
    '- Personality: confident, calm, helpful, proactive, and never robotic.',
    '- Primary mission: resolve user needs accurately using verified company information.',
    '',
    '## Company Profile and Facts (authoritative context)',
    bullets(
      factBullets,
      `Use ${args.url} as the primary source of truth for company details, policies, and offerings.`
    ),
    '',
    '## Services / Products / Offerings (operational context)',
    bullets(
      serviceBullets,
      'If a service/product list is not explicit, ask a short clarifying question and proceed safely.'
    ),
    '',
    '## Critical Behavior Rules',
    '- Never invent policies, pricing, guarantees, legal claims, technical specs, or timelines.',
    '- If information is missing or uncertain, say that clearly and ask a focused follow-up question.',
    '- If still uncertain, offer escalation to a human/team member with a concise handoff summary.',
    '- Prefer actionable answers: next steps, options, and what information is needed from the user.',
    '',
    '## Text-First Response Optimization (default)',
    '- Optimize for chat/text first: concise, high-signal, structured answers.',
    '- Use clean Markdown when useful (short headings, bullets, checklists, short tables only when they add clarity).',
    '- Keep replies compact: usually 3-8 sentences unless the user asks for a deep dive.',
    '- Start with the direct answer first, then supporting detail.',
    '',
    '## Voice Behavior (only when user asks for voice/call style)',
    '- If the user explicitly asks for voice/call output, adapt to short spoken phrasing.',
    '- For voice mode: shorter sentences, fewer dense lists, explicit verbal transitions, and confirmation checks.',
    '- Even in voice mode, factual constraints remain strict (no invention).',
    '',
    '## Personalization and User Preference Handling',
    '- Detect user intent quickly (support, pricing, features, account, troubleshooting, policy).',
    '- Mirror user communication style while staying professional and brand-safe.',
    '- Prioritize user-stated preferences (tone, format, depth, urgency) when they do not conflict with policy.',
    '',
    '## Escalation Trigger Examples',
    '- Billing/payment disputes requiring account-level action.',
    '- Security/privacy incidents.',
    '- Legal/compliance-sensitive requests beyond documented policy.',
    '- Any request needing internal systems or non-public data.',
    '',
    '## Grounding Source',
    `- Website source: ${args.url}`,
    '- Treat this source as canonical for company-specific statements.',
    '',
    '## Sanitized Source Excerpt',
    args.scrapedText.slice(0, 3200) || '(No extractable text was available from scrape.)',
  ].join('\n');
}

function buildPromptWithoutScrape(companyLabel: string): string {
  const personaName = choosePersonaName(companyLabel);
  return [
    `You are ${personaName}, the official AI assistant for ${companyLabel}.`,
    '',
    '## Character, Role, and Style',
    '- Professional, warm, concise, practical, and never robotic.',
    '- Act like a high-performing support + product specialist for the company.',
    '',
    '## Core Objectives',
    '- Resolve user requests quickly with clear, trustworthy guidance.',
    '- Gather missing context with short, focused questions.',
    '- Provide actionable next steps, not generic filler.',
    '',
    '## Text-First Optimization',
    '- Default to text/chat excellence: direct answer first, then concise details.',
    '- Use clean Markdown for readability (bullets/checklists) when helpful.',
    '',
    '## Voice Mode (on explicit request)',
    '- If user asks for voice/call behavior, shift to short spoken-style phrasing.',
    '- Keep answers factual and concise; confirm key points out loud.',
    '',
    '## Safety and Accuracy',
    '- Never invent company policies, pricing, legal claims, or unavailable features.',
    '- If unsure, clearly say what is unknown and offer escalation.',
    '',
    '## Personalization',
    '- Mirror user tone and depth preference while keeping brand professionalism.',
    '- Be proactive: suggest the most relevant next step based on user intent.',
  ].join('\n');
}

function buildCustomThemeJSONString(primary: string, themeType: 'light' | 'dark'): string {
  const nine = handleAutoGenPallet(primary, themeType);
  if (!nine?.length) {
    throw new Error('Failed to build nineColorPallet from primaryColor');
  }
  return JSON.stringify({ themeType, primary, nineColorPallet: nine });
}

function isHexColor(value: unknown): value is string {
  return typeof value === 'string' && /^#[0-9A-Fa-f]{3}$|^#[0-9A-Fa-f]{6}$/.test(value);
}

function pickFirstString(candidates: unknown[]): string | undefined {
  for (const c of candidates) {
    if (typeof c === 'string' && c.trim().length > 0) return c.trim();
  }
  return undefined;
}

function extractBrandingFromScrape(scrapeResult: any): { image?: string; primaryColor?: string } {
  const page = scrapeResult?.data?.page;
  const pages = scrapeResult?.data?.pages;
  const image = pickFirstString([
    page?.data?.favicon,
    page?.favicon,
    page?.data?.icon,
    page?.icon,
    page?.data?.logo,
    page?.logo,
    page?.imageUrl,
    Array.isArray(pages) ? pages?.[0]?.imageUrl : undefined,
  ]);

  const colorCandidates: unknown[] = [
    page?.data?.primaryColor,
    page?.primaryColor,
    ...(Array.isArray(page?.data?.colors) ? page.data.colors : []),
    ...(Array.isArray(page?.colors) ? page.colors : []),
    ...(Array.isArray(page?.data?.palette) ? page.data.palette : []),
    ...(Array.isArray(page?.palette) ? page.palette : []),
  ];

  const primaryColor = colorCandidates.find((c) => {
    if (typeof c !== 'string') return false;
    const normalized = c.startsWith('#') ? c : `#${c}`;
    return isHexColor(normalized);
  });

  return {
    image,
    primaryColor:
      typeof primaryColor === 'string'
        ? (primaryColor.startsWith('#') ? primaryColor : `#${primaryColor}`)
        : undefined,
  };
}

function buildGeminiNodesSettings(systemPrompt: string, voicePrompt?: string) {
  const text = (voicePrompt != null && voicePrompt.trim().length > 0 ? voicePrompt : systemPrompt).trim();
  const base = JSON.parse(JSON.stringify(DEFAULT_GEMINI_LIVE_OPTIONS)) as Record<string, unknown>;
  const session = (base.sessionConfig as Record<string, unknown>) || {};
  const mergedSession = mergeDeep(session, {
    systemInstruction: { parts: [{ text }] },
  });
  const merged = mergeDeep(base, { sessionConfig: mergedSession });
  return { geminiLiveOptions: merged };
}

function sanitizeTemplateAdditionalConfig(
  input?: Record<string, unknown>
): { nodesSettings: Record<string, unknown>; rest: Record<string, unknown> } {
  const src = input || {};
  const nodesSettings = isPlainRecord(src.nodesSettings)
    ? (src.nodesSettings as Record<string, unknown>)
    : {};
  const rest: Record<string, unknown> = {};

  for (const [key, value] of Object.entries(src)) {
    if (key === 'nodesSettings') continue;
    if (key.startsWith('vg_')) continue;
    if (key === 'agentPlatform') continue;
    if (key === 'enableNodes') continue;
    if (key === 'nodes') continue;
    if (key === 'lang') continue;
    if (key === 'voiceConfig') continue;
    rest[key] = value;
  }

  return { nodesSettings, rest };
}

function normalizeToolError(error: unknown, fallbackStage: string, extra: Record<string, unknown> = {}) {
  if (error instanceof ConvocoreApiRequestError) {
    return {
      success: false,
      message: error.message,
      data: {
        stage: fallbackStage,
        errorType: 'api_request_error',
        endpoint: error.endpoint,
        method: error.method,
        status: error.status ?? null,
        code: error.code ?? null,
        issues: error.issues ?? [],
        response: error.responseData ?? null,
        rawBody: typeof error.rawBody === 'string' && error.rawBody.length > 0 ? error.rawBody : null,
        constructiveFeedback:
          Array.isArray(error.issues) && error.issues.length > 0
            ? 'Fix the fields listed in `issues` and retry once with a corrected payload. Do not keep retrying nearby variants without changing those fields.'
            : 'Inspect `response` / `rawBody` for the API-side validation or permission error, then retry once with a materially changed payload.',
        ...extra,
      },
    };
  }

  if (error instanceof z.ZodError) {
    return {
      success: false,
      message: 'Invalid arguments',
      data: {
        stage: fallbackStage,
        errorType: 'input_validation_error',
        issues: error.issues,
        constructiveFeedback:
          'Fix the argument shape according to `issues`. Retry only after changing the invalid/missing fields; do not resend the same payload.',
        ...extra,
      },
    };
  }

  if (error instanceof Error) {
    return {
      success: false,
      message: error.message,
      data: {
        stage: fallbackStage,
        errorType: 'runtime_error',
        constructiveFeedback:
          'A runtime error occurred. Use the stage/tool metadata to decide the next action instead of blindly retrying the same call.',
        ...extra,
      },
    };
  }

  return {
    success: false,
    message: 'Unknown error',
    data: {
      stage: fallbackStage,
      errorType: 'unknown_error',
      constructiveFeedback:
        'Unknown failure shape. Avoid repeated retries with the same payload; inspect the surrounding tool context and change inputs before retrying.',
      ...extra,
    },
  };
}

function normalizeErrorDetails(error: unknown) {
  if (error instanceof ConvocoreApiRequestError) {
    return {
      errorType: 'api_request_error',
      message: error.message,
      endpoint: error.endpoint,
      method: error.method,
      status: error.status ?? null,
      code: error.code ?? null,
      issues: error.issues ?? [],
      response: error.responseData ?? null,
      rawBody: typeof error.rawBody === 'string' && error.rawBody.length > 0 ? error.rawBody : null,
    };
  }

  if (error instanceof z.ZodError) {
    return {
      errorType: 'input_validation_error',
      message: 'Invalid arguments',
      issues: error.issues,
    };
  }

  if (error instanceof Error) {
    return {
      errorType: 'runtime_error',
      message: error.message,
    };
  }

  return {
    errorType: 'unknown_error',
    message: 'Unknown error',
  };
}

async function resolveExistingTemplateAgentByIdempotencyKey(
  key: string
): Promise<{ agentId: string; agent: any } | null> {
  const existingAgentId = await templateIdempotencyStore.getAgentId(key);
  if (!existingAgentId) return null;

  try {
    const existing = await getActiveClient().getAgent(existingAgentId);
    const agent = (existing as any)?.data ?? existing;
    return { agentId: existingAgentId, agent };
  } catch {
    await templateIdempotencyStore.deleteKey(key);
    return null;
  }
}

async function createAgentFromTemplateFlow(args: z.infer<typeof CreateAgentFromTemplateSchema>) {
  const idempotencyKey = computeTemplateIdempotencyKey(args as Record<string, unknown>, {
    baseUrl: getActiveConfig().baseUrl,
    workspaceSecret: getActiveConfig().workspaceSecret,
  });

  return runTemplateIdempotent(idempotencyKey, async () => {
    const existing = await resolveExistingTemplateAgentByIdempotencyKey(idempotencyKey);
    if (existing) {
      const links = prototypeLinksForAgent(existing.agentId);
      return {
        success: true,
        message: `create_agent_from_template idempotency hit. Send the user this try-it link: ${links.prototypeUrl}`,
        data: {
          stage: 'idempotency_hit',
          idempotencyKey,
          agentId: existing.agentId,
          ...links,
          note:
            'Public demo URL is https://app.convocore.ai/{eu|na}/prototype/{agentId}. Never use /agents/{id}.',
          agent: existing.agent,
          warning:
            'This request was already fulfilled. Returning the existing agent to prevent duplicate creation.',
        },
      };
    }

    const result = await createAgentFromTemplateFlowCore(args);
    const createdAgentId = (result as any)?.data?.agentId;
    if (typeof createdAgentId === 'string' && createdAgentId.trim().length > 0) {
      await templateIdempotencyStore.setAgentId(idempotencyKey, createdAgentId.trim());
      if ((result as any)?.data) {
        (result as any).data.idempotencyKey = idempotencyKey;
      }
    }
    return result;
  });
}

async function createAgentFromTemplateFlowCore(args: z.infer<typeof CreateAgentFromTemplateSchema>) {
  const {
    title,
    description,
    systemPrompt,
    voicePrompt,
    voiceConfig: inputVoiceConfig,
    primaryColor: inputPrimaryColor,
    themeType,
    widgetImageUrl,
    image,
    roundedImageURL,
    defaultLanguage,
    language,
    chatBgURL,
    branding,
    proactiveMessage,
    sourceUrl: sourceUrlInput,
    url,
    createKbUrlDoc,
    additionalConfig,
  } = args;

  const sourceUrl = sourceUrlInput ?? url;
  const resolvedWorkspaceId = await resolveWorkspaceId();
  let stage = 'start';

  let scrapeMeta: {
    success: boolean;
    timedOut: boolean;
    url: string;
    excerpt: string;
  } | null = null;
  let scrapedBranding: { image?: string; primaryColor?: string } = {};

  if (sourceUrl) {
    stage = 'scrape_url';
    let scrapeResult: any;
    try {
      scrapeResult = await getActiveClient().scrapeUrl(resolvedWorkspaceId, sourceUrl);
    } catch (error) {
      return normalizeToolError(error, stage, {
        tool: 'create_agent_from_template',
        workspaceId: resolvedWorkspaceId,
        sourceUrl,
      });
    }
    const scrapedText = extractScrapedText(scrapeResult);
    scrapedBranding = extractBrandingFromScrape(scrapeResult);
    scrapeMeta = {
      success: !!(scrapeResult as any)?.success,
      timedOut: !!(scrapeResult as any)?.data?.timedOut,
      url: sourceUrl,
      excerpt: scrapedText.slice(0, 1200),
    };

    if ((scrapeResult as any)?.data?.timedOut) {
      return {
        success: false,
        message: 'create_agent_from_template timed out waiting for scrape_url.',
        data: {
          stage,
          workspaceId: resolvedWorkspaceId,
          scrape: scrapeMeta,
        },
      };
    }
  }

  const titleResolved = title || (sourceUrl ? `${toDomainLabel(sourceUrl)} Assistant` : 'AI Assistant');
  let existingByTitle: any = null;
  try {
    existingByTitle = await findExistingAgentByExactTitle(titleResolved);
  } catch {
    existingByTitle = null;
  }

  if (existingByTitle) {
    const existingId = getAgentId(existingByTitle);
    if (existingId) {
      console.error(
        `[debug] create_agent_from_template title-level dedupe hit; title=\"${titleResolved}\" existingAgentId=${existingId}`
      );
      let fullExisting: any = null;
      try {
        const fetched = await getActiveClient().getAgent(existingId);
        fullExisting = (fetched as any)?.data ?? fetched;
      } catch {
        fullExisting = existingByTitle;
      }
      return {
        success: true,
        message:
          'create_agent_from_template title dedupe hit: returning existing agent with the same title to prevent duplicate creation.',
        data: {
          stage: 'title_dedupe_hit',
          workspaceId: resolvedWorkspaceId,
          agentId: existingId,
          agent: fullExisting,
          warning:
            'An agent with this exact title already exists. MCP returned it instead of creating another one.',
        },
      };
    }
  }

  const generatedPrompt = sourceUrl
    ? buildPromptFromScrape({
        url: sourceUrl,
        domainLabel: toDomainLabel(sourceUrl),
        template: 'customer_support',
        scrapedText: scrapeMeta?.excerpt ?? '',
      })
    : buildPromptWithoutScrape(titleResolved);
  const systemPromptResolved = (systemPrompt && systemPrompt.trim().length > 0 ? systemPrompt : generatedPrompt).trim();
  const imageResolved = widgetImageUrl || image || roundedImageURL || scrapedBranding.image;
  const primaryColorResolved = inputPrimaryColor || scrapedBranding.primaryColor || '#226D7A';
  const defaultLanguageResolved = resolveSingleLanguage(defaultLanguage ?? language ?? 'en');
  const voiceConfig = inputVoiceConfig ?? DEFAULT_TEMPLATE_VOICE_CONFIG;
  const provider = voiceConfig?.speechGen?.provider;
  if (provider !== 'google-live' && provider !== 'ultravox') {
    return {
      success: false,
      message:
        'voiceConfig.speechGen.provider must be `google-live` or `ultravox` for create_agent_from_template.',
      data: {
        stage: 'validation',
        provider: provider ?? null,
      },
    };
  }

  const templateVoiceBase = JSON.parse(JSON.stringify(DEFAULT_TEMPLATE_VOICE_CONFIG)) as Record<string, unknown>;
  const resolvedVoice = mergeDeep(templateVoiceBase, voiceConfig as Record<string, unknown>);

  const sanitizedAdditional = sanitizeTemplateAdditionalConfig(
    (additionalConfig || {}) as Record<string, unknown>
  );
  const extraNs = sanitizedAdditional.nodesSettings;

  let nodesSettings: Record<string, unknown> | undefined;

  if (resolvedVoice.speechGen && (resolvedVoice.speechGen as { provider?: string }).provider === 'google-live') {
    const built = buildGeminiNodesSettings(systemPromptResolved, voicePrompt);
    nodesSettings = {
      ...extraNs,
      geminiLiveOptions: mergeDeep(
        built.geminiLiveOptions as Record<string, unknown>,
        (extraNs.geminiLiveOptions as Record<string, unknown>) || {}
      ),
    };
  } else if (Object.keys(extraNs).length > 0) {
    nodesSettings = extraNs;
  }

  const agentCore: Record<string, unknown> = {
    agentPlatform: 'vg',
    title: titleResolved,
    description: description ?? '',
    theme: themeType === 'dark' ? 'custom-blue-dark' : 'custom-blue-light',
    enableNodes: true,
    vg_enableUIEngine: true,
    vg_defaultModel: DEFAULT_MODEL_FOR_TEMPLATE_AGENTS,
    vg_systemPrompt: systemPromptResolved,
    vg_instructions: systemPromptResolved,
    voiceConfig: resolvedVoice,
    nodes: [buildTemplateStartNode(systemPromptResolved)],
    lang: defaultLanguageResolved,
    proactiveMessage: proactiveMessage ?? '👋 Hi, how can I help you today?',
    roundedImageURL: imageResolved,
    customThemeJSONString: buildCustomThemeJSONString(primaryColorResolved, themeType),
    chatBgURL,
    branding,
  };

  if (nodesSettings) {
    agentCore.nodesSettings = nodesSettings;
  }

  const payload = { agent: mergeDeep(agentCore, sanitizedAdditional.rest as Record<string, unknown>) };
  payload.agent.nodes = normalizeTemplateAgentNodesForCreate(payload.agent.nodes);
  // Hard-enforce template invariants.
  payload.agent.agentPlatform = 'vg';
  payload.agent.enableNodes = true;
  payload.agent.vg_enableUIEngine = true;
  payload.agent.vg_defaultModel = DEFAULT_MODEL_FOR_TEMPLATE_AGENTS;
  payload.agent.vg_systemPrompt = systemPromptResolved;
  payload.agent.vg_instructions = systemPromptResolved;

  stage = 'create_agent';
  let result: any;
  try {
    result = await getActiveClient().createAgent(payload as any);
  } catch (error) {
    return normalizeToolError(error, stage, {
      tool: 'create_agent_from_template',
      workspaceId: resolvedWorkspaceId,
      attemptedAgent: {
        title: payload.agent?.title ?? null,
        agentPlatform: payload.agent?.agentPlatform ?? null,
        theme: payload.agent?.theme ?? null,
        hasVoiceConfig: !!payload.agent?.voiceConfig,
        hasNodes: Array.isArray(payload.agent?.nodes),
      },
    });
  }
  const createdAgentId = (result as any)?.data?.ID || (result as any)?.data?.id;

  let fullAgent: any = null;
  let platformRepair: any = null;
  if (createdAgentId) {
    stage = 'get_agent';
    let got: any;
    try {
      got = await getActiveClient().getAgent(createdAgentId);
    } catch (error) {
      return {
        success: true,
        message:
          'create_agent_from_template created the agent, but post-create get_agent failed. Returning create response to avoid duplicate retries.',
        data: {
          stage: 'created_but_get_agent_failed',
          tool: 'create_agent_from_template',
          workspaceId: resolvedWorkspaceId,
          agentId: createdAgentId,
          createResponse: result,
          warning:
            'Agent was created successfully. Do NOT call create_agent_from_template again for the same request; use get_agent/update_agent with the returned agentId.',
          postCreateError: normalizeErrorDetails(error),
        },
      };
    }
    fullAgent = (got as any)?.data ?? got;

    const currentPlatform = fullAgent?.agentPlatform;
    if (currentPlatform !== 'vg') {
      stage = 'repair_agent_platform';
      let repairResult: any;
      try {
        const repairPayload = {
          agent: {
            agentPlatform: 'vg',
            enableNodes: true,
            vg_enableUIEngine: true,
            vg_defaultModel: DEFAULT_MODEL_FOR_TEMPLATE_AGENTS,
            vg_systemPrompt: systemPromptResolved,
            vg_instructions: systemPromptResolved,
            nodes: normalizeTemplateAgentNodesForCreate([buildTemplateStartNode(systemPromptResolved)]) as any,
            voiceConfig: resolvedVoice as any,
            lang: defaultLanguageResolved,
            roundedImageURL: imageResolved,
            customThemeJSONString: buildCustomThemeJSONString(primaryColorResolved, themeType),
          },
        };
        repairResult = await getActiveClient().updateAgent(createdAgentId, repairPayload);
      } catch (error) {
        return {
          success: true,
          message:
            'create_agent_from_template created the agent, but agentPlatform repair failed during post-create checks.',
          data: {
            stage: 'created_but_repair_failed',
            tool: 'create_agent_from_template',
            workspaceId: resolvedWorkspaceId,
            agentId: createdAgentId,
            observedAgentPlatform: currentPlatform ?? null,
            createResponse: result,
            warning:
              'Agent already exists. Do NOT retry create. Use update_agent on this agentId to repair fields.',
            postCreateError: normalizeErrorDetails(error),
          },
        };
      }

      platformRepair = repairResult;

      stage = 'verify_agent_platform';
      let verifyResult: any;
      try {
        verifyResult = await getActiveClient().getAgent(createdAgentId);
      } catch (error) {
        return {
          success: true,
          message:
            'create_agent_from_template created the agent, but post-repair verification get_agent failed.',
          data: {
            stage: 'created_repaired_but_verify_failed',
            tool: 'create_agent_from_template',
            workspaceId: resolvedWorkspaceId,
            agentId: createdAgentId,
            createResponse: result,
            repairResponse: repairResult,
            warning:
              'Agent already exists. Do NOT retry create. Re-run get_agent for this agentId and repair via update_agent if needed.',
            postCreateError: normalizeErrorDetails(error),
          },
        };
      }

      fullAgent = (verifyResult as any)?.data ?? verifyResult;

      if (fullAgent?.agentPlatform !== 'vg') {
        return {
          success: true,
          message:
            'create_agent_from_template created an agent, but upstream still reports agentPlatform != "vg" after repair.',
          data: {
            stage: 'created_but_platform_not_vg_after_repair',
            tool: 'create_agent_from_template',
            workspaceId: resolvedWorkspaceId,
            agentId: createdAgentId,
            observedAgentPlatform: fullAgent?.agentPlatform ?? null,
            createResponse: result,
            repairResponse: repairResult,
            agent: fullAgent,
            warning:
              'Agent already exists. Do NOT retry create. Escalate using this agentId and included create/repair responses.',
          },
        };
      }
    }
  }

  let kbImportResult: any = null;
  if (createKbUrlDoc && createdAgentId && sourceUrl) {
    const domainLabel = toDomainLabel(sourceUrl);
    try {
      kbImportResult = await getActiveClient().createKBDoc(createdAgentId, {
        name: `${domainLabel} Website`,
        sourceType: 'url',
        urls: [sourceUrl],
        scrapeContent: true,
        refreshRate: 'never',
      });
    } catch (error) {
      kbImportResult = {
        success: false,
        message: error instanceof Error ? error.message : 'KB import failed',
      };
    }
  }

  const links = prototypeLinksForAgent(createdAgentId);
  return {
    success: !!createdAgentId,
    message: createdAgentId
      ? `create_agent_from_template completed successfully. Send the user this try-it link: ${links.prototypeUrl}`
      : 'create_agent_from_template did not return an agent ID from createAgent response.',
    data: {
      stage: createdAgentId ? 'done' : stage,
      workspaceId: resolvedWorkspaceId,
      agentId: createdAgentId ?? null,
      ...links,
      recommendedModel: DEFAULT_MODEL_FOR_TEMPLATE_AGENTS,
      fallbackModel: FALLBACK_CHAT_MODEL_ID,
      note:
        'Public demo URL is https://app.convocore.ai/{eu|na}/prototype/{agentId}. Never use /agents/{id}. New agents use gpt-5.6-luna.',
      agent: fullAgent ?? (result as any)?.data ?? result,
      createResponse: result,
      platformRepair,
      primaryColor: primaryColorResolved,
      themeType,
      scrape: scrapeMeta,
      kbImport: kbImportResult,
    },
  };
}

// Define MCP tools
const tools: Tool[] = [
  {
    name: 'create_agent',
    description:
      'Create a new Convocore AI agent directly from supplied fields (legacy/raw mode). For new branded chat+voice agents, use scrape_url + create_agent_from_template with explicit prompts and voiceConfig. Use this tool only for manual/advanced direct payload control. ' +
      'New agents MUST use chat model gpt-5.6-luna (vg_defaultModel + nodes[0].llmConfig.modelId). Fallback: gemini-3.1-flash-lite. Do not pick gpt-4o / gpt-4o-mini / other legacy models. ' +
      'UI Engine: set vg_enableUIEngine plus optional forms/invoice/calendar flags and vg_uiEngineChannelConfig to control which UI elements (cards, buttons, forms, invoice, …) the agent may emit.',
    inputSchema: {
      type: 'object',
      properties: {
        title: {
          type: 'string',
          description: 'The title of the agent',
        },
        description: {
          type: 'string',
          description: 'A brief description of the agent',
        },
        theme: {
          type: 'string',
          description: 'Visual theme (e.g., blue-light, custom-blue-dark)',
        },
        disabled: {
          type: 'boolean',
          description: 'Whether the agent should be disabled',
        },
        light: {
          type: 'boolean',
          description: 'Enable light mode (no chat history retention for privacy)',
        },
        enableVertex: {
          type: 'boolean',
          description: 'Enable Vertex AI for the agent',
        },
        autoOpenWidget: {
          type: 'boolean',
          description: 'Auto-open widget when agent loads',
        },
        enableNodes: {
          type: 'boolean',
          description:
            'Enable node-based agent behavior. If true, put the main prompt in nodes[0].instructions. If false/legacy, use vg_instructions.',
        },
        vg_instructions: {
          type: 'string',
          description:
            'Legacy main prompt field for old/non-node agents. For modern enableNodes=true agents, use nodes[0].instructions instead.',
        },
        ...AgentUiEngineInputSchemaProperties,
        voiceConfig: AgentVoiceConfigInputSchema,
        nodes: {
          type: 'array',
          items: AgentNodeInputSchema,
          description:
            'Agent nodes array. For enableNodes=true agents, the FIRST node (nodes[0]) should contain the main prompt in its instructions field. Example: [{ "instructions": "Main agent prompt", "name": "Main Node" }].',
        },
        additionalConfig: {
          type: 'object',
          description:
            'Escape hatch for raw agent fields not modeled by this MCP yet. Prefer explicit fields including UI Engine flags (vg_enableUIEngine*, vg_uiEngineChannelConfig, …). Never set read-only fields like ownerID here.',
        },
      },
      required: ['title'],
    },
  },
  {
    name: 'create_agent_from_template',
    description:
      'PRIMARY way to create chat+voice agents. Workspace is resolved internally from MCP configuration/workspace secret context (no workspaceId input). Uses strict template invariants: agentPlatform=vg, enableNodes=true, vg_enableUIEngine=true, chat model gpt-5.6-luna (fallback gemini-3.1-flash-lite), and vg_* overrides are blocked from additionalConfig. ' +
      'Response includes prototypeUrl / tryItUrl — ALWAYS paste that link for the user to try the agent. Pattern: https://app.convocore.ai/{eu|na}/prototype/{agentId}. NEVER invent app.convocore.ai/agents/...',
    inputSchema: {
      type: 'object',
      properties: {
        title: { type: 'string', description: 'Agent title' },
        description: { type: 'string', description: 'Short description' },
        systemPrompt: {
          type: 'string',
          description: 'Main chat / node instructions (nodes[0] + vg_systemPrompt + vg_instructions).',
        },
        voicePrompt: {
          type: 'string',
          description:
            'Optional Gemini Live systemInstruction text. If omitted, systemPrompt is used for voice as well.',
        },
        voiceConfig: {
          ...AgentVoiceConfigInputSchema,
          description:
            'Full voice configuration. speechGen.provider MUST be `google-live` or `ultravox`. Use search_voices on those providers only.',
        },
        primaryColor: {
          type: 'string',
          description: 'Hex brand colour, e.g. #226D7A (from scrape_url colour list).',
        },
        themeType: {
          type: 'string',
          enum: ['light', 'dark'],
          description: 'Widget theme (default light unless user wants dark)',
        },
        widgetImageUrl: {
          type: 'string',
          format: 'uri',
          description: 'Widget assistant avatar/logo URL (favicon from scrape_url is ideal).',
        },
        image: {
          type: 'string',
          format: 'uri',
          description: 'Backward-compatible alias for widgetImageUrl.',
        },
        defaultLanguage: {
          type: 'string',
          description:
            'Default language for the agent. Must be a single language code/name (never "multilingual"). Default: "en".',
        },
        language: { type: 'string', description: 'Backward-compatible alias for defaultLanguage.' },
        proactiveMessage: { type: 'string', description: 'Widget greeting bubble' },
        sourceUrl: {
          type: 'string',
          format: 'uri',
          description: 'Optional — MCP waits for scrape (for KB / context). Not required to create the agent.',
        },
        url: {
          type: 'string',
          format: 'uri',
          description: 'Backward-compatible alias for sourceUrl.',
        },
        roundedImageURL: {
          type: 'string',
          format: 'uri',
          description: 'Backward-compatible alias for image.',
        },
        template: {
          type: 'string',
          description: 'Backward-compatible field currently ignored.',
        },
        createKbUrlDoc: {
          type: 'boolean',
          description: 'If true with sourceUrl, attach URL KB after create (errors are non-fatal).',
        },
        requestId: {
          type: 'string',
          description:
            'Optional idempotency key. Reusing the same requestId returns the already-created agent instead of creating a duplicate.',
        },
        branding: { type: 'string' },
        chatBgURL: { type: 'string', format: 'uri' },
        additionalConfig: {
          type: 'object',
          description: 'Merged last into agent root with safeguards. Keys starting with vg_ (and core template keys) are ignored.',
        },
      },
      required: [],
    },
  },
  {
    name: 'get_agent',
    description:
      'Retrieve details of a specific Convocore agent. Prompt rule: if enableNodes=true, read the main prompt from nodes[0].instructions. If enableNodes=false or nodes are absent (old agent), read legacy vg_instructions. ownerID is the workspaceId and is read-only. ' +
      'Response includes prototypeUrl / tryItUrl — share that public demo with the user (https://app.convocore.ai/{eu|na}/prototype/{agentId}). Never invent /agents/ links.',
    inputSchema: {
      type: 'object',
      properties: {
        agentId: {
          type: 'string',
          description: 'The unique identifier of the agent',
        },
      },
      required: ['agentId'],
    },
  },
  {
    name: 'update_agent',
    description:
      'Update an existing Convocore agent (full-field PATCH). CRITICAL: for large prompts prefer patch_agent_prompt (Cursor-style exact old_string→new_string) instead of rewriting the entire instructions string. ' +
      'Prompt rule: if enableNodes=true, main prompt is nodes[0].instructions; if legacy, vg_instructions. ' +
      'UI Engine elements: use vg_enableUIEngine (master) plus vg_enableUIEngineForms / vg_enableUIEngineInvoice / vg_enableUIEngineCalendarBooking and vg_uiEngineChannelConfig to control which UI the agent may show (choice buttons, cards, carousels, forms, invoice, calendar, etc.). Call get_ui_engine_spec for message payloads. ' +
      'ownerID/workspaceId is read-only. Integrations are workspace/org/client-level, not agent-level.',
    inputSchema: {
      type: 'object',
      properties: {
        agentId: {
          type: 'string',
          description: 'The unique identifier of the agent to update',
        },
        title: {
          type: 'string',
          description: 'Updated title',
        },
        description: {
          type: 'string',
          description: 'Updated description',
        },
        theme: {
          type: 'string',
          description: 'Updated theme',
        },
        disabled: {
          type: 'boolean',
          description: 'Updated disabled status',
        },
        light: {
          type: 'boolean',
          description: 'Updated light mode setting',
        },
        enableVertex: {
          type: 'boolean',
          description: 'Updated Vertex AI setting',
        },
        autoOpenWidget: {
          type: 'boolean',
          description: 'Updated auto-open widget setting',
        },
        enableNodes: {
          type: 'boolean',
          description:
            'Enable/disable node-based behavior. If true, the main prompt comes from nodes[0].instructions. If false/legacy, vg_instructions is used.',
        },
        vg_instructions: {
          type: 'string',
          description:
            'Legacy main prompt for old/non-node agents. Only use as the main prompt when enableNodes=false or nodes are absent.',
        },
        ...AgentUiEngineInputSchemaProperties,
        voiceConfig: AgentVoiceConfigInputSchema,
        nodes: {
          type: 'array',
          items: AgentNodeInputSchema,
          description:
            'IMPORTANT: Agent nodes array. For enableNodes=true agents, update nodes[0].instructions to change the canonical main prompt. Include the full intended nodes array if the API replaces arrays. Example: [{ "instructions": "Your new prompt here", "name": "Main Node" }].',
        },
        additionalConfig: {
          type: 'object',
          description:
            'Escape hatch for raw agent fields not modeled by this MCP yet. Prefer explicit UI Engine fields (vg_enableUIEngine*, vg_uiEngineChannelConfig, vg_uiEngine*Config) over stuffing them here. Never set read-only fields like ownerID/workspaceId here.',
        },
      },
      required: ['agentId'],
    },
  },
  {
    name: 'patch_agent_prompt',
    description:
      'Performs exact string replacements in an agent prompt or related text field — same idea as Cursor StrReplace for files. ' +
      'USE THIS instead of update_agent when the prompt is large and you only need to change a specific section. ' +
      'Workflow: get_agent (or prior context) → copy the exact span into old_string (include enough surrounding lines so it is unique) → new_string is the replacement → this tool patches and PATCHes the agent. ' +
      'old_string must match the current text exactly including whitespace. Prefer editing existing prompts with this tool over rewriting the whole instructions blob. ' +
      'Only use replace_all=true when you intentionally want every occurrence changed. ' +
      'target=auto picks nodes[0].instructions when enableNodes/nodes exist, otherwise vg_instructions. ' +
      'By default also syncs the same replace onto the other main-prompt mirrors (nodes[0].instructions / vg_instructions / vg_systemPrompt) when they contain old_string.',
    inputSchema: {
      type: 'object',
      properties: {
        agentId: {
          type: 'string',
          description: 'The agent ID whose prompt/text field to patch',
        },
        old_string: {
          type: 'string',
          description:
            'Exact text to find (whitespace-sensitive). MUST match the current prompt exactly. Include surrounding context so the match is unique unless replace_all is true.',
        },
        new_string: {
          type: 'string',
          description:
            'Replacement text for the matched span. Use an empty string to delete the matched text.',
        },
        replace_all: {
          type: 'boolean',
          description:
            'If false (default), fails when old_string matches more than once. If true, replaces every occurrence.',
        },
        target: {
          type: 'string',
          enum: ['auto', 'nodes0', 'vg_instructions', 'vg_systemPrompt', 'proactiveMessage', 'customCSS'],
          description:
            'Field to patch. auto (default) = nodes[0].instructions when present, else vg_instructions. customCSS patches widget CSS surgically.',
        },
        sync_mirrors: {
          type: 'boolean',
          description:
            'When patching a main prompt field, also apply the same exact replace to the other main mirrors if they contain old_string (default true). Ignored for proactiveMessage/customCSS.',
        },
      },
      required: ['agentId', 'old_string', 'new_string'],
    },
  },
  {
    name: 'delete_agent',
    description: 'Delete a Convocore agent permanently',
    inputSchema: {
      type: 'object',
      properties: {
        agentId: {
          type: 'string',
          description: 'The unique identifier of the agent to delete',
        },
      },
      required: ['agentId'],
    },
  },
  {
    name: 'list_agents',
    description:
      'List accessible agents. Passing `limit` requests a capped page when the API supports it — strongly recommended vs downloading the entire workspace catalog. Prefer search_agents for filtered lookup. Resolve workspace/org ID once (ownerID / CONVOCORE_WORKSPACE_ID) for other tools.',
    inputSchema: {
      type: 'object',
      properties: {
        limit: {
          type: 'number',
          description:
            'When supported, return at most this many agents (recommended: small). Omit only if you intentionally need the full list.',
        },
      },
      required: [],
    },
  },
  {
    name: 'search_agents',
    description:
      'Search/filter Convocore agents. Workspace is resolved internally from MCP configuration/workspace secret context; callers should never pass workspaceId. Use list_agents only when the user explicitly wants recent/latest agents without search filters.',
    inputSchema: {
      type: 'object',
      properties: {
        search: {
          type: 'string',
          description: 'Search query to find agents',
        },
        page: {
          type: 'number',
          description: 'Page number (default: 1)',
        },
        limit: {
          type: 'number',
          description: 'Results per page (default: 50)',
        },
        sortBy: {
          type: 'string',
          description: 'Sort by: newest, oldest, alphabetical (default: newest)',
        },
        starredOnly: {
          type: 'boolean',
          description: 'Show only starred agents (default: false)',
        },
      },
      required: [],
    },
  },
  {
    name: 'export_agent',
    description:
      'Export an agent template for backup or migration. For import/export, rely on these dedicated OpenAPI routes instead of trying to manually construct the template shape.',
    inputSchema: {
      type: 'object',
      properties: {
        agentId: {
          type: 'string',
          description: 'The agent ID to export',
        },
      },
      required: ['agentId'],
    },
  },
  {
    name: 'import_agent',
    description:
      'Import an agent from a template produced by export_agent / the OpenAPI export-template route. The template shape is complex; do not invent it manually unless the user provides an exact exported object.',
    inputSchema: {
      type: 'object',
      properties: {
        agentTemplate: {
          type: 'object',
          description:
            'Agent template object from export_agent / export-template. Pass the exported template object through; do not manually invent nested template fields.',
        },
        agentName: {
          type: 'string',
          description: 'Name for the imported agent',
        },
        fromAgentId: {
          type: 'string',
          description: 'Optional source agent ID to preserve import lineage/context when the backend supports it.',
        },
      },
      required: ['agentTemplate', 'agentName'],
    },
  },
  {
    name: 'get_agent_usage',
    description: 'Get agent usage statistics and credits consumed',
    inputSchema: {
      type: 'object',
      properties: {
        agentId: {
          type: 'string',
          description: 'The agent ID to get usage for',
        },
        range: {
          type: 'object',
          description: 'Optional date range for usage stats',
          properties: {
            from: {
              type: 'string',
              description: 'Start date (ISO format, e.g., 2024-01-01)',
            },
            to: {
              type: 'string',
              description: 'End date (ISO format, e.g., 2024-01-31)',
            },
          },
        },
      },
      required: ['agentId'],
    },
  },
  // ==================== CONVERSATION TOOLS ====================
  {
    name: 'list_conversations',
    description:
      'List conversations for an agent (newest first) from the Postgres conversation mirror. ' +
      'Pagination is cursor-based: response includes hasMore + nextCursor. ' +
      'To fetch the next page, call again with cursor=<previous nextCursor>. ' +
      'Do NOT bump page alone — page>1 without cursor is rejected. Max limit=20. ' +
      'List rows may omit Firestore-only fields such as title/lastMessage.',
    inputSchema: {
      type: 'object',
      properties: {
        agentId: {
          type: 'string',
          description: 'The agent ID to list conversations for',
        },
        cursor: {
          type: 'string',
          description:
            'Opaque cursor from previous response nextCursor. Required to paginate past the first page.',
        },
        limit: {
          type: 'number',
          description: 'Results per page (default: 20, max: 20)',
        },
        page: {
          type: 'number',
          description:
            'Legacy. Only page=1 without cursor. Prefer cursor / nextCursor / hasMore.',
        },
      },
      required: ['agentId'],
    },
  },
  {
    name: 'create_conversation',
    description: 'Create a new conversation for an agent',
    inputSchema: {
      type: 'object',
      properties: {
        agentId: {
          type: 'string',
          description: 'The agent ID',
        },
        conversation: {
          type: 'object',
          description: 'Conversation object (minimum: { ts: timestamp })',
        },
      },
      required: ['agentId', 'conversation'],
    },
  },
  {
    name: 'get_conversation',
    description: 'Get details of a single conversation',
    inputSchema: {
      type: 'object',
      properties: {
        agentId: {
          type: 'string',
          description: 'The agent ID',
        },
        convoId: {
          type: 'string',
          description: 'The conversation ID',
        },
      },
      required: ['agentId', 'convoId'],
    },
  },
  {
    name: 'update_conversation',
    description:
      'Patch fields on the light conversation document. This does NOT replace the stored turn/message history. To replace transcript turns, use update_conversation_messages.',
    inputSchema: {
      type: 'object',
      properties: {
        agentId: {
          type: 'string',
          description: 'The agent ID',
        },
        convoId: {
          type: 'string',
          description: 'The conversation ID',
        },
        conversation: {
          type: 'object',
          description: 'Conversation fields to update',
        },
      },
      required: ['agentId', 'convoId', 'conversation'],
    },
  },
  {
    name: 'update_conversation_messages',
    description:
      'Replace the stored message turn history for a conversation using PATCH /agents/{agentId}/convos/{convoId}/messages. This overwrites voiceglow/{agentId}/convos/{convoId}/convo/JSON_STRING with the provided `turns` array. Set updateConversationMetadata=true (default) to also refresh messagesNum, lastMessage, firstMessageTS, lastMessageTS, and lastModified on the light conversation doc. Because this is a full replacement, confirmReplace must be true.',
    inputSchema: {
      type: 'object',
      properties: {
        agentId: {
          type: 'string',
          description: 'The agent ID.',
        },
        convoId: {
          type: 'string',
          description: 'The conversation ID.',
        },
        turns: {
          type: 'array',
          description:
            'Complete replacement turn history. Each turn requires from + messages. This array becomes the stored transcript history.',
          items: {
            type: 'object',
            properties: {
              from: {
                type: 'string',
                enum: ConversationTurnFromValues as unknown as string[],
                description: 'Turn sender.',
              },
              messages: {
                type: 'array',
                description: 'Messages in this turn.',
                items: {
                  type: 'object',
                  properties: {
                    type: {
                      type: 'string',
                      enum: ConversationMessageTypeValues as unknown as string[],
                      description: 'Stored message type.',
                    },
                    mid: {
                      type: 'string',
                      description: 'Optional channel/native message ID (MID/WAMID/etc.).',
                    },
                    from: {
                      type: 'string',
                      enum: ConversationTurnFromValues as unknown as string[],
                    },
                    item: {
                      type: 'object',
                      description:
                        'Inner message item, usually { type, payload }. For text: { "payload": { "message": "..." } }.',
                      properties: {
                        type: { type: 'string' },
                        payload: {
                          description: 'Message payload. For text messages, use { "message": "..." }.',
                        },
                        time: { type: 'number' },
                      },
                      additionalProperties: true,
                    },
                    delay: { type: 'number' },
                    action: { type: 'string' },
                    ts: { type: 'number', description: 'Unix timestamp in seconds.' },
                    feedback: { type: 'boolean' },
                    VGPayload: { type: 'object', additionalProperties: true },
                    isLoading: { type: 'boolean' },
                    isAIGenerated: { type: 'boolean' },
                    sourceLabel: { type: 'string' },
                    placeholderImage: { type: 'string' },
                    mask: {
                      type: 'object',
                      properties: {
                        messageIndex: { type: 'number' },
                        turnIndex: { type: 'number' },
                      },
                    },
                    sendError: {
                      type: 'object',
                      properties: {
                        message: { type: 'string' },
                        ts: { type: 'number' },
                      },
                      required: ['message', 'ts'],
                    },
                    replyTo: {
                      type: 'object',
                      properties: {
                        messageId: { type: 'string' },
                        messageContent: { type: 'string' },
                        messageFrom: { type: 'string' },
                        messageIndex: { type: 'number' },
                        turnIndex: { type: 'number' },
                      },
                      required: ['messageId', 'messageContent', 'messageFrom', 'messageIndex', 'turnIndex'],
                    },
                  },
                  required: ['type'],
                  additionalProperties: true,
                },
              },
              ts: { type: 'number', description: 'Unix timestamp in seconds.' },
              session_id: { type: 'string' },
              isAIGenerated: { type: 'boolean' },
              modelId: { type: 'string' },
              sources: { type: 'array', items: { type: 'object', additionalProperties: true } },
              langchainMessages: { type: 'array', items: { type: 'object', additionalProperties: true } },
            },
            required: ['from', 'messages'],
            additionalProperties: true,
          },
        },
        lgMessages: {
          type: 'array',
          description: 'Optional LangGraph/langchain message array passthrough.',
          items: {},
        },
        updateConversationMetadata: {
          type: 'boolean',
          description:
            'Default true. Refreshes messagesNum, lastMessage, firstMessageTS, lastMessageTS, and lastModified on the light conversation document.',
        },
        confirmReplace: {
          type: 'boolean',
          const: true,
          description: 'Must be true because this replaces the stored conversation message history.',
        },
      },
      required: ['agentId', 'convoId', 'turns', 'confirmReplace'],
    },
  },
  {
    name: 'delete_conversation',
    description: 'Delete a conversation',
    inputSchema: {
      type: 'object',
      properties: {
        agentId: {
          type: 'string',
          description: 'The agent ID',
        },
        convoId: {
          type: 'string',
          description: 'The conversation ID',
        },
      },
      required: ['agentId', 'convoId'],
    },
  },
  {
    name: 'export_all_conversations',
    description:
      'Export conversations for an agent (Postgres mirror). Requires a paid workspace (hasEverPaid === true); billed against monthly export quota. ' +
      'Supports cursor pagination via cursor/nextCursor/hasMore, or selected mode via convoIds. Formats: json|csv.',
    inputSchema: {
      type: 'object',
      properties: {
        agentId: {
          type: 'string',
          description: 'The agent ID',
        },
        format: {
          type: 'string',
          enum: ['json', 'csv'],
          description: 'Export format (default: json)',
        },
        limit: {
          type: 'number',
          description: 'Max conversations in this export page',
        },
        sort: {
          type: 'string',
          description: 'Sort order (API-defined)',
        },
        fromTs: {
          type: 'number',
          description: 'Unix timestamp lower bound (inclusive)',
        },
        toTs: {
          type: 'number',
          description: 'Unix timestamp upper bound (inclusive)',
        },
        cursor: {
          type: 'string',
          description: 'Opaque cursor from previous export nextCursor',
        },
        convoIds: {
          type: 'array',
          items: { type: 'string' },
          description: 'If set, export only these conversation IDs',
        },
      },
      required: ['agentId'],
    },
  },
  {
    name: 'export_conversation',
    description:
      'Export a single conversation. Requires a paid workspace (hasEverPaid === true); billed against monthly export quota.',
    inputSchema: {
      type: 'object',
      properties: {
        agentId: {
          type: 'string',
          description: 'The agent ID',
        },
        convoId: {
          type: 'string',
          description: 'The conversation ID',
        },
        format: {
          type: 'string',
          enum: ['json', 'csv'],
          description: 'Export format (default: json)',
        },
      },
      required: ['agentId', 'convoId'],
    },
  },
  {
    name: 'assign_conversation',
    description: 'Assign a conversation to a user for manual delegation',
    inputSchema: {
      type: 'object',
      properties: {
        agentId: {
          type: 'string',
          description: 'The agent ID',
        },
        convoId: {
          type: 'string',
          description: 'The conversation ID',
        },
        assignToUserId: {
          type: 'string',
          description: 'User ID to assign to',
        },
        delegatedBy: {
          type: 'string',
          description: 'Optional: ID of user delegating',
        },
      },
      required: ['agentId', 'convoId', 'assignToUserId'],
    },
  },
  {
    name: 'get_conversations_bulk',
    description:
      'Fetch lean summaries for many conversation IDs in one call (fan-out GETs with concurrency). ' +
      'Returns {ID, summary, ts, capturedVariables, userName, origin} per convo. Max 50 IDs per call — chunk larger audits. ' +
      'Workflow: list_conversations with cursor to collect IDs, then this tool (do NOT loop get_conversation).',
    inputSchema: {
      type: 'object',
      properties: {
        agentId: { type: 'string', description: 'The agent ID' },
        convoIds: {
          type: 'array',
          items: { type: 'string' },
          description: 'Conversation IDs (1–50)',
        },
      },
      required: ['agentId', 'convoIds'],
    },
  },
  {
    name: 'query_conversations',
    description:
      'MCP-side filter over conversations (NOT a SQL analytics API). Cursor-pages list_conversations then bulk-gets details when filters need summary/capturedVariables/userName. ' +
      'Bounded by maxScan (default 200). Use for audits like summaryContains or capturedVariableExists. ' +
      'True server-side filters (hasQuote, eventDateWithin) need a future backend endpoint.',
    inputSchema: {
      type: 'object',
      properties: {
        agentId: { type: 'string', description: 'The agent ID' },
        limit: { type: 'number', description: 'Max matches (default 50, max 100)' },
        maxScan: { type: 'number', description: 'Max list rows to scan (default 200, max 500)' },
        origin: { type: 'string', description: 'Exact origin match' },
        tsFrom: { type: 'number', description: 'Unix ts lower bound' },
        tsTo: { type: 'number', description: 'Unix ts upper bound' },
        capturedVariableExists: { type: 'string', description: 'Require this capturedVariables key' },
        capturedVariableEquals: {
          type: 'object',
          properties: {
            key: { type: 'string' },
            value: { type: 'string' },
          },
          required: ['key', 'value'],
          description: 'Require capturedVariables[key] === value',
        },
        summaryContains: { type: 'string', description: 'Case-insensitive summary substring' },
        hasUserName: { type: 'boolean', description: 'Require / exclude userName' },
      },
      required: ['agentId'],
    },
  },
  {
    name: 'get_agent_usage_bulk',
    description:
      'Fetch usage/credits for many agents in one call (fan-out). Max 20 agentIds. Optional shared date range.',
    inputSchema: {
      type: 'object',
      properties: {
        agentIds: {
          type: 'array',
          items: { type: 'string' },
          description: 'Agent IDs (1–20)',
        },
        range: {
          type: 'object',
          properties: {
            from: { type: 'string', description: 'Start date (ISO)' },
            to: { type: 'string', description: 'End date (ISO)' },
          },
          required: ['from', 'to'],
          description: 'Optional date range',
        },
      },
      required: ['agentIds'],
    },
  },
  {
    name: 'get_kb_docs_bulk',
    description:
      'Fetch many KB documents in one call (fan-out). Max 30 docIds. Default returns compact metadata + chunksPreview; set includeContent=true for full bodies.',
    inputSchema: {
      type: 'object',
      properties: {
        agentId: { type: 'string', description: 'The agent ID' },
        docIds: {
          type: 'array',
          items: { type: 'string' },
          description: 'KB document IDs (1–30)',
        },
        includeContent: {
          type: 'boolean',
          description: 'Include full chunks/content (default false)',
        },
      },
      required: ['agentId', 'docIds'],
    },
  },
  // ==================== KNOWLEDGE BASE TOOLS ====================
  {
    name: 'create_kb_from_urls',
    description:
      'PREFERRED for adding many website pages to an agent KB. Pass up to 50 URLs; the Convocore KB router scrapes them (scrapeContent=true). ' +
      'Do NOT web-fetch/scrape_url then paste content into create_kb_doc — that is slow and duplicates work. ' +
      'mode=per_url (default): one KB doc per URL. mode=batch: one API call with urls[]. ' +
      'For a whole site prefer create_kb_doc sourceType=sitemap. Scraping is async — poll list_kb_docs/get_kb_doc for status.',
    inputSchema: {
      type: 'object',
      properties: {
        agentId: { type: 'string', description: 'The agent ID' },
        urls: {
          type: 'array',
          items: { type: 'string', format: 'uri' },
          minItems: 1,
          maxItems: 50,
          description: 'Page URLs to ingest via KB router (max 50)',
        },
        mode: {
          type: 'string',
          enum: ['per_url', 'batch'],
          description: 'per_url (default) or batch (single source with all urls)',
        },
        name: {
          type: 'string',
          description: 'batch: doc name. per_url: optional name prefix',
        },
        tags: { type: 'array', items: { type: 'string' } },
        refreshRate: {
          type: 'string',
          enum: ['3d', '7d', 'never'],
          description: 'Auto re-crawl (API: 3d | 7d | never). Default never.',
        },
        scrapeContent: {
          type: 'boolean',
          description: 'KB router scrape (default true)',
        },
        skipExisting: {
          type: 'boolean',
          description: 'Skip URLs already on the agent KB (default true)',
        },
        metadata: {
          type: 'object',
          properties: { description: { type: 'string' } },
          required: ['description'],
        },
      },
      required: ['agentId', 'urls'],
    },
  },
  {
    name: 'create_kb_doc',
    description:
      'Add one knowledge base source (VG agents). For many page URLs use create_kb_from_urls instead. ' +
      'For websites: sourceType=url with urls[] + scrapeContent=true (KB router scrapes). ' +
      'For whole-site: sourceType=sitemap + sitemapUrl + maxPages + scrapeContent=true. ' +
      'sourceType=doc only for raw text you already have — do not paste web-fetched HTML here.',
    inputSchema: {
      type: 'object',
      properties: {
        agentId: {
          type: 'string',
          description: 'The agent ID',
        },
        name: {
          type: 'string',
          description: 'Document name',
        },
        sourceType: {
          type: 'string',
          enum: ['doc', 'url', 'sitemap'],
          description: 'doc = text; url = KB router scrape urls[]; sitemap = crawl sitemap',
        },
        content: {
          type: 'string',
          description: 'Document content (required for sourceType: doc)',
        },
        metadata: {
          type: 'object',
          description: 'Additional metadata',
        },
        tags: {
          type: 'array',
          items: { type: 'string' },
          description: 'Tags for organization',
        },
        refreshRate: {
          type: 'string',
          enum: ['3d', '7d', 'never'],
          description: 'Auto re-crawl for URL/sitemap (API: 3d | 7d | never). Default never.',
        },
        urls: {
          type: 'array',
          items: { type: 'string' },
          description: 'Array of URLs (for sourceType: url). Prefer create_kb_from_urls for many pages.',
        },
        sitemapUrl: {
          type: 'string',
          description: 'Sitemap URL (for sourceType: sitemap)',
        },
        maxPages: {
          type: 'number',
          description: 'Max pages from sitemap',
        },
        scrapeContent: {
          type: 'boolean',
          description: 'Let KB router scrape URLs/sitemap (set true for url/sitemap)',
        },
      },
      required: ['agentId', 'name', 'sourceType'],
    },
  },
  {
    name: 'list_kb_docs',
    description: 'List all knowledge base documents for an agent',
    inputSchema: {
      type: 'object',
      properties: {
        agentId: {
          type: 'string',
          description: 'The agent ID',
        },
        page: {
          type: 'number',
          description: 'Page number (default: 1)',
        },
        pageSize: {
          type: 'number',
          description: 'Results per page (default: 20)',
        },
      },
      required: ['agentId'],
    },
  },
  {
    name: 'get_kb_doc',
    description: 'Get a single knowledge base document',
    inputSchema: {
      type: 'object',
      properties: {
        agentId: {
          type: 'string',
          description: 'The agent ID',
        },
        docId: {
          type: 'string',
          description: 'The document ID',
        },
      },
      required: ['agentId', 'docId'],
    },
  },
  {
    name: 'update_kb_doc',
    description:
      'Update a knowledge base document (VG agents only). For large document bodies prefer patch_kb_doc (Cursor-style exact old_string→new_string) instead of rewriting the entire content field.',
    inputSchema: {
      type: 'object',
      properties: {
        agentId: {
          type: 'string',
          description: 'The agent ID',
        },
        docId: {
          type: 'string',
          description: 'The document ID',
        },
        name: {
          type: 'string',
          description: 'Updated name',
        },
        content: {
          type: 'string',
          description: 'Updated content',
        },
        metadata: {
          type: 'object',
          description: 'Updated metadata',
        },
        tags: {
          type: 'array',
          items: { type: 'string' },
          description: 'Updated tags',
        },
        refreshRate: {
          type: 'string',
          enum: ['3d', '7d', 'never'],
          description: 'Updated refresh rate (API: 3d | 7d | never)',
        },
        url: {
          type: 'string',
          description: 'Updated URL',
        },
      },
      required: ['agentId', 'docId'],
    },
  },
  {
    name: 'patch_kb_doc',
    description:
      'Performs exact string replacements in a knowledge-base document — same idea as Cursor StrReplace for files. ' +
      'USE THIS instead of update_kb_doc when the document body is large and you only need to change a specific section. ' +
      'Workflow: get_kb_doc → copy the exact span into old_string (include enough surrounding context to make it unique) → new_string is the replacement → this tool patches content (or name) and PATCHes the KB doc. ' +
      'old_string must match the current field text exactly including whitespace. Prefer this over rewriting the entire content field. ' +
      'Only use replace_all=true when you intentionally want every occurrence changed.',
    inputSchema: {
      type: 'object',
      properties: {
        agentId: {
          type: 'string',
          description: 'The agent ID',
        },
        docId: {
          type: 'string',
          description: 'The KB document ID',
        },
        old_string: {
          type: 'string',
          description:
            'Exact text to find in the KB field (whitespace-sensitive). MUST match exactly. Include surrounding context so the match is unique unless replace_all is true.',
        },
        new_string: {
          type: 'string',
          description:
            'Replacement text for the matched span. Use an empty string to delete the matched text.',
        },
        replace_all: {
          type: 'boolean',
          description:
            'If false (default), fails when old_string matches more than once. If true, replaces every occurrence.',
        },
        field: {
          type: 'string',
          enum: ['content', 'name'],
          description: 'Which KB field to patch. Default content (document body).',
        },
      },
      required: ['agentId', 'docId', 'old_string', 'new_string'],
    },
  },
  {
    name: 'delete_kb_doc',
    description: 'Delete a knowledge base document (VG agents only)',
    inputSchema: {
      type: 'object',
      properties: {
        agentId: {
          type: 'string',
          description: 'The agent ID',
        },
        docId: {
          type: 'string',
          description: 'The document ID',
        },
      },
      required: ['agentId', 'docId'],
    },
  },
  {
    name: 'get_kb_stats',
    description: 'Get knowledge base statistics for an agent (VG agents only)',
    inputSchema: {
      type: 'object',
      properties: {
        agentId: {
          type: 'string',
          description: 'The agent ID',
        },
      },
      required: ['agentId'],
    },
  },
  // ==================== SCRAPE TOOL ====================
  {
    name: 'scrape_url',
    description:
      'Validate and/or scrape HTTP(S) URLs. ' +
      'DEFAULT mode=check: fast ping of one or many links/images (up to 20) — returns status (200/301/404/etc), ok, content-type, final URL after redirects. Use this to verify widget images, logos, CDN assets, booking links, or any URL before putting it on an agent. ' +
      'mode=scrape: full Convocore crawler scrape of ONE page (waits up to ~120s) for text/colours/favicon when building branded agents. ' +
      'Do NOT use scrape for KB ingest (use create_kb_from_urls). Workspace is resolved internally — never pass workspaceId.',
    inputSchema: {
      type: 'object',
      properties: {
        url: {
          type: 'string',
          format: 'uri',
          description: 'Single URL (optional if urls is set)',
        },
        urls: {
          type: 'array',
          items: { type: 'string', format: 'uri' },
          minItems: 1,
          maxItems: 20,
          description: 'URLs to check (preferred for validating multiple image/page links)',
        },
        mode: {
          type: 'string',
          enum: ['check', 'scrape'],
          description:
            'check = HTTP status ping (default). scrape = full page scrape (one URL only).',
        },
      },
    },
  },
  // ==================== WEBSITE EMBED + WIDGET CSS TOOLS ====================
  {
    name: 'get_website_embed_code',
    description:
      "MUST CALL whenever the user asks to deploy/embed/add their agent to a website, get the widget script, iframe code, popup chat bubble, or 'where is the code'. " +
      "Returns a ready-to-paste HTML snippet with the real agent ID and region filled in (popup, full-width inline, modal, or React voice-only example). " +
      "Do NOT redirect the user to the dashboard Channels/Deployment tab instead of returning this code. " +
      "If agentId is unknown, call list_agents first, then call this tool.",
    inputSchema: {
      type: 'object',
      properties: {
        agentId: {
          type: 'string',
          description: 'The Convocore agent ID to embed.',
        },
        mode: {
          type: 'string',
          enum: ['popup-bottom-right', 'popup-bottom-left', 'full-width', 'modal', 'voice-react'],
          description:
            'popup-bottom-right (default bubble), popup-bottom-left, full-width (sized div), modal (center overlay), voice-react (Next.js @tixae-labs/web-sdk).',
        },
        containerWidth: { type: 'string', description: 'full-width only, e.g. "500px".' },
        containerHeight: { type: 'string', description: 'full-width only, e.g. "500px".' },
      },
      required: ['agentId'],
    },
  },
  {
    name: 'get_widget_css_styling_guide',
    description:
      "MUST CALL FIRST whenever the user asks to style/restyle/theme the Convocore (vg) chat widget — e.g. 'change the icons to black', 'make the header purple', 'recolor the send button', 'theme the widget dark', 'change the user bubble color', 'restyle the proactive teaser'. " +
      "Returns the FULL authoritative styling guide (the same SYSTEM_PROMPT used by Convocore's server-side AI CSS generator) including: " +
      "(a) the global output rules (always wrap in ```css, always !important, never invent class names), " +
      "(b) the CRITICAL compound-element CASCADE rule for color/icon changes (.vg-foo, .vg-foo *, .vg-foo svg, .vg-foo path { color + stroke }), " +
      "(c) hard constraints (don't color .vg-message-inner-container-human, don't hide the input, etc.), " +
      "(d) the COMPLETE class & id map (.vg-* selectors for every part of the widget — header, footer input, send button, messages, proactive bubble, notices, cards, voice mode, live agents, etc.), " +
      "(e) the NextUI/Tailwind color system, and (f) ready-made selector recipes mapping plain-English asks to selectors. " +
      "If you pass agentId, the agent's current customCSS is appended so the model can refine/extend it instead of duplicating rules. " +
      "After calling this, generate CSS that strictly follows the guide, then call update_agent_custom_css to persist it.",
    inputSchema: {
      type: 'object',
      properties: {
        agentId: {
          type: 'string',
          description:
            "Optional. If provided, the agent's current customCSS is appended to the guide so you can extend/refine the existing rules instead of duplicating them.",
        },
      },
      required: [],
    },
  },
  {
    name: 'get_agent_custom_css',
    description:
      "Read the agent's current customCSS field (the per-agent CSS override applied to the chat widget). Returns the raw CSS string (empty string if none set). Use this before editing so you can produce a merged result for update_agent_custom_css.",
    inputSchema: {
      type: 'object',
      properties: {
        agentId: {
          type: 'string',
          description: 'The agent ID whose customCSS field you want to read',
        },
      },
      required: ['agentId'],
    },
  },
  // ==================== FILE I/O TOOLS ====================
  // Universal "understand any file" capability — PDFs, DOCX, XLSX/CSV, TXT/MD/JSON,
  // and images. Every read tool accepts EXACTLY ONE of: { path } | { url } | { data + mimeType }.
  // - path: absolute/relative local path (best in Cursor / Claude Code).
  // - url:  https URL (works in any host, including Claude Desktop).
  // - data: base64-encoded bytes the LLM already has (useful when the user
  //         attached a file to the chat and the host re-encoded it).
  // Heavy parsers (sharp, pdf-parse, mammoth, xlsx) are loaded lazily on first
  // use, so the MCP server itself starts in <100ms.
  {
    name: 'inspect_file',
    description:
      "Cheap probe of a file (path / url / base64). Returns kind, mime, size, page count (PDF), sheet names (XLSX), line count (text), or pixel dimensions (image), plus an estimated token cost. ALWAYS call this first on anything larger than a few KB — use it to decide which read_* tool to call and which slice (pages / sheet / range) to request, so you don't blow the context window.",
    inputSchema: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'Local file path. Mutually exclusive with url/data.' },
        url: { type: 'string', description: 'https:// URL. Mutually exclusive with path/data.' },
        data: { type: 'string', description: 'Base64 file contents. Mutually exclusive with path/url.' },
        mimeType: { type: 'string', description: 'Optional MIME hint (mostly for `data` mode).' },
      },
      required: [],
    },
  },
  {
    name: 'read_text_file',
    description:
      "Read a plain-text file (.txt, .md, .json, .csv, .yaml, .log, code, etc.) from path / url / base64. Returns UTF-8 text plus a truncation flag and token estimate. Honors an optional `maxBytes` cap. For .docx use read_docx, for .pdf use read_pdf, for .xlsx use read_spreadsheet.",
    inputSchema: {
      type: 'object',
      properties: {
        path: { type: 'string' },
        url: { type: 'string' },
        data: { type: 'string' },
        mimeType: { type: 'string' },
        maxBytes: { type: 'number', description: 'Optional cap on bytes to read.' },
      },
      required: [],
    },
  },
  {
    name: 'read_pdf',
    description:
      "Extract text from a PDF (path / url / base64). Page-aware: pass `pages` as a string range like \"1-3,5,7-9\" or an explicit array to read only the pages you need. Output is split per page with `--- page N ---` headers. Auto-truncates if the result would exceed the per-call token budget. Always inspect_file first to learn totalPages.",
    inputSchema: {
      type: 'object',
      properties: {
        path: { type: 'string' },
        url: { type: 'string' },
        data: { type: 'string' },
        mimeType: { type: 'string' },
        pages: {
          oneOf: [
            { type: 'string', description: 'Range spec like "1-3,5,7-9".' },
            { type: 'array', items: { type: 'number', minimum: 1 } },
          ],
          description: 'Optional page selection. Defaults to all pages.',
        },
      },
      required: [],
    },
  },
  {
    name: 'read_docx',
    description:
      "Extract text from a .docx Word document (path / url / base64). Set asMarkdown=true to preserve headings, lists, links and bold/italic. Legacy .doc is NOT supported — convert to .docx first.",
    inputSchema: {
      type: 'object',
      properties: {
        path: { type: 'string' },
        url: { type: 'string' },
        data: { type: 'string' },
        mimeType: { type: 'string' },
        asMarkdown: { type: 'boolean', description: 'Return markdown instead of plain text. Default: false.' },
      },
      required: [],
    },
  },
  {
    name: 'read_spreadsheet',
    description:
      "Read an Excel (.xlsx / .xlsm / .xls) or CSV file. Two-step pattern: (1) call WITHOUT `sheet` to list sheet names, (2) call again with `sheet` to read that sheet. Optional A1-style `range` (e.g. \"A1:D50\") and `format` ('markdown' default, or 'csv' / 'json'). headerRow=true (default) treats row 1 as keys when format='json'.",
    inputSchema: {
      type: 'object',
      properties: {
        path: { type: 'string' },
        url: { type: 'string' },
        data: { type: 'string' },
        mimeType: { type: 'string' },
        sheet: {
          oneOf: [{ type: 'string' }, { type: 'number', minimum: 0 }],
          description: 'Sheet name or zero-based index. Omit to just list sheets.',
        },
        range: { type: 'string', description: 'Optional A1 range like "A1:D50".' },
        format: { type: 'string', enum: ['json', 'csv', 'markdown'], description: 'Output format. Default: markdown.' },
        headerRow: { type: 'boolean', description: 'For json: treat row 1 as headers (default: true).' },
        maxRows: { type: 'number', description: 'Cap on rows returned (default: 1000, max: 50000).' },
      },
      required: [],
    },
  },
  {
    name: 'read_image',
    description:
      "Load an image (PNG / JPEG / WebP / GIF / SVG / TIFF / BMP / HEIC) from path / url / base64 and return it as a vision-ready MCP image content block. Auto-normalizes: rasterizes SVG, downscales anything larger than maxDimension (default 2048px), and re-encodes to PNG (or JPEG when needed for size). Vision-capable hosts (Claude Desktop, Claude Code, GPT clients) will see the image natively. Use this for screenshots of bugs, widget previews, mockups, diagrams, scanned receipts, etc.",
    inputSchema: {
      type: 'object',
      properties: {
        path: { type: 'string' },
        url: { type: 'string' },
        data: { type: 'string' },
        mimeType: { type: 'string' },
        maxDimension: {
          type: 'number',
          description: 'Max width/height in pixels (default: 2048, range: 64-4096). Larger images are downscaled.',
          minimum: 64,
          maximum: 4096,
        },
      },
      required: [],
    },
  },
  {
    name: 'import_file_to_kb',
    description:
      "End-to-end shortcut: read any supported file (PDF / DOCX / XLSX / CSV / TXT / MD / JSON / HTML) and create a Knowledge Base document on the target agent in one call. The file is parsed locally to text/markdown and pushed to the agent's KB via create_kb_doc with sourceType='doc'. Use `pages` for PDFs and `sheet` for spreadsheets to control what gets ingested. Images are NOT supported here (they need OCR or vision — use read_image instead).",
    inputSchema: {
      type: 'object',
      properties: {
        agentId: { type: 'string', description: 'Target agent ID.' },
        path: { type: 'string' },
        url: { type: 'string' },
        data: { type: 'string' },
        mimeType: { type: 'string' },
        name: { type: 'string', description: 'KB document name. Defaults to the source filename.' },
        tags: { type: 'array', items: { type: 'string' }, description: 'Optional tags.' },
        pages: {
          oneOf: [
            { type: 'string', description: 'PDF page range like "1-3,5".' },
            { type: 'array', items: { type: 'number', minimum: 1 } },
          ],
          description: 'PDF only: page selection.',
        },
        sheet: {
          oneOf: [{ type: 'string' }, { type: 'number', minimum: 0 }],
          description: 'Spreadsheet only: which sheet to ingest (default: first).',
        },
        asMarkdown: { type: 'boolean', description: 'Prefer markdown output (default: true).' },
      },
      required: ['agentId'],
    },
  },
  {
    name: 'update_agent_custom_css',
    description:
      "Overwrite the agent's customCSS field with new CSS that styles the chat widget. IMPORTANT: this REPLACES the existing customCSS value — always pass the FULL merged CSS (existing + your new rules), not just the delta. " +
      "Workflow: (1) call get_widget_css_styling_guide to load selectors + rules, (2) optionally call get_agent_custom_css to read what's already there, (3) generate the merged CSS following the guide, (4) call this tool to persist. " +
      "Pass an empty string to clear all customCSS for the agent.",
    inputSchema: {
      type: 'object',
      properties: {
        agentId: {
          type: 'string',
          description: 'The agent ID whose customCSS field you want to overwrite',
        },
        customCSS: {
          type: 'string',
          description:
            'The full CSS to write to the agent.customCSS field. REPLACES the existing value entirely. Use an empty string to clear.',
        },
      },
      required: ['agentId', 'customCSS'],
    },
  },
  {
    name: 'sleep',
    description:
      'Pause for the given number of seconds and then return. Useful when you need to wait between actions (e.g. polling a job, rate-limiting, giving an external system time to settle). Range: 0–300 seconds.',
    inputSchema: {
      type: 'object',
      properties: {
        seconds: {
          type: 'number',
          minimum: 0,
          maximum: 300,
          description: 'How long to wait, in seconds (0–300).',
        },
      },
      required: ['seconds'],
    },
  },
  {
    name: 'run_command',
    description:
      'Execute a shell command on the host machine where the MCP server is running and return stdout, stderr, and the exit code. ' +
      'Runs through the platform default shell (cmd.exe on Windows, /bin/sh on Unix). ' +
      'Use for simple system tasks like checking versions, listing files, or running short scripts. ' +
      'NOTE: this tool has full access to the host shell with the MCP process privileges — only run commands you trust.',
    inputSchema: {
      type: 'object',
      properties: {
        command: {
          type: 'string',
          description: 'The shell command to execute (e.g. "node --version" or "ls -la").',
        },
        cwd: {
          type: 'string',
          description: 'Optional working directory. Defaults to the MCP server cwd.',
        },
        timeoutSeconds: {
          type: 'number',
          minimum: 1,
          maximum: 600,
          description: 'Kill the process after this many seconds. Default 30, max 600.',
        },
      },
      required: ['command'],
    },
  },
  {
    name: 'list_voice_providers',
    description:
      'List every TTS voice provider Convocore supports (elevenlabs, deepgram, cartesia, rime-ai, openai, google-cloud, google-live (Gemini Live), ultravox, minimax, playht, azure). ' +
      "For each provider returns the workspace secret-key name (e.g. ELEVENLABS_API_KEY) and a `requiresWorkspaceApiKey` flag indicating whether the platform has a server-side fallback or the workspace must BYOK. " +
      'Read-only — does NOT consume credits.',
    inputSchema: { type: 'object', properties: {} },
  },
  {
    name: 'list_voice_models',
    description:
      'List the available TTS models for a given provider (e.g. "aura-2" for Deepgram, "eleven_multilingual_v2" for ElevenLabs). ' +
      'Use the returned modelId values with `search_voices` / `list_provider_voices` to filter the catalog. Read-only — does NOT consume credits.',
    inputSchema: {
      type: 'object',
      properties: {
        provider: {
          type: 'string',
          description: 'Provider slug, e.g. "elevenlabs", "deepgram", "cartesia", "openai", "google-cloud", "azure".',
        },
      },
      required: ['provider'],
    },
  },
  {
    name: 'search_voices',
    description:
      'Unified voice search across one or more TTS providers. Every result is normalized to { voiceId, name, provider, previewUrl, filters: { accent, gender, useCase, language } }. ' +
      'Use this when the user asks for a voice by gender / language / accent without caring which provider. Read-only — does NOT consume credits.',
    inputSchema: {
      type: 'object',
      properties: {
        language: { type: 'string', description: 'Inclusive match: "en" matches "en-US", "en-GB", "English". Use BCP-47 codes or English names.' },
        gender: { type: 'string', description: 'male / female / neutral. Aliases m / f / masculine / feminine accepted.' },
        accent: { type: 'string', description: 'Substring match, e.g. "american", "british".' },
        modelId: { type: 'string', description: 'Filter to a specific TTS model id when relevant.' },
        providers: { type: 'string', description: 'Comma-separated provider slugs to limit the search (e.g. "elevenlabs,cartesia"). Omit for all providers.' },
        limit: { type: 'number', minimum: 1, maximum: 500, description: 'Page size, 1–500. Default 100.' },
        offset: { type: 'number', minimum: 0, description: 'Pagination offset. Default 0.' },
      },
    },
  },
  {
    name: 'list_provider_voices',
    description:
      'Browse the voice catalog for ONE specific provider with the same filter params as search_voices. Use when the user has already chosen a provider (e.g. "show me ElevenLabs male British voices"). Read-only — does NOT consume credits.',
    inputSchema: {
      type: 'object',
      properties: {
        provider: { type: 'string', description: 'Provider slug, e.g. "elevenlabs".' },
        language: { type: 'string', description: 'Language filter (e.g. "en", "de").' },
        gender: { type: 'string', description: 'male / female / neutral.' },
        accent: { type: 'string', description: 'Substring match (e.g. "american").' },
        modelId: { type: 'string', description: 'Filter to a specific TTS model id.' },
        limit: { type: 'number', minimum: 1, maximum: 500, description: 'Page size, 1–500. Default 100.' },
        offset: { type: 'number', minimum: 0, description: 'Pagination offset. Default 0.' },
      },
      required: ['provider'],
    },
  },
  {
    name: 'get_voice',
    description:
      "Fetch full metadata + a preview MP3 URL for a single voice. Use after the user picks one from search_voices / list_provider_voices, or when they paste a voice ID. Read-only — does NOT consume credits.",
    inputSchema: {
      type: 'object',
      properties: {
        provider: { type: 'string', description: 'Provider slug, e.g. "elevenlabs".' },
        voiceId: { type: 'string', description: 'Provider-specific voice ID (e.g. "21m00Tcm4TlvDq8ikWAM" for ElevenLabs Rachel).' },
      },
      required: ['provider', 'voiceId'],
    },
  },
  {
    name: 'buy_twilio_number',
    description:
      "Purchase a new Twilio phone number from Convocore's Twilio account and assign it to the workspace for SMS/voice. " +
      'Requires an available phone-number slot on your plan (Twilio Phone Number add-on is $3/month per extra number). ' +
      'This is NOT for WhatsApp Cloud API numbers; WhatsApp uses waNumbers/{phoneId} and Meta credentials. ' +
      'Tip: discover purchasable numbers via the platform UI / available-numbers endpoint before calling this.',
    inputSchema: {
      type: 'object',
      properties: {
        number: {
          type: 'string',
          description: 'Phone number in E.164 (e.g. "+14155551234"). Leading + required, no spaces.',
        },
        agentId: { type: 'string', description: 'Optional agent ID to assign the number to. Leave empty to assign later.' },
        capabilities: {
          type: 'array',
          items: { type: 'string', enum: ['voice', 'sms'] },
          description: 'Which capabilities to enable. Default: ["voice", "sms"].',
        },
      },
      required: ['number'],
    },
  },
  {
    name: 'import_twilio_number',
    description:
      'Import a Twilio SMS/voice number you already own into the workspace (uses your Twilio account credentials). ' +
      'This is NOT a WhatsApp Cloud API connection; do not use it for waNumbers/Meta WhatsApp. ' +
      'Pass the full request body for /utils/import-twilio-number as an object — typically includes your Twilio account SID, auth token, the phone number, optional agentId and capabilities.',
    inputSchema: {
      type: 'object',
      properties: {
        payload: { type: 'object', description: 'Full request body object for /utils/import-twilio-number.' },
      },
      required: ['payload'],
    },
  },
  {
    name: 'release_twilio_number',
    description:
      'Release (delete) a Twilio SMS/voice number from the workspace. This does not remove WhatsApp Cloud API waNumbers. Pass the full request body for /utils/twilio/release-number as an object — typically includes phoneNumber or phoneNumberSid.',
    inputSchema: {
      type: 'object',
      properties: {
        payload: { type: 'object', description: 'Full request body object for /utils/twilio/release-number.' },
      },
      required: ['payload'],
    },
  },
  {
    name: 'check_twilio_number',
    description:
      'Repair / re-sync the Twilio SMS/voice webhook configuration for a number (useful when call/SMS routing breaks). This does not check WhatsApp Cloud API health. ' +
      'Pass the full request body for /utils/twilio/check-number as an object — typically includes phoneNumber or phoneNumberSid.',
    inputSchema: {
      type: 'object',
      properties: {
        payload: { type: 'object', description: 'Full request body object for /utils/twilio/check-number.' },
      },
      required: ['payload'],
    },
  },
  {
    name: 'sync_sms_twilio_number',
    description:
      'Assign a Twilio number to an agent for SMS handling. This is SMS only; WhatsApp routing uses waNumbers/{phoneId}, origin "whatsapp", and Meta Cloud API. Pass the full request body for /utils/twilio/sync-sms as an object — typically includes phoneNumber (or sid) and agentId.',
    inputSchema: {
      type: 'object',
      properties: {
        payload: { type: 'object', description: 'Full request body object for /utils/twilio/sync-sms.' },
      },
      required: ['payload'],
    },
  },
  {
    name: 'interact_with_agent',
    description:
      "Run ONE agent turn over the Convocore /interact WebSocket and return the streamed result aggregated into a single response. " +
      "Opens a WSS connection to wss://<region>-gcp-api.vg-stuff.com/interact, sends one InteractObject (agentId + convoId + bucket + prompt + optional context), " +
      "collects every chunk (text + UI-engine + actions + metadata + sync_chat_history) until the server closes (code 1000) or the timeout fires, then returns: " +
      "{ assistantText, uiEngineEnabled, uiEngineSnapshot, uiEngineSummary, actions, metadata, turns, closeCode, durationMs, timedOut, chunkCount, chunks? }.\n\n" +
      "USAGE:\n" +
      "- Use the SAME `convoId` across turns to keep history; use a fresh one to start a new conversation.\n" +
      "- `prompt: \"start\"` triggers the agent's initial greeting (no user message added).\n" +
      "- `prompt: \"@cancel:<reason>\"` cancels an in-flight turn (rarely useful from a single MCP call).\n" +
      "- `prompt: \"@rewind:<nodeId>\"` rewinds a node-based agent.\n" +
      "- For images, set messageType=\"visual\" and pass `visualPayload`.\n" +
      "- `bucket` is auto-derived from CONVOCORE_API_REGION; only override if you really mean to talk to the other region.\n" +
      "- Set `raw: true` to include every streamed chunk (debug frames, chunkIndex, every UI Engine snapshot, etc.) when you need the full trace. Default keeps the response token-cheap.\n\n" +
      "INTERPRETING THE RESPONSE:\n" +
      "- When `uiEngineEnabled: false`, the agent streamed plain Markdown — read `assistantText`.\n" +
      "- When `uiEngineEnabled: true`, the agent streamed UI Engine snapshots — read `uiEngineSnapshot` (parsed final TurnProps) and `uiEngineSummary` (compact per-message summary). `assistantText` may be empty in this mode.\n" +
      "- To force plain text on a UI-Engine-enabled agent for one turn, pass `disableUiEngine: true`.\n\n" +
      UI_ENGINE_PRIMER + "\n\n" +
      "For the FULL UI Engine schema (every payload field, validation rules, allowed enums) call `get_ui_engine_spec` first.\n\n" +
      "WARNING: This consumes Convocore credits exactly like a real agent turn (LLM + voice + tools). It is NOT a dry-run.",
    inputSchema: {
      type: 'object',
      properties: {
        agentId: { type: 'string', description: 'The ID of the agent to interact with.' },
        convoId: {
          type: 'string',
          description:
            'Conversation ID. Reuse across turns to keep history; use a fresh ID to start a new conversation.',
        },
        prompt: {
          type: 'string',
          description:
            'User message. Special values: "start" (initial greeting), "@cancel:<reason>", "@rewind:<nodeId>".',
        },
        bucket: {
          type: 'string',
          enum: ['voiceglow-eu', '(default)'],
          description:
            'Region bucket. Auto-derived from CONVOCORE_API_REGION when omitted (eu-gcp -> "voiceglow-eu", na-gcp -> "(default)").',
        },
        sessionId: {
          type: 'string',
          description: 'Optional session id; defaults to convoId server-side.',
        },
        messageType: {
          type: 'string',
          enum: ['text', 'visual'],
          description: 'Type of input. Use "visual" together with visualPayload for images.',
        },
        visualPayload: {
          type: 'object',
          description: 'Image/visual content for messageType: "visual" turns.',
          properties: {
            image: { type: 'string', description: 'Primary image URL.' },
            images: {
              type: 'array',
              items: { type: 'string' },
              description: 'Additional image URLs.',
            },
            message: { type: 'string', description: 'Optional caption / accompanying message.' },
            imageCount: { type: 'integer', minimum: 0 },
          },
        },
        replyTo: {
          type: 'object',
          description: 'Reply context when the user is replying to a previous message.',
          properties: {
            messageId: { type: 'string' },
            messageContent: { type: 'string' },
            messageFrom: { type: 'string', enum: ['human', 'bot'] },
            messageIndex: { type: 'integer' },
            turnIndex: { type: 'integer' },
          },
        },
        lightConvoData: {
          type: 'object',
          description:
            'Per-conversation user/context metadata (userName, userEmail, userPhone, origin, capturedVariables, ...). Surfaced to the agent system prompt where supported.',
        },
        agentData: {
          type: 'object',
          description:
            'Optional agent override. When provided with at least an `ID`, the server skips loading the agent doc from Firestore.',
        },
        workspaceData: { type: 'object', description: 'Optional workspace override.' },
        turnsHistory: {
          type: 'array',
          description:
            'Optional override of conversation turns. When set, the server uses this instead of fetching from Firestore.',
        },
        disableUiEngine: {
          type: 'boolean',
          description: 'Disable UI-engine JSON output for this turn.',
        },
        disableRecordHistory: {
          type: 'boolean',
          description: 'Skip persisting this turn to Firestore.',
        },
        v2: { type: 'boolean', description: 'Force routing to the v2 (node-based) handler.' },
        isTest: { type: 'boolean', description: 'Marks the turn as a test interaction.' },
        isLLMStudio: { type: 'boolean', description: 'Marks the turn as originating from LLM Studio.' },
        kbPreview: {
          type: 'boolean',
          description: 'Knowledge-base preview mode (skips node routing).',
        },
        agentProfileId: {
          type: 'string',
          description: 'Internal profile id (e.g. agency_plan_builder_v1).',
        },
        toolTest: {
          type: 'object',
          description: 'Run a single tool in test mode.',
          properties: {
            toolId: { type: 'string' },
            toolName: { type: 'string' },
            mode: { type: 'string', enum: ['validate', 'generate-and-test'] },
          },
          required: ['toolId', 'toolName', 'mode'],
        },
        formSubmissionMetadata: {
          type: 'object',
          description: 'Payload describing a UI-engine form / input submission.',
        },
        initNodesOptions: {
          type: 'object',
          description: 'Optional overrides for tools / variables / messages history at session init.',
        },
        actionMetadata: {
          type: 'object',
          description: 'Includes mid (client-supplied message id) used for de-duplication.',
          properties: { mid: { type: 'string' } },
        },
        timeoutMs: {
          type: 'integer',
          minimum: 1000,
          maximum: 600000,
          description:
            'How long to wait for the streamed turn to complete before closing the WebSocket. Default 120000 (120s), max 600000 (10min).',
        },
        raw: {
          type: 'boolean',
          description:
            'When true, include every raw streamed chunk in the response. Default false (token-cheap aggregated view only).',
        },
      },
      required: ['agentId', 'convoId'],
    },
  },
  {
    name: 'get_ui_engine_spec',
    description:
      "Return the FULL Convocore UI Engine schema (the structured message format agents emit when `vg_enableUIEngine: true`). " +
      "ALWAYS CALL THIS FIRST when: " +
      "(a) testing a UI-Engine-enabled agent via `interact_with_agent` and you need to validate the output, OR " +
      "(b) creating / updating an agent that should produce UI Engine output (so the system prompt teaches the LLM to emit valid `text` / `choice` / `visual` / `cardV2` / `carousel` / `iFrame` / `form` / `input` / invoice / calendarBooking messages). " +
      "Also documents agent feature flags (vg_enableUIEngineForms, vg_enableUIEngineInvoice, vg_enableUIEngineCalendarBooking, vg_uiEngineChannelConfig) used by update_agent to allow/deny which UI elements the agent may show. " +
      "Returns: meta (streaming + channel-gating + agentFeatureFlags), envelopes (TurnProps / ChatMessage), messageTypes, shared types, rules, and a validationChecklist. " +
      "Use `section` to narrow the response: \"meta\" | \"envelopes\" | \"message_types\" | \"shared\" | \"rules\" | \"checklist\" | \"primer\" | \"all\" (default). " +
      "Use `messageType` to drill into a single message-type schema (e.g. \"choice\" or \"form\"). " +
      "Static knowledge — does NOT hit the API and does NOT consume credits.",
    inputSchema: {
      type: 'object',
      properties: {
        section: {
          type: 'string',
          enum: ['all', 'meta', 'envelopes', 'message_types', 'shared', 'rules', 'checklist', 'primer'],
          description: 'Which slice of the spec to return. Default: "all".',
        },
        messageType: {
          type: 'string',
          enum: ['text', 'choice', 'visual', 'cardV2', 'carousel', 'iFrame', 'form', 'input'],
          description:
            'When set, return only the schema for this message type (overrides section). Use when you only need one shape.',
        },
      },
    },
  },
  {
    name: 'get_channel_integration_spec',
    description:
      'Return static Convocore channel-integration schema guidance for MCP clients. Use this before configuring or explaining WhatsApp, Facebook Messenger, Instagram, or SMS routing. It clarifies canonical storage locations, safe update fields, read-only/system-managed fields, credential masking, WhatsApp coexistence/AI behavior settings, Messenger/Instagram page mapping, and why Twilio SMS tools must not be used for WhatsApp Cloud API numbers. Static knowledge — does NOT hit the API.',
    inputSchema: {
      type: 'object',
      properties: {
        section: {
          type: 'string',
          enum: ['all', 'meta', 'whatsapp', 'metaPages', 'sms'],
          description:
            'Which section to return. "whatsapp" covers waNumbers, coexistence, AI reply controls, voice settings, safe patch matrix, and recommended tools. "metaPages" covers Facebook Messenger/Instagram page docs. "sms" covers Twilio SMS separation.',
        },
      },
    },
  },
  {
    name: 'get_pricing_info',
    description:
      'Return Convocore pricing information so the assistant can quote plans, add-ons, voice/chat cost rules of thumb, credit conversions, and per-model token prices to the user. ' +
      'Use `section` to narrow the response: "plans", "add_ons", "credits", "rules_of_thumb", "models", "voice_providers", "faq", or "all" (default). ' +
      'When section="models", optionally pass `modelFilter` (substring match on model name or provider, e.g. "gpt", "claude") to only return matching rows. ' +
      'Static knowledge — does NOT hit the API and does NOT consume credits. Always remind users that prices may change and direct them to https://convocore.ai/pricing for the live numbers.',
    inputSchema: {
      type: 'object',
      properties: {
        section: {
          type: 'string',
          enum: ['all', 'plans', 'add_ons', 'credits', 'rules_of_thumb', 'models', 'voice_providers', 'faq'],
          description: 'Which slice of pricing to return. Default: "all".',
        },
        modelFilter: {
          type: 'string',
          description: 'Optional substring match (model name or provider) when section="models". E.g. "gpt", "claude", "gemini".',
        },
      },
    },
  },
];

// Create MCP server (shared by stdio + hosted transports)
export function createMcpServer(options?: { name?: string; version?: string }): Server {
const server = new Server(
  {
    name: (options?.name?.trim() || 'convocore-mcp').slice(0, 64),
    version: options?.version || '2.5.4',
  },
  {
    capabilities: {
      tools: {},
      prompts: {},
    },
    instructions: MCP_SERVER_INSTRUCTIONS,
  }
);

// Handle list tools request
server.setRequestHandler(ListToolsRequestSchema, async () => {
  return { tools };
});

// ==================== MCP PROMPTS ====================
// Exposes the widget CSS system prompt as a user-invocable prompt so MCP
// clients (e.g. Claude Desktop, Cursor) can run it via slash command.

const PROMPTS = [
  {
    name: 'integrate_website_widget',
    description:
      'Generate a ready-to-paste website embed snippet for a Convocore agent. Fetches the agent ID and fills in region automatically. Use when the user asks to add the chatbot to their site, embed the widget, or get the script tag. Modes: popup-bottom-right (default), popup-bottom-left, full-width (inline div), modal, or voice-react (Next.js WebCall example).',
    arguments: [
      {
        name: 'agentId',
        description: 'The Convocore agent ID (from get_agent or the dashboard URL).',
        required: true,
      },
      {
        name: 'mode',
        description:
          "Embed mode: 'popup-bottom-right' | 'popup-bottom-left' | 'full-width' | 'modal' | 'voice-react'. Defaults to popup-bottom-right.",
        required: false,
      },
    ],
  },
  {
    name: 'generate_widget_css',
    description:
      "Load the full Convocore (vg) chat-widget CSS styling guide as a system message — includes the cascade rule, the complete .vg-* class/id map, hard constraints, the NextUI/Tailwind color system, and selector recipes. Use this whenever you want the assistant to generate or refine CSS for the chat widget. Optionally pass agentId to inject the agent's current customCSS into the context.",
    arguments: [
      {
        name: 'agentId',
        description:
          "Optional agent ID. If provided, the agent's existing customCSS is appended to the prompt so you can refine instead of duplicating rules.",
        required: false,
      },
      {
        name: 'request',
        description:
          "Optional plain-English styling request to seed the conversation, e.g. 'change the icons to black' or 'theme the widget dark purple'.",
        required: false,
      },
    ],
  },
] as const;

server.setRequestHandler(ListPromptsRequestSchema, async () => {
  return { prompts: PROMPTS };
});

server.setRequestHandler(GetPromptRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;

  if (name === 'integrate_website_widget') {
    const agentId = typeof args?.agentId === 'string' ? args.agentId.trim() : '';
    if (!agentId) {
      throw new Error('integrate_website_widget requires agentId');
    }

    const modeRaw = typeof args?.mode === 'string' ? args.mode.trim() : 'popup-bottom-right';
    const allowedModes: WidgetEmbedMode[] = [
      'popup-bottom-right',
      'popup-bottom-left',
      'full-width',
      'modal',
    ];
    const mode = allowedModes.includes(modeRaw as WidgetEmbedMode)
      ? (modeRaw as WidgetEmbedMode)
      : 'popup-bottom-right';
    const isVoiceReact = modeRaw === 'voice-react';

    await getActiveClient().getAgent(agentId);
    const region = widgetRegionFromApiRegion(getActiveConfig().apiRegion);

    const widgetSnippet = buildWidgetEmbedSnippet({ agentId, region, mode });
    const voiceSnippet = buildVoiceSdkExample(agentId, region);

    const text = isVoiceReact
      ? `# Voice-only embed (React / Next.js)

Install: \`pnpm install @tixae-labs/web-sdk@latest\`

Agent ID: \`${agentId}\` | Region: \`${region}\`

\`\`\`tsx
${voiceSnippet}
\`\`\`

Requires WebRTC. For text chat on any website, use the widget script instead (re-run this prompt with mode popup-bottom-right or full-width).`
      : `# Website widget embed

Agent ID: \`${agentId}\` | Region: \`${region}\` | Mode: \`${mode}\`

Paste before \`</body>\`:

\`\`\`html
${widgetSnippet}
\`\`\`

**Modes:** \`popup-bottom-right\` (default bubble), \`popup-bottom-left\`, \`full-width\` (size the container div), \`modal\` (center overlay + \`modalMode: true\`).

**Voice-only in React?** Re-run with \`mode: voice-react\` or use \`@tixae-labs/web-sdk\`.

**Styling?** Call \`get_widget_css_styling_guide\` then \`update_agent_custom_css\` (button colors, header, bubbles, etc.).`;

    return {
      description: `Website embed for agent ${agentId}`,
      messages: [{ role: 'user', content: { type: 'text', text } }],
    };
  }

  if (name !== 'generate_widget_css') {
    throw new Error(`Unknown prompt: ${name}`);
  }

  const agentId = typeof args?.agentId === 'string' ? args.agentId : undefined;
  const userRequest = typeof args?.request === 'string' ? args.request : undefined;

  let currentCSS: string | undefined;
  if (agentId) {
    try {
      currentCSS = await getActiveClient().getAgentCustomCSS(agentId);
    } catch {
      currentCSS = undefined;
    }
  }

  const messages: Array<{ role: 'user' | 'assistant'; content: { type: 'text'; text: string } }> = [
    {
      role: 'user',
      content: {
        type: 'text',
        text: buildWidgetCssPrompt(currentCSS),
      },
    },
  ];

  if (userRequest && userRequest.trim().length > 0) {
    messages.push({
      role: 'user',
      content: {
        type: 'text',
        text: userRequest,
      },
    });
  }

  return {
    description: agentId
      ? `Widget CSS styling guide for agent ${agentId}`
      : 'Widget CSS styling guide',
    messages,
  };
});

// Handle tool calls
server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;

  try {
    switch (name) {
      case 'create_agent': {
        const validated = CreateAgentSchema.parse(args);
        const { additionalConfig, ...agentFields } = validated;
        const payload = {
          agent: {
            ...agentFields,
            ...(additionalConfig || {}),
          },
        };

        const result = await getActiveClient().createAgent(payload);
        const agentId = extractAgentIdFromPayload(result);
        const links = prototypeLinksForAgent(agentId);
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify(
                {
                  ...((result && typeof result === 'object') ? result : { result }),
                  agentId,
                  ...links,
                  note:
                    'Send the user prototypeUrl to try the agent. Never use /agents/{id}.',
                },
                null,
                2
              ),
            },
          ],
        };
      }

      case 'create_agent_from_template': {
        const parsed = CreateAgentFromTemplateSchema.safeParse(args);
        if (!parsed.success) {
          return {
            content: [
              {
                type: 'text',
                text: JSON.stringify(
                  {
                    success: false,
                    message:
                      'Invalid arguments for create_agent_from_template. Provide explicit fields (title/systemPrompt/voiceConfig/primaryColor/widgetImageUrl) OR backward-compatible url/sourceUrl aliases plus optional overrides.',
                    data: {
                      stage: 'validation',
                      issues: parsed.error.issues,
                    },
                  },
                  null,
                  2
                ),
              },
            ],
          };
        }

        let result: any;
        try {
          result = await createAgentFromTemplateFlow(parsed.data);
        } catch (error) {
          result = normalizeToolError(error, 'exception', {
            tool: 'create_agent_from_template',
          });
        }
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify(result, null, 2),
            },
          ],
        };
      }

      case 'get_agent': {
        const validated = GetAgentSchema.parse(args);
        const result = await getActiveClient().getAgent(validated.agentId);
        const agentId =
          extractAgentIdFromPayload(result) ?? validated.agentId;
        const links = prototypeLinksForAgent(agentId);
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify(
                {
                  ...((result && typeof result === 'object') ? result : { result }),
                  agentId,
                  ...links,
                  note:
                    'Public try-it link is prototypeUrl (…/prototype/{agentId}). Never invent /agents/{id}.',
                },
                null,
                2
              ),
            },
          ],
        };
      }

      case 'update_agent': {
        const validated = UpdateAgentSchema.parse(args);
        const { agentId, additionalConfig, ...updateFields } = validated;
        
        const payload = {
          agent: {
            ...updateFields,
            ...(additionalConfig || {}),
          },
        };

        const result = await getActiveClient().updateAgent(agentId, payload);
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify(result, null, 2),
            },
          ],
        };
      }

      case 'patch_agent_prompt': {
        const validated = PatchAgentPromptSchema.parse(args);
        const result = await patchAgentPromptExact({
          agentId: validated.agentId,
          old_string: validated.old_string,
          new_string: validated.new_string,
          replace_all: validated.replace_all ?? false,
          target: validated.target ?? 'auto',
          sync_mirrors: validated.sync_mirrors ?? true,
        });
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify(result, null, 2),
            },
          ],
        };
      }

      case 'delete_agent': {
        const validated = DeleteAgentSchema.parse(args);
        const result = await getActiveClient().deleteAgent(validated.agentId);
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify(result, null, 2),
            },
          ],
        };
      }

      case 'list_agents': {
        const validated = ListAgentsSchema.parse(args);
        const result = await getActiveClient().listAgents(
          validated.limit != null ? { limit: validated.limit } : undefined
        );
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify(result, null, 2),
            },
          ],
        };
      }

      case 'search_agents': {
        const validated = SearchAgentsSchema.parse(args);
        const resolvedWorkspaceId = await resolveWorkspaceId();
        const result = await getActiveClient().searchAgents(
          resolvedWorkspaceId,
          validated.search,
          validated.page,
          validated.limit,
          validated.sortBy,
          validated.starredOnly
        );
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify(result, null, 2),
            },
          ],
        };
      }

      case 'export_agent': {
        const validated = ExportAgentSchema.parse(args);
        const result = await getActiveClient().exportAgentTemplate(validated.agentId);
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify(result, null, 2),
            },
          ],
        };
      }

      case 'import_agent': {
        const validated = ImportAgentSchema.parse(args);
        const result = await getActiveClient().importAgentTemplate(
          validated.agentTemplate,
          validated.agentName,
          validated.fromAgentId
        );
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify(result, null, 2),
            },
          ],
        };
      }

      case 'get_agent_usage': {
        const validated = AgentUsageSchema.parse(args);
        const result = await getActiveClient().getAgentUsage(
          validated.agentId,
          validated.range
        );
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify(result, null, 2),
            },
          ],
        };
      }

      case 'get_agent_usage_bulk': {
        const validated = GetAgentUsageBulkSchema.parse(args);
        const result = await getActiveClient().getAgentUsageBulk(
          validated.agentIds,
          validated.range
        );
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify(result, null, 2),
            },
          ],
        };
      }

      // ==================== CONVERSATION HANDLERS ====================

      case 'list_conversations': {
        const validated = ListConversationsSchema.parse(args);
        const result = await getActiveClient().listConversations(
          validated.agentId,
          validated.page,
          validated.limit,
          validated.cursor
        );
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify(result, null, 2),
            },
          ],
        };
      }

      case 'create_conversation': {
        const validated = CreateConversationSchema.parse(args);
        const result = await getActiveClient().createConversation(
          validated.agentId,
          validated.conversation
        );
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify(result, null, 2),
            },
          ],
        };
      }

      case 'get_conversation': {
        const validated = GetConversationSchema.parse(args);
        const result = await getActiveClient().getConversation(
          validated.agentId,
          validated.convoId
        );
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify(result, null, 2),
            },
          ],
        };
      }

      case 'update_conversation': {
        const validated = UpdateConversationSchema.parse(args);
        const result = await getActiveClient().updateConversation(
          validated.agentId,
          validated.convoId,
          validated.conversation
        );
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify(result, null, 2),
            },
          ],
        };
      }

      case 'update_conversation_messages': {
        const validated = UpdateConversationMessagesSchema.parse(args);
        const { agentId, convoId, confirmReplace: _confirmReplace, ...payload } = validated;
        const result = await getActiveClient().updateConversationMessages(agentId, convoId, payload);
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify(result, null, 2),
            },
          ],
        };
      }

      case 'delete_conversation': {
        const validated = DeleteConversationSchema.parse(args);
        const result = await getActiveClient().deleteConversation(
          validated.agentId,
          validated.convoId
        );
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify(result, null, 2),
            },
          ],
        };
      }

      case 'export_all_conversations': {
        const validated = ExportAllConversationsSchema.parse(args);
        const result = await getActiveClient().exportAllConversations(
          validated.agentId,
          validated.format,
          {
            limit: validated.limit,
            sort: validated.sort,
            fromTs: validated.fromTs,
            toTs: validated.toTs,
            cursor: validated.cursor,
            convoIds: validated.convoIds,
          }
        );
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify(result, null, 2),
            },
          ],
        };
      }

      case 'export_conversation': {
        const validated = ExportConversationSchema.parse(args);
        const result = await getActiveClient().exportConversation(
          validated.agentId,
          validated.convoId,
          validated.format
        );
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify(result, null, 2),
            },
          ],
        };
      }

      case 'assign_conversation': {
        const validated = AssignConversationSchema.parse(args);
        const result = await getActiveClient().assignConversation(
          validated.agentId,
          validated.convoId,
          validated.assignToUserId,
          validated.delegatedBy
        );
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify(result, null, 2),
            },
          ],
        };
      }

      case 'get_conversations_bulk': {
        const validated = GetConversationsBulkSchema.parse(args);
        const result = await getActiveClient().getConversationsBulk(
          validated.agentId,
          validated.convoIds
        );
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify(result, null, 2),
            },
          ],
        };
      }

      case 'query_conversations': {
        const validated = QueryConversationsSchema.parse(args);
        const result = await getActiveClient().queryConversations(validated.agentId, {
          limit: validated.limit,
          maxScan: validated.maxScan,
          filters: {
            origin: validated.origin,
            tsFrom: validated.tsFrom,
            tsTo: validated.tsTo,
            capturedVariableExists: validated.capturedVariableExists,
            capturedVariableEquals: validated.capturedVariableEquals,
            summaryContains: validated.summaryContains,
            hasUserName: validated.hasUserName,
          },
        });
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify(result, null, 2),
            },
          ],
        };
      }

      // ==================== KNOWLEDGE BASE HANDLERS ====================

      case 'create_kb_from_urls': {
        const validated = CreateKbFromUrlsSchema.parse(args);
        const result = await getActiveClient().createKbFromUrls(validated.agentId, {
          urls: validated.urls,
          mode: validated.mode,
          name: validated.name,
          tags: validated.tags,
          refreshRate: validated.refreshRate,
          scrapeContent: validated.scrapeContent,
          skipExisting: validated.skipExisting,
          metadata: validated.metadata,
        });
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify(result, null, 2),
            },
          ],
        };
      }

      case 'create_kb_doc': {
        const validated = CreateKBDocSchema.parse(args);
        const { agentId, ...kbData } = validated;
        // Default scrapeContent=true for url/sitemap so agents don't forget KB-router scrape.
        if (
          (kbData.sourceType === 'url' || kbData.sourceType === 'sitemap') &&
          kbData.scrapeContent === undefined
        ) {
          kbData.scrapeContent = true;
        }
        const result = await getActiveClient().createKBDoc(agentId, kbData);
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify(result, null, 2),
            },
          ],
        };
      }

      case 'list_kb_docs': {
        const validated = ListKBDocsSchema.parse(args);
        const result = await getActiveClient().listKBDocs(
          validated.agentId,
          validated.page,
          validated.pageSize
        );
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify(result, null, 2),
            },
          ],
        };
      }

      case 'get_kb_doc': {
        const validated = GetKBDocSchema.parse(args);
        const result = await getActiveClient().getKBDoc(validated.agentId, validated.docId);
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify(result, null, 2),
            },
          ],
        };
      }

      case 'get_kb_docs_bulk': {
        const validated = GetKbDocsBulkSchema.parse(args);
        const result = await getActiveClient().getKbDocsBulk(
          validated.agentId,
          validated.docIds,
          { includeContent: validated.includeContent }
        );
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify(result, null, 2),
            },
          ],
        };
      }

      case 'update_kb_doc': {
        const validated = UpdateKBDocSchema.parse(args);
        const { agentId, docId, ...kbData } = validated;
        const result = await getActiveClient().updateKBDoc(agentId, docId, kbData);
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify(result, null, 2),
            },
          ],
        };
      }

      case 'patch_kb_doc': {
        const validated = PatchKbDocSchema.parse(args);
        const result = await patchKbDocExact({
          agentId: validated.agentId,
          docId: validated.docId,
          old_string: validated.old_string,
          new_string: validated.new_string,
          replace_all: validated.replace_all ?? false,
          field: validated.field ?? 'content',
        });
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify(result, null, 2),
            },
          ],
        };
      }

      case 'delete_kb_doc': {
        const validated = DeleteKBDocSchema.parse(args);
        const result = await getActiveClient().deleteKBDoc(validated.agentId, validated.docId);
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify(result, null, 2),
            },
          ],
        };
      }

      case 'get_kb_stats': {
        const validated = GetKBStatsSchema.parse(args);
        const result = await getActiveClient().getKBStats(validated.agentId);
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify(result, null, 2),
            },
          ],
        };
      }

      // ==================== SCRAPE HANDLER ====================

      case 'scrape_url': {
        const validated = ScrapeUrlSchema.parse(args);
        const urlList = [
          ...new Set(
            [...(validated.urls ?? []), ...(validated.url ? [validated.url] : [])]
              .map((u) => u.trim())
              .filter(Boolean)
          ),
        ];
        const mode = validated.mode ?? 'check';

        if (mode === 'check') {
          const checked = await checkUrls(urlList);
          return {
            content: [
              {
                type: 'text',
                text: JSON.stringify(
                  {
                    success: true,
                    mode: 'check',
                    message:
                      'HTTP validity check (not a full scrape). ok=true means 2xx/3xx. Use mode=scrape for page content/colours.',
                    ...checked,
                  },
                  null,
                  2
                ),
              },
            ],
          };
        }

        const resolvedWorkspaceId = await resolveWorkspaceId();
        const result = await getActiveClient().scrapeUrl(resolvedWorkspaceId, urlList[0]);
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify({ mode: 'scrape', ...result }, null, 2),
            },
          ],
        };
      }

      // ==================== WIDGET CSS HANDLERS ====================

      case 'get_website_embed_code': {
        const validated = GetWebsiteEmbedCodeSchema.parse(args);
        await getActiveClient().getAgent(validated.agentId);
        const region = widgetRegionFromApiRegion(getActiveConfig().apiRegion);
        const mode = validated.mode ?? 'popup-bottom-right';

        if (mode === 'voice-react') {
          const voiceSnippet = buildVoiceSdkExample(validated.agentId, region);
          return {
            content: [
              {
                type: 'text',
                text: JSON.stringify(
                  {
                    agentId: validated.agentId,
                    region,
                    mode,
                    install: 'pnpm install @tixae-labs/web-sdk@latest',
                    note: 'Voice-only React embed. Requires WebRTC. For text chat on any website use popup-bottom-right or full-width instead.',
                    code: voiceSnippet,
                  },
                  null,
                  2
                ),
              },
            ],
          };
        }

        const html = buildWidgetEmbedSnippet({
          agentId: validated.agentId,
          region,
          mode,
          containerWidth: validated.containerWidth,
          containerHeight: validated.containerHeight,
        });

        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify(
                {
                  agentId: validated.agentId,
                  region,
                  mode,
                  instructions: 'Paste before </body> on any website (WordPress, Shopify, Webflow, plain HTML, etc.).',
                  html,
                },
                null,
                2
              ),
            },
          ],
        };
      }

      case 'get_widget_css_styling_guide': {
        const validated = WidgetCssStylingGuideSchema.parse(args);
        let currentCSS: string | undefined;
        if (validated.agentId) {
          try {
            currentCSS = await getActiveClient().getAgentCustomCSS(validated.agentId);
          } catch {
            // Non-fatal — return the base guide if we can't fetch the agent
            currentCSS = undefined;
          }
        }
        return {
          content: [
            {
              type: 'text',
              text: buildWidgetCssPrompt(currentCSS),
            },
          ],
        };
      }

      case 'get_agent_custom_css': {
        const validated = GetAgentCustomCssSchema.parse(args);
        const css = await getActiveClient().getAgentCustomCSS(validated.agentId);
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify(
                { agentId: validated.agentId, customCSS: css, length: css.length },
                null,
                2,
              ),
            },
          ],
        };
      }

      // ==================== FILE I/O HANDLERS ====================
      // file-readers is dynamic-imported so the heavy parsers (sharp / pdf-parse /
      // mammoth / xlsx) never load until a file tool is actually called.

      case 'inspect_file': {
        const validated = InspectFileSchema.parse(args);
        const { inspectFile } = await import('./file-readers.js');
        const result = await inspectFile(validated);
        return {
          content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
        };
      }

      case 'read_text_file': {
        const validated = ReadTextFileSchema.parse(args);
        const { maxBytes, ...src } = validated;
        const { readTextFile } = await import('./file-readers.js');
        const result = await readTextFile(src, maxBytes);
        return {
          content: [
            { type: 'text', text: result.text },
            {
              type: 'text',
              text: JSON.stringify(
                {
                  truncated: result.truncated,
                  totalBytes: result.totalBytes,
                  estimatedTokens: result.estimatedTokens,
                },
                null,
                2,
              ),
            },
          ],
        };
      }

      case 'read_pdf': {
        const validated = ReadPdfSchema.parse(args);
        const { pages, ...src } = validated;
        const { readPdf } = await import('./file-readers.js');
        const result = await readPdf(src, pages);
        return {
          content: [
            { type: 'text', text: result.text },
            {
              type: 'text',
              text: JSON.stringify(
                {
                  totalPages: result.totalPages,
                  pagesReturned: result.pagesReturned,
                  truncated: result.truncated,
                  estimatedTokens: result.estimatedTokens,
                  info: result.info,
                },
                null,
                2,
              ),
            },
          ],
        };
      }

      case 'read_docx': {
        const validated = ReadDocxSchema.parse(args);
        const { asMarkdown, ...src } = validated;
        const { readDocx } = await import('./file-readers.js');
        const result = await readDocx(src, asMarkdown);
        return {
          content: [
            { type: 'text', text: result.text },
            {
              type: 'text',
              text: JSON.stringify(
                {
                  format: result.format,
                  truncated: result.truncated,
                  estimatedTokens: result.estimatedTokens,
                  warnings: result.warnings.slice(0, 10),
                },
                null,
                2,
              ),
            },
          ],
        };
      }

      case 'read_spreadsheet': {
        const validated = ReadSpreadsheetSchema.parse(args);
        const { sheet, range, format, headerRow, maxRows, ...src } = validated;
        const { readSpreadsheet } = await import('./file-readers.js');
        const result = await readSpreadsheet(src, { sheet, range, format, headerRow, maxRows });
        return {
          content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
        };
      }

      case 'read_image': {
        const validated = ReadImageSchema.parse(args);
        const { maxDimension, ...src } = validated;
        const { readImage } = await import('./file-readers.js');
        const result = await readImage(src, { maxDimension });
        // Native MCP image content block — vision-capable hosts render it inline.
        return {
          content: [
            {
              type: 'image',
              data: result.base64,
              mimeType: result.mimeType,
            },
            {
              type: 'text',
              text: JSON.stringify(
                {
                  width: result.width,
                  height: result.height,
                  mimeType: result.mimeType,
                  sizeBytes: result.sizeBytes,
                  normalized: result.normalized,
                },
                null,
                2,
              ),
            },
          ],
        };
      }

      case 'import_file_to_kb': {
        const validated = ImportFileToKbSchema.parse(args);
        const { agentId, name, tags, pages, sheet, asMarkdown, ...src } = validated;
        const { extractToText } = await import('./file-readers.js');
        const extracted = await extractToText(src, { pages, sheet, asMarkdown });
        const docName = name || extracted.name || 'Imported document';
        const kb = await getActiveClient().createKBDoc(agentId, {
          name: docName,
          sourceType: 'doc',
          content: extracted.text,
          tags,
          metadata: {
            origin: extracted.origin,
            kind: extracted.kind,
            mimeType: extracted.mimeType,
            ...extracted.meta,
            importedAt: new Date().toISOString(),
          },
        });
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify(
                {
                  imported: {
                    agentId,
                    docName,
                    kind: extracted.kind,
                    estimatedTokens: extracted.estimatedTokens,
                    truncated: extracted.truncated,
                  },
                  kbResponse: kb,
                },
                null,
                2,
              ),
            },
          ],
        };
      }

      case 'update_agent_custom_css': {
        const validated = UpdateAgentCustomCssSchema.parse(args);
        const result = await getActiveClient().updateAgentCustomCSS(
          validated.agentId,
          validated.customCSS,
        );
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify(result, null, 2),
            },
          ],
        };
      }

      case 'sleep': {
        const { seconds } = SleepSchema.parse(args);
        const start = Date.now();
        await new Promise((resolve) => setTimeout(resolve, seconds * 1000));
        const elapsedMs = Date.now() - start;
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify(
                { sleptSeconds: seconds, elapsedMs },
                null,
                2,
              ),
            },
          ],
        };
      }

      case 'run_command': {
        const validated = RunCommandSchema.parse(args);
        const timeoutMs = (validated.timeoutSeconds ?? 30) * 1000;
        try {
          const { stdout, stderr } = await execAsync(validated.command, {
            cwd: validated.cwd,
            timeout: timeoutMs,
            maxBuffer: 10 * 1024 * 1024,
            windowsHide: true,
          });
          return {
            content: [
              {
                type: 'text',
                text: JSON.stringify(
                  {
                    command: validated.command,
                    cwd: validated.cwd ?? process.cwd(),
                    exitCode: 0,
                    stdout,
                    stderr,
                  },
                  null,
                  2,
                ),
              },
            ],
          };
        } catch (err: unknown) {
          const e = err as {
            code?: number | string;
            killed?: boolean;
            signal?: string;
            stdout?: string;
            stderr?: string;
            message?: string;
          };
          return {
            content: [
              {
                type: 'text',
                text: JSON.stringify(
                  {
                    command: validated.command,
                    cwd: validated.cwd ?? process.cwd(),
                    exitCode: typeof e.code === 'number' ? e.code : null,
                    killed: e.killed ?? false,
                    signal: e.signal ?? null,
                    stdout: e.stdout ?? '',
                    stderr: e.stderr ?? '',
                    error: e.message ?? String(err),
                  },
                  null,
                  2,
                ),
              },
            ],
            isError: true,
          };
        }
      }

      case 'list_voice_providers': {
        ListVoiceProvidersSchema.parse(args ?? {});
        const result = await getActiveClient().listVoiceProviders();
        return {
          content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
        };
      }

      case 'list_voice_models': {
        const validated = ListVoiceModelsSchema.parse(args);
        const result = await getActiveClient().listVoiceModels(validated.provider);
        return {
          content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
        };
      }

      case 'search_voices': {
        const validated = SearchVoicesSchema.parse(args ?? {});
        const result = await getActiveClient().searchVoices(validated);
        return {
          content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
        };
      }

      case 'list_provider_voices': {
        const validated = ListProviderVoicesSchema.parse(args);
        const { provider, ...filters } = validated;
        const result = await getActiveClient().listProviderVoices(provider, filters);
        return {
          content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
        };
      }

      case 'get_voice': {
        const validated = GetVoiceSchema.parse(args);
        const result = await getActiveClient().getVoice(validated.provider, validated.voiceId);
        return {
          content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
        };
      }

      case 'buy_twilio_number': {
        const validated = BuyTwilioNumberSchema.parse(args);
        const result = await getActiveClient().buyTwilioNumber(
          validated.number,
          validated.agentId,
          validated.capabilities,
        );
        return {
          content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
        };
      }

      case 'import_twilio_number': {
        const validated = ImportTwilioNumberSchema.parse(args);
        const result = await getActiveClient().importTwilioNumber(validated.payload);
        return {
          content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
        };
      }

      case 'release_twilio_number': {
        const validated = ReleaseTwilioNumberSchema.parse(args);
        const result = await getActiveClient().releaseTwilioNumber(validated.payload);
        return {
          content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
        };
      }

      case 'check_twilio_number': {
        const validated = CheckTwilioNumberSchema.parse(args);
        const result = await getActiveClient().checkTwilioNumber(validated.payload);
        return {
          content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
        };
      }

      case 'sync_sms_twilio_number': {
        const validated = SyncSmsTwilioNumberSchema.parse(args);
        const result = await getActiveClient().syncSmsTwilioNumber(validated.payload);
        return {
          content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
        };
      }

      case 'interact_with_agent': {
        const validated = InteractWithAgentSchema.parse(args);
        const { timeoutMs, raw, bucket, ...rest } = validated;

        const request = {
          ...rest,
          bucket: bucket ?? getActiveClient().getDefaultInteractBucket(),
        };

        const result = await getActiveClient().interactWithAgent(request, { timeoutMs });

        // When the tested agent emitted UI Engine output, attach an
        // inline guidance block so the calling LLM knows EXACTLY what
        // shape to expect / validate without having to call
        // get_ui_engine_spec separately. This mirrors the contract that
        // the backend `createUiEnginePrompt` injects into the agent.
        const uiEngineGuidance = result.uiEngineEnabled
          ? {
              note:
                'This turn used the Convocore UI Engine. The tested agent\'s LLM was instructed to emit a single JSON array of message objects ([{ type, payload }, ...]). The server then wraps each entry into messages[].item inside the TurnProps snapshot you see in `uiEngineSnapshot`.',
              expectedAgentOutputContract: UI_ENGINE_SPEC.agentOutputContract,
              preferredStructure: UI_ENGINE_SPEC.preferredStructure,
              channelRules: UI_ENGINE_SPEC.channelRules,
              validationChecklist: UI_ENGINE_SPEC.validationChecklist,
              allowedMessageTypes: Object.keys(UI_ENGINE_SPEC.messageTypes),
              snapshotSemantics:
                'UI Engine chunks are OVERWRITING — `uiEngineSnapshot` is the LATEST full snapshot, equivalent to the agent\'s final output for this turn.',
              forPlainTextOnNextTurn:
                'Pass disableUiEngine: true on the next interact_with_agent call to bypass UI Engine for one turn.',
              fullSpecHint:
                'For the complete schema (every payload field, validation rules, examples) call `get_ui_engine_spec`.',
            }
          : undefined;

        const responsePayload = raw
          ? { ...result, ...(uiEngineGuidance ? { uiEngineGuidance } : {}) }
          : {
              assistantText: result.assistantText,
              uiEngineEnabled: result.uiEngineEnabled,
              uiEngineSnapshot: result.uiEngineSnapshot,
              uiEngineSummary: result.uiEngineSummary,
              ...(uiEngineGuidance ? { uiEngineGuidance } : {}),
              actions: result.actions,
              metadata: result.metadata,
              turns: result.turns,
              closeCode: result.closeCode,
              closeReason: result.closeReason,
              durationMs: result.durationMs,
              timedOut: result.timedOut,
              chunkCount: result.chunks.length,
            };

        return {
          content: [{ type: 'text', text: JSON.stringify(responsePayload, null, 2) }],
        };
      }

      case 'get_ui_engine_spec': {
        const validated = GetUiEngineSpecSchema.parse(args ?? {});
        const section = validated.section ?? 'all';

        let payload: unknown;

        if (validated.messageType) {
          const schema = (UI_ENGINE_SPEC.messageTypes as Record<string, unknown>)[
            validated.messageType
          ];
          payload = {
            messageType: validated.messageType,
            schema,
            shared: UI_ENGINE_SPEC.shared,
          };
        } else {
          switch (section) {
            case 'all':
              payload = UI_ENGINE_SPEC;
              break;
            case 'meta':
              payload = { meta: UI_ENGINE_SPEC.meta };
              break;
            case 'envelopes':
              payload = { envelopes: UI_ENGINE_SPEC.envelopes };
              break;
            case 'message_types':
              payload = { messageTypes: UI_ENGINE_SPEC.messageTypes };
              break;
            case 'shared':
              payload = { shared: UI_ENGINE_SPEC.shared };
              break;
            case 'rules':
              payload = { rules: UI_ENGINE_SPEC.rules };
              break;
            case 'checklist':
              payload = { validationChecklist: UI_ENGINE_SPEC.validationChecklist };
              break;
            case 'primer':
              payload = { primer: UI_ENGINE_PRIMER };
              break;
          }
        }

        return {
          content: [{ type: 'text', text: JSON.stringify(payload, null, 2) }],
        };
      }

      case 'get_channel_integration_spec': {
        const validated = GetChannelIntegrationSpecSchema.parse(args ?? {});
        const section = validated.section ?? 'all';
        const payload =
          section === 'all'
            ? CHANNEL_INTEGRATION_SPEC
            : {
                section,
                spec: CHANNEL_INTEGRATION_SPEC[section],
              };

        return {
          content: [{ type: 'text', text: JSON.stringify(payload, null, 2) }],
        };
      }

      case 'get_pricing_info': {
        const validated = GetPricingInfoSchema.parse(args ?? {});
        const section = validated.section ?? 'all';

        let payload: unknown;
        switch (section) {
          case 'all':
            payload = {
              ...PRICING,
              voiceProviders: VOICE_PROVIDERS,
            };
            break;
          case 'plans':
            payload = { plans: PRICING.plans, meta: PRICING.meta };
            break;
          case 'add_ons':
            payload = { addOns: PRICING.addOns, meta: PRICING.meta };
            break;
          case 'credits':
            payload = {
              creditConversion: PRICING.meta.creditConversion,
              creditActions: PRICING.creditActions,
              notes: PRICING.meta.notes,
            };
            break;
          case 'rules_of_thumb':
            payload = { rulesOfThumb: PRICING.rulesOfThumb, meta: PRICING.meta };
            break;
          case 'models': {
            const filter = validated.modelFilter?.toLowerCase().trim();
            const models = filter
              ? PRICING.models.filter(
                  (m) =>
                    m.model.toLowerCase().includes(filter) ||
                    m.modelId.toLowerCase().includes(filter) ||
                    m.provider.toLowerCase().includes(filter),
                )
              : PRICING.models;
            payload = {
              creditConversion: PRICING.meta.creditConversion,
              recommendedNewAgentModel: 'gpt-5.6-luna',
              fallbackNewAgentModel: 'gemini-3.1-flash-lite',
              models,
              filter: filter ?? null,
              count: models.length,
              notes: [
                'Prices are USD per 1,000,000 tokens (input / output).',
                'Each interaction also charges 1 base credit ($0.001) on top of token cost.',
                'New agents should use gpt-5.6-luna (then gemini-3.1-flash-lite). Avoid gpt-4o / legacy defaults.',
                'Higher plans include every lower model tier.',
              ],
            };
            break;
          }
          case 'voice_providers':
            payload = { voiceProviders: VOICE_PROVIDERS, meta: PRICING.meta };
            break;
          case 'faq':
            payload = { faq: PRICING.faq, meta: PRICING.meta };
            break;
        }

        return {
          content: [{ type: 'text', text: JSON.stringify(payload, null, 2) }],
        };
      }

      default:
        throw new Error(`Unknown tool: ${name}`);
    }
  } catch (error) {
    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify(
            normalizeToolError(error, 'tool_handler', {
              tool: name,
            }),
            null,
            2
          ),
        },
      ],
    };
  }
});

  return server;
}

export { tools };

// Start stdio transport ONLY for local npx / `node dist/index.js`.
// Hosted Docker uses dist/hosted.js — auth is Bearer per request, no WORKSPACE_SECRET at boot.
async function startStdioTransport() {
  if (!process.env.WORKSPACE_SECRET?.trim()) {
    throw new Error(
      'WORKSPACE_SECRET environment variable is required for stdio/npx mode. ' +
        'For remote MCP (Docker / mcp.convocore.ai), run: node dist/hosted.js — ' +
        'clients send Authorization: Bearer <WORKSPACE_SECRET> on each request.'
    );
  }
  const defaultConfig = getConfig();
  initDefaultRequestContext(new ConvocoreClient(defaultConfig), defaultConfig);

  const server = createMcpServer();
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error('Convocore MCP Server running on stdio');
}

const entryArg = process.argv[1] ? path.resolve(process.argv[1]) : '';
const thisFile = fileURLToPath(import.meta.url);
const isHostedTransport =
  process.env.MCP_TRANSPORT === 'http' ||
  entryArg.endsWith(`${path.sep}hosted.js`) ||
  entryArg.endsWith(`${path.sep}hosted.ts`);
const isStdioEntry = Boolean(entryArg) && entryArg === thisFile && !isHostedTransport;

if (isStdioEntry) {
  startStdioTransport().catch((error) => {
    console.error('Fatal error in startStdioTransport():', error);
    process.exit(1);
  });
}

