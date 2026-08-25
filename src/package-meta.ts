import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const pkg = require('../package.json') as { name?: string; version?: string };

/** Always mirrors package.json — do not hardcode. */
export const PACKAGE_NAME = typeof pkg.name === 'string' ? pkg.name : 'convocore-mcp';
export const PACKAGE_VERSION =
  typeof pkg.version === 'string' && pkg.version.trim().length > 0
    ? pkg.version.trim()
    : '0.0.0';
