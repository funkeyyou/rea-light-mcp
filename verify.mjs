import { fileURLToPath } from 'node:url';
import { loadSdk } from './sdk.mjs';

const sdk = loadSdk();
const client = new sdk.Client({ name: 'rea-light-verify', version: '1.0.0' }, { capabilities: {} });
try {
  await client.connect(new sdk.StdioClientTransport({ command: process.execPath, args: [fileURLToPath(new URL('./server.mjs', import.meta.url))], env: { ...process.env }, stderr: 'inherit' }));
  const listing = await client.listTools();
  if (listing.tools.length !== 4) throw new Error('Expected exactly four gateway tools.');
  const result = await client.callTool({ name: 'rea_search', arguments: { query: 'binary_session', limit: 1 } }, { timeout: 30000 });
  if (result.isError) throw new Error(result.content[0].text);
  const catalog = JSON.parse(result.content[0].text);
  console.log(`REA Light verified: ${listing.tools.length} MCP tools; ${catalog.catalog_total} backend tools.`);
} catch (error) {
  console.error(`REA Light verification failed: ${error.message}`); process.exitCode = 1;
} finally { await client.close(); }
