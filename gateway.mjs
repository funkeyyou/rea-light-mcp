import { randomUUID, createHash } from 'node:crypto';
import { mkdir, writeFile, readFile, lstat } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import { loadSdk } from './sdk.mjs';

export const VERSION = '1.0.0';
const INLINE_LIMIT = 24000;
const MAX_PAGE = 12000;
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const textResult = (value, isError = false) => ({ content: [{ type: 'text', text: JSON.stringify(value) }], ...(isError ? { isError: true } : {}) });
const digest = value => createHash('sha256').update(value).digest('hex');

function tokens(pointer) {
  if (pointer === '') return [];
  if (typeof pointer !== 'string' || !pointer.startsWith('/') || /~(?![01])/u.test(pointer)) throw new Error('Use an RFC 6901 JSON pointer, or an empty string for the root.');
  return pointer.slice(1).split('/').map(token => token.replaceAll('~1', '/').replaceAll('~0', '~'));
}

export function atPointer(value, pointer = '') {
  for (const key of tokens(pointer)) {
    if ((typeof value !== 'object' || value === null) || !Object.hasOwn(value, key)) throw new Error(`JSON pointer not found: ${pointer}`);
    value = value[key];
  }
  return value;
}

export function putPointer(value, pointer, replacement) {
  const keys = tokens(pointer);
  if (!keys.length) return replacement;
  let parent = value;
  for (const key of keys.slice(0, -1)) {
    if (!object(parent) && !Array.isArray(parent)) throw new Error(`Invalid argument pointer: ${pointer}`);
    if (!Object.hasOwn(parent, key)) Object.defineProperty(parent, key, { value: {}, enumerable: true, writable: true, configurable: true });
    parent = parent[key];
  }
  if (!object(parent) && !Array.isArray(parent)) throw new Error(`Invalid argument pointer: ${pointer}`);
  Object.defineProperty(parent, keys.at(-1), { value: structuredClone(replacement), enumerable: true, writable: true, configurable: true });
  return value;
}

function projection(result) {
  const sc = result.structuredContent;
  const evidence = object(sc?.result) && sc.result.evidence_id ? sc.result : sc;
  const normalized = evidence?.normalized_result;
  return {
    isError: result.isError === true,
    ...(evidence?.evidence_id ? { evidence_id: evidence.evidence_id } : {}),
    ...(evidence?.operation ? { operation: evidence.operation } : {}),
    ...(evidence?.subject ? { subject: evidence.subject } : {}),
    ...(evidence?.limitations ? { limitations: evidence.limitations } : {}),
    ...(normalized?.parent_evidence_id ? { parent_evidence_id: normalized.parent_evidence_id } : {}),
    ...(normalized?.summary ? { summary: normalized.summary } : {}),
    ...(normalized?.statistics ? { statistics: normalized.statistics } : {}),
    ...(normalized?.coverage ? { coverage: normalized.coverage } : {}),
    ...(evidence?.error ? { error: evidence.error } : {}),
    content: result.content?.filter(item => item.type === 'text').map(item => item.text.slice(0, 1200)).slice(0, 2),
  };
}

export class ResultStore {
  constructor(root, inlineLimit = INLINE_LIMIT) { this.root = resolve(root); this.inlineLimit = inlineLimit; }
  async init() { await mkdir(this.root, { recursive: true, mode: 0o700 }); }
  async save(result, kind = 'call') {
    const json = JSON.stringify(result);
    if (json.length <= this.inlineLimit) return result;
    await this.init();
    const resultId = randomUUID();
    const path = join(this.root, `${resultId}.json`);
    await writeFile(path, json, { mode: 0o600, flag: 'wx' });
    const metadata = { result_id: resultId, path, sha256: digest(json), kind, total_chars: json.length, inline: false, complete_on_disk: true };
    const images = [];
    for (const [index, block] of (result.content || []).entries()) {
      if (block.type === 'image' && block.data && ['image/png', 'image/jpeg', 'image/webp'].includes(block.mimeType)) {
        const ext = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp' }[block.mimeType];
        const imagePath = join(this.root, `${resultId}-${index}.${ext}`);
        await writeFile(imagePath, Buffer.from(block.data, 'base64'), { mode: 0o600, flag: 'wx' });
        images.push(imagePath);
      }
    }
    let summary = projection(result);
    if (JSON.stringify(summary).length > MAX_PAGE) summary = { isError: result.isError === true, summary_omitted: true };
    return textResult({ ...metadata, summary, ...(images.length ? { image_paths: images } : {}), next: 'Use rea_result for selected JSON pointers or pages. Use rea_call.result_refs to pass saved JSON directly into later REA calls without loading it into context.' }, result.isError === true);
  }
  async load(resultId) {
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u.test(resultId)) throw new Error('Invalid saved result ID.');
    const path = join(this.root, `${resultId}.json`);
    const stat = await lstat(path);
    if (!stat.isFile() || stat.isSymbolicLink()) throw new Error('Saved result must be a regular file.');
    return JSON.parse(await readFile(path, 'utf8'));
  }
  async page({ result_id, pointer = '', offset = 0, limit = 6000 }) {
    const value = atPointer(await this.load(result_id), pointer);
    const serialized = typeof value === 'string' ? value : JSON.stringify(value);
    // Pages always use characters; no implicit array sorting or omitted elements.
    const end = Math.min(serialized.length, offset + limit);
    return textResult({ result_id, pointer, representation: typeof value === 'string' ? 'text' : 'json', total_chars: serialized.length, offset, next_offset: end < serialized.length ? end : null, complete: offset === 0 && end === serialized.length, text: serialized.slice(offset, end) });
  }
}

export class ReaBackend {
  constructor(sdk, { command = sdk.command, args = sdk.args || ['mcp'], env = process.env } = {}) {
    this.sdk = sdk; this.command = command; this.args = args; this.env = env;
    this.ready = null; this.dead = false; this.closing = false; this.queue = Promise.resolve();
  }
  async connect() {
    if (this.dead) throw new Error('REA backend exited; its in-memory analysis state is unavailable. Restart this MCP connection and reopen the target or restore an exported snapshot. The failed operation was not retried.');
    if (!this.ready) this.ready = this.start();
    return this.ready;
  }
  async start() {
    this.client = new this.sdk.Client({ name: 'rea-light', version: VERSION }, { capabilities: {} });
    this.transport = new this.sdk.StdioClientTransport({ command: this.command, args: this.args, env: { ...this.env }, stderr: 'inherit', maxBufferSize: 64 * 1024 * 1024 });
    this.client.onclose = () => { if (!this.closing) this.dead = true; };
    try {
      await this.client.connect(this.transport, { timeout: 30000 });
      this.tools = (await this.client.listTools({}, { timeout: 30000 })).tools;
      this.catalog = new Map(this.tools.map(tool => [tool.name, tool]));
      return this;
    } catch (error) {
      this.dead = true;
      await this.client.close().catch(() => {});
      throw error;
    }
  }
  async catalogTool(name) {
    await this.connect();
    // Refresh on an unknown name; keep the same backend/session.
    if (!this.catalog.has(name)) {
      this.tools = (await this.client.listTools({}, { timeout: 30000, cacheMode: 'reload' })).tools;
      this.catalog = new Map(this.tools.map(tool => [tool.name, tool]));
    }
    const tool = this.catalog.get(name);
    if (!tool) throw new Error(`Unknown REA tool: ${name}. Search the installed catalog first.`);
    return tool;
  }
  async search({ query = '', offset = 0, limit = 6 }) {
    await this.connect();
    const words = query.toLowerCase().split(/[\s,/_-]+/u).filter(Boolean);
    const matches = this.tools.map(tool => {
      const name = tool.name.toLowerCase(); const description = (tool.description || '').toLowerCase();
      const score = words.reduce((total, word) => total + (name.includes(word) ? 5 : description.includes(word) ? 1 : 0), 0);
      return { tool, score };
    }).filter(row => words.length === 0 || row.score > 0).sort((a, b) => b.score - a.score || a.tool.name.localeCompare(b.tool.name));
    const end = Math.min(matches.length, offset + limit);
    return textResult({ query, total: matches.length, catalog_total: this.tools.length, offset, next_offset: end < matches.length ? end : null, tools: matches.slice(offset, end).map(({ tool }) => ({ name: tool.name, description: tool.description?.slice(0, 650), annotations: tool.annotations })), next: 'Read rea_schema for an exact tool name, then use rea_call. All installed REA tools remain callable.' });
  }
  async call(name, args, context, timeoutMs) {
    const operation = this.queue.then(async () => {
      context?.mcpReq?.signal?.throwIfAborted();
      const tool = await this.catalogTool(name);
      const progressToken = context?.mcpReq?._meta?.progressToken;
      return this.client.callTool({ name, arguments: args }, {
        toolDefinition: tool,
        timeout: timeoutMs, maxTotalTimeout: timeoutMs,
        signal: context?.mcpReq?.signal,
        ...(progressToken !== undefined ? { onprogress: progress => {
          void context.mcpReq.notify({ method: 'notifications/progress', params: { ...progress, progressToken } }).catch(() => {});
        } } : {}),
      });
    });
    this.queue = operation.catch(() => {});
    return operation;
  }
  async close() { this.closing = true; await this.client?.close(); }
}

export function createGateway({ sdk = loadSdk(), backend = new ReaBackend(sdk), root = process.env.REA_LIGHT_RESULTS_DIR || join(process.env.CODEX_HOME || join(homedir(), '.codex'), 'rea-light', 'results') } = {}) {
  const { McpServer, z } = sdk;
  const store = new ResultStore(root);
  const server = new McpServer({ name: 'rea-light', version: VERSION }, {
    instructions: 'REA reverse engineering with on-demand schemas. Search functionality using English keywords or use exact REA tool names from the skill. Read rea_schema before rea_call. One persistent backend retains target and Evidence state. Large results are complete on disk and can be paged or passed via result_refs. Errors, limitations and operation effects remain authoritative. Do not restart an in-memory analysis silently.',
  });
  const safe = handler => async (args, context) => {
    try { return await handler(args, context); }
    catch (error) { return textResult({ error: error.message, operation_retried: false }, true); }
  };
  const readOnly = { readOnlyHint: true, destructiveHint: false, openWorldHint: false };
  server.registerTool('rea_search', {
    description: 'Search all installed REA tools by English keywords (native, javascript, android, web, evidence). Returns brief descriptions, effects and exact names; no schemas.',
    annotations: readOnly,
    inputSchema: z.object({ query: z.string().default(''), offset: z.number().int().min(0).default(0), limit: z.number().int().min(1).max(15).default(6) }),
  }, safe(args => backend.search(args)));
  server.registerTool('rea_schema', {
    description: 'Get one REA tool description, annotations and complete input JSON Schema on demand. Output schemas stay server-side. Large schemas are saved and paged.',
    annotations: readOnly,
    inputSchema: z.object({ name: z.string().min(1) }),
  }, safe(async ({ name }) => {
    const tool = await backend.catalogTool(name);
    return store.save(textResult({ name, description: tool.description, annotations: tool.annotations, inputSchema: tool.inputSchema }), 'schema');
  }));
  server.registerTool('rea_call', {
    description: 'Call an exact REA tool with its schema-matching arguments. Can launch processes, use network, interact with UI or modify data: inspect rea_schema and respect user scope. Calls share persistent state and serialize; never auto-retry. result_refs inject saved JSON at argument pointers without putting full Evidence in context.',
    annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: true },
    inputSchema: z.object({
      name: z.string().min(1), arguments: z.record(z.string(), z.unknown()).default({}),
      timeout_ms: z.number().int().min(1000).max(3600000).default(600000),
      result_refs: z.array(z.object({ argument_pointer: z.string(), result_id: z.string(), result_pointer: z.string().default('/structuredContent') })).max(32).default([]),
    }),
  }, safe(async ({ name, arguments: args, result_refs, timeout_ms }, context) => {
    let resolved = structuredClone(args);
    for (const ref of result_refs) resolved = putPointer(resolved, ref.argument_pointer, atPointer(await store.load(ref.result_id), ref.result_pointer));
    if (!object(resolved)) throw new Error('Resolved arguments must be a JSON object.');
    return store.save(await backend.call(name, resolved, context, timeout_ms));
  }));
  server.registerTool('rea_result', {
    description: 'Read a saved complete result at an RFC 6901 JSON pointer. Pages use character offsets; next_offset=null ends the page sequence. A partial page is never complete Evidence. Paths point to original full JSON for offline use.',
    annotations: readOnly,
    inputSchema: z.object({ result_id: z.string(), pointer: z.string().default(''), offset: z.number().int().min(0).default(0), limit: z.number().int().min(1).max(MAX_PAGE).default(6000) }),
  }, safe(args => store.page(args)));
  return { server, backend, store };
}
