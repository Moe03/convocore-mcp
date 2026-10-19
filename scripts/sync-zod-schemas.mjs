#!/usr/bin/env node
/**
 * Regenerates src/generated/zod-schemas.ts from the main zod schemas in the sibling custom-vf-nextjs repo
 * (vg-docker/scripts/mcp-schemas/registry.ts). MCP tool parameter schemas come from there — never hand-written.
 */
import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const backend = resolve(process.env.CONVOCORE_BACKEND_DIR || join(root, '..', 'custom-vf-nextjs', 'vg-docker'));
if (!existsSync(join(backend, 'scripts', 'mcp-schemas', 'export.ts'))) {
  console.error(`Backend repo not found at ${backend} (set CONVOCORE_BACKEND_DIR).`);
  process.exit(1);
}
execFileSync(
  'npx',
  ['ts-node', '-r', 'tsconfig-paths/register', '--transpileOnly', 'scripts/mcp-schemas/export.ts', join(root, 'src', 'generated', 'zod-schemas.ts')],
  { cwd: backend, stdio: 'inherit' }
);
