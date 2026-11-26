import { randomUUID, createHash } from "node:crypto";
import type { TravelAdjustmentObservation } from "@c-assistant/core";
import type { SqliteWorkspaceStore } from "@c-assistant/storage";
import type { ConnectorBundle } from "./connector-bundle.js";
import { compileExecutionItinerary } from "./execution-itinerary.js";
import { localDateTimeInstant } from "./arrival-reminder.js";
import { emailLocalDate } from "./email-schedule.js";
import { venueSourceCandidate } from "./plan-venue-monitor.js";

type Observation = TravelAdjustmentObservation;
const digest = (value: unknown) => createHash("sha256").update(JSON.stringify(value)).digest("hex");
const instant = (value: string | undefined): string | null => value && Number.isFinite(Date.parse(value)) ? value : null;
// 仅保存 Connector 白名单中的公开天气描述；额外字段与错误原文不进入观察。
const weatherCode = (value: string | undefined) => value && /^[a-zA-Z0-9_ -]{1,80}$/.test(value) ? value : "UNKNOWN";
const weatherDescription = (value: unknown) => typeof value === "string" && value.trim().length > 0 && value.trim().length <= 240 ? value.trim() : "Weather description unavailable";
const numericFacts = (value: Record<string, unknown>, keys: string[]) => Object.fromEntries(keys.flatMap(key => typeof value[key] === "number" && Number.isFinite(value[key]) && (!['precipitationMm','uvIndex','humidityPercent'].includes(key) || (value[key] as number)>=0) && (key!=="humidityPercent" || (value[key] as number)<=100) ? [[key,value[key]]] : []));

/** 来源采集只组织候选；缺少经验证的公共判断合同，不能发送警告或推断恢复。 */
export function createEmailAttentionMonitor(dependencies: {
  store: SqliteWorkspaceStore;
  getConnectors: () => Pick<ConnectorBundle, "maps" | "googleWeather">;
  now?: () => Date;
}) {
  let busy = false;
  const checkedAt: Partial<Record<"journey" | "venue", {scope:string;at:number}>> = {};
  async function run(mode: "journey" | "venue", zones: Map<string, string>) {
    const { store } = dependencies;
    const plan = store.getExecutionPlan();
    const settings = store.email.settings();
    if (busy || !plan || plan.status !== "active" || !settings.enabled || !settings.verified || !store.email.usesEmail(plan.id, plan.version)) return;
    const now = dependencies.now?.() ?? new Date();
    const context = store.captureAdjustmentContext();
    if (!context) return;
    // 自己保存的观察不改变采集范围；版本、来源、阶段、授权或实际时区变化则立即重查。
    const {observationSetDigest: _observations, ...scopeContext} = context;
    const scope = digest({context:scopeContext,zones:[...zones].sort(([left],[right])=>left.localeCompare(right))});
    const checked = checkedAt[mode];
    if (checked?.scope===scope && now.getTime()-checked.at < (mode === "venue" ? 30 : 5) * 60_000) return;
    busy = true;
    const observations: Observation[] = [];
    try {
      let connectors: ReturnType<typeof dependencies.getConnectors> | undefined;
      try { connectors = dependencies.getConnectors(); } catch { /* 每个受影响活动保存安全来源失败，预订仍可读取。 */ }
      const places = new Map(plan.presentation?.places.map(place => [place.id, place]));
      const itinerary = compileExecutionItinerary(plan);
      for (const gap of itinerary.gaps) observations.push({key: `${mode}:gap:${digest(gap)}`,objectRef:`plan:${plan.id}:${plan.version}`,sourceKind:mode === "venue" ? "venue" : "weather_current",provider:"计划保存记录",targetDate:null,timeZone:null,factObservedAt:null,retrievedAt:now.toISOString(),validUntil:null,fingerprint:null,status:"uncovered",reason:"活动日期、地点或时间结构不完整，未覆盖",evidenceRefs:[]});
      for (const activity of itinerary.activities) {
        const zone = zones.get(activity.city.trim().toLowerCase());
        const place = places.get(activity.placeId ?? "");
        const at = zone && activity.time ? localDateTimeInstant(`${activity.date}T${activity.time}`, zone) : undefined;
        const observation: Observation = {key:`${mode}:${activity.id}`,objectRef:place ? `place:${place.id}` : `activity:${activity.id}`,sourceKind:mode === "venue" ? "venue" : "weather_current",provider:mode === "venue" ? "google_maps" : "google_weather",targetDate:activity.date,timeZone:zone ?? null,factObservedAt:null,retrievedAt:now.toISOString(),validUntil:at?.toISOString() ?? null,fingerprint:null,status:"uncovered",reason:"活动缺少地点、时区或确定时刻，未覆盖",evidenceRefs:[]};
        observations.push(observation);
        if (!zone || !place || !activity.time || !at) {
          if (zone && activity.time && !at) observation.reason = "活动当地时刻或时区无效，未覆盖";
          continue;
        }
        if (at <= now) { observation.reason = "计划活动窗口已过，不能推断实际完成"; continue; }
        try {
          if (mode === "venue" && activity.date > emailLocalDate(new Date(now.getTime() + 14 * 86400_000), zone)) { observation.reason = "超出十四天查询范围"; continue; }
          if (!connectors) { observation.status="failed"; observation.reason="来源初始化失败，保留上次可靠观察"; continue; }
          if (mode === "venue") {
            const result = await connectors.maps.searchPlaces({query:place.name,region:activity.city,limit:3});
            observation.retrievedAt = (dependencies.now?.() ?? new Date()).toISOString();
            const candidate = venueSourceCandidate(place, activity.city, result, dependencies.now?.() ?? new Date());
            Object.assign(observation, candidate);
          } else {
            if (!place.coordinates) { observation.reason = "地点缺少坐标，未查询天气"; continue; }
            const result = await connectors.googleWeather.weather({coordinates:[...place.coordinates].reverse().join(","),locationName:place.name});
            observation.retrievedAt = (dependencies.now?.() ?? new Date()).toISOString();
            if (result.status !== "available" || !result.data) { observation.status="failed";observation.reason="天气来源不可用，保留上次可靠观察";continue; }
            const weather = result.data;
            observation.provider = result.provider ?? "google_weather";
            observation.retrievedAt = instant(weather.retrievedAt) ?? observation.retrievedAt;
            const returnedAt = dependencies.now?.() ?? new Date();
            const currentWindow = at.getTime() - returnedAt.getTime() <= 60 * 60_000 && activity.date === emailLocalDate(returnedAt,zone);
            if (!currentWindow) {
              observation.sourceKind="weather_forecast";
              const forecast=weather.daily.find(item=>item.date===activity.date);
              if (forecast) observation.candidate={kind:"weather_forecast",locationName:place.name.trim().slice(0,240)||"未知地点",date:forecast.date,conditionDay:weatherDescription(forecast.conditionDay),conditionNight:weatherDescription(forecast.conditionNight),...numericFacts(forecast as unknown as Record<string,unknown>,["highC","lowC","precipitationMm","uvIndex"])};
              observation.fingerprint=observation.candidate ? digest(observation.candidate) : null;
              observation.reason=forecast ? "日期匹配预报仅为候选；来源未提供独立事实观察时间与有效期，待核实" : "目标日期无预报，当前天气不能代替远期预报";
              observation.status=forecast ? "unknown" : "uncovered";
              continue;
            }
            observation.factObservedAt=instant(weather.current.observedAt);
            observation.candidate={kind:"weather_current",locationName:place.name.trim().slice(0,240)||"未知地点",condition:weatherDescription(weather.current.condition),conditionCode:weatherCode(weather.current.conditionCode),observedAt:observation.factObservedAt,...numericFacts(weather.current as unknown as Record<string,unknown>,["temperatureC","feelsLikeC","humidityPercent","precipitationMm"])};
            const age=observation.factObservedAt ? returnedAt.getTime()-Date.parse(observation.factObservedAt) : NaN;
            if (!Number.isFinite(age) || age < -300_000) {observation.status="unknown";observation.reason="天气事实时间缺失或超前";continue;}
            observation.validUntil=new Date(Math.min(at.getTime(),Date.parse(observation.factObservedAt!)+60*60_000)).toISOString();
            if(age>60*60_000) {observation.status="expired";observation.reason="当前天气来源过期，不推断正常或恢复";continue;}
            observation.fingerprint=digest(observation.candidate);
            observation.status="unknown";observation.reason="当前天气为候选；缺少经验证的公共 Agent 判断，影响与恢复未决";
          }
        } catch {
          observation.status="failed";observation.reason="来源查询失败，保留上次可靠观察";
        }
      }
      if (mode === "journey") for (const booking of store.listCurrentTravelBookingSourcesForPlan(plan.id)) {
        for (const segment of booking.segments) {
          const start=segment.startAtLocal && segment.startTimeZone ? localDateTimeInstant(segment.startAtLocal,segment.startTimeZone) : undefined;
          const ignored=booking.constraintStrength === "ignored" || segment.constraintStrength === "ignored";
          const candidate: NonNullable<Observation["candidate"]>={kind:"saved_booking",bookingId:booking.id,segmentId:segment.id,status:booking.status,segmentStatus:segment.status,bookingConstraintStrength:booking.constraintStrength,segmentConstraintStrength:segment.constraintStrength,fixedCommitment:segment.fixedCommitment,...(segment.startAtLocal?{startAtLocal:segment.startAtLocal}:{}),...(segment.startTimeZone?{startTimeZone:segment.startTimeZone}:{}),...(segment.endAtLocal?{endAtLocal:segment.endAtLocal}:{}),...(segment.endTimeZone?{endTimeZone:segment.endTimeZone}:{})};
          const fingerprint=digest(candidate);
          observations.push({key:`booking:${booking.id}:${segment.id}`,objectRef:`booking:${booking.id}:segment:${segment.id}`,sourceKind:"saved_booking",provider:"本地保存预订记录",targetDate:segment.startAtLocal?.slice(0,10) ?? null,timeZone:segment.startTimeZone ?? null,factObservedAt:instant(booking.updatedAt),retrievedAt:(dependencies.now?.() ?? new Date()).toISOString(),validUntil:start?.toISOString() ?? null,sourceRevision:digest({updatedAt:booking.updatedAt,sourceHash:booking.sourceHash,fingerprint}),candidate,fingerprint,status:ignored || !start || start<=now ? "uncovered" : "unknown",reason:ignored ? "预订或分段已忽略" : !start ? "预订分段时间或时区缺失或无效" : start<=now ? "预订分段窗口已过，不推断实际完成" : booking.status === "cancelled" || segment.status === "cancelled" ? "保存预订取消候选；非实时供应商核实，待 Agent 判断" : "保存预订基线或修订候选；非实时供应商核实，不能凭指纹判断变化或恢复",evidenceRefs:[`saved-booking:${booking.id}:${segment.id}`]});
        }
      }
      const committedAt=dependencies.now?.() ?? new Date();
      // 后续活动的慢查询也可能使先前结果失效；提交前统一重查。
      for (const observation of observations) {
        if (observation.validUntil && Date.parse(observation.validUntil)<=committedAt.getTime() && observation.status!=="uncovered") {
          observation.status="expired"; observation.reason="来源或活动有效窗口已过，不推断恢复或实际完成";
        }
        if (observation.candidate?.kind==="venue" && observation.candidate.queryObservedAt && committedAt.getTime()-Date.parse(observation.candidate.queryObservedAt)>86400_000) {
          observation.status="expired"; observation.reason="场馆查询结果在提交前过期，不推断恢复";
        }
      }
      const receipt = observations.length ? store.commitTravelAdjustment({requestId:randomUUID(),context,observations,now:committedAt.toISOString()}) : undefined;
      if (connectors && receipt?.status!=="rejected" && !observations.some(item=>item.status==="failed")) checkedAt[mode]={scope,at:now.getTime()};
    } finally {busy=false;}
  }
  return {run};
}
