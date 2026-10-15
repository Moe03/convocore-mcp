/**
 * Usage telemetry for MCP tool calls (modelled on Next.js telemetry).
 *
 * Records which tool ran, whether it succeeded, how long it took and which MCP client called it.
 * Never records tool arguments or results — those hold prompts, contacts and customer data.
 *
 * On by default. Opt out with CONVOCORE_TELEMETRY=0 (or DO_NOT_TRACK=1).
 * CONVOCORE_TELEMETRY_DEBUG=1 prints events to stderr instead of sending them.
 *
 * Events are batched in memory and POSTed to `${baseUrl}/mcp/telemetry` (the caller's own region),
 * authenticated with the caller's workspace secret. Sending never blocks or fails a tool call.
 */

import { randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { PACKAGE_VERSION } from './package-meta.js';
import type { ConvocoreConfig } from './types.js';

export type TelemetryTransport = 'stdio' | 'hosted';

export type ToolCallEvent = {
  tool: string;
  success: boolean;
  errorType?: string;
  durationMs: number;
  transport: TelemetryTransport;
  clientName?: string;
  clientVersion?: string;
};

type WireEvent = ToolCallEvent & {
  ts: number;
  sessionId: string;
  mcpVersion: string;
  nodeVersion: string;
  platform: string;
  viaAiWizard: boolean;
};

type Queue = {
  url: string;
  headers: Record<string, string>;
  events: WireEvent[];
};

const FLUSH_INTERVAL_MS = 5_000;
const FLUSH_AT = 50;
const MAX_QUEUED_PER_TARGET = 500;
const SEND_TIMEOUT_MS = 4_000;

/** One id per server process; lets events from one session be grouped without identifying anyone. */
const SESSION_ID = randomUUID();

const queues = new Map<string, Queue>();
let flushTimer: NodeJS.Timeout | null = null;

function envFlag(value: string | undefined): boolean | null {
  const v = (value || '').trim().toLowerCase();
  if (!v) return null;
  if (['0', 'false', 'off', 'no', 'disable', 'disabled'].includes(v)) return false;
  return true;
}

export function isTelemetryEnabled(): boolean {
  if (envFlag(process.env.CONVOCORE_TELEMETRY) === false) return false;
  if (envFlag(process.env.DO_NOT_TRACK) === true) return false;
  return true;
}

function isTelemetryDebug(): boolean {
  return envFlag(process.env.CONVOCORE_TELEMETRY_DEBUG) === true;
}

/**
 * One-time notice on stderr for local (stdio) installs, like Next.js prints on first run.
 * A marker file in ~/.convocore-mcp keeps it from repeating on every launch.
 */
export function printTelemetryNoticeOnce(): void {
  if (!isTelemetryEnabled()) return;
  try {
    const dir = path.join(os.homedir(), '.convocore-mcp');
    const marker = path.join(dir, 'telemetry-notice-shown');
    if (existsSync(marker)) return;
    console.error(
      'Attention: convocore-mcp collects anonymous usage data (tool name, success, duration, client name).\n' +
        'Tool arguments and results are never collected. Opt out with CONVOCORE_TELEMETRY=0.\n' +
        'Learn more: https://github.com/Moe03/convocore-mcp#telemetry'
    );
    mkdirSync(dir, { recursive: true });
    writeFileSync(marker, new Date().toISOString());
  } catch {
    // Read-only home dir etc. — the notice is best effort.
  }
}

/** Short error category from a tool result (`isError` or the `{ success: false, data: { errorType } }` shape). */
export function classifyToolResult(result: unknown): { success: boolean; errorType?: string } {
  const r = result as { isError?: boolean; content?: Array<{ type?: string; text?: string }> } | null;
  const text = r?.content?.[0]?.type === 'text' ? r.content[0].text || '' : '';
  const looksFailed = /"success":\s*false/.test(text.slice(0, 200));
  if (!r?.isError && !looksFailed) return { success: true };
  const match = /"errorType":\s*"([a-z_]{1,40})"/.exec(text);
  return { success: false, errorType: match?.[1] || 'error' };
}

export function recordToolCall(config: ConvocoreConfig | null, event: ToolCallEvent): void {
  if (!isTelemetryEnabled() || !config?.workspaceSecret) return;
  try {
    const wire: WireEvent = {
      ...event,
      tool: event.tool.slice(0, 80),
      durationMs: Math.max(0, Math.round(event.durationMs)),
      ts: Date.now(),
      sessionId: SESSION_ID,
      mcpVersion: PACKAGE_VERSION,
      nodeVersion: process.versions.node,
      platform: process.platform,
      viaAiWizard: Boolean(config.extraApiHeaders?.['X-VG-Ai-Wizard']),
    };

    if (isTelemetryDebug()) {
      console.error('[convocore-mcp telemetry]', JSON.stringify(wire));
      return;
    }

    const url = `${config.baseUrl.replace(/\/+$/, '')}/mcp/telemetry`;
    const workspaceId = config.extraApiHeaders?.['X-VG-Workspace-Id'] || config.workspaceId || '';
    const key = `${url}\n${config.workspaceSecret}\n${workspaceId}`;
    let queue = queues.get(key);
    if (!queue) {
      const headers: Record<string, string> = {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${config.workspaceSecret}`,
      };
      if (workspaceId) headers['X-VG-Workspace-Id'] = workspaceId;
      queue = { url, headers, events: [] };
      queues.set(key, queue);
    }
    if (queue.events.length >= MAX_QUEUED_PER_TARGET) queue.events.shift();
    queue.events.push(wire);

    if (queue.events.length >= FLUSH_AT) {
      void flushTelemetry();
    } else if (!flushTimer) {
      flushTimer = setTimeout(() => {
        flushTimer = null;
        void flushTelemetry();
      }, FLUSH_INTERVAL_MS);
      flushTimer.unref();
    }
  } catch {
    // Telemetry must never affect a tool call.
  }
}

/** Sends every queued batch. Each target is sent independently; failures drop that batch silently. */
export async function flushTelemetry(): Promise<void> {
  const batches = [...queues.values()]
    .filter((q) => q.events.length > 0)
    .map((q) => ({ url: q.url, headers: q.headers, events: q.events.splice(0) }));
  for (const [key, q] of queues) {
    if (q.events.length === 0) queues.delete(key);
  }
  if (batches.length === 0) return;

  await Promise.allSettled(
    batches.map((b) =>
      fetch(b.url, {
        method: 'POST',
        headers: b.headers,
        body: JSON.stringify({ events: b.events }),
        signal: AbortSignal.timeout(SEND_TIMEOUT_MS),
      }).then((res) => res.body?.cancel())
    )
  );
}

let exitHooksInstalled = false;

/** Flush what is queued before a graceful shutdown. */
export function installTelemetryExitHooks(): void {
  if (exitHooksInstalled) return;
  exitHooksInstalled = true;
  process.once('beforeExit', () => {
    void flushTelemetry();
  });
}
