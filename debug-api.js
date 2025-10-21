#!/usr/bin/env node

/**
 * Debug API calls to see what's happening
 */

const WORKSPACE_SECRET = 'vg_jixC84hSLMMp1hQWU3sr';
const BASE_URL = 'https://eu-gcp-api.vg-stuff.com/v3';

console.log('🔍 Debugging ConvoCore API...\n');

// Try different workspaceId formats
const tests = [
  { name: 'Full secret as workspaceId', workspaceId: WORKSPACE_SECRET },
  { name: 'Without vg_ prefix', workspaceId: WORKSPACE_SECRET.replace('vg_', '') },
  { name: 'Just the secret part', workspaceId: 'jixC84hSLMMp1hQWU3sr' },
];

for (const test of tests) {
  console.log(`Testing: ${test.name}`);
  console.log(`  WorkspaceId: ${test.workspaceId}`);
  
  try {
    const url = `${BASE_URL}/agents/search?workspaceId=${encodeURIComponent(test.workspaceId)}&page=1&limit=10&sortBy=newest`;
    console.log(`  URL: ${url.substring(0, 80)}...`);
    
    const response = await fetch(url, {
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${WORKSPACE_SECRET}`,
        'Content-Type': 'application/json',
      },
    });
    
    const data = await response.json();
    
    if (response.ok) {
      console.log(`  ✅ Success! Status: ${response.status}`);
      console.log(`  Total agents: ${data.total || data.agents?.length || 0}`);
      console.log(`  Agents returned: ${data.agents?.length || 0}`);
      if (data.agents && data.agents.length > 0) {
        console.log(`  First agent: ${data.agents[0].title || data.agents[0].ID}`);
      }
    } else {
      console.log(`  ❌ Failed! Status: ${response.status}`);
      console.log(`  Error: ${data.message || JSON.stringify(data)}`);
    }
  } catch (error) {
    console.log(`  ❌ Error: ${error.message}`);
  }
  
  console.log('');
}

console.log('\n🎯 Once we find the right format, we\'ll update the code!\n');

