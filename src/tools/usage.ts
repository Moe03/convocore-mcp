/**
 * usage_read — everything the dashboard shows about usage, credits and activity, read only:
 * the credit balance and plan quota, the workspace Usage page (credits and tokens per model and per agent, usage log),
 * per-agent credits, per-agent and all-agents analytics, and agency client analytics.
 *
 * Calls go through the dashboard RPC gateway (POST /rpc/{procedure}), which pins the workspace, uid and region to the
 * authenticated workspace, so a caller can only ever read their own data.
 */

import type { Tool } from '@modelcontextprotocol/sdk/types.js';
import { z } from 'zod';
import { applyLightMode } from '../light-mode.js';
import { getActiveClient } from '../request-context.js';
import { READ_ANNOTATIONS, type ToolHandler, type ToolModule, wrapHandler } from './helpers.js';

const ACTIONS = [
  'overview',
  'top_agents',
  'credits',
  'quota',
  'workspace_usage',
  'agent_usage',
  'agent_analytics',
  'agents_analytics',
  'clients_analytics',
  'email_analytics',
] as const;

const DEFAULT_DAYS = 30;
const MAX_DAYS = 400;
const DAY_SECONDS = 86_400;
/** Agent titles are looked up for the top consumers only, never for the whole workspace. */
const MAX_NAME_LOOKUPS = 15;

const ArgsSchema = z
  .object({
    action: z.enum(ACTIONS),
    days: z.number().int().min(1).max(MAX_DAYS).optional(),
    from: z.string().optional(),
    to: z.string().optional(),
    agentId: z.string().min(1).optional(),
    agentIds: z.array(z.string().min(1)).max(500).optional(),
    clientIds: z.array(z.string().min(1)).max(200).optional(),
    includePerAgent: z.boolean().optional(),
    includeLogs: z.boolean().optional(),
    includeCharts: z.boolean().optional(),
    logsPage: z.number().int().min(1).max(10_000).optional(),
    topN: z.number().int().min(1).max(MAX_NAME_LOOKUPS).optional(),
    mode: z.enum(['compact', 'full']).optional(),
  })
  .strict();

type Args = z.infer<typeof ArgsSchema>;

export type UsageRange = { start: number; end: number; from: string; to: string; days: number };

/** "2026-10-01" → start of that UTC day (from) / end of it (to); full ISO datetimes are used as given. */
function parseBound(value: string, which: 'from' | 'to'): number {
  const dateOnly = /^\d{4}-\d{2}-\d{2}$/.test(value);
  const ms = Date.parse(dateOnly ? `${value}T${which === 'from' ? '00:00:00' : '23:59:59'}Z` : value);
  if (!Number.isFinite(ms)) throw new Error(`${which} must be an ISO date like 2026-10-01 or 2026-10-01T09:00:00Z (got "${value}")`);
  return Math.floor(ms / 1000);
}

/** days (default 30) counted back from now, or an explicit from / to. */
export function resolveRange(args: Pick<Args, 'days' | 'from' | 'to'>, nowSeconds = Math.floor(Date.now() / 1000)): UsageRange {
  const end = args.to ? parseBound(args.to, 'to') : nowSeconds;
  const start = args.from ? parseBound(args.from, 'from') : end - (args.days ?? DEFAULT_DAYS) * DAY_SECONDS;
  if (start >= end) throw new Error('from must be before to');
  const days = Math.ceil((end - start) / DAY_SECONDS);
  if (days > MAX_DAYS) throw new Error(`The range is ${days} days; the maximum is ${MAX_DAYS}. Query it in smaller windows.`);
  return { start, end, from: new Date(start * 1000).toISOString(), to: new Date(end * 1000).toISOString(), days };
}

function need<T>(value: T | undefined, field: string, action: string): T {
  if (value === undefined || value === null || (typeof value === 'string' && !value)) {
    throw new Error(`${field} is required for action=${action}`);
  }
  return value;
}

type AgentUsageRow = {
  agentId: string;
  creditsConsumed: number;
  llmsUsage?: Array<{ modelId: string; inputTokens: number; outputTokens: number }>;
};

function rankAgents(keyMetrics: any, topN: number): Array<AgentUsageRow & { share: number }> {
  const rows: AgentUsageRow[] = Array.isArray(keyMetrics?.agentsUsage) ? keyMetrics.agentsUsage : [];
  const total = rows.reduce((sum, r) => sum + (Number(r.creditsConsumed) || 0), 0);
  return [...rows]
    .sort((a, b) => (Number(b.creditsConsumed) || 0) - (Number(a.creditsConsumed) || 0))
    .slice(0, topN)
    .map((r) => ({ ...r, share: total > 0 ? Math.round(((Number(r.creditsConsumed) || 0) / total) * 1000) / 10 : 0 }));
}

/** Adds the agent's title to each row. Lookups run concurrently; an agent that cannot be read just has no title. */
async function withAgentTitles<T extends { agentId: string }>(rows: T[]): Promise<Array<T & { title?: string }>> {
  const client = getActiveClient();
  const settled = await Promise.allSettled(rows.slice(0, MAX_NAME_LOOKUPS).map((r) => client.getAgent(r.agentId)));
  return rows.map((row, i) => {
    const res = settled[i];
    const agent: any = res?.status === 'fulfilled' ? ((res.value as any)?.data ?? res.value) : null;
    const title = typeof agent?.title === 'string' ? agent.title : undefined;
    return title ? { ...row, title } : row;
  });
}

function messageOf(reason: unknown): string {
  return reason instanceof Error ? reason.message : String(reason);
}

/** Total activity numbers only (no per-agent rows). */
function activityTotals(analytics: any) {
  return analytics?.totals ?? analytics ?? null;
}

async function overview(args: Args) {
  const range = resolveRange(args);
  const client = getActiveClient();
  const topN = args.topN ?? 8;
  const [credits, quota, usage, activity] = await Promise.allSettled([
    client.rpc('getWorkspaceCredits', {}),
    client.rpc('getV2QuotaSummary', {}),
    client.rpc('getUsage', { range: { start: range.start, end: range.end } }),
    client.rpc('typedAgents.getWorkspaceAgentsAnalytics', { start: range.start, end: range.end, includePerAgent: false }),
  ]);
  const usageData: any = usage.status === 'fulfilled' ? usage.value : null;
  const top = usageData ? await withAgentTitles(rankAgents(usageData.keyMetrics, topN)) : [];
  const errors: Record<string, string> = {};
  if (credits.status === 'rejected') errors.credits = messageOf(credits.reason);
  if (quota.status === 'rejected') errors.quota = messageOf(quota.reason);
  if (usage.status === 'rejected') errors.usage = messageOf(usage.reason);
  if (activity.status === 'rejected') errors.activity = messageOf(activity.reason);
  return {
    range,
    credits: credits.status === 'fulfilled' ? credits.value : null,
    plan: quota.status === 'fulfilled' ? quota.value : null,
    usage: usageData
      ? {
          creditsCharged: usageData.keyMetrics?.creditsCharged ?? null,
          creditsConsumed: usageData.keyMetrics?.creditsConsumed ?? null,
          tokensByModel: usageData.keyMetrics?.llms ?? [],
          topAgents: top,
          agentsWithUsage: Array.isArray(usageData.keyMetrics?.agentsUsage) ? usageData.keyMetrics.agentsUsage.length : 0,
        }
      : null,
    activity: activity.status === 'fulfilled' ? activityTotals(activity.value) : null,
    ...(Object.keys(errors).length ? { partialErrors: errors } : {}),
    next: 'top_agents / workspace_usage (charts, log) / agent_usage / agent_analytics / agents_analytics / clients_analytics for detail.',
  };
}

async function topAgents(args: Args) {
  const range = resolveRange(args);
  const usage: any = await getActiveClient().rpc('getUsage', { range: { start: range.start, end: range.end } });
  const ranked = rankAgents(usage?.keyMetrics, args.topN ?? MAX_NAME_LOOKUPS);
  return {
    range,
    creditsConsumed: usage?.keyMetrics?.creditsConsumed ?? null,
    agentsWithUsage: Array.isArray(usage?.keyMetrics?.agentsUsage) ? usage.keyMetrics.agentsUsage.length : 0,
    topAgents: await withAgentTitles(ranked),
  };
}

async function workspaceUsage(args: Args) {
  const range = resolveRange(args);
  const usage: any = await getActiveClient().rpc('getUsage', {
    range: { start: range.start, end: range.end },
    ...(args.logsPage ? { logsPage: args.logsPage } : {}),
  });
  const { logs, charts, keyMetrics, ...rest } = usage ?? {};
  return {
    range,
    keyMetrics: keyMetrics
      ? { ...keyMetrics, agentsUsage: await withAgentTitles(rankAgents(keyMetrics, MAX_NAME_LOOKUPS)) }
      : null,
    ...(args.includeCharts ? { charts } : { chartsAvailable: Array.isArray(charts) ? charts.map((c: any) => c.key) : [] }),
    ...(args.includeLogs || args.logsPage ? { logs, logsPage: args.logsPage ?? 1 } : { logEntries: Array.isArray(logs) ? logs.length : 0 }),
    ...rest,
    ...(args.includeCharts && args.includeLogs ? {} : { note: 'Pass includeCharts / includeLogs (or logsPage) to include the charts and the usage log.' }),
  };
}

async function agentsAnalytics(args: Args) {
  const range = resolveRange(args);
  const result: any = await getActiveClient().rpc('typedAgents.getWorkspaceAgentsAnalytics', {
    start: range.start,
    end: range.end,
    includePerAgent: args.includePerAgent ?? true,
    ...(args.agentIds?.length ? { agentIds: args.agentIds } : {}),
  });
  const perAgent: any[] = Array.isArray(result?.perAgent) ? result.perAgent : [];
  const busiest = [...perAgent].sort((a, b) => (b.totalInteractions || 0) - (a.totalInteractions || 0));
  const titled = await withAgentTitles(busiest.slice(0, MAX_NAME_LOOKUPS));
  return { range, totals: result?.totals ?? null, perAgent: [...titled, ...busiest.slice(MAX_NAME_LOOKUPS)] };
}

const tool: Tool = {
  name: 'usage_read',
  description:
    'Read usage, credits and activity — everything the dashboard Usage and Analytics pages show — for the whole workspace and per agent. Read only. ' +
    'Time range: days back from now (default 30, max 400) or an explicit from / to (ISO date like 2026-10-01, or a full ISO datetime). ' +
    'overview: ONE call with credit balance, plan quota and limits, credits consumed in the range, tokens per model, the top agents (with names) and total activity (conversations, messages, calls, call minutes) — start here for "how is my usage". ' +
    'top_agents: agents ranked by credits consumed, with share of the total (topN up to 15). ' +
    'credits: current credit balance. quota: plan limits and current usage (conversations, messages, agents, KB…). ' +
    'workspace_usage: the Usage page — creditsCharged and creditsConsumed, input/output tokens per model, credits per agent with per-agent models, plus the chart list; add includeCharts for the chart data and includeLogs or logsPage for the credit usage log (what charged how much, and why). ' +
    'agent_usage (agentId): credits and tokens per model for one agent, plus call minutes. ' +
    'agent_analytics (agentId): that agent\'s analytics — loads, conversations, metrics, token usage, containment and human-handover stats. ' +
    'agents_analytics: activity totals for all agents (or agentIds), and per agent with includePerAgent (default true). ' +
    'clients_analytics: agency only — usage, leads and funnel per whitelabel client and per agent (clientIds to narrow). ' +
    'email_analytics (agentId): email channel analytics for one agent. ' +
    'WhatsApp and SMS analytics are in whatsapp_numbers_read / sms_numbers_read, voice calls in call_logs_read, knowledge-base quota in get_kb_quota.',
  annotations: READ_ANNOTATIONS,
  inputSchema: {
    type: 'object',
    properties: {
      action: { type: 'string', enum: [...ACTIONS] },
      days: { type: 'number', description: `Look back this many days from now (1-${MAX_DAYS}, default ${DEFAULT_DAYS}). Ignored when from is set.` },
      from: { type: 'string', description: 'Range start: ISO date (2026-10-01 = start of that UTC day) or datetime.' },
      to: { type: 'string', description: 'Range end: ISO date (2026-10-31 = end of that UTC day) or datetime. Default now.' },
      agentId: { type: 'string', description: 'For agent_usage / agent_analytics / email_analytics: the agent (list_agents or search_agents).' },
      agentIds: { type: 'array', items: { type: 'string' }, description: 'For agents_analytics: only these agents (max 500). Default all agents in the workspace.' },
      clientIds: { type: 'array', items: { type: 'string' }, description: 'For clients_analytics: only these whitelabel clients (clients_read list).' },
      includePerAgent: { type: 'boolean', description: 'For agents_analytics: also return one row per agent (default true).' },
      includeCharts: { type: 'boolean', description: 'For workspace_usage: include the chart data (credits over time, usage by feature / agent, tokens).' },
      includeLogs: { type: 'boolean', description: 'For workspace_usage: include the credit usage log (first page).' },
      logsPage: { type: 'number', description: 'For workspace_usage: usage log page number (implies includeLogs).' },
      topN: { type: 'number', description: `For overview / top_agents: how many top agents to return (1-${MAX_NAME_LOOKUPS}; default 8 for overview, ${MAX_NAME_LOOKUPS} for top_agents).` },
      mode: {
        type: 'string',
        enum: ['compact', 'full'],
        description: 'compact (default) = long text is cut and bulky blobs are replaced by a size marker. full = complete response.',
      },
    },
    required: ['action'],
  },
};

const handler: ToolHandler = wrapHandler('usage_read', async (raw) => {
  const args = ArgsSchema.parse(raw);
  const client = getActiveClient();
  let result: unknown;
  switch (args.action) {
    case 'overview':
      result = await overview(args);
      break;
    case 'top_agents':
      result = await topAgents(args);
      break;
    case 'credits':
      result = await client.rpc('getWorkspaceCredits', {});
      break;
    case 'quota':
      result = await client.rpc('getV2QuotaSummary', {});
      break;
    case 'workspace_usage':
      result = await workspaceUsage(args);
      break;
    case 'agent_usage': {
      const range = resolveRange(args);
      result = { range, ...(await client.rpc<any>('getAgentUsage', { agent_id: need(args.agentId, 'agentId', args.action), range: { start: range.start, end: range.end } })) };
      break;
    }
    case 'agent_analytics': {
      const range = resolveRange(args);
      result = { range, ...(await client.rpc<any>('typedAgents.getAnalyticsByTimeRange', { agentId: need(args.agentId, 'agentId', args.action), start: range.start, end: range.end })) };
      break;
    }
    case 'agents_analytics':
      result = await agentsAnalytics(args);
      break;
    case 'clients_analytics': {
      const range = resolveRange(args);
      result = { range, ...(await client.rpc<any>('orgsRouter.getAgencyClientsAnalytics', { start: range.start, end: range.end, ...(args.clientIds?.length ? { clientIds: args.clientIds } : {}) })) };
      break;
    }
    case 'email_analytics': {
      const range = resolveRange(args);
      result = { range, ...(await client.rpc<any>('typedAgents.getEmailAnalyticsByTimeRange', { agentId: need(args.agentId, 'agentId', args.action), start: range.start, end: range.end })) };
      break;
    }
  }
  return applyLightMode(args.mode, result);
});

export const usageModule: ToolModule = { tools: [tool], handlers: { usage_read: handler } };
