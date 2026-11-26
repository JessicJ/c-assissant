import type { Plan, TripBlueprint } from "@c-assistant/core";
import type { EmailJob, EmailDeliveryContent, EmailReviewScope, SqliteWorkspaceStore } from "@c-assistant/storage";
import { type EmailReviewConfiguration } from "./email-review-capability.js";
import { renderChangeEmail } from "./email-templates/index.js";
import { emailJobId } from "./email-schedule.js";
import { prepareAgentEmailTiming } from "./email-agent-timing.js";
import { normalizeCity } from "./itinerary-departure-reminder.js";

export function pendingEmailReview(store:SqliteWorkspaceStore): EmailReviewScope | undefined {
  const workspace=store.getWorkspace();const base=store.getExecutionPlan();const draft=workspace.activePlan;const audit=workspace.latestPlanReplacement;const recipient=store.email.settings();
  if(!base || base.status!=="active" || draft.status!=="draft" || base.id===draft.id || !audit || audit.sourcePlanId!==base.id || audit.sourcePlanVersion!==base.version || audit.replacementPlanId!==draft.id || !recipient.verified || !recipient.enabled)return;
  return {basePlanId:base.id,baseVersion:base.version,draftPlanId:draft.id,draftVersion:draft.version,recipientRevision:recipient.revision,...(workspace.activeBlueprint?{blueprintVersion:workspace.activeBlueprint.version}:{})};
}
const dateOf=(plan:Plan,now:Date)=>plan.presentation?.startDate ?? now.toISOString().slice(0,10);
export function enqueuePendingReview(store:SqliteWorkspaceStore,_config:EmailReviewConfiguration|undefined,now=new Date()):void {
  const scope=pendingEmailReview(store);if(!scope)return;
  const draft=store.getWorkspace().activePlan;const settings=store.email.settings();
  const content=renderChangeEmail({subject:`Review your itinerary · ${draft.title}`,preheader:"Your original itinerary remains active until you confirm a replacement.",brandLabel:"LOOKING AFTER\nYOUR JOURNEY",footer:"Landi · Your travel companion",disclosure:"Review and confirm itinerary changes in your Landi workspace.",sample:false,title:"Your revised itinerary is ready",introduction:"Open your Landi workspace to review this replacement; your original itinerary remains active until you confirm it.",impact:draft.presentation?.summary ?? draft.title,options:[{title:draft.title,description:"Compare the complete itineraries and confirm changes in your Landi workspace.",requiresConfirmation:true}],status:{kind:"proposed",explanation:"Your original itinerary is unchanged."},links:[],note:"Your original itinerary continues without check-ins."});
  store.email.enqueue({id:emailJobId(["workspace-review",scope]),planId:scope.basePlanId,planVersion:scope.baseVersion,kind:"change",date:dateOf(draft,now),dueAt:now.toISOString(),expiresAt:new Date(now.getTime()+24*60*60_000).toISOString(),recipientRevision:settings.revision,content});
}
/** Preserve historical content, but never send a retired capability or placeholder. */
export function materializeEmailReview(store:SqliteWorkspaceStore,job:EmailJob,content:EmailDeliveryContent,_config:EmailReviewConfiguration|undefined,now=new Date()):EmailDeliveryContent|undefined {
  if(content.review || /review\.landi\.invalid\/pending|\/email-review(?:[\s"'<#?]|$)/i.test(content.html+"\n"+content.text))return;
  const authorization=store.travelAdjustmentEmailAuthorization(job,now.toISOString());
  if(authorization==='rejected'||content.adjustment&&authorization!=='authorized')return;
  return content;
}
export function enqueueConfirmedReview(store:SqliteWorkspaceStore,now=new Date()):void {
  const plan=store.getExecutionPlan();const settings=store.email.settings();if(!plan || !settings.verified || !settings.enabled)return;
  if(store.getTravelAdjustmentReceiptForPlan(plan.id,plan.version)){consumeTravelAdjustmentHandoffs(store,now);return;}
  const receipt=store.email.planConfirmation(plan.id,plan.version);if(!receipt)return;
  const content=renderChangeEmail({subject:`Your itinerary is updated · ${plan.title}`,preheader:"Your confirmed itinerary is now active.",brandLabel:"LOOKING AFTER\nYOUR JOURNEY",footer:"Landi · Your travel companion",disclosure:"Your actual location is not tracked.",sample:false,title:"Your itinerary is updated",introduction:"Travel emails will follow the itinerary you confirmed.",impact:plan.presentation?.summary ?? plan.title,options:[{title:plan.title,description:"The new itinerary is active and pending emails for the old version are cancelled.",requiresConfirmation:false}],status:{kind:"confirmed",confirmedAt:new Date(receipt.confirmedAt).toISOString().replace("T", " ").replace(".000Z", " UTC"),explanation:"This confirmation does not make bookings, request rides or process payments."},links:[],note:"Travel emails follow itinerary times without arrival check-ins."});
  store.email.enqueue({id:emailJobId(["review-confirmed",plan.id,plan.version,settings.revision]),planId:plan.id,planVersion:plan.version,kind:"change",date:dateOf(plan,now),dueAt:now.toISOString(),expiresAt:new Date(now.getTime()+24*60*60_000).toISOString(),recipientRevision:settings.revision,content});
}
export function createEmailReviewDelivery(store:SqliteWorkspaceStore,_getConfiguration?:()=>EmailReviewConfiguration|undefined) {
  return (job:EmailJob,content:EmailDeliveryContent,now:Date)=>materializeEmailReview(store,job,content,undefined,now);
}

/** 系统应用只读取持久回执及其精确安排，绝不借用人工确认时间。 */
export function enqueueAppliedAdjustment(store:SqliteWorkspaceStore,requestId:string,now=new Date()):string|undefined {
  const consumption=store.getTravelAdjustmentEmailConsumption(requestId,now.toISOString());
  if(!consumption)return;
  const {receipt,arrangement:{plan,blueprint},context,confirmation}=consumption;
  if(!receipt.handoff || !receipt.appliedAt)return;
  const settings=store.email.settings();
  const zones=new Map(Object.entries(settings.cityTimeZones).map(([city,zone])=>[normalizeCity(city),zone]));
  const timing=prepareAgentEmailTiming(store,plan,zones,now);
  const arrangement=reviewArrangement(blueprint);
  const options=[...arrangement.days.map(day=>({title:`${localCalendarDate(day.date)} · ${day.city} · ${day.title}`,description:[localTimeZoneLabel(day.date,settings.cityTimeZones[day.city]??zones.get(normalizeCity(day.city))),day.summary,...day.lines].filter(Boolean).join("; "),requiresConfirmation:false})),...(arrangement.commitments.length?[{title:"Bookings and fixed commitments",description:arrangement.commitments.join("; "),requiresConfirmation:false}]:[])];
  const content=renderChangeEmail({subject:`Your itinerary is updated · ${plan.title}`,preheader:"Future reminders will follow your updated itinerary.",brandLabel:"Landi",footer:"Landi",disclosure:"Planned times do not establish actual arrival.",sample:false,title:"Your itinerary is updated",introduction:receipt.reason,impact:"Unsent reminders for the previous version are cancelled. Future reminders follow the updated itinerary and stay pending until their delivery schedule is ready.",options,status:receipt.basis==='objective_change'?{kind:"applied",appliedAt:receipt.appliedAt,explanation:"Landi updated the itinerary based on verified objective changes."}:{kind:"confirmed",confirmedAt:new Date(confirmation!.confirmedAt).toLocaleString("en-GB", { timeZoneName: "short" }),explanation:"You confirmed the updated itinerary."},links:[],note:"No reply or check-in is required."});
  const id=emailJobId(["travel-adjustment",receipt.handoff.intentId,settings.revision]);
  store.email.enqueue({id,planId:plan.id,planVersion:plan.version,kind:"change",date:dateOf(plan,now),dueAt:now.toISOString(),expiresAt:new Date(now.getTime()+24*60*60_000).toISOString(),recipientRevision:settings.revision,content:{...content,authorizationDigest:context.authorizationDigest,adjustment:{requestId,intentId:receipt.handoff.intentId,timingId:timing.id}}});
  return id;
}

/** 沿用 T3-2 的 outbox；失败保留原交接意图供重启重读。 */
export function consumeTravelAdjustmentHandoffs(store:SqliteWorkspaceStore,now=new Date(),consume=(requestId:string)=>enqueueAppliedAdjustment(store,requestId,now)):void {
  for(const handoff of store.listPendingTravelAdjustmentHandoffs()){
    try {
      const current=store.getExecutionPlan();
      if(current?.id!==handoff.replacement.plan.id || current.version!==handoff.replacement.plan.version)continue;
      store.email.cancelObsolete(current.id,current.version,now.toISOString());
      const readback=consume(handoff.requestId);
      if(readback){
        const effects=readTravelAdjustmentEmailEffects(store,readback);
        if(effects && effects.intentId===handoff.intentId && effects.requestId===handoff.requestId && effects.oldPending.length===0 && effects.timing)store.acknowledgeTravelAdjustmentHandoff(handoff.intentId,`email-outbox:${readback}`);
      }
    } catch { /* 已应用版本保持不变；下次使用相同意图幂等恢复。 */ }
  }
}

/** 分别读回事实，不把交接 ACK 或 timing pending 冒充提醒已生成。 */
export function readTravelAdjustmentEmailEffects(store:SqliteWorkspaceStore,notificationId:string){
  const notification=store.email.get(notificationId),link=notification?.content?.adjustment;
  if(!notification || !link)return;
  const handoff=store.getTravelAdjustmentReceipt(link.requestId)?.handoff;
  if(!handoff || handoff.intentId!==link.intentId || notification.planId!==handoff.replacement.plan.id || notification.planVersion!==handoff.replacement.plan.version)return;
  const oldWork=store.email.versionJobs(handoff.base.plan.id,handoff.base.plan.version);
  return {...link,notification,oldWork,oldPending:oldWork.filter(job=>job.status==='pending'||job.status==='retry'),initialTiming:store.email.timing(link.timingId),timing:store.email.currentTiming(notification.planId,notification.planVersion)};
}

/** Read-only, traveler-facing projection of the exact saved Blueprint. */
export function reviewArrangement(blueprint:TripBlueprint) {
  const place=(id:string|undefined)=>blueprint.places.find(item=>item.id===id);
  const span=(start?:string,end?:string,duration?:number)=>[start ? `${start}${end ? `–${end}` : ""}` : "Time to be confirmed",duration!==undefined ? `${duration} min` : end ? "" : "Duration unknown"].filter(Boolean).join(" · ");
  const mode:Record<string,string>={walking:"Walking",driving:"Driving",transit:"Public transport",cycling:"Cycling",flight:"Flight",rail:"Rail",ferry:"Ferry",taxi:"Taxi",unknown:"Mode to be verified"};
  const status:Record<string,string>={verified:"Verified",recheck:"Needs review",stale:"Outdated"};
  return {title:blueprint.title,days:blueprint.days.map(day=>({date:day.date,city:day.city,title:day.title,summary:day.summary,lines:[
    ...(day.blocks?.length ? [...day.blocks].sort((a,b)=>a.order-b.order).map(block=>[span(block.startTime,block.endTime,block.durationMinutes??place(block.placeId)?.durationMinutes),block.title??block.placeName??place(block.placeId)?.name??"Activity to be confirmed",place(block.placeId)?.locationLabel,block.summary,block.planRole==="optional"?"Optional activity":block.planRole==="replacement"?"Alternative activity":""].filter(Boolean).join(" · ")) : [...day.stops].sort((a,b)=>a.order-b.order).map(stop=>[span(stop.time,undefined,place(stop.placeId)?.durationMinutes),place(stop.placeId)?.name??"Place to be confirmed",place(stop.placeId)?.locationLabel].filter(Boolean).join(" · "))),
    ...blueprint.movements.filter(move=>move.dayId===day.id).map(move=>["Transport",`${place(move.originPlaceId)?.name??"Starting point to be confirmed"} → ${place(move.destinationPlaceId)?.name??"Destination to be confirmed"}`,mode[move.mode]??"Mode to be verified",move.durationMinutes!==undefined?`${move.durationMinutes} min`:"Travel time unknown",status[move.status]??"Needs verification",move.label,move.detail].filter(Boolean).join(" · "))
  ]})),commitments:(blueprint.bookingConstraints??[]).flatMap(booking=>booking.segments.map(segment=>[booking.title,segment.title,segment.fixedCommitment?"Fixed commitment":"Booking arrangement",({hard:"Required constraint",soft:"Flexible constraint",ignored:"Ignored constraint"} as Record<string,string>)[segment.constraintStrength],({confirmed:"Confirmed",pending:"Pending",cancelled:"Cancelled",needs_review:"Needs review"} as Record<string,string>)[segment.status??booking.status],segment.startAtLocal?localCalendarTime(segment.startAtLocal):"Start time unknown",segment.endAtLocal?localCalendarTime(segment.endAtLocal):"End time unknown",segment.origin,segment.destination,segment.location,segment.needsReviewReasons.length?"Details need review":""].filter(Boolean).join(" · ")))};
}
function localCalendarDate(value:string):string {return new Date(`${value}T12:00:00`).toLocaleDateString("en-GB");}
function localCalendarTime(value:string):string {return new Date(value).toLocaleString("en-GB");}
function localTimeZoneLabel(date:string,timeZone:string|undefined):string {
  if(!timeZone)return "Local time zone needs verification";
  const label=new Intl.DateTimeFormat('en-GB',{timeZone,timeZoneName:'long'}).formatToParts(new Date(`${date}T12:00:00Z`)).find(part=>part.type==='timeZoneName')?.value;
  return label?`Times below use ${label}`:"Local time zone needs verification";
}
