import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { z } from 'zod';

/**
 * Mirrors ScrapeUrlSchema proxy gates from src/index.ts (kept local so we don't
 * export the full MCP schema surface just for tests).
 */
const ScrapeUrlProxyGate = z
  .object({
    mode: z.enum(['check', 'scrape']).optional().default('check'),
    useProxy: z.boolean().optional().default(false),
    confirmExpensiveProxy: z.boolean().optional(),
  })
  .superRefine((data, ctx) => {
    if (data.useProxy === true && (data.mode ?? 'check') !== 'scrape') {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['useProxy'],
        message: 'useProxy only applies with mode=scrape',
      });
    }
    if (data.useProxy === true && data.confirmExpensiveProxy !== true) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['confirmExpensiveProxy'],
        message: 'confirmExpensiveProxy required when useProxy=true',
      });
    }
  });

describe('scrape_url proxy gate', () => {
  it('allows normal scrape without proxy', () => {
    const parsed = ScrapeUrlProxyGate.parse({ mode: 'scrape' });
    assert.equal(parsed.useProxy, false);
  });

  it('rejects useProxy without user confirmation flag', () => {
    assert.throws(
      () => ScrapeUrlProxyGate.parse({ mode: 'scrape', useProxy: true }),
      /confirmExpensiveProxy/
    );
  });

  it('allows useProxy only with confirmExpensiveProxy', () => {
    const parsed = ScrapeUrlProxyGate.parse({
      mode: 'scrape',
      useProxy: true,
      confirmExpensiveProxy: true,
    });
    assert.equal(parsed.useProxy, true);
    assert.equal(parsed.confirmExpensiveProxy, true);
  });

  it('rejects useProxy on mode=check', () => {
    assert.throws(
      () =>
        ScrapeUrlProxyGate.parse({
          mode: 'check',
          useProxy: true,
          confirmExpensiveProxy: true,
        }),
      /mode=scrape/
    );
  });
});
