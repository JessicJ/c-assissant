import { getPlanningGenerationAdmission } from './api-client.js';

/** A short-lived application admission observation, scoped to saved requirements. */
export type PlanningContinuationScope = { sessionId: string; revision: number; proposalVersion: number };
export type PlanningContinuationObservation = PlanningContinuationScope & { ready: boolean; validUntil: number };
export type PlanningContinuationPort = { read: (scope: PlanningContinuationScope) => Promise<PlanningContinuationObservation> };
const continuationPorts = new WeakSet<object>();
/** Normal application port always reads admission from the server. */
export const serverPlanningContinuation: PlanningContinuationPort = Object.freeze({ read: getPlanningGenerationAdmission });
continuationPorts.add(serverPlanningContinuation);
/** Explicit dependency for isolated development only; not deserializable from HTTP or settings. */
export function createIsolatedPlanningContinuation(read: PlanningContinuationPort['read']): PlanningContinuationPort {
  const port = Object.freeze({ read }); continuationPorts.add(port); return port;
}
export async function readPlanningContinuation(port: PlanningContinuationPort | undefined, scope: PlanningContinuationScope, now = Date.now()) {
  if (!port || !continuationPorts.has(port)) return null;
  try {
    const observed = await port.read(Object.freeze({ ...scope }));
    if (!observed || observed.ready !== true || observed.sessionId !== scope.sessionId
      || observed.revision !== scope.revision || observed.proposalVersion !== scope.proposalVersion
      || !Number.isFinite(observed.validUntil) || observed.validUntil <= Date.now()
      || observed.validUntil > now + 30000) return null;
    return { validUntil: observed.validUntil };
  } catch { return null; }
}
