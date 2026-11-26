import type { FastifyInstance } from 'fastify';
import { assessMahConnection } from './mah-connection-diagnostic.js';
import { buildMahReadinessReport } from './mah-readiness-report.js';
import { productionReadiness } from './production-readiness.js';
export function registerMahReadinessRoute(server: FastifyInstance, getDiagnostics?: () => Promise<Omit<ReturnType<typeof buildMahReadinessReport>, 'evidenceMode'> & { evidenceMode: string }>, conversationSubmissionConfigured = false) {
  server.get('/api/agent-readiness', async (_request, reply) => {
    reply.header('Cache-Control', 'no-store');
    const diagnostics = getDiagnostics ? await getDiagnostics() : buildMahReadinessReport();
    return { ...productionReadiness(),
      ...(conversationSubmissionConfigured ? { conversationSubmission: { configured: true, mode: 'read_only', preflight: 'required_per_request' } } : {}),
      diagnostics, connection: diagnostics.connection ?? assessMahConnection() };
  });
}
