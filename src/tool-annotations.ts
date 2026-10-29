/**
 * Tool titles and safety hints for every tool in the catalog.
 *
 * MCP hosts (and the Claude Connectors Directory review) need a human-readable `annotations.title` plus
 * `readOnlyHint` / `destructiveHint` on each tool. Domain modules in src/tools set their own hints; the core
 * tools in index.ts get theirs from CORE_TOOL_HINTS. test/tool-annotations.test.mjs fails when a tool is
 * missing either, so a new tool needs an entry here.
 */

import type { Tool } from '@modelcontextprotocol/sdk/types.js';
import { CREATE_ANNOTATIONS, READ_ANNOTATIONS, WRITE_ANNOTATIONS } from './tools/helpers.js';

/** Pure reads: no data is changed. */
const READ = READ_ANNOTATIONS;
/** Writes that only add or edit (reversible, nothing is removed or sent outside). */
const EDIT = CREATE_ANNOTATIONS;
/** Deletes, wholesale replacements, real-world side effects that cannot be undone. */
const DESTRUCTIVE = WRITE_ANNOTATIONS;

/** Hints for the core tools defined inline in index.ts (domain modules declare their own). */
export const CORE_TOOL_HINTS: Record<string, Tool['annotations']> = {
  create_agent: EDIT,
  create_agent_from_template: EDIT,
  get_agent: READ,
  update_agent: DESTRUCTIVE,
  patch_agent_prompt: DESTRUCTIVE,
  delete_agent: DESTRUCTIVE,
  list_agents: READ,
  search_agents: READ,
  export_agent: READ,
  import_agent: EDIT,
  get_agent_usage: READ,
  list_conversations: READ,
  create_conversation: EDIT,
  get_conversation: READ,
  update_conversation: EDIT,
  update_conversation_messages: DESTRUCTIVE,
  delete_conversation: DESTRUCTIVE,
  export_all_conversations: READ,
  export_conversation: READ,
  assign_conversation: EDIT,
  get_conversations_bulk: READ,
  query_conversations: READ,
  get_agent_usage_bulk: READ,
  get_kb_docs_bulk: READ,
  create_kb_from_urls: EDIT,
  create_kb_doc: EDIT,
  list_kb_docs: READ,
  get_kb_doc: READ,
  update_kb_doc: DESTRUCTIVE,
  patch_kb_doc: DESTRUCTIVE,
  delete_kb_doc: DESTRUCTIVE,
  get_kb_stats: READ,
  scrape_url: READ,
  get_website_embed_code: READ,
  get_widget_css_styling_guide: READ,
  get_agent_custom_css: READ,
  inspect_file: READ,
  read_text_file: READ,
  read_pdf: READ,
  read_docx: READ,
  read_spreadsheet: READ,
  read_image: READ,
  import_file_to_kb: EDIT,
  update_agent_custom_css: DESTRUCTIVE,
  sleep: READ,
  run_command: DESTRUCTIVE,
  list_voice_providers: READ,
  list_voice_models: READ,
  search_voices: READ,
  list_provider_voices: READ,
  get_voice: READ,
  import_twilio_number: EDIT,
  release_twilio_number: DESTRUCTIVE,
  check_twilio_number: EDIT,
  sync_sms_twilio_number: EDIT,
  interact_with_agent: EDIT,
  get_ui_engine_spec: READ,
  get_channel_integration_spec: READ,
  get_pricing_info: READ,
};

/** Human-readable title for every tool (shown by hosts instead of the snake_case name). */
export const TOOL_TITLES: Record<string, string> = {
  // Agents
  create_agent: 'Create agent (raw)',
  create_agent_from_template: 'Create agent from template',
  get_agent: 'Get agent',
  update_agent: 'Update agent',
  patch_agent_prompt: 'Edit agent prompt',
  delete_agent: 'Delete agent',
  list_agents: 'List agents',
  search_agents: 'Search agents',
  export_agent: 'Export agent',
  import_agent: 'Import agent',
  clone_agent: 'Clone agent',
  get_agent_usage: 'Get agent usage',
  get_agent_usage_bulk: 'Get usage for many agents',
  get_agent_audit_log: 'Get agent change history',
  agent_backups_read: 'Read agent backups',
  agent_backups_write: 'Back up or restore agent',
  agent_gallery_templates: 'Agent gallery templates',
  interact_with_agent: 'Chat with agent',
  run_agent_auto_test: 'Run agent auto-test',
  generate_lead_funnel: 'Draft lead funnel',

  // Conversations
  list_conversations: 'List conversations',
  create_conversation: 'Create conversation',
  get_conversation: 'Get conversation',
  update_conversation: 'Update conversation',
  update_conversation_messages: 'Replace conversation messages',
  delete_conversation: 'Delete conversation',
  export_all_conversations: 'Export conversations',
  export_conversation: 'Export conversation',
  assign_conversation: 'Assign conversation',
  get_conversations_bulk: 'Get many conversations',
  query_conversations: 'Filter conversations',
  generate_conversation_summaries: 'Summarize conversations',
  list_conversation_notes: 'List conversation notes',
  add_conversation_note: 'Add conversation note',
  update_conversation_note: 'Edit conversation note',
  delete_conversation_note: 'Delete conversation note',
  send_handoff_reminder: 'Resend handoff reminder',
  send_channel_message: 'Send channel message',

  // Knowledge base
  get_kb_docs_bulk: 'Get many KB documents',
  create_kb_from_urls: 'Add web pages to KB',
  create_kb_doc: 'Add KB document',
  list_kb_docs: 'List KB documents',
  get_kb_doc: 'Get KB document',
  update_kb_doc: 'Update KB document',
  patch_kb_doc: 'Edit KB document text',
  delete_kb_doc: 'Delete KB document',
  get_kb_stats: 'Get KB stats',
  search_kb_docs: 'Search knowledge base',
  bulk_delete_kb_docs: 'Delete many KB documents',
  bulk_create_kb_docs: 'Add many KB documents',
  create_kb_image: 'Add images to KB',
  get_kb_quota: 'Get KB quota',
  import_file_to_kb: 'Import file to KB',
  scrape_url: 'Check or scrape URLs',

  // Local files (stdio server only)
  inspect_file: 'Inspect file',
  read_text_file: 'Read text file',
  read_pdf: 'Read PDF',
  read_docx: 'Read Word document',
  read_spreadsheet: 'Read spreadsheet',
  read_image: 'Read image',
  run_command: 'Run shell command',

  // Widget
  get_website_embed_code: 'Get website embed code',
  get_widget_css_styling_guide: 'Get widget CSS guide',
  get_agent_custom_css: 'Get agent custom CSS',
  update_agent_custom_css: 'Replace agent custom CSS',
  get_ui_engine_spec: 'Get UI Engine spec',

  // Voice and phone
  list_voice_providers: 'List voice providers',
  list_voice_models: 'List voice models',
  search_voices: 'Search voices',
  list_provider_voices: 'List provider voices',
  get_voice: 'Get voice',
  import_twilio_number: 'Import Twilio number',
  release_twilio_number: 'Release Twilio number',
  check_twilio_number: 'Repair Twilio number',
  sync_sms_twilio_number: 'Assign SMS number to agent',
  get_agent_phone: 'Get agent phone numbers',
  start_outbound_call: 'Start outbound call',
  send_sms: 'Send SMS',
  contact_leads: 'Call or text leads',
  call_logs_read: 'Read call logs',
  call_logs_write: 'Manage call logs',
  campaigns_read: 'Read call campaigns',
  campaigns_write: 'Manage call campaigns',
  sms_numbers_read: 'Read SMS numbers',
  sms_numbers_write: 'Manage SMS numbers',

  // Channels
  get_channel_integration_spec: 'Get channel integration spec',
  get_agent_channels: 'Get agent channels',
  create_channel_connect_link: 'Create channel connect link',
  get_connect_link_status: 'Get connect link status',
  disconnect_meta_page: 'Disconnect Facebook page',
  meta_pages_read: 'Check Facebook page',
  get_whatsapp_ai_rules: 'Get WhatsApp AI rules',
  update_whatsapp_ai_rules: 'Update WhatsApp AI rules',
  update_whatsapp_number_settings: 'Update WhatsApp number settings',
  whatsapp_numbers_read: 'Read WhatsApp numbers',
  whatsapp_numbers_write: 'Manage WhatsApp numbers',
  whatsapp_templates_read: 'Read WhatsApp templates',
  whatsapp_templates_write: 'Manage WhatsApp templates',
  whatsapp_campaigns_read: 'Read WhatsApp campaigns',
  whatsapp_campaigns_write: 'Manage WhatsApp campaigns',
  email_channel_read: 'Read email channel',
  email_channel_write: 'Manage email channel',

  // Agent tools and variables
  list_agent_tools: 'List agent tools',
  get_agent_tool: 'Get agent tool',
  create_agent_tool: 'Create agent tool',
  update_agent_tool: 'Update agent tool',
  delete_agent_tool: 'Delete agent tool',
  test_agent_tool: 'Test agent tool',
  test_agent_tool_request: 'Send agent tool request',
  code_tools: 'Code tools',
  tool_sharing: 'Share or copy tools',
  list_agent_variables: 'List agent variables',
  get_agent_variable: 'Get agent variable',
  create_agent_variable: 'Create agent variable',
  update_agent_variable: 'Update agent variable',
  delete_agent_variable: 'Delete agent variable',

  // Leads, contacts, CRM
  leads_read: 'Read leads',
  leads_write: 'Manage leads',
  lead_groups_read: 'Read lead groups',
  lead_groups_write: 'Manage lead groups',
  contacts_read: 'Read contacts',
  contacts_write: 'Manage contacts',
  custom_metrics_read: 'Read custom metrics',
  custom_metrics_write: 'Manage custom metrics',
  zoho_crm_records_read: 'Read Zoho CRM records',
  zoho_crm_records_write: 'Manage Zoho CRM records',
  integrations_read: 'Read integrations',
  integrations_write: 'Manage integrations',
  integrations_test: 'Test integrations',

  // Workspace, agency, clients
  orgs_read: 'Read organizations',
  orgs_write: 'Manage organizations',
  agency_read: 'Get agency account',
  agency_write: 'Create or delete agency',
  agency_branding: 'Agency branding',
  clients_read: 'Read clients',
  clients_write: 'Manage clients',
  folders_read: 'Read agent folders',
  folders_write: 'Manage agent folders',
  workspace_read: 'Read workspace',
  workspace_write: 'Update workspace settings',
  usage_read: 'Read usage and analytics',
  notification_email: 'Notification email subscription',
  get_pricing_info: 'Get pricing info',

  // Utility
  sleep: 'Wait',
  search_mcp_tools: 'Search tools',
};

/**
 * Tools that reach the public web or contact people outside the workspace (fetch arbitrary URLs, place calls,
 * send SMS / WhatsApp / email). Every other tool only touches the caller's own Convocore workspace, so it is
 * openWorldHint: false (OpenAI's plugin review checks this; the domain modules' presets say true for all).
 */
export const OPEN_WORLD_TOOLS = new Set([
  'scrape_url',
  'create_agent_from_template',
  'interact_with_agent',
  'agency_branding',
  'create_kb_from_urls',
  'create_kb_doc',
  'bulk_create_kb_docs',
  'test_agent_tool',
  'test_agent_tool_request',
  'integrations_test',
  'code_tools',
  'start_outbound_call',
  'send_sms',
  'contact_leads',
  'send_channel_message',
  'campaigns_write',
  'whatsapp_campaigns_write',
  'email_channel_write',
  'notification_email',
  'sms_numbers_write',
]);

/** Fill in title (and hints for core tools) without overriding what a tool already declares; openWorldHint is set here. */
export function withToolAnnotations(tool: Tool): Tool {
  const title = tool.annotations?.title ?? TOOL_TITLES[tool.name];
  return {
    ...tool,
    annotations: {
      ...CORE_TOOL_HINTS[tool.name],
      ...tool.annotations,
      ...(title ? { title } : {}),
      openWorldHint: OPEN_WORLD_TOOLS.has(tool.name),
    },
  };
}
