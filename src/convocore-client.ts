/**
 * Convocore API Client
 * Handles all API interactions with Convocore
 */

import WebSocket from 'ws';
import {
  ConvocoreConfig,
  Agent,
  CreateAgentPayload,
  UpdateAgentPayload,
  CreateCrawlerJobPayload,
  CrawlerJob,
  CrawlerPageSummary,
  ScrapeUrlResult,
  ApiResponse,
  ListAgentsResponse,
  ApiError,
  InteractRequest,
  InteractResult,
  InteractChunkMessage,
  UiEngineMessageSummary,
} from './types.js';
import { mapWithConcurrency } from './parallel.js';

/** Lean conversation projection for audit / bulk tools. */
export type ConversationBulkRow = {
  ID: string;
  summary: string | null;
  ts: number | null;
  capturedVariables: Record<string, unknown> | null;
  userName: string | null;
  origin: unknown;
};

export type QueryConversationsFilters = {
  origin?: string;
  tsFrom?: number;
  tsTo?: number;
  capturedVariableExists?: string;
  capturedVariableEquals?: { key: string; value: string };
  summaryContains?: string;
  hasUserName?: boolean;
};

/** Normalize URL for KB skipExisting matching (strip hash, lowercase host). */
export function normalizeKbUrl(raw: string): string {
  try {
    const u = new URL(raw.trim());
    u.hash = '';
    u.hostname = u.hostname.toLowerCase();
    if (
      (u.protocol === 'http:' && u.port === '80') ||
      (u.protocol === 'https:' && u.port === '443')
    ) {
      u.port = '';
    }
    let path = u.pathname;
    if (path.length > 1 && path.endsWith('/')) path = path.slice(0, -1);
    u.pathname = path || '/';
    return u.toString();
  } catch {
    return raw.trim().toLowerCase();
  }
}

export function kbDocNameFromUrl(raw: string): string {
  try {
    const u = new URL(raw);
    const parts = u.pathname.split('/').filter(Boolean);
    const last = parts[parts.length - 1];
    if (last) {
      return decodeURIComponent(last)
        .replace(/[-_]+/g, ' ')
        .replace(/\.[a-z0-9]+$/i, '')
        .trim()
        .slice(0, 120) || u.hostname;
    }
    return u.hostname;
  } catch {
    return raw.slice(0, 120);
  }
}

function collectKbSourceUrls(docs: any[]): Set<string> {
  const set = new Set<string>();
  for (const doc of docs) {
    if (!doc || typeof doc !== 'object') continue;
    if (typeof doc.url === 'string') set.add(normalizeKbUrl(doc.url));
    if (typeof doc.sourceUrl === 'string') set.add(normalizeKbUrl(doc.sourceUrl));
    if (Array.isArray(doc.urls)) {
      for (const u of doc.urls) {
        if (typeof u === 'string') set.add(normalizeKbUrl(u));
      }
    }
  }
  return set;
}

export class ConvocoreApiRequestError extends Error {
  status?: number;
  endpoint: string;
  method: string;
  code?: string;
  issues?: Array<{ message?: string; [key: string]: any }>;
  responseData?: unknown;
  rawBody?: string;

  constructor(args: {
    message: string;
    endpoint: string;
    method: string;
    status?: number;
    code?: string;
    issues?: Array<{ message?: string; [key: string]: any }>;
    responseData?: unknown;
    rawBody?: string;
  }) {
    super(args.message);
    this.name = 'ConvocoreApiRequestError';
    this.status = args.status;
    this.endpoint = args.endpoint;
    this.method = args.method;
    this.code = args.code;
    this.issues = args.issues;
    this.responseData = args.responseData;
    this.rawBody = args.rawBody;
  }
}

/**
 * Build a compact, scannable summary of the UI Engine snapshot so the MCP
 * host can validate / describe the bot turn without re-parsing the whole
 * TurnProps. The list intentionally collapses each message to its `type`
 * plus a short, type-specific summary string.
 */
function summarizeUiEngineSnapshot(snapshot: any | null): UiEngineMessageSummary[] {
  if (!snapshot || typeof snapshot !== 'object') return [];
  const messages = Array.isArray(snapshot.messages) ? snapshot.messages : [];

  return messages.map((msg: any, index: number): UiEngineMessageSummary => {
    const item = msg?.item ?? {};
    const type: string = item?.type ?? msg?.type ?? 'unknown';
    const payload = item?.payload ?? {};
    let summary = '';
    let webChannelOnly = false;

    switch (type) {
      case 'text': {
        const message = typeof payload?.message === 'string' ? payload.message : '';
        summary = message.length > 160 ? `${message.slice(0, 157)}...` : message;
        break;
      }
      case 'choice': {
        const buttons = Array.isArray(payload?.buttons) ? payload.buttons : [];
        const names = buttons
          .map((b: any) => (typeof b?.name === 'string' ? b.name : ''))
          .filter(Boolean);
        summary = `${buttons.length} button${buttons.length === 1 ? '' : 's'}: ${names.join(' | ')}`;
        break;
      }
      case 'visual': {
        summary = typeof payload?.image === 'string' ? `image: ${payload.image}` : 'image';
        break;
      }
      case 'cardV2': {
        const title = typeof payload?.title === 'string' ? payload.title : '';
        const buttonCount = Array.isArray(payload?.buttons) ? payload.buttons.length : 0;
        summary = `card "${title}" (${buttonCount} button${buttonCount === 1 ? '' : 's'})`;
        break;
      }
      case 'carousel': {
        const cards = Array.isArray(payload?.cards) ? payload.cards : [];
        summary = `carousel with ${cards.length} card${cards.length === 1 ? '' : 's'}`;
        break;
      }
      case 'iFrame': {
        summary = `${payload?.layout ?? 'unknown'} iframe: ${payload?.url ?? ''}`;
        break;
      }
      case 'form': {
        const fields = Array.isArray(payload?.fields) ? payload.fields : [];
        summary = `form "${payload?.title ?? ''}" with ${fields.length} field${fields.length === 1 ? '' : 's'}`;
        webChannelOnly = true;
        break;
      }
      case 'input': {
        const fieldId = payload?.field?.id ?? '';
        const fieldType = payload?.field?.type ?? '';
        summary = `input ${fieldType}${fieldId ? ` (#${fieldId})` : ''}`;
        webChannelOnly = true;
        break;
      }
      default: {
        summary = `(${type})`;
      }
    }

    return { index, type, summary, webChannelOnly };
  });
}

export class ConvocoreClient {
  private config: ConvocoreConfig;

  constructor(config: ConvocoreConfig) {
    this.config = config;
  }

  private async request<T>(
    endpoint: string,
    options: RequestInit = {}
  ): Promise<T> {
    const url = `${this.config.baseUrl}${endpoint}`;
    const method = options.method || 'GET';
    
    const headers: Record<string, string> = {
      'Authorization': `Bearer ${this.config.workspaceSecret}`,
      'Content-Type': 'application/json',
      ...((options.headers as Record<string, string>) || {}),
    };

    try {
      const response = await fetch(url, {
        ...options,
        headers,
      });

      const rawBody = await response.text();
      let data: unknown = null;

      if (rawBody.trim().length > 0) {
        try {
          data = JSON.parse(rawBody);
        } catch {
          data = rawBody;
        }
      }

      if (!response.ok) {
        const error = (data && typeof data === 'object' ? data : {}) as ApiError;
        const message = error.message || `API request failed with status ${response.status}`;
        throw new ConvocoreApiRequestError({
          message,
          endpoint,
          method,
          status: response.status,
          code: error.code,
          issues: Array.isArray(error.issues) ? error.issues : undefined,
          responseData: data,
          rawBody,
        });
      }

      return data as T;
    } catch (error) {
      if (error instanceof ConvocoreApiRequestError) {
        throw error;
      }
      if (error instanceof Error) {
        throw new ConvocoreApiRequestError({
          message: error.message,
          endpoint,
          method,
        });
      }
      throw new ConvocoreApiRequestError({
        message: 'Unknown error occurred during API request',
        endpoint,
        method,
      });
    }
  }

  /**
   * Create a new agent
   */
  async createAgent(payload: CreateAgentPayload): Promise<ApiResponse<Agent>> {
    return this.request<ApiResponse<Agent>>('/agents', {
      method: 'POST',
      body: JSON.stringify(payload),
    });
  }

  /**
   * Get a single agent by ID
   */
  async getAgent(agentId: string): Promise<ApiResponse<Agent>> {
    return this.request<ApiResponse<Agent>>(`/agents/${agentId}`);
  }

  /**
   * Update an existing agent
   */
  async updateAgent(
    agentId: string,
    payload: UpdateAgentPayload
  ): Promise<ApiResponse<Agent>> {
    return this.request<ApiResponse<Agent>>(`/agents/${agentId}`, {
      method: 'PATCH',
      body: JSON.stringify(payload),
    });
  }

  /**
   * Delete an agent
   */
  async deleteAgent(agentId: string): Promise<ApiResponse> {
    return this.request<ApiResponse>(`/agents/${agentId}`, {
      method: 'DELETE',
    });
  }

  /**
   * List agents — GET /agents. Pass `limit` to request a smaller first page when
   * the API supports it (ignored by servers that omit pagination).
   */
  async listAgents(opts?: { limit?: number }): Promise<any> {
    const lim = opts?.limit;
    const q =
      typeof lim === 'number' && lim > 0
        ? `?limit=${Math.min(Math.floor(lim), 500)}`
        : '';
    return this.request<any>(`/agents${q}`);
  }

  /**
   * Search agents with filters
   * Note: workspaceId should be your actual workspace/org ID from Convocore
   */
  async searchAgents(
    workspaceId: string,
    search?: string,
    page: number = 1,
    limit: number = 50,
    sortBy: string = 'newest',
    starredOnly: boolean = false
  ): Promise<any> {
    const params = new URLSearchParams({
      workspaceId,
      page: page.toString(),
      limit: limit.toString(),
      sortBy,
      starredOnly: starredOnly.toString(),
    });
    
    if (search) {
      params.append('search', search);
    }
    
    return this.request<any>(`/agents/search?${params.toString()}`);
  }

  /**
   * Export agent template
   */
  async exportAgentTemplate(agentId: string): Promise<any> {
    return this.request<any>(`/agents/${agentId}/export-template`);
  }

  /**
   * Import agent template
   */
  async importAgentTemplate(
    agentTemplate: any,
    agentName: string,
    fromAgentId?: string
  ): Promise<any> {
    return this.request<any>('/agents/import-template', {
      method: 'POST',
      body: JSON.stringify({
        agentTemplate,
        agentName,
        fromAgentId,
      }),
    });
  }

  /**
   * Get the agent's current customCSS string (the widget styling override).
   * Returns an empty string if the field is not set.
   */
  async getAgentCustomCSS(agentId: string): Promise<string> {
    const result = await this.getAgent(agentId);
    const agent: any = (result as any)?.data ?? result;
    const css = agent?.customCSS;
    return typeof css === 'string' ? css : '';
  }

  /**
   * Replace the agent's customCSS field. Pass an empty string to clear it.
   */
  async updateAgentCustomCSS(agentId: string, customCSS: string): Promise<ApiResponse<Agent>> {
    return this.updateAgent(agentId, { agent: { customCSS } });
  }

  /**
   * Get agent usage/credits
   */
  async getAgentUsage(
    agentId: string,
    range?: { from: string; to: string }
  ): Promise<any> {
    return this.request<any>(`/agents/${agentId}/usage`, {
      method: 'POST',
      body: JSON.stringify({ range }),
    });
  }

  /**
   * Fan-out usage for many agents (max 20 — enforced by schema).
   */
  async getAgentUsageBulk(
    agentIds: string[],
    range?: { from: string; to: string }
  ): Promise<{
    requested: number;
    returned: number;
    succeeded: Array<{ agentId: string; usage: any }>;
    failed: Array<{ id: string; error: string }>;
  }> {
    const unique = [...new Set(agentIds.map((id) => id.trim()).filter(Boolean))];
    const batch = await mapWithConcurrency(unique, async (agentId) => {
      const usage = await this.getAgentUsage(agentId, range);
      return { agentId, usage };
    });
    return {
      requested: unique.length,
      returned: batch.succeeded.length,
      succeeded: batch.succeeded,
      failed: batch.failed,
    };
  }

  // ==================== CONVERSATION METHODS ====================

  /**
   * List conversations for an agent (cursor pagination).
   * API rejects page>1 without cursor — when cursor is set, page is omitted.
   */
  async listConversations(
    agentId: string,
    page: number = 1,
    limit: number = 20,
    cursor?: string
  ): Promise<any> {
    const cappedLimit = Math.min(Math.max(limit || 20, 1), 20);
    const params = new URLSearchParams({
      limit: String(cappedLimit),
    });
    if (cursor) {
      params.set('cursor', cursor);
    } else {
      // First page only without cursor
      params.set('page', String(page > 1 ? 1 : page));
    }
    return this.request<any>(`/agents/${agentId}/convos?${params.toString()}`);
  }

  /**
   * Create a new conversation
   */
  async createConversation(agentId: string, conversation: any): Promise<any> {
    return this.request<any>(`/agents/${agentId}/convos`, {
      method: 'POST',
      body: JSON.stringify({ conversation }),
    });
  }

  /**
   * Get a single conversation
   */
  async getConversation(agentId: string, convoId: string): Promise<any> {
    return this.request<any>(`/agents/${agentId}/convos/${convoId}`);
  }

  /** Unwrap API envelope `{ data }` when present. */
  private unwrapData(result: any): any {
    if (result && typeof result === 'object' && 'data' in result && result.data != null) {
      return result.data;
    }
    return result;
  }

  projectConversationBulkRow(raw: any): ConversationBulkRow {
    const doc = this.unwrapData(raw) ?? {};
    const id =
      (typeof doc.ID === 'string' && doc.ID) ||
      (typeof doc.id === 'string' && doc.id) ||
      '';
    const captured =
      doc.capturedVariables && typeof doc.capturedVariables === 'object'
        ? (doc.capturedVariables as Record<string, unknown>)
        : null;
    return {
      ID: id,
      summary: typeof doc.summary === 'string' ? doc.summary : null,
      ts: typeof doc.ts === 'number' ? doc.ts : null,
      capturedVariables: captured,
      userName: typeof doc.userName === 'string' ? doc.userName : null,
      origin: doc.origin ?? null,
    };
  }

  /**
   * Fan-out GET /convos/{id} for many IDs. Max 50 per call (enforced by caller/schema).
   */
  async getConversationsBulk(
    agentId: string,
    convoIds: string[]
  ): Promise<{
    agentId: string;
    requested: number;
    returned: number;
    failed: Array<{ id: string; error: string }>;
    data: ConversationBulkRow[];
  }> {
    const unique = [...new Set(convoIds.map((id) => id.trim()).filter(Boolean))];
    const batch = await mapWithConcurrency(unique, async (convoId) => {
      const raw = await this.getConversation(agentId, convoId);
      return this.projectConversationBulkRow(raw);
    });

    return {
      agentId,
      requested: unique.length,
      returned: batch.succeeded.length,
      failed: batch.failed,
      data: batch.succeeded,
    };
  }

  /**
   * MCP-side filter: cursor-page list, then bulk-get rows that need summary/vars.
   * Not a server-side analytics query — bounded by maxScan.
   */
  async queryConversations(
    agentId: string,
    options: {
      limit?: number;
      maxScan?: number;
      filters?: QueryConversationsFilters;
    } = {}
  ): Promise<{
    agentId: string;
    matched: number;
    scanned: number;
    hasMoreUnscanned: boolean;
    nextListCursor: string | null;
    data: ConversationBulkRow[];
    failed: Array<{ id: string; error: string }>;
  }> {
    const limit = Math.min(Math.max(options.limit ?? 50, 1), 100);
    const maxScan = Math.min(Math.max(options.maxScan ?? 200, 1), 500);
    const filters = options.filters ?? {};
    const needsDetail =
      filters.capturedVariableExists != null ||
      filters.capturedVariableEquals != null ||
      (typeof filters.summaryContains === 'string' && filters.summaryContains.length > 0) ||
      filters.hasUserName != null;

    const listCandidates: any[] = [];
    let cursor: string | undefined;
    let hasMore = true;
    let nextListCursor: string | null = null;

    while (hasMore && listCandidates.length < maxScan) {
      const pageLimit = Math.min(20, maxScan - listCandidates.length);
      const page = await this.listConversations(agentId, 1, pageLimit, cursor);
      const rows: any[] = Array.isArray(page?.data)
        ? page.data
        : Array.isArray(page)
          ? page
          : [];
      for (const row of rows) {
        if (listCandidates.length >= maxScan) break;
        listCandidates.push(row);
      }
      hasMore = Boolean(page?.hasMore);
      nextListCursor = typeof page?.nextCursor === 'string' ? page.nextCursor : null;
      if (!hasMore || !nextListCursor) break;
      cursor = nextListCursor;
    }

    const cheapFiltered = listCandidates.filter((row) => {
      if (filters.origin != null) {
        const origin =
          typeof row.origin === 'string'
            ? row.origin
            : row.origin != null
              ? String(row.origin)
              : '';
        if (origin !== filters.origin) return false;
      }
      if (filters.tsFrom != null && typeof row.ts === 'number' && row.ts < filters.tsFrom) {
        return false;
      }
      if (filters.tsTo != null && typeof row.ts === 'number' && row.ts > filters.tsTo) {
        return false;
      }
      return true;
    });

    const ids = cheapFiltered
      .map((row) => (typeof row.ID === 'string' ? row.ID : typeof row.id === 'string' ? row.id : ''))
      .filter(Boolean);

    let detailed: ConversationBulkRow[] = [];
    const failed: Array<{ id: string; error: string }> = [];

    if (needsDetail || filters.hasUserName != null) {
      // Fetch in chunks of 50
      for (let i = 0; i < ids.length; i += 50) {
        const chunk = ids.slice(i, i + 50);
        const bulk = await this.getConversationsBulk(agentId, chunk);
        detailed.push(...bulk.data);
        failed.push(...bulk.failed);
      }
    } else {
      // List-only projection (summary/vars usually missing on PG list)
      detailed = cheapFiltered.map((row) => this.projectConversationBulkRow(row));
    }

    const matchedRows = detailed.filter((row) => {
      if (filters.hasUserName === true && !(row.userName && row.userName.trim())) return false;
      if (filters.hasUserName === false && row.userName && row.userName.trim()) return false;
      if (filters.capturedVariableExists) {
        const vars = row.capturedVariables;
        if (!vars || !(filters.capturedVariableExists in vars)) return false;
      }
      if (filters.capturedVariableEquals) {
        const { key, value } = filters.capturedVariableEquals;
        const vars = row.capturedVariables;
        if (!vars || String(vars[key]) !== value) return false;
      }
      if (filters.summaryContains) {
        const needle = filters.summaryContains.toLowerCase();
        const hay = (row.summary || '').toLowerCase();
        if (!hay.includes(needle)) return false;
      }
      return true;
    });

    const hasMoreUnscanned = Boolean(hasMore && listCandidates.length >= maxScan);

    return {
      agentId,
      matched: Math.min(matchedRows.length, limit),
      scanned: listCandidates.length,
      hasMoreUnscanned,
      nextListCursor: hasMoreUnscanned ? nextListCursor : null,
      data: matchedRows.slice(0, limit),
      failed,
    };
  }

  /**
   * Update a conversation
   */
  async updateConversation(
    agentId: string,
    convoId: string,
    conversation: any
  ): Promise<any> {
    return this.request<any>(`/agents/${agentId}/convos/${convoId}`, {
      method: 'PATCH',
      body: JSON.stringify({ conversation }),
    });
  }

  /**
   * Replace the stored turn/message history for a conversation.
   * Writes to voiceglow/{agentId}/convos/{convoId}/convo/JSON_STRING via
   * the V3 /messages endpoint. This is separate from updateConversation,
   * which only patches the light conversation document.
   */
  async updateConversationMessages(
    agentId: string,
    convoId: string,
    payload: {
      turns: any[];
      updateConversationMetadata?: boolean;
      lgMessages?: any[];
    }
  ): Promise<any> {
    return this.request<any>(`/agents/${agentId}/convos/${convoId}/messages`, {
      method: 'PATCH',
      body: JSON.stringify(payload),
    });
  }

  /**
   * Delete a conversation
   */
  async deleteConversation(agentId: string, convoId: string): Promise<any> {
    return this.request<any>(`/agents/${agentId}/convos/${convoId}`, {
      method: 'DELETE',
    });
  }

  /**
   * Export conversations for an agent (paid workspace / hasEverPaid).
   * Supports cursor pagination and optional convoIds selected mode.
   */
  async exportAllConversations(
    agentId: string,
    format: 'json' | 'csv' = 'json',
    options?: {
      limit?: number;
      sort?: string;
      fromTs?: number;
      toTs?: number;
      cursor?: string;
      convoIds?: string[];
    }
  ): Promise<any> {
    const params = new URLSearchParams({ format });
    if (options?.limit != null) params.set('limit', String(options.limit));
    if (options?.sort) params.set('sort', options.sort);
    if (options?.fromTs != null) params.set('fromTs', String(options.fromTs));
    if (options?.toTs != null) params.set('toTs', String(options.toTs));
    if (options?.cursor) params.set('cursor', options.cursor);
    if (options?.convoIds?.length) {
      for (const id of options.convoIds) {
        params.append('convoIds', id);
      }
    }
    return this.request<any>(`/agents/${agentId}/convos/export?${params.toString()}`);
  }

  /**
   * Export a single conversation
   */
  async exportConversation(
    agentId: string,
    convoId: string,
    format: 'json' | 'csv' = 'json'
  ): Promise<any> {
    const params = new URLSearchParams({ format });
    return this.request<any>(
      `/agents/${agentId}/convos/${convoId}/export?${params.toString()}`
    );
  }

  /**
   * Assign a conversation to a user
   */
  async assignConversation(
    agentId: string,
    convoId: string,
    assignToUserId: string,
    delegatedBy?: string
  ): Promise<any> {
    return this.request<any>(`/agents/${agentId}/convos/${convoId}/assign`, {
      method: 'POST',
      body: JSON.stringify({ assignToUserId, delegatedBy }),
    });
  }

  // ==================== KNOWLEDGE BASE METHODS ====================

  /**
   * Create a knowledge base document
   */
  async createKBDoc(agentId: string, kbData: any): Promise<any> {
    return this.request<any>(`/agents/${agentId}/kb`, {
      method: 'POST',
      body: JSON.stringify(kbData),
    });
  }

  /**
   * List all KB docs for an agent
   */
  async listKBDocs(
    agentId: string,
    page: number = 1,
    pageSize: number = 20
  ): Promise<any> {
    const params = new URLSearchParams({
      page: page.toString(),
      pageSize: pageSize.toString(),
    });
    return this.request<any>(`/agents/${agentId}/kb?${params.toString()}`);
  }

  /**
   * Get a single KB document
   */
  async getKBDoc(agentId: string, docId: string): Promise<any> {
    return this.request<any>(`/agents/${agentId}/kb/${docId}`);
  }

  /**
   * Fan-out KB docs (max 30 — enforced by schema).
   * By default returns compact metadata without full chunk bodies.
   */
  async getKbDocsBulk(
    agentId: string,
    docIds: string[],
    options?: { includeContent?: boolean }
  ): Promise<{
    agentId: string;
    requested: number;
    returned: number;
    failed: Array<{ id: string; error: string }>;
    data: Array<{
      id: string;
      name: string | null;
      tags: string[] | null;
      sourceType: string | null;
      chunksPreview?: unknown;
      content?: unknown;
      chunks?: unknown;
    }>;
  }> {
    const includeContent = Boolean(options?.includeContent);
    const unique = [...new Set(docIds.map((id) => id.trim()).filter(Boolean))];
    const batch = await mapWithConcurrency(unique, async (docId) => {
      const raw = await this.getKBDoc(agentId, docId);
      const doc = this.unwrapData(raw) ?? {};
      const id =
        (typeof doc.ID === 'string' && doc.ID) ||
        (typeof doc.id === 'string' && doc.id) ||
        docId;
      const tags = Array.isArray(doc.tags) ? doc.tags.map(String) : null;
      const chunks = Array.isArray(doc.chunks) ? doc.chunks : undefined;
      const row: {
        id: string;
        name: string | null;
        tags: string[] | null;
        sourceType: string | null;
        chunksPreview?: unknown;
        content?: unknown;
        chunks?: unknown;
      } = {
        id,
        name: typeof doc.name === 'string' ? doc.name : null,
        tags,
        sourceType: typeof doc.sourceType === 'string' ? doc.sourceType : null,
      };
      if (includeContent) {
        if (chunks) row.chunks = chunks;
        if (doc.content != null) row.content = doc.content;
      } else if (chunks) {
        row.chunksPreview = {
          count: chunks.length,
          firstChunkPreview:
            typeof chunks[0]?.content === 'string'
              ? chunks[0].content.slice(0, 200)
              : typeof chunks[0] === 'string'
                ? chunks[0].slice(0, 200)
                : null,
        };
      }
      return row;
    });

    return {
      agentId,
      requested: unique.length,
      returned: batch.succeeded.length,
      failed: batch.failed,
      data: batch.succeeded,
    };
  }

  /**
   * Update a KB document
   */
  async updateKBDoc(agentId: string, docId: string, kbData: any): Promise<any> {
    return this.request<any>(`/agents/${agentId}/kb/${docId}`, {
      method: 'PATCH',
      body: JSON.stringify(kbData),
    });
  }

  /**
   * Delete a KB document
   */
  async deleteKBDoc(agentId: string, docId: string): Promise<any> {
    return this.request<any>(`/agents/${agentId}/kb/${docId}`, {
      method: 'DELETE',
    });
  }

  /**
   * Get KB stats for an agent
   */
  async getKBStats(agentId: string): Promise<any> {
    return this.request<any>(`/agents/${agentId}/kb/stats`);
  }

  /**
   * List all KB docs across pages (bounded). Used for skipExisting on URL sync.
   */
  async listAllKBDocs(
    agentId: string,
    options?: { maxDocs?: number; pageSize?: number }
  ): Promise<any[]> {
    const maxDocs = Math.min(Math.max(options?.maxDocs ?? 500, 1), 2000);
    const pageSize = Math.min(Math.max(options?.pageSize ?? 50, 1), 100);
    const docs: any[] = [];
    let page = 1;
    while (docs.length < maxDocs) {
      const raw = await this.listKBDocs(agentId, page, pageSize);
      const batch = Array.isArray(raw?.data)
        ? raw.data
        : Array.isArray(this.unwrapData(raw))
          ? (this.unwrapData(raw) as any[])
          : [];
      if (batch.length === 0) break;
      docs.push(...batch);
      const totalPages =
        typeof raw?.totalPages === 'number' ? raw.totalPages : undefined;
      if (totalPages != null && page >= totalPages) break;
      if (batch.length < pageSize) break;
      page += 1;
    }
    return docs.slice(0, maxDocs);
  }

  /**
   * Mass-add URL sources via the KB router (server scrapes — do not pre-scrape).
   * - mode=batch: one POST with urls[] (API docs example)
   * - mode=per_url: fan-out one KB doc per URL (better for named hotel/page sources)
   */
  async createKbFromUrls(
    agentId: string,
    input: {
      urls: string[];
      mode?: 'batch' | 'per_url';
      name?: string;
      tags?: string[];
      refreshRate?: '3d' | '7d' | 'never';
      scrapeContent?: boolean;
      skipExisting?: boolean;
      metadata?: { description: string };
    }
  ): Promise<{
    agentId: string;
    mode: 'batch' | 'per_url';
    requested: number;
    skippedExisting: string[];
    submitted: number;
    succeeded: Array<{ url?: string; name: string; result: unknown }>;
    failed: Array<{ id: string; error: string }>;
    note: string;
  }> {
    const mode = input.mode ?? 'per_url';
    const scrapeContent = input.scrapeContent !== false;
    const refreshRate = input.refreshRate ?? 'never';
    const tags = input.tags;
    const metadata = input.metadata;

    const uniqueUrls = [
      ...new Set(
        input.urls
          .map((u) => (typeof u === 'string' ? u.trim() : ''))
          .filter((u) => {
            try {
              void new URL(u);
              return true;
            } catch {
              return false;
            }
          })
      ),
    ];

    let urls = uniqueUrls;
    const skippedExisting: string[] = [];
    if (input.skipExisting && urls.length > 0) {
      const existingDocs = await this.listAllKBDocs(agentId);
      const existing = collectKbSourceUrls(existingDocs);
      const next: string[] = [];
      for (const u of urls) {
        if (existing.has(normalizeKbUrl(u))) {
          skippedExisting.push(u);
        } else {
          next.push(u);
        }
      }
      urls = next;
    }

    const note =
      'KB router scrapes asynchronously. Poll get_kb_doc / list_kb_docs for status; do not re-scrape with scrape_url or web fetch.';

    if (urls.length === 0) {
      return {
        agentId,
        mode,
        requested: uniqueUrls.length,
        skippedExisting,
        submitted: 0,
        succeeded: [],
        failed: [],
        note,
      };
    }

    if (mode === 'batch') {
      const name = (input.name?.trim() || 'Website pages').slice(0, 200);
      try {
        const result = await this.createKBDoc(agentId, {
          name,
          sourceType: 'url',
          urls,
          scrapeContent,
          refreshRate,
          ...(tags ? { tags } : {}),
          ...(metadata ? { metadata } : {}),
        });
        return {
          agentId,
          mode,
          requested: uniqueUrls.length,
          skippedExisting,
          submitted: urls.length,
          succeeded: [{ name, result }],
          failed: [],
          note,
        };
      } catch (err) {
        return {
          agentId,
          mode,
          requested: uniqueUrls.length,
          skippedExisting,
          submitted: urls.length,
          succeeded: [],
          failed: [
            {
              id: name,
              error: err instanceof Error ? err.message : String(err),
            },
          ],
          note,
        };
      }
    }

    const prefix = input.name?.trim();
    const batch = await mapWithConcurrency(
      urls,
      async (url) => {
        const name = (prefix
          ? `${prefix} — ${kbDocNameFromUrl(url)}`
          : kbDocNameFromUrl(url)
        ).slice(0, 200);
        const result = await this.createKBDoc(agentId, {
          name,
          sourceType: 'url',
          urls: [url],
          scrapeContent,
          refreshRate,
          ...(tags ? { tags } : {}),
          ...(metadata ? { metadata } : {}),
        });
        return { url, name, result };
      },
      { getId: (url) => url }
    );

    return {
      agentId,
      mode,
      requested: uniqueUrls.length,
      skippedExisting,
      submitted: urls.length,
      succeeded: batch.succeeded,
      failed: batch.failed,
      note,
    };
  }

  // ==================== WORKSPACE METHODS ====================

  /** List workspaces visible to the authenticated workspace secret. */
  async listWorkspaces(): Promise<any> {
    return this.request<any>('/workspaces');
  }

  /** Get a single workspace by id. */
  async getWorkspace(workspaceId: string): Promise<any> {
    return this.request<any>(`/workspaces/${encodeURIComponent(workspaceId)}`);
  }

  // ==================== CRAWLER METHODS ====================

  /**
   * Create a crawler job for a workspace
   */
  async createCrawlerJob(
    workspaceId: string,
    payload: CreateCrawlerJobPayload
  ): Promise<ApiResponse<CrawlerJob>> {
    return this.request<ApiResponse<CrawlerJob>>(
      `/workspaces/${workspaceId}/crawler/jobs`,
      {
        method: 'POST',
        body: JSON.stringify(payload),
      }
    );
  }

  /**
   * List crawler jobs for a workspace
   */
  async listCrawlerJobs(
    workspaceId: string,
    page: number = 1,
    limit: number = 20
  ): Promise<ApiResponse<{ jobs: CrawlerJob[]; total: number; page: number; pageSize: number }>> {
    const params = new URLSearchParams({
      page: page.toString(),
      limit: limit.toString(),
    });

    return this.request<ApiResponse<{ jobs: CrawlerJob[]; total: number; page: number; pageSize: number }>>(
      `/workspaces/${workspaceId}/crawler/jobs?${params.toString()}`
    );
  }

  /**
   * Get a single crawler job
   */
  async getCrawlerJob(workspaceId: string, jobId: string): Promise<ApiResponse<CrawlerJob>> {
    return this.request<ApiResponse<CrawlerJob>>(
      `/workspaces/${workspaceId}/crawler/jobs/${jobId}`
    );
  }

  /**
   * Delete a crawler job
   */
  async deleteCrawlerJob(workspaceId: string, jobId: string): Promise<ApiResponse> {
    return this.request<ApiResponse>(
      `/workspaces/${workspaceId}/crawler/jobs/${jobId}`,
      {
        method: 'DELETE',
      }
    );
  }

  /**
   * List scraped pages for a crawler job
   */
  async listCrawlerJobPages(
    workspaceId: string,
    jobId: string,
    page: number = 1,
    limit: number = 20
  ): Promise<ApiResponse<{ pages: CrawlerPageSummary[]; total: number; page: number; pageSize: number }>> {
    const params = new URLSearchParams({
      page: page.toString(),
      limit: limit.toString(),
    });

    return this.request<ApiResponse<{ pages: CrawlerPageSummary[]; total: number; page: number; pageSize: number }>>(
      `/workspaces/${workspaceId}/crawler/jobs/${jobId}/pages?${params.toString()}`
    );
  }

  /**
   * Get a single scraped page for a crawler job
   */
  async getCrawlerJobPage(
    workspaceId: string,
    jobId: string,
    pageId: string
  ): Promise<any> {
    return this.request<any>(
      `/workspaces/${workspaceId}/crawler/jobs/${jobId}/pages/${pageId}`
    );
  }

  /**
   * Scrape one URL and wait for the crawler service to store the page result.
   */
  async scrapeUrl(workspaceId: string, url: string): Promise<ApiResponse<ScrapeUrlResult>> {
    const created = await this.createCrawlerJob(workspaceId, {
      urls: [url],
      crawl: false,
      deep: false,
      useProxy: false,
    });

    const initialJob = created.data;
    if (!initialJob?.id) {
      return {
        success: created.success,
        message: created.message,
        data: initialJob
          ? {
              job: initialJob,
              page: null,
              pages: [],
              timedOut: false,
            }
          : undefined,
      };
    }

    const jobId = initialJob.id;
    const deadline = Date.now() + 120_000;
    let latestJob = initialJob;
    let timedOut = false;

    while (!latestJob.done && !latestJob.failed && !latestJob.isCancelled) {
      if (Date.now() >= deadline) {
        timedOut = true;
        break;
      }

      await new Promise((resolve) => setTimeout(resolve, 2_000));
      const jobResult = await this.getCrawlerJob(workspaceId, jobId);
      if (jobResult.data) {
        latestJob = jobResult.data;
      }
    }

    const pagesResult = await this.listCrawlerJobPages(workspaceId, jobId, 1, 10);
    const pages = pagesResult.data?.pages ?? [];
    const firstPage = pages[0]
      ? await this.getCrawlerJobPage(workspaceId, jobId, pages[0].id)
      : null;

    return {
      success: !latestJob.failed && !latestJob.isCancelled && !timedOut,
      message: timedOut
        ? `Scrape job ${jobId} did not finish within 120 seconds`
        : latestJob.resultError || latestJob.message || `Scrape job ${jobId} finished`,
      data: {
        job: latestJob,
        page: firstPage,
        pages,
        timedOut,
      },
    };
  }

  // ==================== VOICES (TTS) METHODS ====================

  /**
   * List all supported voice (TTS) providers and the workspace secret key
   * each provider uses (e.g. ELEVENLABS_API_KEY).
   */
  async listVoiceProviders(): Promise<any> {
    return this.request<any>('/voices/providers');
  }

  /**
   * List the available TTS models for a given provider (e.g. eleven_multilingual_v2,
   * aura-2). Useful when a provider has model-specific voice catalogs.
   */
  async listVoiceModels(provider: string): Promise<any> {
    return this.request<any>(`/voices/${encodeURIComponent(provider)}/models`);
  }

  /**
   * Unified search across one or more providers. All filters are optional.
   * `providers` is a comma-separated list of provider slugs.
   */
  async searchVoices(filters: {
    language?: string;
    gender?: string;
    accent?: string;
    modelId?: string;
    providers?: string;
    limit?: number;
    offset?: number;
  } = {}): Promise<any> {
    const qs = this.buildVoiceQuery(filters);
    return this.request<any>(`/voices${qs}`);
  }

  /**
   * Browse a single provider's voice catalog with optional filters.
   */
  async listProviderVoices(
    provider: string,
    filters: {
      language?: string;
      gender?: string;
      accent?: string;
      modelId?: string;
      limit?: number;
      offset?: number;
    } = {}
  ): Promise<any> {
    const qs = this.buildVoiceQuery(filters);
    return this.request<any>(`/voices/${encodeURIComponent(provider)}${qs}`);
  }

  /**
   * Get full metadata + preview MP3 URL for a single voice.
   */
  async getVoice(provider: string, voiceId: string): Promise<any> {
    return this.request<any>(
      `/voices/${encodeURIComponent(provider)}/${encodeURIComponent(voiceId)}`
    );
  }

  private buildVoiceQuery(filters: Record<string, string | number | undefined>): string {
    const params = new URLSearchParams();
    for (const [key, value] of Object.entries(filters)) {
      if (value === undefined || value === null || value === '') continue;
      params.append(key, String(value));
    }
    const qs = params.toString();
    return qs ? `?${qs}` : '';
  }

  // ==================== TWILIO NUMBER METHODS ====================

  /**
   * Buy a new Twilio number from the platform's Twilio account.
   */
  async buyTwilioNumber(
    number: string,
    agentId?: string,
    capabilities: Array<'voice' | 'sms'> = ['voice', 'sms']
  ): Promise<any> {
    return this.request<any>('/utils/buy-twilio-number', {
      method: 'POST',
      body: JSON.stringify({ number, agentId, capabilities }),
    });
  }

  /**
   * Import a Twilio number you already own into the workspace using your own
   * Twilio account credentials.
   */
  async importTwilioNumber(payload: Record<string, unknown>): Promise<any> {
    return this.request<any>('/utils/import-twilio-number', {
      method: 'POST',
      body: JSON.stringify(payload),
    });
  }

  /**
   * Release (delete) a Twilio number from the workspace.
   */
  async releaseTwilioNumber(payload: Record<string, unknown>): Promise<any> {
    return this.request<any>('/utils/twilio/release-number', {
      method: 'POST',
      body: JSON.stringify(payload),
    });
  }

  /**
   * Repair / re-sync the Twilio webhook configuration for a number.
   */
  async checkTwilioNumber(payload: Record<string, unknown>): Promise<any> {
    return this.request<any>('/utils/twilio/check-number', {
      method: 'POST',
      body: JSON.stringify(payload),
    });
  }

  /**
   * Assign a Twilio number to an agent for SMS handling.
   */
  async syncSmsTwilioNumber(payload: Record<string, unknown>): Promise<any> {
    return this.request<any>('/utils/twilio/sync-sms', {
      method: 'POST',
      body: JSON.stringify(payload),
    });
  }

  // ==================== INTERACT (WebSocket) METHODS ====================

  /**
   * Build the WebSocket URL for the /interact endpoint.
   *
   * Precedence:
   *   1. `config.interactWsUrl` (from env `CONVOCORE_INTERACT_WS_URL`) — used
   *      verbatim. Lets you point ONLY the WebSocket at a local debug server
   *      (e.g. `ws://localhost:5000/interact`) while REST keeps hitting prod.
   *   2. Derived from `config.baseUrl` by swapping the scheme to ws/wss and
   *      pointing at /interact on the same host (preserves port).
   */
  private getInteractWsUrl(): string {
    if (this.config.interactWsUrl) {
      return this.config.interactWsUrl;
    }

    const base = this.config.baseUrl;
    let url: URL;
    try {
      url = new URL(base);
    } catch {
      throw new Error(`Invalid baseUrl in config: ${base}`);
    }

    const wsProtocol = url.protocol === 'http:' ? 'ws:' : 'wss:';
    return `${wsProtocol}//${url.host}/interact`;
  }

  /**
   * Derive the bucket discriminator from the configured region. Callers can
   * override by setting `bucket` explicitly on the InteractRequest.
   */
  getDefaultInteractBucket(): 'voiceglow-eu' | '(default)' {
    return this.config.apiRegion === 'eu-gcp' ? 'voiceglow-eu' : '(default)';
  }

  /**
   * Drive a single agent turn over the /interact WebSocket. Opens a WSS
   * connection, sends one InteractObject, collects every streamed chunk
   * until the server closes (code 1000) or the timeout fires, then returns
   * an aggregated result.
   *
   * Notes:
   * - This consumes Convocore credits exactly like a normal agent turn.
   * - Authentication is sent via the `Authorization: Bearer <secret>` header
   *   on the WS handshake (same scheme as REST).
   */
  async interactWithAgent(
    request: InteractRequest,
    options: { timeoutMs?: number } = {}
  ): Promise<InteractResult> {
    const timeoutMs = Math.max(1000, Math.min(options.timeoutMs ?? 120_000, 600_000));
    const url = this.getInteractWsUrl();
    const startedAt = Date.now();

    return new Promise<InteractResult>((resolve, reject) => {
      let settled = false;
      const chunks: InteractChunkMessage[] = [];
      const assistantTextParts: string[] = [];
      const uiEnginePayloads: any[] = [];
      const actions: InteractChunkMessage['action'] extends infer A ? A[] : never[] = [] as any;
      let metadata: InteractChunkMessage['metadata'] | null = null;
      let turns: any[] = [];
      let timedOut = false;
      let uiEngineEnabled = false;
      let uiEngineSnapshot: any | null = null;

      let ws: WebSocket;
      try {
        ws = new WebSocket(url, {
          headers: {
            Authorization: `Bearer ${this.config.workspaceSecret}`,
          },
        });
      } catch (err) {
        reject(err instanceof Error ? err : new Error(String(err)));
        return;
      }

      const timer = setTimeout(() => {
        if (settled) return;
        timedOut = true;
        try {
          ws.close(1000, 'mcp-client-timeout');
        } catch {
          // ignore
        }
      }, timeoutMs);

      const finalize = (closeCode: number | null, closeReason: string) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        resolve({
          assistantText: assistantTextParts.join(''),
          uiEngineEnabled,
          uiEngineSnapshot,
          uiEngineSummary: summarizeUiEngineSnapshot(uiEngineSnapshot),
          uiEnginePayloads,
          actions: actions as any,
          metadata,
          turns,
          chunks,
          closeCode,
          closeReason,
          durationMs: Date.now() - startedAt,
          timedOut,
        });
      };

      ws.on('open', () => {
        try {
          ws.send(JSON.stringify(request));
        } catch (err) {
          if (!settled) {
            settled = true;
            clearTimeout(timer);
            reject(err instanceof Error ? err : new Error(String(err)));
          }
        }
      });

      ws.on('message', (raw: WebSocket.RawData) => {
        let text: string;
        if (typeof raw === 'string') {
          text = raw;
        } else if (Buffer.isBuffer(raw)) {
          text = raw.toString('utf8');
        } else if (Array.isArray(raw)) {
          text = Buffer.concat(raw).toString('utf8');
        } else {
          text = Buffer.from(raw as ArrayBuffer).toString('utf8');
        }

        let msg: InteractChunkMessage;
        try {
          msg = JSON.parse(text) as InteractChunkMessage;
        } catch {
          // Non-JSON frames are still surfaced as raw chunks so callers can debug.
          msg = { type: 'chunk', chunk: text };
        }

        chunks.push(msg);

        switch (msg.type) {
          case 'chunk': {
            if (msg.ui_engine && typeof msg.chunk === 'string') {
              uiEngineEnabled = true;
              try {
                const parsed = JSON.parse(msg.chunk);
                uiEnginePayloads.push(parsed);
                // UI Engine snapshots are OVERWRITING (full snapshot each
                // time). Always keep the latest as the canonical state.
                uiEngineSnapshot = parsed;
              } catch {
                uiEnginePayloads.push(msg.chunk);
              }
            } else if (typeof msg.chunk === 'string') {
              assistantTextParts.push(msg.chunk);
            }
            break;
          }
          case 'action': {
            if (msg.action) {
              (actions as any).push(msg.action);
            }
            break;
          }
          case 'metadata': {
            if (msg.metadata) metadata = msg.metadata;
            if (Array.isArray(msg.metadata?.turns)) {
              turns = msg.metadata!.turns!;
            }
            break;
          }
          case 'sync_chat_history': {
            if (Array.isArray(msg.turns)) turns = msg.turns;
            break;
          }
          // 'debug' frames are kept in `chunks` but not aggregated.
          default:
            break;
        }
      });

      ws.on('error', (err: Error) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        reject(err);
      });

      ws.on('close', (code: number, reason: Buffer) => {
        finalize(code ?? null, reason?.toString('utf8') ?? '');
      });
    });
  }

  // ==================== Orgs / Agency / Clients ====================

  async listOrgs(opts?: { page?: number; pageSize?: number }): Promise<any> {
    const q = new URLSearchParams();
    if (opts?.page != null) q.set('page', String(opts.page));
    if (opts?.pageSize != null) q.set('pageSize', String(opts.pageSize));
    const qs = q.toString();
    return this.request(`/orgs${qs ? `?${qs}` : ''}`);
  }

  async searchOrgs(opts?: {
    search?: string;
    page?: number;
    pageSize?: number;
  }): Promise<any> {
    const q = new URLSearchParams();
    if (opts?.search) q.set('search', opts.search);
    if (opts?.page != null) q.set('page', String(opts.page));
    if (opts?.pageSize != null) q.set('pageSize', String(opts.pageSize));
    const qs = q.toString();
    return this.request(`/orgs/search${qs ? `?${qs}` : ''}`);
  }

  async getOrg(orgId: string): Promise<any> {
    return this.request(`/orgs/${encodeURIComponent(orgId)}`);
  }

  async createOrg(body: {
    name: string;
    squarePhotoURL?: string;
    email?: string;
  }): Promise<any> {
    return this.request('/orgs', { method: 'POST', body: JSON.stringify(body) });
  }

  async updateOrg(orgId: string, org: Record<string, unknown>): Promise<any> {
    return this.request(`/orgs/${encodeURIComponent(orgId)}`, {
      method: 'PATCH',
      body: JSON.stringify({ org }),
    });
  }

  async deleteOrg(orgId: string): Promise<any> {
    return this.request(`/orgs/${encodeURIComponent(orgId)}`, { method: 'DELETE' });
  }

  async listOrgClients(
    orgId: string,
    opts?: { page?: number; pageSize?: number }
  ): Promise<any> {
    const q = new URLSearchParams();
    if (opts?.page != null) q.set('page', String(opts.page));
    if (opts?.pageSize != null) q.set('pageSize', String(opts.pageSize));
    const qs = q.toString();
    return this.request(
      `/orgs/${encodeURIComponent(orgId)}/clients${qs ? `?${qs}` : ''}`
    );
  }

  async listOrgAgents(
    orgId: string,
    opts?: { page?: number; pageSize?: number }
  ): Promise<any> {
    const q = new URLSearchParams();
    if (opts?.page != null) q.set('page', String(opts.page));
    if (opts?.pageSize != null) q.set('pageSize', String(opts.pageSize));
    const qs = q.toString();
    return this.request(
      `/orgs/${encodeURIComponent(orgId)}/agents${qs ? `?${qs}` : ''}`
    );
  }

  async listOrgMembersAndTeams(orgId: string): Promise<any> {
    return this.request(`/orgs/${encodeURIComponent(orgId)}/members-and-teams`);
  }

  async assignOrgAgent(
    orgId: string,
    agentId: string,
    action: 'assign' | 'unassign'
  ): Promise<any> {
    return this.request(
      `/orgs/${encodeURIComponent(orgId)}/agents/${encodeURIComponent(agentId)}`,
      { method: 'POST', body: JSON.stringify({ action }) }
    );
  }

  async getAgentOrgClients(agentId: string): Promise<any> {
    return this.request(`/agents/${encodeURIComponent(agentId)}/org-clients`);
  }

  async getAgency(): Promise<any> {
    return this.request('/agency');
  }

  async upsertAgency(agency: Record<string, unknown>): Promise<any> {
    return this.request('/agency', {
      method: 'POST',
      body: JSON.stringify({ agency }),
    });
  }

  async deleteAgency(): Promise<any> {
    return this.request('/agency', { method: 'DELETE' });
  }

  async listClients(opts?: {
    orgId?: string;
    page?: number;
    pageSize?: number;
  }): Promise<any> {
    const q = new URLSearchParams();
    if (opts?.orgId) q.set('orgId', opts.orgId);
    if (opts?.page != null) q.set('page', String(opts.page));
    if (opts?.pageSize != null) q.set('pageSize', String(opts.pageSize));
    const qs = q.toString();
    return this.request(`/clients${qs ? `?${qs}` : ''}`);
  }

  async getClient(clientId: string): Promise<any> {
    return this.request(`/clients/${encodeURIComponent(clientId)}`);
  }

  async createClient(clientData: Record<string, unknown>): Promise<any> {
    return this.request('/clients', {
      method: 'POST',
      body: JSON.stringify({ clientData }),
    });
  }

  async updateClient(
    clientId: string | undefined,
    clientData: Record<string, unknown>
  ): Promise<any> {
    return this.request('/clients/update', {
      method: 'POST',
      body: JSON.stringify({
        ...(clientId ? { clientId } : {}),
        clientData,
      }),
    });
  }

  async deleteClient(clientId: string): Promise<any> {
    return this.request(`/clients/${encodeURIComponent(clientId)}`, {
      method: 'DELETE',
    });
  }

  async checkClientEmail(body: {
    email: string;
    clientId?: string;
    orgId?: string;
  }): Promise<any> {
    return this.request('/clients/check-email', {
      method: 'POST',
      body: JSON.stringify(body),
    });
  }

  // ==================== Leads CRM ====================

  async listLeads(opts: {
    agentId: string;
    cursor?: string;
    limit?: number;
    page?: number;
  }): Promise<any> {
    const q = new URLSearchParams();
    q.set('agentId', opts.agentId);
    if (opts.cursor) q.set('cursor', opts.cursor);
    if (opts.limit != null) q.set('limit', String(opts.limit));
    if (opts.page != null) q.set('page', String(opts.page));
    return this.request(`/leads?${q.toString()}`);
  }

  async listAgentLeads(
    agentId: string,
    opts?: {
      page?: number;
      limit?: number;
      groupName?: string;
      searchTerm?: string;
      searchField?: string;
      propertyFilter?: string;
      leadFilters?: string;
    }
  ): Promise<any> {
    const q = new URLSearchParams();
    if (opts?.page != null) q.set('page', String(opts.page));
    if (opts?.limit != null) q.set('limit', String(opts.limit));
    if (opts?.groupName) q.set('groupName', opts.groupName);
    if (opts?.searchTerm) q.set('searchTerm', opts.searchTerm);
    if (opts?.searchField) q.set('searchField', opts.searchField);
    if (opts?.propertyFilter) q.set('propertyFilter', opts.propertyFilter);
    if (opts?.leadFilters) q.set('leadFilters', opts.leadFilters);
    const qs = q.toString();
    return this.request(
      `/agents/${encodeURIComponent(agentId)}/leads${qs ? `?${qs}` : ''}`
    );
  }

  async getLead(id: string, agentId: string): Promise<any> {
    const q = new URLSearchParams({ agentId });
    return this.request(`/leads/${encodeURIComponent(id)}?${q.toString()}`);
  }

  async createLead(lead: Record<string, unknown>): Promise<any> {
    return this.request('/leads', {
      method: 'POST',
      body: JSON.stringify({ lead }),
    });
  }

  async updateLead(
    id: string,
    agentId: string,
    lead: Record<string, unknown>
  ): Promise<any> {
    return this.request(`/leads/${encodeURIComponent(id)}`, {
      method: 'PATCH',
      body: JSON.stringify({ agentId, lead }),
    });
  }

  async deleteLead(id: string, agentId: string): Promise<any> {
    const q = new URLSearchParams({ agentId });
    return this.request(`/leads/${encodeURIComponent(id)}?${q.toString()}`, {
      method: 'DELETE',
    });
  }

  async deleteAgentLeads(agentId: string, leadIds: string[]): Promise<any> {
    const q = new URLSearchParams();
    for (const id of leadIds) q.append('leadIds', id);
    return this.request(
      `/agents/${encodeURIComponent(agentId)}/leads?${q.toString()}`,
      { method: 'DELETE' }
    );
  }

  async deleteAllAgentLeads(agentId: string): Promise<any> {
    return this.request(`/agents/${encodeURIComponent(agentId)}/leads/all`, {
      method: 'DELETE',
    });
  }

  async deleteLeadsByGroup(agentId: string, groupId: string): Promise<any> {
    const q = new URLSearchParams({ groupId });
    return this.request(
      `/agents/${encodeURIComponent(agentId)}/leads/group?${q.toString()}`,
      { method: 'DELETE' }
    );
  }

  async importAgentLeadsBulk(
    agentId: string,
    leads: Array<Record<string, unknown>>
  ): Promise<any> {
    return this.request(`/agents/${encodeURIComponent(agentId)}/leads/bulk`, {
      method: 'POST',
      body: JSON.stringify({ leads }),
    });
  }

  async magicImportLeads(
    agentId: string,
    body: {
      rawText: string;
      leadGroupId?: string;
      additionalInstructions?: string;
    }
  ): Promise<any> {
    return this.request(
      `/agents/${encodeURIComponent(agentId)}/magic-import-leads`,
      { method: 'POST', body: JSON.stringify(body) }
    );
  }

  async exportAgentLeads(
    agentId: string,
    opts?: { timeRange?: string }
  ): Promise<any> {
    const q = new URLSearchParams();
    if (opts?.timeRange) q.set('timeRange', opts.timeRange);
    const qs = q.toString();
    return this.request(
      `/agents/${encodeURIComponent(agentId)}/leads/export${qs ? `?${qs}` : ''}`
    );
  }

  async exportFilteredAgentLeads(
    agentId: string,
    body: Record<string, unknown>
  ): Promise<any> {
    return this.request(
      `/agents/${encodeURIComponent(agentId)}/leads/export-filtered`,
      { method: 'POST', body: JSON.stringify(body) }
    );
  }

  // ==================== Agent HTTP tools / variables ====================

  async listAgentTools(agentId: string): Promise<any> {
    return this.request(`/agents/${encodeURIComponent(agentId)}/tools`);
  }

  async getAgentTool(toolId: string): Promise<any> {
    return this.request(`/tools/${encodeURIComponent(toolId)}`);
  }

  async createAgentTool(
    agentId: string,
    tool: Record<string, unknown>
  ): Promise<any> {
    return this.request(`/agents/${encodeURIComponent(agentId)}/tools`, {
      method: 'POST',
      body: JSON.stringify({ tool }),
    });
  }

  async updateAgentTool(
    toolId: string,
    tool: Record<string, unknown>
  ): Promise<any> {
    return this.request(`/tools/${encodeURIComponent(toolId)}`, {
      method: 'PATCH',
      body: JSON.stringify({ tool }),
    });
  }

  async deleteAgentTool(toolId: string): Promise<any> {
    return this.request(`/tools/${encodeURIComponent(toolId)}`, {
      method: 'DELETE',
    });
  }

  async listAgentVariables(agentId: string): Promise<any> {
    return this.request(`/agents/${encodeURIComponent(agentId)}/variables`);
  }

  async getAgentVariable(variableId: string): Promise<any> {
    return this.request(`/variables/${encodeURIComponent(variableId)}`);
  }

  async createAgentVariable(
    agentId: string,
    variable: Record<string, unknown>
  ): Promise<any> {
    return this.request(`/agents/${encodeURIComponent(agentId)}/variables`, {
      method: 'POST',
      body: JSON.stringify({ variable }),
    });
  }

  async updateAgentVariable(
    variableId: string,
    variable: Record<string, unknown>
  ): Promise<any> {
    return this.request(`/variables/${encodeURIComponent(variableId)}`, {
      method: 'PATCH',
      body: JSON.stringify({ variable }),
    });
  }

  async deleteAgentVariable(variableId: string): Promise<any> {
    return this.request(`/variables/${encodeURIComponent(variableId)}`, {
      method: 'DELETE',
    });
  }

  /**
   * Dry-run an agent HTTP tool against its serverUrl with field overrides.
   * Does not go through the agent LLM — fires the HTTP request directly.
   */
  async testAgentToolRequest(opts: {
    toolId: string;
    fieldOverrides?: Record<string, unknown>;
    bodyOverride?: unknown;
    timeoutMs?: number;
  }): Promise<{
    success: boolean;
    tool: { id: string; name?: string; method?: string; serverUrl?: string };
    request: {
      method: string;
      url: string;
      headers: Record<string, string>;
      body: unknown;
    };
    response: {
      status: number;
      ok: boolean;
      headers: Record<string, string>;
      body: unknown;
      rawBody: string;
    };
  }> {
    const toolRes = await this.getAgentTool(opts.toolId);
    const tool =
      (toolRes && typeof toolRes === 'object' && (toolRes as any).data) ||
      toolRes;
    if (!tool || typeof tool !== 'object') {
      throw new ConvocoreApiRequestError({
        message: 'Tool not found or unexpected response shape',
        endpoint: `/tools/${opts.toolId}`,
        method: 'GET',
      });
    }

    const method = String((tool as any).method || 'POST').toUpperCase();
    const serverUrl = String((tool as any).serverUrl || '').trim();
    if (!serverUrl) {
      throw new ConvocoreApiRequestError({
        message: 'Tool has no serverUrl — cannot run HTTP test request',
        endpoint: `/tools/${opts.toolId}`,
        method: 'GET',
      });
    }

    const fields: any[] = Array.isArray((tool as any).fields)
      ? (tool as any).fields
      : [];
    const overrides = opts.fieldOverrides || {};
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      Accept: 'application/json',
    };
    const secret = (tool as any).serverUrlSecret;
    if (typeof secret === 'string' && secret.trim()) {
      headers['Authorization'] = `Bearer ${secret.trim()}`;
    }

    const query: Record<string, string> = {};
    const bodyObj: Record<string, unknown> = {};

    for (const field of fields) {
      if (!field || typeof field !== 'object') continue;
      const key = String(field.key || field.id || '').trim();
      if (!key) continue;
      const value =
        key in overrides
          ? overrides[key]
          : field.value !== undefined
            ? field.value
            : field.defaultValue;
      if (value === undefined || value === null) continue;
      const loc = String(field.in || 'body').toLowerCase();
      if (loc === 'header') {
        headers[key] = String(value);
      } else if (loc === 'query') {
        query[key] = String(value);
      } else {
        bodyObj[key] = value;
      }
    }

    for (const [k, v] of Object.entries(overrides)) {
      if (!(k in bodyObj) && !(k in query) && !(k in headers)) {
        bodyObj[k] = v;
      }
    }

    const url = new URL(serverUrl);
    for (const [k, v] of Object.entries(query)) {
      url.searchParams.set(k, v);
    }

    const bodyPayload =
      opts.bodyOverride !== undefined
        ? opts.bodyOverride
        : Object.keys(bodyObj).length > 0
          ? bodyObj
          : undefined;

    const controller = new AbortController();
    const timeoutMs = opts.timeoutMs ?? 30_000;
    const timer = setTimeout(() => controller.abort(), timeoutMs);

    let response: Response;
    try {
      response = await fetch(url.toString(), {
        method,
        headers,
        body:
          method === 'GET' || method === 'HEAD'
            ? undefined
            : bodyPayload !== undefined
              ? JSON.stringify(bodyPayload)
              : undefined,
        signal: controller.signal,
      });
    } finally {
      clearTimeout(timer);
    }

    const rawBody = await response.text();
    let parsed: unknown = rawBody;
    if (rawBody.trim()) {
      try {
        parsed = JSON.parse(rawBody);
      } catch {
        parsed = rawBody;
      }
    }

    const respHeaders: Record<string, string> = {};
    response.headers.forEach((v, k) => {
      respHeaders[k] = v;
    });

    return {
      success: response.ok,
      tool: {
        id: String((tool as any).id || opts.toolId),
        name: (tool as any).name,
        method,
        serverUrl,
      },
      request: {
        method,
        url: url.toString(),
        headers: Object.fromEntries(
          Object.entries(headers).map(([k, v]) =>
            k.toLowerCase() === 'authorization' ? [k, '[REDACTED]'] : [k, v]
          )
        ),
        body: bodyPayload ?? null,
      },
      response: {
        status: response.status,
        ok: response.ok,
        headers: respHeaders,
        body: parsed,
        rawBody: rawBody.slice(0, 50_000),
      },
    };
  }

  async runAgentAutoTest(body: {
    agentId: string;
    config?: {
      testMode?:
        | 'full'
        | 'kb-only'
        | 'tools-only'
        | 'prompt-only'
        | 'with-tools'
        | 'with-kb';
      maxTurns?: number;
      naturalEnd?: boolean;
      testScenario?: string;
      enabledToolIds?: string[];
      enableKB?: boolean;
    };
  }): Promise<any> {
    return this.request('/auto-test/run', {
      method: 'POST',
      body: JSON.stringify(body),
    });
  }

  // ==================== Clone / channel send ====================

  async cloneAgent(
    agentId: string,
    body?: {
      overrides?: Record<string, unknown>;
      carryOver?: {
        kb?: boolean;
        voiceConfig?: boolean;
        uiEngineConfig?: boolean;
      };
    }
  ): Promise<any> {
    return this.request(`/agents/${encodeURIComponent(agentId)}/clone`, {
      method: 'POST',
      body: JSON.stringify(body || {}),
    });
  }

  async sendChannelMessage(
    agentId: string,
    convoId: string,
    body: {
      message?: string;
      messages?: Array<Record<string, unknown>>;
      sourceLabel?: string;
      options?: Record<string, unknown>;
    }
  ): Promise<any> {
    return this.request(
      `/agents/${encodeURIComponent(agentId)}/convos/${encodeURIComponent(convoId)}/send`,
      { method: 'POST', body: JSON.stringify(body) }
    );
  }

  // ==================== KB extras ====================

  async searchKBDocs(
    agentId: string,
    body: Record<string, unknown>
  ): Promise<any> {
    return this.request(`/agents/${encodeURIComponent(agentId)}/kb/search`, {
      method: 'POST',
      body: JSON.stringify(body),
    });
  }

  async bulkDeleteKBDocs(agentId: string, docIds: string[]): Promise<any> {
    return this.request(`/agents/${encodeURIComponent(agentId)}/kb/delete`, {
      method: 'POST',
      body: JSON.stringify({ docIds }),
    });
  }

  async bulkCreateKBDocs(
    agentId: string,
    docs: Array<Record<string, unknown>>
  ): Promise<any> {
    return this.request(`/agents/${encodeURIComponent(agentId)}/kb/docs/bulk`, {
      method: 'POST',
      body: JSON.stringify({ docs }),
    });
  }

  async createKBImages(
    agentId: string,
    body: {
      images: Array<{
        sourceUrl?: string;
        data?: string;
        mimeType?: string;
      }>;
      autoCaption?: boolean;
      tags?: string[];
      targetDocName: string;
    }
  ): Promise<any> {
    return this.request(`/agents/${encodeURIComponent(agentId)}/kb/images`, {
      method: 'POST',
      body: JSON.stringify(body),
    });
  }

  async getKBQuota(workspaceId?: string): Promise<any> {
    const q = new URLSearchParams();
    if (workspaceId) q.set('workspaceId', workspaceId);
    const qs = q.toString();
    return this.request(`/workspace/kb-docs/quota${qs ? `?${qs}` : ''}`);
  }
}

