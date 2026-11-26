import Fastify from 'fastify';
import { randomUUID, timingSafeEqual } from 'node:crypto';
import { openReadonlyPlanningStore } from '@c-assistant/storage/readonly-planning-store';
import { registerMahReadinessRoute } from './mah-readiness-route.js';
import { registerPlanningReturnCheckRoute } from './planning-return-check.js';
import { readonlyDiagnosticConfig } from './readonly-diagnostic-policy.js';
export { readonlyDiagnosticConfig } from './readonly-diagnostic-policy.js';

/** No listen, timers, signal handlers or CLI queries until explicitly started by the entry point. */
export function createReadonlyDiagnosticServer(environment: NodeJS.ProcessEnv) {
  const config = readonlyDiagnosticConfig(environment);
  const store = openReadonlyPlanningStore(config.databasePath, config.admissionPath, config.admissionSha256);
  const instanceId = randomUUID();
  const server = Fastify({ logger: false, exposeHeadRoutes: false });
  try {
    server.addHook('onRequest', async (request, reply) => {
      reply.header('Cache-Control', 'no-store');
      const given = Buffer.from(request.headers.authorization ?? '');
      const expected = Buffer.from(`Bearer ${config.token}`);
      if (!['127.0.0.1','::1','::ffff:127.0.0.1'].includes(request.raw.socket.remoteAddress ?? '') || request.headers['x-landi-instance-id'] !== instanceId || given.length !== expected.length || !timingSafeEqual(given, expected)) return reply.code(403).send({ code: 'readonly_diagnostic_access_denied', executable: false });
      const path = request.url.split('?')[0];
      if (request.method !== 'GET' || !(path === '/api/agent-readiness' || /^\/api\/planning-sessions\/[^/]+\/return-check$/.test(path ?? ''))) return reply.code(503).send({ code: 'readonly_diagnostic_operation_blocked', executable: false });
    });
    server.addHook('onSend', async (_request, reply, payload) => {
      if (reply.statusCode === 200 && typeof payload === 'string') return JSON.stringify({ ...JSON.parse(payload), provenance: store.provenance, executable: false });
      return payload;
    });
    registerMahReadinessRoute(server);
    registerPlanningReturnCheckRoute(server, store);
    server.addHook('onClose', async () => { store.close(); });
    return { server, instanceId, provenance: store.provenance };
  } catch (error) { store.close(); throw error; }
}

export async function startReadonlyDiagnostics(environment: NodeJS.ProcessEnv) {
  const config = readonlyDiagnosticConfig(environment);
  const { server, instanceId } = createReadonlyDiagnosticServer(environment);
  const handlers = new Map<NodeJS.Signals, () => void>();
  server.addHook('onClose', async () => {
    for (const [signal, handler] of handlers) process.off(signal, handler);
  });
  try { await server.listen({ port: config.port, host: config.host }); }
  catch (error) { await server.close(); throw error; }
  process.stdout.write(`${JSON.stringify({ mode: 'readonly-diagnostics', instanceId, origin: `http://127.0.0.1:${config.port}`, executable: false })}\n`);
  for (const signal of ['SIGINT','SIGTERM'] as const) {
    const handler = () => { void server.close().catch(() => { process.exitCode = 1; }); };
    handlers.set(signal, handler); process.once(signal, handler);
  }
  return server;
}
