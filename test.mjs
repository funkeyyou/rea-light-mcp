import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, readFile, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { loadSdk } from './sdk.mjs';
import { ResultStore, ReaBackend, atPointer, putPointer, createGateway } from './gateway.mjs';

const sdk = loadSdk();
const decode = result => JSON.parse(result.content[0].text);
async function temp(t) {
  const path = await mkdtemp(join(tmpdir(), 'rea-light-test-'));
  t.after(() => rm(path, { recursive: true, force: true }));
  return path;
}
async function linked(t, backend) {
  const root = await temp(t);
  const g = createGateway({ sdk, backend, root });
  const client = new sdk.Client({ name: 'rea-light-test', version: '1' }, { capabilities: {} });
  const [ct, st] = sdk.InMemoryTransport.createLinkedPair();
  await g.server.connect(st); await client.connect(ct);
  t.after(async () => { await client.close(); await g.server.close(); });
  return { client, g, root };
}

test('small results preserve upstream content, structured data and error status exactly', async t => {
  const store = new ResultStore(await temp(t));
  for (const isError of [false, true]) {
    const result = { content: [{ type: 'text', text: '原始結果' }], structuredContent: { result: [1, 2], unknown: null }, isError };
    assert.strictEqual(await store.save(result), result);
  }
});

test('large Evidence is stored completely with hash and owner-only permissions; paging is exact', async t => {
  const store = new ResultStore(await temp(t));
  const evidence = { evidence_id: 'test-evidence', operation: 'fixture', normalized_result: { text: '繁體中文🎉'.repeat(9000) }, limitations: ['fixture'] };
  const original = { content: [{ type: 'text', text: JSON.stringify(evidence) }], structuredContent: evidence };
  const saved = decode(await store.save(original));
  assert.equal(saved.complete_on_disk, true); assert.equal(saved.inline, false);
  assert.deepEqual(JSON.parse(await readFile(saved.path, 'utf8')), original);
  assert.deepEqual(await store.load(saved.result_id), original);
  if (process.platform !== 'win32') assert.equal((await stat(saved.path)).mode & 0o777, 0o600);
  let offset = 0, recovered = '';
  do {
    const page = decode(await store.page({ result_id: saved.result_id, pointer: '/structuredContent/normalized_result/text', offset, limit: 5999 }));
    recovered += page.text; offset = page.next_offset;
  } while (offset !== null);
  assert.equal(recovered, evidence.normalized_result.text);
});

test('large failures stay failures and image bytes are preserved', async t => {
  const store = new ResultStore(await temp(t), 100);
  const image = Buffer.from([137, 80, 78, 71]);
  const result = { isError: true, content: [{ type: 'image', mimeType: 'image/png', data: image.toString('base64') }, { type: 'text', text: 'failure'.repeat(80) }] };
  const reply = await store.save(result);
  assert.equal(reply.isError, true);
  const metadata = decode(reply);
  assert.deepEqual(await readFile(metadata.image_paths[0]), image);
  assert.deepEqual(await store.load(metadata.result_id), result);
});

test('saved-result paths and JSON pointers cannot escape the result store or pollute prototypes', async t => {
  const store = new ResultStore(await temp(t));
  await assert.rejects(store.load('../../config.toml'), /Invalid saved result/);
  assert.throws(() => atPointer({}, '/toString'), /not found/);
  assert.throws(() => atPointer({}, '/bad~x'), /RFC 6901/);
  assert.equal(atPointer({ 'a/b': { '~': 3 } }, '/a~1b/~0'), 3);
  const result = putPointer({}, '/__proto__/polluted', true);
  assert.equal({}.polluted, undefined); assert.equal(result.__proto__.polluted, true);
});

test('only four lightweight tools are exposed and unknown/invalid calls fail before execution', async t => {
  let called = 0;
  const backend = {
    search: async () => ({ content: [{ type: 'text', text: '{}' }] }),
    catalogTool: async name => { throw new Error(`Unknown REA tool: ${name}`); },
    call: async () => { called++; return { content: [] }; },
  };
  const { client } = await linked(t, backend);
  const listing = await client.listTools();
  assert.equal(listing.tools.length, 4);
  assert.ok(JSON.stringify(listing.tools).length < 4000);
  assert.ok(listing.tools.every(tool => !tool.outputSchema));
  assert.equal(listing.tools.find(t => t.name === 'rea_call').annotations.destructiveHint, true);
  const response = await client.callTool({ name: 'rea_schema', arguments: { name: 'missing' } });
  assert.equal(response.isError, true); assert.equal(called, 0);
  const invalid = await client.callTool({ name: 'rea_result', arguments: { result_id: 'x', offset: -1 } });
  assert.equal(invalid.isError, true);
});

test('saved full JSON can become downstream Evidence without reading it into the client context', async t => {
  let received;
  const backend = { call: async (name, args) => { received = { name, args }; return { content: [{ type: 'text', text: 'ok' }] }; } };
  const { client, g } = await linked(t, backend);
  const evidence = { evidence_id: 'fixture-evidence', normalized_result: { text: 'x'.repeat(40000) } };
  const metadata = decode(await g.store.save({ content: [], structuredContent: evidence }));
  await client.callTool({ name: 'rea_call', arguments: { name: 'inspect_analysis_view', arguments: { source: { kind: 'inline' }, view: { kind: 'summary' } }, result_refs: [{ result_id: metadata.result_id, argument_pointer: '/source/evidence' }] } });
  assert.deepEqual(received.args.source.evidence, evidence);
  assert.deepEqual(received.args.view, { kind: 'summary' });
});

test('backend connects once, serializes stateful operations and preserves progress notifications', async () => {
  let connects = 0, inFlight = 0, peak = 0, calls = 0;
  class Client {
    async connect() { connects++; }
    async listTools() { return { tools: [{ name: 'fixture', inputSchema: { type: 'object' } }] }; }
    async callTool(params, options) {
      calls++; inFlight++; peak = Math.max(peak, inFlight);
      options.onprogress?.({ progress: calls, total: 2 });
      await new Promise(resolve => setTimeout(resolve, 20)); inFlight--;
      return { content: [{ type: 'text', text: String(params.arguments.value) }] };
    }
    async close() {}
  }
  const backend = new ReaBackend({ Client, StdioClientTransport: class {}, command: 'mock' });
  const notifications = [];
  const context = { mcpReq: { _meta: { progressToken: 'client-token' }, notify: async n => notifications.push(n) } };
  const result = await Promise.all([backend.call('fixture', { value: 1 }, context, 1000), backend.call('fixture', { value: 2 }, context, 1000)]);
  assert.equal(connects, 1); assert.equal(peak, 1); assert.equal(calls, 2);
  assert.deepEqual(result.map(r => r.content[0].text), ['1', '2']);
  assert.equal(notifications.length, 2); assert.equal(notifications[0].params.progressToken, 'client-token');
  await backend.close();
});

test('backend loss fails without retry or silently replacing the analysis session', async () => {
  let connects = 0, calls = 0;
  class Client {
    async connect() { connects++; }
    async listTools() { return { tools: [{ name: 'fixture' }] }; }
    async callTool() { calls++; return { content: [] }; }
    async close() {}
  }
  const backend = new ReaBackend({ Client, StdioClientTransport: class {}, command: 'mock' });
  await backend.call('fixture', {}, undefined, 1000);
  backend.client.onclose();
  await assert.rejects(backend.call('fixture', {}, undefined, 1000), /in-memory analysis state/);
  assert.equal(connects, 1); assert.equal(calls, 1);
});

test('cancelled queued operation never executes; active cancellation signal reaches the backend', async () => {
  const controller = new AbortController(); let calls = 0, observed;
  class Client {
    async connect() {}
    async listTools() { return { tools: [{ name: 'fixture' }] }; }
    async callTool(params, options) { calls++; observed = options.signal; return { content: [] }; }
    async close() {}
  }
  const backend = new ReaBackend({ Client, StdioClientTransport: class {}, command: 'mock' });
  await backend.call('fixture', {}, { mcpReq: { signal: controller.signal } }, 1000);
  assert.strictEqual(observed, controller.signal);
  controller.abort();
  await assert.rejects(backend.call('fixture', {}, { mcpReq: { signal: controller.signal } }, 1000), /abort/iu);
  assert.equal(calls, 1);
});
