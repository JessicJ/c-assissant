import type {BlueprintBookingConstraint, BlueprintBookingSegment} from "./trip-blueprint.js";
import {canonicalBookingRelationshipJson} from "./booking-relationship.js";
import {WorkspaceMutationError} from "./workspace-mutation-error.js";

export interface BookingSourceLegacyBinding {
  bookingConstraintId:string;
  sourceBookingId:string;
  segments:Array<{segmentId:string;sourceSegmentId:string}>;
  rationale:string;
  evidenceRefs:string[];
}
export interface BookingSourceSelectionDecision {
  source:"traveler";
  actorId:string;
  decidedAt:string;
}
export interface BookingSourceSelectionAudit {
  decision:BookingSourceSelectionDecision;
  legacyBindings:BookingSourceLegacyBinding[];
  legacySegmentStatusRule:"booking_status_protection_baseline";
}

const text={type:"string",minLength:1,maxLength:2000} as const;
export const bookingSourceLegacyBindingsSchema={type:"array",maxItems:1000,items:{type:"object",additionalProperties:false,required:["bookingConstraintId","sourceBookingId","segments","rationale","evidenceRefs"],properties:{bookingConstraintId:text,sourceBookingId:text,rationale:text,evidenceRefs:{type:"array",minItems:1,maxItems:100,items:text},segments:{type:"array",maxItems:1000,items:{type:"object",additionalProperties:false,required:["segmentId","sourceSegmentId"],properties:{segmentId:text,sourceSegmentId:text}}}}}} as const;

const nonempty=(value:unknown):value is string=>typeof value==='string'&&value.trim().length>0&&value.length<=2000;
const object=(value:unknown):value is Record<string,unknown>=>!!value&&typeof value==='object'&&!Array.isArray(value);
const invalid=()=>new WorkspaceMutationError("请明确选择合法预订及全部分段，并填写理由和声明来源。","invalid_edit");
const protectedChange=()=>new WorkspaceMutationError("所选来源改变或遗漏了原固定承诺，请核对原预订资料或使用辅助重规划。","assisted_replanning_required");

export function parseBookingSourceLegacyBindings(value:unknown):BookingSourceLegacyBinding[] {
  if(value===undefined) return [];
  if(!Array.isArray(value)||value.length>1000) throw invalid();
  return value.map(item=>{
    if(!object(item)||Object.keys(item).some(key=>!['bookingConstraintId','sourceBookingId','segments','rationale','evidenceRefs'].includes(key))||!nonempty(item.bookingConstraintId)||!nonempty(item.sourceBookingId)||!nonempty(item.rationale)||!Array.isArray(item.evidenceRefs)||!item.evidenceRefs.length||item.evidenceRefs.length>100||!item.evidenceRefs.every(nonempty)||!Array.isArray(item.segments)||item.segments.length>1000) throw invalid();
    const segments=item.segments.map(segment=>{
      if(!object(segment)||Object.keys(segment).some(key=>!['segmentId','sourceSegmentId'].includes(key))||!nonempty(segment.segmentId)||!nonempty(segment.sourceSegmentId)) throw invalid();
      return {segmentId:segment.segmentId,sourceSegmentId:segment.sourceSegmentId};
    });
    return {bookingConstraintId:item.bookingConstraintId,sourceBookingId:item.sourceBookingId,segments,rationale:item.rationale,evidenceRefs:[...item.evidenceRefs]};
  });
}

export function isProtectedBookingSourceConstraint(booking:BlueprintBookingConstraint):boolean {
  return booking.constraintStrength==='hard'||booking.segments.some(segment=>segment.constraintStrength==='hard'||segment.fixedCommitment);
}

function bookingMeaning(booking:BlueprintBookingConstraint) {
  return {type:booking.type,status:booking.status,title:booking.title,constraintStrength:booking.constraintStrength};
}
function segmentMeaning(segment:BlueprintBookingSegment,legacyStatus?:BlueprintBookingConstraint['status']) {
  return {segmentType:segment.segmentType,status:segment.status===undefined?legacyStatus:segment.status,title:segment.title,startAtLocal:segment.startAtLocal,startTimeZone:segment.startTimeZone,endAtLocal:segment.endAtLocal,endTimeZone:segment.endTimeZone,origin:segment.origin,destination:segment.destination,location:segment.location,constraintStrength:segment.constraintStrength,fixedCommitment:segment.fixedCommitment,needsReviewReasons:segment.needsReviewReasons};
}

/** 只验证旅行者明确绑定与既有身份，不寻找或推断现实预订对应。 */
export function validateBookingSourceSelection(previous:BlueprintBookingConstraint[],resolved:BlueprintBookingConstraint[],value:unknown,decision:BookingSourceSelectionDecision|undefined):BookingSourceSelectionAudit {
  const bindings=parseBookingSourceLegacyBindings(value);
  if(!decision||decision.source!=='traveler'||decision.actorId!=='local-traveler'||!Number.isFinite(Date.parse(decision.decidedAt))) throw invalid();
  const byOld=new Map<string,BookingSourceLegacyBinding>(),usedSources=new Map<string,string>();
  for(const binding of bindings) {
    const old=previous.find(booking=>booking.id===binding.bookingConstraintId);
    if(!old||byOld.has(binding.bookingConstraintId)||!resolved.some(booking=>booking.sourceBookingId===binding.sourceBookingId)) throw invalid();
    if(usedSources.has(binding.sourceBookingId)) {
      const other=previous.find(booking=>booking.id===usedSources.get(binding.sourceBookingId));
      if(isProtectedBookingSourceConstraint(old)||(other&&isProtectedBookingSourceConstraint(other))) throw protectedChange();
      throw invalid();
    }
    byOld.set(binding.bookingConstraintId,binding);usedSources.set(binding.sourceBookingId,old.id);
  }
  const corresponding=new Map<string,string>();
  for(const old of previous) {
    const protectedBooking=isProtectedBookingSourceConstraint(old),binding=byOld.get(old.id);
    const sourceId=binding?.sourceBookingId??old.sourceBookingId;
    if(old.sourceBookingId&&binding&&binding.sourceBookingId!==old.sourceBookingId) {if(protectedBooking)throw protectedChange();throw invalid();}
    if(!sourceId) {if(protectedBooking)throw protectedChange();continue;}
    const source=resolved.find(booking=>booking.sourceBookingId===sourceId);
    if(!source) {if(protectedBooking)throw protectedChange();throw invalid();}
    const prior=corresponding.get(sourceId);
    if(prior&&prior!==old.id) {if(protectedBooking||previous.some(booking=>booking.id===prior&&isProtectedBookingSourceConstraint(booking)))throw protectedChange();throw invalid();}
    corresponding.set(sourceId,old.id);
    const mapping=binding?.segments??old.segments.flatMap(segment=>segment.sourceSegmentId?[{segmentId:segment.id,sourceSegmentId:segment.sourceSegmentId}]:[]);
    const mappedOld=new Set(mapping.map(pair=>pair.segmentId)),mappedSource=new Set(mapping.map(pair=>pair.sourceSegmentId));
    const complete=mapping.length===old.segments.length&&mapping.length===source.segments.length&&mappedOld.size===mapping.length&&mappedSource.size===mapping.length&&mapping.every(pair=>old.segments.some(segment=>segment.id===pair.segmentId)&&source.segments.some(segment=>segment.sourceSegmentId===pair.sourceSegmentId));
    if((protectedBooking||binding)&&!complete) {if(protectedBooking)throw protectedChange();throw invalid();}
    if(binding&&mapping.some(pair=>{const segment=old.segments.find(segment=>segment.id===pair.segmentId);return segment?.sourceSegmentId!==undefined&&segment.sourceSegmentId!==pair.sourceSegmentId;})) {if(protectedBooking)throw protectedChange();throw invalid();}
    if(protectedBooking) {
      if(canonicalBookingRelationshipJson(bookingMeaning(old))!==canonicalBookingRelationshipJson(bookingMeaning(source))) throw protectedChange();
      for(const pair of mapping) {
        const before=old.segments.find(segment=>segment.id===pair.segmentId)!,after=source.segments.find(segment=>segment.sourceSegmentId===pair.sourceSegmentId)!;
        if(canonicalBookingRelationshipJson(segmentMeaning(before,old.status))!==canonicalBookingRelationshipJson(segmentMeaning(after))) throw protectedChange();
      }
    }
  }
  if(previous.length&&!resolved.length) throw invalid();
  return {decision:structuredClone(decision),legacyBindings:structuredClone(bindings),legacySegmentStatusRule:"booking_status_protection_baseline"};
}
