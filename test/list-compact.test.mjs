import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  applyListMode,
  compactAgentsListResult,
  compactClientsListResult,
  compactConversationsListResult,
  compactKbDocsListResult,
  compactLeadsListResult,
  compactOrgsListResult,
} from '../dist/list-compact.js';

describe('list-compact modes', () => {
  it('compactAgentsListResult strips heavy fields and wraps arrays', () => {
    const out = compactAgentsListResult([
      { ID: '1', title: 'A', nodes: [{ instructions: 'big' }], vg_instructions: 'legacy' },
    ]);
    assert.equal(out.mode, 'compact');
    assert.equal(out.data.length, 1);
    assert.equal(out.data[0].ID, '1');
    assert.equal(out.data[0].nodes, undefined);
    assert.equal(out.data[0].vg_instructions, undefined);
  });

  it('compactConversationsListResult drops messages', () => {
    const out = compactConversationsListResult({
      data: [
        {
          ID: 'c1',
          summary: 'hello',
          messages: [{ role: 'user', content: 'hi' }],
          userEmail: 'a@b.com',
        },
      ],
      hasMore: false,
    });
    assert.equal(out.mode, 'compact');
    assert.equal(out.data[0].ID, 'c1');
    assert.equal(out.data[0].messages, undefined);
    assert.equal(out.data[0].userEmail, 'a@b.com');
  });

  it('compactKbDocsListResult drops content bodies', () => {
    const out = compactKbDocsListResult({
      data: [{ id: 'd1', name: 'Doc', content: 'HUGE BODY', status: 'ready' }],
    });
    assert.equal(out.data[0].id, 'd1');
    assert.equal(out.data[0].content, undefined);
    assert.equal(out.data[0].status, 'ready');
  });

  it('compactLeadsListResult keeps contact fields without metaData', () => {
    const out = compactLeadsListResult({
      data: [
        {
          id: 'l1',
          email: 'x@y.com',
          name: 'X',
          metaData: { source: 'web', company: 'Acme Corp', secret: 'nope' },
        },
      ],
    });
    assert.equal(out.data[0].email, 'x@y.com');
    assert.equal(out.data[0].source, 'web');
    assert.equal(out.data[0].company, 'Acme Corp');
    assert.equal(out.data[0].metaData, undefined);
  });

  it('compactOrgsListResult and compactClientsListResult keep short fields', () => {
    const orgs = compactOrgsListResult({
      data: [{ id: 'o1', name: 'Org', email: 'o@x.com', hugeNested: { a: 1 } }],
    });
    assert.equal(orgs.data[0].id, 'o1');
    assert.equal(orgs.data[0].hugeNested, undefined);

    const clients = compactClientsListResult({
      data: [{ id: 'c1', name: 'Client', orgId: 'o1', nested: true }],
    });
    assert.equal(clients.data[0].id, 'c1');
    assert.equal(clients.data[0].nested, undefined);
  });

  it('applyListMode defaults to compact and passes through on full', () => {
    const raw = { data: [{ id: '1', content: 'body' }] };
    const compact = applyListMode(undefined, raw, compactKbDocsListResult);
    assert.equal(compact.mode, 'compact');
    assert.equal(compact.data[0].content, undefined);

    const full = applyListMode('full', raw, compactKbDocsListResult);
    assert.equal(full, raw);
    assert.equal(full.data[0].content, 'body');
  });
});
