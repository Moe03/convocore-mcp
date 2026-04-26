#!/usr/bin/env node

/**
 * ConvoCore MCP Server
 * Provides Model Context Protocol tools for managing ConvoCore AI agents
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
import { ConvoCoreClient } from './convocore-client.js';
import { WIDGET_CSS_SYSTEM_PROMPT, buildWidgetCssPrompt } from './css-prompt.js';
import { PRICING, VOICE_PROVIDERS } from './pricing.js';
import { UI_ENGINE_PRIMER, UI_ENGINE_SPEC } from './ui-engine-spec.js';
import { CHANNEL_INTEGRATION_SPEC } from './channel-integration-spec.js';

const execAsync = promisify(exec);

// Initialize configuration and client
const config = getConfig();
const client = new ConvoCoreClient(config);

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

const AgentTemplateValues = ['blank', 'customer_support', 'real_estate', 'healthcare_secretary', 'game_npc'] as const;

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
  vg_enableUIEngine: z.boolean().optional().describe('Enable structured UI Engine responses for this agent'),
  voiceConfig: AgentVoiceConfigSchema.optional().describe('Agent voice configuration for transcription, speech generation, and call settings'),
  nodes: z.array(AgentNodeSchema).optional().describe('Agent nodes; when enableNodes=true, nodes[0].instructions is the canonical main/system prompt'),
  additionalConfig: z.record(z.any()).optional().describe('Escape hatch for raw agent fields not modeled by this MCP yet; not a primary API concept'),
});

const CreateAgentFromTemplateSchema = z.object({
  workspaceId: z.string().describe('Workspace ID used for the scrape step'),
  url: z.string().url().describe('Website URL to scrape before generating the agent prompt'),
  template: z.enum(AgentTemplateValues).optional().default('customer_support').describe('Backbone template to use'),
  title: z.string().optional().describe('Optional agent title override'),
  description: z.string().optional().describe('Optional agent description override'),
  theme: z.string().optional().default('blue-light').describe('Visual theme'),
  language: z.string().optional().default('en').describe('Primary language for the agent'),
  roundedImageURL: z.string().url().optional().describe('Optional avatar/logo URL'),
  chatBgURL: z.string().url().optional().describe('Optional chat background image URL'),
  branding: z.string().optional().describe('Optional branding label'),
  proactiveMessage: z.string().optional().describe('Optional proactive greeting bubble text'),
  createKbUrlDoc: z.boolean().optional().default(true).describe('If true, add the URL as a KB document after creating the agent'),
  additionalConfig: z.record(z.any()).optional().describe('Optional extra agent fields to merge in last'),
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
  vg_enableUIEngine: z.boolean().optional().describe('Enable or disable structured UI Engine responses for this agent'),
  voiceConfig: AgentVoiceConfigSchema.optional().describe('Updated agent voice configuration'),
  nodes: z.array(AgentNodeSchema).optional().describe('Agent nodes; when enableNodes=true, nodes[0].instructions updates the canonical main/system prompt'),
  additionalConfig: z.record(z.any()).optional().describe('Escape hatch for raw agent fields not modeled by this MCP yet; use explicit fields when available'),
});

const DeleteAgentSchema = z.object({
  agentId: z.string().describe('The unique identifier of the agent to delete'),
});

const ListAgentsSchema = z.object({
  // No parameters needed - just lists all agents!
});

const SearchAgentsSchema = z.object({
  workspaceId: z.string().describe('Your workspace/org ID from ConvoCore dashboard'),
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
  page: z.number().optional().default(1).describe('Page number'),
  limit: z.number().optional().default(20).describe('Results per page'),
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

// ==================== KNOWLEDGE BASE SCHEMAS ====================

const CreateKBDocSchema = z.object({
  agentId: z.string().describe('The agent ID'),
  name: z.string().describe('Document name'),
  sourceType: z.enum(['doc', 'url', 'sitemap']).describe('Source type'),
  content: z.string().optional().describe('Document content (for doc type)'),
  metadata: z.any().optional().describe('Additional metadata'),
  tags: z.array(z.string()).optional().describe('Tags for organization'),
  refreshRate: z.enum(['6h', '12h', '24h', '7d', 'never']).optional().default('never').describe('Auto-refresh rate'),
  urls: z.array(z.string()).optional().describe('URLs to process (for url type)'),
  sitemapUrl: z.string().optional().describe('Sitemap URL (for sitemap type)'),
  maxPages: z.number().optional().describe('Max pages from sitemap'),
  scrapeContent: z.boolean().optional().describe('Whether to scrape content'),
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
  refreshRate: z.enum(['6h', '12h', '24h', '7d', 'never']).optional().describe('Updated refresh rate'),
  url: z.string().optional().describe('Updated URL'),
});

const DeleteKBDocSchema = z.object({
  agentId: z.string().describe('The agent ID'),
  docId: z.string().describe('The document ID'),
});

const GetKBStatsSchema = z.object({
  agentId: z.string().describe('The agent ID'),
});

// ==================== SCRAPE SCHEMAS ====================

const ScrapeUrlSchema = z.object({
  workspaceId: z.string().describe('The workspace that owns the scrape job'),
  url: z.string().url().describe('The single URL to scrape'),
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

const DEFAULT_MODEL_FOR_TEMPLATE_AGENTS = 'zai-org/GLM-5';

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

type AgentTemplateName = (typeof AgentTemplateValues)[number];

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

function buildPromptFromScrape(args: {
  url: string;
  domainLabel: string;
  template: AgentTemplateName;
  scrapedText: string;
}): string {
  const base = [
    `You are the official ${args.domainLabel} support assistant.`,
    `Ground your answers in information from ${args.url}.`,
    'Never invent company policies, pricing, or technical details.',
    'If information is missing, say that clearly and offer to escalate to a human.',
    'Keep answers concise, clear, and helpful.',
    'DO NOT output images unless the user explicitly asks for an image.',
  ];

  if (args.template === 'real_estate') {
    base.push('When users ask about properties, ask clarifying questions about budget, location, and timeline.');
  } else if (args.template === 'healthcare_secretary') {
    base.push('Be empathetic and professional. Do not provide medical diagnosis; focus on admin and booking support.');
  } else if (args.template === 'game_npc') {
    base.push('Keep a playful tone while still staying safe and polite.');
  } else if (args.template === 'customer_support') {
    base.push('Prioritize troubleshooting steps, account help, and product plan guidance.');
  }

  if (args.scrapedText.length > 0) {
    base.push('');
    base.push('Website context excerpt (sanitized):');
    base.push(args.scrapedText.slice(0, 2800));
  }

  return base.join('\n');
}

function buildTemplateNodes(template: AgentTemplateName, startInstructions: string): Array<Record<string, unknown>> {
  const startNode = {
    name: 'Start',
    instructions: startInstructions,
  };

  if (template === 'customer_support') {
    return [
      startNode,
      {
        name: 'Pricing Expert',
        instructions: 'Answer pricing questions clearly using KB data only.',
      },
      {
        name: 'Features Expert',
        instructions: 'Answer feature questions clearly using KB data only.',
      },
    ];
  }

  if (template === 'real_estate') {
    return [
      startNode,
      {
        name: 'Units Expert',
        instructions: 'Use KB data to explain available units and help qualify user intent.',
      },
    ];
  }

  if (template === 'healthcare_secretary') {
    return [
      startNode,
      {
        name: 'Appointment Scheduler',
        instructions: 'Collect booking details, confirm back to the user, and remain professional.',
      },
    ];
  }

  if (template === 'game_npc') {
    return [
      startNode,
      {
        name: 'Game Win Node',
        instructions: 'Congratulate the user for winning and invite them to restart to play again.',
      },
    ];
  }

  return [startNode];
}

async function createAgentFromTemplateFlow(args: z.infer<typeof CreateAgentFromTemplateSchema>) {
  const {
    workspaceId,
    url,
    template,
    title,
    description,
    theme,
    language,
    roundedImageURL,
    chatBgURL,
    branding,
    proactiveMessage,
    createKbUrlDoc,
    additionalConfig,
  } = args;

  const scrapeResult = await client.scrapeUrl(workspaceId, url);
  const domainLabel = toDomainLabel(url);
  const scrapedText = extractScrapedText(scrapeResult);
  const startPrompt = buildPromptFromScrape({
    url,
    domainLabel,
    template,
    scrapedText,
  });
  const nodes = buildTemplateNodes(template, startPrompt);

  const payload = {
    agent: {
      title: title ?? `${domainLabel} Assistant`,
      description:
        description ?? `AI assistant for ${domainLabel}, grounded in ${url}.`,
      theme,
      enableNodes: true,
      vg_enableUIEngine: true,
      voiceConfig: DEFAULT_TEMPLATE_VOICE_CONFIG,
      vg_instructions: startPrompt,
      nodes,
      // Keep common cosmetic fields only; avoid sending unsupported advanced
      // fields to the strict create endpoint.
      lang: language,
      proactiveMessage: proactiveMessage ?? '👋 Hi, how can I help you today?',
      roundedImageURL,
      chatBgURL,
      branding,
      ...(additionalConfig || {}),
    },
  };

  const result = await client.createAgent(payload);
  const createdAgentId = (result as any)?.data?.ID || (result as any)?.data?.id;
  let kbImportResult: any = null;

  if (createKbUrlDoc && createdAgentId) {
    try {
      kbImportResult = await client.createKBDoc(createdAgentId, {
        name: `${domainLabel} Website`,
        sourceType: 'url',
        urls: [url],
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

  return {
    success: (result as any)?.success ?? true,
    message: 'Template-based agent created from scraped website context.',
    data: {
      agent: (result as any)?.data ?? result,
      templateUsed: template,
      startPrompt,
      scrape: {
        success: scrapeResult.success,
        timedOut: !!scrapeResult.data?.timedOut,
        url,
        excerpt: scrapedText.slice(0, 1200),
      },
      kbImport: kbImportResult,
    },
  };
}

// Define MCP tools
const tools: Tool[] = [
  {
    name: 'create_agent',
    description:
      'Create a new ConvoCore AI agent directly from supplied fields (legacy/raw mode). IMPORTANT: for new agents from scratch, first learn the website via scrape and use create_agent_from_template instead. Use this tool only for manual/advanced direct payload control.',
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
        vg_enableUIEngine: {
          type: 'boolean',
          description:
            'Enable structured UI Engine output for this agent. When true, /interact returns UI Engine snapshots unless disableUiEngine=true is passed for a turn. Call get_ui_engine_spec for the full message schema.',
        },
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
            'Escape hatch for raw agent fields not modeled by this MCP yet. This is not a primary ConvoCore concept; prefer explicit fields like enableNodes, vg_instructions, vg_enableUIEngine, nodes, and voiceConfig. Never set read-only fields like ownerID here.',
        },
      },
      required: ['title'],
    },
  },
  {
    name: 'create_agent_from_template',
    description:
      'PREFERRED way to create new agents from scratch. Always starts by scraping the provided website URL so the agent understands what the site is about before creation. Then it synthesizes a start prompt and creates a VG agent from a hardcoded backbone template with branding/title overrides.',
    inputSchema: {
      type: 'object',
      properties: {
        workspaceId: {
          type: 'string',
          description: 'Workspace ID used for the scrape step',
        },
        url: {
          type: 'string',
          format: 'uri',
          description: 'Website URL to scrape before creating the agent',
        },
        template: {
          type: 'string',
          enum: [...AgentTemplateValues],
          description: 'Backbone template key. Default: customer_support',
        },
        title: {
          type: 'string',
          description: 'Optional agent title override',
        },
        description: {
          type: 'string',
          description: 'Optional agent description override',
        },
        theme: {
          type: 'string',
          description: 'Visual theme (default: blue-light)',
        },
        language: {
          type: 'string',
          description: 'Primary language for the agent (default: en)',
        },
        roundedImageURL: {
          type: 'string',
          format: 'uri',
          description: 'Optional avatar/logo URL',
        },
        chatBgURL: {
          type: 'string',
          format: 'uri',
          description: 'Optional chat background image URL',
        },
        branding: {
          type: 'string',
          description: 'Optional branding label',
        },
        proactiveMessage: {
          type: 'string',
          description: 'Optional proactive greeting bubble text',
        },
        createKbUrlDoc: {
          type: 'boolean',
          description: 'If true, add the source URL into KB after agent creation',
        },
        additionalConfig: {
          type: 'object',
          description: 'Optional extra agent fields merged into the final payload',
        },
      },
      required: ['workspaceId', 'url'],
    },
  },
  {
    name: 'get_agent',
    description:
      'Retrieve details of a specific ConvoCore agent. Prompt rule: if enableNodes=true, read the main prompt from nodes[0].instructions. If enableNodes=false or nodes are absent (old agent), read legacy vg_instructions. ownerID is the workspaceId and is read-only.',
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
      'Update an existing ConvoCore agent. CRITICAL prompt rule: first get_agent when unsure. If enableNodes=true, update nodes[0].instructions to change the canonical main/system prompt. If enableNodes=false or the agent is old and has no nodes, update legacy vg_instructions instead. ownerID/workspaceId is read-only. Integrations are workspace/org/client-level, not agent-level.',
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
        vg_enableUIEngine: {
          type: 'boolean',
          description:
            'Enable/disable structured UI Engine output for this agent. When true, /interact returns UI Engine snapshots unless disableUiEngine=true is passed for a turn. Call get_ui_engine_spec for the full message schema.',
        },
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
            'Escape hatch for raw agent fields not modeled by this MCP yet. Prefer explicit fields. Never set read-only fields like ownerID/workspaceId here.',
        },
      },
      required: ['agentId'],
    },
  },
  {
    name: 'delete_agent',
    description: 'Delete a ConvoCore agent permanently',
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
      'List latest/all accessible ConvoCore agents with no filters. For most agent lookup automation, prefer search_agents because it takes workspaceId (same value as agent.ownerID) and supports search/pagination/sorting.',
    inputSchema: {
      type: 'object',
      properties: {},
      required: [],
    },
  },
  {
    name: 'search_agents',
    description:
      'Search/filter ConvoCore agents. Prefer this for most automation. workspaceId is the same value as agent.ownerID (ownerID is read-only on the agent document). Use list_agents only when the user explicitly wants recent/latest agents without search filters.',
    inputSchema: {
      type: 'object',
      properties: {
        workspaceId: {
          type: 'string',
          description:
            'Workspace/org ID. This is the same value as agent.ownerID on returned agents; ownerID is read-only and must not be patched.',
        },
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
      required: ['workspaceId'],
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
    description: 'List all conversations for an agent',
    inputSchema: {
      type: 'object',
      properties: {
        agentId: {
          type: 'string',
          description: 'The agent ID to list conversations for',
        },
        page: {
          type: 'number',
          description: 'Page number (default: 1)',
        },
        limit: {
          type: 'number',
          description: 'Results per page (default: 20)',
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
    description: 'Export all conversations for an agent',
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
      },
      required: ['agentId'],
    },
  },
  {
    name: 'export_conversation',
    description: 'Export a single conversation',
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
  // ==================== KNOWLEDGE BASE TOOLS ====================
  {
    name: 'create_kb_doc',
    description: 'Add a document to an agent\'s knowledge base (VG agents only)',
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
          description: 'Source type: doc (text content), url (single URL), sitemap (multiple pages)',
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
          enum: ['6h', '12h', '24h', '7d', 'never'],
          description: 'Auto-refresh rate (default: never)',
        },
        urls: {
          type: 'array',
          items: { type: 'string' },
          description: 'Array of URLs (for sourceType: url)',
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
          description: 'Whether to scrape content from URLs',
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
    description: 'Update a knowledge base document (VG agents only)',
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
          enum: ['6h', '12h', '24h', '7d', 'never'],
          description: 'Updated refresh rate',
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
    description: 'Scrape exactly one URL for a workspace and wait for the scrape result before returning. This tool does not follow discovered links and does not expose job options.',
    inputSchema: {
      type: 'object',
      properties: {
        workspaceId: {
          type: 'string',
          description: 'The workspace that owns the scrape job',
        },
        url: {
          type: 'string',
          format: 'uri',
          description: 'The single URL to scrape',
        },
      },
      required: ['workspaceId', 'url'],
    },
  },
  // ==================== WIDGET CSS TOOLS ====================
  {
    name: 'get_widget_css_styling_guide',
    description:
      "MUST CALL FIRST whenever the user asks to style/restyle/theme the ConvoCore (vg) chat widget — e.g. 'change the icons to black', 'make the header purple', 'recolor the send button', 'theme the widget dark', 'change the user bubble color', 'restyle the proactive teaser'. " +
      "Returns the FULL authoritative styling guide (the same SYSTEM_PROMPT used by ConvoCore's server-side AI CSS generator) including: " +
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
      "WARNING: This consumes ConvoCore credits exactly like a real agent turn (LLM + voice + tools). It is NOT a dry-run.",
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
      "(b) creating / updating an agent that should produce UI Engine output (so the system prompt teaches the LLM to emit valid `text` / `choice` / `visual` / `cardV2` / `carousel` / `iFrame` / `form` / `input` messages). " +
      "Returns: meta (streaming + channel-gating semantics), envelopes (TurnProps / ChatMessage), messageTypes (every UiEngineMessage shape with payload fields and examples), shared types (UiEngineButton, UiEngineInputField), rules, and a validationChecklist. " +
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

// Create MCP server
const server = new Server(
  {
    name: 'convocore-mcp',
    version: '2.2.0',
  },
  {
    capabilities: {
      tools: {},
      prompts: {},
    },
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
    name: 'generate_widget_css',
    description:
      "Load the full ConvoCore (vg) chat-widget CSS styling guide as a system message — includes the cascade rule, the complete .vg-* class/id map, hard constraints, the NextUI/Tailwind color system, and selector recipes. Use this whenever you want the assistant to generate or refine CSS for the chat widget. Optionally pass agentId to inject the agent's current customCSS into the context.",
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

  if (name !== 'generate_widget_css') {
    throw new Error(`Unknown prompt: ${name}`);
  }

  const agentId = typeof args?.agentId === 'string' ? args.agentId : undefined;
  const userRequest = typeof args?.request === 'string' ? args.request : undefined;

  let currentCSS: string | undefined;
  if (agentId) {
    try {
      currentCSS = await client.getAgentCustomCSS(agentId);
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

        const result = await client.createAgent(payload);
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify(result, null, 2),
            },
          ],
        };
      }

      case 'create_agent_from_template': {
        const validated = CreateAgentFromTemplateSchema.parse(args);
        const result = await createAgentFromTemplateFlow(validated);
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
        const result = await client.getAgent(validated.agentId);
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify(result, null, 2),
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

        const result = await client.updateAgent(agentId, payload);
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
        const result = await client.deleteAgent(validated.agentId);
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
        ListAgentsSchema.parse(args); // No params needed
        const result = await client.listAgents();
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
        const result = await client.searchAgents(
          validated.workspaceId,
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
        const result = await client.exportAgentTemplate(validated.agentId);
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
        const result = await client.importAgentTemplate(
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
        const result = await client.getAgentUsage(
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

      // ==================== CONVERSATION HANDLERS ====================

      case 'list_conversations': {
        const validated = ListConversationsSchema.parse(args);
        const result = await client.listConversations(
          validated.agentId,
          validated.page,
          validated.limit
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
        const result = await client.createConversation(
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
        const result = await client.getConversation(
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
        const result = await client.updateConversation(
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
        const result = await client.updateConversationMessages(agentId, convoId, payload);
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
        const result = await client.deleteConversation(
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
        const result = await client.exportAllConversations(
          validated.agentId,
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

      case 'export_conversation': {
        const validated = ExportConversationSchema.parse(args);
        const result = await client.exportConversation(
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
        const result = await client.assignConversation(
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

      // ==================== KNOWLEDGE BASE HANDLERS ====================

      case 'create_kb_doc': {
        const validated = CreateKBDocSchema.parse(args);
        const { agentId, ...kbData } = validated;
        const result = await client.createKBDoc(agentId, kbData);
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
        const result = await client.listKBDocs(
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
        const result = await client.getKBDoc(validated.agentId, validated.docId);
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
        const result = await client.updateKBDoc(agentId, docId, kbData);
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
        const result = await client.deleteKBDoc(validated.agentId, validated.docId);
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
        const result = await client.getKBStats(validated.agentId);
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
        const result = await client.scrapeUrl(validated.workspaceId, validated.url);
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify(result, null, 2),
            },
          ],
        };
      }

      // ==================== WIDGET CSS HANDLERS ====================

      case 'get_widget_css_styling_guide': {
        const validated = WidgetCssStylingGuideSchema.parse(args);
        let currentCSS: string | undefined;
        if (validated.agentId) {
          try {
            currentCSS = await client.getAgentCustomCSS(validated.agentId);
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
        const css = await client.getAgentCustomCSS(validated.agentId);
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
        const kb = await client.createKBDoc(agentId, {
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
        const result = await client.updateAgentCustomCSS(
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
        const result = await client.listVoiceProviders();
        return {
          content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
        };
      }

      case 'list_voice_models': {
        const validated = ListVoiceModelsSchema.parse(args);
        const result = await client.listVoiceModels(validated.provider);
        return {
          content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
        };
      }

      case 'search_voices': {
        const validated = SearchVoicesSchema.parse(args ?? {});
        const result = await client.searchVoices(validated);
        return {
          content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
        };
      }

      case 'list_provider_voices': {
        const validated = ListProviderVoicesSchema.parse(args);
        const { provider, ...filters } = validated;
        const result = await client.listProviderVoices(provider, filters);
        return {
          content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
        };
      }

      case 'get_voice': {
        const validated = GetVoiceSchema.parse(args);
        const result = await client.getVoice(validated.provider, validated.voiceId);
        return {
          content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
        };
      }

      case 'buy_twilio_number': {
        const validated = BuyTwilioNumberSchema.parse(args);
        const result = await client.buyTwilioNumber(
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
        const result = await client.importTwilioNumber(validated.payload);
        return {
          content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
        };
      }

      case 'release_twilio_number': {
        const validated = ReleaseTwilioNumberSchema.parse(args);
        const result = await client.releaseTwilioNumber(validated.payload);
        return {
          content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
        };
      }

      case 'check_twilio_number': {
        const validated = CheckTwilioNumberSchema.parse(args);
        const result = await client.checkTwilioNumber(validated.payload);
        return {
          content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
        };
      }

      case 'sync_sms_twilio_number': {
        const validated = SyncSmsTwilioNumberSchema.parse(args);
        const result = await client.syncSmsTwilioNumber(validated.payload);
        return {
          content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
        };
      }

      case 'interact_with_agent': {
        const validated = InteractWithAgentSchema.parse(args);
        const { timeoutMs, raw, bucket, ...rest } = validated;

        const request = {
          ...rest,
          bucket: bucket ?? client.getDefaultInteractBucket(),
        };

        const result = await client.interactWithAgent(request, { timeoutMs });

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
                    m.provider.toLowerCase().includes(filter),
                )
              : PRICING.models;
            payload = {
              creditConversion: PRICING.meta.creditConversion,
              models,
              filter: filter ?? null,
              count: models.length,
              notes: [
                'Prices are USD per 1,000,000 tokens (input / output).',
                'Each interaction also charges 1 base credit ($0.001) on top of token cost.',
                'BYOK customers pay providers directly — these are the platform-managed prices.',
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
    if (error instanceof z.ZodError) {
      throw new Error(`Invalid arguments: ${error.message}`);
    }
    throw error;
  }
});

// Start the server
async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error('ConvoCore MCP Server running on stdio');
}

main().catch((error) => {
  console.error('Fatal error in main():', error);
  process.exit(1);
});

