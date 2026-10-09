/**
 * Builder for action-based tools backed by the dashboard RPC gateway
 * (POST /rpc/{procedure}). Each action names the procedure it runs, the inputs it
 * needs, and optionally how to shape the input before sending it.
 */

import type { Tool } from '@modelcontextprotocol/sdk/types.js';
import { z } from 'zod';
import type { ConvocoreClient } from '../convocore-client.js';
import { getActiveClient } from '../request-context.js';
import {
  type ToolHandler,
  wrapHandler,
  LightModeProperty,
  applyLightMode,
  READ_ANNOTATIONS,
  WRITE_ANNOTATIONS,
} from './helpers.js';

export type RpcAction = {
  procedure: string;
  /** One line shown to the model for this action. */
  summary: string;
  required?: string[];
  /** Shape the tool arguments into the procedure input. Defaults to passing them through. */
  input?: (
    args: Record<string, any>,
    client: ConvocoreClient
  ) => Record<string, unknown> | Promise<Record<string, unknown>>;
};

export type RpcToolSpec = {
  name: string;
  kind: 'read' | 'write';
  description: string;
  actions: Record<string, RpcAction>;
  /** JSON-schema properties besides action and mode. */
  properties: Record<string, unknown>;
  required?: string[];
};

const ArgsSchema = z
  .object({ action: z.string(), mode: z.enum(['compact', 'full']).optional() })
  .passthrough();

export function buildRpcTool(spec: RpcToolSpec): { tool: Tool; handler: ToolHandler } {
  const actionNames = Object.keys(spec.actions);
  const actionLines = actionNames
    .map((name) => {
      const action = spec.actions[name];
      const needs = action.required?.length ? ` Needs: ${action.required.join(', ')}.` : '';
      return `${name} — ${action.summary}${needs}`;
    })
    .join(' | ');

  const tool: Tool = {
    name: spec.name,
    description: `${spec.description} Actions: ${actionLines}`,
    annotations: spec.kind === 'read' ? READ_ANNOTATIONS : WRITE_ANNOTATIONS,
    inputSchema: {
      type: 'object',
      properties: {
        action: { type: 'string', enum: actionNames },
        ...spec.properties,
        mode: LightModeProperty,
      },
      required: ['action', ...(spec.required || [])],
    },
  };

  const handler = wrapHandler(spec.name, async (raw) => {
    const { action, mode, ...args } = ArgsSchema.parse(raw);
    const definition = Object.prototype.hasOwnProperty.call(spec.actions, action)
      ? spec.actions[action]
      : undefined;
    if (!definition) {
      throw new Error(`Unknown action "${action}". Use one of: ${actionNames.join(', ')}`);
    }
    const missing = [...(spec.required || []), ...(definition.required || [])].filter((field) => {
      const value = (args as Record<string, unknown>)[field];
      return value === undefined || value === null || value === '';
    });
    if (missing.length > 0) {
      throw new Error(`${missing.join(', ')} ${missing.length > 1 ? 'are' : 'is'} required for action=${action}`);
    }
    const client = getActiveClient();
    const input = definition.input ? await definition.input(args, client) : args;
    return applyLightMode(mode, await client.rpc(definition.procedure, input));
  });

  return { tool, handler };
}

export function buildRpcModule(specs: RpcToolSpec[]): {
  tools: Tool[];
  handlers: Record<string, ToolHandler>;
} {
  const tools: Tool[] = [];
  const handlers: Record<string, ToolHandler> = {};
  for (const spec of specs) {
    const built = buildRpcTool(spec);
    tools.push(built.tool);
    handlers[spec.name] = built.handler;
  }
  return { tools, handlers };
}

/** Keep only the listed keys that were actually provided. */
export function pick(args: Record<string, any>, ...keys: string[]): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const key of keys) {
    if (args[key] !== undefined) out[key] = args[key];
  }
  return out;
}
