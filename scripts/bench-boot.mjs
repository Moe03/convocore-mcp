#!/usr/bin/env node
/**
 * Cold-start benchmark for the ConvoCore MCP server.
 * Spawns `node dist/index.js` and measures wall time until the server
 * prints its "running on stdio" line on stderr (i.e. fully initialized).
 */
import { spawn } from 'node:child_process';
import { performance } from 'node:perf_hooks';

const RUNS = Number(process.argv[2] || 3);
const READY_LINE = 'ConvoCore MCP Server running on stdio';

async function bootOnce() {
  return new Promise((resolve, reject) => {
    const start = performance.now();
    const child = spawn(process.execPath, ['dist/index.js'], {
      env: { ...process.env, WORKSPACE_SECRET: 'dummy_for_bench' },
      stdio: ['ignore', 'ignore', 'pipe'],
    });
    let buf = '';
    const timer = setTimeout(() => {
      child.kill('SIGKILL');
      reject(new Error('Timed out after 10s'));
    }, 10_000);
    child.stderr.on('data', (chunk) => {
      buf += chunk.toString();
      if (buf.includes(READY_LINE)) {
        const elapsed = performance.now() - start;
        clearTimeout(timer);
        child.kill('SIGKILL');
        resolve(elapsed);
      }
    });
    child.on('error', reject);
  });
}

const samples = [];
for (let i = 0; i < RUNS; i++) {
  const ms = await bootOnce();
  samples.push(ms);
  console.log(`run ${i + 1}: ${ms.toFixed(1)} ms`);
}
const avg = samples.reduce((a, b) => a + b, 0) / samples.length;
const min = Math.min(...samples);
const max = Math.max(...samples);
console.log(`\nmin ${min.toFixed(1)} ms  |  avg ${avg.toFixed(1)} ms  |  max ${max.toFixed(1)} ms`);
