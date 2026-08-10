import type { Plan, TransportPreference } from "@c-assistant/core";

export type TelegramCommand =
  | { type: "empty" }
  | { type: "help" }
  | { type: "plan" }
  | { type: "prepare" }
  | { type: "profile" }
  | { type: "weather" }
  | { type: "food"; partySize?: number }
  | { type: "set_transport_preference"; preference: Exclude<TransportPreference, "plan_recommended"> }
  | { type: "start" }
  | { type: "create_plan"; request: string; explicit: boolean }
  | { type: "unknown_command" };

/** Keeps normal chat expressive while reserving slash commands for controls. */
export function parseTelegramCommand(text: string | undefined): TelegramCommand {
  const normalized = text?.trim();
  if (!normalized) return { type: "empty" };
  if (/^\/help(?:@[-_A-Za-z0-9]+)?$/i.test(normalized)) return { type: "help" };
  if (/^\/plan(?:@[-_A-Za-z0-9]+)?$/i.test(normalized)) return { type: "plan" };
  if (/^\/prepare(?:@[-_A-Za-z0-9]+)?$/i.test(normalized)) return { type: "prepare" };
  if (/^\/profile(?:@[-_A-Za-z0-9]+)?$/i.test(normalized)) return { type: "profile" };
  if (/^\/weather(?:@[-_A-Za-z0-9]+)?$/i.test(normalized)) return { type: "weather" };
  const food = normalized.match(/^\/food(?:@[-_A-Za-z0-9]+)?(?:\s+(\d+))?$/i);
  if (food) return { type: "food", ...(food[1] ? { partySize: Number(food[1]) } : {}) };
  if (/^\/start(?:@[-_A-Za-z0-9]+)?(?:\s|$)/i.test(normalized)) return { type: "start" };
  const explicit = normalized.match(/^\/new(?:@[-_A-Za-z0-9]+)?\s+(.+)$/is)?.[1]?.trim();
  if (explicit) return { type: "create_plan", request: explicit, explicit: true };
  if (normalized.startsWith("/")) return { type: "unknown_command" };
  const transportPreference = parseTransportPreference(normalized);
  if (transportPreference && !requestsCompletePlan(normalized)) return { type: "set_transport_preference", preference: transportPreference };
  return { type: "create_plan", request: normalized, explicit: false };
}

export function formatTransportPreferenceAcknowledgement(preference: Exclude<TransportPreference, "plan_recommended">, offersCurrentRoute: boolean): string {
  const label = preference === "public_transit" ? "public transit" : preference;
  return `This Plan now prefers ${label} for transport choices. No new Plan was created, and no ride or navigation was started.${offersCurrentRoute ? "\n\nTo refresh the current arrival route with this choice, share your location below. It will be used once and will not be saved." : ""}`;
}

function parseTransportPreference(value: string): Exclude<TransportPreference, "plan_recommended"> | undefined {
  const normalized = value.toLowerCase();
  const candidates: Array<Exclude<TransportPreference, "plan_recommended">> = [];
  const hasEnglishNegative = (mode: RegExp) => new RegExp(`\\b(?:don['’]?t|do not|not|avoid)\\b[^.!?]{0,40}${mode.source}`, "i").test(normalized);

  const taxi = /\b(?:taxi|cab)\b/i;
  if (!hasEnglishNegative(taxi) && (/(?:\b(?:i\s+)?(?:prefer|perfer|choose|want|would\s+prefer|would\s+like)(?:\s+to\s+(?:take|use))?\s+(?:a\s+)?(?:taxi|cab)\b)|(?:\b(?:take|use|get|call|book)\s+(?:a\s+)?(?:taxi|cab)\b)/i.test(normalized) || /(?<!不|别|避免)(?:更?喜欢|偏好|想|要|选择|坐|打|叫)(?:坐|打|叫)?(?:出租车|的士|网约车|车)/u.test(value))) candidates.push("taxi");

  const transit = /\b(?:public\s+(?:transit|transport)|metro|subway|bus)\b/i;
  if (!hasEnglishNegative(transit) && (/(?:\b(?:i\s+)?(?:prefer|perfer|choose|want|would\s+prefer|would\s+like)(?:\s+to\s+(?:take|use))?\s+(?:public\s+(?:transit|transport)|the\s+(?:metro|subway|bus)|metro|subway|bus)\b)|(?:\b(?:take|use)\s+(?:public\s+(?:transit|transport)|the\s+(?:metro|subway|bus)|metro|subway|bus)\b)/i.test(normalized) || /(?<!不|别|避免)(?:更?喜欢|偏好|想|要|选择|坐)(?:公共交通|公交|地铁)/u.test(value))) candidates.push("public_transit");

  const walking = /\b(?:walk|walking|on\s+foot)\b/i;
  if (!hasEnglishNegative(walking) && (/(?:\b(?:i\s+)?(?:prefer|perfer|choose|want|would\s+prefer|would\s+like)(?:\s+to)?\s+(?:walk|walking|go\s+on\s+foot)\b)|(?:\b(?:walk|go\s+on\s+foot)(?:\s+please)?\b)/i.test(normalized) || /(?<!不|别|避免)(?:更?喜欢|偏好|想|要|选择)(?:步行|走路)/u.test(value))) candidates.push("walking");

  return candidates.length === 1 ? candidates[0] : undefined;
}

export function requestsCompletePlan(value: string): boolean {
  return /\b(?:change|update|revise|redo|replace)\s+(?:my\s+|the\s+)?(?:(?:whole|entire|overall)\s+)?plan\b/i.test(value)
    || /\b(?:whole|entire|overall)\s+plan\b/i.test(value)
    || /\b(?:create|make|start)\s+(?:a\s+)?(?:new\s+)?plan\b/i.test(value)
    || /\b(?:new|another)\s+(?:trip|journey|visit|stay|move|event|exhibition|plan)\b/i.test(value)
    || /(?:修改|更新|重做|替换|创建|制定|新建).{0,8}(?:整个|整体|总|新)?计划/u.test(value)
    || /(?:新的|另一个)(?:旅行|行程|活动|展会|计划)/u.test(value);
}

export function shouldGenerateCompletePlan(planStatus: Plan["status"], request: string, explicitNew: boolean): boolean {
  return explicitNew || planStatus !== "active" || requestsCompletePlan(request);
}
