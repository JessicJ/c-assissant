import type { Plan, TransportPreference } from "@c-assistant/core";

export type TelegramCommand =
  | { type: "empty" }
  | { type: "help" }
  | { type: "plan" }
  | { type: "prepare" }
  | { type: "profile" }
  | { type: "weather" }
  | { type: "food"; partySize?: number }
  | { type: "go" }
  | { type: "arrival_update"; city: string }
  | { type: "transport_choice"; preference: Exclude<TransportPreference, "plan_recommended">; scope: "current_action" | "plan" | "unspecified" }
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
  if (/^\/go(?:@[-_A-Za-z0-9]+)?$/i.test(normalized)) return { type: "go" };
  const food = normalized.match(/^\/food(?:@[-_A-Za-z0-9]+)?(?:\s+(\d+))?$/i);
  if (food) return { type: "food", ...(food[1] ? { partySize: Number(food[1]) } : {}) };
  if (/^\/start(?:@[-_A-Za-z0-9]+)?(?:\s|$)/i.test(normalized)) return { type: "start" };
  const explicit = normalized.match(/^\/new(?:@[-_A-Za-z0-9]+)?\s+(.+)$/is)?.[1]?.trim();
  if (explicit) return { type: "create_plan", request: explicit, explicit: true };
  if (normalized.startsWith("/")) return { type: "unknown_command" };
  const arrivalCity = parseNaturalArrivalCity(normalized);
  if (arrivalCity) return { type: "arrival_update", city: arrivalCity };
  if (isNaturalPlanView(normalized)) return { type: "plan" };
  if (isNaturalWeatherRequest(normalized)) return { type: "weather" };
  if (isNaturalNearbyFoodRequest(normalized)) return { type: "food" };
  const transportPreference = parseTransportPreference(normalized);
  if (transportPreference && !requestsCompletePlan(normalized)) return { type: "transport_choice", preference: transportPreference, scope: parseTransportScope(normalized) };
  return { type: "create_plan", request: normalized, explicit: false };
}

function parseNaturalArrivalCity(value: string): string | undefined {
  const english = value.match(/^(?:i|we)(?:'ve|\s+have)?\s+(?:just\s+)?arrived\s+(?:in|at)\s+(.+?)[.!]?$/i)?.[1];
  const chinese = value.match(/^(?:我|我们)(?:已经|刚刚|刚)?(?:到达|到)(?:了)?\s*(.+?)[。！!?？]?$/u)?.[1]?.replace(/了$/u, "");
  const city = (english ?? chinese)?.trim();
  return city && city.length <= 120 ? city : undefined;
}

function isNaturalPlanView(value: string): boolean {
  return /^(?:show|open|display)(?:\s+me)?\s+(?:my(?:\s+current)?|the\s+current|current|the)\s+plan[.!?]?$/i.test(value)
    || /^what(?:'s| is)\s+(?:on\s+)?my\s+plan[?]?$/i.test(value)
    || /^(?:打开|显示|查看|看看)(?:一下)?(?:我的|当前)?(?:旅行|行程)?计划[。！!?？]?$/u.test(value);
}

function isNaturalWeatherRequest(value: string): boolean {
  return /^(?:what(?:'s| is)|how(?:'s| is))\s+(?:the\s+)?weather(?:\s+(?:now|today|there|here))?[?]?$/i.test(value)
    || /^(?:weather|temperature)(?:\s+(?:now|today|there|here))?[?]?$/i.test(value)
    || /^(?:will|is)\s+it\s+(?:rain(?:ing)?|snow(?:ing)?)(?:\s+(?:now|today|there|here))?[?]?$/i.test(value)
    || /^(?:(?:现在|今天|当地|目的地)的?)?(?:天气|气温)(?:怎么样|如何|多少|是什么)?[。！!?？]?$/u.test(value)
    || /^(?:现在|今天|当地|目的地)?(?:会|在)?(?:下雨|下雪)吗[？?]?$/u.test(value);
}

function isNaturalNearbyFoodRequest(value: string): boolean {
  return /^(?:where|what)\s+(?:can|should|could)\s+(?:i|we)\s+(?:eat|have\s+(?:breakfast|lunch|dinner))\s+(?:nearby|near\s+me|around\s+here)[?]?$/i.test(value)
    || /^(?:find|show)(?:\s+me)?\s+(?:some\s+)?(?:nearby|near\s+me)\s+(?:food|restaurants?)(?:\s+now)?[.!?]?$/i.test(value)
    || /^(?:nearby|near\s+me)\s+(?:food|restaurants?)[?]?$/i.test(value)
    || /^(?:附近|周边)(?:现在)?(?:有什么)?(?:餐厅|饭店|吃的|美食|吃什么)[？?]?$/u.test(value)
    || /^(?:现在)?(?:附近|周边)(?:哪里|有什么地方)(?:可以)?吃(?:饭|东西)?[？?]?$/u.test(value);
}

function isNaturalUberTestRequest(value: string): boolean {
  return /^(?:test|check|try)(?:\s+(?:whether|if|the))?\s+uber(?:\s+(?:works|availability|nearby|here|now))?[.!?]?$/i.test(value)
    || /^(?:can|could)\s+(?:i|we)\s+(?:get|call|use)\s+uber(?:\s+(?:here|now|nearby))?[?]?$/i.test(value)
    || /^(?:test|check|try)(?:\s+(?:whether|if|the))?\s+uber\s+[-+\d.,\s]+[.!?]?$/i.test(value)
    || /^(?:测试|试试|看看|查查)(?:一下)?(?:现在|这里|附近)?(?:能不能|可不可以|是否)?(?:叫|打|用)?\s*uber[。！!?？]?$/iu.test(value)
    || /^(?:测试|试试|看看|查查)(?:一下)?(?:现在|这里|附近)?(?:能不能|可不可以|是否)?(?:叫|打|用)?\s*uber\s*[-+\d.,，\s]+[。！!?？]?$/iu.test(value)
    || /^(?:现在|这里|附近)?(?:能不能|可不可以|是否)(?:叫|打|用)?\s*uber[？?]?$/iu.test(value);
}

function parseLocationText(value: string | undefined): { latitude: number; longitude: number } | undefined {
  const match = value?.match(/(-?\d+(?:\.\d+)?)\s*[,，]\s*(-?\d+(?:\.\d+)?)/);
  if (!match) return undefined;
  const first = Number(match[1]);
  const second = Number(match[2]);
  if (!Number.isFinite(first) || !Number.isFinite(second)) return undefined;
  if (Math.abs(first) <= 90 && Math.abs(second) <= 180) return { latitude: first, longitude: second };
  if (Math.abs(first) <= 180 && Math.abs(second) <= 90) return { latitude: second, longitude: first };
  return undefined;
}

export function formatTransportChoiceAcknowledgement(preference: Exclude<TransportPreference, "plan_recommended">, scope: "current_action" | "plan", offersCurrentRoute: boolean): string {
  const label = preference === "public_transit" ? "public transit" : preference;
  if (scope === "current_action") return `For this route, Landi will use ${label}. Your saved Plan preference is unchanged. No new Plan was created, and no ride or navigation was started.${offersCurrentRoute ? "\n\nShare your location below to prepare this one route. It will be used once and will not be saved." : ""}`;
  return `This Plan now prefers ${label} for future transport choices in this Plan. No new Plan was created, and no ride or navigation was started.${offersCurrentRoute ? "\n\nTo refresh the current arrival route with this choice, share your location below. It will be used once and will not be saved." : ""}`;
}

function parseTransportScope(value: string): "current_action" | "plan" | "unspecified" {
  if (/\b(?:for\s+)?(?:this|the)\s+(?:whole\s+|entire\s+)?(?:plan|trip|journey|stay)\b|\b(?:throughout|for)\s+(?:my\s+|the\s+)?(?:trip|journey|stay)\b|\b(?:from\s+now\s+on|always)\b/i.test(value)
    || /(?:本次|这个|整个|全程).{0,4}(?:计划|行程|旅行)|(?:以后|今后|一直|总是).{0,6}(?:打车|坐出租车|坐地铁|公共交通|步行|走路)/u.test(value)) return "plan";
  if (/\b(?:this\s+time|right\s+now|now|for\s+this\s+(?:ride|route|journey|leg))\b/i.test(value)
    || /(?:这次|这趟|这一程|这一段|现在|马上)/u.test(value)) return "current_action";
  return "unspecified";
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
