import type { WorkspaceSnapshot } from "@c-assistant/core";
import { bookingRelationshipDigest, canonicalBookingRelationshipJson } from "@c-assistant/core/booking-relationship";
import type { BookingImportBaseline, BookingImportConfirmBody, BookingScope } from "./api-client.js";
import { isMutationWorkspace } from "./api-client.js";

export const bookingImportRecoveryKey = "landi:pending-booking-import";
export type BookingImportIdentity = { operation: "import_booking"; targetKind: "plan" | "session" | "current_session"; targetId: string; expectedVersion?: number; expectedBlueprintVersion?: number; expectedRevision?: number; expectedSessionId?: string | null; expectedSourceSetDigest?: string; expectedRecordDigest?: string; bookingId: string };
/** 普通恢复存储只保存安全身份和摘要；私密原文与完整 booking 仅留内存。 */
export type BookingImportRecovery = { requestId: string; requestDigest: string; identity: BookingImportIdentity; scope: BookingScope };
export type BookingImportReceipt = { requestId: string; requestDigest: string; status: "not_found" } | { requestId: string; requestDigest: string; status: "committed"; originalRequest: BookingImportIdentity; originalResult: { originalRequest: BookingImportIdentity; bookingId: string; planId?: string; planVersion?: number; blueprintId?: string; blueprintVersion?: number; sessionId?: string; revision?: number }; workspace: WorkspaceSnapshot };
type StoragePort = Pick<Storage, "getItem" | "setItem" | "removeItem">;
export function frozenBookingImport(baseline: BookingImportBaseline, booking: BookingImportConfirmBody["booking"], sourceContent: string): { recovery: BookingImportRecovery; body: BookingImportConfirmBody } {
  const { scope, records, bookings: _bookings, ...versions } = baseline;
  const record = records.find((item) => item.bookingId === booking.id);
  const body: BookingImportConfirmBody = structuredClone({ ...versions, requestId: crypto.randomUUID(), booking, sourceContent, ...(record ? { expectedRecordDigest: record.recordDigest } : {}) });
  const targetId = scope.type === "plan" ? scope.planId : scope.sessionId ?? "current";
  const identity: BookingImportIdentity = { operation: "import_booking", targetKind: scope.type === "plan" ? "plan" : scope.sessionId ? "session" : "current_session", targetId, ...versions, ...(record ? { expectedRecordDigest: record.recordDigest } : {}), bookingId: booking.id };
  const digestInput = scope.type === "planning" && !scope.sessionId ? body : { scope: targetId, body };
  return { recovery: { requestId: body.requestId, requestDigest: bookingRelationshipDigest(digestInput), identity, scope: structuredClone(scope) }, body };
}
export function readBookingImportRecovery(storage: StoragePort): BookingImportRecovery | null {
  const raw = storage.getItem(bookingImportRecoveryKey);
  if (!raw) return null;
  const value = JSON.parse(raw) as BookingImportRecovery;
  const identity = value?.identity;
  if (!value.requestId || !/^[a-f0-9]{64}$/.test(value.requestDigest) || !identity || identity.operation !== "import_booking" || !["plan", "session", "current_session"].includes(identity.targetKind) || !identity.bookingId || !identity.targetId || !value.scope || (value.scope.type !== "plan" && value.scope.type !== "planning")) throw new Error("The booking recovery record could not be verified. Keep your original draft.");
  const expectedTarget = value.scope.type === "plan" ? value.scope.planId : value.scope.sessionId ?? "current";
  if (identity.targetId !== expectedTarget || (identity.targetKind === "plan" ? !Number.isSafeInteger(identity.expectedVersion) : !Number.isSafeInteger(identity.expectedRevision)) || (identity.targetKind === "current_session" && !("expectedSessionId" in identity))) throw new Error("The original booking target or version is incomplete. Keep your draft.");
  return value;
}
export function persistBookingImportRecovery(storage: StoragePort, record: BookingImportRecovery): void {
  if (storage.getItem(bookingImportRecoveryKey)) throw new Error("Check the previous booking save result first.");
  const raw = JSON.stringify(record);
  storage.setItem(bookingImportRecoveryKey, raw);
  if (storage.getItem(bookingImportRecoveryKey) !== raw) throw new Error("The recovery record could not be saved. This booking has not been submitted.");
}
export function clearBookingImportRecovery(storage: StoragePort, record: BookingImportRecovery): void {
  if (canonicalBookingRelationshipJson(readBookingImportRecovery(storage)) === canonicalBookingRelationshipJson(record)) storage.removeItem(bookingImportRecoveryKey);
}
export function checkedBookingImportReceipt(value: unknown, record: BookingImportRecovery): BookingImportReceipt | null {
  if (!value || typeof value !== "object") return null;
  const receipt = value as BookingImportReceipt;
  if (receipt.requestId !== record.requestId || receipt.requestDigest !== record.requestDigest) return null;
  if (receipt.status === "not_found") return receipt;
  if (receipt.status !== "committed" || canonicalBookingRelationshipJson(receipt.originalRequest) !== canonicalBookingRelationshipJson(record.identity) || canonicalBookingRelationshipJson(receipt.originalResult?.originalRequest) !== canonicalBookingRelationshipJson(record.identity) || receipt.originalResult?.bookingId !== record.identity.bookingId || !isMutationWorkspace(receipt.workspace)) return null;
  const result = receipt.originalResult;
  if (record.identity.targetKind === "plan") {
    if (!result.planId || !Number.isSafeInteger(result.planVersion) || (record.identity.expectedBlueprintVersion !== undefined && (!result.blueprintId || !Number.isSafeInteger(result.blueprintVersion)))) return null;
  } else if (!result.sessionId || !Number.isSafeInteger(result.revision) || result.revision !== record.identity.expectedRevision! + 1 || (record.identity.targetKind === "session" && result.sessionId !== record.identity.targetId) || (record.identity.targetKind === "current_session" && record.identity.expectedSessionId !== null && result.sessionId !== record.identity.expectedSessionId)) return null;
  return receipt;
}
