import { readFileSync, writeFileSync } from "node:fs";
import type { Plan, WorkspaceSnapshot } from "@c-assistant/core";
import { localDateTimeInstant } from "../apps/server/src/arrival-reminder.js";
import { dueItineraryDepartureReminders, formatItineraryDepartureReminder, normalizeCity } from "../apps/server/src/itinerary-departure-reminder.js";
import { dueTaskReminders, formatTaskReminder } from "../apps/server/src/task-reminder.js";

const [inputPath, outputPath] = process.argv.slice(2);
if (!inputPath || !outputPath) throw new Error("Usage: audit-plan-reminders.ts workspace.json output.json");
const workspace = JSON.parse(readFileSync(inputPath, "utf8")) as WorkspaceSnapshot;
const plan: Plan = workspace.executionPlan ?? workspace.activePlan;
// Audit assumption only: resolve these zones independently of the production
// Maps/Weather lookup. Eligibility is not proof that providers or delivery work.
const zoneForCity = (city: string) => /Los Angeles/i.test(city) ? "America/Los_Angeles" : /Auckland|Rotorua|Queenstown|Te Anau|Milford|Mount Cook/i.test(city) ? "Pacific/Auckland" : undefined;
const zones = new Map<string, string>();
for (const day of plan.presentation?.days ?? []) {
  const zone = day.city && zoneForCity(day.city);
  if (zone) zones.set(normalizeCity(day.city!), zone);
}
const taskReminders = plan.stages.flatMap(stage => stage.tasks).flatMap(task => {
  if (!task.reminder) return [];
  const at = localDateTimeInstant(task.reminder.scheduledAtLocal, task.reminder.timeZone);
  const eligible = at && dueTaskReminders(plan, at).some(item => item.task.id === task.id);
  return [{ taskId: task.id, title: task.title, at: at?.toISOString(), eligible: Boolean(eligible), text: formatTaskReminder(plan, task) }];
});
const departureReminders = (plan.presentation?.days ?? []).flatMap(day => (day.stops ?? []).map((stop, index) => {
  const place = plan.presentation!.places.find(p => p.id === stop.placeId);
  const route = plan.presentation!.routeSegments.filter(r => r.dayId === day.id && r.destinationPlaceId === stop.placeId).at(-1);
  const zone = day.city && zones.get(normalizeCity(day.city));
  const scheduledAt = day.date && stop.time && zone ? localDateTimeInstant(`${day.date}T${stop.time}`, zone) : undefined;
  const travelMinutes = (route?.verification === "verified" ? route.durationMinutes : undefined)
    ?? (index === 0 && day.accommodationDeparture?.verification === "verified" ? day.accommodationDeparture.durationMinutes : undefined);
  const leaveAt = scheduledAt && travelMinutes ? new Date(scheduledAt.getTime() - (travelMinutes + 10) * 60_000) : undefined;
  const due = leaveAt ? dueItineraryDepartureReminders(plan, zones, leaveAt).find(item => item.dayId === day.id && item.place.id === stop.placeId) : undefined;
  const reasons: string[] = [];
  if (plan.status !== "active") reasons.push("计划未激活");
  if (!stop.time) reasons.push("没有具体行程时间");
  if (!zone) reasons.push("未确定城市时区");
  if (!travelMinutes) reasons.push("没有已验证的路程耗时");
  if (!place) reasons.push("缺少地点信息");
  if (!due && reasons.length === 0) reasons.push("不属于当前规则支持的固定行程点或酒店首站出发");
  return { day: day.date, city: day.city, placeId: stop.placeId, place: place?.name ?? "Missing place", scheduledTime: stop.time, auditTimeZone: zone, eligible: Boolean(due), reasons, ...(due ? { leaveAt: due.leaveAt.toISOString(), text: formatItineraryDepartureReminder(plan, due) } : {}) };
}));
const arrival = plan.configuration.arrival;
const arrivalAt = arrival.expectedAtLocal && arrival.timeZone ? localDateTimeInstant(arrival.expectedAtLocal, arrival.timeZone) : undefined;
const report = {
  planId: plan.id, version: plan.version, title: plan.title, status: plan.status,
  auditNote: "静态规则验收，城市时区采用明确的审计假设；未调用真实天气/地图服务，未发送 Telegram，未修改计划。",
  taskReminders, departureReminders,
  arrival: { expectedAtLocal: arrival.expectedAtLocal, timeZone: arrival.timeZone, eligible: plan.status === "active" && Boolean(arrivalAt), reason: !arrival.timeZone ? "到达配置缺少时区" : !arrivalAt ? "没有有效到达时间" : undefined },
  emptyStopDays: (plan.presentation?.days ?? []).filter(day => !day.stops?.length).map(day => ({ date: day.date, city: day.city })),
  summary: { taskReminders: taskReminders.filter(item => item.eligible).length, departureReminders: departureReminders.filter(item => item.eligible).length, checkedStops: departureReminders.length, arrivalReminder: plan.status === "active" && Boolean(arrivalAt) }
};
writeFileSync(outputPath, JSON.stringify(report, null, 2));
const md = [`# 主动提醒验收清单`, "", plan.title, plan.dates, "", report.auditNote, "", `任务提醒：${report.summary.taskReminders}；出发提醒：${report.summary.departureReminders}；到达提醒：${report.summary.arrivalReminder ? "可触发" : report.arrival.reason}。`, "", "| 日期 | 地点 | 行程时间 | 主动提醒 | 原因 |", "| --- | --- | --- | --- | --- |", ...departureReminders.map(item => `| ${item.day} | ${item.place.replaceAll("|", "\\|")} | ${item.scheduledTime ?? "未设置"} | ${item.eligible ? "符合规则" : "不触发"} | ${item.reasons.join("；")} |`), "", "没有 stop 数据的日期：", ...report.emptyStopDays.map(day => `- ${day.date} · ${day.city}`), "", "本清单仅验证原计划的数据和触发规则；不能代替调度器、去重、网络或手机实际投递验收。"].join("\n");
writeFileSync(outputPath.replace(/\.json$/, ".md"), md);
console.log(JSON.stringify(report.summary));
