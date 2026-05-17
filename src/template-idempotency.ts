import { createHash } from 'node:crypto';
import { promises as fs } from 'node:fs';
import { resolve } from 'node:path';

type StoreData = {
  version: 1;
  records: Record<string, { agentId: string; savedAt: number }>;
};

const STORE_PATH = resolve(process.cwd(), '.convocore-template-idempotency.json');

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function stableNormalize(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(stableNormalize);
  }
  if (isPlainRecord(value)) {
    const out: Record<string, unknown> = {};
    for (const key of Object.keys(value).sort()) {
      out[key] = stableNormalize(value[key]);
    }
    return out;
  }
  if (typeof value === 'string') {
    return value.trim();
  }
  return value;
}

function stableStringify(value: unknown): string {
  return JSON.stringify(stableNormalize(value));
}

function scopeFromConfig(args: { baseUrl: string; workspaceSecret: string }): string {
  const hash = createHash('sha256')
    .update(`${args.baseUrl}|${args.workspaceSecret}`)
    .digest('hex')
    .slice(0, 12);
  return `scope:${hash}`;
}

export function computeTemplateIdempotencyKey(
  args: Record<string, unknown>,
  configScope: { baseUrl: string; workspaceSecret: string }
): string {
  const scope = scopeFromConfig(configScope);
  const requestId = typeof args.requestId === 'string' ? args.requestId.trim() : '';
  if (requestId.length > 0) {
    return `${scope}:req:${requestId}`;
  }

  const clone = { ...args };
  delete clone.requestId;
  const hash = createHash('sha256').update(stableStringify(clone)).digest('hex').slice(0, 40);
  return `${scope}:fp:v1:${hash}`;
}

export class TemplateIdempotencyStore {
  private loaded = false;
  private records: Record<string, { agentId: string; savedAt: number }> = {};

  private async ensureLoaded() {
    if (this.loaded) return;
    this.loaded = true;
    try {
      const raw = await fs.readFile(STORE_PATH, 'utf8');
      const parsed = JSON.parse(raw) as StoreData;
      if (parsed?.version === 1 && isPlainRecord(parsed.records)) {
        this.records = parsed.records as Record<string, { agentId: string; savedAt: number }>;
      }
    } catch {
      this.records = {};
    }
  }

  private async save() {
    const payload: StoreData = {
      version: 1,
      records: this.records,
    };
    await fs.writeFile(STORE_PATH, JSON.stringify(payload, null, 2), 'utf8');
  }

  async getAgentId(key: string): Promise<string | null> {
    await this.ensureLoaded();
    const hit = this.records[key];
    return typeof hit?.agentId === 'string' && hit.agentId.trim().length > 0 ? hit.agentId : null;
  }

  async setAgentId(key: string, agentId: string): Promise<void> {
    await this.ensureLoaded();
    this.records[key] = { agentId, savedAt: Date.now() };
    await this.save();
  }

  async deleteKey(key: string): Promise<void> {
    await this.ensureLoaded();
    if (this.records[key]) {
      delete this.records[key];
      await this.save();
    }
  }
}

const inFlight = new Map<string, Promise<unknown>>();

export async function runTemplateIdempotent<T>(key: string, fn: () => Promise<T>): Promise<T> {
  const existing = inFlight.get(key);
  if (existing) return (await existing) as T;

  const promise = (async () => {
    try {
      return await fn();
    } finally {
      inFlight.delete(key);
    }
  })();

  inFlight.set(key, promise as Promise<unknown>);
  return await promise;
}
