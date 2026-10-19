import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';
import { tools } from '../dist/index.js';

/**
 * Tool parameters must come from the main zod schemas (src/generated/zod-schemas.ts) with every field
 * described — never a bare { type: 'object' } the model has to guess. The baseline lists the older
 * untyped params still being migrated; it may only shrink.
 */
const baseline = new Set(JSON.parse(readFileSync(new URL('./untyped-params-baseline.json', import.meta.url), 'utf8')));

function untypedParams() {
  const hits = [];
  const walk = (tool, path, s) => {
    if (!s || typeof s !== 'object') return;
    // A depth-limited object is summarised as "Fields: a, b, c." in its description — the model still knows the names.
    const summarised = typeof s.description === 'string' && /Fields: [A-Za-z_]/.test(s.description);
    if (s.type === 'object' && !s.properties && !s.anyOf && !s.oneOf && !summarised && !(s.additionalProperties && s.additionalProperties.type)) {
      hits.push(`${tool} ${path}`);
    }
    for (const [k, v] of Object.entries(s.properties || {})) walk(tool, `${path}.${k}`, v);
    for (const v of s.anyOf || []) walk(tool, path, v);
    if (s.items) walk(tool, `${path}[]`, s.items);
  };
  for (const t of tools) walk(t.name, '', t.inputSchema);
  return hits;
}

describe('tool parameter schemas', () => {
  it('no new untyped object parameters (use a generated zod schema)', () => {
    const fresh = untypedParams().filter((h) => !baseline.has(h));
    assert.deepEqual(fresh, [], `Untyped params found — generate them from zod instead:\n${fresh.join('\n')}`);
  });

  it('migrated tools stay fully typed and described', () => {
    for (const name of ['clients_write', 'orgs_write', 'agency_branding', 'integrations_write']) {
      const tool = tools.find((t) => t.name === name);
      const missing = [];
      const walk = (path, s) => {
        for (const [k, v] of Object.entries(s.properties || {})) {
          if (!v.description && !v.anyOf) missing.push(`${path}.${k}`);
          walk(`${path}.${k}`, v);
          if (v.items) walk(`${path}.${k}[]`, v.items);
        }
        for (const v of s.anyOf || []) walk(path, v);
      };
      walk(name, tool.inputSchema);
      assert.deepEqual(missing.filter((m) => !m.endsWith('.action')), [], `${name} has fields without a description`);
    }
  });
});
