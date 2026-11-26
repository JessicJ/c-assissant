import type { PlanningConversationRequest } from '@c-assistant/agent-adapters';
import type { PlanningSession } from '@c-assistant/core';
import type { AgentWork, SqliteWorkspaceStore } from '@c-assistant/storage';
import { AgentWorkError, workDigest } from '@c-assistant/storage';
import type { MahBusinessRuntimeAdapter } from './mah-business-runtime.js';
import { MahBusinessTaskReadbackError } from './mah-business-gateway.js';
import { applyAgentPlanningTurn, type PlanningTurnResult } from './planning-session.js';

type SavedMessage = ReturnType<SqliteWorkspaceStore['savePlanningMessage']>;
type Snapshot = { businessTime: string; request: PlanningConversationRequest & { session: PlanningSession } };
function failure(code: string): never { throw new AgentWorkError(code); }
const clean = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;

/** Inert until a caller supplies a verified MAH runtime. Production admission is
 * enforced by the route; this service never opens a DB, invokes CLI or enables it.
 * runtimeForWork must bind the Work's requestId AND carrierTaskId to its journal.
 */
export class MahPlanningConversationService {
  constructor(private readonly options: {
    store: SqliteWorkspaceStore;
    runtimeForWork: (work: AgentWork, readOnly?: boolean) => Pick<MahBusinessRuntimeAdapter, 'runWithWorkContext' | 'continuePlanningConversation'>;
  }) {}

  private readonly pending = new Map<string, ReturnType<MahPlanningConversationService['processSavedMessage']>>();

  continueSavedMessage(saved: SavedMessage, messageId: string, readOnly = false) {
    const key = JSON.stringify([saved.session.id, messageId, saved.savedRevision]);
    const current = this.pending.get(key);
    if (current) return current;
    const operation = this.processSavedMessage(saved, messageId, readOnly);
    this.pending.set(key, operation);
    void operation.finally(() => { if (this.pending.get(key) === operation) this.pending.delete(key); }).catch(() => {});
    return operation;
  }

  async waitForPendingRequests(): Promise<void> {
    await Promise.allSettled(this.pending.values());
  }

  private async processSavedMessage(saved: SavedMessage, messageId: string, readOnly: boolean) {
    const { store } = this.options;
    const scope = { kind: 'conversation' as const, sessionId: saved.session.id, messageId, revision: saved.savedRevision };
    const message = saved.session.messages.find(item => item.id === messageId && item.role === 'user');
    if (!message || saved.savedRevision < 1) failure('planning_saved_message_missing');
    let work = store.agentWork.findByScope(scope);
    if (work?.status === 'applied') return this.response(work, saved, true);
    this.assertCurrent(saved);
    if (saved.session.messages.at(-1)?.id !== messageId) failure('planning_revision_conflict');
    if (!work && readOnly) failure('planning_work_missing');
    if (!work) {
      const profile = store.getWorkspace().profile;
      const request: Snapshot['request'] = {
        message: message.text,
        session: { ...saved.session, messages: saved.session.messages.slice(0, -1) },
        profile: { assistantPersonality: profile.assistantPersonality ?? 'local_insider',
          displayName: profile.displayName, preferredLanguage: profile.preferredLanguage, nationality: profile.nationality,
          gender: profile.gender, immigrationStatus: profile.immigrationStatus }
      };
      work = store.agentWork.prepare(scope, clean({ businessTime: message.createdAt, request } satisfies Snapshot));
    }
    const frozen = work.input as Snapshot;
    // Legacy metadata-only blocked records are preserved, never rewritten into new requests.
    if (!frozen || typeof frozen.businessTime !== 'string' || !Number.isFinite(Date.parse(frozen.businessTime))
      || frozen.businessTime !== message.createdAt || frozen.request?.message !== message.text
      || !frozen.request.session || !frozen.request.profile
      || workDigest(frozen.request.session.messages) !== workDigest(saved.session.messages.slice(0, -1))) {
      failure('planning_work_snapshot_unavailable');
    }
    if (['cancel_requested','cancelled','superseded','expired','failed'].includes(work.status)) failure('planning_work_not_resumable');
    if (work.status !== 'validated') {
      if (work.status === 'blocked') work = store.agentWork.transition(work.workId, 'prepared');
      if (work.status === 'prepared') work = store.agentWork.transition(work.workId, 'submitting');
      const runtime = this.options.runtimeForWork(work, readOnly);
      let turn: Awaited<ReturnType<typeof runtime.continuePlanningConversation>>;
      try {
        turn = await runtime.runWithWorkContext({ requestId: work.requestId, operation: 'planning_conversation',
          businessTime: frozen.businessTime, scope: { kind: 'conversation', sessionId: scope.sessionId, requirementsVersion: scope.revision } },
        () => runtime.continuePlanningConversation(clean(frozen.request)));
      } catch (error) {
        // An unknown outcome is not permission to allocate another Task or retry submission.
        if (store.agentWork.get(work.workId)?.status === 'submitting') store.agentWork.transition(work.workId, 'submission_unknown');
        const observed = error instanceof MahBusinessTaskReadbackError
          ? [...error.observations].reverse().find(item => item.taskId === work!.carrierTaskId && item.projectMatched) : undefined;
        if (observed?.status === 'failed') {
          const current = store.agentWork.get(work.workId)!;
          if (['submitting', 'submission_unknown', 'queued', 'running'].includes(current.status)) store.agentWork.transition(work.workId, 'failed');
        }
        if (observed && ['queued', 'running', 'active'].includes(observed.status ?? '')) {
          const next = observed.status === 'queued' ? 'queued' : 'running';
          const current = store.agentWork.get(work.workId)!;
          if (current.status !== next && (next === 'running' || current.status !== 'running')
            && ['submitting', 'submission_unknown', 'queued'].includes(current.status)) {
            store.agentWork.transition(work.workId, next);
          }
        }
        throw error;
      }
      const latest = store.agentWork.get(work.workId)!;
      if (latest.status === 'applied') return this.response(latest, saved, true);
      if (latest.status !== 'validated') {
        const result = clean(applyAgentPlanningTurn(clean(frozen.request.session), message.text, turn, new Date(frozen.businessTime)));
        // The legacy helper appends a user message. Preserve the already-saved identity instead.
        result.session.messages[result.session.messages.length - 2] = clean(message);
        work = store.agentWork.transition(work.workId, 'completed');
        work = store.agentWork.validateResult(work.workId, { contractVersion: 1, workId: work.workId,
          requestId: work.requestId, carrierTaskId: work.carrierTaskId, inputSha256: work.inputSha256,
          scope: work.scope, payload: result }, value => this.checkedResult(value, saved, messageId, frozen));
      } else work = latest;
    }
    store.agentWork.applyValidated(work.workId, () => this.isCurrent(saved), (_db, value) => {
      const result = this.checkedResult(value, saved, messageId, frozen);
      store.savePlanningSession(result.session);
    });
    return this.response(store.agentWork.get(work.workId)!, saved, false);
  }

  private isCurrent(saved: SavedMessage): boolean {
    const { store } = this.options;
    const current = store.getPlanningSessionById(saved.session.id);
    return store.getPlanningSession()?.id === saved.session.id && current?.status === saved.session.status
      && store.getPlanningRevision(saved.session.id) === saved.savedRevision;
  }
  private assertCurrent(saved: SavedMessage): void {
    if (!this.isCurrent(saved)) failure('planning_revision_conflict');
  }
  private checkedResult(value: unknown, saved: SavedMessage, messageId: string, frozen: Snapshot): PlanningTurnResult {
    const result = value as PlanningTurnResult;
    if (!frozen?.request?.session || frozen.request.session.id !== saved.session.id
      || !Array.isArray(frozen.request.session.messages)) failure('planning_work_snapshot_unavailable');
    if (!result || typeof result.reply !== 'string' || !result.reply.trim() || result.session?.id !== saved.session.id
      || !Array.isArray(result.session.messages) || !Array.isArray(result.session.facts)
      || result.session.messages.length !== frozen.request.session.messages.length + 2
      || workDigest(result.session.messages.slice(0, -2)) !== workDigest(frozen.request.session.messages)
      || workDigest(result.session.messages.at(-2)) !== workDigest(saved.session.messages.find(item => item.id === messageId))
      || result.session.messages.filter(item => item.id === messageId && item.role === 'user').length !== 1
      || result.session.messages.at(-1)?.role !== 'assistant') failure('planning_work_result_invalid');
    return result;
  }
  private response(work: AgentWork, saved: SavedMessage, reused: boolean) {
    const { store } = this.options;
    const result = this.checkedResult(work.result, saved, (work.scope as { messageId: string }).messageId, work.input as Snapshot);
    const planningSession = store.getPlanningSessionById(saved.session.id)!;
    return { workspace: store.getWorkspace(), planningSession, planningStatus: planningSession.status,
      planningRevision: store.getPlanningRevision(saved.session.id), savedRevision: saved.savedRevision,
      reused, generated: false as const, blocked: false as const, reply: result.reply,
      ...(planningSession.proposal ? { proposal: planningSession.proposal } : {}) };
  }
}
