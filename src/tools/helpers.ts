/**
 * Shared helpers for domain MCP tool modules.
 */

import { z } from 'zod';
import type { Tool } from '@modelcontextprotocol/sdk/types.js';
import { ConvocoreApiRequestError } from '../convocore-client.js';

export type ToolCallResult = {
  content: Array<{ type: 'text'; text: string }>;
  isError?: boolean;
};

export type ToolHandler = (args: unknown) => Promise<ToolCallResult>;

export type ToolModule = {
  tools: Tool[];
  handlers: Record<string, ToolHandler>;
};

export function jsonResult(payload: unknown): ToolCallResult {
  return {
    content: [{ type: 'text', text: JSON.stringify(payload, null, 2) }],
  };
}

export function normalizeDomainToolError(
  error: unknown,
  fallbackStage: string,
  extra: Record<string, unknown> = {}
): ToolCallResult {
  if (error instanceof ConvocoreApiRequestError) {
    return jsonResult({
      success: false,
      message: error.message,
      data: {
        stage: fallbackStage,
        errorType: 'api_request_error',
        endpoint: error.endpoint,
        method: error.method,
        status: error.status ?? null,
        code: error.code ?? null,
        issues: error.issues ?? [],
        response: error.responseData ?? null,
        ...extra,
      },
    });
  }

  if (error instanceof z.ZodError) {
    return jsonResult({
      success: false,
      message: 'Invalid arguments',
      data: {
        stage: fallbackStage,
        errorType: 'input_validation_error',
        issues: error.issues,
        ...extra,
      },
    });
  }

  if (error instanceof Error) {
    return jsonResult({
      success: false,
      message: error.message,
      data: { stage: fallbackStage, errorType: 'error', ...extra },
    });
  }

  return jsonResult({
    success: false,
    message: 'Unknown error',
    data: { stage: fallbackStage, errorType: 'unknown', ...extra },
  });
}

export function wrapHandler(
  toolName: string,
  fn: (args: unknown) => Promise<unknown>
): ToolHandler {
  return async (args) => {
    try {
      const result = await fn(args);
      return jsonResult(result);
    } catch (error) {
      return normalizeDomainToolError(error, toolName, { tool: toolName });
    }
  };
}

/** Common optional pagination fields for CRM list actions. */
export const PageFields = {
  page: z.number().int().positive().optional(),
  pageSize: z.number().int().positive().max(200).optional(),
};
