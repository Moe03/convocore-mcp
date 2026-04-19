import { spawn } from 'node:child_process';
import { readFileSync } from 'node:fs';

const envFile = readFileSync(new URL('../.env', import.meta.url), 'utf8');
const workspaceLine = envFile.split(/\r?\n/).find((l) => l.startsWith('WORKSPACE_SECRET='));
const workspace = workspaceLine ? workspaceLine.split('=').slice(1).join('=').trim() : 'dummy_for_smoke';

const env = {
  ...process.env,
  WORKSPACE_SECRET: workspace,
  CONVOCORE_API_REGION: process.env.CONVOCORE_API_REGION || 'eu-gcp',
};

const child = spawn(process.execPath, ['dist/index.js'], { env, stdio: ['pipe', 'pipe', 'inherit'] });
let buf = '';
const responses = new Map();
child.stdout.on('data', (chunk) => {
  buf += chunk.toString('utf8');
  let nl;
  while ((nl = buf.indexOf('\n')) !== -1) {
    const line = buf.slice(0, nl).trim();
    buf = buf.slice(nl + 1);
    if (line) {
      const obj = JSON.parse(line);
      responses.set(obj.id, obj);
    }
  }
});

const send = (obj) => child.stdin.write(JSON.stringify(obj) + '\n');

const wait = (ms) => new Promise((r) => setTimeout(r, ms));

(async () => {
  send({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 'smoke', version: '0' } } });
  await wait(300);

  send({ jsonrpc: '2.0', id: 2, method: 'tools/list', params: {} });
  await wait(500);

  send({ jsonrpc: '2.0', id: 3, method: 'tools/call', params: { name: 'get_pricing_info', arguments: { section: 'plans' } } });
  await wait(300);

  send({ jsonrpc: '2.0', id: 4, method: 'tools/call', params: { name: 'get_pricing_info', arguments: { section: 'models', modelFilter: 'claude' } } });
  await wait(300);

  send({ jsonrpc: '2.0', id: 5, method: 'tools/call', params: { name: 'list_voice_providers', arguments: {} } });
  await wait(2000);

  const tools = JSON.parse(responses.get(2).result.content?.[0]?.text ?? 'null') ?? responses.get(2).result;
  const toolNames = (tools.tools ?? tools).map((t) => t.name);
  console.log('TOTAL_TOOLS=' + toolNames.length);
  console.log('NEW_TOOLS=' + JSON.stringify(toolNames.filter((n) => /voice|twilio|pricing/.test(n))));

  const plansResp = responses.get(3);
  const plansText = plansResp?.result?.content?.[0]?.text ?? '';
  console.log('PLANS_KEYS=' + Object.keys(JSON.parse(plansText)).join(','));

  const modelsResp = responses.get(4);
  const modelsText = modelsResp?.result?.content?.[0]?.text ?? '';
  const modelsParsed = JSON.parse(modelsText);
  console.log('CLAUDE_MODELS_COUNT=' + modelsParsed.count);
  console.log('CLAUDE_MODELS=' + modelsParsed.models.map((m) => m.model).join('|'));

  const provResp = responses.get(5);
  const provText = provResp?.result?.content?.[0]?.text ?? '';
  console.log('VOICE_PROVIDERS_RAW_LEN=' + provText.length);
  console.log('VOICE_PROVIDERS_PREVIEW=' + provText.slice(0, 400).replace(/\s+/g, ' '));
  console.log('VOICE_PROVIDERS_IS_ERROR=' + Boolean(provResp?.error || provResp?.result?.isError));

  child.kill();
  process.exit(0);
})();
