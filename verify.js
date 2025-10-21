#!/usr/bin/env node

/**
 * Verification script to check if the MCP server is properly configured
 * This doesn't run the server, just checks the setup
 */

import { readFileSync, existsSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

console.log('🔍 ConvoCore MCP Server Verification\n');

// Check if dist directory exists
const distPath = join(__dirname, 'dist');
if (!existsSync(distPath)) {
  console.error('❌ dist/ directory not found');
  console.error('   Run: pnpm run build');
  process.exit(1);
}
console.log('✅ dist/ directory exists');

// Check if main files exist
const requiredFiles = [
  'dist/index.js',
  'dist/config.js',
  'dist/convocore-client.js',
  'dist/types.js'
];

for (const file of requiredFiles) {
  const filePath = join(__dirname, file);
  if (!existsSync(filePath)) {
    console.error(`❌ ${file} not found`);
    process.exit(1);
  }
}
console.log('✅ All required files exist');

// Check package.json
const packageJson = JSON.parse(
  readFileSync(join(__dirname, 'package.json'), 'utf-8')
);
console.log(`✅ Package: ${packageJson.name}@${packageJson.version}`);

// Check dependencies
const requiredDeps = [
  '@modelcontextprotocol/sdk',
  'zod'
];

for (const dep of requiredDeps) {
  if (!packageJson.dependencies[dep]) {
    console.error(`❌ Missing dependency: ${dep}`);
    process.exit(1);
  }
}
console.log('✅ All dependencies present');

// Check for environment variable documentation
if (!existsSync(join(__dirname, '.env.example'))) {
  console.warn('⚠️  .env.example not found');
} else {
  console.log('✅ .env.example exists');
}

// Instructions
console.log('\n📝 Next Steps:\n');
console.log('1. Configure environment variables:');
console.log('   - CONVOCORE_API_KEY');
console.log('   - WORKSPACE_SECRET');
console.log('   - CONVOCORE_API_REGION (optional, defaults to eu-gcp)\n');

console.log('2. Add to Claude Desktop config:');
console.log('   See: claude_desktop_config.example.json\n');

console.log('3. Restart Claude Desktop\n');

console.log('✨ Verification complete! Server is ready to use.\n');

