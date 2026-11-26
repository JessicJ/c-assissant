import type { FastifyInstance } from "fastify";
export interface PlanningReturnSnapshot {
  sessionId: string; revision: number | null; revisionSource: 'recorded' | 'missing';
  proposalVersion: number | null; status: string; outputPlanId: string | null; updatedAt: string;
}
const states = new Set(['collecting','proposal_ready','proposal_confirmed','generating','draft_ready','failed','abandoned']);
/** Comparison only; does not import, refresh, resume or repair any state. */
export function comparePlanningReturn(sessionId: string, snapshot: PlanningReturnSnapshot | null, query: { expectedRevision?: unknown; expectedProposalVersion?: unknown }, now = Date.now()) {
  const base = { schemaVersion: 1 as const, sessionId, observedAt: new Date(now).toISOString(), executable: false as const, snapshot };
  const result = (comparison: 'matched' | 'changed' | 'missing' | 'unverified', code: string) => ({ ...base, comparison, code });
  if (!snapshot) return result('missing','planning_session_missing');
  if (snapshot.sessionId !== sessionId || !states.has(snapshot.status) || !Number.isFinite(Date.parse(snapshot.updatedAt)) || Date.parse(snapshot.updatedAt) > now
    || !(snapshot.proposalVersion === null || Number.isSafeInteger(snapshot.proposalVersion) && snapshot.proposalVersion >= 1)
    || !(snapshot.outputPlanId === null || typeof snapshot.outputPlanId === 'string' && snapshot.outputPlanId.length > 0)) return result('unverified','planning_snapshot_invalid');
  if (snapshot.revisionSource !== 'recorded' || !Number.isSafeInteger(snapshot.revision) || snapshot.revision! < 0) return result('unverified','planning_revision_unrecorded');
  if (typeof query.expectedRevision !== 'string' || !/^(0|[1-9]\d*)$/.test(query.expectedRevision) || !Number.isSafeInteger(Number(query.expectedRevision))
    || typeof query.expectedProposalVersion !== 'string' || !(query.expectedProposalVersion === 'none' || /^[1-9]\d*$/.test(query.expectedProposalVersion) && Number.isSafeInteger(Number(query.expectedProposalVersion)))) return result('unverified','planning_baseline_missing');
  const proposalVersion = query.expectedProposalVersion === 'none' ? null : Number(query.expectedProposalVersion);
  return snapshot.revision === Number(query.expectedRevision) && snapshot.proposalVersion === proposalVersion
    ? result('matched','planning_versions_match') : result('changed','planning_versions_changed');
}

export function registerPlanningReturnCheckRoute(server: FastifyInstance, store: { readPlanningReturnSnapshot(sessionId: string): PlanningReturnSnapshot | null }) {
  server.get<{ Params: { sessionId: string }; Querystring: { expectedRevision?: string; expectedProposalVersion?: string } }>("/api/planning-sessions/:sessionId/return-check", async (request, reply) => {
    reply.header("Cache-Control", "no-store");
    try {
      return comparePlanningReturn(request.params.sessionId, store.readPlanningReturnSnapshot(request.params.sessionId), request.query);
    } catch {
      return { schemaVersion: 1, sessionId: request.params.sessionId, observedAt: new Date().toISOString(), executable: false, snapshot: null, comparison: "unverified", code: "planning_snapshot_unavailable" };
    }
  });
}
