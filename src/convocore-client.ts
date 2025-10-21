/**
 * ConvoCore API Client
 * Handles all API interactions with ConvoCore
 */

import {
  ConvoCoreConfig,
  Agent,
  CreateAgentPayload,
  UpdateAgentPayload,
  ApiResponse,
  ListAgentsResponse,
  ApiError,
} from './types.js';

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
}

