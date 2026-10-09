import type { Tool } from '@modelcontextprotocol/sdk/types.js';
import { z } from 'zod';
import { getActiveClient } from '../request-context.js';
import { resolveActiveWorkspaceId } from '../workspace-id.js';
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

const READ_ACTIONS = [
  'list_jobs',
  'get_job',
  'list_pages',
  'get_page',
  'schema_result',
  'freeform_aggregate',
] as const;

const WRITE_ACTIONS = [
  'create_job',
  'delete_job',
  'resume_job',
  'retry_schema_url',
  'extend_schema_crawl',
  'import_freeform_to_kb',
  'index_structured_search',
  'attach_structured_search',
  'detach_structured_search',
  'set_structured_search_description',
] as const;

const ReadSchema = z.object({
  action: z.enum(READ_ACTIONS),
  jobId: z.string().optional(),
  pageId: z.string().optional(),
  cursor: z.string().optional(),
  page: z.number().int().positive().optional(),
  limit: z.number().int().positive().max(100).optional(),
  rebuild: z.boolean().optional(),
  mode: LightModeField,
});

const WriteSchema = z.object({
  action: z.enum(WRITE_ACTIONS),
  jobId: z.string().optional(),
  job: z.record(z.unknown()).optional(),
  url: z.string().url().optional(),
  agentId: z.string().optional(),
  agentIds: z.array(z.string().min(1)).optional(),
  refreshRate: z.string().optional(),
  rebuild: z.boolean().optional(),
  forceRecreate: z.boolean().optional(),
  toolDescription: z.string().max(4000).optional(),
  mode: LightModeField,
});

async function jobsPath(jobId?: string): Promise<string> {
  const workspaceId = await resolveActiveWorkspaceId();
  const base = `/workspaces/${encodeURIComponent(workspaceId)}/crawler/jobs`;
  return jobId ? `${base}/${encodeURIComponent(jobId)}` : base;
}

const tools: Tool[] = [
  {
    name: 'crawler_read',
    description:
      'Read website crawler jobs of the workspace (dashboard: Automations). Actions: ' +
      'list_jobs (cursor-paginated: pass nextCursor back as cursor), get_job (status and settings), ' +
      'list_pages (scraped pages of a job), get_page (one page — page text only with mode="full"), ' +
      'schema_result (structured items extracted by a schema crawl), ' +
      'freeform_aggregate (merged markdown of a free-form crawl; rebuild=true regenerates it). ' +
      'For a quick one-page scrape use scrape_url; to load URLs into a knowledge base use create_kb_from_urls.',
    annotations: READ_ANNOTATIONS,
    inputSchema: {
      type: 'object',
      properties: {
        action: { type: 'string', enum: [...READ_ACTIONS] },
        jobId: { type: 'string', description: 'Required for every action except list_jobs.' },
        pageId: { type: 'string', description: 'Required for get_page.' },
        cursor: { type: 'string', description: 'For list_jobs.' },
        page: { type: 'number', description: 'For list_pages.' },
        limit: { type: 'number' },
        rebuild: { type: 'boolean', description: 'For freeform_aggregate.' },
        mode: LightModeProperty,
      },
      required: ['action'],
    },
  },
  {
    name: 'crawler_write',
    description:
      'Run and manage website crawler jobs, and turn a schema crawl into a searchable catalog for agents. Actions: ' +
      'create_job (job: { urls[], crawl?, crawlOptions?, deep?, useProxy? (paid proxy pricing — ask first), aiPostProcess?, mode?: "markdown"|"schema", schemaCrawl?: { maxItems, freeForm, collectMarkdown, operatorNotes }, refreshRate?, toAgentId? / toAgentIds? }), ' +
      'delete_job, resume_job (continue a stopped job), ' +
      'retry_schema_url (re-extract one url of a schema crawl), extend_schema_crawl (collect more items), ' +
      'import_freeform_to_kb (agentId: put the merged markdown into that agent knowledge base), ' +
      'index_structured_search (build the search index from the schema result; forceRecreate rebuilds it), ' +
      'attach_structured_search / detach_structured_search (agentIds: give or remove the catalog search tool), ' +
      'set_structured_search_description (toolDescription: tells agents when to use the catalog search). ' +
      'Crawling consumes workspace credits.',
    annotations: WRITE_ANNOTATIONS,
    inputSchema: {
      type: 'object',
      properties: {
        action: { type: 'string', enum: [...WRITE_ACTIONS] },
        jobId: { type: 'string', description: 'Required for every action except create_job.' },
        job: { type: 'object', description: 'For create_job.' },
        url: { type: 'string', description: 'For retry_schema_url.' },
        agentId: { type: 'string', description: 'For import_freeform_to_kb.' },
        agentIds: { type: 'array', items: { type: 'string' }, description: 'For attach / detach.' },
        refreshRate: { type: 'string', description: 'For import_freeform_to_kb.' },
        rebuild: { type: 'boolean', description: 'For import_freeform_to_kb.' },
        forceRecreate: { type: 'boolean', description: 'For index_structured_search.' },
        toolDescription: { type: 'string', description: 'For set_structured_search_description (max 4000 chars).' },
        mode: LightModeProperty,
      },
      required: ['action'],
    },
  },
];

export const crawlerModule: ToolModule = {
  tools,
  handlers: {
    crawler_read: wrapHandler('crawler_read', async (args) => {
      const v = ReadSchema.parse(args);
      const client = getActiveClient();
      if (v.action !== 'list_jobs') requireFor(v.action, v, 'jobId');
      switch (v.action) {
        case 'list_jobs':
          return applyLightMode(
            v.mode,
            await client.api('GET', await jobsPath(), { query: { cursor: v.cursor, limit: v.limit } })
          );
        case 'get_job':
          return applyLightMode(v.mode, await client.api('GET', await jobsPath(v.jobId)));
        case 'list_pages':
          return applyLightMode(
            v.mode,
            await client.api('GET', `${await jobsPath(v.jobId)}/pages`, {
              query: { page: v.page, limit: v.limit },
            })
          );
        case 'get_page':
          requireFor(v.action, v, 'pageId');
          return applyLightMode(
            v.mode,
            await client.api('GET', `${await jobsPath(v.jobId)}/pages/${encodeURIComponent(v.pageId!)}`)
          );
        case 'schema_result':
          return applyLightMode(v.mode, await client.api('GET', `${await jobsPath(v.jobId)}/schema-result`));
        case 'freeform_aggregate':
          return applyLightMode(
            v.mode,
            await client.api('GET', `${await jobsPath(v.jobId)}/freeform-aggregate`, {
              query: { rebuild: v.rebuild },
            })
          );
      }
    }),
    crawler_write: wrapHandler('crawler_write', async (args) => {
      const v = WriteSchema.parse(args);
      const client = getActiveClient();
      if (v.action !== 'create_job') requireFor(v.action, v, 'jobId');
      const post = async (suffix: string, body: Record<string, unknown> = {}) =>
        applyLightMode(v.mode, await client.api('POST', `${await jobsPath(v.jobId)}${suffix}`, { body }));

      switch (v.action) {
        case 'create_job': {
          requireFor(v.action, v, 'job');
          const urls = (v.job as { urls?: unknown }).urls;
          if (!Array.isArray(urls) || urls.length === 0) {
            throw new Error('job.urls (at least one URL) is required for action=create_job');
          }
          return applyLightMode(v.mode, await client.api('POST', await jobsPath(), { body: v.job }));
        }
        case 'delete_job':
          return client.api('DELETE', await jobsPath(v.jobId));
        case 'resume_job':
          return post('/resume');
        case 'retry_schema_url':
          requireFor(v.action, v, 'url');
          return post('/schema-retry', { url: v.url });
        case 'extend_schema_crawl':
          return post('/structured-search/extend');
        case 'import_freeform_to_kb':
          requireFor(v.action, v, 'agentId');
          return post('/freeform-aggregate/import', {
            agentId: v.agentId,
            ...(v.refreshRate ? { refreshRate: v.refreshRate } : {}),
            ...(v.rebuild !== undefined ? { rebuild: v.rebuild } : {}),
          });
        case 'index_structured_search':
          return post('/structured-search/index', {
            ...(v.forceRecreate !== undefined ? { forceRecreate: v.forceRecreate } : {}),
          });
        case 'attach_structured_search':
        case 'detach_structured_search':
          if (!v.agentIds?.length) throw new Error(`agentIds is required for action=${v.action}`);
          return post(
            v.action === 'attach_structured_search' ? '/structured-search/attach' : '/structured-search/detach',
            { agentIds: v.agentIds }
          );
        case 'set_structured_search_description':
          requireFor(v.action, v, 'toolDescription');
          return post('/structured-search/tool-description', { toolDescription: v.toolDescription });
      }
    }),
  },
};
