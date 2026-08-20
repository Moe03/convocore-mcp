import type { Tool } from '@modelcontextprotocol/sdk/types.js';
import { z } from 'zod';
import { getActiveClient } from '../request-context.js';
import { type ToolModule, wrapHandler } from './helpers.js';

const SearchSchema = z.object({
  agentId: z.string(),
  searchQuery: z.string().optional(),
  vector: z.array(z.number()).optional(),
  vectorDb: z.string().optional(),
  defaultDimension: z.number().optional(),
  max_chunks: z.number().optional(),
  similarity_threshold: z.number().optional(),
  with_payload: z.boolean().optional(),
  with_vector: z.boolean().optional(),
});

const BulkDeleteSchema = z.object({
  agentId: z.string(),
  docIds: z.array(z.string()).min(1),
});

const BulkCreateSchema = z.object({
  agentId: z.string(),
  docs: z
    .array(
      z.object({
        name: z.string(),
        sourceType: z.enum(['doc', 'url', 'sitemap']).optional(),
        content: z.string().optional(),
        urls: z.array(z.string()).optional(),
        tags: z.array(z.string()).optional(),
        metadata: z
          .object({ description: z.string().optional() })
          .passthrough()
          .optional(),
      })
    )
    .min(1)
    .max(20),
});

const CreateImageSchema = z.object({
  agentId: z.string(),
  images: z
    .array(
      z.object({
        sourceUrl: z.string().optional(),
        data: z.string().optional(),
        mimeType: z.string().optional(),
      })
    )
    .min(1)
    .max(30),
  targetDocName: z.string().min(1),
  autoCaption: z.boolean().optional(),
  tags: z.array(z.string()).optional(),
});

const QuotaSchema = z.object({
  workspaceId: z.string().optional(),
});

const tools: Tool[] = [
  {
    name: 'search_kb_docs',
    description:
      'Semantic/vector search over an agent knowledge base (POST .../kb/search). Prefer this to list_kb_docs when looking for content by meaning. For CRUD use create_kb_doc / get_kb_doc / patch_kb_doc.',
    annotations: {
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: true,
    },
    inputSchema: {
      type: 'object',
      properties: {
        agentId: { type: 'string' },
        searchQuery: { type: 'string' },
        vector: { type: 'array', items: { type: 'number' } },
        vectorDb: { type: 'string' },
        defaultDimension: { type: 'number' },
        max_chunks: { type: 'number' },
        similarity_threshold: { type: 'number' },
        with_payload: { type: 'boolean' },
        with_vector: { type: 'boolean' },
      },
      required: ['agentId'],
    },
  },
  {
    name: 'bulk_delete_kb_docs',
    description:
      'Delete many KB documents in one call (POST .../kb/delete). Prefer over looping delete_kb_doc. Destructive and irreversible.',
    annotations: {
      readOnlyHint: false,
      destructiveHint: true,
      idempotentHint: true,
      openWorldHint: true,
    },
    inputSchema: {
      type: 'object',
      properties: {
        agentId: { type: 'string' },
        docIds: { type: 'array', items: { type: 'string' }, minItems: 1 },
      },
      required: ['agentId', 'docIds'],
    },
  },
  {
    name: 'bulk_create_kb_docs',
    description:
      'Create up to 20 KB documents in one request. For many website URLs prefer create_kb_from_urls. For a single doc use create_kb_doc.',
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
        docs: {
          type: 'array',
          minItems: 1,
          maxItems: 20,
          items: {
            type: 'object',
            properties: {
              name: { type: 'string' },
              sourceType: { type: 'string', enum: ['doc', 'url', 'sitemap'] },
              content: { type: 'string' },
              urls: { type: 'array', items: { type: 'string' } },
              tags: { type: 'array', items: { type: 'string' } },
              metadata: { type: 'object' },
            },
            required: ['name'],
          },
        },
      },
      required: ['agentId', 'docs'],
    },
  },
  {
    name: 'create_kb_image',
    description:
      'Upload images into the agent KB (optional auto-caption). Provide images[].sourceUrl and/or base64 data + mimeType, plus targetDocName.',
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
        images: {
          type: 'array',
          minItems: 1,
          maxItems: 30,
          items: {
            type: 'object',
            properties: {
              sourceUrl: { type: 'string' },
              data: { type: 'string' },
              mimeType: { type: 'string' },
            },
          },
        },
        targetDocName: { type: 'string' },
        autoCaption: { type: 'boolean' },
        tags: { type: 'array', items: { type: 'string' } },
      },
      required: ['agentId', 'images', 'targetDocName'],
    },
  },
  {
    name: 'get_kb_quota',
    description:
      'Get workspace KB document quota usage (GET /workspace/kb-docs/quota). Optional workspaceId; defaults to the authenticated workspace.',
    annotations: {
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: true,
    },
    inputSchema: {
      type: 'object',
      properties: { workspaceId: { type: 'string' } },
    },
  },
];

export const kbExtrasModule: ToolModule = {
  tools,
  handlers: {
    search_kb_docs: wrapHandler('search_kb_docs', async (args) => {
      const v = SearchSchema.parse(args);
      const { agentId, ...body } = v;
      return getActiveClient().searchKBDocs(agentId, body);
    }),
    bulk_delete_kb_docs: wrapHandler('bulk_delete_kb_docs', async (args) => {
      const v = BulkDeleteSchema.parse(args);
      return getActiveClient().bulkDeleteKBDocs(v.agentId, v.docIds);
    }),
    bulk_create_kb_docs: wrapHandler('bulk_create_kb_docs', async (args) => {
      const v = BulkCreateSchema.parse(args);
      return getActiveClient().bulkCreateKBDocs(v.agentId, v.docs);
    }),
    create_kb_image: wrapHandler('create_kb_image', async (args) => {
      const v = CreateImageSchema.parse(args);
      return getActiveClient().createKBImages(v.agentId, {
        images: v.images,
        targetDocName: v.targetDocName,
        autoCaption: v.autoCaption,
        tags: v.tags,
      });
    }),
    get_kb_quota: wrapHandler('get_kb_quota', async (args) => {
      const v = QuotaSchema.parse(args ?? {});
      return getActiveClient().getKBQuota(v.workspaceId);
    }),
  },
};
