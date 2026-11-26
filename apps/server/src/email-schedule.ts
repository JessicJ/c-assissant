import { parseEmailTiming, type EmailTimingOpportunity, type EmailTimingRequest, type EmailTimingResult } from "@c-assistant/agent-adapters";
import { createHash } from "node:crypto";
import type { Plan } from "@c-assistant/core";
import type { EmailJob, EmailSettings } from "@c-assistant/storage";
import { compileExecutionItinerary, executionToken, type ExecutionActivity } from "./execution-itinerary.js";
import { localDateTimeInstant } from "./arrival-reminder.js";

export function emailLocalDate(now: Date, zone: string): string { return new Intl.DateTimeFormat("en-CA", { timeZone: zone, year: "numeric", month: "2-digit", day: "2-digit" }).format(now); }
export const emailJobId = (scope: unknown): string => createHash("sha256").update(JSON.stringify(scope)).digest("hex");
export function isEmailMeal(activity: ExecutionActivity, plan: Plan): boolean {
  const day = plan.presentation?.days.find(day => day.id === activity.dayId);
  return Boolean(day?.blocks?.some(block => block.kind === "meal" && executionToken(`${day.id}:${block.id}`) === activity.id));
}
export function emailTimingOpportunities(plan:Plan,zones:Map<string,string>):EmailTimingOpportunity[] {
  const activities=compileExecutionItinerary(plan).activities;const result:EmailTimingOpportunity[]=[];
  for(const day of plan.presentation?.days ?? []){
    const zone=day.city && zones.get(day.city.trim().toLowerCase());
    const active=activities.filter(activity=>activity.dayId===day.id && activity.time && activity.role!=="in-flight travel");
    if(!day.date || !zone || !active.length)continue;
    result.push({id:`morning:${day.id}`,kind:"morning",date:day.date,timeZone:zone,title:day.title ?? plan.title,plannedTime:active[0]!.time!,timeKind:"planned",earliestLocal:`${day.date}T00:00`,deadlineLocal:`${day.date}T23:59`});
    for(const activity of active){
      const timeZone=zones.get(activity.city.trim().toLowerCase());if(!timeZone)continue;
      const kind=isEmailMeal(activity,plan)?"dining":activity.needsMovement||activity.isTransfer?"transfer":undefined;
      if(!kind)continue;
      const previous=new Date(`${activity.date}T12:00:00Z`);previous.setUTCDate(previous.getUTCDate()-1);
      result.push({id:activity.id,kind,date:activity.date,timeZone,title:activity.title,plannedTime:activity.time!,timeKind:activity.timeStatus ?? "planned",earliestLocal:`${previous.toISOString().slice(0,10)}T${activity.time}`,deadlineLocal:`${activity.date}T${activity.time}`,...(activity.travelMinutes?{travelMinutes:activity.travelMinutes}:{})});
    }
  }
  return result;
}
export function validateEmailTiming(request:EmailTimingRequest,result:EmailTimingResult):void {
  const parsed=parseEmailTiming(JSON.stringify(result),request);
  for(const decision of parsed.decisions){
    if(!decision.sendAtLocal)continue;
    const opportunity=request.opportunities.find(item=>item.id===decision.id)!;
    const due=localDateTimeInstant(decision.sendAtLocal,opportunity.timeZone);
    const earliest=localDateTimeInstant(opportunity.earliestLocal,opportunity.timeZone);
    const deadline=localDateTimeInstant(opportunity.deadlineLocal,opportunity.timeZone);
    if(!due || !earliest || !deadline || due<earliest || due>=deadline)throw new Error("Email timing exceeds the approved itinerary window");
    if(opportunity.travelMinutes && opportunity.kind==="transfer" && deadline.getTime()-due.getTime()<opportunity.travelMinutes*60_000)throw new Error("Email timing leaves insufficient verified travel time");
  }
}
export function scheduledEmailJobs(plan: Plan, settings: EmailSettings, zones: Map<string,string>, now:Date, timing:EmailTimingResult):Array<Omit<EmailJob,"status"|"attempts"|"retryAt">>{
  if(plan.status!=="active")return [];
  const request={opportunities:emailTimingOpportunities(plan,zones),now:now.toISOString()};validateEmailTiming(request,timing);
  return timing.decisions.flatMap(decision=>{
    if(!decision.sendAtLocal)return [];
    const opportunity=request.opportunities.find(item=>item.id===decision.id)!;
    const due=localDateTimeInstant(decision.sendAtLocal,opportunity.timeZone)!;const deadline=localDateTimeInstant(opportunity.deadlineLocal,opportunity.timeZone)!;
    if(now>=deadline)return [];
    return [{id:emailJobId([plan.id,plan.version,settings.revision,opportunity.id,opportunity.kind]),planId:plan.id,planVersion:plan.version,kind:opportunity.kind,date:opportunity.date,dueAt:due.toISOString(),expiresAt:deadline.toISOString(),recipientRevision:settings.revision,...(opportunity.kind!=="morning"?{activityId:opportunity.id}:{})}];
  });
}
