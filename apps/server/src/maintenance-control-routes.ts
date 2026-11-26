import { timingSafeEqual } from 'node:crypto';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import type { MaintenanceControl } from './maintenance-control.js';

/** Register before all business routes. No business database is used here. */
export function registerMaintenanceControl(server: FastifyInstance, control: MaintenanceControl, token: string) {
  if (token.length < 32) throw new Error('maintenance_token_too_short');
  const prefix = '/internal/maintenance/';
  const leases = new WeakMap<FastifyRequest, { finish: () => void; started: boolean; settled: boolean; ended: boolean }>();
  const finishIfSettled = (request: FastifyRequest) => {
    const lease = leases.get(request);
    if (lease?.ended && (!lease.started || lease.settled)) lease.finish();
  };
  control.cover('http');
  server.addHook('onRoute', route => {
    if (route.url === `${prefix}snapshot` || route.url === `${prefix}drain`) return;
    const handler = route.handler;
    route.handler = async function(request, reply) {
      const lease = leases.get(request);
      if (lease) lease.started = true;
      try { return await handler.call(this, request, reply); }
      finally { if (lease) lease.settled = true; finishIfSettled(request); }
    };
  });
  server.addHook('onRequest', async (request, reply) => {
    const path = request.url.split('?')[0];
    if (path === `${prefix}snapshot` || path === `${prefix}drain`) {
      const peer = request.raw.socket.remoteAddress;
      const supplied = request.headers.authorization ?? '';
      const expected = `Bearer ${token}`;
      const suppliedBytes = Buffer.from(supplied);
      const expectedBytes = Buffer.from(expected);
      const authorized = ['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(peer ?? '') &&
        request.headers['x-landi-instance-id'] === control.instanceId &&
        suppliedBytes.length === expectedBytes.length && timingSafeEqual(suppliedBytes, expectedBytes);
      reply.header('Cache-Control', 'no-store');
      if (!authorized) return reply.code(403).send({ code: 'maintenance_access_denied' });
      return;
    }
    if (!control.accepting()) return reply.code(503).send({ code: 'maintenance_admission_closed', executable: false });
    leases.set(request, { finish: control.begin('http'), started: false, settled: false, ended: false });
  });
  server.addHook('onResponse', async request => {
    const lease = leases.get(request); if (lease) lease.ended = true;
    finishIfSettled(request);
  });
  server.addHook('onRequestAbort', async request => {
    // A disconnected socket does not prove the handler or its writes stopped.
    control.markUncertain('request_aborted');
    const lease = leases.get(request); if (lease) lease.ended = true;
    finishIfSettled(request);
  });
  server.get(`${prefix}snapshot`, async () => control.snapshot());
  server.post<{ Body: { timeoutMs?: number } }>(`${prefix}drain`, async (request, reply) => {
    if (request.body && (typeof request.body !== 'object' || Array.isArray(request.body) || Object.keys(request.body).some(key => key !== 'timeoutMs'))) return reply.code(400).send({ code: 'maintenance_request_invalid' });
    try { return control.enterDrain(request.body?.timeoutMs); }
    catch { return reply.code(400).send({ code: 'maintenance_timeout_invalid' }); }
  });
}
