/**
 * Per-request Convocore client/config for hosted (multi-tenant) mode.
 * Stdio mode sets a process-wide default from WORKSPACE_SECRET.
 */

import { AsyncLocalStorage } from 'node:async_hooks';
import { ConvocoreClient } from './convocore-client.js';
import { ConvocoreConfig } from './types.js';

export interface RequestContextStore {
  client: ConvocoreClient;
  config: ConvocoreConfig;
}

const storage = new AsyncLocalStorage<RequestContextStore>();

let defaultStore: RequestContextStore | null = null;

export function initDefaultRequestContext(client: ConvocoreClient, config: ConvocoreConfig): void {
  defaultStore = { client, config };
}

export function runWithRequestContext<T>(
  store: RequestContextStore,
  fn: () => T | Promise<T>
): T | Promise<T> {
  return storage.run(store, fn);
}

export function getActiveClient(): ConvocoreClient {
  const store = storage.getStore() ?? defaultStore;
  if (!store) {
    throw new Error('Convocore MCP client is not initialized');
  }
  return store.client;
}

export function getActiveConfig(): ConvocoreConfig {
  const store = storage.getStore() ?? defaultStore;
  if (!store) {
    throw new Error('Convocore MCP config is not initialized');
  }
  return store.config;
}

export function createRequestContext(config: ConvocoreConfig): RequestContextStore {
  return {
    config,
    client: new ConvocoreClient(config),
  };
}
