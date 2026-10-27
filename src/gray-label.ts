/**
 * Gray-label client MCP.
 *
 * Agencies give their whitelabel clients an AI-assistant connection on a neutral host
 * (mcp-project.vg-stuff.com). The client authenticates with a `gl_…` connection token, never a
 * workspace secret, and only reaches the agents assigned to them. Everything the assistant sees
 * (server name, instructions, tool descriptions, results, errors, OAuth pages) carries the
 * agency brand and never the platform's.
 *
 * Security lives in the API (scoped bearer: unlisted routes and other agents are refused).
 * This layer narrows the tool catalog, checks agent ids early, and rebrands text.
 */

import type { Tool } from '@modelcontextprotocol/sdk/types.js';

export const CLIENT_TOKEN_PREFIX = 'gl_';

const DEFAULT_GRAY_LABEL_HOSTS = ['mcp-project.vg-stuff.com'];

export function grayLabelHosts(): string[] {
  const raw = process.env.GRAY_LABEL_MCP_HOSTS?.trim();
  const fromEnv = raw ? raw.split(',').map((h) => h.trim().toLowerCase()).filter(Boolean) : [];
  return [...new Set([...DEFAULT_GRAY_LABEL_HOSTS, ...fromEnv])];
}

export function isGrayLabelHost(host: string | undefined): boolean {
  if (!host) return false;
  const bare = host.trim().toLowerCase().split(',')[0]?.trim().split(':')[0] ?? '';
  return grayLabelHosts().includes(bare);
}

export function isClientToken(token: string | null | undefined): boolean {
  return typeof token === 'string' && token.startsWith(CLIENT_TOKEN_PREFIX);
}

/** Region baked into a client token (`gl_<base64url("e|n:ws:conn")>.<secret>`). */
export function regionFromClientToken(token: string): 'eu-gcp' | 'na-gcp' | undefined {
  if (!isClientToken(token)) return undefined;
  const body = token.slice(CLIENT_TOKEN_PREFIX.length);
  const dot = body.indexOf('.');
  if (dot <= 0) return undefined;
  try {
    const locator = Buffer.from(body.slice(0, dot), 'base64url').toString('utf8');
    const r = locator.split(':')[0];
    return r === 'e' ? 'eu-gcp' : r === 'n' ? 'na-gcp' : undefined;
  } catch {
    return undefined;
  }
}

export type GrayLabelBrand = {
  name: string;
  logoUrl?: string | null;
  primaryColor?: string | null;
  /** Agency client-app origin, e.g. https://portal.acme.com */
  appBaseUrl: string;
  /** e.g. https://portal.acme.com/eu/prototype */
  prototypeBaseUrl: string;
  /** Widget CDN origin for embed snippets. */
  cdnBaseUrl: string;
  supportEmail?: string | null;
  website?: string | null;
};

export type GrayLabelSession = {
  workspaceId?: string;
  clientId: string;
  clientName?: string | null;
  agents: Array<{ id: string; title: string }>;
  brand: GrayLabelBrand;
};

/** Connector / server name: "{Agency} - {Client}". */
export function grayLabelDisplayName(session: Pick<GrayLabelSession, 'brand' | 'clientName'>): string {
  const brand = session.brand.name.trim() || 'AI Assistant';
  const client = session.clientName?.trim();
  return (client ? `${brand} - ${client}` : brand).slice(0, 64);
}

export function parseGrayLabelSession(payload: unknown): GrayLabelSession {
  const root = (payload && typeof payload === 'object' ? payload : {}) as Record<string, any>;
  const data = (root.data && typeof root.data === 'object' && root.brand === undefined ? root.data : root) as Record<
    string,
    any
  >;
  const brand = (data.brand || {}) as Record<string, any>;
  if (!data.clientId || typeof brand.appBaseUrl !== 'string') {
    throw new Error('Unexpected connection info from the API');
  }
  return {
    workspaceId: typeof data.workspaceId === 'string' ? data.workspaceId : undefined,
    clientId: String(data.clientId),
    clientName: typeof data.clientName === 'string' ? data.clientName : null,
    agents: Array.isArray(data.agents)
      ? data.agents
          .filter((a: any) => a && typeof a.id === 'string')
          .map((a: any) => ({ id: a.id, title: String(a.title || a.id) }))
      : [],
    brand: {
      name: String(brand.name || 'AI Assistant'),
      logoUrl: brand.logoUrl ?? null,
      primaryColor: brand.primaryColor ?? null,
      appBaseUrl: String(brand.appBaseUrl).replace(/\/+$/, ''),
      prototypeBaseUrl: String(brand.prototypeBaseUrl || `${brand.appBaseUrl}/eu/prototype`).replace(/\/+$/, ''),
      cdnBaseUrl: String(brand.cdnBaseUrl || '').replace(/\/+$/, ''),
      supportEmail: brand.supportEmail ?? null,
      website: brand.website ?? null,
    },
  };
}

/**
 * Tools a client may use: everything that acts on one of their agents. Workspace / agency /
 * billing / phone-number buying / channel credentials / agent creation are not offered.
 */
export const GRAY_LABEL_TOOLS = new Set<string>([
  // agents
  'list_agents',
  'search_agents',
  'get_agent',
  'update_agent',
  'patch_agent_prompt',
  'export_agent',
  'get_agent_usage',
  'get_agent_usage_bulk',
  'get_agent_audit_log',
  'get_agent_custom_css',
  'update_agent_custom_css',
  'get_widget_css_styling_guide',
  'get_website_embed_code',
  'agent_backups_read',
  'agent_backups_write',
  'interact_with_agent',
  'run_agent_auto_test',
  // conversations
  'list_conversations',
  'create_conversation',
  'get_conversation',
  'get_conversations_bulk',
  'query_conversations',
  'update_conversation',
  'update_conversation_messages',
  'delete_conversation',
  'export_conversation',
  'export_all_conversations',
  'assign_conversation',
  'send_channel_message',
  'send_handoff_reminder',
  'generate_conversation_summaries',
  'list_conversation_notes',
  'add_conversation_note',
  'update_conversation_note',
  'delete_conversation_note',
  // knowledge base
  'list_kb_docs',
  'get_kb_doc',
  'get_kb_docs_bulk',
  'create_kb_doc',
  'create_kb_from_urls',
  'update_kb_doc',
  'patch_kb_doc',
  'delete_kb_doc',
  'bulk_create_kb_docs',
  'bulk_delete_kb_docs',
  'create_kb_image',
  'search_kb_docs',
  'get_kb_stats',
  'scrape_url',
  // agent tools / variables
  'list_agent_tools',
  'get_agent_tool',
  'create_agent_tool',
  'update_agent_tool',
  'delete_agent_tool',
  'test_agent_tool',
  'test_agent_tool_request',
  'list_agent_variables',
  'get_agent_variable',
  'create_agent_variable',
  'update_agent_variable',
  'delete_agent_variable',
  // leads, campaigns, outbound, calls
  'leads_read',
  'leads_write',
  'lead_groups_read',
  'lead_groups_write',
  'campaigns_read',
  'campaigns_write',
  'call_logs_read',
  'call_logs_write',
  'get_agent_phone',
  'start_outbound_call',
  'send_sms',
  'contact_leads',
  // analytics
  'custom_metrics_read',
  'custom_metrics_write',
  // voices (catalog) + static guides
  'list_voice_providers',
  'list_voice_models',
  'search_voices',
  'list_provider_voices',
  'get_voice',
  'get_ui_engine_spec',
  'sleep',
  'search_mcp_tools',
]);

/** Argument names that carry one agent id / a list of agent ids. */
const AGENT_ARG_KEYS = ['agentId', 'agent_id', 'targetAgentId', 'newAgentId', 'fromAgentId'];
const AGENT_LIST_ARG_KEYS = ['agentIds', 'targetAgentIds'];

/** Arguments the assistant may never pass in gray-label mode (overrides of server-side data). */
const STRIPPED_ARGS: Record<string, string[]> = {
  interact_with_agent: ['agentData', 'workspaceData', 'bucket'],
};

export class GrayLabelAccessError extends Error {}

export function assertGrayLabelToolCall(
  name: string,
  args: Record<string, unknown> | undefined,
  session: GrayLabelSession
): Record<string, unknown> | undefined {
  if (!GRAY_LABEL_TOOLS.has(name)) {
    throw new GrayLabelAccessError(`The tool "${name}" is not available on this connection.`);
  }
  const allowed = new Set(session.agents.map((a) => a.id));
  const ids: string[] = [];
  for (const key of AGENT_ARG_KEYS) {
    const v = args?.[key];
    if (typeof v === 'string' && v.trim()) ids.push(v.trim());
  }
  for (const key of AGENT_LIST_ARG_KEYS) {
    const v = args?.[key];
    if (Array.isArray(v)) for (const item of v) if (typeof item === 'string' && item.trim()) ids.push(item.trim());
  }
  for (const id of ids) {
    if (!allowed.has(id)) {
      throw new GrayLabelAccessError(
        `Agent ${id} is not one of your agents. Use list_agents to see the agents on this connection.`
      );
    }
  }
  const strip = STRIPPED_ARGS[name];
  if (!strip || !args) return args;
  const copy = { ...args };
  for (const key of strip) delete copy[key];
  return copy;
}

export function filterGrayLabelTools(tools: Tool[]): Tool[] {
  return tools.filter((t) => GRAY_LABEL_TOOLS.has(t.name));
}

/**
 * Text written for the full catalog points at tools a client does not have ("use clients_read",
 * "see get_pricing_info"). Name them as unavailable so the assistant does not go looking.
 */
export function scrubHiddenToolNames<T>(value: T, allToolNames: string[]): T {
  const hidden = allToolNames.filter((n) => !GRAY_LABEL_TOOLS.has(n)).sort((a, b) => b.length - a.length);
  if (!hidden.length) return value;
  const re = new RegExp(`\\b(?:${hidden.join('|')})\\b`, 'g');
  const walk = (v: unknown, depth: number): unknown => {
    if (depth > 40) return v;
    if (typeof v === 'string') return v.replace(re, '(a tool not available on this connection)');
    if (Array.isArray(v)) return v.map((x) => walk(x, depth + 1));
    if (v && typeof v === 'object') {
      const out: Record<string, unknown> = {};
      // Keys (e.g. a tool's own `name`) stay as they are; only text values change.
      for (const [k, x] of Object.entries(v as Record<string, unknown>)) out[k] = k === 'name' ? x : walk(x, depth + 1);
      return out;
    }
    return v;
  };
  return walk(value, 0) as T;
}

/** Platform names / hosts that must never reach a gray-label client. */
export const PLATFORM_BRAND_PATTERN = /convo\s*-?\s*core|voice\s*glow|tixae/i;

/**
 * Rewrite platform branding to the agency's: platform app links → agency app, widget CDN →
 * agency CDN, platform names → agency name. Applied to everything the assistant reads.
 */
export function rebrandText(text: string, brand: GrayLabelBrand): string {
  if (!text) return text;
  const app = brand.appBaseUrl;
  const cdn = brand.cdnBaseUrl || brand.appBaseUrl;
  const appHost = app.replace(/^https?:\/\//, '');
  // Agency origins may themselves sit on the platform domain (subdomain fallback when the agency
  // has no custom domain). Swap them for placeholders first, rewrite, then put them back, so
  // neither the original text nor our own replacements get mangled by the name rewrite.
  const slots = [app, cdn, appHost];
  const slot = (i: number) => `\u0000${i}\u0000`;
  let out = text;
  slots.forEach((v, i) => {
    if (v) out = out.split(v).join(slot(i));
  });
  out = out
    .replace(/https?:\/\/cdn\.convocore\.(?:ai|app)/gi, slot(1))
    .replace(/https?:\/\/docs\.convocore\.(?:ai|app)[^\s"')]*/gi, slot(0))
    .replace(/https?:\/\/mcp\.convocore\.(?:ai|app)/gi, 'https://mcp-project.vg-stuff.com')
    .replace(/https?:\/\/(?:app\.|www\.)?convocore\.(?:ai|app)/gi, slot(0))
    .replace(/\b[\w.-]+\.convocore\.(?:ai|app)\b/gi, slot(2))
    .replace(/@tixae-labs\/[\w-]+/gi, 'the web SDK')
    .replace(/X-Convocore-Region/g, 'X-Region')
    .replace(/CONVOCORE_[A-Z_]+/g, 'server setting')
    .replace(/convocore-mcp/gi, 'mcp')
    .replace(/convo\s*-?\s*core/gi, brand.name)
    .replace(/voice\s*glow/gi, brand.name)
    .replace(/tixae(?:[\s-]+labs)?/gi, brand.name);
  return out.replace(/\u0000(\d)\u0000/g, (_, i) => slots[Number(i)]);
}

/** Deep-rebrand every string in a JSON-ish value (tool definitions, results). */
export function rebrandValue<T>(value: T, brand: GrayLabelBrand, depth = 0): T {
  if (depth > 40) return value;
  if (typeof value === 'string') return rebrandText(value, brand) as unknown as T;
  if (Array.isArray(value)) return value.map((v) => rebrandValue(v, brand, depth + 1)) as unknown as T;
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) out[k] = rebrandValue(v, brand, depth + 1);
    return out as T;
  }
  return value;
}

/** initialize `instructions` for a gray-label session. */
export function grayLabelInstructions(baseInstructions: string, session: GrayLabelSession): string {
  const brand = session.brand;
  const agents = session.agents.length
    ? session.agents.map((a) => `- ${a.title} (\`${a.id}\`)`).join('\n')
    : '- (no agents are assigned to this account yet — ask your provider)';
  const header = `# ${grayLabelDisplayName(session)} — AI agents

You manage the AI agents of ${session.clientName?.trim() || 'this account'} on ${brand.name}.
This connection can only see and change these agents:
${agents}

Creating, cloning or deleting agents, billing, phone-number purchases and account settings are not available here — those are handled by ${brand.name}${brand.supportEmail ? ` (${brand.supportEmail})` : ''}.
Try-it links for an agent: \`${brand.prototypeBaseUrl}/{agentId}\`.

`;
  // Agency-only notes (plan add-ons, platform pricing) are not for clients.
  const base = baseInstructions
    .split('\n')
    .filter((line) => !/paid add-on|pricing|get_pricing_info/i.test(line))
    .join('\n');
  return rebrandText(header + base, brand);
}
