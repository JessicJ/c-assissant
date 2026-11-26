import { workspaceMutationDigestInput } from "@c-assistant/core/workspace-mutation-error";
import type { DirectBlueprintReceipt, DirectBlueprintReceiptIdentity, DirectBlueprintRevisionBatchRequest } from "./api-client.js";
import { canonicalBookingRelationshipJson } from "@c-assistant/core/booking-relationship";
import type { BookingRelationshipReviewContext } from "./booking-relationship-review.js";

export const pendingBlueprintOperationKey = "landi:pending-blueprint-operation";
export const unknownBlueprintOperationMessage = "The previous operation is still unconfirmed. Your draft has been kept. Check the result first; if no acknowledgement is found, you can choose to resubmit the original operation.";
export type SubmittedDraft = { key: string; signature: string };
export type PendingBlueprintOperation = {
  identity: DirectBlueprintReceiptIdentity;
  body: DirectBlueprintRevisionBatchRequest | { expectedVersion: number; expectedBlueprintVersion: number; requestId: string };
  draft?: SubmittedDraft;
  committedRebase?: { revisionId: string; result: NonNullable<Extract<DirectBlueprintReceipt, {status: "committed"}>["originalResult"]>; signature: string };
  reviewRebase?: { draft: SubmittedDraft; blueprintId: string; sourceSetDigest: string; targetDigests: Record<string, string> };
};
export type RecoveryBinding = { schemaVersion: 1; draftDigest: string; seedDigest: string };
type StoragePort = Pick<Storage, "getItem" | "setItem" | "removeItem">;
export function readPendingBlueprintOperation(storage: StoragePort): PendingBlueprintOperation | null {
  const raw = storage.getItem(pendingBlueprintOperationKey);
  if (!raw) return null;
  const value = JSON.parse(raw) as PendingBlueprintOperation;
  const identity = value?.identity;
  if (!identity || !/^[a-f0-9]{64}$/.test(identity.requestDigest) || (identity.operation !== "save" && identity.operation !== "undo") || !identity.expectedPlanId || !identity.requestId || !Number.isSafeInteger(identity.expectedVersion) || !Number.isSafeInteger(identity.expectedBlueprintVersion) || (identity.operation === "undo" && !identity.revisionId) || value.body?.requestId !== identity.requestId || value.body.expectedVersion !== identity.expectedVersion || value.body.expectedBlueprintVersion !== identity.expectedBlueprintVersion || (identity.operation === "save" && !("revisions" in value.body && Array.isArray(value.body.revisions))) || (value.draft && (typeof value.draft.key !== "string" || typeof value.draft.signature !== "string"))) throw new Error("The original operation could not be read. Keep this page open and check the result.");
  if (value.reviewRebase) {
    const seed = value.reviewRebase;
    if (!seed.draft || typeof seed.draft.key !== "string" || typeof seed.draft.signature !== "string" || typeof seed.blueprintId !== "string" || !/^[a-f0-9]{64}$/.test(seed.sourceSetDigest) || !seed.targetDigests || typeof seed.targetDigests !== "object" || Object.values(seed.targetDigests).some((item) => typeof item !== "string" || !/^[a-f0-9]{64}$/.test(item))) throw new Error("The draft recovery information is incomplete. Keep your draft and review it again.");
    const body = value.body;
    if (!("revisions" in body) || body.revisions.length !== 1 || body.revisions[0]?.kind !== "review_booking_relationships") throw new Error("The draft recovery operation does not match.");
  }
  if (value.committedRebase && (!value.reviewRebase || typeof value.committedRebase.revisionId !== "string" || typeof value.committedRebase.signature !== "string" || !value.committedRebase.result)) throw new Error("The draft recovery stage is incomplete.");
  return value;
}
/** 网络写入前完成；不得替换尚未核对的原请求。 */
export function persistPendingBlueprintOperation(storage: StoragePort, operation: PendingBlueprintOperation): PendingBlueprintOperation {
  if (storage.getItem(pendingBlueprintOperationKey)) throw new Error("Check the previous operation result first.");
  const raw = JSON.stringify(operation);
  storage.setItem(pendingBlueprintOperationKey, raw);
  if (storage.getItem(pendingBlueprintOperationKey) !== raw) throw new Error("Recovery information could not be saved. Keep your draft before trying again.");
  return JSON.parse(raw) as PendingBlueprintOperation;
}
export function clearPendingBlueprintOperation(storage: StoragePort, operation: PendingBlueprintOperation): void {
  const current = readPendingBlueprintOperation(storage);
  if (current && JSON.stringify(current) === JSON.stringify(operation)) storage.removeItem(pendingBlueprintOperationKey);
}
/** 迟到回执只能清理精确提交的草稿，保留后续编辑。 */
export function acknowledgeBlueprintOperation(storage: StoragePort, operation: PendingBlueprintOperation): void {
  if (operation.draft && storage.getItem(operation.draft.key) === operation.draft.signature) storage.removeItem(operation.draft.key);
  clearPendingBlueprintOperation(storage, operation);
}
export function receiptMatchesOperation(receipt: DirectBlueprintReceipt, operation: PendingBlueprintOperation): boolean {
  return Object.entries(operation.identity).every(([key, value]) => receipt[key as keyof DirectBlueprintReceiptIdentity] === value);
}

/** 只在原审阅回执结果仍为当前工作区时重绑原草稿；签名、请求和全部源/目标语义都须相同。 */
export function rebaseReviewedBlueprintDraft(storage: StoragePort, operation: PendingBlueprintOperation, receipt: DirectBlueprintReceipt, context: BookingRelationshipReviewContext): SubmittedDraft | null {
  const seed = operation.reviewRebase;
  if (!seed || !receiptMatchesOperation(receipt, operation) || receipt.status !== "committed" || operation.identity.operation !== "save" || !("revisions" in operation.body)
    || operation.body.revisions.length !== 1 || operation.body.revisions[0]?.kind !== "review_booking_relationships" || !operation.body.recoveryBinding) return null;
  const result = receipt.originalResult, revision = receipt.revision, workspace = receipt.workspace;
  if (!result || !revision || !revision.id || revision.kinds.length !== 1 || revision.kinds[0] !== "review_booking_relationships"
    || revision.baseBlueprintVersion !== operation.identity.expectedBlueprintVersion || revision.appliedBlueprintVersion !== operation.identity.expectedBlueprintVersion + 1
    || canonicalBookingRelationshipJson(result.recoveryBinding) !== canonicalBookingRelationshipJson(operation.body.recoveryBinding)
    || result.revisionKinds.length !== 1 || result.revisionKinds[0] !== "review_booking_relationships"
    || result.blueprintId !== seed.blueprintId || result.blueprintVersion !== operation.identity.expectedBlueprintVersion + 1
    || workspace.activePlan?.id !== result.planId || workspace.activePlan.version !== result.planVersion
    || workspace.activeBlueprint?.id !== result.blueprintId || workspace.activeBlueprint.version !== result.blueprintVersion
    || context.expectedPlanId !== result.planId || context.expectedVersion !== result.planVersion || context.blueprintId !== result.blueprintId || context.blueprintVersion !== result.blueprintVersion
    || context.sourceIssues.length || result.sourceSetDigest !== seed.sourceSetDigest || context.sourceSetDigest !== seed.sourceSetDigest
    || canonicalBookingRelationshipJson(result.targetDigests) !== canonicalBookingRelationshipJson(seed.targetDigests)
    || canonicalBookingRelationshipJson(context.targetDigests) !== canonicalBookingRelationshipJson(seed.targetDigests)
) return null;
  const value = JSON.parse(seed.draft.signature);
  {
    if (!value || !Array.isArray(value.extra) || !value.binding || value.binding.planId !== operation.identity.expectedPlanId || value.binding.planVersion !== operation.identity.expectedVersion
      || value.binding.blueprintId !== seed.blueprintId || value.binding.blueprintVersion !== operation.identity.expectedBlueprintVersion
      || (value.draft && (value.draft.planId !== operation.identity.expectedPlanId || value.draft.version !== operation.identity.expectedVersion || !Array.isArray(value.draft.edits)))) return null;
    const edits = [...(value.draft?.edits ?? []), ...value.extra.map((item: {revision: unknown}) => item.revision)];
    if (!edits.length || edits.some((edit) => !edit || typeof edit !== "object" || ("dayId" in edit && !workspace.activeBlueprint!.days.some((day) => day.id === edit.dayId)) || ("placeId" in edit && !workspace.activeBlueprint!.places.some((place) => place.id === edit.placeId)))) return null;
    const next = { ...value, draft: value.draft ? { ...value.draft, planId: result.planId, version: result.planVersion } : null, binding: { planId: result.planId, planVersion: result.planVersion, blueprintId: result.blueprintId, blueprintVersion: result.blueprintVersion } };
    const signature = JSON.stringify(next);
    const marker = { revisionId: revision.id, result, signature };
    if (operation.committedRebase && canonicalBookingRelationshipJson(operation.committedRebase) !== canonicalBookingRelationshipJson(marker)) return null;
    const current = storage.getItem(seed.draft.key);
    if (current !== seed.draft.signature && current !== signature) return null;
    const persisted = readPendingBlueprintOperation(storage);
    if (!persisted || persisted.identity.requestDigest !== operation.identity.requestDigest) throw new Error("The original recovery record could not be verified.");
    const committed = { ...operation, committedRebase: marker };
    const raw = JSON.stringify(committed);
    storage.setItem(pendingBlueprintOperationKey, raw);
    if (storage.getItem(pendingBlueprintOperationKey) !== raw) throw new Error("The submitted recovery stage could not be saved.");
    operation.committedRebase = marker;
    storage.setItem(seed.draft.key, signature);
    if (storage.getItem(seed.draft.key) !== signature) throw new Error("The draft recovery information was not saved.");
    return { key: seed.draft.key, signature };
  }
}

export async function blueprintOperationDigest(operation: "save" | "undo", expectedPlanId: string, body: Record<string, unknown>): Promise<string> {
  const canonical = workspaceMutationDigestInput(operation, expectedPlanId, body);
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(canonical));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}
export async function validatePendingBlueprintOperation(operation: PendingBlueprintOperation): Promise<void> {
  if (operation.reviewRebase) {
    if (!("revisions" in operation.body) || canonicalBookingRelationshipJson(operation.body.recoveryBinding) !== canonicalBookingRelationshipJson(await reviewRecoveryBinding(operation.reviewRebase))) throw new Error("The original draft does not match the submitted recovery record. Keep your draft and review it again.");
  }
  const body = { ...operation.body, ...(operation.identity.operation === "undo" ? { revisionId: operation.identity.revisionId } : {}) };
  if (await blueprintOperationDigest(operation.identity.operation, operation.identity.expectedPlanId, body) !== operation.identity.requestDigest) throw new Error("The original request does not match its recovery identity. Keep your draft and check the result.");
}

async function recoveryDigest(value: unknown): Promise<string> {
  const bytes = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(canonicalBookingRelationshipJson(value)));
  return Array.from(new Uint8Array(bytes), (byte) => byte.toString(16).padStart(2, "0")).join("");
}
export async function reviewRecoveryBinding(seed: NonNullable<PendingBlueprintOperation["reviewRebase"]>): Promise<RecoveryBinding> {
  const draft = JSON.parse(seed.draft.signature);
  if (seed.draft.key !== `landi:pending-blueprint:blueprint:${seed.blueprintId}` || !draft?.binding || draft.binding.blueprintId !== seed.blueprintId || !Array.isArray(draft.extra) || (draft.draft && !Array.isArray(draft.draft.edits))) throw new Error("The original draft is incomplete.");
  return { schemaVersion: 1, draftDigest: await recoveryDigest(draft), seedDigest: await recoveryDigest(seed) };
}
