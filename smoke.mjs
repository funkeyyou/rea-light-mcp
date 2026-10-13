import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadSdk } from './sdk.mjs';

const sdk = loadSdk();
const root = await mkdtemp(join(tmpdir(), 'rea-light-smoke-'));
const client = new sdk.Client({ name: 'rea-light-smoke', version: '1' }, { capabilities: {} });
const transport = new sdk.StdioClientTransport({ command: process.execPath, args: [fileURLToPath(new URL('./server.mjs', import.meta.url))], env: { ...process.env, REA_LIGHT_RESULTS_DIR: join(root, 'results') }, stderr: 'inherit' });
const read = result => { assert.notEqual(result.isError, true, JSON.stringify(result)); return JSON.parse(result.content[0].text); };
async function call(name, args) { return client.callTool({ name, arguments: args }, { timeout: 90000 }); }
async function complete(result) {
  assert.notEqual(result.isError, true, JSON.stringify(result));
  if (result.structuredContent) return result.structuredContent;
  const parsed = read(result);
  if (parsed.result_id && parsed.complete_on_disk) {
    const saved = JSON.parse(await readFile(parsed.path, 'utf8'));
    return saved.structuredContent || read(saved);
  }
  return parsed;
}
const direct = new sdk.Client({ name: 'rea-size-control', version: '1' }, { capabilities: {} });
try {
  await client.connect(transport);
  const list = await client.listTools();
  assert.equal(list.tools.length, 4);
  const discovery = read(await call('rea_search', { query: 'javascript application', limit: 3 }));
  assert.ok(discovery.tools.some(t => t.name === 'analyze_javascript_application'));
  const schema = read(await call('rea_schema', { name: 'analyze_javascript_application' }));
  assert.ok(schema.inputSchema.properties.input_path);
  const fixture = join(root, 'app'); await mkdir(fixture);
  await writeFile(join(fixture, 'main.js'), 'export function greet(name) { return "hello " + name; }\n');
  read(await call('rea_call', { name: 'open_binary', arguments: { path: join(fixture, 'main.js') } }));
  const state = await call('rea_call', { name: 'binary_session', arguments: {} });
  const active = await complete(state);
  assert.equal(active.result.open, true);
  assert.equal(active.result.path.replaceAll('\\', '/').endsWith('/main.js'), true);
  const analysis = await call('rea_call', { name: 'analyze_javascript_application', arguments: { input_path: fixture, detail: 'summary' } });
  const evidence = analysis.structuredContent || read(analysis);
  const parent = evidence.normalized_result.parent_evidence_id;
  assert.ok(parent);
  const viewSchema = read(await call('rea_schema', { name: 'inspect_analysis_view' }));
  assert.ok(viewSchema.inputSchema.properties.source);
  const view = await call('rea_call', { name: 'inspect_analysis_view', arguments: { source: { kind: 'retained-evidence', evidence_id: parent }, view: { kind: 'summary' } } });
  assert.notEqual(view.isError, true, JSON.stringify(view));
  const bundle = await call('rea_call', { name: 'get_evidence_bundle', arguments: {} });
  assert.notEqual(bundle.isError, true, JSON.stringify(bundle));
  let refs = false;
  if (!bundle.structuredContent) {
    const metadata = read(bundle);
    if (metadata.result_id) {
      const page = read(await call('rea_result', { result_id: metadata.result_id, pointer: '/structuredContent/result/records', limit: 2000 }));
      assert.ok(page.text.includes(parent));
      refs = true;
    }
  }
  // Capture the full Evidence and exercise result_refs against real REA.
  const full = await call('rea_call', { name: 'analyze_javascript_application', arguments: { input_path: fixture } });
  assert.notEqual(full.isError, true, JSON.stringify(full));
  if (!full.structuredContent) {
    const metadata = read(full);
    if (metadata.result_id) {
      const reused = await call('rea_call', { name: 'inspect_analysis_view', arguments: { source: { kind: 'inline' }, view: { kind: 'summary' } }, result_refs: [{ result_id: metadata.result_id, argument_pointer: '/source/evidence', result_pointer: '/structuredContent' }] });
      assert.notEqual(reused.isError, true, JSON.stringify(reused)); refs = true;
    }
  }
  await direct.connect(new sdk.StdioClientTransport({ command: sdk.command, args: sdk.args, env: { ...process.env }, stderr: 'inherit' }));
  const baseline = await direct.listTools();
  const originalChars = JSON.stringify(baseline.tools).length, lightChars = JSON.stringify(list.tools).length;
  read(await call('rea_call', { name: 'close_binary', arguments: {} }));
  const finalState = await call('rea_call', { name: 'binary_session', arguments: {} });
  assert.equal((await complete(finalState)).result.open, false);
  console.log(JSON.stringify({ original_tools: baseline.tools.length, light_tools: list.tools.length, original_chars: originalChars, light_chars: lightChars, reduction_percent: Number((100 * (1 - lightChars / originalChars)).toFixed(2)), active_target_retained: true, retained_evidence_reused: true, large_result_paging_or_refs: refs, analysis: 'synthetic JavaScript, no application execution' }, null, 2));
} finally {
  await direct.close().catch(() => {});
  await client.close().catch(() => {});
  await rm(root, { recursive: true, force: true });
}
