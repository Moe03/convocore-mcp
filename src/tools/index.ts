/**
 * Domain MCP tool modules — composed into the main server catalog.
 */

import type { Tool } from '@modelcontextprotocol/sdk/types.js';
import { agencyModule } from './agency.js';
import { agentToolsModule } from './agent-tools.js';
import { agentVariablesModule } from './agent-variables.js';
import { createSearchCatalogModule } from './catalog.js';
import { clientsModule } from './clients.js';
import { cloneSendModule } from './clone-send.js';
import type { ToolHandler, ToolModule } from './helpers.js';
import { kbExtrasModule } from './kb-extras.js';
import { leadsModule } from './leads.js';
import { orgsModule } from './orgs.js';
import { testingModule } from './testing.js';

const BASE_MODULES: ToolModule[] = [
  orgsModule,
  agencyModule,
  clientsModule,
  leadsModule,
  agentToolsModule,
  agentVariablesModule,
  testingModule,
  cloneSendModule,
  kbExtrasModule,
];

function mergeModules(modules: ToolModule[]): {
  tools: Tool[];
  handlers: Record<string, ToolHandler>;
} {
  const tools: Tool[] = [];
  const handlers: Record<string, ToolHandler> = {};
  for (const mod of modules) {
    tools.push(...mod.tools);
    Object.assign(handlers, mod.handlers);
  }
  return { tools, handlers };
}

/**
 * Build domain tools + handlers. Pass a getter for the full catalog so
 * search_mcp_tools can search core + domain tools together.
 */
export function buildDomainTools(getFullCatalog: () => Tool[]): {
  tools: Tool[];
  handlers: Record<string, ToolHandler>;
} {
  const searchModule = createSearchCatalogModule(getFullCatalog);
  return mergeModules([...BASE_MODULES, searchModule]);
}

export { BASE_MODULES };
