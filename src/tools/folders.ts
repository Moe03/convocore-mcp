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
  action: z.enum(['list', 'get']),
  folderId: z.string().optional(),
  name: z.string().optional(),
  mode: LightModeField,
});

const FolderSchema = z
  .object({
    name: z.string().min(1).optional(),
    color: z.string().optional(),
    icon: z.string().optional(),
    starred: z.boolean().optional(),
    parentFolderID: z.string().nullable().optional(),
    agentIDs: z.array(z.string()).optional(),
  })
  .strict();

const WriteSchema = z.object({
  action: z.enum(['create', 'update', 'delete', 'add_agent', 'remove_agent']),
  folderId: z.string().optional(),
  agentId: z.string().optional(),
  folder: FolderSchema.optional(),
  mode: LightModeField,
});

const folderPath = (folderId: string) => `/folders/${encodeURIComponent(folderId)}`;

async function listFolders(): Promise<any[]> {
  const result: any = await getActiveClient().api('GET', '/folders');
  return Array.isArray(result?.folders) ? result.folders : [];
}

const tools: Tool[] = [
  {
    name: 'folders_read',
    description:
      'Read the agent folders of the workspace (the folders that group agents on the dashboard). Actions: list (all folders with their agentIDs), get (one folder by folderId, or by exact name).',
    annotations: READ_ANNOTATIONS,
    inputSchema: {
      type: 'object',
      properties: {
        action: { type: 'string', enum: ['list', 'get'] },
        folderId: { type: 'string', description: 'For get.' },
        name: { type: 'string', description: 'For get: exact folder name, when the id is unknown.' },
        mode: LightModeProperty,
      },
      required: ['action'],
    },
  },
  {
    name: 'folders_write',
    description:
      'Create, edit or delete agent folders and move agents in or out. Actions: create (folder needs name; optional color, icon, starred, parentFolderID, agentIDs), update (folderId + folder with only the fields to change — use this to rename), delete (folderId; removes the folder only, agents are kept), add_agent / remove_agent (folderId + agentId).',
    annotations: WRITE_ANNOTATIONS,
    inputSchema: {
      type: 'object',
      properties: {
        action: {
          type: 'string',
          enum: ['create', 'update', 'delete', 'add_agent', 'remove_agent'],
        },
        folderId: { type: 'string', description: 'Required for every action except create.' },
        agentId: { type: 'string', description: 'Required for add_agent / remove_agent.' },
        folder: {
          type: 'object',
          additionalProperties: false,
          properties: {
            name: { type: 'string' },
            color: { type: 'string' },
            icon: { type: 'string' },
            starred: { type: 'boolean' },
            parentFolderID: { type: ['string', 'null'], description: 'Parent folder id, or null for top level.' },
            agentIDs: { type: 'array', items: { type: 'string' }, description: 'Create only: agents to put in the folder.' },
          },
        },
        mode: LightModeProperty,
      },
      required: ['action'],
    },
  },
];

export const foldersModule: ToolModule = {
  tools,
  handlers: {
    folders_read: wrapHandler('folders_read', async (args) => {
      const v = ReadSchema.parse(args);
      const folders = await listFolders();
      if (v.action === 'list') {
        return applyLightMode(v.mode, { success: true, count: folders.length, folders });
      }
      if (!v.folderId && !v.name) throw new Error('folderId or name is required for action=get');
      const folder = folders.find((item) =>
        v.folderId ? item?.ID === v.folderId : item?.name === v.name
      );
      if (!folder) throw new Error('Folder not found in this workspace');
      return applyLightMode(v.mode, { success: true, folder });
    }),
    folders_write: wrapHandler('folders_write', async (args) => {
      const v = WriteSchema.parse(args);
      const client = getActiveClient();
      if (v.action !== 'create') requireFor(v.action, v, 'folderId');
      switch (v.action) {
        case 'create':
          requireFor(v.action, v, 'folder');
          requireFor('create', v.folder as Record<string, unknown>, 'name');
          return applyLightMode(v.mode, await client.api('POST', '/folders/create', { body: v.folder }));
        case 'update': {
          requireFor(v.action, v, 'folder');
          const { agentIDs: _agentIDs, ...fields } = v.folder!;
          return applyLightMode(v.mode, await client.api('PATCH', folderPath(v.folderId!), { body: fields }));
        }
        case 'delete':
          return client.api('DELETE', folderPath(v.folderId!));
        case 'add_agent':
        case 'remove_agent':
          requireFor(v.action, v, 'agentId');
          return applyLightMode(
            v.mode,
            await client.api(
              v.action === 'add_agent' ? 'POST' : 'DELETE',
              `${folderPath(v.folderId!)}/agents/${encodeURIComponent(v.agentId!)}`,
              v.action === 'add_agent' ? { body: {} } : {}
            )
          );
      }
    }),
  },
};
