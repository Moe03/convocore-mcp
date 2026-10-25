import type { Tool } from '@modelcontextprotocol/sdk/types.js';
import { z } from 'zod';
import { getActiveClient } from '../request-context.js';
import { type ToolModule, wrapHandler } from './helpers.js';

const BaseSchema = z.object({
  agentId: z.string().describe('The agent ID'),
  convoId: z.string().describe('The conversation ID'),
});
const ListSchema = BaseSchema;
const AddSchema = BaseSchema.extend({
  text: z.string().min(1).max(5000),
  authorName: z.string().max(80).optional(),
});
const UpdateSchema = AddSchema.extend({ noteId: z.string() });
const DeleteSchema = BaseSchema.extend({
  noteId: z.string(),
  authorName: z.string().max(80).optional(),
});

const idProps = {
  agentId: { type: 'string', description: 'The agent ID' },
  convoId: { type: 'string', description: 'The conversation ID' },
};
const authorNameProp = {
  type: 'string',
  description:
    'Label for who is acting, e.g. "Claude via MCP". Only used because API-key calls have no signed-in person; it is shown on the note and in the audit log.',
};

const tools: Tool[] = [
  {
    name: 'list_conversation_notes',
    description:
      'List the human review notes on a conversation (a timeline, oldest first). Each note has id, text, createdAt (unix seconds), authorName/authorEmail and source (dashboard | api). get_conversation also returns them as reviewNotes. To find conversations by note, use query_conversations with hasNotes / noteContains.',
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
    inputSchema: { type: 'object', properties: { ...idProps }, required: ['agentId', 'convoId'] },
  },
  {
    name: 'add_conversation_note',
    description:
      'Add a note to a conversation\'s notes timeline (visible to the workspace team and clients in the dashboard). Recorded in the workspace Logs with who, IP and time. Max 5000 characters. Prefer this over update_conversation, which cannot change notes.',
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true },
    inputSchema: {
      type: 'object',
      properties: {
        ...idProps,
        text: { type: 'string', description: 'The note text (max 5000 characters).' },
        authorName: authorNameProp,
      },
      required: ['agentId', 'convoId', 'text'],
    },
  },
  {
    name: 'update_conversation_note',
    description:
      'Replace the text of one existing note. The previous text is kept in the workspace Logs with who edited it, from which IP and when.',
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: true },
    inputSchema: {
      type: 'object',
      properties: {
        ...idProps,
        noteId: { type: 'string', description: 'The note id from list_conversation_notes.' },
        text: { type: 'string', description: 'The new note text (max 5000 characters).' },
        authorName: authorNameProp,
      },
      required: ['agentId', 'convoId', 'noteId', 'text'],
    },
  },
  {
    name: 'delete_conversation_note',
    description:
      'Delete one note. Any user with access may delete any note; a full copy is kept in the workspace Logs with who deleted it, from which IP and when. Only call when the user asked to delete that note.',
    annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: true },
    inputSchema: {
      type: 'object',
      properties: {
        ...idProps,
        noteId: { type: 'string', description: 'The note id from list_conversation_notes.' },
        authorName: authorNameProp,
      },
      required: ['agentId', 'convoId', 'noteId'],
    },
  },
];

export const conversationNotesModule: ToolModule = {
  tools,
  handlers: {
    list_conversation_notes: wrapHandler('list_conversation_notes', async (args) => {
      const v = ListSchema.parse(args);
      return getActiveClient().listConversationNotes(v.agentId, v.convoId);
    }),
    add_conversation_note: wrapHandler('add_conversation_note', async (args) => {
      const v = AddSchema.parse(args);
      return getActiveClient().addConversationNote(v.agentId, v.convoId, {
        text: v.text,
        authorName: v.authorName,
      });
    }),
    update_conversation_note: wrapHandler('update_conversation_note', async (args) => {
      const v = UpdateSchema.parse(args);
      return getActiveClient().updateConversationNote(v.agentId, v.convoId, v.noteId, {
        text: v.text,
        authorName: v.authorName,
      });
    }),
    delete_conversation_note: wrapHandler('delete_conversation_note', async (args) => {
      const v = DeleteSchema.parse(args);
      return getActiveClient().deleteConversationNote(v.agentId, v.convoId, v.noteId, v.authorName);
    }),
  },
};
