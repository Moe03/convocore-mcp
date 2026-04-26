/**
 * Channel integration reference for MCP clients.
 *
 * This is static guidance for LLM hosts. It intentionally describes the
 * canonical ownership models, safe update boundaries, and routing differences
 * so agents do not confuse WhatsApp, SMS/Twilio, Messenger, Instagram, and
 * workspace-level integrations while performing ConvoCore CRUD.
 */

export const CHANNEL_INTEGRATION_SPEC = {
  meta: {
    version: '1.0.0',
    purpose:
      'Explain where channel integration config lives and which fields are safe to read/update. Runtime webhooks resolve channel records first, then route to the assigned agent.',
    importantRules: [
      'Integrations are workspace/org/client-owned, not primarily agent-owned.',
      'WhatsApp uses waNumbers/{phoneId}; SMS uses twilio_numbers/{sid}; Messenger/Instagram use metaPages/{pageId}. Do not mix them.',
      'Credentials such as longAccessToken and pageAccessToken are sensitive and must be masked/omitted by default.',
      'Use dedicated connect/assign/remove/update-settings flows. Do not expose generic raw patch tools for integration docs.',
    ],
  },

  whatsapp: {
    canonicalLocation: 'waNumbers/{phoneId}',
    compatibilityMirrors:
      'voiceglow/{agentId}.whatsappToken, whatsappNumberId, whatsappBusniessId, whatsappPhoneNumber are legacy/fast lookup mirrors, not the source of truth.',
    routing:
      'Inbound webhooks resolve waNumbers by phoneId, then require an assigned agentId before AI runtime can respond. Conversation origin is "whatsapp".',
    ownershipFields: {
      workspaceId: 'Owning workspace/org/user id. Read-only from normal settings tools.',
      agentId: 'Assigned agent. Use assign/reassign flow, not raw patch.',
      phoneId: 'Meta WhatsApp phone number ID and usually the document id.',
    },
    connectionModes: {
      enum: ['legacyClassic', 'metaCloudApi', 'metaCoexistence'],
      labels: {
        legacyClassic: 'Classic legacy agent-level compatibility path.',
        metaCloudApi: 'Standard WhatsApp Cloud API connection.',
        metaCoexistence: 'Existing WhatsApp Business App number connected through Meta coexistence.',
      },
      numberOriginMap: {
        legacyClassic: 'legacy_classic',
        metaCloudApi: 'cloud_api_only',
        metaCoexistence: 'existing_business_app',
      },
      default: 'metaCloudApi',
    },
    safeListItemShape: {
      phoneId: 'string',
      wabaId: 'string?',
      phoneNumber: 'string?',
      displayName: 'string?',
      verifiedName: 'string?',
      workspaceId: 'string',
      agentId: 'string | null?',
      isPrimary: 'boolean?',
      connectionMode: '"legacyClassic" | "metaCloudApi" | "metaCoexistence"',
      numberOrigin: '"legacy_classic" | "cloud_api_only" | "existing_business_app"',
      status: '"pending" | "connected" | "error" | "disconnected"',
      subscribedApp: 'boolean?',
      registrationState: 'string?',
      lastError: 'string?',
      aiPaused: 'boolean?',
      newContactsOnly: 'boolean?',
      voiceCallingStatus: '"disabled" | "enabling" | "enabled" | "error"',
      voiceConfig: {
        inboundEnabled: 'boolean?',
        autoAnswer: 'boolean?',
        greetingMode: '"agent_default" | "custom"',
        customGreeting: 'string?',
      },
    },
    safeSettingsPatch: {
      aiPaused: 'boolean?',
      newContactsOnly: 'boolean?',
      aiReplyRule: 'string?',
      applyAiReplyRuleDuringHumanChatting: 'boolean?',
      coexistenceSettings: {
        aiReplyDelayMinutes: 'number?',
        humanInactivityTimeoutMinutes: 'number?',
        aiTakeoverMode: '"silent" | "announce"',
        aiTakeoverMessage: 'string?',
      },
      voiceConfig: {
        autoAnswer: 'boolean?',
        greetingMode: '"agent_default" | "custom"',
        customGreeting: 'string?',
      },
    },
    useDedicatedProceduresFor: {
      agentId: 'Use assign/reassign WhatsApp number flow.',
      isPrimary: 'Use assign/reassign/make-primary semantics.',
      'voiceConfig.inboundEnabled': 'Use setWhatsAppVoiceCalling because this talks to Meta and updates status fields.',
      voiceCallingEnabled: 'Use setWhatsAppVoiceCalling.',
    },
    readOnlyOrSystemManaged: [
      'workspaceId',
      'phoneId',
      'longAccessToken',
      'wabaId',
      'phoneNumber',
      'createdAt',
      'connectionMode',
      'numberOrigin',
      'status',
      'isLegacy',
      'displayName',
      'verifiedName',
      'registrationState',
      'subscribedApp',
      'lastError',
      'coexistenceMeta',
      'smbSync',
      'voiceCallingStatus',
      'voiceWebhookSubscribed',
      'voiceLastError',
      'voiceRuntime',
    ],
    aiBehavior: {
      aiPaused: 'If true, inbound messages are persisted but AI does not reply.',
      newContactsOnly:
        'Default is effectively true unless explicitly false. Synced SMB contacts are treated as known contacts and AI is blocked.',
      aiReplyRule:
        'Free-text LLM-evaluated rule. In normal mode, evaluation failures currently allow reply; during human-chatting with applyAiReplyRuleDuringHumanChatting=true, failures block AI.',
      aiReplyDelayMinutes:
        'Delays AI reply by N minutes and re-checks whether a human claimed the chat before sending.',
      humanInactivityTimeoutMinutes:
        'UI-level chat ownership setting for auto-returning claimed chats to AI after inactivity.',
      aiTakeoverMode: '"silent" or "announce" when AI reclaims a chat.',
      aiTakeoverMessage: 'Announcement text when aiTakeoverMode is "announce".',
    },
    coexistence: {
      coexistenceMeta: {
        lastAppOpenWarningAt: 'string?',
        syncState: '"not_started" | "pending" | "syncing" | "synced" | "failed"',
        linkedDevicesResetAt: 'string?',
        limitationsAcceptedAt: 'string?',
      },
      smbSync: {
        contactsSyncRequestId: 'string?',
        historySyncRequestId: 'string?',
        contactsSyncedCount: 'number?',
        historySyncProgress: 'number 0-100?',
        historySyncStartedAt: 'number?',
        historySyncCompletedAt: 'number?',
        contactsSyncStartedAt: 'number?',
        lastSyncEventAt: 'number?',
      },
      note:
        'These are mostly system-managed. They describe Business App coexistence sync state and should not be raw-patched by an MCP.',
    },
    voice: {
      voiceCallingEnabled: 'boolean?',
      voiceCallingStatus: '"disabled" | "enabling" | "enabled" | "error"',
      voiceWebhookSubscribed: 'boolean?',
      voiceLastError: 'string?',
      voiceConfig: {
        inboundEnabled:
          'Whether inbound WhatsApp calling is enabled. Prefer setWhatsAppVoiceCalling, not raw patch.',
        autoAnswer: 'Whether the agent should auto-answer inbound calls when voice is enabled.',
        greetingMode: '"agent_default" uses normal agent greeting; "custom" uses customGreeting.',
        customGreeting: 'Custom call greeting text when greetingMode is "custom".',
      },
      productionGuard:
        'The current backend blocks setWaNumberVoiceCalling(enabled=true) when NODE_ENV === "production".',
    },
    recommendedTools: [
      'listWorkspaceWhatsAppNumbers(workspaceId) - return safe metadata, mask longAccessToken.',
      'getWhatsAppNumber(phoneId) - return safe config for one number, mask credentials by default.',
      'assignWhatsAppNumber(phoneId, targetAgentId, makePrimary?) - use assign/reassign semantics.',
      'updateWhatsAppNumberSettings(phoneId, agentId, patch) - only allow safeSettingsPatch fields.',
      'setWhatsAppVoiceCalling(phoneId, agentId, enabled) - dedicated voice setup action.',
      'refreshWhatsAppVoiceStatus(phoneId, agentId) - reconcile Meta voice status.',
      'getWhatsAppNumberHealth(phoneId) - return Meta health/tier data.',
      'removeWhatsAppNumber(phoneId, agentId) - destructive; require explicit confirmation.',
    ],
  },

  metaPages: {
    canonicalLocation: 'metaPages/{pageId}',
    platforms: {
      messenger: {
        webhookObject: 'page',
        lookupField: 'metaPages.pageId',
        origin: 'messenger',
        replyField: 'reply_to.mid',
      },
      instagram: {
        webhookObject: 'instagram',
        lookupField: 'metaPages.igPageId',
        origin: 'instagram',
        replyField: 'reply_to.mid',
      },
    },
    persistedShape: {
      pageName: 'string?',
      pagePhotoUrl: 'string?',
      igPageName: 'string | null?',
      agentId: 'string',
      pageId: 'string',
      pageAccessToken: 'string (sensitive)',
      igPageId: 'string | null?',
      workspaceId: 'string?',
    },
    safeReadFields: [
      'pageName',
      'pagePhotoUrl',
      'igPageName',
      'agentId',
      'pageId',
      'igPageId',
      'workspaceId',
    ],
    sensitiveFields: ['pageAccessToken'],
    subscriptions: [
      'messages',
      'messaging_postbacks',
      'messaging_optins',
      'messaging_referrals',
      'message_deliveries',
      'message_reads',
      'messaging_handovers',
      'messaging_policy_enforcement',
    ],
    operationalNotes: [
      'Page tokens from /me/accounts with a long-lived user token are treated as non-expiring; do not fb_exchange_token them casually.',
      'Meta Conversation Routing can block bot replies by routing DMs to Page Inbox/IG mobile inbox; expose a routing check for debugging.',
      'Echo messages, deleted messages, IG story mentions, and reel attachment edge cases are intentionally filtered/handled specially.',
      'IG story replies only proceed when voiceglow/{agentId}.captureIGStories === true.',
    ],
    recommendedTools: [
      'listMetaPages(workspaceId, agentId?) - safe metadata only.',
      'getMetaPage(pageId) - safe metadata and assignment.',
      'connectMetaPage(selectedPage, agentId?) - privileged connect/reconnect flow.',
      'removeMetaPage(agentId, pageId) - destructive; require explicit confirmation.',
      'getMetaProfile(agentId, userId, origin?) - fetch profile metadata using stored token.',
      'checkMetaConversationRouting(pageId) - debug routing issues.',
    ],
  },

  sms: {
    canonicalLocation: 'twilio_numbers/{sid}',
    compatibilityMirrors: 'voiceglow/{agentId}.twilioSms*',
    origin: 'sms',
    note:
      'SMS is separate from WhatsApp. Do not use Twilio SMS tools to configure WhatsApp Cloud API numbers, even if the same human phone number conceptually exists in both systems.',
    currentMcpTools: [
      'buy_twilio_number',
      'import_twilio_number',
      'release_twilio_number',
      'check_twilio_number',
      'sync_sms_twilio_number',
    ],
  },
} as const;

export type ChannelIntegrationSpecSection = keyof typeof CHANNEL_INTEGRATION_SPEC | 'all';
