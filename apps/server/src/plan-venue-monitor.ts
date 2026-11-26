import { createHash } from "node:crypto";
import type { ConnectorResult, PlaceFact } from "@c-assistant/connectors";
import type { TravelAdjustmentCandidate, PlanPlace } from "@c-assistant/core";

/** 名称和坐标只缩小候选集合，不证明地点身份或未来营业适用性。 */
export function venueSourceCandidate(place: PlanPlace, city: string, result: ConnectorResult<PlaceFact[]>, now: Date) {
  const base = {fingerprint:null as string | null,factObservedAt:null as string | null,status:"unknown" as "unknown"|"failed"|"expired"|"ambiguous",reason:"场馆候选待负责 Agent 核实身份和目标日期适用性",evidenceRefs:[] as string[]};
  if(result.status!=="available" || !result.data) return {...base,status:"failed" as const,reason:"场馆来源不可用，保留最后可靠观察"};
  const safeText=(value:string,max:number)=>value.trim().slice(0,max)||"未知";
  const matches=result.data.slice(0,8).map(candidate=>{
    const [longitude,latitude]=candidate.location.split(',').map(Number);
    return {name:safeText(candidate.name,240),city:safeText(candidate.city,120),...(candidate.id?{placeId:safeText(candidate.id,160)}:{}),status:candidate.businessStatus??"unknown",...(Number.isFinite(latitude)&&Math.abs(latitude!)<=90?{latitude}:{}),...(Number.isFinite(longitude)&&Math.abs(longitude!)<=180?{longitude}:{})};
  });
  const candidate:TravelAdjustmentCandidate={kind:"venue",name:safeText(place.name,240),city:safeText(city,120),matches,queryObservedAt:Number.isFinite(Date.parse(result.observedAt))?result.observedAt:null};
  const projected={...base,candidate};
  const age=now.getTime()-Date.parse(result.observedAt);
  if(!Number.isFinite(age) || age < -300_000) return {...projected,reason:"场馆查询时间缺失或超前；查询时间不代表事实发布时间"};
  if(age>86400_000) return {...projected,status:"expired" as const,reason:"场馆查询结果过期，不推断恢复"};
  const candidates=result.data.filter(candidate=>{
    if(!sameVenue(candidate.name,place.name)) return false;
    if(!place.coordinates) return candidate.city?.toLowerCase()===(place.city ?? city).toLowerCase();
    const [longitude,latitude]=candidate.location.split(',').map(Number);
    return Number.isFinite(latitude)&&Number.isFinite(longitude)&&Math.abs(latitude!-place.coordinates[0])<.01&&Math.abs(longitude!-place.coordinates[1])<.01;
  });
  if(candidates.length!==1) return {...projected,status:"ambiguous" as const,reason:candidates.length ? "多个同名地点候选，身份未确定" : "无匹配地点候选，身份未确定"};
  const matched=candidates[0]!;
  return {...projected,fingerprint:createHash("sha256").update(JSON.stringify({id:matched.id,status:matched.businessStatus})).digest("hex"),evidenceRefs:matched.id ? [`google-place:${matched.id}`] : [],reason:"场馆营业状态仅为候选；查询时间不是事实发布时间，目标访问日期适用性待核实"};
}

function sameVenue(left: string, right: string): boolean {
  const normalize = (value: string) => value.toLocaleLowerCase().replace(/[^a-z0-9\p{L}\p{N}]+/gu, "");
  const a = normalize(left);
  const b = normalize(right);
  return Boolean(a && b && (a === b || a.includes(b) || b.includes(a)));
}
