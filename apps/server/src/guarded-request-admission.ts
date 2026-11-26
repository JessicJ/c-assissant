import type { FastifyInstance } from 'fastify';

/** Exact route templates: new routes are blocked until their side effects are reviewed. */
export function registerGuardedRequestAdmission(server: FastifyInstance): void {
  const reads = new Set(['/', '/health', '/assets/*', '/trip-map/*', '/api/workspace', '/api/plans/history', '/api/maintenance', '/api/configuration', '/api/email-execution', '/api/agent-readiness',
    '/api/planning-messages/:messageId/status', '/api/planning-sessions/:sessionId/messages/:messageId/status', '/api/planning-sessions/:sessionId', '/api/planning-sessions/:sessionId/revision', '/api/planning-sessions/:sessionId/return-check', '/api/planning-sessions/:sessionId/generation', '/api/bookings',
    '/api/runs', '/api/runs/task-reminders', '/api/runs/plan-compilations', '/api/runs/preparation-evidence']);
  server.addHook('preHandler', async (request, reply) => {
    reply.header('Cache-Control', 'no-store');
    const route = request.routeOptions.url;
    if ((request.method === 'GET' || request.method === 'HEAD') && route && reads.has(route)) return;
    if (request.method === 'POST' && route === '/api/agent/chat' && request.body && typeof request.body === 'object' && (request.body as Record<string, unknown>).mode === 'new_plan') return;
    return reply.code(503).send({ code: 'guarded_operation_blocked', error: 'This controlled instance allows local review and requirement saving only.', executable: false });
  });
}
