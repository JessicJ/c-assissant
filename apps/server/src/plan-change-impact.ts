import type { Plan, PlanChangeImpactPreview } from "@c-assistant/core";

const HIGH_IMPACT_RULES: Array<{ area: PlanChangeImpactPreview["affectedAreas"][number]; pattern: RegExp; reason: string }> = [
  { area: "destination", pattern: /\b(change|switch|move)\b.{0,24}\b(city|country|destination)\b|\b(add|remove)\b.{0,20}\bcit(?:y|ies)\b|换.{0,8}(城市|国家|目的地)|增加.{0,8}城市|删除.{0,8}城市/i, reason: "Changing the destination or multi-city structure affects transport, accommodation, and source applicability." },
  { area: "dates", pattern: /\b(change|move|extend|shorten)\b.{0,24}\b(date|day|arrival|departure|return|trip)\b|(改|调整|变更).{0,4}(日期|时间|抵达日|出发日|返程日)|延长.{0,4}(行程|旅行|天数)|缩短.{0,4}(行程|旅行|天数)/i, reason: "Changing the dates may invalidate bookings, source freshness, reminders, and daily capacity." },
  { area: "accommodation", pattern: /\b(change|move|switch|replace)\b.{0,24}\b(hotels?|accommodations?|base|lodging)\b|换.{0,8}(酒店|住宿|住处|基地)|搬到.{0,12}(酒店|住宿|区域)/i, reason: "Changing the accommodation base affects commute routes, arrival connections, and area planning." },
  { area: "fixed_commitments", pattern: /\b(move|remove|cancel|change)\b.{0,24}\b(booking|reservation|appointment|meeting|concert|event|flight|train)\b|移动.{0,8}(预订|预约|会议|活动|航班|火车)|取消.{0,8}(预订|预约|会议|活动|航班|火车)|改签/i, reason: "Changing a fixed booking or event requires dependencies, buffers, and cancellation terms to be checked again." },
  { area: "party", pattern: /\b(add|remove|change)\b.{0,20}\b(person|people|travell?ers?|child|wheelchair|mobility)\b|增加.{0,8}(同行|人数|儿童)|减少.{0,8}(同行|人数)|(同行人数|人数).{0,5}(改|变|增加|减少)|改.{0,5}(人数|同行)|轮椅|行动不便/i, reason: "Changing the party size or mobility needs affects capacity, transport, and accommodation choices." },
  { area: "reminders", pattern: /\b(add|remove|cancel|change|reschedule)\b.{0,20}\breminder\b|增加.{0,8}提醒|删除.{0,8}提醒|取消.{0,8}提醒|修改.{0,8}提醒|调整.{0,8}提醒/i, reason: "Changing reminder scope affects which actions may run automatically after confirmation." }
];

export function previewPlanChange(plan: Pick<Plan, "id" | "version">, message: string): PlanChangeImpactPreview {
  const normalized = message.trim();
  if (!normalized || normalized.length > 1500) throw new Error("A Plan change preview needs a message between 1 and 1500 characters.");
  const matches = HIGH_IMPACT_RULES.filter((rule) => rule.pattern.test(normalized));
  const affectedAreas = [...new Set(matches.map((match) => match.area))];
  const reasons = [...new Set(matches.map((match) => match.reason))];
  const highImpact = reasons.length > 0;
  return {
    planId: plan.id,
    baseVersion: plan.version,
    impact: highImpact ? "high" : "low",
    summary: highImpact ? "This change affects the Plan structure. Review and confirm the impact before generating a complete replacement draft." : "This addition does not trigger a high-impact rule. Landi can continue generating a reviewable replacement draft.",
    reasons,
    affectedAreas: highImpact ? affectedAreas : ["itinerary"],
    requiresConfirmation: highImpact,
    createsReplacementDraft: true
  };
}
