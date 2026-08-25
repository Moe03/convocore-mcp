/**
 * Compact vs full list payloads for MCP tools.
 * Default is compact so list responses stay token-cheap.
 */

export type ListMode = 'compact' | 'full';

export const ListModeSchemaDescribe =
  'compact (default): short summary fields only — token-cheap. full: complete API objects (heavy). Prefer get_* for one item.';

function asRecord(v: unknown): Record<string, unknown> | null {
  if (!v || typeof v !== 'object' || Array.isArray(v)) return null;
  return v as Record<string, unknown>;
}

function truncate(s: unknown, max: number): unknown {
  if (typeof s !== 'string') return s;
  if (s.length <= max) return s;
  return `${s.slice(0, Math.max(0, max - 3))}...`;
}

function pick(
  src: Record<string, unknown>,
  keys: readonly string[]
): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const key of keys) {
    if (src[key] !== undefined) out[key] = src[key];
  }
  return out;
}

function mapArrayField(
  envelope: Record<string, unknown>,
  field: string,
  mapper: (item: unknown) => unknown
): void {
  if (Array.isArray(envelope[field])) {
    envelope[field] = (envelope[field] as unknown[]).map(mapper);
  }
}

function withCompactMeta(
  result: unknown,
  note: string
): unknown {
  if (result == null) return result;
  if (Array.isArray(result)) {
    return {
      mode: 'compact',
      note,
      data: result,
      count: result.length,
    };
  }
  const src = asRecord(result);
  if (!src) return result;
  return { ...src, mode: 'compact', note };
}

// —— Agents ——

const COMPACT_AGENT_KEYS = [
  'ID',
  'id',
  'title',
  'description',
  'theme',
  'ownerID',
  'agentPlatform',
  'disabled',
  'isDeployed',
  'enableNodes',
  'vg_enableUIEngine',
  'createdAtUNIX',
  'lastModified',
  'starred',
  'isStarred',
] as const;

function compactAgent(agent: unknown): unknown {
  const src = asRecord(agent);
  if (!src) return agent;
  const out = pick(src, COMPACT_AGENT_KEYS);
  if (out.ID == null && out.id != null) out.ID = out.id;
  out.description = truncate(out.description, 160);
  return out;
}

export function compactAgentsListResult(result: unknown): unknown {
  if (result == null) return result;
  if (Array.isArray(result)) {
    return withCompactMeta(
      result.map(compactAgent),
      'Compact agents: id/title/description/theme/flags/timestamps. Use mode="full" or get_agent for full docs.'
    );
  }
  const src = asRecord(result);
  if (!src) return result;
  const out = { ...src };
  mapArrayField(out, 'data', compactAgent);
  mapArrayField(out, 'agents', compactAgent);
  mapArrayField(out, 'starredAgents', compactAgent);
  return withCompactMeta(
    out,
    'Compact agents: id/title/description/theme/flags/timestamps. Use mode="full" or get_agent for full docs.'
  );
}

// —— Conversations ——

const COMPACT_CONVO_KEYS = [
  'ID',
  'id',
  'convoId',
  'ts',
  'createdAt',
  'updatedAt',
  'summary',
  'userName',
  'userEmail',
  'userPhone',
  'origin',
  'channel',
  'status',
  'assignedTo',
  'agentId',
] as const;

function compactConversation(row: unknown): unknown {
  const src = asRecord(row);
  if (!src) return row;
  const out = pick(src, COMPACT_CONVO_KEYS);
  if (out.ID == null && (out.id != null || out.convoId != null)) {
    out.ID = out.id ?? out.convoId;
  }
  out.summary = truncate(out.summary, 200);
  // Drop heavy nested blobs if somehow present
  delete (out as any).messages;
  delete (out as any).turns;
  delete (out as any).history;
  return out;
}

export function compactConversationsListResult(result: unknown): unknown {
  if (result == null) return result;
  if (Array.isArray(result)) {
    return withCompactMeta(
      result.map(compactConversation),
      'Compact conversations: id/ts/summary/user/origin. Use mode="full" or get_conversation / get_conversations_bulk for messages & captured vars.'
    );
  }
  const src = asRecord(result);
  if (!src) return result;
  const out = { ...src };
  mapArrayField(out, 'data', compactConversation);
  mapArrayField(out, 'conversations', compactConversation);
  return withCompactMeta(
    out,
    'Compact conversations: id/ts/summary/user/origin. Use mode="full" or get_conversation / get_conversations_bulk for messages & captured vars.'
  );
}

// —— KB docs ——

const COMPACT_KB_KEYS = [
  'id',
  'ID',
  'docId',
  'name',
  'title',
  'sourceType',
  'status',
  'url',
  'sourceUrl',
  'urls',
  'tags',
  'createdAt',
  'updatedAt',
  'lastModified',
  'refreshRate',
  'scrapeContent',
  'chunkCount',
  'error',
  'errorMessage',
] as const;

function compactKbDoc(doc: unknown): unknown {
  const src = asRecord(doc);
  if (!src) return doc;
  const out = pick(src, COMPACT_KB_KEYS);
  if (out.id == null && (out.ID != null || out.docId != null)) {
    out.id = out.ID ?? out.docId;
  }
  // Never include full scraped content in compact lists
  delete (out as any).content;
  delete (out as any).text;
  delete (out as any).chunks;
  delete (out as any).embeddings;
  delete (out as any).payload;
  if (Array.isArray(out.urls) && out.urls.length > 5) {
    out.urls = [...(out.urls as unknown[]).slice(0, 5), `…+${out.urls.length - 5} more`];
  }
  return out;
}

export function compactKbDocsListResult(result: unknown): unknown {
  if (result == null) return result;
  if (Array.isArray(result)) {
    return withCompactMeta(
      result.map(compactKbDoc),
      'Compact KB list: id/name/status/urls — no content. Use mode="full" or get_kb_doc for body text.'
    );
  }
  const src = asRecord(result);
  if (!src) return result;
  const out = { ...src };
  mapArrayField(out, 'data', compactKbDoc);
  mapArrayField(out, 'docs', compactKbDoc);
  mapArrayField(out, 'documents', compactKbDoc);
  return withCompactMeta(
    out,
    'Compact KB list: id/name/status/urls — no content. Use mode="full" or get_kb_doc for body text.'
  );
}

// —— Leads ——

const COMPACT_LEAD_KEYS = [
  'id',
  'ID',
  'email',
  'name',
  'phone',
  'agentId',
  'convoId',
  'ts',
  'createdAt',
  'groupId',
  'groupName',
  'source',
  'status',
] as const;

function compactLead(lead: unknown): unknown {
  const src = asRecord(lead);
  if (!src) return lead;
  const out = pick(src, COMPACT_LEAD_KEYS);
  if (out.id == null && out.ID != null) out.id = out.ID;

  // Flatten a few meta fields without dumping whole metaData
  const meta = asRecord(src.metaData) || asRecord(src.metadata);
  if (meta) {
    if (out.source == null && meta.source != null) out.source = meta.source;
    if (meta.company != null) out.company = truncate(meta.company, 80);
  }
  // Common alternate shapes from bulk import
  if (out.email == null && src.userEmail != null) out.email = src.userEmail;
  if (out.name == null && src.userName != null) out.name = src.userName;
  if (out.phone == null && src.userPhone != null) out.phone = src.userPhone;

  delete (out as any).metaData;
  delete (out as any).metadata;
  delete (out as any).raw;
  return out;
}

export function compactLeadsListResult(result: unknown): unknown {
  if (result == null) return result;
  if (Array.isArray(result)) {
    return withCompactMeta(
      result.map(compactLead),
      'Compact leads: id/name/email/phone/ts/source. Use mode="full" or leads_read action=get for full metaData.'
    );
  }
  const src = asRecord(result);
  if (!src) return result;
  const out = { ...src };
  mapArrayField(out, 'data', compactLead);
  mapArrayField(out, 'leads', compactLead);
  return withCompactMeta(
    out,
    'Compact leads: id/name/email/phone/ts/source. Use mode="full" or leads_read action=get for full metaData.'
  );
}

// —— Orgs / clients ——

const COMPACT_ORG_KEYS = [
  'id',
  'ID',
  'orgId',
  'name',
  'email',
  'squarePhotoURL',
  'createdAt',
  'updatedAt',
] as const;

const COMPACT_CLIENT_KEYS = [
  'id',
  'ID',
  'clientId',
  'name',
  'email',
  'orgId',
  'status',
  'createdAt',
  'updatedAt',
] as const;

function compactOrg(item: unknown): unknown {
  const src = asRecord(item);
  if (!src) return item;
  const out = pick(src, COMPACT_ORG_KEYS);
  if (out.id == null) out.id = out.ID ?? out.orgId;
  return out;
}

function compactClient(item: unknown): unknown {
  const src = asRecord(item);
  if (!src) return item;
  const out = pick(src, COMPACT_CLIENT_KEYS);
  if (out.id == null) out.id = out.ID ?? out.clientId;
  return out;
}

export function compactOrgsListResult(result: unknown): unknown {
  if (result == null) return result;
  if (Array.isArray(result)) {
    return withCompactMeta(result.map(compactOrg), 'Compact orgs list. mode="full" for complete org objects.');
  }
  const src = asRecord(result);
  if (!src) return result;
  const out = { ...src };
  mapArrayField(out, 'data', compactOrg);
  mapArrayField(out, 'orgs', compactOrg);
  return withCompactMeta(out, 'Compact orgs list. mode="full" for complete org objects.');
}

export function compactClientsListResult(result: unknown): unknown {
  if (result == null) return result;
  if (Array.isArray(result)) {
    return withCompactMeta(
      result.map(compactClient),
      'Compact clients list. mode="full" for complete client objects.'
    );
  }
  const src = asRecord(result);
  if (!src) return result;
  const out = { ...src };
  mapArrayField(out, 'data', compactClient);
  mapArrayField(out, 'clients', compactClient);
  return withCompactMeta(out, 'Compact clients list. mode="full" for complete client objects.');
}

/** Apply compact transform unless mode is full. */
export function applyListMode<T>(
  mode: ListMode | undefined,
  result: T,
  compactFn: (r: unknown) => unknown
): unknown {
  if ((mode ?? 'compact') === 'full') return result;
  return compactFn(result);
}

export { COMPACT_AGENT_KEYS };
