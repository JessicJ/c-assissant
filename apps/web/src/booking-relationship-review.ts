import type { BlueprintBookingConstraint, BlueprintBookingSegment, TripBlueprint } from "@c-assistant/core";
import { bookingRelationshipAssessmentIssues, bookingRelationshipReviewContext, canonicalBookingRelationshipJson, type BookingRelationship, type BookingRelationshipAssessment, type BookingRelationshipSourceUnit, type BookingRelationshipTarget } from "@c-assistant/core/booking-relationship";
import { isProtectedBookingSourceConstraint, parseBookingSourceLegacyBindings, type BookingSourceLegacyBinding } from "@c-assistant/core/booking-source-selection";

export interface BookingRelationshipReviewContext {
  expectedPlanId: string;
  expectedVersion: number;
  blueprintId: string;
  blueprintVersion: number;
  universeDigest: string;
  sourceSetDigest: string;
  pendingSourceBookingIds: string[];
  units: BookingRelationshipSourceUnit[];
  targets: BookingRelationshipTarget[];
  targetDigests: Record<string, string>;
  sourceIssues: string[];
  constraints: BlueprintBookingConstraint[];
  sourceConstraints: BlueprintBookingConstraint[];
  sourceRecords: BookingSourceChoice[];
  sourceCandidates: BookingSourceChoice[];
  assessment?: BookingRelationshipAssessment;
}
export interface BookingSourceChoice { bookingId: string; title: string; type: string; status: string; constraintStrength: "hard"|"soft"|"ignored";sourceLabel: string; segments: BlueprintBookingSegment[]; ownership: "planning_session" | "plan"; recordDigest: string; sourceDigest: string }
const digest = (value: unknown): value is string => typeof value === "string" && /^[a-f0-9]{64}$/.test(value);
const text = (value: unknown): value is string => typeof value === "string" && value.length > 0;
/** 响应仅提供证据；旅行者必须明确完成各单元的审阅。 */
export function checkedBookingReviewContext(value: unknown, plan: { id: string; version: number }, blueprint: TripBlueprint): BookingRelationshipReviewContext | null {
  try { return parseBookingReviewContext(value, plan, blueprint); } catch { return null; }
}
function parseBookingReviewContext(value: unknown, plan: { id: string; version: number }, blueprint: TripBlueprint): BookingRelationshipReviewContext | null {
  if (!value || typeof value !== "object") return null;
  const context = value as BookingRelationshipReviewContext;
  const known = bookingRelationshipReviewContext(blueprint);
  if (context.expectedPlanId !== plan.id || context.expectedVersion !== plan.version || context.blueprintId !== blueprint.id || context.blueprintVersion !== blueprint.version
    || context.universeDigest !== known.universeDigest || !digest(context.sourceSetDigest) || !Array.isArray(context.units) || !Array.isArray(context.targets)
    || canonicalBookingRelationshipJson(context.units) !== canonicalBookingRelationshipJson(known.units)
    || canonicalBookingRelationshipJson(context.targets) !== canonicalBookingRelationshipJson(known.targets)
    || context.units.some((unit) => !unit || !text(unit.bookingConstraintId) || (unit.segmentId !== undefined && !text(unit.segmentId)) || !digest(unit.sourceDigest))
    || new Set(context.units.map((unit) => canonicalBookingRelationshipJson([unit.bookingConstraintId, unit.segmentId ?? null]))).size !== context.units.length
    || !context.targetDigests || context.targets.some((target) => !digest(context.targetDigests[canonicalBookingRelationshipJson(target)]))
    || canonicalBookingRelationshipJson(context.targetDigests) !== canonicalBookingRelationshipJson(known.targetDigests)
    || !Array.isArray(context.sourceIssues) || context.sourceIssues.some((issue) => !text(issue))
    || !Array.isArray(context.constraints) || !Array.isArray(context.sourceConstraints)
    || canonicalBookingRelationshipJson(context.constraints) !== canonicalBookingRelationshipJson(blueprint.bookingConstraints ?? [])
    || !Array.isArray(context.sourceRecords) || !Array.isArray(context.sourceCandidates)
    || [...context.sourceRecords, ...context.sourceCandidates].some((record) => !text(record?.bookingId) || !text(record.title) || !text(record.sourceLabel) || !["hard","soft","ignored"].includes(record.constraintStrength)||!Array.isArray(record.segments) || record.segments.some(segment=>!segment||!text(segment.id)||!text(segment.sourceSegmentId)||!["pending","confirmed","cancelled","needs_review"].includes(segment.status??"")||!["hard","soft","ignored"].includes(segment.constraintStrength)||typeof segment.fixedCommitment!=="boolean"||!Array.isArray(segment.needsReviewReasons)||segment.needsReviewReasons.some(reason=>typeof reason!=="string")) || !["planning_session", "plan"].includes(record.ownership) || !digest(record.recordDigest) || !digest(record.sourceDigest))
    ||!Array.isArray(context.pendingSourceBookingIds)||new Set(context.pendingSourceBookingIds).size!==context.pendingSourceBookingIds.length||context.pendingSourceBookingIds.some(id=>!text(id)||!context.sourceCandidates.some(source=>source.bookingId===id))) return null;
  if (context.assessment) {
    if (!Array.isArray(context.assessment.units) || context.assessment.units.some((unit) => !unit || typeof unit.rationale !== "string" || !Array.isArray(unit.evidenceRefs) || unit.evidenceRefs.some((ref) => typeof ref !== "string") || !Array.isArray(unit.relations) || unit.relations.some((relation) => !relation || typeof relation.id !== "string" || typeof relation.rationale !== "string" || !Array.isArray(relation.targets) || !Array.isArray(relation.operations) || !Array.isArray(relation.evidenceRefs) || relation.evidenceRefs.some((ref) => typeof ref !== "string")))) return null;
    if (bookingRelationshipAssessmentIssues(blueprint, context.assessment).length && context.assessment.status !== "invalidated") return null;
  }
  return context;
}

export function bookingTargetLabel(target: BookingRelationshipTarget, blueprint: TripBlueprint): string {
  const place = (id: string) => blueprint.places.find((item) => item.id === id)?.name ?? "Place details needed";
  const date = (id: string) => { const day = blueprint.days.find((item) => item.id === id); return day ? new Date(`${day.date}T12:00:00`).toLocaleDateString() : "Date needs review"; };
  if (target.kind === "place_global") return `${place(target.placeId)} · All occurrences (review when any occurrence changes)`;
  if (target.kind === "movement") { const movement = blueprint.movements.find((item) => item.id === target.movementId); return movement ? `${date(movement.dayId)} · ${place(movement.originPlaceId)} → ${place(movement.destinationPlaceId)}` : "Journey needs review"; }
  const day = blueprint.days.find((item) => item.id === target.dayId);
  const block = day?.blocks?.find((item) => item.id === target.blockId);
  const index = day?.blocks?.filter((item) => item.placeId === target.placeId).findIndex((item) => item.id === target.blockId);
  return `${date(target.dayId)} · ${place(target.placeId)}${block ? ` · 第 ${(index ?? 0) + 1} 次出现${block.startTime ? ` · ${new Date(`2000-01-01T${block.startTime}`).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" })}` : ""}` : ""}`;
}

/** 既有来源只显示公开标题；无法解析的引用要求旅行者重新声明来源。 */
export function readableBookingEvidence(refs: string[], blueprint: TripBlueprint): string[] {
  return refs.map((ref) => blueprint.sources.find((source) => source.id === ref)?.title ?? "Traveler statement: check the original booking and itinerary again");
}
export function invalidRelationTargets(relation: BookingRelationship, targets: BookingRelationshipTarget[]): BookingRelationshipTarget[] {
  const keys = new Set(targets.map(canonicalBookingRelationshipJson));
  return relation.targets.filter((target) => !keys.has(canonicalBookingRelationshipJson(target)));
}
export function bookingWallTimeLabel(value: string | undefined): string {
  if (!value) return "Time needs review";
  const date = new Date(/^\d{4}-\d{2}-\d{2}$/.test(value) ? `${value}T12:00:00` : value);
  return Number.isNaN(date.getTime()) ? "Time needs review" : /^\d{4}-\d{2}-\d{2}$/.test(value) ? date.toLocaleDateString() : date.toLocaleString(undefined, { year: "numeric", month: "numeric", day: "numeric", hour: "numeric", minute: "2-digit" });
}

export function bookingTimeZoneLabel(value:string|undefined):string {
  if(!value)return "Time zone needs review";
  try{return new Intl.DateTimeFormat(undefined,{timeZone:value,timeZoneName:"long"}).formatToParts(new Date("2026-01-15T12:00:00Z")).find(part=>part.type==="timeZoneName")?.value??"Time zone needs review";}catch{return "Time zone needs review";}
}
export function bookingNeedsLegacyBinding(booking:BlueprintBookingConstraint):boolean {return !booking.sourceBookingId||booking.segments.some(segment=>!segment.sourceSegmentId);}
export function initialLegacySourceBindings(bookings:BlueprintBookingConstraint[]):BookingSourceLegacyBinding[] {
  return bookings.map(booking=>({bookingConstraintId:booking.id,sourceBookingId:booking.sourceBookingId??"",segments:booking.segments.map(segment=>({segmentId:segment.id,sourceSegmentId:segment.sourceSegmentId??""})),rationale:"",evidenceRefs:[]}));
}
/** 只检查明确输入和身份成员齐备；结构是否等价始终由服务端 Core 判断。 */
export function checkedLegacySourceBindings(context:BookingRelationshipReviewContext,drafts:BookingSourceLegacyBinding[],selected:string[]):BookingSourceLegacyBinding[]|null {
  const needed=context.constraints.filter(booking=>bookingNeedsLegacyBinding(booking));
  if(needed.some(booking=>isProtectedBookingSourceConstraint(booking)&&!drafts.find(draft=>draft.bookingConstraintId===booking.id)?.sourceBookingId))return null;
  const chosen=drafts.filter(draft=>needed.some(booking=>booking.id===draft.bookingConstraintId)&&draft.sourceBookingId);
  try {
    const bindings=parseBookingSourceLegacyBindings(chosen);
    if(new Set(bindings.map(binding=>binding.sourceBookingId)).size!==bindings.length)return null;
    for(const binding of bindings){const booking=needed.find(item=>item.id===binding.bookingConstraintId),source=context.sourceCandidates.find(item=>item.bookingId===binding.sourceBookingId);if(!booking||!source||!selected.includes(binding.sourceBookingId)||binding.segments.length!==booking.segments.length||binding.segments.length!==source.segments.length||new Set(binding.segments.map(pair=>pair.segmentId)).size!==binding.segments.length||new Set(binding.segments.map(pair=>pair.sourceSegmentId)).size!==binding.segments.length||binding.segments.some(pair=>!booking.segments.some(segment=>segment.id===pair.segmentId)||!source.segments.some(segment=>segment.sourceSegmentId===pair.sourceSegmentId)))return null;}
    return bindings;
  }catch{return null;}
}
