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

