/**
 * Convocore built-in system tools assignable via nodes[].toolsIds
 * (platform defaultSystemTools — not custom HTTP tools).
 */

/** Built-in ids from Convocore defaults (subset we care about for MCP templates). */
export const BUILTIN_SYSTEM_TOOL_IDS = [
  'end-call',
  'forward-call',
  'human-handoff',
  'google-calendar',
  'google-sheets',
  'airtable',
  'shopify',
  'calendly',
  'sms',
  'web-control',
  'web-search',
] as const;

export type BuiltinSystemToolId = (typeof BUILTIN_SYSTEM_TOOL_IDS)[number];

/** Default built-in tools enabled on new website/template agents. */
export const DEFAULT_TEMPLATE_NODE_TOOL_IDS: BuiltinSystemToolId[] = ['web-search'];

export const WEB_SEARCH_BUILTIN_ID: BuiltinSystemToolId = 'web-search';

/** Merge toolsIds ensuring required built-ins are present (deduped, order preserved). */
export function mergeNodeToolsIds(
  existing: unknown,
  required: readonly string[] = DEFAULT_TEMPLATE_NODE_TOOL_IDS
): string[] {
  const base = Array.isArray(existing)
    ? existing.filter((t): t is string => typeof t === 'string' && t.trim().length > 0).map((t) => t.trim())
    : [];
  const out = [...base];
  for (const id of required) {
    if (!out.includes(id)) out.push(id);
  }
  return out;
}
