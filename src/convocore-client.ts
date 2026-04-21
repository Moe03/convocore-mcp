/**
 * ConvoCore API Client
 * Handles all API interactions with ConvoCore
 */

import WebSocket from 'ws';
import {
  ConvoCoreConfig,
  Agent,
  CreateAgentPayload,
  UpdateAgentPayload,
  CreateCrawlerJobPayload,
  CrawlerJob,
  CrawlerPageSummary,
  ApiResponse,
  ListAgentsResponse,
  ApiError,
  InteractRequest,
  InteractResult,
  InteractChunkMessage,
  UiEngineMessageSummary,
} from './types.js';

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

export class ConvoCoreClient {
  private config: ConvoCoreConfig;

  constructor(config: ConvoCoreConfig) {
    this.config = config;
  }

  private async request<T>(
    endpoint: string,
    options: RequestInit = {}
  ): Promise<T> {
    const url = `${this.config.baseUrl}${endpoint}`;
    
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

      const data = await response.json();

      if (!response.ok) {
        const error = data as ApiError;
        throw new Error(error.message || `API request failed with status ${response.status}`);
      }

      return data as T;
    } catch (error) {
      if (error instanceof Error) {
        throw error;
      }
      throw new Error('Unknown error occurred during API request');
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
   * List all agents - simple GET /agents endpoint
   */
  async listAgents(): Promise<any> {
    return this.request<any>('/agents');
  }

  /**
   * Search agents with filters
   * Note: workspaceId should be your actual workspace/org ID from ConvoCore
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

  // ==================== CONVERSATION METHODS ====================

  /**
   * List all conversations for an agent
   */
  async listConversations(
    agentId: string,
    page: number = 1,
    limit: number = 20
  ): Promise<any> {
    const params = new URLSearchParams({
      page: page.toString(),
      limit: limit.toString(),
    });
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
   * Delete a conversation
   */
  async deleteConversation(agentId: string, convoId: string): Promise<any> {
    return this.request<any>(`/agents/${agentId}/convos/${convoId}`, {
      method: 'DELETE',
    });
  }

  /**
   * Export all conversations for an agent
   */
  async exportAllConversations(
    agentId: string,
    format: 'json' | 'csv' = 'json'
  ): Promise<any> {
    const params = new URLSearchParams({ format });
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
   * - This consumes ConvoCore credits exactly like a normal agent turn.
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
}

