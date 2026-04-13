/**
 * ConvoCore API TypeScript Type Definitions
 */

export interface ConvoCoreConfig {
  workspaceSecret: string;
  apiRegion: 'eu-gcp' | 'na-gcp';
  baseUrl: string;
}

export interface VoiceConfig {
  transcriber?: {
    provider: string;
    modelId?: string;
    language?: string;
    apiKey?: string;
    [key: string]: any;
  };
  speechGen?: {
    provider: string;
    modelId?: string;
    voiceId?: string;
    apiKey?: string;
    highAudioQuality?: boolean;
    [key: string]: any;
  };
  config?: {
    recordAudio: boolean;
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
  ownerID?: string;
  voiceConfig?: VoiceConfig;
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

