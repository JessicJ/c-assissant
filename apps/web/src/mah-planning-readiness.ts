import { getPlanningReturnCheck, type PlanningReturnBaseline } from './api-client.js';
export type { PlanningReturnBaseline } from './api-client.js';
export const MAH_SETUP_URL = 'https://mah.bot/docs';
export const MAH_STILL_BLOCKED = 'MAH configuration is unverified. Planning remains unavailable.';
const record = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
const integer = (v: unknown, min = 0): v is number => typeof v === 'number' && Number.isSafeInteger(v) && v >= min;
const fresh = (v: unknown, now: number): boolean => typeof v === 'string' && Number.isFinite(Date.parse(v)) && Date.parse(v) <= now && now - Date.parse(v) <= 60000;
const states = ['collecting','proposal_ready','proposal_confirmed','generating','draft_ready','failed','abandoned'];
export type Configuration = 'verified' | 'needs_setup' | 'unverified';
export type SessionCheck = { comparison: 'matched' | 'changed' | 'missing' | 'unverified'; status?: string };
export function parseMahConnection(v: unknown, now = Date.now()): Configuration {
  if (!record(v) || v.status !== 'blocked' || v.code !== 'public_mah_contract_unverified'
    || ['conversation','generation','revision','unattendedEmail','hosting'].some(k => v[k] !== false)) return 'unverified';
  const c = v.connection;
  if (!record(c) || c.selectionOwner !== 'mah' || c.executable !== false || !record(c.evidence)) return 'unverified';
  if (!['verified','needs_setup'].includes(String(c.configuration))) return 'unverified';
  const e = c.evidence;
  if (e.source !== 'mah_public_configuration' || e.protocol !== 1 || e.scopeVerified !== true || e.maxAgeMs !== 60000 || !fresh(e.observedAt, now)) return 'unverified';
  if (c.configuration === 'verified' && c.code === 'configuration_verified_execution_blocked') return 'verified';
  if (c.configuration === 'needs_setup' && c.code === 'configuration_requires_setup') return 'needs_setup';
  return 'unverified';
}
export function parsePlanningReturn(v: unknown, baseline: PlanningReturnBaseline, now = Date.now()): SessionCheck {
  const unknown: SessionCheck = { comparison: 'unverified' };
  if (!baseline.sessionId || !record(v) || v.schemaVersion !== 1 || v.executable !== false || v.sessionId !== baseline.sessionId || !fresh(v.observedAt, now)) return unknown;
  if (v.comparison === 'missing' && v.code === 'planning_session_missing' && v.snapshot === null) return { comparison: 'missing' };
  const s = v.snapshot;
  if (!record(s) || s.sessionId !== baseline.sessionId || s.revisionSource !== 'recorded' || !integer(s.revision)
    || !(s.proposalVersion === null || integer(s.proposalVersion, 1)) || !states.includes(String(s.status))
    || !(s.outputPlanId === null || typeof s.outputPlanId === 'string' && s.outputPlanId.length > 0)
    || typeof s.updatedAt !== 'string' || !Number.isFinite(Date.parse(s.updatedAt)) || Date.parse(s.updatedAt) > now
    || !integer(baseline.revision) || !(baseline.proposalVersion === null || integer(baseline.proposalVersion, 1))) return unknown;
  const matches = s.revision === baseline.revision && s.proposalVersion === baseline.proposalVersion;
  if (v.comparison === 'matched' && v.code === 'planning_versions_match' && matches) return { comparison: 'matched', status: String(s.status) };
  if (v.comparison === 'changed' && v.code === 'planning_versions_changed' && !matches) return { comparison: 'changed', status: String(s.status) };
  return unknown;
}
/** Two independent readbacks; no state application, submission or recovery. */
export async function checkMahPlanningReadiness(baseline: PlanningReturnBaseline = {}): Promise<{ executable: false; configuration: Configuration; session: SessionCheck; validUntil: number; message: string; submissionConfigured: boolean }> {
  const [connection, saved] = await Promise.all([
    fetch('/api/agent-readiness', { method: 'GET', cache: 'no-store', signal: AbortSignal.timeout(15000) })
      .then(response => response.ok ? response.json() as Promise<unknown> : null).catch(() => null),
    getPlanningReturnCheck(baseline).catch(() => null)
  ]);
  const configuration = parseMahConnection(connection);
  const submissionConfigured = record(connection) && connection.generation === false
    && record(connection.conversationSubmission) && connection.conversationSubmission.configured === true
    && connection.conversationSubmission.mode === 'read_only'
    && connection.conversationSubmission.preflight === 'required_per_request';
  const session = parsePlanningReturn(saved, baseline);
  const configMessage = submissionConfigured ? 'This workspace can submit saved requirements after a read-only MAH check. Full travel-plan generation remains unavailable.' : configuration === 'verified' ? 'MAH configuration is verified. Landi execution remains blocked.'
    : configuration === 'needs_setup' ? 'MAH setup is incomplete. Planning remains unavailable.' : MAH_STILL_BLOCKED;
  const sessionMessage = planningSessionCheckMessage(session);
  const observed = [record(connection) && record(connection.connection) && record(connection.connection.evidence) ? connection.connection.evidence.observedAt : null,
    record(saved) ? saved.observedAt : null].filter((value): value is string => typeof value === 'string' && fresh(value, Date.now()));
  const validUntil = Math.min(Date.now() + 60000, ...observed.map(value => Date.parse(value) + 60000));
  return { executable: false, configuration, session, validUntil, submissionConfigured, message: `${configMessage} ${sessionMessage}` };
}

export function planningSessionCheckMessage(session: SessionCheck): string {
  if (session.comparison === 'changed') return 'Saved planning has changed. Review the latest version before continuing. Your input is kept.';
  if (session.comparison === 'missing') return 'The original session was not found. Your input is kept; no replacement was created.';
  if (session.comparison !== 'matched') return 'The saved session could not be verified. Your input is kept.';
  if (['generating', 'proposal_confirmed'].includes(session.status ?? '')) return 'Your session is already in progress. Nothing was restarted.';
  if (session.status === 'draft_ready') return 'Your session already has a result. Nothing was regenerated.';
  if (session.status === 'abandoned') return 'Your session is closed. Nothing was reopened.';
  return 'The saved requirements match this session.';
}
