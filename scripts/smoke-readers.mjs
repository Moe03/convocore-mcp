#!/usr/bin/env node
/**
 * Smoke test for the file-readers module against real local files.
 * Verifies each reader path actually parses without throwing.
 */
import { performance } from 'node:perf_hooks';
import {
  inspectFile,
  readTextFile,
  readImage,
  loadFile,
} from '../dist/file-readers.js';

async function time(label, fn) {
  const t = performance.now();
  try {
    const r = await fn();
    console.log(`OK  ${label.padEnd(32)} ${(performance.now() - t).toFixed(0)}ms`);
    return r;
  } catch (e) {
    console.log(`ERR ${label.padEnd(32)} ${(performance.now() - t).toFixed(0)}ms  ${e.message}`);
    throw e;
  }
}

console.log('--- inspect_file ---');
console.log(await time('inspect README.md', () => inspectFile({ path: 'README.md' })));
console.log(await time('inspect package.json', () => inspectFile({ path: 'package.json' })));

console.log('\n--- read_text_file ---');
const txt = await time('read package.json', () => readTextFile({ path: 'package.json' }));
console.log({ chars: txt.text.length, tokens: txt.estimatedTokens, truncated: txt.truncated });

console.log('\n--- loadFile (base64 data mode) ---');
const tinyPng = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=',
  'base64',
);
const loaded = await time('loadFile inline png', () =>
  loadFile({ data: tinyPng.toString('base64'), mimeType: 'image/png' }),
);
console.log({ kind: loaded.kind, mime: loaded.mimeType, bytes: loaded.bytes.byteLength });

console.log('\n--- read_image (1x1 png, normalize path) ---');
const img = await time('read_image', () =>
  readImage({ data: tinyPng.toString('base64'), mimeType: 'image/png' }),
);
console.log({ w: img.width, h: img.height, mime: img.mimeType, bytes: img.sizeBytes, normalized: img.normalized });

console.log('\nAll smoke tests passed.');
