/**
 * Configuration management for ConvoCore MCP Server
 */

import { ConvoCoreConfig } from './types.js';

export type ConvoCoreConfigOptions = {
  workspaceSecret: string;
  apiRegion?: 'eu-gcp' | 'na-gcp';
  baseUrl?: string;
  interactWsUrl?: string;
  workspaceId?: string;
};

export function buildConfig(options: ConvoCoreConfigOptions): ConvoCoreConfig {
  const apiRegion = (options.apiRegion || process.env.CONVOCORE_API_REGION || 'eu-gcp') as
    | 'eu-gcp'
    | 'na-gcp';
  const baseUrlOverride = options.baseUrl || process.env.CONVOCORE_API_BASE_URL;
  const interactWsUrlOverride =
    options.interactWsUrl || process.env.CONVOCORE_INTERACT_WS_URL || undefined;
  const workspaceId =
    options.workspaceId?.trim() ||
    process.env.CONVOCORE_WORKSPACE_ID?.trim() ||
    undefined;

  const baseUrl =
    baseUrlOverride ||
    (apiRegion === 'na-gcp'
      ? 'https://na-gcp-api.vg-stuff.com/v3'
      : 'https://eu-gcp-api.vg-stuff.com/v3');

  return {
    workspaceSecret: options.workspaceSecret,
    apiRegion,
    baseUrl,
    interactWsUrl: interactWsUrlOverride || undefined,
    workspaceId,
  };
}

export function getConfig(): ConvoCoreConfig {
  const workspaceSecret = process.env.WORKSPACE_SECRET;

  if (!workspaceSecret) {
    throw new Error('WORKSPACE_SECRET environment variable is required');
  }

  return buildConfig({ workspaceSecret });
}

