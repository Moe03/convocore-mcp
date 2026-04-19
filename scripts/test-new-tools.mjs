import { spawn } from 'node:child_process';

const env = { ...process.env, WORKSPACE_SECRET: 'dummy_for_smoke_test' };
const child = spawn(process.execPath, ['dist/index.js'], { env, stdio: ['pipe', 'pipe', 'inherit'] });

let buf = '';
const responses = [];
child.stdout.on('data', (chunk) => {
  buf += chunk.toString('utf8');
  let nl;
  while ((nl = buf.indexOf('\n')) !== -1) {
    const line = buf.slice(0, nl).trim();
    buf = buf.slice(nl + 1);
    if (line) responses.push(JSON.parse(line));
  }
});

function send(obj) {
  child.stdin.write(JSON.stringify(obj) + '\n');
}

send({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 'smoke', version: '0' } } });

setTimeout(() => {
  send({ jsonrpc: '2.0', id: 2, method: 'tools/call', params: { name: 'sleep', arguments: { seconds: 1 } } });
}, 200);

setTimeout(() => {
  const cmd = process.platform === 'win32' ? 'echo hello-from-shell' : 'echo hello-from-shell';
  send({ jsonrpc: '2.0', id: 3, method: 'tools/call', params: { name: 'run_command', arguments: { command: cmd } } });
}, 1500);

setTimeout(() => {
  send({ jsonrpc: '2.0', id: 4, method: 'tools/call', params: { name: 'run_command', arguments: { command: 'this-binary-does-not-exist-xyz' } } });
}, 2200);

setTimeout(() => {
  console.log('=== RESPONSES ===');
  for (const r of responses) console.log(JSON.stringify(r));
  child.kill();
  process.exit(0);
}, 3500);
