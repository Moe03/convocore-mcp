import type { Tool } from '@modelcontextprotocol/sdk/types.js';
import { z } from 'zod';
import { getActiveClient } from '../request-context.js';
import { type ToolModule, wrapHandler } from './helpers.js';

const AgencyWriteSchema = z
  .object({
    action: z.enum(['upsert', 'delete']),
    agency: z.record(z.unknown()).optional(),
  })
  .superRefine((v, ctx) => {
    if (v.action === 'upsert' && !v.agency) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'agency object is required for action=upsert',
        path: ['agency'],
      });
    }
  });

const tools: Tool[] = [
  {
    name: 'agency_read',
    description:
      'Get the current agency account for this workspace secret (raw document). For branding (logo, colours, fonts, language, login page) use agency_branding get — it is typed and never returns secrets. Distinct from orgs_read (child organizations) and clients_read (end-user client accounts).',
    annotations: {
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: true,
    },
    inputSchema: { type: 'object', properties: {} },
  },
  {
    name: 'agency_write',
    description:
      'Create (upsert with a name) or delete the agency account. To brand it (logo, colour, fonts, language, login page, assets) use agency_branding instead — it validates fields. Domain claims, verification flags, secrets and provider keys cannot be changed here (domains are verified on the dashboard). For org/client CRUD use orgs_write / clients_write.',
    annotations: {
      readOnlyHint: false,
      destructiveHint: true,
      idempotentHint: false,
      openWorldHint: true,
    },
    inputSchema: {
      type: 'object',
      properties: {
        action: { type: 'string', enum: ['upsert', 'delete'] },
        agency: {
          type: 'object',
          description: 'Agency fields for upsert (passthrough object).',
        },
      },
      required: ['action'],
    },
  },
];

export const agencyModule: ToolModule = {
  tools,
  handlers: {
    agency_read: wrapHandler('agency_read', async () => {
      return getActiveClient().getAgency();
    }),
    agency_write: wrapHandler('agency_write', async (args) => {
      const v = AgencyWriteSchema.parse(args);
      const client = getActiveClient();
      if (v.action === 'upsert') return client.upsertAgency(v.agency!);
      return client.deleteAgency();
    }),
  },
};
