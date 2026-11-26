export interface PlanningSaveReceipt { sessionId: string; messageId: string; expectedRevision: number; savedRevision: number }
const record = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value);
export const unverifiedPlanningWork = 'Saved requirements and task status could not be verified.';
export const savedProcessingUnverified = 'Requirements saved. Latest task status is unverified.';

export function checkedPlanningSaveReceipt(value: unknown, identity: { messageId?: string; expectedRevision?: number; sessionId?: string }): PlanningSaveReceipt | null {
  if (!record(value) || typeof value.sessionId !== 'string' || !value.sessionId.trim() || value.sessionId.length > 128
    || value.messageId !== identity.messageId || value.expectedRevision !== identity.expectedRevision
    || !Number.isSafeInteger(value.expectedRevision) || Number(value.expectedRevision) < 0
    || !Number.isSafeInteger(value.savedRevision) || Number(value.savedRevision) !== Number(value.expectedRevision) + 1
    || (identity.sessionId !== undefined && value.sessionId !== identity.sessionId)) return null;
  return { sessionId: value.sessionId, messageId: identity.messageId!, expectedRevision: Number(value.expectedRevision), savedRevision: Number(value.savedRevision) };
}

/** Local records do not prove MAH's current execution or final acceptance. */
export function planningWorkNotice(value: unknown, scope: { sessionId: string; messageId: string }, now = Date.now()): string | null {
  const saved = checkedPlanningWorkSave(value, scope, now);
  if (!saved || !record(value)) return unverifiedPlanningWork;
  const receipt = saved.receipt;
  if (value.localWork === null) return 'Requirements saved. No processing task is recorded.';
  const work = value.localWork;
  if (!record(work) || !['workId', 'requestId', 'taskId'].every(key => typeof work[key] === 'string' && !!work[key])
    || work.savedRevision !== receipt.savedRevision) return savedProcessingUnverified;
  if (work.status === 'applied' && work.resultApplied === true) return null;
  if (work.resultApplied !== false) return savedProcessingUnverified;
  const mah = value.mahStatus;
  if (record(mah) && mah.status === 'unverified' && mah.reason === 'not_queried'
    && mah.received === true && mah.taskId === work.taskId && mah.source === 'public_task_show'
    && mah.lastObservedStatus === work.status && ['queued', 'running'].includes(String(work.status))) {
    return work.status === 'running'
      ? 'Requirements saved. MAH received this request and was processing it at the last check. Check the planning result for an update.'
      : 'Requirements saved. MAH received this request and was waiting to process it at the last check. Check the planning result for an update.';
  }
  if (work.status === 'blocked') return 'Requirements saved. MAH integration is not ready.';
  if (work.status === 'failed') return 'Requirements saved. Processing did not finish.';
  if (['cancelled', 'superseded', 'expired'].includes(String(work.status))) return 'Requirements saved. This processing attempt is no longer active.';
  if (['completed', 'validated'].includes(String(work.status))) return 'Requirements saved. The reply has not been added to this conversation.';
  return savedProcessingUnverified;
}

/** Only fresh, bound server save evidence may reconcile a browser pending record. */
export function checkedPlanningWorkSave(value: unknown, scope: { sessionId: string; messageId: string }, now = Date.now()): { receipt: PlanningSaveReceipt; planningRevision: number } | null {
  if (!record(value) || value.schemaVersion !== 1 || value.executable !== false || value.sessionId !== scope.sessionId || value.messageId !== scope.messageId
    || typeof value.observedAt !== 'string' || !Number.isFinite(Date.parse(value.observedAt))
    || Date.parse(value.observedAt) > now || now - Date.parse(value.observedAt) > 60_000
    || value.requirementsSaved !== true || !record(value.saveReceipt)) return null;
  const receipt = checkedPlanningSaveReceipt(value.saveReceipt, { ...scope, expectedRevision: Number(value.saveReceipt.expectedRevision) });
  if (!receipt || !Number.isSafeInteger(value.planningRevision) || Number(value.planningRevision) < receipt.savedRevision) return null;
  return { receipt, planningRevision: Number(value.planningRevision) };
}

export type SubmittedPlanningNotice = { sessionId: string; messageId: string; text: string; verified: boolean };
/** Weak observations cannot replace a checked save for the same submitted message. */
export function mergeSubmittedPlanningNotice(current: SubmittedPlanningNotice | null, next: SubmittedPlanningNotice): SubmittedPlanningNotice {
  return current?.sessionId === next.sessionId && current.messageId === next.messageId && current.verified && !next.verified ? current : next;
}
