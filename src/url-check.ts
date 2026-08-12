/**
 * Lightweight URL / image validity checks (HTTP status ping).
 * Used by scrape_url mode=check — no ConvoCore crawler, no full page scrape.
 */

import { mapWithConcurrency } from './parallel.js';

export type UrlCheckResult = {
  url: string;
  ok: boolean;
  status: number | null;
  statusText: string | null;
  finalUrl: string | null;
  contentType: string | null;
  contentLength: number | null;
  redirected: boolean;
  methodUsed: 'HEAD' | 'GET' | null;
  error: string | null;
  /** Heuristic: looks like an image from URL path or Content-Type */
  looksLikeImage: boolean;
  reachable: boolean;
};

const DEFAULT_TIMEOUT_MS = 12_000;
const MAX_CHECK_URLS = 20;

function looksLikeImageUrl(url: string, contentType: string | null): boolean {
  if (contentType && contentType.toLowerCase().startsWith('image/')) return true;
  try {
    const path = new URL(url).pathname.toLowerCase();
    return /\.(avif|bmp|gif|ico|jpe?g|png|svg|webp)(\?|$)/i.test(path);
  } catch {
    return false;
  }
}

async function fetchWithTimeout(
  url: string,
  init: RequestInit,
  timeoutMs: number
): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...init, signal: controller.signal, redirect: 'follow' });
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Ping one URL: prefer HEAD, fall back to GET (some CDNs block HEAD).
 * Does not download full bodies (GET uses a tiny range when supported).
 */
export async function checkUrl(
  url: string,
  options?: { timeoutMs?: number }
): Promise<UrlCheckResult> {
  const timeoutMs = options?.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const base: UrlCheckResult = {
    url,
    ok: false,
    status: null,
    statusText: null,
    finalUrl: null,
    contentType: null,
    contentLength: null,
    redirected: false,
    methodUsed: null,
    error: null,
    looksLikeImage: looksLikeImageUrl(url, null),
    reachable: false,
  };

  try {
    void new URL(url);
  } catch {
    return { ...base, error: 'Invalid URL' };
  }

  let response: Response | null = null;
  let methodUsed: 'HEAD' | 'GET' = 'HEAD';

  try {
    response = await fetchWithTimeout(
      url,
      {
        method: 'HEAD',
        headers: {
          'User-Agent': 'ConvoCore-MCP-URL-Check/2.5.2',
          Accept: '*/*',
        },
      },
      timeoutMs
    );

    // Some hosts reject HEAD — retry with GET
    if (response.status === 405 || response.status === 501 || response.status === 403) {
      methodUsed = 'GET';
      response = await fetchWithTimeout(
        url,
        {
          method: 'GET',
          headers: {
            'User-Agent': 'ConvoCore-MCP-URL-Check/2.5.2',
            Accept: '*/*',
            Range: 'bytes=0-0',
          },
        },
        timeoutMs
      );
    }
  } catch (headErr) {
    try {
      methodUsed = 'GET';
      response = await fetchWithTimeout(
        url,
        {
          method: 'GET',
          headers: {
            'User-Agent': 'ConvoCore-MCP-URL-Check/2.5.2',
            Accept: '*/*',
            Range: 'bytes=0-0',
          },
        },
        timeoutMs
      );
    } catch (getErr) {
      const msg =
        getErr instanceof Error
          ? getErr.message
          : headErr instanceof Error
            ? headErr.message
            : 'Request failed';
      return { ...base, error: msg };
    }
  }

  if (!response) {
    return { ...base, error: 'No response' };
  }

  // Drain tiny GET body so sockets close cleanly
  try {
    await response.arrayBuffer();
  } catch {
    // ignore
  }

  const contentType = response.headers.get('content-type');
  const contentLengthRaw = response.headers.get('content-length');
  const contentLength = contentLengthRaw ? Number(contentLengthRaw) : null;
  const finalUrl = response.url || url;
  const status = response.status;
  const ok = status >= 200 && status < 400;

  return {
    url,
    ok,
    status,
    statusText: response.statusText || null,
    finalUrl,
    contentType,
    contentLength: Number.isFinite(contentLength) ? contentLength : null,
    redirected: finalUrl.replace(/\/$/, '') !== url.replace(/\/$/, ''),
    methodUsed,
    error: ok ? null : `HTTP ${status}${response.statusText ? ` ${response.statusText}` : ''}`,
    looksLikeImage: looksLikeImageUrl(finalUrl, contentType),
    reachable: status > 0,
  };
}

export async function checkUrls(
  urls: string[],
  options?: { timeoutMs?: number; concurrency?: number }
): Promise<{
  checked: number;
  okCount: number;
  failedCount: number;
  results: UrlCheckResult[];
}> {
  const unique = [
    ...new Set(
      urls
        .map((u) => (typeof u === 'string' ? u.trim() : ''))
        .filter(Boolean)
    ),
  ].slice(0, MAX_CHECK_URLS);

  const batch = await mapWithConcurrency(
    unique,
    async (url) => checkUrl(url, { timeoutMs: options?.timeoutMs }),
    {
      concurrency: options?.concurrency ?? 8,
      getId: (url) => url,
    }
  );

  // Preserve order of unique list; mapWithConcurrency doesn't guarantee order of succeeded
  const byUrl = new Map(batch.succeeded.map((r) => [r.url, r]));
  for (const f of batch.failed) {
    byUrl.set(f.id, {
      url: f.id,
      ok: false,
      status: null,
      statusText: null,
      finalUrl: null,
      contentType: null,
      contentLength: null,
      redirected: false,
      methodUsed: null,
      error: f.error,
      looksLikeImage: looksLikeImageUrl(f.id, null),
      reachable: false,
    });
  }

  const results = unique.map(
    (url) =>
      byUrl.get(url) ?? {
        url,
        ok: false,
        status: null,
        statusText: null,
        finalUrl: null,
        contentType: null,
        contentLength: null,
        redirected: false,
        methodUsed: null,
        error: 'Missing result',
        looksLikeImage: false,
        reachable: false,
      }
  );

  return {
    checked: results.length,
    okCount: results.filter((r) => r.ok).length,
    failedCount: results.filter((r) => !r.ok).length,
    results,
  };
}

export const URL_CHECK_MAX = MAX_CHECK_URLS;
