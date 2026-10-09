import type { Tool } from '@modelcontextprotocol/sdk/types.js';
import { z } from 'zod';
import { getActiveClient } from '../request-context.js';
import {
  type ToolModule,
  wrapHandler,
  LightModeField,
  LightModeProperty,
  applyLightMode,
  requireFor,
  READ_ANNOTATIONS,
  WRITE_ANNOTATIONS,
} from './helpers.js';

const ReadSchema = z.object({
  agentId: z.string().min(1),
  tags: z.array(z.string()).optional(),
  mode: LightModeField,
});

const WriteSchema = z.object({
  action: z.enum(['create', 'assign_leads', 'rename', 'delete']),
  agentId: z.string().min(1),
  groupName: z.string().min(1),
  newGroupName: z.string().optional(),
  leads: z.array(z.record(z.unknown())).optional(),
  leadIds: z.array(z.string()).optional(),
  deleteLeads: z.boolean().optional(),
  mode: LightModeField,
});

const groupsPath = (agentId: string) => `/agents/${encodeURIComponent(agentId)}/groups`;
const PAGE = 100;
const MAX_ROUNDS = 100;

function leadIdsOf(result: any): string[] {
  const rows: any[] = Array.isArray(result)
    ? result
    : result?.leads || result?.data?.leads || (Array.isArray(result?.data) ? result.data : []);
  return rows.map((row) => row?.id || row?.ID).filter((id): id is string => typeof id === 'string');
}

/**
 * A group is just the groupId stored on each lead, so renaming or dissolving one means
 * moving its leads. Moved leads leave the source group, so page 1 is read until empty.
 */
async function moveGroupLeads(agentId: string, from: string, to: string): Promise<number> {
  const client = getActiveClient();
  let moved = 0;
  let previous = '';
  for (let round = 0; round < MAX_ROUNDS; round += 1) {
    const ids = leadIdsOf(await client.listAgentLeads(agentId, { page: 1, limit: PAGE, groupName: from }));
    if (ids.length === 0) break;
    // Same page twice means the leads are not leaving the group: stop instead of looping.
    if (ids.join(',') === previous) {
      throw new Error(`Leads in group "${from}" could not be moved (${moved} moved before stopping).`);
    }
    previous = ids.join(',');
    await client.api('PUT', `${groupsPath(agentId)}/${encodeURIComponent(to)}`, {
      body: { leadIds: ids.join(',') },
    });
    moved += ids.length;
    if (ids.length < PAGE) break;
  }
  return moved;
}

const tools: Tool[] = [
  {
    name: 'lead_groups_read',
    description:
      'List the lead groups of an agent with the number of leads in each. Groups are what campaigns target (campaign.leadGroupName). Optional tags only counts leads carrying at least one of the tags. To see the leads inside a group use leads_read with groupName.',
    annotations: READ_ANNOTATIONS,
    inputSchema: {
      type: 'object',
      properties: {
        agentId: { type: 'string' },
        tags: { type: 'array', items: { type: 'string' } },
        mode: LightModeProperty,
      },
      required: ['agentId'],
    },
  },
  {
    name: 'lead_groups_write',
    description:
      'Create, fill, rename or delete a lead group. Group names are stored lowercase. Actions: ' +
      'create (groupName + leads: new lead objects, e.g. [{ userName, userPhone, userEmail }] — a group exists only while it has leads), ' +
      'assign_leads (groupName + leadIds: move EXISTING leads into the group; groupName "all" removes them from any group), ' +
      'rename (groupName + newGroupName: moves every lead to the new name), ' +
      'delete (groupName: by default the leads are kept and just ungrouped; deleteLeads=true permanently deletes every lead in the group).',
    annotations: WRITE_ANNOTATIONS,
    inputSchema: {
      type: 'object',
      properties: {
        action: { type: 'string', enum: ['create', 'assign_leads', 'rename', 'delete'] },
        agentId: { type: 'string' },
        groupName: { type: 'string' },
        newGroupName: { type: 'string', description: 'For rename.' },
        leads: { type: 'array', items: { type: 'object' }, description: 'For create: new leads to add to the group.' },
        leadIds: { type: 'array', items: { type: 'string' }, description: 'For assign_leads: ids of existing leads.' },
        deleteLeads: { type: 'boolean', description: 'For delete. Default false (leads are kept).' },
        mode: LightModeProperty,
      },
      required: ['action', 'agentId', 'groupName'],
    },
  },
];

export const leadGroupsModule: ToolModule = {
  tools,
  handlers: {
    lead_groups_read: wrapHandler('lead_groups_read', async (args) => {
      const v = ReadSchema.parse(args);
      const groups = await getActiveClient().api('GET', groupsPath(v.agentId), {
        query: { tags: v.tags?.join(',') },
      });
      return applyLightMode(v.mode, { success: true, groups });
    }),
    lead_groups_write: wrapHandler('lead_groups_write', async (args) => {
      const v = WriteSchema.parse(args);
      const client = getActiveClient();
      const groupName = v.groupName.trim().toLowerCase();
      switch (v.action) {
        case 'create':
          if (!v.leads?.length) throw new Error('leads (at least one) is required for action=create');
          return applyLightMode(
            v.mode,
            await client.api('POST', groupsPath(v.agentId), { body: { groupName, leads: v.leads } })
          );
        case 'assign_leads':
          if (!v.leadIds?.length) throw new Error('leadIds is required for action=assign_leads');
          return client.api('PUT', `${groupsPath(v.agentId)}/${encodeURIComponent(groupName)}`, {
            body: { leadIds: v.leadIds.join(',') },
          });
        case 'rename': {
          requireFor(v.action, v, 'newGroupName');
          const target = v.newGroupName!.trim().toLowerCase();
          if (target === groupName) throw new Error('newGroupName is the same as groupName');
          if (groupName === 'all') throw new Error('"all" is not a group and cannot be renamed');
          const moved = await moveGroupLeads(v.agentId, groupName, target);
          return { success: true, from: groupName, to: target, leadsMoved: moved };
        }
        case 'delete': {
          if (groupName === 'all') throw new Error('"all" is not a group and cannot be deleted');
          if (v.deleteLeads) {
            return client.deleteLeadsByGroup(v.agentId, groupName);
          }
          const moved = await moveGroupLeads(v.agentId, groupName, 'all');
          return { success: true, group: groupName, leadsUngrouped: moved, leadsDeleted: 0 };
        }
      }
    }),
  },
};
