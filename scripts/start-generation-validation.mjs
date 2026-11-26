import { resolve } from 'node:path';
const [databasePath, sessionId, portText = '18787'] = process.argv.slice(2);
const port = Number(portText);
if (!databasePath || !sessionId || !Number.isSafeInteger(port) || port < 1024 || port > 65535) {
  throw new Error('Usage: node scripts/start-generation-validation.mjs <existing-synthetic-database> <saved-session-id> [port]');
}
const { startStandardServer } = await import('../apps/server/lib/standard-server-startup.js');
await startStandardServer(new URL('../apps/server/lib/index.js', import.meta.url).href,
  { databasePath: resolve(databasePath), sessionId, port });
