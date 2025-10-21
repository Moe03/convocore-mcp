/**
 * Configuration management for ConvoCore MCP Server
 */

import { ConvoCoreConfig } from './types.js';

export function getConfig(): ConvoCoreConfig {
  const workspaceSecret = process.env.WORKSPACE_SECRET;
  const apiRegion = (process.env.CONVOCORE_API_REGION || 'eu-gcp') as 'eu-gcp' | 'na-gcp';

  if (!workspaceSecret) {
    throw new Error('WORKSPACE_SECRET environment variable is required');
  }

  const baseUrl = apiRegion === 'na-gcp'
    ? 'https://na-gcp-api.vg-stuff.com/v3'
    : 'https://eu-gcp-api.vg-stuff.com/v3';

  return {
    workspaceSecret,
    apiRegion,
    baseUrl,
  };
}

