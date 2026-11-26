import type { DirectBlueprintRevision } from "./blueprint-revision.js";
import type { BlueprintBookingConstraint, TripBlueprint } from "./trip-blueprint.js";
import { WorkspaceMutationError } from "./workspace-mutation-error.js";

export type BookingRelationshipEdit = { kind:string; placeId?:string; dayId?:string; position?:Extract<DirectBlueprintRevision,{kind:"add_place_to_day"}>["position"] };
export type BookingRelationshipOperation = "remove" | "move" | "add" | "priority";
export type BookingRelationshipTarget =
  | { kind: "occurrence"; dayId: string; blockId?: string; placeId: string }
  | { kind: "place_global"; placeId: string }
  | { kind: "movement"; movementId: string };
export interface BookingRelationship {
  id: string;
  scope: "occurrence" | "place_global" | "dependency";
  targets: BookingRelationshipTarget[];
  role: "direct_commitment" | "resource_dependency" | "itinerary_context";
  direction?: "booking_depends_on_targets";
  operations: BookingRelationshipOperation[];
  rationale: string;
  evidenceRefs: string[];
}
export interface BookingRelationshipUnit {
  bookingConstraintId: string;
  segmentId?: string;
  sourceDigest: string;
  coverage: "complete" | "partial" | "unknown";
  relations: BookingRelationship[];
  rationale: string;
  evidenceRefs: string[];
}
export interface BookingRelationshipSourceUnit {
  bookingConstraintId: string;
  segmentId?: string;
  sourceDigest: string;
}
export type BookingRelationshipSourceResolutionCode = "missing_source" | "invalid_mapping" | "unverified_ancestor" | "source_scope_unresolved";
export interface BookingRelationshipSourceResolutionIssue {
  code: BookingRelationshipSourceResolutionCode;
  sourceBookingId?: string;
  bookingConstraintId?: string;
}
/** Storage 从精确持久来源构造；不保存为第二套 Blueprint 事实，不接受客户端自述。 */
export interface BookingRelationshipSourceContext {
  planId: string;
  planVersion: number;
  blueprintId: string;
  blueprintVersion: number;
  sourceSetDigest: string;
  adoptedUnits: BookingRelationshipSourceUnit[];
  pendingSources: Array<{sourceBookingId:string;sourceDigest:string}>;
  resolutionIssues: BookingRelationshipSourceResolutionIssue[];
}
export interface BookingRelationshipAssessment {
  schemaVersion: 1;
  blueprintId: string;
  blueprintVersion: number;
  universeDigest: string;
  units: BookingRelationshipUnit[];
  decision: {
    source: "traveler" | "agent";
    actorId: string;
    model?: string;
    decidedAt: string;
    rationale: string;
    evidenceRefs: string[];
    obligations: string[];
  };
  status: "candidate" | "reviewed" | "invalidated";
  /** 只由 Core 在接受审阅时计算。 */
  reviewedTargetDigests?: Record<string,string>;
  producerVerification?: "verified" | "unverified";
  producerTaskId?: string;
}
export interface BookingRelationshipProducer {actorId:string;model:string;decidedAt:string;taskId:string}
export interface BookingRelationshipImpactUnit {
  kind?: "constraint";
  bookingConstraintId: string;
  segmentId?: string;
  rationale: string;
  evidenceRefs: string[];
  relationIds: string[];
}
export type BookingRelationshipUnknown = BookingRelationshipImpactUnit
  | {kind:"source_obligation";sourceBookingId:string;sourceDigest:string;reason:"source_not_adopted";rationale:string;evidenceRefs:string[]}
  | {kind:"source_resolution";reason:BookingRelationshipSourceResolutionCode;sourceBookingId?:string;bookingConstraintId?:string;rationale:string;evidenceRefs:string[]};
export interface BookingRelationshipImpact {
  affected: BookingRelationshipImpactUnit[];
  unaffected: BookingRelationshipImpactUnit[];
  unknown: BookingRelationshipUnknown[];
  assessmentDigest: string;
  canConfirm: boolean;
}

export function canonicalBookingRelationshipJson(value: unknown): string {
  const normalize = (item: unknown): unknown => Array.isArray(item) ? item.map(normalize) : item && typeof item === "object" ? Object.fromEntries(Object.entries(item).filter(([, v]) => v !== undefined).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0).map(([k, v]) => [k, normalize(v)])) : item;
  return JSON.stringify(normalize(value));
}
/** 同步、浏览器安全的 SHA-256；不引入 Node 或运行时服务。 */
export function bookingRelationshipDigest(value: unknown): string {
  const input = new TextEncoder().encode(canonicalBookingRelationshipJson(value));
  const length = Math.ceil((input.length + 9) / 64) * 64;
  const data = new Uint8Array(length); data.set(input); data[input.length] = 128;
  const view = new DataView(data.buffer); view.setUint32(length - 8, Math.floor(input.length / 0x20000000)); view.setUint32(length - 4, input.length * 8);
  const k = [0x428a2f98,0x71374491,0xb5c0fbcf,0xe9b5dba5,0x3956c25b,0x59f111f1,0x923f82a4,0xab1c5ed5,0xd807aa98,0x12835b01,0x243185be,0x550c7dc3,0x72be5d74,0x80deb1fe,0x9bdc06a7,0xc19bf174,0xe49b69c1,0xefbe4786,0x0fc19dc6,0x240ca1cc,0x2de92c6f,0x4a7484aa,0x5cb0a9dc,0x76f988da,0x983e5152,0xa831c66d,0xb00327c8,0xbf597fc7,0xc6e00bf3,0xd5a79147,0x06ca6351,0x14292967,0x27b70a85,0x2e1b2138,0x4d2c6dfc,0x53380d13,0x650a7354,0x766a0abb,0x81c2c92e,0x92722c85,0xa2bfe8a1,0xa81a664b,0xc24b8b70,0xc76c51a3,0xd192e819,0xd6990624,0xf40e3585,0x106aa070,0x19a4c116,0x1e376c08,0x2748774c,0x34b0bcb5,0x391c0cb3,0x4ed8aa4a,0x5b9cca4f,0x682e6ff3,0x748f82ee,0x78a5636f,0x84c87814,0x8cc70208,0x90befffa,0xa4506ceb,0xbef9a3f7,0xc67178f2];
  const hash = [0x6a09e667,0xbb67ae85,0x3c6ef372,0xa54ff53a,0x510e527f,0x9b05688c,0x1f83d9ab,0x5be0cd19]; const w = new Uint32Array(64);
  const rotate = (x: number, n: number) => (x >>> n) | (x << (32 - n));
  for (let offset=0; offset<length; offset+=64) {
    for (let i=0;i<16;i++) w[i]=view.getUint32(offset+i*4);
    for (let i=16;i<64;i++) { const x=w[i-15]!,y=w[i-2]!;w[i]=(w[i-16]!+(rotate(x,7)^rotate(x,18)^(x>>>3))+w[i-7]!+(rotate(y,17)^rotate(y,19)^(y>>>10)))>>>0; }
    let [a,b,c,d,e,f,g,h]=hash as [number,number,number,number,number,number,number,number];
    for (let i=0;i<64;i++) { const t1=(h+(rotate(e,6)^rotate(e,11)^rotate(e,25))+((e&f)^(~e&g))+k[i]!+w[i]!)>>>0;const t2=((rotate(a,2)^rotate(a,13)^rotate(a,22))+((a&b)^(a&c)^(b&c)))>>>0;h=g;g=f;f=e;e=(d+t1)>>>0;d=c;c=b;b=a;a=(t1+t2)>>>0; }
    [a,b,c,d,e,f,g,h].forEach((v,i)=>hash[i]=(hash[i]!+v)>>>0);
  }
  return hash.map(v=>v.toString(16).padStart(8,"0")).join("");
}

function sourceSemantic(constraint: BlueprintBookingConstraint, segmentId?: string): unknown {
  const segment = segmentId ? constraint.segments.find(s=>s.id===segmentId) : undefined;
  return { id:constraint.id,sourceBookingId:constraint.sourceBookingId,title:constraint.title,type:constraint.type,status:constraint.status,constraintStrength:constraint.constraintStrength,sourceLabel:constraint.sourceLabel, segments: (segment ? [segment] : constraint.segments).map(s=>({ id:s.id,sourceSegmentId:s.sourceSegmentId,title:s.title,segmentType:s.segmentType,status:s.status,startAtLocal:s.startAtLocal,startTimeZone:s.startTimeZone,endAtLocal:s.endAtLocal,endTimeZone:s.endTimeZone,origin:s.origin,destination:s.destination,location:s.location,constraintStrength:s.constraintStrength,fixedCommitment:s.fixedCommitment,needsReviewReasons:s.needsReviewReasons })) };
}
export function bookingTaskRequirementId(constraint:BlueprintBookingConstraint,segmentId:string):string {
  return `booking:${constraint.id}:${segmentId}:${bookingRelationshipDigest(sourceSemantic(constraint,segmentId))}`;
}
const unitKey = (unit: { bookingConstraintId: string; segmentId?: string }) => canonicalBookingRelationshipJson([unit.bookingConstraintId,unit.segmentId??null]);
const targetKey = (target: BookingRelationshipTarget) => canonicalBookingRelationshipJson(target);
function relationTargetProof(context: ReturnType<typeof bookingRelationshipReviewContext>, relation: BookingRelationship, target: BookingRelationshipTarget): string {
  return bookingRelationshipDigest({target:context.targetDigests[targetKey(target)],relation:{scope:relation.scope,role:relation.role,direction:relation.direction,operations:relation.operations,targets:relation.targets}});
}
export function stampReviewedBookingRelationshipAssessment(blueprint:TripBlueprint, assessment:BookingRelationshipAssessment):BookingRelationshipAssessment {
  const context=bookingRelationshipReviewContext(blueprint);
  return {...structuredClone(assessment),reviewedTargetDigests:Object.fromEntries(assessment.units.flatMap(unit=>unit.relations.flatMap(relation=>relation.targets.map(target=>[canonicalBookingRelationshipJson([relation.id,target]),relationTargetProof(context,relation,target)]))))};
}
export function bookingRelationshipSourceUnits(constraints:BlueprintBookingConstraint[]):BookingRelationshipSourceUnit[] {
  return constraints.flatMap<BookingRelationshipSourceUnit>(booking=>booking.segments.length ? booking.segments.map(segment=>({bookingConstraintId:booking.id,segmentId:segment.id,sourceDigest:bookingRelationshipDigest({unit:sourceSemantic(booking,segment.id),segmentSet:sourceSemantic(booking)})})) : [{bookingConstraintId:booking.id,sourceDigest:bookingRelationshipDigest(sourceSemantic(booking))}]);
}
export function bookingRelationshipReviewContext(blueprint: TripBlueprint) {
  const targets: BookingRelationshipTarget[] = blueprint.places.map(place=>({kind:"place_global",placeId:place.id}));
  for(const day of blueprint.days) {
    if(day.blocks?.length) for(const block of day.blocks) { if(block.placeId) targets.push({kind:"occurrence",dayId:day.id,blockId:block.id,placeId:block.placeId}); }
    else for(const stop of day.stops) targets.push({kind:"occurrence",dayId:day.id,placeId:stop.placeId});
  }
  for(const movement of blueprint.movements) targets.push({kind:"movement",movementId:movement.id});
  const units=bookingRelationshipSourceUnits(blueprint.bookingConstraints??[]);
  // 只纳入旅行结构；说明文案、来源抓取时刻和图片不改变关系语义。
  const semanticDays=blueprint.days.map(day=>({id:day.id,date:day.date,stops:day.stops.map(stop=>({placeId:stop.placeId,order:stop.order,time:stop.time,role:stop.role})),blocks:day.blocks?.map(block=>({id:block.id,placeId:block.placeId,eventId:block.eventId,kind:block.kind,order:block.order,startTime:block.startTime,endTime:block.endTime,durationMinutes:block.durationMinutes,role:block.role}))}));
  const semanticMovements=blueprint.movements.map(m=>{const day=semanticDays.find(day=>day.id===m.dayId);const endpoints=[m.originPlaceId,m.destinationPlaceId];return {id:m.id,dayId:m.dayId,date:day?.date,originPlaceId:m.originPlaceId,destinationPlaceId:m.destinationPlaceId,mode:m.mode,durationMinutes:m.durationMinutes,endpointSchedule:{stops:day?.stops.filter(stop=>endpoints.includes(stop.placeId)),blocks:day?.blocks?.filter(block=>block.placeId&&endpoints.includes(block.placeId))},endpointSemantics:endpoints.map(id=>{const place=blueprint.places.find(place=>place.id===id);return {id,locationLabel:place?.locationLabel,city:place?.city,coordinates:place?.coordinates};})};});
  const semanticPlaces=blueprint.places.map(place=>({id:place.id,locationLabel:place.locationLabel,city:place.city,coordinates:place.coordinates,accommodation:place.accommodation?{state:place.accommodation.state,baseLabel:place.accommodation.baseLabel,stayStartDate:place.accommodation.stayStartDate,stayEndDate:place.accommodation.stayEndDate}:undefined}));
  const targetDigests=Object.fromEntries(targets.map(target=>[targetKey(target),bookingRelationshipDigest({target,meaning:target.kind==='movement'?semanticMovements.find(m=>m.id===target.movementId):{place:semanticPlaces.find(p=>p.id===target.placeId),occurrences:semanticDays.flatMap<unknown>(day=>day.blocks?.length?day.blocks.filter(block=>block.placeId===target.placeId&&(target.kind==='place_global'||(day.id===target.dayId&&block.id===target.blockId))).map(block=>({dayId:day.id,date:day.date,block})):day.stops.filter(stop=>stop.placeId===target.placeId&&(target.kind==='place_global'||day.id===target.dayId)).map(stop=>({dayId:day.id,date:day.date,stop})))}})]));
  const universeDigest=bookingRelationshipDigest({targets,units,days:semanticDays,movements:semanticMovements,places:semanticPlaces});
  return {blueprintId:blueprint.id,blueprintVersion:blueprint.version,universeDigest,units,targets,targetDigests};
}
const strings = (value: unknown): value is string[] => Array.isArray(value)&&value.every(v=>typeof v==="string"&&v.trim().length>0);
const nonempty = (value: unknown): value is string => typeof value==="string"&&value.trim().length>0;
const sourceResolutionCodes:BookingRelationshipSourceResolutionCode[]=["missing_source","invalid_mapping","unverified_ancestor","source_scope_unresolved"];
/** 只核可信运行时投影的形状与精确基准，不推断真实来源归属。 */
export function assertBookingRelationshipSourceContext(blueprint:TripBlueprint, context:BookingRelationshipSourceContext):void {
  if(context.blueprintId!==blueprint.id||context.blueprintVersion!==blueprint.version) throw new WorkspaceMutationError("预订来源基准已变化，请刷新后重新审阅。","version_conflict");
  const digest=(value:unknown)=>typeof value==='string'&&/^[a-f0-9]{64}$/.test(value);
  if(!nonempty(context.planId)||!Number.isInteger(context.planVersion)||context.planVersion<1||!digest(context.sourceSetDigest)||!Array.isArray(context.adoptedUnits)||!Array.isArray(context.pendingSources)||!Array.isArray(context.resolutionIssues)) throw new WorkspaceMutationError("预订来源上下文无效。");
  const units=new Set<string>(),pending=new Set<string>();
  for(const unit of context.adoptedUnits) {
    if(!unit||!nonempty(unit.bookingConstraintId)||(unit.segmentId!==undefined&&!nonempty(unit.segmentId))||!digest(unit.sourceDigest)||units.has(unitKey(unit))) throw new WorkspaceMutationError("预订来源单元无效。");
    units.add(unitKey(unit));
    const booking=blueprint.bookingConstraints?.find(booking=>booking.id===unit.bookingConstraintId);
    if(!booking||!booking.sourceBookingId) throw new WorkspaceMutationError("预订来源映射无效。");
  }
  for(const source of context.pendingSources) {
    if(!source||!nonempty(source.sourceBookingId)||!digest(source.sourceDigest)||pending.has(source.sourceBookingId)||blueprint.bookingConstraints?.some(booking=>booking.sourceBookingId===source.sourceBookingId)) throw new WorkspaceMutationError("待核对预订来源无效。");
    pending.add(source.sourceBookingId);
  }
  for(const issue of context.resolutionIssues) if(!issue||!sourceResolutionCodes.includes(issue.code)||(issue.sourceBookingId!==undefined&&!nonempty(issue.sourceBookingId))||(issue.bookingConstraintId!==undefined&&!blueprint.bookingConstraints?.some(booking=>booking.id===issue.bookingConstraintId))) throw new WorkspaceMutationError("预订来源解析问题无效。");
}
/** 历史过期与结构损坏分开验证；失效标记不能洗白损坏输入。 */
export function bookingRelationshipAssessmentStructureIssues(blueprint:Pick<TripBlueprint,'id'|'version'|'bookingRelationshipAssessment'>, value:unknown=blueprint.bookingRelationshipAssessment):string[] {
  if(value===undefined) return [];
  const object=(item:unknown):item is Record<string,unknown>=>!!item&&typeof item==='object'&&!Array.isArray(item);
  if(!object(value)) return ["预订关联评估结构无效。"];
  const issues:string[]=[];
  if(value.schemaVersion!==1||!['candidate','reviewed','invalidated'].includes(String(value.status))||value.blueprintId!==blueprint.id||!Number.isInteger(value.blueprintVersion)||Number(value.blueprintVersion)<1||Number(value.blueprintVersion)>blueprint.version||!nonempty(value.universeDigest)) issues.push("预订关联评估基准或状态无效。");
  const decision=value.decision;
  if(!object(decision)||!['traveler','agent'].includes(String(decision.source))||!nonempty(decision.actorId)||!nonempty(decision.rationale)||typeof decision.decidedAt!=='string'||!Number.isFinite(Date.parse(decision.decidedAt))||!strings(decision.evidenceRefs)||!strings(decision.obligations)) issues.push("预订关联评估缺少负责身份、理由或来源。");
  if(!Array.isArray(value.units)) return [...issues,"预订关联覆盖结构无效。"];
  const needsEvidence=value.units.some(unit=>object(unit)&&(unit.coverage==='complete'||(Array.isArray(unit.relations)&&unit.relations.length>0)));
  if(object(decision)&&((needsEvidence&&(!strings(decision.evidenceRefs)||!decision.evidenceRefs.length))||!strings(decision.obligations)||!decision.obligations.length)) issues.push("预订关联决定需要明确来源与审阅职责。");
  const units=new Set<string>(),relations=new Set<string>();
  for(const unit of value.units) {
    if(!object(unit)||!nonempty(unit.bookingConstraintId)||(unit.segmentId!==undefined&&!nonempty(unit.segmentId))||!nonempty(unit.sourceDigest)||!['complete','partial','unknown'].includes(String(unit.coverage))||!nonempty(unit.rationale)||!strings(unit.evidenceRefs)||!Array.isArray(unit.relations)){issues.push("预订关联评估单元无效。");continue;}
    const key=canonicalBookingRelationshipJson([unit.bookingConstraintId,unit.segmentId??null]);
    if((unit.coverage==='complete'||unit.relations.length>0)&&!unit.evidenceRefs.length) issues.push("预订关联单元需要明确来源。");
    if(units.has(key)) issues.push("预订关联评估单元重复。");units.add(key);
    for(const relation of unit.relations) {
      if(!object(relation)||!nonempty(relation.id)||!['occurrence','place_global','dependency'].includes(String(relation.scope))||!['direct_commitment','resource_dependency','itinerary_context'].includes(String(relation.role))||!nonempty(relation.rationale)||!strings(relation.evidenceRefs)||!strings(relation.operations)||!relation.operations.length||new Set(relation.operations).size!==relation.operations.length||relation.operations.some(op=>!['remove','move','add','priority'].includes(op))||!Array.isArray(relation.targets)||!relation.targets.length){issues.push("预订关联关系无效。");continue;}
      if(relations.has(relation.id)) issues.push("预订关联关系重复。");relations.add(relation.id);
      if(!relation.evidenceRefs.length) issues.push("预订关联关系需要明确来源。");
      if((relation.scope==='dependency'&&relation.direction!=='booking_depends_on_targets')||(relation.direction!==undefined&&relation.direction!=='booking_depends_on_targets')) issues.push("预订依赖方向无效。");
      const targets=new Set<string>();
      for(const target of relation.targets) {
        if(!object(target)||!['occurrence','place_global','movement'].includes(String(target.kind))||(relation.scope!=='dependency'&&target.kind!==relation.scope)||(target.kind==='occurrence'&&(!nonempty(target.dayId)||!nonempty(target.placeId)||(target.blockId!==undefined&&!nonempty(target.blockId))))||(target.kind==='place_global'&&!nonempty(target.placeId))||(target.kind==='movement'&&!nonempty(target.movementId))){issues.push("预订关联目标结构无效。");continue;}
        const identity=canonicalBookingRelationshipJson(target);if(targets.has(identity)) issues.push("预订关联目标重复。");targets.add(identity);
        const allowed=target.kind==='occurrence'?['kind','dayId','placeId','blockId']:target.kind==='place_global'?['kind','placeId']:['kind','movementId'];
        if(Object.keys(target).some(key=>!allowed.includes(key))) issues.push("预订关联目标含不适用身份。");
      }
    }
  }
  if(value.reviewedTargetDigests!==undefined&&(!object(value.reviewedTargetDigests)||Object.values(value.reviewedTargetDigests).some(digest=>typeof digest!=='string'||!/^[a-f0-9]{64}$/.test(digest)))) issues.push("预订关联目标证明结构无效。");
  if(value.producerVerification!==undefined&&!['verified','unverified'].includes(String(value.producerVerification))) issues.push("预订关联生产者证明状态无效。");
  if(value.producerTaskId!==undefined&&!nonempty(value.producerTaskId)) issues.push("预订关联生产者任务身份无效。");
  return issues;
}
export function bookingRelationshipAssessmentIssues(blueprint: TripBlueprint, assessment: BookingRelationshipAssessment = blueprint.bookingRelationshipAssessment!, requireCurrent = false, options:{allowEquivalentReviewedVersion?:boolean} = {}): string[] {
  if(assessment===undefined) return requireCurrent?["请提供完整预订关联审阅。"]:[];
  const structural=bookingRelationshipAssessmentStructureIssues(blueprint,assessment);if(structural.length) return structural;
  const issues:string[]=[]; const context=bookingRelationshipReviewContext(blueprint);
  if(assessment.schemaVersion!==1||!['candidate','reviewed','invalidated'].includes(assessment.status)) issues.push("预订关联评估版本或状态无效。");
  if(assessment.blueprintId!==blueprint.id||!Number.isInteger(assessment.blueprintVersion)||assessment.blueprintVersion<1||assessment.blueprintVersion>blueprint.version) issues.push("预订关联评估基准无效。");
  const decision=assessment.decision;
  if(!decision||!['traveler','agent'].includes(decision.source)||!nonempty(decision.actorId)||!nonempty(decision.rationale)||!Number.isFinite(Date.parse(decision.decidedAt))||!strings(decision.evidenceRefs)||!strings(decision.obligations)||(decision.source==='agent'&&assessment.producerVerification!=="unverified"&&!nonempty(decision.model))) issues.push("预订关联评估缺少负责身份、理由或来源。");
  if(requireCurrent&&decision?.source==='agent'&&assessment.producerVerification!=="verified") issues.push("候选判断者来源尚未核实，不能接受为已审阅。");
  if(!Array.isArray(assessment.units)||!nonempty(assessment.universeDigest)) return [...issues,"预订关联覆盖结构无效。"];
  const strict=requireCurrent||assessment.status!=="invalidated";
  if(strict&&assessment.universeDigest!==context.universeDigest) issues.push("预订关联覆盖已过期。");
  if(requireCurrent&&assessment.blueprintVersion!==blueprint.version&&!(options.allowEquivalentReviewedVersion&&assessment.status==='reviewed')) issues.push("预订关联审阅版本已变化。");
  if(requireCurrent&&(blueprint.bookingConstraints??[]).some(booking=>!nonempty(booking.sourceBookingId)||booking.segments.some(segment=>!nonempty(segment.sourceSegmentId)))) issues.push("请先明确并核对真实预订来源。");
  const keys=new Set<string>(); const relations=new Set<string>();const targetKeys=new Set(context.targets.map(targetKey));
  for(const unit of assessment.units) {
    if(!unit||typeof unit!=="object"){issues.push("预订关联评估单元无效。");continue;}
    const key=unitKey(unit);if(keys.has(key)) issues.push("预订关联评估单元重复。");keys.add(key);
    const current=context.units.find(v=>unitKey(v)===key);
    if((strict&&!current)||!nonempty(unit.sourceDigest)||!['complete','partial','unknown'].includes(unit.coverage)||!nonempty(unit.rationale)||!strings(unit.evidenceRefs)||!Array.isArray(unit.relations)) {issues.push("预订关联评估单元无效。");continue;}
    if(strict&&unit.sourceDigest!==current?.sourceDigest) issues.push("预订关联来源已变化。");
    for(const relation of unit.relations) {
      if(!relation||typeof relation!=="object"){issues.push("预订关联关系无效。");continue;}
      if(!nonempty(relation.id)||relations.has(relation.id)||!['occurrence','place_global','dependency'].includes(relation.scope)||!['direct_commitment','resource_dependency','itinerary_context'].includes(relation.role)||!nonempty(relation.rationale)||!strings(relation.evidenceRefs)||!Array.isArray(relation.targets)||!relation.targets.length||!Array.isArray(relation.operations)||!relation.operations.length||relation.operations.some(op=>!['remove','move','add','priority'].includes(op))) {issues.push("预订关联关系无效。");continue;}
      relations.add(relation.id);
      if(relation.scope==='dependency'&&relation.direction!=='booking_depends_on_targets') issues.push("预订依赖需要明确方向。");
      for(const target of relation.targets) {
        if(!target||!['occurrence','place_global','movement'].includes(target.kind)||(relation.scope!=='dependency'&&target.kind!==relation.scope)||(strict&&!targetKeys.has(targetKey(target)))) issues.push("预订关联目标无效或已移除。");
      }
    }
  }
  if(strict&&context.units.some(unit=>!keys.has(unitKey(unit)))) issues.push("预订关联覆盖缺少预订或分段。");
  return issues;
}

export function reconcileBookingRelationshipAssessment(blueprint: TripBlueprint, newConstraints?: BlueprintBookingConstraint[]): TripBlueprint {
  if(newConstraints) blueprint.bookingConstraints=structuredClone(newConstraints);
  if(!blueprint.bookingRelationshipAssessment) return blueprint;
  const assessment=blueprint.bookingRelationshipAssessment;
  if(bookingRelationshipAssessmentStructureIssues(blueprint,assessment).length) return blueprint;
  if(bookingRelationshipAssessmentIssues(blueprint,assessment).length) assessment.status="invalidated";
  return blueprint;
}
/** 省略 sourceContext 的离线调用仅评价 Blueprint 快照，不证明真实来源完整。 */
export function bookingRelationshipImpact(blueprint: TripBlueprint, edits: BookingRelationshipEdit[], sourceContext?:BookingRelationshipSourceContext ): BookingRelationshipImpact {
  if(sourceContext) assertBookingRelationshipSourceContext(blueprint,sourceContext);
  const context=bookingRelationshipReviewContext(blueprint),assessment=bookingRelationshipAssessmentStructureIssues(blueprint).length?undefined:blueprint.bookingRelationshipAssessment;
  const result:BookingRelationshipImpact={affected:[],unaffected:[],unknown:[],assessmentDigest:bookingRelationshipDigest({assessment:assessment??null,universeDigest:context.universeDigest,...(sourceContext?{sourceContext}: {})}),canConfirm:true};
  const valid=!!assessment&&assessment.status==='reviewed'&&!bookingRelationshipAssessmentIssues(blueprint,assessment).length;
  const priorReviewed=!!assessment&&(assessment.status==='reviewed'||assessment.status==='invalidated')&&!!assessment.reviewedTargetDigests;
  const targetMatches=(target:BookingRelationshipTarget,edit:BookingRelationshipEdit)=> target.kind==='place_global'?target.placeId===edit.placeId:target.kind==='occurrence'?target.placeId===edit.placeId&&(!edit.dayId||target.dayId===edit.dayId):blueprint.movements.some(m=>m.id===target.movementId&&(!edit.dayId||m.dayId===edit.dayId)&&(m.originPlaceId===edit.placeId||m.destinationPlaceId===edit.placeId||((edit.kind==='add_place_to_day'||edit.kind==='move_place_within_day')&&edit.position?.kind==='after'&&m.originPlaceId===edit.position.afterPlaceId)));
  for(const source of context.units) {
    const unit=assessment?.units.find(v=>unitKey(v)===unitKey(source));
    const base={bookingConstraintId:source.bookingConstraintId,...(source.segmentId?{segmentId:source.segmentId}:{}),rationale:unit?.rationale??"The relationship between this booking and the itinerary has not been reviewed.",evidenceRefs:unit?.evidenceRefs??[],relationIds:[] as string[]};
    const booking=blueprint.bookingConstraints!.find(v=>v.id===source.bookingConstraintId)!;
    const segment=booking.segments.find(v=>v.id===source.segmentId);
    if(sourceContext&&(!sourceContext.adoptedUnits.some(unit=>unitKey(unit)===unitKey(source)&&unit.sourceDigest===source.sourceDigest)||sourceContext.resolutionIssues.some(issue=>issue.code!=='unverified_ancestor'&&(issue.bookingConstraintId===booking.id||!!issue.sourceBookingId&&issue.sourceBookingId===booking.sourceBookingId)))) {result.unknown.push({...base,rationale:"The booking source has changed or needs verification. Review it again."});continue;}
    if(booking.status==='cancelled'||segment?.status==='cancelled'||booking.constraintStrength==='ignored'||segment?.constraintStrength==='ignored') {result.unaffected.push({...base,rationale:"This booking or segment was cancelled or explicitly excluded."});continue;}
    if(!booking.sourceBookingId||(segment&&!segment.sourceSegmentId)||!unit||unit.sourceDigest!==source.sourceDigest||!Array.isArray(unit.relations)) {result.unknown.push(base);continue;}
    const matches=unit.relations.filter(relation=>priorReviewed&&relation.targets.every(target=>assessment!.reviewedTargetDigests![canonicalBookingRelationshipJson([relation.id,target])]===relationTargetProof(context,relation,target)&&!!context.targetDigests[targetKey(target)])&&edits.some(edit=>relation.operations.includes(edit.kind==='remove_place_from_day'?'remove':edit.kind==='add_place_to_day'?'add':edit.kind==='update_place_priority'?'priority':'move')&&relation.targets.some(target=>targetMatches(target,edit))));
    if(matches.length) result.affected.push({...base,rationale:matches.map(m=>m.rationale).join("；"),evidenceRefs:[...new Set(matches.flatMap(m=>m.evidenceRefs))],relationIds:matches.map(m=>m.id)});
    if(!valid||unit.coverage!=='complete') result.unknown.push({...base,rationale:"The booking relationship review is incomplete or has changed."});
    else if(!matches.length) result.unaffected.push(base);
  }
  if(sourceContext) {
    for(const source of sourceContext.pendingSources) result.unknown.push({kind:"source_obligation",...source,reason:"source_not_adopted",rationale:"Saved booking details have not been adopted and checked. Select their source, then review their relationship to the itinerary.",evidenceRefs:[]});
    for(const issue of sourceContext.resolutionIssues) result.unknown.push({kind:"source_resolution",reason:issue.code,...(issue.sourceBookingId?{sourceBookingId:issue.sourceBookingId}:{}),...(issue.bookingConstraintId?{bookingConstraintId:issue.bookingConstraintId}:{}),rationale:"The booking source scope needs verification. Check the source and review it again.",evidenceRefs:[]});
  }
  result.canConfirm=result.unknown.length===0;
  return result;
}
export function bookingRelationshipProtection(blueprint:TripBlueprint,edit:BookingRelationshipEdit,sourceContext?:BookingRelationshipSourceContext) {
  const impact=bookingRelationshipImpact(blueprint,[edit],sourceContext);
  const hardFixed=(unit:BookingRelationshipUnknown)=>{
    if(unit.kind==='source_obligation'||unit.kind==='source_resolution') return false;
    const booking=blueprint.bookingConstraints!.find(v=>v.id===unit.bookingConstraintId)!;
    const segments=unit.segmentId?booking.segments.filter(v=>v.id===unit.segmentId):booking.segments;
    return segments.some(s=>s.fixedCommitment&&s.constraintStrength==='hard');
  };
  const knownFixed=impact.affected.some(unit=>{
    if(!hardFixed(unit))return false;
    const reviewed=blueprint.bookingRelationshipAssessment!.units.find(v=>unitKey(v)===unitKey(unit));
    return reviewed?.relations.some(r=>unit.relationIds.includes(r.id)&&r.role==='direct_commitment')??false;
  });
  const unresolvedFixed=impact.unknown.some(hardFixed);
  return {impact,knownFixed,unresolvedFixed};
}
export function bookingRelationshipFixedProtection(blueprint:TripBlueprint,edit:BookingRelationshipEdit,sourceContext?:BookingRelationshipSourceContext):boolean {
  const protection=bookingRelationshipProtection(blueprint,edit,sourceContext);
  return protection.knownFixed||protection.unresolvedFixed;
}

/** 可信运行时投影合同；不得挂入客户端可写的 Blueprint Schema。 */
export const bookingRelationshipSourceContextSchema = {
  type:"object",additionalProperties:false,
  required:["planId","planVersion","blueprintId","blueprintVersion","sourceSetDigest","adoptedUnits","pendingSources","resolutionIssues"],
  properties:{
    planId:{type:"string",minLength:1},planVersion:{type:"integer",minimum:1},blueprintId:{type:"string",minLength:1},blueprintVersion:{type:"integer",minimum:1},sourceSetDigest:{type:"string",pattern:"^[a-f0-9]{64}$"},
    adoptedUnits:{type:"array",items:{type:"object",additionalProperties:false,required:["bookingConstraintId","sourceDigest"],properties:{bookingConstraintId:{type:"string",minLength:1},segmentId:{type:"string",minLength:1},sourceDigest:{type:"string",pattern:"^[a-f0-9]{64}$"}}}},
    pendingSources:{type:"array",items:{type:"object",additionalProperties:false,required:["sourceBookingId","sourceDigest"],properties:{sourceBookingId:{type:"string",minLength:1},sourceDigest:{type:"string",pattern:"^[a-f0-9]{64}$"}}}},
    resolutionIssues:{type:"array",items:{type:"object",additionalProperties:false,required:["code"],properties:{code:{type:"string",enum:["missing_source","invalid_mapping","unverified_ancestor","source_scope_unresolved"]},sourceBookingId:{type:"string",minLength:1},bookingConstraintId:{type:"string",minLength:1}}}}
  }
} as const;

/** 候选传输合同；审阅身份由 API 或可信 Agent 执行边界提供。 */
const textSchema = {type:"string",minLength:1,maxLength:2000} as const;
const referencesSchema = {type:"array",maxItems:100,items:textSchema} as const;
export const bookingRelationshipAssessmentSchema = {
  type:"object",additionalProperties:false,
  required:["schemaVersion","blueprintId","blueprintVersion","universeDigest","units","decision","status"],
  properties:{
    schemaVersion:{type:"integer",const:1},blueprintId:textSchema,blueprintVersion:{type:"integer",minimum:1},universeDigest:textSchema,
    status:{type:"string",enum:["candidate","reviewed","invalidated"]},
    decision:{type:"object",additionalProperties:false,required:["source","actorId","decidedAt","rationale","evidenceRefs","obligations"],properties:{source:{type:"string",enum:["traveler","agent"]},actorId:textSchema,model:textSchema,decidedAt:textSchema,rationale:textSchema,evidenceRefs:referencesSchema,obligations:{...referencesSchema,minItems:1}}},
    units:{type:"array",maxItems:1000,items:{type:"object",additionalProperties:false,required:["bookingConstraintId","sourceDigest","coverage","relations","rationale","evidenceRefs"],properties:{bookingConstraintId:textSchema,segmentId:textSchema,sourceDigest:textSchema,coverage:{type:"string",enum:["complete","partial","unknown"]},rationale:textSchema,evidenceRefs:referencesSchema,
      relations:{type:"array",maxItems:1000,items:{type:"object",additionalProperties:false,required:["id","scope","targets","role","operations","rationale","evidenceRefs"],properties:{id:textSchema,scope:{type:"string",enum:["occurrence","place_global","dependency"]},role:{type:"string",enum:["direct_commitment","resource_dependency","itinerary_context"]},direction:{type:"string",enum:["booking_depends_on_targets"]},operations:{type:"array",minItems:1,maxItems:4,items:{type:"string",enum:["remove","move","add","priority"]}},rationale:textSchema,evidenceRefs:{...referencesSchema,minItems:1},
        targets:{type:"array",minItems:1,maxItems:1000,items:{anyOf:[
          {type:"object",additionalProperties:false,required:["kind","dayId","placeId"],properties:{kind:{const:"occurrence",type:"string"},dayId:textSchema,blockId:textSchema,placeId:textSchema}},
          {type:"object",additionalProperties:false,required:["kind","placeId"],properties:{kind:{const:"place_global",type:"string"},placeId:textSchema}},
          {type:"object",additionalProperties:false,required:["kind","movementId"],properties:{kind:{const:"movement",type:"string"},movementId:textSchema}}
        ]}}
      }}}
    }}}
  }
} as const;
