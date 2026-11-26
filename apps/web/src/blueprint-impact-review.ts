import type { BlueprintBookingConstraint,DirectBlueprintHighImpactPreview, TripBlueprint } from "@c-assistant/core";
import { blueprintImpactProjection, type BlueprintImpactProjectionEdit } from "@c-assistant/core/blueprint-impact-projection";
import {assertBookingRelationshipSourceContext,bookingRelationshipImpact,canonicalBookingRelationshipJson,type BookingRelationshipSourceContext,type BookingRelationshipUnknown,type BookingRelationshipImpact, type BookingRelationshipImpactUnit } from "@c-assistant/core/booking-relationship";

export type CheckedBlueprintImpact=DirectBlueprintHighImpactPreview&{sourceContext:BookingRelationshipSourceContext};
export function checkedRuntimeBookingSourceContext(value:unknown,blueprint:TripBlueprint,plan:{id:string;version:number}|undefined):BookingRelationshipSourceContext|null {
  if(!value||typeof value!=="object"||!plan)return null;
  try{const context=value as BookingRelationshipSourceContext;assertBookingRelationshipSourceContext(blueprint,context);if(context.planId!==plan.id||context.planVersion!==plan.version)return null;return context;}catch{return null;}
}

export function checkedBookingImpact(value: unknown, blueprint: TripBlueprint,sourceContext?:BookingRelationshipSourceContext): BookingRelationshipImpact | null {
  if (!value || typeof value !== "object") return null;
  const candidate = value as BookingRelationshipImpact;
  const validUnits = (items: unknown): items is BookingRelationshipImpactUnit[] => Array.isArray(items) && items.every((item: BookingRelationshipImpactUnit) => {
    if(item?.kind!==undefined&&item.kind!=="constraint")return false;
    const booking = blueprint.bookingConstraints?.find((booking) => booking.id === item?.bookingConstraintId);
    return booking && (item.segmentId === undefined || booking.segments.some((segment) => segment.id === item.segmentId))
      && typeof item.rationale === "string" && Array.isArray(item.evidenceRefs) && item.evidenceRefs.every((ref) => typeof ref === "string")
      && Array.isArray(item.relationIds) && item.relationIds.every((id) => typeof id === "string");
  });
  const safeDescription=(item:BookingRelationshipUnknown)=>typeof item?.rationale==="string"&&Array.isArray(item.evidenceRefs)&&item.evidenceRefs.every(ref=>typeof ref==="string");
  const validUnknown=Array.isArray(candidate.unknown)&&candidate.unknown.every(item=>{
    if(!safeDescription(item))return false;
    if(item.kind==="source_obligation")return Boolean(sourceContext&&!("bookingConstraintId" in item)&&item.reason==="source_not_adopted"&&sourceContext.pendingSources.some(source=>source.sourceBookingId===item.sourceBookingId&&source.sourceDigest===item.sourceDigest));
    if(item.kind==="source_resolution")return Boolean(sourceContext&&sourceContext.resolutionIssues.some(issue=>issue.code===item.reason&&issue.sourceBookingId===item.sourceBookingId&&issue.bookingConstraintId===item.bookingConstraintId));
    return validUnits([item]);
  });
  if (!validUnknown) return null;
  const coversSources=!sourceContext||Array.isArray(candidate.unknown)&&sourceContext.pendingSources.every(source=>candidate.unknown.some(item=>item.kind==="source_obligation"&&item.sourceBookingId===source.sourceBookingId&&item.sourceDigest===source.sourceDigest))&&sourceContext.resolutionIssues.every(issue=>candidate.unknown.some(item=>item.kind==="source_resolution"&&item.reason===issue.code&&item.sourceBookingId===issue.sourceBookingId&&item.bookingConstraintId===issue.bookingConstraintId));
  if (!validUnits(candidate.affected) || !validUnits(candidate.unaffected) ||!coversSources
    || !/^[a-f0-9]{64}$/.test(candidate.assessmentDigest) || typeof candidate.canConfirm !== "boolean"
    || candidate.canConfirm !== (candidate.unknown.length === 0)) return null;
  return candidate;
}

/** 只接收与当前已知蓝图一致的结构化预览；异常文本不参与产品展示。 */
export function checkedBlueprintImpact(value: unknown, blueprint: TripBlueprint | undefined,plan:{id:string;version:number}|undefined,revisions:readonly BlueprintImpactProjectionEdit[]): CheckedBlueprintImpact | null {
  if (!blueprint || !value || typeof value !== "object") return null;
  const candidate = value as Partial<DirectBlueprintHighImpactPreview>;
  const rawContext=(value as {sourceContext?:unknown}).sourceContext;
  const sourceContext=checkedRuntimeBookingSourceContext(rawContext,blueprint,plan);
  if(sourceContext===null)return null;
  if (typeof candidate.id !== "string" || !candidate.id.trim() || candidate.blueprintId !== blueprint.id || candidate.blueprintVersion !== blueprint.version) return null;
  const knownIds = (values: unknown, known: string[]): values is string[] => Array.isArray(values) && new Set(values).size === values.length && values.every((item) => typeof item === "string" && known.includes(item));
  const projection = blueprintImpactProjection(blueprint, revisions);
  const same = (actual: unknown, expected: string[]) => JSON.stringify(actual) === JSON.stringify(expected);
  const dates = blueprint.days.map((day) => day.date);
  if (!knownIds(candidate.dayIds, blueprint.days.map((day) => day.id)) || !same(candidate.dayIds, projection.dayIds)
    || !knownIds(candidate.dates, dates) || !same(candidate.dates, projection.dates)
    || !candidate.dates.every((date) => /^\d{4}-\d{2}-\d{2}$/.test(date) && Number.isFinite(Date.parse(`${date}T12:00:00Z`)) && new Date(`${date}T12:00:00Z`).toISOString().slice(0, 10) === date)
    || !knownIds(candidate.placeIds, blueprint.places.map((place) => place.id)) || !candidate.placeIds.length || !same(candidate.placeIds, projection.placeIds)
    || !knownIds(candidate.movementIds, blueprint.movements.map((movement) => movement.id))
    || !knownIds(candidate.reminderRequirementIds, blueprint.actionRequirements.map((requirement) => requirement.id))
    || !knownIds(candidate.bookingConstraintIds, (blueprint.bookingConstraints ?? []).map((booking) => booking.id))
    || !Array.isArray(candidate.nextActions) || !candidate.nextActions.length || !candidate.nextActions.every((action) => ["confirm_removal", "cancel", "assisted_replanning", "review_booking_relationships"].includes(action))
    || !Array.isArray(candidate.evidence)) return null;
  const bookingImpact = checkedBookingImpact(candidate.bookingImpact, blueprint,sourceContext);
  // 核对规范 Core 投影，不从返回条目存在性推断覆盖完整或关系语义。
  try {
    if (canonicalBookingRelationshipJson(bookingImpact) !== canonicalBookingRelationshipJson(bookingRelationshipImpact(blueprint,revisions.filter(revision=>"placeId" in revision),sourceContext))) return null;
  } catch { return null; }
  if (!bookingImpact || (!bookingImpact.canConfirm && candidate.nextActions.includes("confirm_removal"))
    || JSON.stringify([...new Set(bookingImpact.affected.map((item) => item.bookingConstraintId))].sort()) !== JSON.stringify([...candidate.bookingConstraintIds].sort())) return null;
  if (!same(candidate.movementIds, blueprint.movements.filter((movement) => projection.dayIds.includes(movement.dayId)).map((movement) => movement.id))
    || !same(candidate.reminderRequirementIds, blueprint.actionRequirements.filter((requirement) => requirement.placeId && projection.placeIds.includes(requirement.placeId)).map((requirement) => requirement.id))) return null;
  const knownEvidence = blueprint.places.filter((place) => projection.placeIds.includes(place.id)).flatMap((place) => place.evidence);
  const evidence = [];
  for (const ref of candidate.evidence) {
    if (!ref || typeof ref !== "object" || typeof ref.sourceId !== "string" || typeof ref.status !== "string"
      || (ref.checkedAt !== undefined && (typeof ref.checkedAt !== "string" || !Number.isFinite(Date.parse(ref.checkedAt))))
      || (ref.supports !== undefined && (!Array.isArray(ref.supports) || !ref.supports.every((support) => typeof support === "string")))) return null;
    const known = knownEvidence.find((item) => item.sourceId === ref.sourceId && item.status === ref.status && item.checkedAt === ref.checkedAt && JSON.stringify(item.supports) === JSON.stringify(ref.supports));
    if (!known) return null;
    evidence.push(known);
  }
  return { id: candidate.id, blueprintId: blueprint.id, blueprintVersion: blueprint.version, dayIds: candidate.dayIds, dates: candidate.dates, placeIds: candidate.placeIds, movementIds: candidate.movementIds, reminderRequirementIds: candidate.reminderRequirementIds, bookingConstraintIds: candidate.bookingConstraintIds, bookingImpact, nextActions: candidate.nextActions, evidence,sourceContext };
}

export function bookingImpactLabel(item:BookingRelationshipUnknown,bookings:BlueprintBookingConstraint[]):string {
  if(item.kind==="source_obligation")return "Saved booking information has not been included and reviewed";
  if(item.kind==="source_resolution")return item.reason==="missing_source"?"Original booking source needed":item.reason==="invalid_mapping"?"Booking source or segment match needs review":item.reason==="unverified_ancestor"?"Booking source inheritance needs review":"Booking source scope is unverified";
  return bookings.find(booking=>booking.id===item.bookingConstraintId)?.title??"Booking information needs review";
}
