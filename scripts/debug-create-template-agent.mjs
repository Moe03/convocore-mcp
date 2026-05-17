import { Client as McpClient } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { ConvoCoreClient } from '../dist/convocore-client.js';

function parseToolTextResult(result) {
  const textPart = Array.isArray(result?.content)
    ? result.content.find((part) => part?.type === 'text' && typeof part.text === 'string')
    : null;

  if (!textPart) {
    return result;
  }

  try {
    return JSON.parse(textPart.text);
  } catch {
    return textPart.text;
  }
}

function summarizeAgent(agent) {
  if (!agent || typeof agent !== 'object') {
    return null;
  }

  const firstNode = Array.isArray(agent.nodes) ? agent.nodes[0] : null;
  return {
    id: agent.ID ?? agent.id ?? null,
    title: agent.title ?? null,
    ownerID: agent.ownerID ?? agent.ownerId ?? null,
    agentPlatform: agent.agentPlatform ?? null,
    enableNodes: agent.enableNodes ?? null,
    vg_enableUIEngine: agent.vg_enableUIEngine ?? null,
    vg_defaultModel: agent.vg_defaultModel ?? null,
    theme: agent.theme ?? null,
    lang: agent.lang ?? null,
    proactiveMessage: agent.proactiveMessage ?? null,
    roundedImageURL: agent.roundedImageURL ?? null,
    firstNodeName: firstNode?.name ?? null,
    firstNodeInstructions: firstNode?.instructions ?? null,
    speechGenProvider: agent.voiceConfig?.speechGen?.provider ?? null,
    speechGenVoiceId: agent.voiceConfig?.speechGen?.voiceId ?? null,
    transcriberProvider: agent.voiceConfig?.transcriber?.provider ?? null,
  };
}

function logSection(title, value) {
  console.log(`\n=== ${title} ===`);
  console.log(JSON.stringify(value, null, 2));
}

function serializeError(error) {
  if (!error || typeof error !== 'object') {
    return String(error);
  }

  return {
    name: error.name ?? 'Error',
    message: error.message ?? String(error),
    status: error.status ?? null,
    endpoint: error.endpoint ?? null,
    method: error.method ?? null,
    code: error.code ?? null,
    issues: error.issues ?? null,
    responseData: error.responseData ?? null,
    rawBody: error.rawBody ?? null,
  };
}

async function main() {
  const workspaceSecret = process.env.WORKSPACE_SECRET;
  const baseUrl = process.env.CONVOCORE_API_BASE_URL;
  const apiRegion = process.env.CONVOCORE_API_REGION ?? 'eu-gcp';

  if (!workspaceSecret || !baseUrl) {
    throw new Error('WORKSPACE_SECRET and CONVOCORE_API_BASE_URL are required.');
  }

  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const titleBase = `MCP Template Debug ${timestamp}`;
  const systemPrompt =
    'You are a debug probe agent. Reply with exactly DEBUG_TEMPLATE_AGENT_OK when asked for a readiness check.';

  const templateArgs = {
    title: `${titleBase} MCP`,
    description: 'Debug probe created via create_agent_from_template',
    systemPrompt,
    primaryColor: '#226D7A',
    widgetImageUrl: 'https://convocore.ai/favicon.ico',
    themeType: 'light',
    defaultLanguage: 'en',
  };

  const fullNode = {
    id: `start-${timestamp}`,
    name: 'Start',
    description: 'Primary entry node for debug agent creation.',
    instructions: systemPrompt,
    llmConfig: {
      modelId: 'gpt-4o-mini',
      temperature: 0.2,
      maxTokens: 1024,
    },
  };

  const rawCreateArgs = {
    title: `${titleBase} MCP RAW`,
    description: 'Debug probe created via raw create_agent',
    theme: 'custom-blue-light',
    voiceConfig: {
      config: {
        recordAudio: true,
        enableWebCalling: true,
        backgroundNoise: 'restaurant',
      },
      transcriber: {
        provider: 'deepgram',
        modelId: 'nova-2-phonecall',
        utteranceThreshold: 150,
        language: 'en',
      },
      speechGen: {
        provider: 'google-live',
        voiceId: 'Puck',
      },
    },
    nodes: [fullNode],
    additionalConfig: {
      agentPlatform: 'vg',
      enableNodes: true,
      vg_enableUIEngine: true,
      vg_defaultModel: 'zai-org/GLM-5',
      vg_systemPrompt: systemPrompt,
      vg_instructions: systemPrompt,
      lang: 'en',
      proactiveMessage: '👋 Hi, how can I help you today?',
      roundedImageURL: 'https://convocore.ai/favicon.ico',
      customThemeJSONString:
        '{"themeColor":"#226D7A","userBubble":"#226D7A","mode":"light"}',
    },
  };

  const directPayload = {
    agent: {
      agentPlatform: 'vg',
      title: `${titleBase} REST`,
      description: 'Debug probe created via direct REST createAgent',
      theme: 'custom-blue-light',
      enableNodes: true,
      vg_enableUIEngine: true,
      vg_defaultModel: 'zai-org/GLM-5',
      vg_systemPrompt: systemPrompt,
      vg_instructions: systemPrompt,
      voiceConfig: {
        config: {
          recordAudio: true,
          enableWebCalling: true,
          backgroundNoise: 'restaurant',
        },
        transcriber: {
          provider: 'deepgram',
          modelId: 'nova-2-phonecall',
          utteranceThreshold: 150,
          language: 'en',
        },
        speechGen: {
          provider: 'google-live',
          voiceId: 'Puck',
        },
      },
      nodes: [fullNode],
      lang: 'en',
      proactiveMessage: '👋 Hi, how can I help you today?',
      roundedImageURL: 'https://convocore.ai/favicon.ico',
      customThemeJSONString:
        '{"themeColor":"#226D7A","userBubble":"#226D7A","mode":"light"}',
    },
  };

  const restClient = new ConvoCoreClient({
    workspaceSecret,
    apiRegion,
    baseUrl,
  });

  const mcpTransport = new StdioClientTransport({
    command: 'node',
    args: ['dist/index.js'],
    cwd: process.cwd(),
    env: {
      ...process.env,
      WORKSPACE_SECRET: workspaceSecret,
      CONVOCORE_API_REGION: apiRegion,
      CONVOCORE_API_BASE_URL: baseUrl,
    },
    stderr: 'pipe',
  });

  const mcpClient = new McpClient({
    name: 'debug-template-agent-harness',
    version: '1.0.0',
  });

  if (mcpTransport.stderr) {
    mcpTransport.stderr.on('data', (chunk) => {
      const text = String(chunk).trim();
      if (text) {
        console.error(`[mcp stderr] ${text}`);
      }
    });
  }

  await mcpClient.connect(mcpTransport);
  await mcpClient.listTools();

  const mcpCreateRaw = await mcpClient.callTool({
    name: 'create_agent_from_template',
    arguments: templateArgs,
  });
  const mcpCreate = parseToolTextResult(mcpCreateRaw);

  const mcpAgentId = mcpCreate?.data?.agentId ?? null;
  let mcpGet = null;
  let mcpGetAgent = null;
  if (mcpAgentId) {
    const mcpGetRaw = await mcpClient.callTool({
      name: 'get_agent',
      arguments: { agentId: mcpAgentId },
    });
    mcpGet = parseToolTextResult(mcpGetRaw);
    mcpGetAgent = mcpGet?.data ?? mcpGet;
  }

  const mcpRawCreateRaw = await mcpClient.callTool({
    name: 'create_agent',
    arguments: rawCreateArgs,
  });
  const mcpRawCreate = parseToolTextResult(mcpRawCreateRaw);
  const mcpRawAgentId = mcpRawCreate?.data?.ID ?? mcpRawCreate?.data?.id ?? null;
  let mcpRawGet = null;
  let mcpRawGetAgent = null;
  if (mcpRawAgentId) {
    const mcpRawGetRaw = await mcpClient.callTool({
      name: 'get_agent',
      arguments: { agentId: mcpRawAgentId },
    });
    mcpRawGet = parseToolTextResult(mcpRawGetRaw);
    mcpRawGetAgent = mcpRawGet?.data ?? mcpRawGet;
  }

  let directCreate = null;
  let directCreateError = null;
  try {
    directCreate = await restClient.createAgent(directPayload);
  } catch (error) {
    directCreateError = serializeError(error);
  }

  const directAgentId = directCreate?.data?.ID ?? directCreate?.data?.id ?? null;
  let directGet = null;
  let directRepair = null;
  let directVerify = null;
  let directGetError = null;
  let directRepairError = null;
  let directVerifyError = null;

  if (directAgentId) {
    try {
      directGet = await restClient.getAgent(directAgentId);
    } catch (error) {
      directGetError = serializeError(error);
    }
    const current = directGet?.data ?? directGet;
    if (current?.agentPlatform !== 'vg') {
      try {
        directRepair = await restClient.updateAgent(directAgentId, {
          agent: {
            agentPlatform: 'vg',
            enableNodes: true,
            vg_enableUIEngine: true,
            vg_defaultModel: 'zai-org/GLM-5',
            vg_systemPrompt: systemPrompt,
            vg_instructions: systemPrompt,
            nodes: [fullNode],
            voiceConfig: directPayload.agent.voiceConfig,
            lang: 'en',
            roundedImageURL: 'https://convocore.ai/favicon.ico',
            customThemeJSONString:
              '{"themeColor":"#226D7A","userBubble":"#226D7A","mode":"light"}',
          },
        });
      } catch (error) {
        directRepairError = serializeError(error);
      }

      try {
        directVerify = await restClient.getAgent(directAgentId);
      } catch (error) {
        directVerifyError = serializeError(error);
      }
    }
  }

  logSection('input.create_agent_from_template', templateArgs);
  logSection('mcp.create_agent_from_template.raw', mcpCreate);
  logSection('mcp.create_agent_from_template.agent.summary', summarizeAgent(mcpCreate?.data?.agent));
  logSection('mcp.get_agent.summary', summarizeAgent(mcpGetAgent));
  logSection('mcp.create_agent.raw', mcpRawCreate);
  logSection('mcp.create_agent.agent.summary', summarizeAgent(mcpRawCreate?.data));
  logSection('mcp.create_agent.get_agent.summary', summarizeAgent(mcpRawGetAgent));
  logSection('direct.createAgent.payload.summary', summarizeAgent(directPayload.agent));
  logSection('direct.createAgent.response.summary', summarizeAgent(directCreate?.data));
  logSection('direct.createAgent.error', directCreateError);
  logSection('direct.getAgent.summary', summarizeAgent(directGet?.data ?? directGet));
  logSection('direct.getAgent.error', directGetError);
  logSection('direct.repair.response.summary', summarizeAgent(directRepair?.data));
  logSection('direct.repair.error', directRepairError);
  logSection('direct.verify.summary', summarizeAgent(directVerify?.data ?? directVerify));
  logSection('direct.verify.error', directVerifyError);

  const verdict = {
    mcpAgentId,
    mcpRawAgentId,
    directAgentId,
    mcpReturnedAgentPlatform: mcpCreate?.data?.agent?.agentPlatform ?? null,
    mcpFreshGetAgentPlatform: mcpGetAgent?.agentPlatform ?? null,
    mcpRawCreateReturnedAgentPlatform: mcpRawCreate?.data?.agentPlatform ?? null,
    mcpRawFreshGetAgentPlatform: mcpRawGetAgent?.agentPlatform ?? null,
    directCreateReturnedAgentPlatform: directCreate?.data?.agentPlatform ?? null,
    directFreshGetAgentPlatform: (directGet?.data ?? directGet)?.agentPlatform ?? null,
    directVerifiedAgentPlatform: (directVerify?.data ?? directVerify)?.agentPlatform ?? null,
    mcpReturnedEnableNodes: mcpCreate?.data?.agent?.enableNodes ?? null,
    mcpFreshGetEnableNodes: mcpGetAgent?.enableNodes ?? null,
    mcpRawCreateReturnedEnableNodes: mcpRawCreate?.data?.enableNodes ?? null,
    mcpRawFreshGetEnableNodes: mcpRawGetAgent?.enableNodes ?? null,
    directFreshGetEnableNodes: (directGet?.data ?? directGet)?.enableNodes ?? null,
    mcpReturnedUiEngine: mcpCreate?.data?.agent?.vg_enableUIEngine ?? null,
    mcpFreshGetUiEngine: mcpGetAgent?.vg_enableUIEngine ?? null,
    mcpRawCreateReturnedUiEngine: mcpRawCreate?.data?.vg_enableUIEngine ?? null,
    mcpRawFreshGetUiEngine: mcpRawGetAgent?.vg_enableUIEngine ?? null,
    directFreshGetUiEngine: (directGet?.data ?? directGet)?.vg_enableUIEngine ?? null,
  };

  logSection('verdict', verdict);

  await mcpTransport.close();
}

main().catch((error) => {
  console.error('\n=== fatal ===');
  console.error(error);
  process.exit(1);
});
