import { createGateway } from './gateway.mjs';
import { loadSdk } from './sdk.mjs';

const sdk = loadSdk();
const gateway = createGateway({ sdk });
let stopping = false;
async function stop() {
  if (stopping) return;
  stopping = true;
  const forced = setTimeout(() => process.exit(1), 5000);
  forced.unref();
  await gateway.backend.close().catch(() => {});
  await gateway.server.close().catch(() => {});
  clearTimeout(forced);
}
process.once('SIGINT', () => { void stop(); });
process.once('SIGTERM', () => { void stop(); });
process.stdin.once('end', () => { void stop(); });
gateway.server.server.onclose = () => { void stop(); };
await gateway.server.connect(new sdk.StdioServerTransport());
