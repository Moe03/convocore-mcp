/**
 * Allowlisted incoming MCP headers that may be copied onto Convocore `/v3`
 * requests. Used so in-dashboard AI Wizard can present a signed passport
 * without opening public API / Cursor to lower plans.
 *
 * Never forward Authorization or arbitrary X-* — Cursor users can set those.
 */

const FORWARDED: ReadonlyArray<readonly [string, string]> = [
  ['x-vg-ai-wizard', 'X-VG-Ai-Wizard'],
  ['x-vg-workspace-id', 'X-VG-Workspace-Id'],
];

function headerString(value: string | string[] | undefined): string {
  const raw = Array.isArray(value) ? value[0] : value;
  return typeof raw === 'string' ? raw.trim() : '';
}

export function pickForwardedApiHeaders(req: {
  headers: Record<string, string | string[] | undefined>;
}): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [incoming, outgoing] of FORWARDED) {
    const value = headerString(req.headers[incoming]);
    if (value) out[outgoing] = value;
  }
  return out;
}
