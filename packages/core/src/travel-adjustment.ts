import type { Plan } from './index.js';
import type { TripBlueprint } from './trip-blueprint.js';
import { tripBlueprintIntegrityIssues } from './trip-blueprint.js';
import { WorkspaceMutationError } from './workspace-mutation-error.js';
import { bookingRelationshipAssessmentIssues, bookingRelationshipSourceUnits } from './booking-relationship.js';

export interface TravelVersion { id: string; version: number }
export interface TravelPhase {
  execution?: TravelVersion;
  value: 'pre_departure'|'on_trip'|'ended'|'unknown'; revision: number;
  basis: 'traveler_statement'|'verified_actual_fact'|'unresolved'; recordedAt: string; evidenceRefs: string[];
  agent?: { agentId: string; modelId: string; executionRef: string; rationale: string };
}
export interface TravelAdjustmentContext {
  execution: TravelVersion|null; blueprint: TravelVersion|null; draft: TravelVersion|null; draftBlueprint: TravelVersion|null;
  phase: TravelPhase; sourceSetDigest: string; observationSetDigest: string; authorizationDigest: string; recipientRevision: number;
}
export type TravelAdjustmentCandidate =
  | {kind:'venue';name:string;city:string;latitude?:number;longitude?:number;matches:Array<{placeId?:string;name:string;city:string;latitude?:number;longitude?:number;status:'operational'|'temporarily_closed'|'permanently_closed'|'unknown'}>;queryObservedAt:string|null}
  | {kind:'weather_current';locationName:string;condition:string;observedAt:string|null;latitude?:number;longitude?:number;conditionCode?:string;temperatureC?:number;feelsLikeC?:number;humidityPercent?:number;windDirection?:string;windScale?:string;precipitationMm?:number}
  | {kind:'weather_forecast';locationName:string;date:string;conditionDay:string;conditionNight:string;latitude?:number;longitude?:number;highC?:number;lowC?:number;precipitationMm?:number;uvIndex?:number}
  | {kind:'saved_booking';bookingId:string;segmentId:string;status:string;segmentStatus:string;bookingConstraintStrength:'hard'|'soft'|'ignored';segmentConstraintStrength:'hard'|'soft'|'ignored';fixedCommitment:boolean;startAtLocal?:string;startTimeZone?:string;endAtLocal?:string;endTimeZone?:string};
export interface TravelAdjustmentObservation {
  key: string; fingerprint: string|null; objectRef: string;
  sourceKind: 'venue'|'weather_current'|'weather_forecast'|'saved_booking'; provider: string;
  targetDate: string|null; timeZone: string|null; factObservedAt: string|null; retrievedAt: string; validUntil: string|null;
  sourceRevision?: string; candidate?: TravelAdjustmentCandidate;
  status: 'changed'|'unchanged'|'unknown'|'failed'|'expired'|'ambiguous'|'uncovered'; reason: string; evidenceRefs: string[];
}
export interface TravelAdjustmentDecision {
  verdict: 'eligible'|'ineligible'|'unresolved'; changeKind: 'objective_disruption'|'subjective_preference'|'none'|'unknown';
  agentId: string|null; modelId: string|null; executionRef: string|null; rationale: string; obligations: string[]; evidenceRefs: string[];
}
export interface TravelAdjustmentInput {
  requestId: string; context: TravelAdjustmentContext; observations: TravelAdjustmentObservation[]; decision?: TravelAdjustmentDecision;
  replacement?: { planId: string; version: number; blueprintVersion: number; proposalDigest: string }; now: string;
}
export interface TravelAdjustmentEvent { key: string; eventId: string; episode: number; fingerprint: string|null; status: 'open'|'recovered'|'expired' }
export interface TravelAdjustmentHandoff {
  intentId: string; requestId: string; status: 'pending'|'acknowledged'; reason: string; arrangementRef: string;
  base: { plan: TravelVersion; blueprint: TravelVersion }; replacement: { plan: TravelVersion; blueprint: TravelVersion };
  basis: 'objective_change'|'user_confirmation'; arrangement: {plan: Plan; blueprint: TripBlueprint};
  invalidateOldPending: true; updateFutureWork: true; readbackRef: string|null;
}
export interface TravelAdjustmentReceipt {
  requestId: string; status: 'observed'|'unresolved'|'applied'|'rejected'; reason: string; events: TravelAdjustmentEvent[];
  applicationKey?: string; appliedAt?: string; basis?: 'objective_change'|'user_confirmation'; proposalDigest?: string; validationRef?: string; receiptRef?: string; handoff?: TravelAdjustmentHandoff;
}
const text = (v: unknown): v is string => typeof v === 'string' && v.trim().length > 0;
const instant = (v: unknown): v is string => text(v) && /^\d{4}-\d\d-\d\dT/.test(v) && Number.isFinite(Date.parse(v));
const texts = (v: unknown): v is string[] => Array.isArray(v) && v.every(text) && new Set(v).size === v.length;
const allowed = (value: object, names: string[]) => Object.keys(value).every(k=>names.includes(k));
const bounded = (value: unknown, max: number) => text(value) && value.length<=max;
function assertCandidate(candidate:TravelAdjustmentCandidate,kind:string):void {
  const fail=()=>{throw new Error('旅行来源候选结构无效。');};
  if(!candidate||typeof candidate!=='object'||candidate.kind!==kind)fail();
  const value=candidate as unknown as Record<string,unknown>;
  const common=['kind','latitude','longitude'];
  const ranges:Record<string,[number,number]>={latitude:[-90,90],longitude:[-180,180],humidityPercent:[0,100],precipitationMm:[0,Infinity],uvIndex:[0,Infinity]};
  const numbers=['latitude','longitude','temperatureC','feelsLikeC','humidityPercent','precipitationMm','highC','lowC','uvIndex'];
  let fields:string[]=[];let required:string[]=[];
  switch(candidate.kind){
    case 'venue':fields=[...common,'name','city','matches','queryObservedAt'];required=['name','city'];
      if(!Array.isArray(candidate.matches)||candidate.matches.length>8||candidate.matches.some(m=>!m||!allowed(m,['placeId','name','city','latitude','longitude','status'])||!bounded(m.name,240)||!bounded(m.city,120)||m.placeId!==undefined&&!bounded(m.placeId,160)||!['operational','temporarily_closed','permanently_closed','unknown'].includes(m.status)||m.latitude!==undefined&&(!Number.isFinite(m.latitude)||Math.abs(m.latitude)>90)||m.longitude!==undefined&&(!Number.isFinite(m.longitude)||Math.abs(m.longitude)>180))||!(candidate.queryObservedAt===null||instant(candidate.queryObservedAt)))fail();break;
    case 'weather_current':fields=[...common,'locationName','condition','observedAt','conditionCode','temperatureC','feelsLikeC','humidityPercent','windDirection','windScale','precipitationMm'];required=['locationName','condition'];if(!(candidate.observedAt===null||instant(candidate.observedAt)))fail();break;
    case 'weather_forecast':fields=[...common,'locationName','date','conditionDay','conditionNight','highC','lowC','precipitationMm','uvIndex'];required=['locationName','conditionDay','conditionNight'];if(!/^\d{4}-\d\d-\d\d$/.test(candidate.date)||!Number.isFinite(Date.parse(candidate.date))||new Date(candidate.date).toISOString().slice(0,10)!==candidate.date)fail();break;
    case 'saved_booking':fields=['kind','bookingId','segmentId','status','segmentStatus','bookingConstraintStrength','segmentConstraintStrength','fixedCommitment','startAtLocal','startTimeZone','endAtLocal','endTimeZone'];required=['bookingId','segmentId','status','segmentStatus'];if(!['hard','soft','ignored'].includes(candidate.bookingConstraintStrength)||!['hard','soft','ignored'].includes(candidate.segmentConstraintStrength)||typeof candidate.fixedCommitment!=='boolean')fail();break;
    default:fail();
  }
  if(!allowed(value,fields))fail();
  const maxFor=(key:string)=>['bookingId','segmentId'].includes(key)?160:key==='city'?120:['conditionCode','windDirection','windScale','status','segmentStatus','bookingConstraintStrength','segmentConstraintStrength','fixedCommitment','startAtLocal','startTimeZone','endAtLocal','endTimeZone'].includes(key)?80:240;
  if(required.some(k=>!bounded(value[k],maxFor(k))))fail();
  for(const [key,v] of Object.entries(value)){
    if(numbers.includes(key)){if(typeof v!=='number'||!Number.isFinite(v)||ranges[key]&&(v<ranges[key]![0]||v>ranges[key]![1]))fail();}
    else if(!['kind','matches','queryObservedAt','observedAt','date','fixedCommitment'].includes(key)&&!bounded(v,maxFor(key)))fail();
  }
}
export function assertTravelPhase(phase: TravelPhase): void {
  if (!phase || !allowed(phase,['execution','value','revision','basis','recordedAt','evidenceRefs','agent']) || !['pre_departure','on_trip','ended','unknown'].includes(phase.value) || !Number.isSafeInteger(phase.revision) || phase.revision < 0 || !instant(phase.recordedAt) || !texts(phase.evidenceRefs)) throw new Error('旅行阶段结构无效。');
  if (phase.value === 'unknown' ? phase.basis !== 'unresolved' : !['traveler_statement','verified_actual_fact'].includes(phase.basis) || !phase.evidenceRefs.length) throw new Error('旅行阶段缺少实际依据。');
  if(phase.evidenceRefs.length>64||phase.evidenceRefs.some(v=>v.length>1000))throw new Error('旅行阶段证据超过安全长度。');
  if(phase.agent&&(!allowed(phase.agent,['agentId','modelId','executionRef','rationale'])||![phase.agent.agentId,phase.agent.modelId,phase.agent.executionRef].every(v=>bounded(v,240))||!bounded(phase.agent.rationale,4000)))throw new Error('旅行阶段负责身份无效。');
  if (phase.basis === 'verified_actual_fact' && (!phase.agent || ![phase.agent.agentId,phase.agent.modelId,phase.agent.executionRef,phase.agent.rationale].every(text))) throw new Error('实际旅行事实缺少负责判断。');
}
export function assertTravelAdjustmentInput(input: TravelAdjustmentInput): void {
  if (!input || !text(input.requestId) || !instant(input.now) || !input.context || !Array.isArray(input.observations) || !input.observations.length || input.observations.length>256) throw new Error('旅行观察结构无效。');
  if(!allowed(input,['requestId','context','observations','decision','replacement','now'])||!bounded(input.requestId,240))throw new Error('旅行请求包含不支持的字段。');
  const c=input.context;
  if(!allowed(c,['execution','blueprint','draft','draftBlueprint','phase','sourceSetDigest','observationSetDigest','authorizationDigest','recipientRevision'])||![c.sourceSetDigest,c.observationSetDigest,c.authorizationDigest].every(v=>typeof v==='string'&&/^[a-f0-9]{64}$/.test(v))||!Number.isSafeInteger(c.recipientRevision)||c.recipientRevision<0)throw new Error('旅行上下文结构无效。');
  for(const v of [c.execution,c.blueprint,c.draft,c.draftBlueprint])if(v!==null&&(!v||!allowed(v,['id','version'])||!bounded(v.id,240)||!Number.isSafeInteger(v.version)||v.version<1))throw new Error('旅行版本结构无效。');
  assertTravelPhase(input.context.phase);
  if (new Set(input.observations.map(o=>o.key)).size !== input.observations.length) throw new Error('旅行观察身份重复。');
  for (const o of input.observations) {
    if(!o||!allowed(o,['key','fingerprint','objectRef','sourceKind','provider','targetDate','timeZone','factObservedAt','retrievedAt','validUntil','sourceRevision','status','reason','evidenceRefs','candidate']))throw new Error('旅行来源包含不支持的字段。');
    if(o.candidate)assertCandidate(o.candidate,o.sourceKind);
    if([o.key,o.objectRef,o.provider,o.sourceRevision??''].some(v=>typeof v!=='string'||v.length>240)||typeof o.reason!=='string'||o.reason.length>2000||!Array.isArray(o.evidenceRefs)||o.evidenceRefs.length>64||o.evidenceRefs.some(v=>typeof v!=='string'||v.length>1000)||o.fingerprint!=null&&(typeof o.fingerprint!=='string'||o.fingerprint.length>240))throw new Error('旅行来源超过安全长度。');
    if (!o || ![o.key,o.objectRef,o.provider,o.reason].every(text) || !(o.fingerprint == null || typeof o.fingerprint === 'string') || !['venue','weather_current','weather_forecast','saved_booking'].includes(o.sourceKind) || !['changed','unchanged','unknown','failed','expired','ambiguous','uncovered'].includes(o.status) || !instant(o.retrievedAt) || !texts(o.evidenceRefs) || !(o.factObservedAt === null || instant(o.factObservedAt)) || !(o.validUntil === null || instant(o.validUntil))) throw new Error('旅行来源结构无效。');
    if (o.sourceKind === 'saved_booking' && !text(o.sourceRevision)) throw new Error('保存预订缺少源修订。');
    if (['changed','unchanged'].includes(o.status)) {
      if (!text(o.targetDate) || !/^\d{4}-\d\d-\d\d$/.test(o.targetDate) || new Date(o.targetDate).toISOString().slice(0,10)!==o.targetDate || !text(o.timeZone) || !instant(o.factObservedAt) || !instant(o.validUntil) || !o.evidenceRefs.length) throw new Error('可靠旅行来源缺少适用证据。');
      try { new Intl.DateTimeFormat('en',{timeZone:o.timeZone}); } catch { throw new Error('旅行来源时区无效。'); }
      if (Date.parse(o.retrievedAt)>Date.parse(input.now)+300_000 || Date.parse(o.factObservedAt)>Date.parse(input.now)+300_000) throw new Error('旅行来源已失效。');
    }
  }
  if(input.replacement&&(!allowed(input.replacement,['planId','version','blueprintVersion','proposalDigest'])||!bounded(input.replacement.planId,240)||!Number.isSafeInteger(input.replacement.version)||input.replacement.version<1||!Number.isSafeInteger(input.replacement.blueprintVersion)||input.replacement.blueprintVersion<1||!/^[a-f0-9]{64}$/.test(input.replacement.proposalDigest)))throw new Error('替代安排身份结构无效。');
  const d=input.decision;
  if(d&&(!allowed(d,['verdict','changeKind','agentId','modelId','executionRef','rationale','obligations','evidenceRefs'])||!bounded(d.rationale,4000)||!Array.isArray(d.obligations)||d.obligations.length>64||d.obligations.some(v=>!bounded(v,1000))||!Array.isArray(d.evidenceRefs)||d.evidenceRefs.length>64||d.evidenceRefs.some(v=>!bounded(v,1000))))throw new Error('旅行判断包含不支持的内容。');
  if (d && (!['eligible','ineligible','unresolved'].includes(d.verdict) || !['objective_disruption','subjective_preference','none','unknown'].includes(d.changeKind) || !text(d.rationale) || !texts(d.obligations) || !texts(d.evidenceRefs) || ![d.agentId,d.modelId,d.executionRef].every(v=>v===null||text(v)))) throw new Error('旅行判断结构无效。');
  if (d?.verdict==='eligible' && (![d.agentId,d.modelId,d.executionRef].every(text) || !d.obligations.length || !d.evidenceRefs.length)) throw new Error('旅行判断缺少负责执行与证据。');
}
/** 缺失事件身份仍可保存为未决观察，但不得成为自动候选或应用依据。 */
export function travelAdjustmentEventIdentityBlocker(observations: TravelAdjustmentObservation[]): string|undefined {
  if (observations.some(o=>o.status==='changed'&&!text(o.fingerprint))) return '旅行变化缺少可持久消费的事件身份。';
  return undefined;
}
/** 仅校验负责 Agent 已给出的决定，绝不以静态规则生成语义决定。 */
export function travelAdjustmentApplicationBlocker(input: TravelAdjustmentInput, publicExecutionVerified: boolean): string|undefined {
  const identityBlocker=travelAdjustmentEventIdentityBlocker(input.observations);
  if(identityBlocker)return identityBlocker;
  if (input.context.phase.value !== 'on_trip') return '旅行阶段不允许自动应用。';
  if (!input.decision || input.decision.verdict !== 'eligible' || input.decision.changeKind !== 'objective_disruption') return '尚无可靠客观变化的负责判断。';
  if (!publicExecutionVerified) return '缺少经验证的公开判断执行合同。';
  if (input.observations.some(o=>!['changed','unchanged'].includes(o.status)) || !input.observations.some(o=>o.status==='changed')) return '来源覆盖仍有未决事项。';
  if (!input.replacement) return '尚无完整替代安排。';
  return undefined;
}
/** 复用 Blueprint 完整性、交通邻接与预订关系规范，不接受 validationRef 充当校验。 */
export function assertTravelAdjustmentReplacement(base: TripBlueprint, replacement: TripBlueprint, timeZones: Record<string,string>, options:{requireCompleteTiming?:boolean}={}): void {
  const reject=(message:string):never=>{throw new WorkspaceMutationError(message,'activation_review_required');};
  if(tripBlueprintIntegrityIssues(replacement).length)reject('替代安排结构不完整，请先修正并重新审阅。');
  if (base.id !== replacement.id || base.proposalRef.sessionId !== replacement.proposalRef.sessionId || base.startDate !== replacement.startDate || base.endDate !== replacement.endDate) reject('替代安排不属于同一完整旅行。');
  const units=bookingRelationshipSourceUnits(replacement.bookingConstraints??[]);
  if (units.length && (!replacement.bookingRelationshipAssessment || replacement.bookingRelationshipAssessment.status!=='reviewed' || bookingRelationshipAssessmentIssues(replacement,replacement.bookingRelationshipAssessment,true,{allowEquivalentReviewedVersion:true}).length || replacement.bookingRelationshipAssessment.units.some(unit=>unit.coverage!=='complete'))) reject('替代安排的预订关系尚未完整审阅。');
  for (const unit of bookingRelationshipSourceUnits(base.bookingConstraints??[])) if (!units.some(next=>next.bookingConstraintId===unit.bookingConstraintId && next.segmentId===unit.segmentId)) reject('替代安排改变了尚未解决的预订承诺。');
  const assertDuration=(duration:unknown)=>{
    if(duration!==undefined&&(typeof duration!=='number'||!Number.isFinite(duration)||duration<0||duration>1440))reject('替代安排占时必须是有限、非负且不超过一天的分钟数。');
  };
  for(const place of replacement.places)assertDuration(place.durationMinutes);
  for (const day of replacement.days) {
    const clock=(value:string|undefined)=>value&&/^([01]\d|2[0-3]):[0-5]\d$/.test(value)?Number(value.slice(0,2))*60+Number(value.slice(3)):undefined;
    const effectiveEnd=(start:number|undefined,duration:number|undefined,end?:string)=>{
      assertDuration(duration);
      const finish=clock(end)??(start!==undefined&&duration!==undefined?start+duration:undefined);
      if(finish!==undefined&&(finish>=1440||start!==undefined&&finish<start))reject('替代安排活动时间区间倒置或跨出当地日期，须先明确核实。');
      return finish;
    };
    for(const block of day.blocks??[])effectiveEnd(clock(block.startTime),block.durationMinutes??replacement.places.find(place=>place.id===block.placeId)?.durationMinutes,block.endTime);
    const timed=(day.blocks?.length?[...day.blocks].sort((a,b)=>a.order-b.order).filter(b=>!['optional','replacement','excluded'].includes(b.planRole??'')).map(b=>({placeId:b.placeId,physical:b.kind!=='transfer'&&b.kind!=='flexible',start:clock(b.startTime),end:effectiveEnd(clock(b.startTime),b.durationMinutes??replacement.places.find(place=>place.id===b.placeId)?.durationMinutes,b.endTime)})):[...day.stops].sort((a,b)=>a.order-b.order).map(stop=>({placeId:stop.placeId,physical:true,start:clock(stop.time),end:effectiveEnd(clock(stop.time),replacement.places.find(place=>place.id===stop.placeId)?.durationMinutes)})));
    if(options.requireCompleteTiming!==false&&timed.some(b=>b.start===undefined||b.end===undefined))reject('替代安排的活动时间尚未完整核实。');
    for(let i=1;i<timed.length;i++)if(timed[i]!.start! < (timed[i-1]!.end??timed[i-1]!.start!))reject('替代安排存在时间重叠。');
    const anchors:typeof timed=[];
    for(const activity of timed.filter(b=>b.placeId&&b.physical)){const previous=anchors.at(-1);if(previous&&previous.placeId===activity.placeId)previous.end=activity.end;else anchors.push({...activity});}
    for(const movement of replacement.movements.filter(m=>m.dayId===day.id)){
      assertDuration(movement.durationMinutes);
      if(options.requireCompleteTiming!==false&&(movement.status!=='verified'||!Number.isFinite(movement.durationMinutes)))reject('替代安排交通尚未可靠核实。');
      const intervals=anchors.flatMap((from,index)=>{const to=anchors[index+1];return from.placeId===movement.originPlaceId&&to?.placeId===movement.destinationPlaceId?[{from,to}]:[];});
      if(!intervals.length)reject('替代安排交通缺少完整活动时间。');
      for(const {from,to} of intervals)if(from.end!==undefined&&to.start!==undefined&&to.start-from.end<movement.durationMinutes!)reject('替代安排没有足够交通时间。');
    }
    if (!timeZones[day.city]) reject('替代安排缺少旅行时区。');
    try { new Intl.DateTimeFormat('en',{timeZone:timeZones[day.city]}); } catch { reject('替代安排旅行时区无效。'); }
  }
}
