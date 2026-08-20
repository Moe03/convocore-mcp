import type { Tool } from '@modelcontextprotocol/sdk/types.js';
import { z } from 'zod';
import { getActiveClient } from '../request-context.js';
import { type ToolModule, wrapHandler } from './helpers.js';

const TestAgentToolSchema = z.object({
  agentId: z.string(),
  toolId: z.string(),
  toolName: z.string(),
  mode: z.enum(['validate', 'generate-and-test']).default('generate-and-test'),
  message: z
    .string()
    .optional()
    .describe('Optional user message to drive the test turn. Defaults to a short probe.'),
  convoId: z.string().optional(),
  timeoutMs: z.number().int().min(1000).max(600_000).optional(),
});

const TestAgentToolRequestSchema = z.object({
  toolId: z.string(),
  fieldOverrides: z
    .record(z.unknown())
    .optional()
    .describe('Override field values by key before sending the HTTP request.'),
  bodyOverride: z
    .unknown()
    .optional()
    .describe('Replace the entire JSON body (ignores field body assembly when set).'),
  timeoutMs: z.number().int().min(1000).max(120_000).optional(),
});

const RunAutoTestSchema = z.object({
  agentId: z.string(),
  config: z
    .object({
      testMode: z
        .enum([
          'full',
          'kb-only',
          'tools-only',
          'prompt-only',
          'with-tools',
          'with-kb',
        ])
        .optional(),
      maxTurns: z.number().optional(),
      naturalEnd: z.boolean().optional(),
      testScenario: z.string().optional(),
      enabledToolIds: z.array(z.string()).optional(),
      enableKB: z.boolean().optional(),
    })
    .optional(),
});

const tools: Tool[] = [
  {
    name: 'test_agent_tool',
    description:
      'Test a Convocore agent HTTP tool via interact WebSocket toolTest mode (validate | generate-and-test). Runs through the agent runtime. For a direct HTTP dry-run against serverUrl use test_agent_tool_request. For multi-turn suites use run_agent_auto_test.',
    annotations: {
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: false,
      openWorldHint: true,
    },
    inputSchema: {
      type: 'object',
      properties: {
        agentId: { type: 'string' },
        toolId: { type: 'string' },
        toolName: { type: 'string' },
        mode: {
          type: 'string',
          enum: ['validate', 'generate-and-test'],
          description: 'Default generate-and-test.',
        },
        message: { type: 'string' },
        convoId: { type: 'string' },
        timeoutMs: { type: 'number' },
      },
      required: ['agentId', 'toolId', 'toolName'],
    },
  },
  {
    name: 'test_agent_tool_request',
    description:
      'Fire a real HTTP request to the tool serverUrl using the saved method/fields (with optional overrides). Bypasses the LLM. Secrets are redacted in the response. Side effects on the remote API are possible — use carefully.',
    annotations: {
      readOnlyHint: false,
      destructiveHint: true,
      idempotentHint: false,
      openWorldHint: true,
    },
    inputSchema: {
      type: 'object',
      properties: {
        toolId: { type: 'string' },
        fieldOverrides: { type: 'object' },
        bodyOverride: {},
        timeoutMs: { type: 'number' },
      },
      required: ['toolId'],
    },
  },
  {
    name: 'run_agent_auto_test',
    description:
      'Start Convocore automated agent test suite (POST /auto-test/run). Modes include tools-only, with-tools, kb-only, full. Returns testId/status/score. Prefer this for broader regression; use test_agent_tool for a single tool.',
    annotations: {
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: false,
      openWorldHint: true,
    },
    inputSchema: {
      type: 'object',
      properties: {
        agentId: { type: 'string' },
        config: {
          type: 'object',
          properties: {
            testMode: {
              type: 'string',
              enum: [
                'full',
                'kb-only',
                'tools-only',
                'prompt-only',
                'with-tools',
                'with-kb',
              ],
            },
            maxTurns: { type: 'number' },
            naturalEnd: { type: 'boolean' },
            testScenario: { type: 'string' },
            enabledToolIds: { type: 'array', items: { type: 'string' } },
            enableKB: { type: 'boolean' },
          },
        },
      },
      required: ['agentId'],
    },
  },
];

export const testingModule: ToolModule = {
  tools,
  handlers: {
    test_agent_tool: wrapHandler('test_agent_tool', async (args) => {
      const v = TestAgentToolSchema.parse(args);
      const client = getActiveClient();
      const convoId =
        v.convoId?.trim() ||
        `mcp-tool-test-${v.toolId}-${Date.now()}`;
      const result = await client.interactWithAgent(
        {
          agentId: v.agentId,
          convoId,
          bucket: client.getDefaultInteractBucket(),
          prompt:
            v.message ||
            `Please exercise the tool "${v.toolName}" as a test.`,
          isTest: true,
          toolTest: {
            toolId: v.toolId,
            toolName: v.toolName,
            mode: v.mode,
          },
        },
        { timeoutMs: v.timeoutMs ?? 120_000 }
      );
      return {
        success: true,
        mode: v.mode,
        toolId: v.toolId,
        toolName: v.toolName,
        convoId,
        interact: {
          assistantText: result.assistantText,
          uiEngineEnabled: result.uiEngineEnabled,
          uiEngineSummary: result.uiEngineSummary,
          actions: result.actions,
          metadata: result.metadata,
          closeCode: result.closeCode,
          durationMs: result.durationMs,
          timedOut: result.timedOut,
          chunkCount: result.chunks.length,
        },
      };
    }),
    test_agent_tool_request: wrapHandler(
      'test_agent_tool_request',
      async (args) => {
        const v = TestAgentToolRequestSchema.parse(args);
        return getActiveClient().testAgentToolRequest({
          toolId: v.toolId,
          fieldOverrides: v.fieldOverrides,
          bodyOverride: v.bodyOverride,
          timeoutMs: v.timeoutMs,
        });
      }
    ),
    run_agent_auto_test: wrapHandler('run_agent_auto_test', async (args) => {
      const v = RunAutoTestSchema.parse(args);
      return getActiveClient().runAgentAutoTest({
        agentId: v.agentId,
        config: v.config,
      });
    }),
  },
};
