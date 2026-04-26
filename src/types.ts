/**
 * ConvoCore API TypeScript Type Definitions
 */

export interface ConvoCoreConfig {
  workspaceSecret: string;
  apiRegion: 'eu-gcp' | 'na-gcp';
  baseUrl: string;
  /**
   * Optional explicit override for the /interact WebSocket URL.
   * When unset, the URL is derived from `baseUrl` by swapping the scheme
   * to ws/wss and pointing at /interact on the same host.
   * Set to e.g. `ws://localhost:5000/interact` to debug a local server
   * while keeping REST traffic on prod.
   */
  interactWsUrl?: string;
}

export interface VoiceConfig {
  transcriber?: {
    provider?: string;
    modelId?: string;
    language?: string;
    apiKey?: string;
    [key: string]: any;
  };
  speechGen?: {
    provider?: string;
    modelId?: string;
    voiceId?: string;
    apiKey?: string;
    highAudioQuality?: boolean;
    [key: string]: any;
  };
  config?: {
    recordAudio?: boolean;
    backgroundNoise?: string;
    enableWebCalling?: boolean;
    [key: string]: any;
  };
}

export interface Agent {
  ID?: string;
  id?: string;
  title?: string;
  description?: string;
  theme?: string;
  /** Workspace/org ID. Read-only on the agent document. */
  ownerID?: string;
  voiceConfig?: VoiceConfig;
  /** If true, the main prompt is nodes[0].instructions. */
  enableNodes?: boolean;
  /** Legacy main prompt for old/non-node agents. */
  vg_instructions?: string;
  /** Enables structured UI Engine output on /interact. */
  vg_enableUIEngine?: boolean;
  nodes?: Array<{ instructions?: string; name?: string; [key: string]: any }>;
  light?: boolean;
  enableVertex?: boolean;
  autoOpenWidget?: boolean;
  createdAtUNIX?: number;
  disabled?: boolean;
  isDeployed?: boolean;
  lastModified?: number;
  [key: string]: any;
}

export interface CreateAgentPayload {
  agent: {
    title: string;
    description?: string;
    theme?: string;
    voiceConfig?: VoiceConfig;
    enableNodes?: boolean;
    vg_instructions?: string;
    vg_enableUIEngine?: boolean;
    nodes?: Array<{ instructions?: string; name?: string; [key: string]: any }>;
    light?: boolean;
    enableVertex?: boolean;
    autoOpenWidget?: boolean;
    disabled?: boolean;
    [key: string]: any;
  };
}

export interface UpdateAgentPayload {
  agent: Partial<Agent>;
}

export interface ApiResponse<T = any> {
  success: boolean;
  message: string;
  data?: T;
}

export interface ListAgentsResponse extends ApiResponse {
  data: Agent[];
  total: number;
  totalPages: number;
  currentPage: number;
}

export interface ApiError {
  message: string;
  code?: string;
  issues?: Array<{ message: string }>;
}

export type CrawlerWebhookEvent =
  | 'page_scraped'
  | 'job_completed'
  | 'job_failed';

export type CrawlerJobStatus =
  | 'queued'
  | 'processing'
  | 'completed'
  | 'failed'
  | 'cancelled';

export interface CrawlerCrawlOptions {
  maxPages?: number;
  urlMatchers?: string[];
  unMatchers?: string[];
  stayOnDomain?: boolean;
}

export interface CrawlerWebhookConfig {
  url: string;
  events?: CrawlerWebhookEvent[];
  secret?: string;
  bearerToken?: string;
  headers?: Record<string, string>;
}

export interface CreateCrawlerJobPayload {
  urls: string[];
  crawl?: boolean;
  crawlOptions?: CrawlerCrawlOptions;
  deep?: boolean;
  useProxy?: boolean;
  refreshRate?: string;
  toAgentId?: string;
  toAgentIds?: string[];
  webhook?: CrawlerWebhookConfig;
}

export interface CrawlerJob {
  id: string;
  workspaceId: string;
  status: CrawlerJobStatus;
  primaryUrl: string;
  urls: string[];
  crawl: boolean;
  crawlOptions: CrawlerCrawlOptions | null;
  useProxy: boolean;
  deep: boolean;
  refreshRate: string | null;
  toAgentId: string | null;
  toAgentIds: string[];
  done: boolean;
  failed: boolean;
  isCancelled: boolean;
  message: string | null;
  resultError: string | null;
  createdAt: string | null;
  ts: number;
  currentPageIndex: number;
  scrapedPagesNum: number;
  failedPagesNum: number;
  pageLimit: number;
  creditsPerPage: number;
  estimatedCredits: number;
  activeScrapeUrl: string | null;
  crawlerJobId: string | null;
  webhook?: {
    url: string;
    events: CrawlerWebhookEvent[];
    hasSecret: boolean;
    hasBearerToken: boolean;
    headerKeys: string[];
  };
  scrapedUrls?: string[];
  scrapedHashes?: string[];
  pendingCandidateUrls?: string[];
  processedCrawlUrls?: string[];
  failedCrawlUrls?: string[];
  webhookFinalizedAt?: string | null;
  processingMode?: string | null;
  crawlerSubmittedAt?: string | null;
  crawlerWebhookUrl?: string | null;
  crawlerSubmissionEndpoint?: string | null;
}

// ==================== INTERACT (WebSocket) TYPES ====================

export type InteractBucket = 'voiceglow-eu' | '(default)';

export type InteractMessageType = 'text' | 'visual';

export interface InteractVisualPayload {
  image?: string;
  images?: string[];
  message?: string;
  imageCount?: number;
}

export interface InteractReplyTo {
  messageId?: string;
  messageContent?: string;
  messageFrom?: 'human' | 'bot';
  messageIndex?: number;
  turnIndex?: number;
}

export interface InteractLightConvoData {
  userID?: string;
  userName?: string;
  userEmail?: string;
  userPhone?: string;
  userImage?: string;
  origin?: string;
  nodesInfo?: { currentNode?: string; [k: string]: any };
  capturedVariables?: Record<string, any>;
  [key: string]: any;
}

/**
 * Mirrors EWSInteractModel — the single payload sent to the /interact
 * WebSocket after the connection opens.
 */
export interface InteractRequest {
  agentId: string;
  convoId: string;
  bucket: InteractBucket;
  prompt?: string;
  sessionId?: string;
  messageType?: InteractMessageType;
  visualPayload?: InteractVisualPayload;
  replyTo?: InteractReplyTo;
  actionMetadata?: { mid?: string; [k: string]: any };
  agentData?: Record<string, any>;
  workspaceData?: Record<string, any>;
  turnsHistory?: any[];
  lightConvoData?: InteractLightConvoData;
  disableUiEngine?: boolean;
  disableRecordHistory?: boolean;
  v2?: boolean;
  isTest?: boolean;
  isLLMStudio?: boolean;
  kbPreview?: boolean;
  agentProfileId?: string;
  toolTest?: {
    toolId: string;
    toolName: string;
    mode: 'validate' | 'generate-and-test';
  };
  formSubmissionMetadata?: Record<string, any>;
  initNodesOptions?: Record<string, any>;
  [key: string]: any;
}

export interface InteractAction {
  type: 'request_handoff' | 'tool_call' | string;
  payload?: string;
  toolMetadata?: {
    toolName?: string;
    input?: any;
    output?: any;
  };
  [key: string]: any;
}

/**
 * One streamed event from the /interact WebSocket. Mirrors EWSChunkModel.
 */
export interface InteractChunkMessage {
  type: 'chunk' | 'metadata' | 'debug' | 'action' | 'sync_chat_history' | string;
  chunk?: string;
  chunkIndex?: number;
  ui_engine?: boolean;
  isV2?: boolean;
  action?: InteractAction;
  turns?: any[];
  metadata?: {
    sources?: any[];
    turns?: any[];
    inputTokens?: number;
    outputTokens?: number;
    llmUsed?: string;
    [key: string]: any;
  };
  [key: string]: any;
}

/**
 * Compact summary of one UI Engine message extracted from the latest
 * snapshot — designed so the MCP host can scan the structure quickly
 * without re-parsing the whole TurnProps.
 */
export interface UiEngineMessageSummary {
  index: number;
  type: string;
  /** Short human-readable summary — first line of text, button names, card title, etc. */
  summary: string;
  /** True for form / input messages that require a web rendering surface. */
  webChannelOnly: boolean;
}

/**
 * Aggregated result returned by ConvoCoreClient.interactWithAgent — flattens
 * the streamed chunks into something an MCP host can consume in one shot.
 *
 * IMPORTANT semantics for UI Engine turns:
 * - `uiEngineSnapshot` is the LATEST parsed TurnProps from the final
 *   `ui_engine: true` chunk. UI Engine snapshots are overwriting (full
 *   snapshots), so this represents the final bot turn state.
 * - `uiEnginePayloads` is the chronological list of every parsed snapshot
 *   (kept for debugging when `raw: true`).
 */
export interface InteractResult {
  assistantText: string;
  uiEngineEnabled: boolean;
  uiEngineSnapshot: any | null;
  uiEngineSummary: UiEngineMessageSummary[];
  uiEnginePayloads: any[];
  actions: InteractAction[];
  metadata: InteractChunkMessage['metadata'] | null;
  turns: any[];
  chunks: InteractChunkMessage[];
  closeCode: number | null;
  closeReason: string;
  durationMs: number;
  timedOut: boolean;
}

export interface CrawlerPageSummary {
  id: string;
  url: string;
  urlHash: string;
  title: string;
  description: string;
  scrapedAt: number;
  imageUrl: string;
  userId: string;
  mdCharCount: number;
  htmlCharCount: number;
  failed: boolean;
}

