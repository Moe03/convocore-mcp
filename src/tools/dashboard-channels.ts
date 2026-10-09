/**
 * Channel management tools backed by the dashboard RPC gateway: WhatsApp numbers,
 * templates and broadcast campaigns, Meta pages, SMS numbers and the email channel.
 * Credentials never pass through here: the API resolves them from agentId + phoneId / pageId.
 */

import { type ToolModule } from './helpers.js';
import { buildRpcModule, pick, type RpcToolSpec } from './rpc-tools.js';

const agentId = { type: 'string' } as const;
const phoneId = {
  type: 'string',
  description: 'Meta WhatsApp phone number ID (from get_agent_channels), not the phone number.',
} as const;

const specs: RpcToolSpec[] = [
  {
    name: 'whatsapp_numbers_read',
    kind: 'read',
    description:
      'Read details of the WhatsApp numbers connected to an agent. For a quick "is it connected" check use get_agent_channels; for reply rules use get_whatsapp_ai_rules.',
    required: ['agentId'],
    properties: { agentId, phoneId },
    actions: {
      list: {
        procedure: 'getWhatsappNumbers',
        summary: 'all numbers of the agent with status, mode and settings',
        input: (a) => pick(a, 'agentId'),
      },
      details: {
        procedure: 'getDetailsOfWhatsappNumber',
        summary: 'live info from Meta: display name, quality rating, messaging limit tier, verification',
        required: ['phoneId'],
        input: (a) => pick(a, 'agentId', 'phoneId'),
      },
      analytics: {
        procedure: 'getWhatsAnalytics',
        summary: 'WhatsApp conversation and message analytics for the agent',
        input: (a) => pick(a, 'agentId'),
      },
      voice_status: {
        procedure: 'refreshWaNumberVoiceStatus',
        summary: 're-check with Meta whether WhatsApp voice calling is enabled on the number',
        required: ['phoneId'],
        input: (a) => pick(a, 'agentId', 'phoneId'),
      },
    },
  },
  {
    name: 'whatsapp_numbers_write',
    kind: 'write',
    description:
      'Manage a connected WhatsApp number. To CONNECT a new number use create_channel_connect_link (the user must log in with Meta). Confirm with the user before remove.',
    required: ['agentId', 'phoneId'],
    properties: {
      agentId,
      phoneId,
      newAgentId: { type: 'string', description: 'For reassign: the agent that should answer this number.' },
      displayName: { type: 'string', description: 'For update_display_name: new WhatsApp display name (Meta reviews it).' },
      enabled: { type: 'boolean', description: 'For set_voice_calling.' },
    },
    actions: {
      remove: {
        procedure: 'removeWhatsappNumber',
        summary: 'disconnect the number from the agent (the AI stops answering it)',
        input: (a) => pick(a, 'agentId', 'phoneId'),
      },
      reassign: {
        procedure: 'reassignWhatsappNumber',
        summary: 'move the number to another agent of the workspace',
        required: ['newAgentId'],
        input: (a) => ({ currentAgentId: a.agentId, newAgentId: a.newAgentId, phoneId: a.phoneId }),
      },
      update_display_name: {
        procedure: 'updateWhatsappNumberInfo',
        summary: 'request a new display name on the WhatsApp business profile',
        required: ['displayName'],
        input: (a) => ({ agentId: a.agentId, phoneId: a.phoneId, verified_name: a.displayName }),
      },
      set_voice_calling: {
        procedure: 'setWaNumberVoiceCalling',
        summary: 'turn inbound WhatsApp voice calling on or off for the number',
        required: ['enabled'],
        input: (a) => pick(a, 'agentId', 'phoneId', 'enabled'),
      },
    },
  },
  {
    name: 'whatsapp_templates_read',
    kind: 'read',
    description:
      'List the WhatsApp message templates of a number (name, language, category, approval status, components). Templates are required to message a customer outside the 24-hour window and for broadcast campaigns.',
    required: ['agentId', 'phoneId'],
    properties: { agentId, phoneId },
    actions: {
      list: {
        procedure: 'listTemplates',
        summary: 'all templates of the WhatsApp Business account',
        input: (a) => pick(a, 'agentId', 'phoneId'),
      },
    },
  },
  {
    name: 'whatsapp_templates_write',
    kind: 'write',
    description:
      'Create, edit or delete WhatsApp message templates. New and edited templates go to Meta for review before they can be used. Placeholders are {{1}}, {{2}}… in order.',
    required: ['agentId', 'phoneId'],
    properties: {
      agentId,
      phoneId,
      name: { type: 'string', description: 'For create: lowercase letters, digits and underscores. For delete: the template name.' },
      category: { type: 'string', enum: ['AUTHENTICATION', 'UTILITY', 'MARKETING'] },
      language: { type: 'string', description: 'For create: language code, e.g. "en_US", "ar".' },
      bodyText: { type: 'string', description: 'For create: body text of a simple text-only template.' },
      components: {
        type: 'array',
        items: { type: 'object' },
        description: 'Meta template components (HEADER / BODY / FOOTER / BUTTONS) for create or update, when more than a plain body is needed.',
      },
      templateId: { type: 'string', description: 'For update (required) and delete (optional).' },
    },
    actions: {
      create: {
        procedure: 'createTemplate',
        summary: 'submit a new template; give bodyText or components',
        required: ['name', 'category', 'language'],
        input: (a) => pick(a, 'agentId', 'phoneId', 'name', 'category', 'language', 'bodyText', 'components'),
      },
      update: {
        procedure: 'updateTemplate',
        summary: 'replace the components (and optionally category) of an existing template',
        required: ['templateId', 'components'],
        input: (a) => pick(a, 'agentId', 'phoneId', 'templateId', 'components', 'category'),
      },
      delete: {
        procedure: 'deleteTemplate',
        summary: 'delete a template by name (all languages unless templateId is given)',
        required: ['name'],
        input: (a) => ({ ...pick(a, 'agentId', 'phoneId', 'templateId'), templateName: a.name }),
      },
    },
  },
  {
    name: 'whatsapp_campaigns_read',
    kind: 'read',
    description:
      'List WhatsApp broadcast campaigns of an agent (template messages sent to a lead group) with sent / delivered / failed counts. Outbound CALL campaigns are in campaigns_read.',
    required: ['agentId'],
    properties: { agentId, page: { type: 'number' }, limit: { type: 'number', description: 'Default 20, max 100.' } },
    actions: {
      list: {
        procedure: 'waCampaignRouter.listWACampaigns',
        summary: 'paginated campaigns',
        input: (a) => pick(a, 'agentId', 'page', 'limit'),
      },
    },
  },
  {
    name: 'whatsapp_campaigns_write',
    kind: 'write',
    description:
      'Create, edit, delete or send a WhatsApp broadcast campaign: an APPROVED template sent to every lead in a lead group. run sends real WhatsApp messages that Meta bills — always run with dryRun=true first and confirm the audience with the user. ' +
      'Campaign fields: name, leadGroupName (or "all"), phoneId (sending number), templateId, templateName, templateLanguage, templateCategory, variableMapping / headerVariableMapping (how lead fields fill {{1}}, {{2}}…), delayBetweenMessages (seconds, default 2), openTime / closeTime ("HH:mm"), timezone.',
    required: ['agentId'],
    properties: {
      agentId,
      campaignId: { type: 'string', description: 'Required for update, delete and run.' },
      campaign: { type: 'object', description: 'For create (all required fields) or update (only fields to change).' },
      dryRun: { type: 'boolean', description: 'For run: true = validate and count recipients without sending.' },
    },
    actions: {
      create: {
        procedure: 'waCampaignRouter.createWACampaign',
        summary: 'create a campaign (stopped until run)',
        required: ['campaign'],
        input: async (a, client) => {
          const campaign: Record<string, any> = { channelType: 'whatsapp', ...a.campaign };
          // wabaId is not a secret but nobody knows it by heart: read it from the sending number.
          if (!campaign.wabaId && campaign.phoneId) {
            const numbers: any = await client.rpc('getWhatsappNumbers', { agentId: a.agentId });
            const number = (Array.isArray(numbers) ? numbers : []).find(
              (item: any) => item?.phoneId === campaign.phoneId
            );
            if (!number) throw new Error('campaign.phoneId is not a WhatsApp number of this agent');
            campaign.wabaId = number.wabaId;
            campaign.phoneNumber = campaign.phoneNumber ?? number.phoneNumber;
          }
          return { ...campaign, agentId: a.agentId };
        },
      },
      update: {
        procedure: 'waCampaignRouter.updateWACampaign',
        summary: 'change fields of a campaign',
        required: ['campaignId', 'campaign'],
        input: (a) => ({ agentId: a.agentId, campaignId: a.campaignId, updates: a.campaign }),
      },
      delete: {
        procedure: 'waCampaignRouter.deleteWACampaign',
        summary: 'delete a campaign',
        required: ['campaignId'],
        input: (a) => pick(a, 'agentId', 'campaignId'),
      },
      run: {
        procedure: 'waCampaignRouter.runWACampaign',
        summary: 'send the campaign now (dryRun=true to preview)',
        required: ['campaignId'],
        input: (a) => ({ ...pick(a, 'agentId', 'campaignId'), dryRun: a.dryRun ?? false }),
      },
    },
  },
  {
    name: 'meta_pages_read',
    kind: 'read',
    description:
      'Diagnose a connected Facebook page (Messenger / Instagram). To list connected pages use get_agent_channels; to connect one use create_channel_connect_link.',
    required: ['agentId'],
    properties: {
      agentId,
      pageId: { type: 'string', description: 'Facebook page id from get_agent_channels.' },
      userId: { type: 'string', description: 'For get_profile: the Messenger / Instagram user id (conversation id).' },
      origin: { type: 'string', enum: ['messenger', 'instagram'], description: 'For get_profile.' },
    },
    actions: {
      check_subscriptions: {
        procedure: 'checkPageSubscriptions',
        summary: 'which webhook events the page is subscribed to — use when the agent does not receive Messenger / Instagram messages',
        required: ['pageId'],
        input: (a) => pick(a, 'agentId', 'pageId'),
      },
      get_profile: {
        procedure: 'getMetaProfile',
        summary: 'name and picture of a Messenger / Instagram user who messaged the agent',
        required: ['userId'],
        input: (a) => pick(a, 'agentId', 'userId', 'origin'),
      },
    },
  },
  {
    name: 'sms_numbers_read',
    kind: 'read',
    description:
      'Read the SMS numbers of an agent and search numbers that can be rented. Voice phone numbers are in get_agent_phone.',
    properties: {
      agentId,
      country: { type: 'string', description: 'Two-letter country code, default "US".' },
      areaCode: { type: 'string' },
      contains: { type: 'string', description: 'Digits the number should contain.' },
      locality: { type: 'string' },
      limit: { type: 'number', description: 'For search_available: max 50.' },
    },
    actions: {
      list: {
        procedure: 'getSmsNumbers',
        summary: 'SMS numbers connected to the agent',
        required: ['agentId'],
        input: (a) => pick(a, 'agentId'),
      },
      analytics: {
        procedure: 'getSmsAnalytics',
        summary: 'SMS volume and delivery analytics for the agent',
        required: ['agentId'],
        input: (a) => pick(a, 'agentId'),
      },
      rental_status: {
        procedure: 'getRentalStatus',
        summary: 'whether the agent has a rented platform number and its state',
        required: ['agentId'],
        input: (a) => pick(a, 'agentId'),
      },
      rental_available: {
        procedure: 'isPlatformRentalAvailable',
        summary: 'whether number rental is offered in a country',
        input: (a) => pick(a, 'country'),
      },
      search_available: {
        procedure: 'searchAvailableNumbers',
        summary: 'numbers available to rent, filtered by country / area code / digits',
        input: (a) => pick(a, 'country', 'areaCode', 'contains', 'locality', 'limit'),
      },
    },
  },
  {
    name: 'sms_numbers_write',
    kind: 'write',
    description:
      'Manage the SMS numbers of an agent. Connecting your own Twilio account and paying for a rented number are done on the dashboard (they need credentials / card details that must not go through chat). test_send sends a real SMS.',
    required: ['agentId'],
    properties: {
      agentId,
      phoneNumber: { type: 'string', description: 'E.164 number, for remove and assign_rental.' },
      testPhoneNumber: { type: 'string', description: 'For test_send: E.164 recipient.' },
      message: { type: 'string', description: 'For test_send (optional).' },
    },
    actions: {
      remove: {
        procedure: 'removeSmsNumber',
        summary: 'disconnect an SMS number from the agent',
        required: ['phoneNumber'],
        input: (a) => pick(a, 'agentId', 'phoneNumber'),
      },
      assign_rental: {
        procedure: 'assignSmsRentalNumberToAgent',
        summary: 'attach an already-rented platform number to the agent',
        required: ['phoneNumber'],
        input: (a) => pick(a, 'agentId', 'phoneNumber'),
      },
      release_rental: {
        procedure: 'releaseRentedNumber',
        summary: 'give up the rented number of the agent (it stops working; confirm first)',
        input: (a) => pick(a, 'agentId'),
      },
      test_send: {
        procedure: 'testSmsSend',
        summary: 'send a test SMS from the agent number',
        required: ['testPhoneNumber'],
        input: (a) => pick(a, 'agentId', 'testPhoneNumber', 'message'),
      },
    },
  },
  {
    name: 'email_channel_read',
    kind: 'read',
    description:
      'Read the email channel setup of the workspace: sending domains (with the DNS records to add and their verification state), inboxes (addresses agents answer) and recent email events.',
    properties: {
      orgId: { type: 'string', description: 'Optional organization scope.' },
      limit: { type: 'number', description: 'For recent_events: max 100.' },
    },
    actions: {
      domains: { procedure: 'resendEmail.listDomains', summary: 'sending domains', input: (a) => pick(a, 'orgId') },
      inboxes: { procedure: 'resendEmail.listInboxes', summary: 'inboxes and their assigned agent', input: (a) => pick(a, 'orgId') },
      recent_events: {
        procedure: 'resendEmail.listRecentEvents',
        summary: 'recent inbound / outbound email events',
        input: (a) => pick(a, 'orgId', 'limit'),
      },
    },
  },
  {
    name: 'email_channel_write',
    kind: 'write',
    description:
      'Set up and operate the email channel. Flow: create_domain → the user adds the returned DNS records at their DNS provider → verify_domain → create_inbox (address = localPart@domain) assigned to an agent. send_human_reply sends a real email.',
    properties: {
      orgId: { type: 'string', description: 'Optional organization scope.' },
      domain: { type: 'string', description: 'For create_domain, e.g. "mail.example.com".' },
      domainId: { type: 'string' },
      inboxId: { type: 'string' },
      localPart: { type: 'string', description: 'For create_inbox: the part before @, e.g. "support".' },
      displayName: { type: 'string' },
      assignedAgentId: { type: ['string', 'null'], description: 'Agent that answers the inbox; null to unassign.' },
      active: { type: 'boolean' },
      settings: { type: 'object' },
      reply: {
        type: 'object',
        description:
          'For send_human_reply: { conversationId, to[], cc?[], subject, replyText, originalFrom, originalFromName?, originalDate (unix ms), originalBody, inboundMessageId?, references?[] }.',
      },
    },
    actions: {
      create_domain: {
        procedure: 'resendEmail.createDomain',
        summary: 'register a sending domain and get its DNS records',
        required: ['domain'],
        input: (a) => pick(a, 'domain', 'orgId'),
      },
      refresh_domain: {
        procedure: 'resendEmail.refreshDomain',
        summary: 're-read the domain status',
        required: ['domainId'],
        input: (a) => pick(a, 'domainId', 'orgId'),
      },
      verify_domain: {
        procedure: 'resendEmail.verifyDomain',
        summary: 'ask for DNS verification after the records were added',
        required: ['domainId'],
        input: (a) => pick(a, 'domainId', 'orgId'),
      },
      delete_domain: {
        procedure: 'resendEmail.deleteDomain',
        summary: 'remove a sending domain (its inboxes stop working)',
        required: ['domainId'],
        input: (a) => pick(a, 'domainId', 'orgId'),
      },
      create_inbox: {
        procedure: 'resendEmail.createInbox',
        summary: 'create an address on a verified domain',
        required: ['domainId', 'localPart'],
        input: (a) => pick(a, 'domainId', 'localPart', 'displayName', 'assignedAgentId', 'active', 'settings', 'orgId'),
      },
      update_inbox: {
        procedure: 'resendEmail.updateInbox',
        summary: 'change display name, assigned agent, active flag or settings',
        required: ['inboxId'],
        input: (a) => pick(a, 'inboxId', 'displayName', 'assignedAgentId', 'active', 'settings', 'orgId'),
      },
      delete_inbox: {
        procedure: 'resendEmail.deleteInbox',
        summary: 'delete an inbox',
        required: ['inboxId'],
        input: (a) => pick(a, 'inboxId', 'orgId'),
      },
      send_human_reply: {
        procedure: 'resendEmail.sendHumanReply',
        summary: 'reply to an email conversation as a human, from the inbox',
        required: ['inboxId', 'reply'],
        input: (a) => ({ ...a.reply, inboxId: a.inboxId, ...pick(a, 'orgId') }),
      },
    },
  },
];

const built = buildRpcModule(specs);

export const dashboardChannelsModule: ToolModule = {
  tools: built.tools,
  handlers: built.handlers,
};
