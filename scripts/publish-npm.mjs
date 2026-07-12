#!/usr/bin/env node
/**
 * Publish convocore-mcp to npm using NPM_ACCESS_TOKEN from env or .env.
 */

import { execSync } from 'node:child_process';
import { existsSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const envPath = join(root, '.env');

if (existsSync(envPath)) {
  for (const line of readFileSync(envPath, 'utf8').split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eq = trimmed.indexOf('=');
    if (eq === -1) continue;
    const key = trimmed.slice(0, eq).trim();
    const value = trimmed.slice(eq + 1).trim().replace(/^["']|["']$/g, '');
    if (key && process.env[key] === undefined) process.env[key] = value;
  }
}

const token =
  process.env.NPM_ACCESS_TOKEN ||
  process.env.NPM_MOE03_TOKEN ||
  process.env.NODE_AUTH_TOKEN;
if (!token) {
  console.error('Missing NPM_ACCESS_TOKEN (set in env or .env — see .env.example).');
  process.exit(1);
}

const npmrcPath = join(root, '.npmrc.publish');
writeFileSync(npmrcPath, `//registry.npmjs.org/:_authToken=${token}\n`);

try {
  execSync('pnpm run build', { cwd: root, stdio: 'inherit' });
  execSync('npm publish --access public --userconfig .npmrc.publish', {
    cwd: root,
    stdio: 'inherit',
  });
} finally {
  try {
    unlinkSync(npmrcPath);
  } catch {
    // ignore
  }
}
