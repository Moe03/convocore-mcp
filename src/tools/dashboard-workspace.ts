/**
 * Workspace-level tools backed by the dashboard RPC gateway: integrations, contacts,
 * agent backups, code tools, tool sharing, lead funnel generation and workspace settings.
 */

import type { ConvocoreClient } from '../convocore-client.js';
import { type ToolModule } from './helpers.js';
import { buildRpcModule, pick, type RpcToolSpec } from './rpc-tools.js';
import { zodSchema } from '../generated/schema-ref.js';
import type { ZodSchemaKey } from '../generated/zod-schemas.js';

const agentId = { type: 'string' } as const;
const orgId = { type: 'string', description: 'Optional organization scope.' } as const;
const connectionId = { type: 'string', description: 'Integration connection id (from integrations_read all_connections).' } as const;

/** Integration types of the integrations hub (same list as vg-docker INTEGRATION_TYPES). */
/** Types that can be assigned to an agent (google_drive is KB import only). */
const INTEGRATION_SETTING_TYPES = [
  'google_calendar',
  'outlook_calendar',
  'google_sheets',
  'airtable',
  'shopify',
  'calendly',
  'zoho_crm',
  'gmail',
  'outlook_mail',
  'zoho_mail',
] as const;

const INTEGRATION_TYPES = [
  'google_calendar',
  'outlook_calendar',
  'google_sheets',
  'airtable',
  'shopify',
  'calendly',
  'zoho_crm',
  'gmail',
  'outlook_mail',
  'zoho_mail',
  'google_drive',
] as const;

/** Zoho record tools: use the given connection, or the workspace's only one. */
async function withZohoConnection(
  args: Record<string, any>,
  client: ConvocoreClient,
  ...keys: string[]
): Promise<Record<string, unknown>> {
  const input = pick(args, 'connectionId', 'orgId', ...keys);
  if (input.connectionId) return input;
  const listed = await client.rpc<any>('zohoCrm.listConnections', pick(args, 'orgId'));
  const connections: Array<{ id: string; label?: string; orgName?: string }> = Array.isArray(listed)
    ? listed
    : Array.isArray(listed?.connections)
      ? listed.connections
      : [];
  if (connections.length === 1) return { ...input, connectionId: connections[0].id };
  if (connections.length === 0) {
    throw new Error('No Zoho CRM account is connected. The user connects it once on the dashboard Integrations page.');
  }
  throw new Error(
    `Several Zoho CRM accounts are connected; pass connectionId. Options: ${connections
      .map((c) => `${c.id}${c.orgName || c.label ? ` (${c.orgName || c.label})` : ''}`)
      .join(', ')}`
  );
}

const zohoModule = {
  type: 'string',
  description: 'Zoho module API name: Leads, Contacts, Accounts, Deals, or a custom module (see integrations_read zoho_modules).',
} as const;
const zohoConnection = {
  type: 'string',
  description: 'Zoho connection id. Optional when the workspace has only one Zoho account.',
} as const;
const zohoFields = {
  type: 'array',
  items: { type: 'string' },
  description: 'Field API names to return (max 50). Default for list: up to 50 standard then custom fields.',
} as const;
const zohoWorkflow = {
  type: 'boolean',
  description: 'Run the Zoho workflow rules on this change (default true).',
} as const;

const specs: RpcToolSpec[] = [
  {
    name: 'integrations_read',
    kind: 'read',
    description:
      'See every integration of the workspace exactly like the dashboard Integrations page: Google Calendar, Outlook Calendar, Google Sheets, Airtable, Shopify, Calendly, Zoho CRM, Gmail, Outlook mail, Zoho Mail and Google Drive. ' +
      'Start with all_connections (every connection id, account, and which agents use it), then agent_integrations to see and debug what one agent has configured (it lists problems such as a missing calendar, a deleted connection or an inbox whose notifications stopped). ' +
      'resources lists what can be picked for an agent: calendars (google_calendar / outlook_calendar), spreadsheet tabs + header columns (google_sheets, pass sheetId), Airtable bases then tables + fields (pass baseId), Calendly event types, Zoho CRM modules, Shopify store check. ' +
      'A first connection (OAuth login) is always made by the user on the dashboard Integrations page; everything after that is done with integrations_write and integrations_test.',
    properties: {
      agentId,
      connectionId,
      type: { type: 'string', enum: [...INTEGRATION_TYPES], description: 'For resources: which integration.' },
      types: { type: 'array', items: { type: 'string', enum: [...INTEGRATION_TYPES] }, description: 'For all_connections: only these integrations.' },
      includeAgentUsage: { type: 'boolean', description: 'For all_connections: include which agents use each connection (default true).' },
      sheetId: { type: 'string', description: 'For resources type=google_sheets: spreadsheet id → its tabs and header row.' },
      sheetTabName: { type: 'string', description: 'For resources type=google_sheets: tab whose headers to read (default first tab).' },
      headerRowIndex: { type: 'number', description: 'For resources type=google_sheets: header row number (default 1).' },
      baseId: { type: 'string', description: 'For resources type=airtable: base id → its tables and fields.' },
      moduleApiName: { type: 'string', description: 'For zoho_fields: Zoho module API name, e.g. "Leads".' },
      force: { type: 'boolean', description: 'For zoho_fields: bypass the cache.' },
      orgId,
    },
    actions: {
      all_connections: {
        procedure: 'integrationsHub.listConnections',
        summary: 'every connection of every integration, with the agents using each',
        input: (a) => pick(a, 'types', 'includeAgentUsage', 'orgId'),
      },
      agent_integrations: {
        procedure: 'integrationsHub.getAgentIntegrations',
        summary: "one agent's integrations, settings and detected problems",
        required: ['agentId'],
        input: (a) => pick(a, 'agentId', 'orgId'),
      },
      resources: {
        procedure: 'integrationsHub.listResources',
        summary: 'calendars / sheet tabs + headers / Airtable bases, tables, fields / Calendly event types / Zoho modules / Shopify check',
        required: ['type'],
        input: (a) => pick(a, 'type', 'connectionId', 'sheetId', 'sheetTabName', 'headerRowIndex', 'baseId', 'orgId'),
      },
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
      'Add, change or remove an integration on an agent, exactly like the dashboard. assign_to_agent also updates an existing setup (call it again with new settings); remove_from_agent removes it. ' +
      'settings by type — google_calendar / outlook_calendar: { connectionId, calendarId, calendarName?, timezone? ("Europe/London" or "GMT+1"), label?, description?, methods? (create-event, check-availability, lookup-events, update-event, delete-event), bookingMode? ("route" = caller picks one calendar, "union" = any free calendar), defaultCallerTimezone? ("" = same as calendar, "ask", or a zone), disableMeetLink? (google, in-person) } — up to 5 calendars per agent; remove one with { calendarId } or all with {}. ' +
      'google_sheets: { connectionId, sheetId, sheetTabName, method: "read" | "lookup" | "write", sheetName?, sheetDescription?, headerRowIndex?, headerDescriptions? {column: meaning}, identifierColumn?, identityFields? { phone, email, name, custom, customLabel } } — up to 5 sheets; remove one with { sheetId }. ' +
      'airtable: { connectionId, baseId, tableId?, method?, fieldDescriptions?, identifierField? }. shopify: { connectionId }. calendly: { connectionId }. zoho_crm: { config } (draft it with zoho_auto_configure; config.logTranscript keeps a note with the real messages, including human replies from WhatsApp/dashboard). ' +
      'gmail / outlook_mail / zoho_mail (the agent answers that inbox): { connectionId, whenToReply? (always | keywords | sentiment | manual), replyDelayMinutes?, replyRule?, humanNotifyRule?, replyLength? (short | medium | long | auto), replyTone?, keywords?, ignoreKeywords?, humanTakeoverEnabled?, humanTakeoverTimeoutMinutes?, notifyWorkspaceOwners? } — also starts inbound notifications. ' +
      'Get ids from integrations_read (all_connections, resources). After assigning, verify with integrations_read agent_integrations and integrations_test.',
    properties: {
      agentId: { type: 'string', description: 'For assign_to_agent / remove_from_agent / calendly_remove_agent / zoho_save_agent_config / zoho_remove_agent: the agent.' },
      agentIds: { type: 'array', items: { type: 'string' }, description: 'For calendly_assign_agents.' },
      connectionId,
      type: { type: 'string', enum: [...INTEGRATION_TYPES], description: 'For assign_to_agent / remove_from_agent.' },
      settings: {
        description: 'For assign_to_agent / remove_from_agent: the shape for the chosen type (assign) — each option is titled with its type.',
        anyOf: INTEGRATION_SETTING_TYPES.flatMap((t) => [
          { title: `${t} assign`, ...zodSchema(`integration.${t}.assign` as ZodSchemaKey) },
          { title: `${t} remove`, ...zodSchema(`integration.${t}.remove` as ZodSchemaKey) },
        ]),
      },
      force: { type: 'boolean', description: 'For google_calendar_disconnect: disconnect even if agents still use the connection.' },
      selectedEventTypes: { type: 'array', items: { type: 'object' }, description: 'For calendly_save_event_types: event type objects from integrations_read.' },
      config: {
        ...((zodSchema('integration.zoho_crm.assign').properties as Record<string, Record<string, unknown>>).config),
        description:
          'Zoho agent sync config (as returned by zoho_agent_config / zoho_auto_configure). To turn the message log on or off, read the current config, flip logTranscript, and save the whole config back.',
      },
      moduleApiNames: { type: 'array', items: { type: 'string' }, description: 'For zoho_auto_configure: up to 5 modules.' },
      instructions: { type: 'string', description: 'For zoho_auto_configure: what the sync should do, in plain words.' },
      phone: { type: 'string', description: 'For zoho_test_lookup: a phone number to look the person up by.' },
      email: { type: 'string', description: 'For zoho_test_lookup: an email to look the person up by.' },
      custom: { type: 'object', description: 'For zoho_test_lookup: extra lookup values.' },
      orgId,
    },
    actions: {
      assign_to_agent: {
        procedure: 'integrationsHub.configureAgent',
        summary: 'add or update an integration on an agent',
        required: ['agentId', 'type', 'settings'],
        input: (a) => ({ ...pick(a, 'agentId', 'type', 'settings', 'orgId'), action: 'assign' }),
      },
      remove_from_agent: {
        procedure: 'integrationsHub.configureAgent',
        summary: 'remove an integration (or one calendar / sheet / inbox) from an agent',
        required: ['agentId', 'type'],
        input: (a) => ({ ...pick(a, 'agentId', 'type', 'settings', 'orgId'), action: 'remove' }),
      },
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
      google_calendar_disconnect: {
        procedure: 'integrationsHub.disconnectGoogleCalendar',
        summary: 'disconnect a Google Calendar account (confirm first; refused while agents use it unless force)',
        required: ['connectionId'],
        input: (a) => pick(a, 'connectionId', 'force', 'orgId'),
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
    name: 'integrations_test',
    kind: 'write',
    description:
      "Test an agent's integration tools with the agent's REAL runtime code and settings. " +
      'inspect (no side effects): the exact tool names, descriptions and parameters the agent sees for that integration — use it to debug why the agent misuses a tool. ' +
      'run: executes one of those tools with the given args, exactly as if the agent called it, and returns its output or error. ' +
      'Safe checks first: google-calendar / outlook-calendar check-availability or lookup-events, google-sheets read / lookup, airtable read, shopify read, calendly list_event_types / check_availability. ' +
      'create / update / delete events, sheet writes and Airtable creates really happen — confirm with the user before running those.',
    required: ['agentId', 'toolId'],
    properties: {
      agentId,
      toolId: {
        type: 'string',
        enum: ['google-calendar', 'outlook-calendar', 'google-sheets', 'airtable', 'shopify', 'calendly', 'sms', 'web-search'],
      },
      toolName: { type: 'string', description: 'For run: which tool from inspect (calendars expose several, e.g. one per method).' },
      args: { type: 'object', description: 'For run: the tool arguments, matching the parameters from inspect.' },
      orgId,
    },
    actions: {
      inspect: {
        procedure: 'integrationsHub.testAgentTool',
        summary: 'what the agent sees for this integration (names, descriptions, parameters)',
        input: (a) => ({ ...pick(a, 'agentId', 'toolId', 'orgId'), mode: 'inspect' }),
      },
      run: {
        procedure: 'integrationsHub.testAgentTool',
        summary: 'run one tool with args, as the agent would',
        input: (a) => ({ ...pick(a, 'agentId', 'toolId', 'toolName', 'args', 'orgId'), mode: 'run' }),
      },
    },
  },
  {
    name: 'agency_branding',
    kind: 'write',
    description:
      "Brand the caller's own whitelabel agency (client portal + login page), like the dashboard Agency settings. Never another agency; whitelabel clients cannot use it. " +
      'get: current branding, login page and domain status (secrets and provider keys are never returned). ' +
      'update_branding { branding }: only the fields sent change — name, logoUrl (round avatar), darkLogoUrl, wideLogoUrl, wideLogoDarkUrl, faviconUrl, brandingText (markdown), primaryColorHex (#RRGGBB, builds the whole palette), themeType (light | dark), themeVariant (default | bordered | flat | faded), themeColorUsage (gradient | colorful | plain), googleFontStack (Google Fonts families in fallback order, e.g. ["Rubik","Almarai"] = Rubik for Latin/digits, Almarai for Arabic), googleFontWeights (default [400,500,700]), customCSS, defaultLanguage (e.g. "ar" — also sets right-to-left), allowedLanguages, mainWebsite, supportEmail, tosPage, privacyPolicyPage, enableClientSignup, disablePasswordLogin. All URLs must be https. ' +
      'update_login_page { loginPage }: merges into the login page — layout (centered | split), mediaSide (start | end: logical, start = left in LTR / right in RTL), mediaUrl, mediaFit (cover | contain), headline (≤120), subtext (≤300), textPlacement (overlay | below), background { type: theme | color | gradient | image, color, from, to, angle 0-360, imageUrl }, card { style: elevated | bordered | flat | glass, radius: sm | md | lg }, mobileMedia (stack | hide), logo (square | wide | none). Split layout without mediaUrl shows a gradient from the primary colour. reset: true clears it. ' +
      'upload_asset { kind, sourceUrl | base64 }: copies an image onto the Convocore CDN and returns its URL (then pass it to update_branding / update_login_page). kinds: logo, dark_logo, wide_logo, wide_logo_dark (≤1 MB png/jpg/webp/svg), favicon (≤256 KB png/ico/svg), login_media, login_background (≤2 MB webp/png/jpg/svg). ' +
      'Custom domains are claimed and verified on the dashboard only. Confirm the brand values with the user before changing a live portal.',
    properties: {
      branding: { ...zodSchema('agencyBrandingPatch'), description: 'For update_branding: only the fields to change.' },
      loginPage: { ...zodSchema('agencyLoginPagePatch'), description: 'For update_login_page: only the login page fields to change (merged).' },
      reset: { type: 'boolean', description: 'For update_login_page: clear the login page customisation.' },
      kind: {
        type: 'string',
        enum: ['logo', 'dark_logo', 'wide_logo', 'wide_logo_dark', 'favicon', 'login_media', 'login_background'],
        description: 'For upload_asset.',
      },
      sourceUrl: { type: 'string', description: 'For upload_asset: public https URL of the image.' },
      base64: { type: 'string', description: 'For upload_asset: the image as base64 (alternative to sourceUrl).' },
    },
    actions: {
      get: {
        procedure: 'agencyBranding.get',
        summary: 'current branding, login page and domain status',
        input: () => ({}),
      },
      update_branding: {
        procedure: 'agencyBranding.updateBranding',
        summary: 'change logos, colour, fonts, language, CSS, links, signup/login options',
        required: ['branding'],
        input: (a) => pick(a, 'branding'),
      },
      update_login_page: {
        procedure: 'agencyBranding.updateLoginPage',
        summary: 'customise the client login page (layout, media, text, background, card)',
        input: (a) => pick(a, 'loginPage', 'reset'),
      },
      upload_asset: {
        procedure: 'agencyBranding.uploadAsset',
        summary: 'put a logo / favicon / login image on the CDN and get its URL',
        required: ['kind'],
        input: (a) => pick(a, 'kind', 'sourceUrl', 'base64'),
      },
    },
  },
  {
    name: 'zoho_crm_records_read',
    kind: 'read',
    description:
      'Browse and search records in the connected Zoho CRM: leads, contacts, deals, accounts or any custom module. ' +
      'list pages through a module (perPage up to 200; pass info.nextPageToken as pageToken past 2000 records). ' +
      'search uses Zoho criteria, e.g. "(Lead_Status:equals:New)" or "((Lead_Source:equals:Chat)and(Created_Time:greater_than:2026-10-01T00:00:00+00:00))"; ' +
      'operators: equals, not_equal, starts_with, in, greater_than, less_than, between. ' +
      'query runs COQL for anything else, e.g. "select Last_Name, Email, Lead_Status from Leads where Lead_Status = \'New\' order by Created_Time desc limit 200" (a where clause is required; limit max 2000, use "limit 200, 200" to page). ' +
      'Use integrations_read zoho_fields for the field API names and picklist values.',
    properties: {
      connectionId: zohoConnection,
      moduleApiName: zohoModule,
      fields: zohoFields,
      page: { type: 'number', description: 'For list / search: page number (default 1).' },
      perPage: { type: 'number', description: 'For list / search: records per page, max 200 (default 50).' },
      pageToken: { type: 'string', description: 'For list: info.nextPageToken from the previous page (needed past 2000 records).' },
      sortBy: { type: 'string', enum: ['id', 'Created_Time', 'Modified_Time'], description: 'For list.' },
      sortOrder: { type: 'string', enum: ['asc', 'desc'], description: 'For list.' },
      cvid: { type: 'string', description: 'For list: id of a Zoho custom view to list from.' },
      criteria: { type: 'string', description: 'For search: Zoho criteria expression.' },
      word: { type: 'string', description: 'For search: free-text search.' },
      email: { type: 'string', description: 'For search: exact email.' },
      phone: { type: 'string', description: 'For search: phone number.' },
      query: { type: 'string', description: 'For query: a COQL SELECT statement.' },
      recordId: { type: 'string', description: 'For get: the Zoho record id.' },
      orgId,
    },
    actions: {
      list: {
        procedure: 'zohoCrm.listRecords',
        summary: 'one page of records of a module, newest first if sortBy=Created_Time sortOrder=desc',
        required: ['moduleApiName'],
        input: (a, client) =>
          withZohoConnection(a, client, 'moduleApiName', 'fields', 'page', 'perPage', 'pageToken', 'sortBy', 'sortOrder', 'cvid'),
      },
      search: {
        procedure: 'zohoCrm.searchRecords',
        summary: 'records matching criteria / word / email / phone',
        required: ['moduleApiName'],
        input: (a, client) =>
          withZohoConnection(a, client, 'moduleApiName', 'criteria', 'word', 'email', 'phone', 'fields', 'page', 'perPage'),
      },
      query: {
        procedure: 'zohoCrm.queryRecords',
        summary: 'COQL SELECT for filters, sorting and counts search cannot do',
        required: ['query'],
        input: (a, client) => withZohoConnection(a, client, 'query'),
      },
      get: {
        procedure: 'zohoCrm.getRecord',
        summary: 'one full record',
        required: ['moduleApiName', 'recordId'],
        input: (a, client) => withZohoConnection(a, client, 'moduleApiName', 'recordId', 'fields'),
      },
    },
  },
  {
    name: 'zoho_crm_records_write',
    kind: 'write',
    description:
      'Create, update, upsert or delete records in the connected Zoho CRM (leads, contacts, deals, accounts, custom modules), up to 100 per call, and add notes. ' +
      'Records use Zoho field API names, e.g. { "Last_Name": "Smith", "Email": "a@b.com", "Lead_Status": "New" }; picklist values must match exactly (integrations_read zoho_fields). ' +
      'The result has one entry per record (success, id, or the Zoho error code and field), so partial failures are visible. ' +
      'delete moves records to the Zoho recycle bin; confirm with the user before deleting or bulk-updating.',
    required: ['moduleApiName'],
    properties: {
      connectionId: zohoConnection,
      moduleApiName: zohoModule,
      records: {
        type: 'array',
        items: { type: 'object' },
        description: 'For create / update / upsert: up to 100 records. update needs "id" on each record.',
      },
      duplicateCheckFields: {
        type: 'array',
        items: { type: 'string' },
        description: 'For upsert: fields that identify an existing record, e.g. ["Email"]. Default: the module\'s own duplicate check.',
      },
      recordIds: { type: 'array', items: { type: 'string' }, description: 'For delete: up to 100 record ids.' },
      recordId: { type: 'string', description: 'For add_note: the record to attach the note to.' },
      title: { type: 'string', description: 'For add_note.' },
      content: { type: 'string', description: 'For add_note.' },
      triggerWorkflow: zohoWorkflow,
      orgId,
    },
    actions: {
      create: {
        procedure: 'zohoCrm.writeRecords',
        summary: 'create records',
        required: ['records'],
        input: async (a, client) => ({
          ...(await withZohoConnection(a, client, 'moduleApiName', 'records', 'triggerWorkflow')),
          operation: 'create',
        }),
      },
      update: {
        procedure: 'zohoCrm.writeRecords',
        summary: 'update records by id (only the fields given change)',
        required: ['records'],
        input: async (a, client) => ({
          ...(await withZohoConnection(a, client, 'moduleApiName', 'records', 'triggerWorkflow')),
          operation: 'update',
        }),
      },
      upsert: {
        procedure: 'zohoCrm.writeRecords',
        summary: 'insert or update by duplicateCheckFields; each result says insert or update',
        required: ['records'],
        input: async (a, client) => ({
          ...(await withZohoConnection(a, client, 'moduleApiName', 'records', 'duplicateCheckFields', 'triggerWorkflow')),
          operation: 'upsert',
        }),
      },
      delete: {
        procedure: 'zohoCrm.deleteRecords',
        summary: 'delete records (confirm first)',
        required: ['recordIds'],
        input: (a, client) => withZohoConnection(a, client, 'moduleApiName', 'recordIds', 'triggerWorkflow'),
      },
      add_note: {
        procedure: 'zohoCrm.addNote',
        summary: 'attach a note to a record',
        required: ['recordId', 'title', 'content'],
        input: (a, client) => withZohoConnection(a, client, 'moduleApiName', 'recordId', 'title', 'content'),
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
      'Change workspace settings: name, photo and team members; form-submission notification emails on/off; the workspace\'s own AI provider keys.',
    properties: {
      workspaceName: { type: 'string' },
      workspacePhotoURL: { type: 'string' },
      workspaceEmails: { type: 'array', items: { type: 'string' }, description: 'Team member emails (the full list — omitted members lose access).' },
      usersPerms: {
        type: 'array',
        items: { type: 'object' },
        description: 'Per-member role and permissions: [{ email, role: admin|member, permissions[] }].',
      },
      formSubmitEmailsEnabled: {
        type: 'boolean',
        description: 'For set_form_submit_emails: false silences every "New form submitted" / rating email for all agents in the workspace. Default (unset) is on.',
      },
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
      set_form_submit_emails: {
        procedure: 'saveWorkspaceTeamAndProfile',
        summary: 'turn the workspace-wide "New form submitted" / rating notification emails on or off (default on); per-agent override is vg_uiEngineFormNotifyConfig.enabled',
        required: ['formSubmitEmailsEnabled'],
        input: (a) => pick(a, 'formSubmitEmailsEnabled'),
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
