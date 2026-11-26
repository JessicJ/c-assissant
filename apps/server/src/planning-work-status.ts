import type { FastifyInstance } from 'fastify';
import type { SqliteWorkspaceStore } from '@c-assistant/storage';

/** Local evidence only. Reading a Work never submits, resumes or applies it. */
export function readPlanningWorkStatus(store: Pick<SqliteWorkspaceStore, 'getPlanningSessionById' | 'getPlanningRevision' | 'readPlanningMessageReceipt' | 'agentWork' | 'readPlanningMessageSaveStatus'>, sessionId: string, messageId: string) {
  const session = store.getPlanningSessionById(sessionId);
  if (!session) return null;
  if (!session.messages.some(message => message.id === messageId && message.role === 'user')) return null;
  const saveReceipt = store.readPlanningMessageReceipt(sessionId, messageId);
  const work = saveReceipt ? store.agentWork.findByScope({ kind: 'conversation', sessionId, messageId, revision: saveReceipt.savedRevision }) : undefined;
  return {
    schemaVersion: 1, sessionId, messageId, observedAt: new Date().toISOString(), executable: false,
    requirementsSaved: saveReceipt ? true : null, saveReceipt,
    planningRevision: store.getPlanningRevision(sessionId),
    localWork: work ? { workId: work.workId, requestId: work.requestId, taskId: work.carrierTaskId, status: work.status,
      savedRevision: saveReceipt!.savedRevision, resultApplied: work.status === 'applied' } : null,
    // Conversation queued/running is written only after this Task's public show
    // matched the canonical project. Preserve receipt history, without claiming
    // that this local read checked MAH's current execution state.
    mahStatus: { status: 'unverified', reason: 'not_queried',
      ...(work && ['queued', 'running'].includes(work.status) ? {
        received: true, taskId: work.carrierTaskId, source: 'public_task_show', lastObservedStatus: work.status
      } : {}) },
    code: !saveReceipt ? 'planning_save_receipt_missing' : !work ? 'planning_work_unrecorded' : 'planning_local_work_observed'
  };
}

export function registerPlanningWorkStatusRoute(server: FastifyInstance, store: Parameters<typeof readPlanningWorkStatus>[0]) {
  server.get<{ Params: { messageId: string }; Querystring: { expectedRevision?: string; inputSha256?: string; sessionId?: string } }>('/api/planning-messages/:messageId/status', async (request, reply) => {
    reply.header('Cache-Control', 'no-store');
    const { messageId } = request.params, { inputSha256, sessionId } = request.query;
    const expectedRevision = Number(request.query.expectedRevision);
    const validId = (value: string) => value.trim() && value.length <= 128 && !value.includes('\0');
    if (!validId(messageId) || (sessionId !== undefined && !validId(sessionId)) || !/^[0-9]+$/.test(request.query.expectedRevision ?? '')
      || !Number.isSafeInteger(expectedRevision) || !/^[a-f0-9]{64}$/.test(inputSha256 ?? '')) return reply.code(400).send({ code: 'planning_identity_invalid', executable: false });
    try {
      const status = store.readPlanningMessageSaveStatus({ messageId, expectedRevision, inputSha256: inputSha256!, ...(sessionId ? { sessionId } : {}) });
      if (!status) return reply.code(404).send({ code: 'planning_save_unverified', requirementsSaved: null, executable: false });
      return { schemaVersion: 1, messageId, sessionId: status.saveReceipt.sessionId, observedAt: new Date().toISOString(), requirementsSaved: true, executable: false, ...status };
    } catch {
      return reply.code(503).send({ code: 'planning_save_unverified', requirementsSaved: null, executable: false });
    }
  });
  server.get<{ Params: { sessionId: string; messageId: string } }>('/api/planning-sessions/:sessionId/messages/:messageId/status', async (request, reply) => {
    reply.header('Cache-Control', 'no-store');
    const { sessionId, messageId } = request.params;
    if (![sessionId, messageId].every(value => value.trim() && value.length <= 128 && !value.includes('\0'))) return reply.code(400).send({ code: 'planning_identity_invalid', executable: false });
    try {
      const status = readPlanningWorkStatus(store, sessionId, messageId);
      return status ?? reply.code(404).send({ code: 'planning_message_missing', executable: false });
    } catch {
      return reply.code(503).send({ code: 'planning_work_unverified', requirementsSaved: null, localWork: null,
        mahStatus: { status: 'unverified', reason: 'local_evidence_unavailable' }, executable: false });
    }
  });
}
