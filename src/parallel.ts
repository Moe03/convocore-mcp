/**
 * Bounded concurrency fan-out with Promise.allSettled-style results.
 * Used by bulk MCP tools so one failure does not abort the batch.
 */

export type SettledFailure<I = string> = {
  id: I;
  error: string;
};

export type SettledBatchResult<T, I = string> = {
  succeeded: T[];
  failed: SettledFailure<I>[];
};

function defaultConcurrency(): number {
  const raw = Number(process.env.CONVOCORE_MCP_FANOUT_CONCURRENCY || 8);
  if (!Number.isFinite(raw) || raw < 1) return 8;
  return Math.min(Math.floor(raw), 32);
}

function errorMessage(err: unknown): string {
  if (err instanceof Error) return err.message;
  if (typeof err === 'string') return err;
  try {
    return JSON.stringify(err);
  } catch {
    return String(err);
  }
}

/**
 * Map items with a concurrency pool. Each item is settled independently.
 */
export async function mapWithConcurrency<TItem, TResult>(
  items: TItem[],
  worker: (item: TItem, index: number) => Promise<TResult>,
  options?: {
    concurrency?: number;
    getId?: (item: TItem, index: number) => string;
  }
): Promise<SettledBatchResult<TResult>> {
  const concurrency = Math.max(1, options?.concurrency ?? defaultConcurrency());
  const getId = options?.getId ?? ((item: TItem, index: number) => String(item ?? index));
  const succeeded: TResult[] = [];
  const failed: SettledFailure[] = [];

  if (items.length === 0) {
    return { succeeded, failed };
  }

  let nextIndex = 0;

  async function runWorker(): Promise<void> {
    while (nextIndex < items.length) {
      const index = nextIndex++;
      const item = items[index];
      const id = getId(item, index);
      try {
        const value = await worker(item, index);
        succeeded.push(value);
      } catch (err) {
        failed.push({ id, error: errorMessage(err) });
      }
    }
  }

  const poolSize = Math.min(concurrency, items.length);
  await Promise.all(Array.from({ length: poolSize }, () => runWorker()));

  return { succeeded, failed };
}
