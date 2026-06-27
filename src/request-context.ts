/**
 * Per-request ConvoCore client/config for hosted (multi-tenant) mode.
 * Stdio mode sets a process-wide default from WORKSPACE_SECRET.
 */

import { AsyncLocalStorage } from 'node:async_hooks';
import { ConvoCoreClient } from './convocore-client.js';
import { ConvoCoreConfig } from './types.js';

export interface RequestContextStore {
  client: ConvoCoreClient;
  config: ConvoCoreConfig;
}

const storage = new AsyncLocalStorage<RequestContextStore>();

let defaultStore: RequestContextStore | null = null;

export function initDefaultRequestContext(client: ConvoCoreClient, config: ConvoCoreConfig): void {
  defaultStore = { client, config };
}

export function runWithRequestContext<T>(
  store: RequestContextStore,
  fn: () => T | Promise<T>
): T | Promise<T> {
  return storage.run(store, fn);
}

export function getActiveClient(): ConvoCoreClient {
  const store = storage.getStore() ?? defaultStore;
  if (!store) {
    throw new Error('ConvoCore MCP client is not initialized');
  }
  return store.client;
}

export function getActiveConfig(): ConvoCoreConfig {
  const store = storage.getStore() ?? defaultStore;
  if (!store) {
    throw new Error('ConvoCore MCP config is not initialized');
  }
  return store.config;
}

export function createRequestContext(config: ConvoCoreConfig): RequestContextStore {
  return {
    config,
    client: new ConvoCoreClient(config),
  };
}
