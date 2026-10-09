/**
 * Light mode for MCP tool responses.
 *
 * compact (default) keeps every record and every scalar field but trims what makes a
 * response expensive: long strings are cut, known bulky blobs (transcripts, page
 * content, turn history…) are replaced by a size marker, long nested lists are capped.
 * mode="full" returns the API response untouched.
 */

import type { ListMode } from './list-compact.js';

const MAX_STRING = 280;
const MAX_NESTED_ITEMS = 20;
const MAX_DEPTH = 6;

/** Object/array values under these keys are never useful in a summary. */
const BULKY_KEYS = new Set([
  'transcript',
  'transcripts',
  'messages',
  'turns',
  'history',
  'latency_summary',
  'latencySummary',
  'langchainMessages',
  'lgMessages',
  'embeddings',
  'chunks',
  'html',
  'rawHtml',
  'markdown',
  'nodes',
  'tools',
  'variables',
  'agent',
  'agentData',
  'template',
]);

function sizeOf(value: unknown): string {
  if (Array.isArray(value)) return `${value.length} items`;
  if (typeof value === 'string') return `${value.length} chars`;
  if (value && typeof value === 'object') return `${Object.keys(value).length} fields`;
  return 'value';
}

function lighten(value: unknown, depth: number, key?: string): unknown {
  if (typeof value === 'string') {
    if (value.length <= MAX_STRING) return value;
    return `${value.slice(0, MAX_STRING)}… (+${value.length - MAX_STRING} chars, mode="full" for all)`;
  }
  if (value === null || typeof value !== 'object') return value;

  if (key && BULKY_KEYS.has(key) && depth > 0) {
    return `[${sizeOf(value)} omitted — mode="full"]`;
  }
  if (depth >= MAX_DEPTH) return `[${sizeOf(value)} omitted — mode="full"]`;

  if (Array.isArray(value)) {
    // The top-level list (depth 0/1) is the result set itself: pagination bounds it.
    const cap = depth <= 1 ? value.length : MAX_NESTED_ITEMS;
    const items = value.slice(0, cap).map((item) => lighten(item, depth + 1));
    if (value.length > cap) items.push(`… +${value.length - cap} more (mode="full")`);
    return items;
  }

  const out: Record<string, unknown> = {};
  for (const [childKey, childValue] of Object.entries(value as Record<string, unknown>)) {
    out[childKey] = lighten(childValue, depth + 1, childKey);
  }
  return out;
}

export const LightModeDescribe =
  'compact (default) = light mode: all records and fields, but long text is cut and bulky blobs (transcripts, page content, histories) are replaced by a size marker. full = the complete API response.';

/** Apply light mode unless mode is "full". */
export function applyLightMode(mode: ListMode | undefined, result: unknown): unknown {
  if ((mode ?? 'compact') === 'full') return result;
  // A bare string is the payload itself (e.g. a CSV export): never cut it.
  if (typeof result === 'string') return result;
  const light = lighten(result, 0);
  if (light && typeof light === 'object' && !Array.isArray(light)) {
    return { ...(light as Record<string, unknown>), mode: 'compact' };
  }
  return { mode: 'compact', data: light };
}
