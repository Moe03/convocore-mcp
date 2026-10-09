/**
 * Workspace-level tools backed by the dashboard RPC gateway: integrations, contacts,
 * agent backups, code tools, tool sharing, lead funnel generation and workspace settings.
 */

import { type ToolModule } from './helpers.js';
import { buildRpcModule, pick, type RpcToolSpec } from './rpc-tools.js';

const agentId = { type: 'string' } as const;
const orgId = { type: 'string', description: 'Optional organization scope.' } as const;
const connectionId = { type: 'string', description: 'Integration connection id (from the *_connections action).' } as const;

const specs: RpcToolSpec[] = [
  {
    name: 'integrations_read',
    kind: 'read',
    description:
      'Read the calendar / CRM integrations of the workspace: Calendly, Outlook calendar and Zoho CRM. The first connection (OAuth login) is made by the user on the dashboard Integrations page; everything after that can be configured here.',
    properties: {
      agentId,
      connectionId,
      moduleApiName: { type: 'string', description: 'For zoho_fields: Zoho module API name, e.g. "Leads".' },
      force: { type: 'boolean', description: 'For zoho_fields: bypass the cache.' },
      orgId,
    },
    actions: {
      calendly_event_types: {
        procedure: 'calendly.listEventTypes',
        summary: 'Calendly event types that can be offered by agents',
        input: (a) => pick(a, 'connectionId', 'orgId'),
      },
      outlook_connections: {
        procedure: 'outlookCalendar.listConnections',
        summary: 'connected Outlook accounts',
        input: (a) => pick(a, 'orgId'),
      },
      outlook_calendars: {
        procedure: 'outlookCalendar.listCalendars',
        summary: 'calendars of a connected Outlook account',
        required: ['connectionId'],
        input: (a) => pick(a, 'connectionId', 'orgId'),
      },
      zoho_connections: {
        procedure: 'zohoCrm.listConnections',
        summary: 'connected Zoho CRM accounts',
        input: (a) => pick(a, 'orgId'),
      },
      zoho_modules: {
        procedure: 'zohoCrm.listModules',
        summary: 'Zoho modules (Leads, Contacts, Deals…)',
        required: ['connectionId'],
        input: (a) => pick(a, 'connectionId', 'orgId'),
      },
      zoho_fields: {
        procedure: 'zohoCrm.getFields',
        summary: 'fields of a Zoho module',
        required: ['connectionId', 'moduleApiName'],
        input: (a) => pick(a, 'connectionId', 'moduleApiName', 'force', 'orgId'),
      },
      zoho_agent_config: {
        procedure: 'zohoCrm.getAgentConfig',
        summary: 'how an agent syncs with Zoho (lookup and field mapping)',
        required: ['agentId'],
        input: (a) => pick(a, 'agentId', 'orgId'),
      },
      zoho_assigned_agents: {
        procedure: 'zohoCrm.listAssignedAgents',
        summary: 'agents that use Zoho CRM',
        input: (a) => pick(a, 'orgId'),
      },
    },
  },
  {
    name: 'integrations_write',
    kind: 'write',
    description:
      'Configure Calendly, Outlook calendar and Zoho CRM for agents, once the account is connected. For Zoho the usual flow is zoho_auto_configure (drafts a config) → zoho_test_lookup (try it with a real phone / email) → zoho_save_agent_config.',
    properties: {
      agentId,
      agentIds: { type: 'array', items: { type: 'string' }, description: 'For calendly_assign_agents.' },
      connectionId,
      selectedEventTypes: { type: 'array', items: { type: 'object' }, description: 'For calendly_save_event_types: event type objects from integrations_read.' },
      config: { type: 'object', description: 'Zoho agent sync config (shape as returned by zoho_agent_config / zoho_auto_configure).' },
      moduleApiNames: { type: 'array', items: { type: 'string' }, description: 'For zoho_auto_configure: up to 5 modules.' },
      instructions: { type: 'string', description: 'For zoho_auto_configure: what the sync should do, in plain words.' },
      phone: { type: 'string' },
      email: { type: 'string' },
      custom: { type: 'object', description: 'For zoho_test_lookup: extra lookup values.' },
      orgId,
    },
    actions: {
      calendly_save_event_types: {
        procedure: 'calendly.saveEventTypes',
        summary: 'choose which Calendly event types agents may offer',
        required: ['connectionId', 'selectedEventTypes'],
        input: (a) => pick(a, 'connectionId', 'selectedEventTypes', 'orgId'),
      },
      calendly_assign_agents: {
        procedure: 'calendly.assignToAgents',
        summary: 'give agents the Calendly booking ability',
        required: ['connectionId', 'agentIds'],
        input: (a) => pick(a, 'connectionId', 'agentIds', 'orgId'),
      },
      calendly_remove_agent: {
        procedure: 'calendly.removeFromAgent',
        summary: 'remove Calendly from an agent',
        required: ['agentId'],
        input: (a) => pick(a, 'agentId'),
      },
      outlook_disconnect: {
        procedure: 'outlookCalendar.disconnect',
        summary: 'disconnect an Outlook account (confirm first)',
        required: ['connectionId'],
        input: (a) => pick(a, 'connectionId', 'orgId'),
      },
      zoho_disconnect: {
        procedure: 'zohoCrm.disconnect',
        summary: 'disconnect a Zoho account (confirm first)',
        required: ['connectionId'],
        input: (a) => pick(a, 'connectionId', 'orgId'),
      },
      zoho_auto_configure: {
        procedure: 'zohoCrm.autoConfigure',
        summary: 'let AI draft a Zoho sync config from the CRM fields (does not save)',
        required: ['connectionId'],
        input: (a) => ({ ...pick(a, 'connectionId', 'moduleApiNames', 'instructions', 'orgId'), ...(a.config ? { existing: a.config } : {}) }),
      },
      zoho_test_lookup: {
        procedure: 'zohoCrm.testLookup',
        summary: 'try a config against the CRM with a phone / email, without saving',
        required: ['config'],
        input: (a) => pick(a, 'config', 'phone', 'email', 'custom', 'orgId'),
      },
      zoho_save_agent_config: {
        procedure: 'zohoCrm.saveAgentConfig',
        summary: 'save the Zoho sync config on an agent',
        required: ['agentId', 'config'],
        input: (a) => pick(a, 'agentId', 'config', 'orgId'),
      },
      zoho_remove_agent: {
        procedure: 'zohoCrm.removeFromAgent',
        summary: 'remove Zoho CRM from an agent',
        required: ['agentId'],
        input: (a) => pick(a, 'agentId', 'orgId'),
      },
    },
  },
  {
    name: 'contacts_read',
    kind: 'read',
    description:
      'Read contacts (identities): one person recognised across channels (WhatsApp, Instagram, web chat, calls…). A contact groups that person\'s conversations. Different from leads_read (the CRM lead list).',
    required: ['agentId'],
    properties: {
      agentId,
      identityId: { type: 'string', description: 'Contact id (UUID).' },
      search: { type: 'string' },
      multiChannelOnly: { type: 'boolean', description: 'For list: only contacts seen on more than one channel.' },
      page: { type: 'number' },
      limit: { type: 'number', description: 'Default 20, max 100.' },
    },
    actions: {
      list: {
        procedure: 'identityRouter.listAgentIdentities',
        summary: 'contacts of the agent, with search',
        input: (a) => pick(a, 'agentId', 'page', 'limit', 'search', 'multiChannelOnly'),
      },
      get: {
        procedure: 'identityRouter.getContactIdentity',
        summary: 'one contact profile with its channels and consent',
        required: ['identityId'],
        input: (a) => pick(a, 'agentId', 'identityId'),
      },
      timeline: {
        procedure: 'identityRouter.getContactTimeline',
        summary: 'every conversation of the contact across channels, in order',
        required: ['identityId'],
        input: (a) => pick(a, 'agentId', 'identityId'),
      },
      audit_log: {
        procedure: 'identityRouter.getIdentityAuditLog',
        summary: 'merge / unmerge / consent history of the contact',
        required: ['identityId'],
        input: (a) => pick(a, 'agentId', 'identityId', 'page', 'limit'),
      },
    },
  },
  {
    name: 'contacts_write',
    kind: 'write',
    description:
      'Merge, split, update consent of, or delete a contact. merge and delete cannot be undone automatically — confirm with the user.',
    required: ['agentId'],
    properties: {
      agentId,
      identityId: { type: 'string' },
      sourceIdentityId: { type: 'string', description: 'For merge: the contact that disappears.' },
      targetIdentityId: { type: 'string', description: 'For merge: the contact that is kept.' },
      convoIds: { type: 'array', items: { type: 'string' }, description: 'For unmerge: conversations to split into a new contact.' },
      consentStatus: { type: 'string', enum: ['unknown', 'granted', 'denied', 'withdrawn'] },
      consentSource: { type: 'string', description: 'Where the consent came from, e.g. "web form".' },
    },
    actions: {
      merge: {
        procedure: 'identityRouter.manualMergeIdentities',
        summary: 'merge two contacts that are the same person',
        required: ['sourceIdentityId', 'targetIdentityId'],
        input: (a) => pick(a, 'agentId', 'sourceIdentityId', 'targetIdentityId'),
      },
      unmerge: {
        procedure: 'identityRouter.manualUnmergeIdentity',
        summary: 'split conversations out of a contact',
        required: ['identityId', 'convoIds'],
        input: (a) => pick(a, 'agentId', 'identityId', 'convoIds'),
      },
      set_consent: {
        procedure: 'identityRouter.updateIdentityConsent',
        summary: 'record the contact marketing consent',
        required: ['identityId', 'consentStatus'],
        input: (a) => pick(a, 'agentId', 'identityId', 'consentStatus', 'consentSource'),
      },
      delete: {
        procedure: 'identityRouter.deleteIdentity',
        summary: 'delete the contact record',
        required: ['identityId'],
        input: (a) => pick(a, 'agentId', 'identityId'),
      },
    },
  },
  {
    name: 'agent_backups_read',
    kind: 'read',
    description:
      'Read the backups and prompt history of an agent. Check here before a risky change, or to find a version to go back to.',
    required: ['agentId'],
    properties: { agentId },
    actions: {
      list: { procedure: 'getAgentBackups', summary: 'saved backups (id, date, author)', input: (a) => pick(a, 'agentId') },
      latest: { procedure: 'getLatestBackup', summary: 'the most recent backup', input: (a) => pick(a, 'agentId') },
      prompt_history: {
        procedure: 'getAssistChatHistory',
        summary: 'prompt-assistant history with the prompt snapshots that can be restored',
        input: (a) => pick(a, 'agentId'),
      },
    },
  },
  {
    name: 'agent_backups_write',
    kind: 'write',
    description:
      'Back up or roll back an agent. Take a backup (create) BEFORE large edits with update_agent. restore and revert_prompt overwrite the current agent — confirm with the user and create a backup first.',
    required: ['agentId'],
    properties: {
      agentId,
      backupId: { type: 'string', description: 'For restore (from agent_backups_read list).' },
      snapshotId: { type: 'string', description: 'For revert_prompt (from prompt_history).' },
      enabled: { type: 'boolean', description: 'For set_prompt_caching.' },
    },
    actions: {
      create: {
        procedure: 'saveAgentBackup',
        summary: 'save a backup of the agent as it is now',
        input: (a) => pick(a, 'agentId'),
      },
      restore: {
        procedure: 'revertToBackup',
        summary: 'replace the agent with a saved backup',
        required: ['backupId'],
        input: (a) => pick(a, 'agentId', 'backupId'),
      },
      revert_prompt: {
        procedure: 'revertToPromptSnapshot',
        summary: 'put back an earlier version of the prompt only',
        required: ['snapshotId'],
        input: (a) => pick(a, 'agentId', 'snapshotId'),
      },
      set_prompt_caching: {
        procedure: 'setAgentSystemPromptCacheEnabled',
        summary: 'turn provider prompt caching on or off (cheaper, faster replies for long prompts)',
        required: ['enabled'],
        input: (a) => pick(a, 'agentId', 'enabled'),
      },
    },
  },
  {
    name: 'code_tools',
    kind: 'write',
    description:
      'Write, check and run CODE tools: JavaScript that runs inside the agent (no server needed), with declared input and output variables. For tools that call an HTTP API use create_agent_tool. Flow: validate → run with sample inputVars → save.',
    properties: {
      agentId,
      code: { type: 'string', description: 'JavaScript source of the tool.' },
      inputs: { type: 'array', items: { type: 'object' }, description: 'Declared inputs: [{ key, type: string|number|boolean|object, required? }].' },
      outputs: { type: 'array', items: { type: 'object' }, description: 'Declared outputs, same shape.' },
      paths: { type: 'array', items: { type: 'string' }, description: 'Named exit paths, if the tool branches.' },
      strict: { type: 'boolean', description: 'For validate / run: default true (outputs must match the contract).' },
      inputVars: { type: 'object', description: 'For run: sample values by input key.' },
      userRequest: { type: 'string', description: 'For ai_edit: what to change, in plain words.' },
      toolName: { type: 'string' },
      toolDescription: { type: 'string' },
      tool: {
        type: 'object',
        description:
          'For save: the tool definition — name, description, variablesIds / fields, and codeExecution: { enabled: true, code }. Include id to update an existing tool.',
      },
    },
    actions: {
      validate: {
        procedure: 'codeTool.validate',
        summary: 'check syntax and the input/output contract without running',
        required: ['code'],
        input: (a) => pick(a, 'code', 'inputs', 'outputs', 'paths', 'strict'),
      },
      run: {
        procedure: 'codeTool.run',
        summary: 'run the code once with sample inputs and return outputs / logs / errors',
        required: ['code'],
        input: (a) => pick(a, 'code', 'inputs', 'outputs', 'paths', 'strict', 'inputVars'),
      },
      ai_edit: {
        procedure: 'codeTool.aiEdit',
        summary: 'have AI rewrite the code for a request (returns code; does not save)',
        required: ['agentId', 'code', 'userRequest'],
        input: (a) => ({
          ...pick(a, 'agentId', 'toolName', 'toolDescription', 'userRequest', 'inputs', 'outputs', 'paths'),
          currentCode: a.code,
        }),
      },
      save: {
        procedure: 'codeTool.upsert',
        summary: 'create or update the code tool on the agent',
        required: ['agentId', 'tool'],
        input: (a) => pick(a, 'agentId', 'tool'),
      },
    },
  },
  {
    name: 'tool_sharing',
    kind: 'write',
    description:
      'Copy a tool to other agents or share one tool across the workspace. A COPY is independent afterwards; a SHARED tool stays one tool used by many agents, so editing it changes all of them.',
    properties: {
      toolId: { type: 'string' },
      agentId: { type: 'string', description: 'Agent that owns / uses the tool.' },
      targetAgentId: { type: 'string' },
      targetAgentIds: { type: 'array', items: { type: 'string' }, description: 'Up to 40 agents.' },
      tool: { type: 'object', description: 'Full tool definition (from get_agent_tool) where the action needs it.' },
      variables: { type: 'array', items: { type: 'object' }, description: 'Variables the tool uses, to copy with it.' },
      access: { type: 'string', enum: ['private', 'workspace', 'agents', 'clients'] },
      agentIds: { type: 'array', items: { type: 'string' }, description: 'For set_access=agents.' },
      orgIds: { type: 'array', items: { type: 'string' }, description: 'For set_access=clients.' },
      scope: { type: 'string', enum: ['workspace', 'org'] },
      orgId: { type: 'string' },
      confirmOverwrite: { type: 'boolean' },
    },
    actions: {
      copy: {
        procedure: 'toolSharing.copyTool',
        summary: 'copy a tool to one agent',
        required: ['toolId', 'targetAgentId'],
        input: (a) => ({ sourceToolId: a.toolId, targetAgentId: a.targetAgentId }),
      },
      copy_to_agents: {
        procedure: 'toolSharing.copyToolToAgents',
        summary: 'copy a tool (and its variables) to many agents',
        required: ['toolId', 'targetAgentIds', 'tool'],
        input: (a) => ({ sourceToolId: a.toolId, ...pick(a, 'targetAgentIds', 'tool', 'variables') }),
      },
      set_access: {
        procedure: 'toolSharing.setGlobalToolAccess',
        summary: 'choose who can use the tool: private, whole workspace, chosen agents or client orgs',
        required: ['toolId', 'agentId', 'tool', 'access'],
        input: (a) => pick(a, 'toolId', 'agentId', 'tool', 'access', 'agentIds', 'orgIds', 'confirmOverwrite'),
      },
      publish_workspace: {
        procedure: 'toolSharing.publishWorkspaceTool',
        summary: 'publish the tool to every agent of the workspace',
        required: ['toolId', 'agentId', 'tool'],
        input: (a) => pick(a, 'toolId', 'agentId', 'tool', 'confirmOverwrite'),
      },
      make_private: {
        procedure: 'toolSharing.makeToolPrivate',
        summary: 'stop sharing: the tool belongs to one agent again',
        required: ['toolId', 'agentId'],
        input: (a) => pick(a, 'toolId', 'agentId'),
      },
      share: {
        procedure: 'toolSharing.shareTool',
        summary: 'share an existing tool with the workspace or an org',
        required: ['toolId', 'scope'],
        input: (a) => pick(a, 'toolId', 'scope', 'orgId'),
      },
      update_shared: {
        procedure: 'toolSharing.updateSharedTool',
        summary: 'edit a shared tool (affects every agent using it)',
        required: ['toolId', 'tool'],
        input: (a) => pick(a, 'toolId', 'tool'),
      },
      unassign_shared: {
        procedure: 'toolSharing.unassignSharedTool',
        summary: 'remove a shared tool from one agent',
        required: ['toolId', 'agentId'],
        input: (a) => pick(a, 'toolId', 'agentId'),
      },
      delete_shared: {
        procedure: 'toolSharing.deleteSharedTool',
        summary: 'delete a shared tool for everyone (confirm first)',
        required: ['toolId'],
        input: (a) => pick(a, 'toolId'),
      },
    },
  },
  {
    name: 'generate_lead_funnel',
    kind: 'read',
    description:
      'Draft lead-funnel steps (qualification stages and scoring) from an agent prompt with AI. Returns the suggested steps only — save them with update_agent funnelConfig. Pass the agent prompt text; get it from get_agent if needed.',
    required: ['agentPrompt'],
    properties: {
      agentPrompt: { type: 'string', description: 'The agent instructions to analyse.' },
      userNotes: { type: 'string', description: 'Extra guidance, e.g. what a hot lead means for this business.' },
      existingSteps: { type: 'array', items: { type: 'object' }, description: 'Current steps to refine instead of starting over.' },
    },
    actions: {
      generate: {
        procedure: 'funnel.autoGenerate',
        summary: 'suggest funnel steps',
        input: (a) => pick(a, 'agentPrompt', 'userNotes', 'existingSteps'),
      },
    },
  },
  {
    name: 'workspace_read',
    kind: 'read',
    description:
      'Read workspace-level data: activity and channel webhook logs (to debug "the bot did not reply"), credit balance and plan quota.',
    properties: {
      agentId: { type: 'string', description: 'For logs: only this agent.' },
      kind: { type: 'string', enum: ['all', 'webhook', 'event'], description: 'For logs: webhook = channel webhooks, event = workspace activity.' },
      channel: { type: 'string', description: 'For logs, e.g. whatsapp, instagram, messenger.' },
      status: { type: 'string' },
      search: { type: 'string' },
      page: { type: 'number' },
      limit: { type: 'number', description: 'Default 10, max 100.' },
      logId: { type: 'number', description: 'For log.' },
      traceId: { type: 'string', description: 'For log_timeline (from a log entry).' },
    },
    actions: {
      logs: {
        procedure: 'getLogs',
        summary: 'recent logs, filterable',
        input: (a) => pick(a, 'agentId', 'page', 'limit', 'kind', 'channel', 'status', 'search'),
      },
      log: {
        procedure: 'getLog',
        summary: 'one log entry in full',
        required: ['logId'],
        input: (a) => ({ id: a.logId }),
      },
      log_timeline: {
        procedure: 'getLogTimeline',
        summary: 'every step of one inbound message, from webhook to reply',
        required: ['traceId'],
        input: (a) => pick(a, 'traceId'),
      },
      credits: { procedure: 'getWorkspaceCredits', summary: 'credit balance', input: () => ({}) },
      quota: { procedure: 'getV2QuotaSummary', summary: 'plan limits and current usage', input: () => ({}) },
    },
  },
  {
    name: 'workspace_write',
    kind: 'write',
    description:
      'Change workspace settings: name, photo and team members; automatic credit top-up; the workspace\'s own AI provider keys.',
    properties: {
      workspaceName: { type: 'string' },
      workspacePhotoURL: { type: 'string' },
      workspaceEmails: { type: 'array', items: { type: 'string' }, description: 'Team member emails (the full list — omitted members lose access).' },
      usersPerms: {
        type: 'array',
        items: { type: 'object' },
        description: 'Per-member role and permissions: [{ email, role: admin|member, permissions[] }].',
      },
      autoBilling: { type: 'boolean' },
      threshold: { type: 'number', description: 'For set_auto_billing: credit level that triggers a top-up.' },
      keys: {
        type: 'object',
        description:
          'For set_provider_keys: e.g. { openai_api_key, anthropic_api_key, google_genai_api_key, groq_api_key, deepseek_api_key, xai_api_key, elevenlabs_api_key, deepgram_api_key, cartesia_api_key, azure_api_key, azure_region, langsmith_api_key }.',
      },
    },
    actions: {
      update_team_profile: {
        procedure: 'saveWorkspaceTeamAndProfile',
        summary: 'change workspace name / photo / team (read the current team on the dashboard first: the list replaces the old one)',
        input: (a) => pick(a, 'workspaceName', 'workspacePhotoURL', 'workspaceEmails', 'usersPerms'),
      },
      set_auto_billing: {
        procedure: 'postChangeAutoBilling',
        summary: 'turn automatic credit top-up on or off — ON charges the saved card automatically; confirm with the user',
        required: ['autoBilling'],
        input: (a) => pick(a, 'autoBilling', 'threshold'),
      },
      set_provider_keys: {
        procedure: 'setupSecrets',
        summary: 'store the workspace own AI provider API keys. Keys typed in chat pass through this conversation: prefer the dashboard, and never repeat a key back',
        required: ['keys'],
        input: (a) => {
          const keys: Record<string, unknown> = { ...a.keys };
          // The API spells this field without the "o".
          if (keys.anthropic_api_key !== undefined) {
            keys.anthrpic_api_key = keys.anthropic_api_key;
            delete keys.anthropic_api_key;
          }
          return keys;
        },
      },
    },
  },
];

const built = buildRpcModule(specs);

export const dashboardWorkspaceModule: ToolModule = {
  tools: built.tools,
  handlers: built.handlers,
};
