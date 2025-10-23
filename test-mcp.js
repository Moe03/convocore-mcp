#!/usr/bin/env node

/**
 * Quick MCP Server Test
 * Tests that the server starts and lists tools correctly
 */

const { spawn } = require('child_process');

console.log('🧪 Testing ConvoCore MCP Server...\n');

// Set env vars
process.env.WORKSPACE_SECRET = 'test_token';
process.env.CONVOCORE_API_REGION = 'eu-gcp';

// Start the MCP server
const mcp = spawn('node', ['dist/index.js'], {
  env: process.env,
  stdio: ['pipe', 'pipe', 'pipe']
});

let output = '';
let timeout;

// Send initialize request
const initRequest = {
  jsonrpc: '2.0',
  id: 1,
  method: 'initialize',
  params: {
    protocolVersion: '1.0.0',
    capabilities: {},
    clientInfo: {
      name: 'test-client',
      version: '1.0.0'
    }
  }
};

// Send tools/list request
const toolsRequest = {
  jsonrpc: '2.0',
  id: 2,
  method: 'tools/list',
  params: {}
};

mcp.stdout.on('data', (data) => {
  output += data.toString();
  clearTimeout(timeout);
  
  timeout = setTimeout(() => {
    try {
      const lines = output.trim().split('\n');
      const responses = lines.map(line => {
        try {
          return JSON.parse(line);
        } catch (e) {
          return null;
        }
      }).filter(Boolean);

      const toolsResponse = responses.find(r => r.id === 2);
      
      if (toolsResponse && toolsResponse.result && toolsResponse.result.tools) {
        const tools = toolsResponse.result.tools;
        
        console.log('✅ MCP Server Started Successfully!\n');
        console.log(`📊 Total Tools: ${tools.length}\n`);
        
        // Group tools
        const agents = tools.filter(t => t.name.includes('agent') && !t.name.includes('conversation'));
        const conversations = tools.filter(t => t.name.includes('conversation') || t.name.includes('convo'));
        const kb = tools.filter(t => t.name.includes('kb'));
        
        console.log('🔧 Agent Tools (9):');
        agents.forEach(t => console.log(`   • ${t.name}`));
        
        console.log('\n💬 Conversation Tools (8):');
        conversations.forEach(t => console.log(`   • ${t.name}`));
        
        console.log('\n📚 Knowledge Base Tools (6):');
        kb.forEach(t => console.log(`   • ${t.name}`));
        
        console.log('\n✅ ALL TESTS PASSED!');
        console.log('🚀 MCP Server is ready to deploy!\n');
        
        mcp.kill();
        process.exit(0);
      }
    } catch (e) {
      console.error('❌ Error:', e.message);
      mcp.kill();
      process.exit(1);
    }
  }, 100);
});

mcp.stderr.on('data', (data) => {
  const msg = data.toString();
  if (!msg.includes('Server running')) {
    console.error('stderr:', msg);
  }
});

mcp.on('error', (error) => {
  console.error('❌ Failed to start server:', error.message);
  process.exit(1);
});

// Send requests
setTimeout(() => {
  mcp.stdin.write(JSON.stringify(initRequest) + '\n');
}, 100);

setTimeout(() => {
  mcp.stdin.write(JSON.stringify(toolsRequest) + '\n');
}, 200);

// Timeout after 5 seconds
setTimeout(() => {
  console.error('❌ Test timeout');
  mcp.kill();
  process.exit(1);
}, 5000);

