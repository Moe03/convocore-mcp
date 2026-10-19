// GENERATED — do not edit. Source: custom-vf-nextjs vg-docker/scripts/mcp-schemas/registry.ts (the main zod schemas).
// Regenerate with `pnpm sync:schemas`.
// Fields hidden from the compact schemas because they have no description in the zod source (30): disableAutoTranscribeAudio, kbTags, kbTagsDataMap, tabs, translateUserResponse, advanced, vgOptions, nodesSettings.geminiLiveOptions, nodesSettings.enableUIEngineInvoice, nodesSettings.enableUIEngineCalendarBooking, nodesSettings.uiEngineChannelConfig, nodesSettings.uiEngineAllowedTypes, nodesSettings.fallbackModelIds, nodesSettings.startCallPhrases, nodesSettings.smartEndpointing, vg_kb_llm.searchMethod, vg_kb_llm.searchPrompt, vg_kb_llm.modelId, vg_kb_llm.temprature, vg_kb_llm.maxTokens, ui.bgImageVisible, ui.widgetType, ui.enableFixedFeedbackBtns, ui.switchDashboardOnly, ui.voice, topicsConfig.version, topicsConfig.settings, topicsConfig.topics, topicsConfig.updatedAt, topicsConfig.lastDraftedAt

export const ZOD_SCHEMAS = {
 "agentAdvancedFields": {
  "type": "object",
  "properties": {
   "roundedImageURL": {
    "type": "string",
    "description": "URL pointing to the rounded image asset used to visually represent the agent."
   },
   "branding": {
    "type": "string",
    "description": "Custom branding information or labels associated with the agent."
   },
   "customThemeJSONString": {
    "type": "string",
    "description": "A JSON string defining a custom theme for the agent's interface."
   },
   "chatBgURL": {
    "type": "string",
    "description": "URL of the background image used in the chat interface."
   },
   "lang": {
    "type": "string",
    "description": "Specifies the default language for the agent's interactions and responses."
   },
   "fontFamily": {
    "type": "string",
    "description": "The font family used in the agent's user interface for consistent branding."
   },
   "rectangeImageURL": {
    "type": "string",
    "description": "URL pointing to the rectangular image asset for the agent's branding or display."
   },
   "avatarImageUrl": {
    "type": "string",
    "description": "URL of the avatar image representing the agent."
   },
   "headerImageUrl": {
    "type": "string",
    "description": "URL of the header image displayed in the chat interface."
   },
   "bannerImageUrl": {
    "type": "string",
    "description": "URL of the banner image used in the agent's branding."
   },
   "enableNodes": {
    "type": "boolean",
    "description": "Agent framework switch. true (default for new agents) = nodes/canvas runtime: use nodes, tools, and variables - ignore legacy vg_systemPrompt / vg_initPrompt / vg_prompt / vg_initMessages / vg_defaultModel / vg_temperature / vg_maxTokens for routing. false = classic single-prompt agent that still uses those vg_* Prompt-tab fields."
   },
   "nodesSettings": {
    "type": "object",
    "properties": {
     "enableUIEngineForms": {
      "type": "boolean",
      "description": "If true, the LLM will be able to show forms on web channel only."
     },
     "appendBeforePrompt": {
      "type": "string",
      "description": "The prompt to append to the nodes' prompt."
     },
     "routerLLmOptions": {
      "type": "object",
      "description": "Fields: modelId, temperature, maxTokens, serviceTier, reasoningEffort, customModelId, serverUrl, apiKey. Read the current value with get_agent to see their shapes; send only the fields to change."
     },
     "defaultLLmOptions": {
      "type": "object",
      "description": "Fields: modelId, temperature, maxTokens, serviceTier, reasoningEffort, customModelId, serverUrl, apiKey. Read the current value with get_agent to see their shapes; send only the fields to change."
     },
     "backchannelOnChoosingNodes": {
      "type": "boolean",
      "description": "If true, the LLM will say uha/i see before choosing a node."
     },
     "enableUiEngine": {
      "type": "boolean",
      "description": "If true, the LLM will be able to show buttons, cards, images on text channels only."
     },
     "silenceDetection": {
      "type": "object",
      "description": "Fields: enabled, timeoutSeconds, endCallAfterNPhrases. Read the current value with get_agent to see their shapes; send only the fields to change."
     },
     "fillerWordsOnToolUsage": {
      "type": "boolean",
      "description": "Voice channels only. If true, the agent speaks a filler phrase on tool usage, like '1 moment', 'be right back', etc. Ignored on chat/messaging/SMS channels."
     },
     "toolUsageBackchannelPhrasesByLanguage": {
      "type": "object",
      "additionalProperties": {
       "type": "array",
       "items": {
        "type": "string"
       }
      },
      "description": "Cached filler/tool-status phrases by language code, generated on save to avoid runtime translation latency."
     },
     "stopSpeakPlan": {
      "type": "object",
      "description": "Fields: minWords. Read the current value with get_agent to see their shapes; send only the fields to change."
     },
     "callTimeoutSeconds": {
      "type": "number",
      "description": "The timeout for the call in seconds."
     },
     "enableEndcallTool": {
      "type": "boolean",
      "description": "Whether to enable endcall tool."
     },
     "haikuToolOnlyRuntime": {
      "type": "boolean",
      "description": "UI Engine text sessions on Claude Haiku 5.5: run the lean tool-only runtime (all three must hold: model claude-haiku-5-5, this flag true, UI Engine text session). Read by call-service uiEngineToolsRuntime."
     },
     "voiceSpecific": {
      "type": "object",
      "description": "Fields: minCharacters, maxLengthWithoutPunctuation. Read the current value with get_agent to see their shapes; send only the fields to change."
     },
     "enabledGlobalTools": {
      "type": "array",
      "items": {
       "type": "string",
       "enum": [
        "handoffHumanDashboardTool"
       ]
      },
      "description": "The global tools that will be enabled for the LLM."
     },
     "defaultToolOverrides": {
      "type": "object",
      "description": "Partial overrides for built-in default system tools (forward-call, end-call, human-handoff, google-calendar, outlook-calendar, google-sheets, airtable, shopify, calendly, sms, web-control, web-search). Keyed by tool id from GET /tools/defaults (kind=assignable_system). Fields: forward-call, end-call, human-handoff, google-calendar, outlook-calendar, google-sheets, airtable, shopify, calendly, sms, web-control, web-search. Read the current value with get_agent to see their shapes; send only the fields to change."
     }
    },
    "additionalProperties": false,
    "description": "Global options for the nodes setup, text/voice."
   },
   "vg_systemPrompt": {
    "type": "string",
    "description": "LEGACY single-prompt only (enableNodes === false): system instructions for the classic Prompt-tab agent. Ignored when enableNodes is true - system behavior lives on nodes (and tools/variables), not these vg_* fields."
   },
   "vg_initPrompt": {
    "type": "string",
    "description": "LEGACY single-prompt only (enableNodes === false): opening/init user turn for the classic Prompt-tab agent. Ignored when enableNodes is true - new agents use nodes (start node), tools, and variables instead."
   },
   "vg_initMessages": {
    "type": "array",
    "items": {
     "type": "string"
    },
    "description": "LEGACY single-prompt only (enableNodes === false): seed messages for the classic conversation flow. Ignored when enableNodes is true - configure greetings on the start node instead."
   },
   "vg_prompt": {
    "type": "string",
    "description": "LEGACY single-prompt only (enableNodes === false): classic main prompt template. Ignored for nodes agents - use node instructions / tools / variables."
   },
   "vg_temperature": {
    "type": "number",
    "description": "LEGACY single-prompt only (enableNodes === false): LLM temperature for the classic agent. Nodes agents set model/temperature per node (or nodesSettings), not via this field."
   },
   "vg_defaultModel": {
    "type": "string",
    "description": "LEGACY single-prompt only (enableNodes === false): default LLM for the classic Prompt-tab agent. Nodes agents pick models on nodes / nodesSettings; new agents default to enableNodes=true and should not rely on this. One of 136 values (e.g. moonshotai/Kimi-K2-Instruct, moonshotai/Kimi-K3, moonshotai/Kimi-K2.6). Valid values: get_pricing_info section=models (chat models) / list_voice_models (voice) — or read the current value with get_agent."
   },
   "vg_maxTokens": {
    "type": "number",
    "description": "LEGACY single-prompt only (enableNodes === false): max tokens for the classic agent. Nodes agents configure token limits per node / nodesSettings instead."
   },
   "vg_max_messages_history": {
    "type": "number",
    "description": "Maximum number of messages retained in the chat history."
   },
   "vg_enableAboutContext": {
    "type": "boolean",
    "description": "Enables contextual information about the agent for users."
   },
   "ifKnowsThreshold": {
    "type": "number",
    "description": "Confidence threshold for determining if the agent 'knows' an answer."
   },
   "enableFallback": {
    "type": "boolean",
    "description": "Enable fallback for the agent llm model."
   },
   "fallbackSettings": {
    "type": "object",
    "properties": {
     "model": {
      "type": "string",
      "description": "The model to use for fallback. One of 136 values (e.g. moonshotai/Kimi-K2-Instruct, moonshotai/Kimi-K3, moonshotai/Kimi-K2.6). Valid values: get_pricing_info section=models (chat models) / list_voice_models (voice) — or read the current value with get_agent."
     },
     "creditThreshold": {
      "type": "number",
      "description": "The credit threshold for fallback."
     }
    },
    "additionalProperties": false,
    "description": "Fallback settings for the agent llm model."
   },
   "enableAudioSupport": {
    "type": "boolean",
    "description": "Enables audio features, allowing the agent to process and respond to audio inputs."
   },
   "captureIGStories": {
    "type": "boolean",
    "description": "Whether to capture instagram stories or not."
   },
   "metaHumanTakeover": {
    "type": "object",
    "properties": {
     "enabled": {
      "type": "boolean",
      "description": "Messenger / Instagram: when a person replies from Meta Business Suite or the Instagram / Facebook inbox, pause the AI on that conversation (same as Take over). Off by default."
     },
     "humanInactivityTimeoutMinutes": {
      "type": "number",
      "minimum": 0,
      "description": "Minutes without a human reply before the AI takes the conversation back. 0 = never, a person releases it in the dashboard."
     }
    },
    "additionalProperties": false,
    "description": "Pause the AI when a human replies to a Messenger / Instagram chat outside Convocore."
   },
   "vg_kb_llm": {
    "type": "object",
    "properties": {},
    "additionalProperties": false,
    "description": "Configuration for LLM-based knowledge base queries, including search methods and model parameters."
   },
   "vg_kbDefaultDimension": {
    "type": "number",
    "description": "Default dimensionality for the agent's knowledge base embeddings."
   },
   "vg_kbTopChunks": {
    "type": "number",
    "description": "The number of top chunks retrieved from the knowledge base during a query."
   },
   "vg_kbCharCount": {
    "type": "number",
    "description": "Tracks the total character count of the agent's knowledge base."
   },
   "vg_kbDocsNum": {
    "type": "number",
    "description": "The total number of documents stored in the agent's knowledge base."
   },
   "proactiveMessage": {
    "type": "string",
    "description": "A predefined message the agent sends proactively to engage users."
   },
   "autoStartWidget": {
    "type": "boolean",
    "description": "Determines if the widget should auto-start upon page load."
   },
   "messageDelayMS": {
    "type": "number",
    "description": "Specifies the delay in milliseconds for the agent to send messages, simulating natural conversation timing."
   },
   "scrollAnimation": {
    "type": "boolean",
    "description": "Indicates whether scroll animations are enabled for smooth transitions in the chat interface."
   },
   "disableSmoothScroll": {
    "type": "boolean",
    "description": "Disables smooth scrolling if set to true, potentially improving performance on low-end devices."
   },
   "buttonsLayout": {
    "type": "string",
    "enum": [
     "horizontal",
     "vertical",
     "in-footer"
    ],
    "description": "Defines the layout and style of buttons in the agent's interface."
   },
   "buttonVariant": {
    "type": "string",
    "enum": [
     "custom",
     "solid",
     "bordered",
     "light",
     "flat",
     "faded",
     "shadow",
     "ghost"
    ],
    "description": "The variant of the button. Custom is the default original styling."
   },
   "inputVariant": {
    "type": "string",
    "enum": [
     "custom",
     "flat",
     "bordered",
     "faded",
     "underlined"
    ],
    "description": "Chat footer input variant. Default when unset: flat."
   },
   "ui": {
    "type": "object",
    "properties": {
     "showWhatsappButtonOnWeb": {
      "type": "boolean",
      "description": "Show little whatsapp button on web if it's connected."
     },
     "switchConversationSides": {
      "type": "boolean",
      "description": "Right-to-left layout: swaps the sides of the chat (user/agent bubbles) for RTL languages such as Arabic."
     },
     "disableMessageMotion": {
      "type": "boolean",
      "description": "When true, disables framer enter/exit animation on chat messages."
     },
     "showRuntimeSteps": {
      "type": "boolean",
      "description": "When true, show thinking / tool / debug steps to end users (not only in tester)."
     },
     "streamSpeed": {
      "type": "number",
      "minimum": 1,
      "maximum": 10,
      "description": "How fast bot text streams in the widget (1 slow … 10 fast). Applies to all turns."
     }
    },
    "additionalProperties": false
   },
   "ADVANCED_customCSS": {
    "type": "string",
    "description": "Specifies advanced custom CSS for overriding the default styling of the agent's interface."
   },
   "disableRating": {
    "type": "boolean",
    "description": "Whether to disable the chat end rating feature."
   },
   "chatEndMessage": {
    "type": "string",
    "description": "The message to show when the chat ends."
   },
   "aiIntroductionMessage": {
    "type": "string",
    "description": "The message to show when the user starts the chat on metachannels."
   },
   "enableAIIntroductionMessage": {
    "type": "boolean",
    "description": "Whether to enable the AI introduction message or not."
   },
   "privacyDisclaimer": {
    "type": "object",
    "properties": {
     "enabled": {
      "type": "boolean",
      "description": "Whether to show privacy disclaimer before user interaction"
     },
     "text": {
      "type": "string",
      "description": "The privacy disclaimer text to display to users"
     },
     "privacyPolicyUrl": {
      "type": "string",
      "description": "URL to the privacy policy page"
     },
     "acceptButtonLabel": {
      "type": "string",
      "description": "Label for the accept/proceed button"
     },
     "privacyPolicyButtonLabel": {
      "type": "string",
      "description": "Label for the privacy policy link button"
     }
    },
    "additionalProperties": false,
    "description": "Privacy disclaimer configuration for the agent"
   },
   "gdprCompliance": {
    "type": "boolean",
    "description": "Deprecated and ignored."
   },
   "disableModelAutoUpgrade": {
    "type": "boolean",
    "description": "When true, the runtime keeps the exact selected LLM instead of auto-replacing deprecated models."
   },
   "acceptFileUpload": {
    "type": "boolean",
    "description": "Determines if the agent accepts file uploads from users as part of the interaction."
   },
   "disableFileUpload": {
    "type": "boolean",
    "description": "Hide the file-upload button in the chat widget."
   },
   "enableQuickFileUpload": {
    "type": "boolean",
    "description": "Allows quick file uploads during chat interactions."
   },
   "soundEffectUrl": {
    "type": "string",
    "description": "URL of the sound effect file used for agent interactions."
   },
   "soundEffectEnabled": {
    "type": "boolean",
    "description": "Enables or disables sound effects for the agent."
   },
   "agentPlatform": {
    "type": "string",
    "description": "Specifies the platform on which the agent operates, such as web, mobile, or other environments."
   },
   "AITranslateTo": {
    "type": "string",
    "description": "Defines the target language for AI translation during interactions."
   },
   "enableAITranslate": {
    "type": "boolean",
    "description": "Activates AI-based translation for multilingual support."
   },
   "disableHumanHandoff": {
    "type": "boolean",
    "description": "Prevents the agent from escalating interactions to a human operator."
   },
   "alwaysShowHandoff": {
    "type": "boolean",
    "description": "Ensures the handoff option is always visible, regardless of agent status."
   },
   "manualControl": {
    "type": "boolean",
    "description": "Allows manual control over specific agent functionalities."
   },
   "enableVGHandoff": {
    "type": "boolean",
    "description": "Activates VG-specific handoff mechanisms for the agent."
   },
   "fixedHandoffPopup": {
    "type": "boolean",
    "description": "Ensures the handoff popup remains fixed in the interface."
   },
   "UIhandoffTitle": {
    "type": "string",
    "description": "Title displayed during UI handoff interactions."
   },
   "UIhandoffSubtitle": {
    "type": "string",
    "description": "Subtitle displayed during UI handoff interactions."
   },
   "showHandoffEvenIfOffline": {
    "type": "boolean",
    "description": "Displays the handoff option even if the agent is offline."
   },
   "persistHandoffOnRefresh": {
    "type": "boolean",
    "description": "Maintains handoff state when users refresh or close their browser tabs."
   },
   "blockInputDuringHandoffRequest": {
    "type": "boolean",
    "description": "Blocks chat input when a user requests human handoff but no human has been assigned yet. Only applies to VF agents."
   },
   "disableHandoffMessages": {
    "type": "boolean",
    "description": "When enabled, the system will not send automatic messages when handoff occurs (e.g., 'Now chatting with John')."
   },
   "handoffNowChattingMessage": {
    "type": "string",
    "description": "Custom green takeover notice. Use {name} for the human agent. When set, this text is used as-is (no auto-translate)."
   },
   "handoffBackToAiMessage": {
    "type": "string",
    "description": "Custom notice sent when a human passes the chat back to the AI. Use {name} for the agent title. When set, this text is used as-is (no auto-translate)."
   },
   "handoffCancelButtonLabel": {
    "type": "string",
    "description": "Custom label for the widget's 'Cancel Handoff Request' button. When set, this text is used as-is (no auto-translate)."
   },
   "disableHandoffStatusMessages": {
    "type": "boolean",
    "description": "When enabled, the system will not send status messages during handoff transitions (e.g., 'We are connecting you to a human', 'Handoff cancelled', 'No agent was available')."
   },
   "convoTags": {
    "type": "array",
    "items": {
     "type": "string"
    },
    "description": "Tags that can be applied to this agent's conversations (shown as filters / labels in Conversations)."
   },
   "topicsConfig": {
    "type": "object",
    "properties": {},
    "required": [
     "settings",
     "topics"
    ],
    "additionalProperties": false,
    "description": "Nested topic map for analytics: topics array (id, label, description, parentId, position) plus settings (enabled, classifierVersion)."
   },
   "starred": {
    "type": "boolean",
    "description": "Mark the agent as a favourite (starred) in the dashboard agent list."
   },
   "enableGeoAnalytics": {
    "type": "boolean",
    "description": "Enables geographic analytics to track user interactions based on location."
   },
   "hideVoiceflowAnalytics": {
    "type": "boolean",
    "description": "Hides Voiceflow-specific analytics including intents, conversation flow metrics, and rating analytics."
   },
   "hideCallAnalytics": {
    "type": "boolean",
    "description": "Hides voice call analytics including duration, latency, cost breakdown, call counts, and call end reasons."
   },
   "hideConversationMetrics": {
    "type": "boolean",
    "description": "Hides conversation metrics including user retention, conversation length, time retention, and engagement metrics."
   },
   "hideCustomAnalytics": {
    "type": "boolean",
    "description": "Hides user-created custom charts and metrics from the analytics dashboard."
   },
   "hideVapiAnalytics": {
    "type": "boolean",
    "description": "Hides VAPI-specific analytics including cost tracking and voice-related metrics."
   },
   "hideFunnelAnalytics": {
    "type": "boolean",
    "description": "Hides the user engagement funnel chart that tracks progression from widget views to high engagement."
   },
   "marketplace": {
    "type": "object",
    "properties": {
     "enabled": {
      "type": "boolean",
      "description": "Whether to show the agent in marketplace or not."
     },
     "priceUSD": {
      "type": "number",
      "description": "The price for the agent, default is 0/free"
     },
     "category": {
      "type": "string",
      "enum": [
       "Customer Support",
       "Sales & Marketing",
       "Productivity",
       "Education",
       "Entertainment",
       "Other"
      ],
      "description": "Category of the agent"
     },
     "creatorDisplayName": {
      "type": "string",
      "description": "Custom display name for the creator in the marketplace"
     },
     "shortDescription": {
      "type": "string",
      "maxLength": 200,
      "description": "Short tagline/description shown in listing cards (max 200 chars)"
     },
     "documentation": {
      "type": "string",
      "description": "Full markdown documentation explaining the agent"
     },
     "toolsDocumentation": {
      "type": "array",
      "items": {
       "type": "object",
       "description": "Fields: name, description, codeUrl, docsUrl, setupInstructions. Read the current value with get_agent to see their shapes; send only the fields to change."
      },
      "description": "Documentation for tools included with the agent"
     },
     "tags": {
      "type": "array",
      "items": {
       "type": "string"
      },
      "description": "Tags for discoverability"
     },
     "screenshots": {
      "type": "array",
      "items": {
       "type": "string"
      },
      "description": "Array of screenshot URLs"
     },
     "demoUrl": {
      "type": "string",
      "description": "Link to live demo"
     },
     "videoUrl": {
      "type": "string",
      "description": "Link to demo/tutorial video"
     },
     "version": {
      "type": "string",
      "description": "Version of the agent listing"
     },
     "changelog": {
      "type": "string",
      "description": "Changelog/update history"
     },
     "supportEmail": {
      "type": "string",
      "description": "Support contact email"
     },
     "listedAt": {
      "type": "number",
      "description": "Unix timestamp when first listed"
     },
     "updatedAt": {
      "type": "number",
      "description": "Unix timestamp of last update"
     },
     "allowCanvasPreview": {
      "type": "boolean",
      "description": "Whether to allow users to preview the agent canvas/workflow"
     },
     "allowTryAgent": {
      "type": "boolean",
      "default": true,
      "description": "Whether to allow users to try the agent widget"
     },
     "likeCount": {
      "type": "number",
      "default": 0,
      "description": "Total number of likes for this agent"
     },
     "downloadCount": {
      "type": "number",
      "default": 0,
      "description": "Total number of downloads/installs for this agent"
     }
    },
    "additionalProperties": false,
    "description": "Marketplace settings for the agent."
   },
   "autoTest": {
    "type": "object",
    "properties": {
     "enabled": {
      "type": "boolean",
      "description": "Whether auto-testing is enabled for this agent"
     },
     "triggerOnEdit": {
      "type": "boolean",
      "description": "Automatically run tests after agent edits"
     },
     "testMode": {
      "type": "string",
      "enum": [
       "full",
       "prompt-only",
       "with-tools",
       "with-kb",
       "tools-only",
       "kb-only"
      ],
      "description": "Test mode configuration"
     },
     "maxTurns": {
      "type": "number",
      "description": "Maximum number of conversation turns (undefined = natural end)"
     },
     "naturalEnd": {
      "type": "boolean",
      "description": "Allow AI to naturally end the conversation"
     },
     "testScenario": {
      "type": "string",
      "description": "Default test scenario/context for auto-tests"
     },
     "enabledToolIds": {
      "type": "array",
      "items": {
       "type": "string"
      },
      "description": "Specific tool IDs to include in tests"
     },
     "enableKB": {
      "type": "boolean",
      "description": "Whether to test knowledge base"
     }
    },
    "additionalProperties": false,
    "description": "Auto-test configuration for automatic testing after agent edits"
   },
   "customButtonJSON_STRING": {
    "type": "string",
    "description": "JSON string defining custom buttons for the agent's interface."
   }
  },
  "additionalProperties": false
 },
 "clientWrite": {
  "type": "object",
  "properties": {
   "name": {
    "type": "string",
    "description": "The name of the client"
   },
   "email": {
    "type": "string",
    "description": "The email of the client which will be used by them to sign in also can be used in your whitelabel dashboard to autofill by appending ?email=test@gmail."
   },
   "squarePhotoURL": {
    "type": "string",
    "description": "Photo URL of the client, will show on their dashboard."
   },
   "widgetIDs": {
    "type": "array",
    "items": {
     "type": "string"
    },
    "description": "The IDs of agents assigned to this client."
   },
   "dashboardUsername": {
    "type": "string",
    "description": "The username of the dashboard (DEPRACATED NOT USED)"
   },
   "dashboardPassword": {
    "type": "string",
    "description": "The sign in dashboard for the client, used along the email to sign in to the whitelabel dashboard append ?password=123 to autofill the fields on the dashboard login."
   },
   "canAccess": {
    "type": "array",
    "items": {
     "type": "string"
    },
    "description": "The tabs hrefs the user can access, example ['/home', '/convos', '/leads', '/kb', '/analytics', '/theme', '/settings', '/prompt'] "
   },
   "allowedChannels": {
    "type": "array",
    "items": {
     "type": "string"
    },
    "description": "Channels this client can use on the channels page. Use [\"all\"] or omit for every channel."
   },
   "allowedIntegrations": {
    "type": "array",
    "items": {
     "type": "string"
    },
    "description": "Integrations this client can use on the integrations page. Use [\"all\"] or omit for every integration."
   },
   "clientTabOrder": {
    "type": "array",
    "items": {
     "type": "string"
    },
    "description": "The order of the client tabs, example ['home', 'convos', 'leads', 'kb', 'analytics', 'theme', 'settings', 'prompt'] "
   },
   "isAdmin": {
    "type": "boolean",
    "description": "Whether the client is an org admin or not allowing him to create other users on his org and have more access in the dashboard."
   },
   "orgId": {
    "type": "string",
    "description": "The ID of the org this user belongs to, must be defined when creating a client."
   },
   "type": {
    "type": "string",
    "enum": [
     "client",
     "org"
    ],
    "description": "The type of the client (DEPARACTED)"
   },
   "isOrgAdmin": {
    "type": "boolean",
    "description": "Whether the client is an organization admin or not allowing him to create other users on his org and have more access in the dashboard"
   },
   "canDelegateChats": {
    "type": "boolean",
    "description": "Whether the client can delegate chats to other users in the org."
   },
   "status": {
    "type": "string",
    "enum": [
     "online",
     "offline"
    ],
    "description": "Shows on the dashboard and in the web widget whether this client is online of offline for realtime handoff."
   },
   "predefinedTags": {
    "type": "array",
    "items": {
     "type": "string"
    },
    "description": "Predefined tags for the client, used in the chats tab quickly tag any chat with them."
   },
   "forcedConvoTags": {
    "type": "array",
    "items": {
     "type": "string"
    },
    "description": "If set, this client user can ONLY see conversations AND leads that contain at least one of these tags. Tag filter is locked on Chats and Leads and cannot be changed by the user."
   },
   "notificationsSettings": {
    "type": "object",
    "properties": {
     "notifyThrough": {
      "type": "string",
      "enum": [
       "email",
       "push",
       "all",
       "none"
      ],
      "description": "The notification through"
     },
     "notifyIf": {
      "type": "string",
      "enum": [
       "all",
       "requestsOnly",
       "none"
      ],
      "description": "The notification if"
     },
     "emailNotifyOnNewLead": {
      "type": "boolean",
      "description": "Whether the client wants to receive email notifications on capturing any new leads from calls."
     }
    },
    "required": [
     "notifyThrough",
     "notifyIf"
    ],
    "additionalProperties": false,
    "description": "The notifications settings of the client, by default the client will only receive email notifications for requests."
   },
   "handoff": {
    "type": "object",
    "properties": {
     "maxAssignees": {
      "type": "number",
      "description": "The maximum number of assignees for handoff"
     }
    },
    "additionalProperties": false,
    "description": "Human handoff settings for this client."
   },
   "preferredLanguage": {
    "type": "string",
    "description": "The preferred language of the client and based on it whole whitelabel dashboard will be translated, MUST BE 2 letter language code"
   },
   "cannedResponses": {
    "type": "array",
    "items": {
     "type": "object",
     "properties": {
      "key": {
       "type": "string",
       "description": "The key of the canned response"
      },
      "content": {
       "type": "string",
       "description": "The content of the canned response"
      }
     },
     "additionalProperties": false
    },
    "description": "The canned responses of the client used in the chats tab "
   },
   "allowCreateAgents": {
    "type": "boolean",
    "description": "Whether the client can create agents"
   },
   "hideAdvancedSettings": {
    "type": "boolean",
    "description": "Whether the client can hide the advanced settings"
   }
  },
  "additionalProperties": false
 },
 "orgWrite": {
  "type": "object",
  "properties": {
   "name": {
    "type": "string",
    "description": "The name of the client"
   },
   "email": {
    "type": "string",
    "description": "The email of the client which will be used by them to sign in also can be used in your whitelabel dashboard to autofill by appending ?email=test@gmail."
   },
   "squarePhotoURL": {
    "type": "string",
    "description": "Photo URL of the client, will show on their dashboard."
   },
   "widgetIDs": {
    "type": "array",
    "items": {
     "type": "string"
    },
    "description": "The IDs of agents assigned to this client."
   },
   "dashboardUsername": {
    "type": "string",
    "description": "The username of the dashboard (DEPRACATED NOT USED)"
   },
   "dashboardPassword": {
    "type": "string",
    "description": "The sign in dashboard for the client, used along the email to sign in to the whitelabel dashboard append ?password=123 to autofill the fields on the dashboard login."
   },
   "canAccess": {
    "type": "array",
    "items": {
     "type": "string"
    },
    "description": "The tabs hrefs the user can access, example ['/home', '/convos', '/leads', '/kb', '/analytics', '/theme', '/settings', '/prompt'] "
   },
   "allowedChannels": {
    "type": "array",
    "items": {
     "type": "string"
    },
    "description": "Channels this client can use on the channels page. Use [\"all\"] or omit for every channel."
   },
   "allowedIntegrations": {
    "type": "array",
    "items": {
     "type": "string"
    },
    "description": "Integrations this client can use on the integrations page. Use [\"all\"] or omit for every integration."
   },
   "clientTabOrder": {
    "type": "array",
    "items": {
     "type": "string"
    },
    "description": "The order of the client tabs, example ['home', 'convos', 'leads', 'kb', 'analytics', 'theme', 'settings', 'prompt'] "
   },
   "isAdmin": {
    "type": "boolean",
    "description": "Whether the client is an org admin or not allowing him to create other users on his org and have more access in the dashboard."
   },
   "orgId": {
    "type": "string",
    "description": "The ID of the org this user belongs to, must be defined when creating a client."
   },
   "isOrgAdmin": {
    "type": "boolean",
    "description": "Whether the client is an organization admin or not allowing him to create other users on his org and have more access in the dashboard"
   },
   "canDelegateChats": {
    "type": "boolean",
    "description": "Whether the client can delegate chats to other users in the org."
   },
   "status": {
    "type": "string",
    "enum": [
     "online",
     "offline"
    ],
    "description": "Shows on the dashboard and in the web widget whether this client is online of offline for realtime handoff."
   },
   "predefinedTags": {
    "type": "array",
    "items": {
     "type": "string"
    },
    "description": "Predefined tags for the client, used in the chats tab quickly tag any chat with them."
   },
   "forcedConvoTags": {
    "type": "array",
    "items": {
     "type": "string"
    },
    "description": "If set, this client user can ONLY see conversations AND leads that contain at least one of these tags. Tag filter is locked on Chats and Leads and cannot be changed by the user."
   },
   "notificationsSettings": {
    "type": "object",
    "properties": {
     "notifyThrough": {
      "type": "string",
      "enum": [
       "email",
       "push",
       "all",
       "none"
      ],
      "description": "The notification through"
     },
     "notifyIf": {
      "type": "string",
      "enum": [
       "all",
       "requestsOnly",
       "none"
      ],
      "description": "The notification if"
     },
     "emailNotifyOnNewLead": {
      "type": "boolean",
      "description": "Whether the client wants to receive email notifications on capturing any new leads from calls."
     }
    },
    "required": [
     "notifyThrough",
     "notifyIf"
    ],
    "additionalProperties": false,
    "description": "The notifications settings of the client, by default the client will only receive email notifications for requests."
   },
   "handoff": {
    "type": "object",
    "properties": {
     "maxAssignees": {
      "type": "number",
      "description": "The maximum number of assignees for handoff"
     }
    },
    "additionalProperties": false,
    "description": "Human handoff settings for this client."
   },
   "preferredLanguage": {
    "type": "string",
    "description": "The preferred language of the client and based on it whole whitelabel dashboard will be translated, MUST BE 2 letter language code"
   },
   "cannedResponses": {
    "type": "array",
    "items": {
     "type": "object",
     "properties": {
      "key": {
       "type": "string",
       "description": "The key of the canned response"
      },
      "content": {
       "type": "string",
       "description": "The content of the canned response"
      }
     },
     "additionalProperties": false
    },
    "description": "The canned responses of the client used in the chats tab "
   },
   "allowCreateAgents": {
    "type": "boolean",
    "description": "Whether the client can create agents"
   },
   "hideAdvancedSettings": {
    "type": "boolean",
    "description": "Whether the client can hide the advanced settings"
   },
   "adminIDs": {
    "type": "array",
    "items": {
     "type": "string"
    },
    "description": "Client ids that are admins of this org (can manage its members and settings)."
   },
   "supportIDs": {
    "type": "array",
    "items": {
     "type": "string"
    },
    "description": "Client ids that act as support staff for this org (handle handoffs / chats)."
   },
   "canSelfEdit": {
    "type": "boolean",
    "description": "Org admins may edit the org's own settings from the client portal."
   },
   "defaultClientAccess": {
    "type": "array",
    "items": {
     "type": "string"
    },
    "description": "Portal tabs new clients in this org get, e.g. [\"/home\", \"/convos\", \"/leads\", \"/analytics\"]."
   },
   "defaultClientTabOrder": {
    "type": "array",
    "items": {
     "type": "string"
    },
    "description": "Order of the portal tabs for new clients in this org."
   },
   "convoTags": {
    "type": "array",
    "items": {
     "type": "string"
    },
    "description": "Conversation tags available to this org's members."
   },
   "enableHumanHandoff": {
    "type": "boolean",
    "description": "Allow this org's members to take over conversations from the agent (human handoff)."
   },
   "dashboardLayout": {
    "type": "string",
    "enum": [
     "vertical",
     "horizontal"
    ],
    "description": "Client portal navigation layout: vertical (sidebar) or horizontal (top bar)."
   },
   "settings": {
    "type": "object",
    "properties": {
     "disableClientAccess": {
      "type": "boolean",
      "description": "Temporarily block every client of this org from logging in."
     }
    },
    "additionalProperties": true,
    "description": "Org-level portal settings."
   }
  },
  "additionalProperties": true
 },
 "agencyBrandingPatch": {
  "type": "object",
  "properties": {
   "name": {
    "type": "string",
    "minLength": 1,
    "maxLength": 80,
    "description": "Agency / portal name shown to clients (tab title, login page)."
   },
   "logoUrl": {
    "type": "string",
    "maxLength": 2048,
    "format": "uri",
    "description": "Main logo, shown as a round avatar on the login page and portal (https; stored as squarePhotoURL)."
   },
   "darkLogoUrl": {
    "type": "string",
    "maxLength": 2048,
    "format": "uri",
    "description": "Logo used in dark mode (stored as darkModeSquarePhotourl)."
   },
   "wideLogoUrl": {
    "type": "string",
    "maxLength": 2048,
    "format": "uri",
    "description": "Wide logo lockup for places a round avatar would crop it, e.g. loginPage.logo=wide (stored as wideLogoURL)."
   },
   "wideLogoDarkUrl": {
    "type": "string",
    "maxLength": 2048,
    "format": "uri",
    "description": "Wide logo for dark mode (stored as wideLogoDarkURL)."
   },
   "faviconUrl": {
    "type": "string",
    "maxLength": 2048,
    "format": "uri",
    "description": "Browser tab icon, png/ico/svg (stored as faviconURL)."
   },
   "brandingText": {
    "type": "string",
    "maxLength": 2000,
    "description": "Markdown text shown on the login page under the logo (tagline / short pitch)."
   },
   "primaryColorHex": {
    "type": "string",
    "pattern": "^#[0-9a-fA-F]{6}$",
    "description": "Brand colour #RRGGBB. The portal builds its whole colour palette from it (merged into customThemeJSONString.primary)."
   },
   "themeType": {
    "type": "string",
    "enum": [
     "light",
     "dark"
    ],
    "description": "Default portal theme (customThemeJSONString.themeType)."
   },
   "themeVariant": {
    "type": "string",
    "enum": [
     "default",
     "bordered",
     "flat",
     "faded"
    ],
    "description": "Component style of the portal UI."
   },
   "themeColorUsage": {
    "type": "string",
    "enum": [
     "gradient",
     "colorful",
     "plain"
    ],
    "description": "How strongly the brand colour is used: gradient, colorful or plain."
   },
   "googleFontStack": {
    "type": "array",
    "items": {
     "type": "string",
     "minLength": 1,
     "maxLength": 64,
     "pattern": "^[A-Za-z0-9 ]+$"
    },
    "minItems": 1,
    "maxItems": 4,
    "description": "Google Fonts families in fallback order, e.g. [\"Rubik\",\"Almarai\"] = Rubik for Latin and digits, Almarai for Arabic glyphs. The first is also saved as googleFont for older renderers."
   },
   "googleFontWeights": {
    "type": "array",
    "items": {
     "type": "integer",
     "minimum": 100,
     "maximum": 900
    },
    "minItems": 1,
    "maxItems": 9,
    "description": "Font weights to load (default [400,500,700])."
   },
   "customCSS": {
    "type": "string",
    "maxLength": 100000,
    "description": "Extra CSS applied to the whole client portal."
   },
   "defaultLanguage": {
    "type": "string",
    "minLength": 2,
    "maxLength": 10,
    "description": "Default portal language code, e.g. \"ar\", \"en\", \"fr\". RTL languages (ar, he, fa, ur) also switch the portal to right-to-left (settings.clientOnboarding.defaultPreferredLanguage)."
   },
   "allowedLanguages": {
    "type": "array",
    "items": {
     "type": "string",
     "minLength": 2,
     "maxLength": 10
    },
    "maxItems": 50,
    "description": "Language codes clients may switch to (settings.clientOnboarding.allowedLanguages)."
   },
   "mainWebsite": {
    "type": "string",
    "maxLength": 2048,
    "format": "uri",
    "description": "Agency website linked from the portal."
   },
   "supportEmail": {
    "type": "string",
    "format": "email",
    "description": "Support email shown to clients."
   },
   "tosPage": {
    "type": "string",
    "maxLength": 2048,
    "format": "uri",
    "description": "Terms of service URL."
   },
   "privacyPolicyPage": {
    "type": "string",
    "maxLength": 2048,
    "format": "uri",
    "description": "Privacy policy URL (stored as privacyPolicypPage)."
   },
   "enableClientSignup": {
    "type": "boolean",
    "description": "Let new clients sign up themselves from the login page (settings.enableClientSignup)."
   },
   "disablePasswordLogin": {
    "type": "boolean",
    "description": "Hide email+password login so clients use the other sign-in methods only (settings.disablePasswordLogin)."
   }
  },
  "additionalProperties": false
 },
 "agencyLoginPagePatch": {
  "type": "object",
  "properties": {
   "layout": {
    "type": "string",
    "enum": [
     "centered",
     "split"
    ],
    "description": "centered (default): form in the middle. split: form on one half, media on the other."
   },
   "mediaSide": {
    "type": "string",
    "enum": [
     "start",
     "end"
    ],
    "description": "Split layout: which side the media is on, logically. start (default) = left in LTR, right in RTL; end = the opposite (Arabic portal with media on the left = end)."
   },
   "mediaUrl": {
    "type": "string",
    "maxLength": 2048,
    "format": "uri",
    "description": "Split layout image/illustration (https, e.g. from upload_asset kind=login_media). Without it, split shows a gradient from the primary colour."
   },
   "mediaFit": {
    "type": "string",
    "enum": [
     "cover",
     "contain"
    ],
    "description": "How the media fills its half: cover (default, cropped to fill) or contain (whole image visible)."
   },
   "headline": {
    "type": "string",
    "maxLength": 120,
    "description": "Big text on the media side (max 120 chars)."
   },
   "subtext": {
    "type": "string",
    "maxLength": 300,
    "description": "Smaller text under the headline (max 300 chars)."
   },
   "textPlacement": {
    "type": "string",
    "enum": [
     "overlay",
     "below"
    ],
    "description": "Headline/subtext on top of the media (overlay, default) or under it (below)."
   },
   "background": {
    "type": "object",
    "properties": {
     "type": {
      "type": "string",
      "enum": [
       "theme",
       "color",
       "gradient",
       "image"
      ],
      "description": "theme (default) = portal theme background; color = solid; gradient = from→to at angle; image = imageUrl."
     },
     "color": {
      "type": "string",
      "pattern": "^#[0-9a-fA-F]{6}$",
      "description": "type=color: #RRGGBB."
     },
     "from": {
      "type": "string",
      "pattern": "^#[0-9a-fA-F]{6}$",
      "description": "type=gradient: start colour #RRGGBB."
     },
     "to": {
      "type": "string",
      "pattern": "^#[0-9a-fA-F]{6}$",
      "description": "type=gradient: end colour #RRGGBB."
     },
     "angle": {
      "type": "number",
      "minimum": 0,
      "maximum": 360,
      "description": "type=gradient: angle in degrees 0-360."
     },
     "imageUrl": {
      "type": "string",
      "maxLength": 2048,
      "format": "uri",
      "description": "type=image: https URL (e.g. upload_asset kind=login_background)."
     }
    },
    "required": [
     "type"
    ],
    "additionalProperties": false,
    "description": "Page background behind the login card."
   },
   "card": {
    "type": "object",
    "properties": {
     "style": {
      "type": "string",
      "enum": [
       "elevated",
       "bordered",
       "flat",
       "glass"
      ],
      "description": "Login card look: elevated (default, shadow), bordered, flat, glass (translucent)."
     },
     "radius": {
      "type": "string",
      "enum": [
       "sm",
       "md",
       "lg"
      ],
      "description": "Corner radius (default lg)."
     }
    },
    "required": [
     "style"
    ],
    "additionalProperties": false,
    "description": "The card that holds the login form."
   },
   "mobileMedia": {
    "type": "string",
    "enum": [
     "stack",
     "hide"
    ],
    "description": "On phones: stack (default) shows the media above the form; hide removes it."
   },
   "logo": {
    "type": "string",
    "enum": [
     "square",
     "wide",
     "none"
    ],
    "description": "Logo above the form: square (default, round avatar from logoUrl), wide (wideLogoUrl lockup) or none."
   }
  },
  "additionalProperties": false
 },
 "integration.google_calendar.assign": {
  "type": "object",
  "properties": {
   "connectionId": {
    "type": "string",
    "minLength": 1,
    "description": "Connection id from integrations_read all_connections."
   },
   "calendarId": {
    "type": "string",
    "minLength": 1,
    "description": "Calendar id from integrations_read resources (e.g. the account email for a primary Google calendar)."
   },
   "calendarName": {
    "type": "string",
    "maxLength": 200,
    "description": "Calendar display name; also the default label the agent uses to pick it."
   },
   "timezone": {
    "type": "string",
    "maxLength": 64,
    "description": "Calendar owner timezone, IANA (\"Europe/London\") or \"GMT+1\" (default GMT+0)."
   },
   "label": {
    "type": "string",
    "maxLength": 100,
    "description": "Name the agent uses to pick this calendar when several are configured (unique per agent)."
   },
   "description": {
    "type": "string",
    "maxLength": 500,
    "description": "When the agent should use this calendar, e.g. \"in-person consultations\"."
   },
   "methods": {
    "type": "array",
    "items": {
     "type": "string",
     "enum": [
      "create-event",
      "check-availability",
      "lookup-events",
      "update-event",
      "delete-event"
     ]
    },
    "minItems": 1,
    "description": "Calendar actions the agent may use (default: all five)."
   },
   "bookingMode": {
    "type": "string",
    "enum": [
     "route",
     "union"
    ],
    "description": "route = the caller books one specific calendar; union = book into any calendar that is free."
   },
   "defaultCallerTimezone": {
    "type": "string",
    "maxLength": 64,
    "description": "Caller timezone: \"\" = same as the calendar, \"ask\" = ask each caller, or a timezone."
   },
   "configId": {
    "type": "string",
    "description": "Update this existing calendar row instead of matching by connection + calendar."
   },
   "disableMeetLink": {
    "type": "boolean",
    "description": "true = in-person appointments: booked events get no Google Meet link."
   }
  },
  "required": [
   "connectionId",
   "calendarId"
  ],
  "additionalProperties": false,
  "description": "Add or update one Google calendar on the agent (up to 5)."
 },
 "integration.google_calendar.remove": {
  "type": "object",
  "properties": {
   "configId": {
    "type": "string",
    "description": "Remove only this calendar row."
   },
   "calendarId": {
    "type": "string",
    "description": "Remove only this calendar."
   }
  },
  "additionalProperties": false,
  "description": "Remove one calendar, or all of them when empty."
 },
 "integration.outlook_calendar.assign": {
  "type": "object",
  "properties": {
   "connectionId": {
    "type": "string",
    "minLength": 1,
    "description": "Connection id from integrations_read all_connections."
   },
   "calendarId": {
    "type": "string",
    "minLength": 1,
    "description": "Calendar id from integrations_read resources (e.g. the account email for a primary Google calendar)."
   },
   "calendarName": {
    "type": "string",
    "maxLength": 200,
    "description": "Calendar display name; also the default label the agent uses to pick it."
   },
   "timezone": {
    "type": "string",
    "maxLength": 64,
    "description": "Calendar owner timezone, IANA (\"Europe/London\") or \"GMT+1\" (default GMT+0)."
   },
   "label": {
    "type": "string",
    "maxLength": 100,
    "description": "Name the agent uses to pick this calendar when several are configured (unique per agent)."
   },
   "description": {
    "type": "string",
    "maxLength": 500,
    "description": "When the agent should use this calendar, e.g. \"in-person consultations\"."
   },
   "methods": {
    "type": "array",
    "items": {
     "type": "string",
     "enum": [
      "create-event",
      "check-availability",
      "lookup-events",
      "update-event",
      "delete-event"
     ]
    },
    "minItems": 1,
    "description": "Calendar actions the agent may use (default: all five)."
   },
   "bookingMode": {
    "type": "string",
    "enum": [
     "route",
     "union"
    ],
    "description": "route = the caller books one specific calendar; union = book into any calendar that is free."
   },
   "defaultCallerTimezone": {
    "type": "string",
    "maxLength": 64,
    "description": "Caller timezone: \"\" = same as the calendar, \"ask\" = ask each caller, or a timezone."
   },
   "configId": {
    "type": "string",
    "description": "Update this existing calendar row."
   }
  },
  "required": [
   "connectionId",
   "calendarId"
  ],
  "additionalProperties": false,
  "description": "Add or update one Outlook calendar on the agent (up to 5)."
 },
 "integration.outlook_calendar.remove": {
  "type": "object",
  "properties": {
   "configId": {
    "type": "string",
    "description": "Remove only this calendar row."
   },
   "calendarId": {
    "type": "string",
    "description": "Remove only this calendar."
   }
  },
  "additionalProperties": false,
  "description": "Remove one calendar, or all of them when empty."
 },
 "integration.google_sheets.assign": {
  "type": "object",
  "properties": {
   "connectionId": {
    "type": "string",
    "minLength": 1,
    "description": "Connection id from integrations_read all_connections."
   },
   "sheetId": {
    "type": "string",
    "minLength": 1,
    "description": "Spreadsheet id from integrations_read resources (google_sheets files)."
   },
   "sheetTabName": {
    "type": "string",
    "maxLength": 200,
    "description": "Tab inside the spreadsheet (resources with sheetId lists tabs)."
   },
   "method": {
    "type": "string",
    "enum": [
     "read",
     "lookup",
     "write"
    ],
    "description": "read = read rows; lookup = find the caller's row by identifierColumn; write = add / update rows (default write)."
   },
   "sheetName": {
    "type": "string",
    "maxLength": 200,
    "description": "Name the agent uses for this sheet when several are configured."
   },
   "sheetDescription": {
    "type": "string",
    "maxLength": 500,
    "description": "What the sheet holds / when the agent should use it."
   },
   "headerRowIndex": {
    "type": "integer",
    "minimum": 1,
    "maximum": 1000,
    "description": "Row number of the column headers (default 1)."
   },
   "headerDescriptions": {
    "type": "object",
    "additionalProperties": {
     "type": "string",
     "maxLength": 300
    },
    "description": "Column header → what it means, so the agent fills it correctly."
   },
   "identifierColumn": {
    "type": "string",
    "maxLength": 200,
    "description": "Column that identifies a row (e.g. email) for lookup / update."
   },
   "identityFields": {
    "type": "object",
    "properties": {
     "phone": {
      "type": "string",
      "description": "Column holding the caller's phone."
     },
     "email": {
      "type": "string",
      "description": "Column holding the caller's email."
     },
     "name": {
      "type": "string",
      "description": "Column holding the caller's name."
     },
     "custom": {
      "type": "string",
      "description": "Column holding a custom identifier."
     },
     "customLabel": {
      "type": "string",
      "description": "What the custom identifier is called."
     }
    },
    "additionalProperties": false,
    "description": "Which columns hold the caller's identity (used to match the caller to a row)."
   }
  },
  "required": [
   "connectionId",
   "sheetId"
  ],
  "additionalProperties": false,
  "description": "Add or update one spreadsheet on the agent (up to 5)."
 },
 "integration.google_sheets.remove": {
  "type": "object",
  "properties": {
   "sheetId": {
    "type": "string",
    "description": "Remove only this spreadsheet; empty removes all."
   }
  },
  "additionalProperties": false
 },
 "integration.airtable.assign": {
  "type": "object",
  "properties": {
   "connectionId": {
    "type": "string",
    "minLength": 1,
    "description": "Connection id from integrations_read all_connections."
   },
   "baseId": {
    "type": "string",
    "minLength": 1,
    "description": "Base id from integrations_read resources type=airtable."
   },
   "tableId": {
    "type": "string",
    "description": "Table id or name (resources with baseId lists tables)."
   },
   "method": {
    "type": "string",
    "enum": [
     "read",
     "create",
     "update",
     "upsert"
    ],
    "description": "Default operation the agent uses."
   },
   "fieldDescriptions": {
    "type": "object",
    "additionalProperties": {
     "type": "string",
     "maxLength": 300
    },
    "description": "Field name → what it means."
   },
   "identifierField": {
    "type": "string",
    "description": "Field used to find an existing record for update / upsert (e.g. Email)."
   }
  },
  "required": [
   "connectionId",
   "baseId"
  ],
  "additionalProperties": false,
  "description": "Give the agent Airtable access to one base."
 },
 "integration.airtable.remove": {
  "type": "object",
  "properties": {
   "connectionId": {
    "type": "string",
    "minLength": 1,
    "description": "Connection id from integrations_read all_connections."
   }
  },
  "additionalProperties": false
 },
 "integration.shopify.assign": {
  "type": "object",
  "properties": {
   "connectionId": {
    "type": "string",
    "minLength": 1,
    "description": "Connection id from integrations_read all_connections."
   }
  },
  "required": [
   "connectionId"
  ],
  "additionalProperties": false
 },
 "integration.shopify.remove": {
  "type": "object",
  "properties": {
   "connectionId": {
    "type": "string",
    "minLength": 1,
    "description": "Connection id from integrations_read all_connections."
   }
  },
  "additionalProperties": false
 },
 "integration.calendly.assign": {
  "type": "object",
  "properties": {
   "connectionId": {
    "type": "string",
    "minLength": 1,
    "description": "Connection id from integrations_read all_connections."
   }
  },
  "required": [
   "connectionId"
  ],
  "additionalProperties": false
 },
 "integration.calendly.remove": {
  "type": "object",
  "properties": {
   "connectionId": {
    "type": "string",
    "minLength": 1,
    "description": "Connection id from integrations_read all_connections."
   }
  },
  "additionalProperties": false
 },
 "integration.zoho_crm.assign": {
  "type": "object",
  "properties": {
   "config": {
    "type": "object",
    "properties": {
     "enabled": {
      "type": "boolean",
      "description": "Sync this agent's conversations with Zoho CRM."
     },
     "connectionId": {
      "type": "string",
      "minLength": 1,
      "description": "Zoho CRM connection id (integrations_read zoho_connections)."
     },
     "orgId": {
      "type": "string",
      "description": "Whitelabel org the connection belongs to (set automatically)."
     },
     "modules": {
      "type": "array",
      "items": {
       "type": "object",
       "properties": {
        "apiName": {
         "type": "string",
         "minLength": 1,
         "description": "Zoho module API name, e.g. \"Leads\", \"Contacts\" (integrations_read zoho_modules)."
        },
        "label": {
         "type": "string",
         "description": "Module display label."
        },
        "fields": {
         "type": "array",
         "items": {
          "type": "object",
          "properties": {
           "apiName": {
            "type": "string",
            "minLength": 1,
            "description": "Zoho field API name (integrations_read zoho_fields), e.g. \"Email\", \"Lead_Status\"."
           },
           "label": {
            "type": "string",
            "description": "Field display label."
           },
           "dataType": {
            "type": "string",
            "description": "Zoho data type (text, email, phone, picklist, date…) as returned by zoho_fields."
           },
           "read": {
            "type": "boolean",
            "description": "Show this field to the agent as caller context when the person is found in the CRM."
           },
           "write": {
            "type": "boolean",
            "description": "Capture this field from the conversation and write it to the CRM in the background."
           },
           "identity": {
            "type": "boolean",
            "description": "Use this field to find the person in the CRM (phone, email or any custom id field)."
           },
           "description": {
            "type": "string",
            "maxLength": 4000,
            "description": "What the field means, guiding what the agent captures into it."
           }
          },
          "required": [
           "apiName"
          ],
          "additionalProperties": false
         },
         "maxItems": 200,
         "description": "Fields of this module to read, write or match on."
        }
       },
       "required": [
        "apiName",
        "fields"
       ],
       "additionalProperties": false
      },
      "minItems": 1,
      "maxItems": 5,
      "description": "Modules searched in order to find the person (first match wins), e.g. Contacts before Leads."
     },
     "createModule": {
      "type": "string",
      "description": "Module new records are created in; must be one of modules."
     },
     "createPolicy": {
      "type": "string",
      "enum": [
       "never",
       "when_identified",
       "always"
      ],
      "default": "when_identified",
      "description": "never = only update people already in the CRM; when_identified = create once a phone/email/custom id is known; always = create as soon as any writable field is captured."
     },
     "defaultValuesOnCreate": {
      "type": "object",
      "additionalProperties": {},
      "description": "Fixed values set only when a record is created: Zoho field API name (from zoho_fields) → value in that field's type, e.g. { \"Lead_Source\": \"Chat\" }; picklist values must match exactly."
     },
     "setSourceOnCreate": {
      "type": "boolean",
      "description": "On new records, set the module's source field to the conversation channel (whatsapp, web-chat, sms, voice…). Default on."
     },
     "logConversationNote": {
      "type": "boolean",
      "description": "Keep one AI-written summary note per conversation on the CRM record."
     },
     "instructions": {
      "type": "string",
      "maxLength": 50000,
      "description": "Extra business guidance for what to capture into the CRM."
     },
     "updatedAt": {
      "type": "number",
      "description": "Unix seconds of the last save (server-set)."
     }
    },
    "required": [
     "enabled",
     "connectionId",
     "modules"
    ],
    "additionalProperties": false,
    "description": "Zoho sync config; draft it with integrations_write zoho_auto_configure and test it with zoho_test_lookup."
   }
  },
  "required": [
   "config"
  ],
  "additionalProperties": false
 },
 "integration.zoho_crm.remove": {
  "type": "object",
  "properties": {
   "connectionId": {
    "type": "string",
    "minLength": 1,
    "description": "Connection id from integrations_read all_connections."
   }
  },
  "additionalProperties": false
 },
 "integration.gmail.assign": {
  "type": "object",
  "properties": {
   "connectionId": {
    "type": "string",
    "minLength": 1,
    "description": "Connection id from integrations_read all_connections."
   },
   "whenToReply": {
    "type": "string",
    "enum": [
     "always",
     "keywords",
     "sentiment",
     "manual"
    ],
    "description": "always = answer every email; keywords = only emails matching keywords; sentiment = by detected sentiment; manual = a human sends replies."
   },
   "replyDelayMinutes": {
    "type": "number",
    "minimum": 0,
    "maximum": 10080,
    "description": "Wait this many minutes before replying (0 = instant)."
   },
   "replyRule": {
    "type": "string",
    "maxLength": 2000,
    "description": "Extra instructions for how the agent replies to emails."
   },
   "humanNotifyRule": {
    "type": "string",
    "maxLength": 2000,
    "description": "When to notify a human instead of / as well as replying."
   },
   "replyLength": {
    "type": "string",
    "enum": [
     "short",
     "medium",
     "long",
     "auto"
    ],
    "description": "Target reply length (default auto)."
   },
   "replyTone": {
    "type": "string",
    "maxLength": 100,
    "description": "Reply tone, e.g. \"professional\" (default), \"friendly\"."
   },
   "keywords": {
    "type": "array",
    "items": {
     "type": "string",
     "maxLength": 100
    },
    "maxItems": 100,
    "description": "whenToReply=keywords: reply only when one of these appears."
   },
   "ignoreKeywords": {
    "type": "array",
    "items": {
     "type": "string",
     "maxLength": 100
    },
    "maxItems": 100,
    "description": "Never reply to emails containing these."
   },
   "humanTakeoverEnabled": {
    "type": "boolean",
    "description": "Pause the agent when a human replies in the thread."
   },
   "humanTakeoverTimeoutMinutes": {
    "type": "number",
    "minimum": 0,
    "maximum": 100000,
    "description": "Resume the agent after this many minutes of human silence."
   },
   "notifyWorkspaceOwners": {
    "type": "boolean",
    "description": "Email the workspace owners on human-notify events (default true)."
   }
  },
  "required": [
   "connectionId"
  ],
  "additionalProperties": false,
  "description": "Let the agent answer this inbox; also starts inbound notifications."
 },
 "integration.gmail.remove": {
  "type": "object",
  "properties": {
   "connectionId": {
    "type": "string",
    "minLength": 1,
    "description": "Connection id from integrations_read all_connections."
   }
  },
  "additionalProperties": false
 },
 "integration.outlook_mail.assign": {
  "type": "object",
  "properties": {
   "connectionId": {
    "type": "string",
    "minLength": 1,
    "description": "Connection id from integrations_read all_connections."
   },
   "whenToReply": {
    "type": "string",
    "enum": [
     "always",
     "keywords",
     "sentiment",
     "manual"
    ],
    "description": "always = answer every email; keywords = only emails matching keywords; sentiment = by detected sentiment; manual = a human sends replies."
   },
   "replyDelayMinutes": {
    "type": "number",
    "minimum": 0,
    "maximum": 10080,
    "description": "Wait this many minutes before replying (0 = instant)."
   },
   "replyRule": {
    "type": "string",
    "maxLength": 2000,
    "description": "Extra instructions for how the agent replies to emails."
   },
   "humanNotifyRule": {
    "type": "string",
    "maxLength": 2000,
    "description": "When to notify a human instead of / as well as replying."
   },
   "replyLength": {
    "type": "string",
    "enum": [
     "short",
     "medium",
     "long",
     "auto"
    ],
    "description": "Target reply length (default auto)."
   },
   "replyTone": {
    "type": "string",
    "maxLength": 100,
    "description": "Reply tone, e.g. \"professional\" (default), \"friendly\"."
   },
   "keywords": {
    "type": "array",
    "items": {
     "type": "string",
     "maxLength": 100
    },
    "maxItems": 100,
    "description": "whenToReply=keywords: reply only when one of these appears."
   },
   "ignoreKeywords": {
    "type": "array",
    "items": {
     "type": "string",
     "maxLength": 100
    },
    "maxItems": 100,
    "description": "Never reply to emails containing these."
   },
   "humanTakeoverEnabled": {
    "type": "boolean",
    "description": "Pause the agent when a human replies in the thread."
   },
   "humanTakeoverTimeoutMinutes": {
    "type": "number",
    "minimum": 0,
    "maximum": 100000,
    "description": "Resume the agent after this many minutes of human silence."
   },
   "notifyWorkspaceOwners": {
    "type": "boolean",
    "description": "Email the workspace owners on human-notify events (default true)."
   }
  },
  "required": [
   "connectionId"
  ],
  "additionalProperties": false,
  "description": "Let the agent answer this inbox; also starts inbound notifications."
 },
 "integration.outlook_mail.remove": {
  "type": "object",
  "properties": {
   "connectionId": {
    "type": "string",
    "minLength": 1,
    "description": "Connection id from integrations_read all_connections."
   }
  },
  "additionalProperties": false
 },
 "integration.zoho_mail.assign": {
  "type": "object",
  "properties": {
   "connectionId": {
    "type": "string",
    "minLength": 1,
    "description": "Connection id from integrations_read all_connections."
   },
   "whenToReply": {
    "type": "string",
    "enum": [
     "always",
     "keywords",
     "sentiment",
     "manual"
    ],
    "description": "always = answer every email; keywords = only emails matching keywords; sentiment = by detected sentiment; manual = a human sends replies."
   },
   "replyDelayMinutes": {
    "type": "number",
    "minimum": 0,
    "maximum": 10080,
    "description": "Wait this many minutes before replying (0 = instant)."
   },
   "replyRule": {
    "type": "string",
    "maxLength": 2000,
    "description": "Extra instructions for how the agent replies to emails."
   },
   "humanNotifyRule": {
    "type": "string",
    "maxLength": 2000,
    "description": "When to notify a human instead of / as well as replying."
   },
   "replyLength": {
    "type": "string",
    "enum": [
     "short",
     "medium",
     "long",
     "auto"
    ],
    "description": "Target reply length (default auto)."
   },
   "replyTone": {
    "type": "string",
    "maxLength": 100,
    "description": "Reply tone, e.g. \"professional\" (default), \"friendly\"."
   },
   "keywords": {
    "type": "array",
    "items": {
     "type": "string",
     "maxLength": 100
    },
    "maxItems": 100,
    "description": "whenToReply=keywords: reply only when one of these appears."
   },
   "ignoreKeywords": {
    "type": "array",
    "items": {
     "type": "string",
     "maxLength": 100
    },
    "maxItems": 100,
    "description": "Never reply to emails containing these."
   },
   "humanTakeoverEnabled": {
    "type": "boolean",
    "description": "Pause the agent when a human replies in the thread."
   },
   "humanTakeoverTimeoutMinutes": {
    "type": "number",
    "minimum": 0,
    "maximum": 100000,
    "description": "Resume the agent after this many minutes of human silence."
   },
   "notifyWorkspaceOwners": {
    "type": "boolean",
    "description": "Email the workspace owners on human-notify events (default true)."
   }
  },
  "required": [
   "connectionId"
  ],
  "additionalProperties": false,
  "description": "Let the agent answer this inbox; also starts inbound notifications."
 },
 "integration.zoho_mail.remove": {
  "type": "object",
  "properties": {
   "connectionId": {
    "type": "string",
    "minLength": 1,
    "description": "Connection id from integrations_read all_connections."
   }
  },
  "additionalProperties": false
 }
} as const;

export type ZodSchemaKey = keyof typeof ZOD_SCHEMAS;

/** Top-level agent fields PATCH /agents/{id} accepts (backend allowlist). Anything else is rejected with a 400. */
export const AGENT_UPDATE_ALLOWED_KEYS: readonly string[] = ["title","description","theme","roundedImageURL","branding","customThemeJSONString","chatBgURL","lang","fontFamily","rectangeImageURL","avatarImageUrl","headerImageUrl","bannerImageUrl","enableNodes","nodes","nodesSettings","vg_systemPrompt","vg_initPrompt","vg_initMessages","vg_prompt","vg_temperature","vg_defaultModel","vg_maxTokens","vg_max_messages_history","vg_enableAboutContext","ifKnowsThreshold","enableFallback","fallbackSettings","vg_enableUIEngine","vg_enableUIEngineForms","vg_enableUIEngineInvoice","vg_enableUIEngineCalendarBooking","vg_uiEngineChannelConfig","vg_uiEngineFormNotifyConfig","vg_uiEngineInvoiceConfig","vg_uiEngineCalendarConfig","vg_maxImagesPerCard","funnelConfig","leadCollectionRules","voiceConfig","enableAudioSupport","disableAutoTranscribeAudio","captureIGStories","metaHumanTakeover","vg_kb_llm","vg_kbDefaultDimension","vg_kbTopChunks","vg_kbCharCount","vg_kbDocsNum","kbTags","kbTagsDataMap","proactiveMessage","autoStartWidget","autoOpenWidget","messageDelayMS","scrollAnimation","disableSmoothScroll","buttonsLayout","buttonVariant","inputVariant","tabs","ui","ADVANCED_customCSS","disableRating","chatEndMessage","aiIntroductionMessage","enableAIIntroductionMessage","privacyDisclaimer","gdprCompliance","disableModelAutoUpgrade","acceptFileUpload","disableFileUpload","enableQuickFileUpload","soundEffectUrl","soundEffectEnabled","agentPlatform","customTheme","translateUserResponse","AITranslateTo","enableAITranslate","disableHumanHandoff","alwaysShowHandoff","manualControl","enableVGHandoff","fixedHandoffPopup","UIhandoffTitle","UIhandoffSubtitle","showHandoffEvenIfOffline","persistHandoffOnRefresh","blockInputDuringHandoffRequest","disableHandoffMessages","handoffNowChattingMessage","handoffBackToAiMessage","handoffCancelButtonLabel","disableHandoffStatusMessages","convoTags","topicsConfig","advanced","vgOptions","starred","enableGeoAnalytics","hideVoiceflowAnalytics","hideCallAnalytics","hideConversationMetrics","hideCustomAnalytics","hideVapiAnalytics","hideFunnelAnalytics","marketplace","autoTest","customButtonJSON_STRING","modelId","modelIdLastChangedAt","modelIdLastChangedBy","additionalConfig"];

/** Fields that can never be set through update_agent. */
export const AGENT_UPDATE_FORBIDDEN_KEYS: readonly string[] = ["SECRET_API_KEY","ownerID","ID","id","VF_DIALOGUE_API_KEY","VF_PROJECT_API_KEY","VF_PROJECT_ID","VF_KB_API_KEY","igAccessToken","tokensUsage","maxTokensUsage","allTimeTriggers","vectorDb","internal"];
