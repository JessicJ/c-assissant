export interface PlanningMessageIdentity { messageId: string; expectedRevision: number; sessionId?: string }
type DraftStorage = Pick<Storage, "getItem" | "setItem" | "removeItem">;
export type PlanningDraftSignature = { raw: string; token: string };
type PendingMessage = { message: string; identity: PlanningMessageIdentity; draft?: PlanningDraftSignature };

function pendingMessages(storage: DraftStorage, key: string): PendingMessage[] {
  const raw = storage.getItem(key);
  if (raw === null) return [];
  try {
    const saved = JSON.parse(raw);
    if (!saved || typeof saved !== 'object' || Array.isArray(saved)) throw new Error();
    const entries = saved.version === 2 && Array.isArray(saved.pending) ? saved.pending
      : !('version' in saved) && !('pending' in saved) ? [saved] : null;
    if (!entries) throw new Error();
    if (!entries.length || !entries.every((entry: PendingMessage) => typeof entry?.message === "string" && entry.message.trim() && entry.message.trim().length <= 1500
      && typeof entry.identity?.messageId === "string" && entry.identity.messageId.trim() && entry.identity.messageId.length <= 128
      && Number.isSafeInteger(entry.identity.expectedRevision) && entry.identity.expectedRevision >= 0
      && (entry.draft === undefined || typeof entry.draft.raw === 'string' && entry.draft.raw.trim() === entry.message && entry.message === entry.message.trim() && typeof entry.draft.token === 'string' && !!entry.draft.token)
      && (entry.identity.sessionId === undefined || typeof entry.identity.sessionId === "string" && entry.identity.sessionId.trim() && entry.identity.sessionId.length <= 128))) throw new Error();
    if (new Set(entries.map((entry: PendingMessage) => entry.identity.messageId)).size !== entries.length) throw new Error();
    return entries;
  } catch { throw new Error("The pending save record could not be read. Keep your draft and restore the browser record before retrying."); }
}

/** 原草稿及编辑签名一同验证；部分写入必须阻断后续发送。 */
export function readPlanningDraftSignature(storage: DraftStorage, key: string): PlanningDraftSignature | null {
  const raw = storage.getItem(key), signature = storage.getItem(`${key}:edit`);
  if (raw === null && signature !== null) throw new Error('The draft is missing but its edit signature is still present.');
  if (raw === null || signature === null) return null;
  const value = JSON.parse(signature);
  if (!value || typeof value.raw !== 'string' || value.raw !== raw || typeof value.token !== 'string' || !value.token) throw new Error('The draft edit signature could not be verified.');
  return value;
}
export function persistPlanningDraft(storage: DraftStorage, key: string, raw: string, edited: boolean, uuid: () => string = () => crypto.randomUUID()): PlanningDraftSignature | null {
  if (!raw) { storage.removeItem(key); storage.removeItem(`${key}:edit`); return null; }
  if (!edited) {
    const existing = readPlanningDraftSignature(storage, key);
    if (existing?.raw === raw) return existing;
    if (storage.getItem(key) !== null) return null;
  }
  const value = { raw, token: uuid() };
  storage.setItem(`${key}:edit`, JSON.stringify(value)); storage.setItem(key, raw);
  const confirmed = readPlanningDraftSignature(storage, key);
  if (confirmed?.token !== value.token) throw new Error('The draft edit signature was not saved.');
  return value;
}

export function pendingPlanningMessage(storage: DraftStorage, key: string, sessionId?: string, message?: string): PendingMessage | undefined {
  return pendingMessages(storage, key).find((entry) => (entry.identity.sessionId === undefined || entry.identity.sessionId === sessionId) && (message === undefined || entry.message === message));
}

export function preparePlanningMessage(storage: DraftStorage, key: string, message: string, scope: { sessionId?: string; revision: number }, uuid: () => string = () => crypto.randomUUID(), draft?: PlanningDraftSignature): PlanningMessageIdentity {
  const pending = pendingMessages(storage, key);
  const saved = pending.find((entry) => entry.message === message && (entry.identity.sessionId === undefined || entry.identity.sessionId === scope.sessionId));
  if (saved) return saved.identity;
  const identity = { messageId: uuid(), expectedRevision: scope.revision, ...(scope.sessionId ? { sessionId: scope.sessionId } : {}) };
  // Persist before transmission. If unavailable, leave the editable draft unsent.
  storage.setItem(key, JSON.stringify({ version: 2, pending: [...pending, { message, identity, ...(draft ? { draft } : {}) }] }));
  return identity;
}

export function settlePlanningMessage(storage: DraftStorage, key: string, messageId: string) {
  const remaining = pendingMessages(storage, key).filter((entry) => entry.identity.messageId !== messageId);
  if (remaining.length) storage.setItem(key, JSON.stringify({ version: 2, pending: remaining }));
  else storage.removeItem(key);
}

export function forgetRejectedPlanningMessage(storage: DraftStorage, key: string, code: string, messageId?: string) {
  if (code === "planning_revision_conflict") {
    const rejected = messageId ?? pendingMessages(storage, key).at(-1)?.identity.messageId;
    if (rejected) settlePlanningMessage(storage, key, rejected);
  }
}

/** Copy before removing; preserve both drafts when the target already differs. */
export function migratePlanningDraft(storage: DraftStorage, from: string, to: string): string | undefined {
  const source = storage.getItem(from), target = storage.getItem(to);
  if (from === to) return target ?? undefined;
  const sourceSignature = readPlanningDraftSignature(storage, from), targetSignature = readPlanningDraftSignature(storage, to);
  if (target !== null) {
    if (source === target && sourceSignature && targetSignature && sourceSignature.token === targetSignature.token && sourceSignature.raw === targetSignature.raw) {
      storage.removeItem(from); storage.removeItem(`${from}:edit`);
    }
    return target;
  }
  if (source === null) return undefined;
  const signature = storage.getItem(`${from}:edit`);
  if (signature !== null) storage.setItem(`${to}:edit`, signature);
  storage.setItem(to, source);
  if (storage.getItem(to) === source && (signature === null || readPlanningDraftSignature(storage, to)?.token === sourceSignature?.token)) {
    storage.removeItem(from); if (signature !== null) storage.removeItem(`${from}:edit`);
  }
  return source;
}

/** A successful save is authoritative even when subsequent workspace refresh fails. */
export async function refreshAfterPlanningSave<T>(workspace: T, publish: (workspace: T) => Promise<void>): Promise<{ ok: true } | { ok: false; error: unknown }> {
  try { await publish(workspace); return { ok: true }; }
  catch (error) { return { ok: false, error }; }
}

/** Reconcile only an exact persisted message; never remove a newer editable draft. */
export function reconcileSavedPlanningMessage(storage: DraftStorage, key: string, draftKey: string,
  receipt: PlanningMessageIdentity & { sessionId: string; savedRevision: number }, savedMessage: { id: string; text: string } | undefined, preserveDraft = false): boolean {
  if (!savedMessage || savedMessage.id !== receipt.messageId) return false;
  const pending = pendingMessages(storage, key).find(entry => entry.identity.messageId === receipt.messageId
    && entry.identity.expectedRevision === receipt.expectedRevision
    && (entry.identity.sessionId === undefined || entry.identity.sessionId === receipt.sessionId)
    && entry.message === savedMessage.text);
  if (!pending) return false;
  const draft = storage.getItem(draftKey);
  if (!pending.draft) return false;
  const signature = readPlanningDraftSignature(storage, draftKey);
  if (!signature) return false;
  const sameEdit = signature.token === pending.draft.token && signature.raw === pending.draft.raw;
  const clearInput = !preserveDraft && sameEdit && draft === pending.draft.raw;
  if (clearInput) { storage.removeItem(draftKey); storage.removeItem(`${draftKey}:edit`); }
  if (clearInput || signature.token !== pending.draft.token) settlePlanningMessage(storage, key, receipt.messageId);
  return clearInput;
}
