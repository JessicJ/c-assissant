import type { PlanningFact, PlanningUnknown } from "@c-assistant/core";

export function extractFacts(message: string, existing: PlanningFact[], updatedAt: string): PlanningFact[] {
  const facts: PlanningFact[] = [];
  const hasExisting = (key: string) => existing.some((item) => item.key === key);
  const destinationMatch = firstMatch(message, [
    /(?:目的地(?:改成|改为|换成|是|为|：|:)?|改去|改到|换到)\s*([\p{Script=Han}A-Za-z][^，。；;,!！?？\n]{1,36})/u,
    ...(!hasExisting("destination") ? [/(?:前往|去|到)\s*([\p{Script=Han}A-Za-z][^，。；;,!！?？\n]{1,36})/u] : []),
    ...(!hasExisting("destination") ? [/(?:在|于)\s*([\p{Script=Han}A-Za-z][^，。；;,!！?？\n]{1,36}?)(?:旅行|旅游|出行|度假|旅居|留学|工作)/u] : [])
  ]);
  const destination = destinationMatch ? normalizeDestination(destinationMatch) : undefined;
  if (destination) facts.push(fact("destination", destination, updatedAt));

  const timing = firstMatch(message, [
    /((?:20\d{2}[年\/-])?\d{1,2}月\d{1,2}[日号]?(?:到|至|-|—)(?:20\d{2}[年\/-])?(?:\d{1,2}月)?\d{1,2}[日号]?)/,
    /((?:大约|差不多|计划)?\s*(?:\d+|[一二三四五六七八九十两]+)\s*(?:天|晚|周|个月))/i,
    /((?:周末|下周|本周|暑假|国庆|春节)[^，。；;,!！?？\n]{0,12})/,
    /((?:20\d{2}[年\/-])?\d{1,2}月\d{1,2}[日号]?)/,
    /(待定|还没定|暂时不确定)/
  ]);
  if (timing) facts.push(fact("timing", timing, updatedAt));
  const travelDates = firstMatch(message, [
    /((?:20\d{2})年\s*\d{1,2}月\d{1,2}[日号]?(?:到|至|-|—)(?:(?:20\d{2})年\s*)?(?:\d{1,2}月)?\d{1,2}[日号]?)/,
    /((?:20\d{2})[-/]\d{1,2}[-/]\d{1,2}\s*(?:到|至|to|-|—)\s*(?:20\d{2})[-/]\d{1,2}[-/]\d{1,2})/i,
    /((?:January|February|March|April|May|June|July|August|September|October|November|December)\s+\d{1,2}\s*(?:to|-|—)\s*(?:(?:January|February|March|April|May|June|July|August|September|October|November|December)\s+)?\d{1,2},?\s+20\d{2})/i
  ]);
  const year = extractTravelYear(message);
  if (year) facts.push(fact("travel_year", year, updatedAt));
  const partialDateRange = firstMatch(message, [/(\d{1,2}月\d{1,2}[日号]?(?:到|至|-|—)(?:\d{1,2}月)?\d{1,2}[日号]?)/]);
  const knownYear = year ?? valueOf(existing, "travel_year");
  const completedTravelDates = travelDates ?? (partialDateRange && knownYear ? `${knownYear}年${partialDateRange}` : undefined);
  if (completedTravelDates) facts.push(fact("travel_dates", completedTravelDates, updatedAt));

  const explicitPurpose = firstMatch(message, [/(?:目的(?!地)|目标|主要想|最想|这次想)(?:改成|改为|换成|是|为|：|:)?\s*([^，。；;,!！?？\n]{2,80})/u]);
  const purpose = explicitPurpose ?? message.replace(/^(我想|我准备|计划|想要|希望|打算)\s*/u, "").trim();
  const explicitlyChangesPurpose = /(?:目的(?!地)|目标|主要想|最想|这次想)(?:改成|改为|换成|是|为|：|:)?/u.test(message);
  const introducesPurpose = !hasExisting("purpose") && /(?:旅行|旅游|出行|度假|探亲|留学|工作|展会|活动|体验|主要)/u.test(message);
  if (purpose && (explicitlyChangesPurpose || introducesPurpose)) {
    facts.push(fact("purpose", purpose, updatedAt));
  }

  const interests = firstMatch(message, [/(?:喜欢|偏好|想看|重点是|重点想)\s*([^。；;,!！?？\n]{2,40})/u]);
  if (interests) facts.push(fact("interests", interests, updatedAt));
  const constraints = firstMatch(message, [/(?:不吃|不想|不要|避免|预算|限制|行李|带着孩子|带娃)[^。；;,!！?？\n]{0,40}/u]);
  if (constraints) facts.push(fact("constraints", constraints, updatedAt));

  const transport = firstMatch(message, [/(?:交通(?:方式|偏好|倾向)?|出行(?:方式|偏好)?|更想|优先|倾向于?|主要)\s*(?:是|为|用|选择|坐|乘|：|:)?\s*(打车|出租车|网约车|地铁|公交|公共交通|步行|骑行|自驾|(?:交给\s*)?Landi\s*推荐)/iu]);
  if (transport) facts.push(fact("transport_preference", normalizeTransport(transport), updatedAt));

  const party = firstMatch(message, [/(\d+|[一二三四五六七八九十两]+)\s*(?:个人|人)(?:出行|旅行|同行)?/u]);
  if (party) facts.push(fact("party_size", `${party}人`, updatedAt));

  const accommodation = firstMatch(message, [/(?:住宿|酒店|民宿)[^。；;,!！?？\n]{0,40}/u]);
  if (accommodation) facts.push(fact("accommodation", accommodation, updatedAt));

  const arrivalOrigin = firstMatch(message, [/(?:从|由)\s*([^，。；;,!！?？\n]{1,50}?)(?:出发|启程)/u, /(?:departing|leaving|flying|travelling|traveling)\s+from\s+([^,.!?;\n]{1,50})/i]);
  const arrivalNode = firstMatch(message, [/(?:抵达|到达|落地|降落(?:在|于)?)\s*([^，。；;,!！?？\n]{0,32}?(?:机场|航站楼|火车站|高铁站|车站|港口|码头))/u, /(?:arriv(?:e|ing|al)(?:\s+at|\s+in)?)\s+([^,.!?;\n]{1,50}?(?:airport|terminal|railway station|train station|port))/i, ...((hasExisting("arrival_origin") || hasExisting("arrival_time")) ? [/^\s*([^，。；;,!！?？\n]{1,32}?(?:机场|航站楼|火车站|高铁站|车站|港口|码头))\s*$/u] : [])]);
  const arrivalTime = firstMatch(message, [/(?:抵达|到达|落地|降落)[^，。；;,!！?？\n]{0,50}?(?:预计|大约|约)?\s*((?:[01]?\d|2[0-3])[:：][0-5]\d|(?:上午|下午|晚上|凌晨)?\s*\d{1,2}\s*[点時时](?:\s*\d{1,2}\s*分)?)/u, /(?:预计|大约|约)\s*((?:[01]?\d|2[0-3])[:：][0-5]\d|(?:上午|下午|晚上|凌晨)?\s*\d{1,2}\s*[点時时](?:\s*\d{1,2}\s*分)?)\s*(?:钟|鐘)?\s*(?:抵达|到达|落地|降落)/u]);
  if (arrivalOrigin) facts.push(fact("arrival_origin", arrivalOrigin, updatedAt));
  if (arrivalNode) facts.push(fact("arrival_node", arrivalNode, updatedAt));
  if (arrivalTime) facts.push(fact("arrival_time", arrivalTime.replace(/\s+/g, ""), updatedAt));

  if (/(?:还没|尚未|暂未|没有).{0,8}(?:订票|订航班|订机票|订火车票)|(?:flight|train).{0,12}(?:not booked|not decided)|haven't booked/i.test(message)) {
    facts.push(fact("arrival_status", "not_booked", updatedAt));
  } else if (hasArrivalOrigin(message) && hasArrivalNode(message) && hasArrivalTime(message)) {
    facts.push(fact("arrival", message.slice(0, 240), updatedAt));
  }
  if (hasDepartureIntent(message) && hasDepartureNode(message) && hasArrivalTime(message)) facts.push(fact("departure", message.slice(0, 240), updatedAt));

  if (!facts.some((item) => item.key === "destination") && !existing.some((item) => item.key === "destination") && isLikelyDestination(message)) {
    facts.push(fact("destination", message, updatedAt));
  }
  return facts;
}

export function missingQuestions(facts: PlanningFact[]): PlanningUnknown[] {
  const known = new Set(facts.map((fact) => fact.key));
  const questions: PlanningUnknown[] = [];
  if (!known.has("destination")) questions.push({ key: "destination", question: "Where would you like to go, or where does this need to happen?", impact: "high", status: "open" });
  if (!known.has("timing") && !known.has("travel_dates")) questions.push({ key: "timing", question: "Roughly when will you go, and for how long? Exact dates are not required yet.", impact: "high", status: "open" });
  if (!known.has("purpose")) questions.push({ key: "purpose", question: "What do you most want to accomplish or experience on this trip?", impact: "high", status: "open" });
  return questions;
}

export function missingGenerationQuestions(facts: PlanningFact[]): PlanningUnknown[] {
  const known = new Set(facts.map((fact) => fact.key));
  const questions: PlanningUnknown[] = [];
  const travelDates = facts.find((fact) => fact.key === "travel_dates" && fact.confirmed)?.value;
  if (!travelDates || !planningTravelDateRange(travelDates)) {
    const year = valueOf(facts, "travel_year");
    questions.push({ key: "travel_dates", question: year ? `I have the year ${year}. What are the exact departure and return dates? For example, October 6–16.` : "Share the exact departure and return dates, including the year. For example, October 6–16, 2026.", impact: "high", status: "open" });
  }
  if (!known.has("arrival")) questions.push({ key: "arrival", question: arrivalFollowUpQuestion(facts), impact: "high", status: "open" });
  if (!known.has("departure")) questions.push({ key: "departure", question: "Which airport or station will you use for the return trip, and at about what time?", impact: "high", status: "open" });
  if (!known.has("party_size")) questions.push({ key: "party_size", question: "How many people are travelling?", impact: "high", status: "open" });
  if (!known.has("transport_preference")) questions.push({ key: "transport_preference", question: "Do you prefer rides, public transport, walking, or Landi's route-based recommendation?", impact: "high", status: "open" });
  return questions;
}

export function summarizeFacts(facts: PlanningFact[]): string {
  const keys = new Set(facts.map((item) => item.key));
  const labels: Record<string, string> = {
    destination: "Destination",
    timing: "Trip timing",
    travel_year: "Year",
    travel_dates: "Travel dates",
    purpose: "Trip goal",
    interests: "Preferences",
    constraints: "Constraints",
    transport_preference: "Local transport",
    party_size: "Travelers",
    accommodation: "Accommodation",
    arrival_origin: "Departure point",
    arrival_node: "Arrival point",
    arrival_time: "Expected arrival",
    arrival: "Arrival plan",
    departure: "Return plan",
    arrival_status: "Transport booking"
  };
  return facts
    .filter((item) => !(item.key === "timing" && keys.has("travel_dates")))
    .filter((item) => !(item.key.startsWith("arrival_") && keys.has("arrival")))
    .map((item) => item.key === "arrival_status" ? "Flight or train ticket not booked yet" : `${labels[item.key] ?? item.key}: ${item.value}`)
    .join("；");
}

export function completeArrivalFromPartialFacts(facts: PlanningFact[], updatedAt: string): PlanningFact[] {
  if (valueOf(facts, "arrival")) return facts;
  const origin = valueOf(facts, "arrival_origin");
  const node = valueOf(facts, "arrival_node");
  const time = valueOf(facts, "arrival_time");
  if (!origin || !node || !time) return facts;
  return upsertFact(facts, fact("arrival", `Depart from ${origin}, arrive at ${node} at about ${time}`, updatedAt));
}

export function fact(key: string, value: string, updatedAt: string): PlanningFact {
  return { key, value, source: "user", confirmed: true, updatedAt };
}

export function upsertFact(facts: PlanningFact[], next: PlanningFact): PlanningFact[] {
  return [...facts.filter((fact) => fact.key !== next.key), next];
}

export function valueOf(facts: PlanningFact[], key: string): string | undefined { return facts.find((fact) => fact.key === key)?.value; }

export function firstMatch(value: string, patterns: RegExp[]): string | undefined {
  for (const pattern of patterns) {
    const match = pattern.exec(value);
    if (match?.[1] || match?.[0]) return (match?.[1] ?? match[0]).trim();
  }
  return undefined;
}

export function chinesePartyNumber(value: string): number {
  const digits: Record<string, number> = { 一: 1, 二: 2, 两: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9 };
  if (value === "十") return 10;
  if (!value.includes("十")) return digits[value] ?? Number.NaN;
  const [tens, ones] = value.split("十");
  return (tens ? digits[tens] ?? Number.NaN : 1) * 10 + (ones ? digits[ones] ?? Number.NaN : 0);
}

export function planningStartDate(value: string): string | undefined {
  return planningTravelDateRange(value)?.startDate ?? planningSingleDate(value);
}

export type PlanningTravelDateRange = { startDate: string; endDate: string };

export function planningTravelDateRange(value: string): PlanningTravelDateRange | undefined {
  const normalized = value.trim();
  const iso = /^(20\d{2})[-/](\d{1,2})[-/](\d{1,2})\s*(?:到|至|to|-|–|—)\s*(20\d{2})[-/](\d{1,2})[-/](\d{1,2})$/iu.exec(normalized);
  if (iso) return checkedDateRange([iso[1]!, iso[2]!, iso[3]!], [iso[4]!, iso[5]!, iso[6]!]);

  const chinese = /^(20\d{2})年\s*(\d{1,2})月\s*(\d{1,2})[日号]?\s*(?:到|至|-|–|—)\s*(?:(20\d{2})年\s*)?(?:(\d{1,2})月\s*)?(\d{1,2})[日号]?$/u.exec(normalized);
  if (chinese) return checkedDateRange(
    [chinese[1]!, chinese[2]!, chinese[3]!],
    [chinese[4] ?? chinese[1]!, chinese[5] ?? chinese[2]!, chinese[6]!]
  );

  const english = /^(January|February|March|April|May|June|July|August|September|October|November|December)\s+(\d{1,2})(?:st|nd|rd|th)?\s*(?:to|-|–|—)\s*(?:(January|February|March|April|May|June|July|August|September|October|November|December)\s+)?(\d{1,2})(?:st|nd|rd|th)?,?\s+(20\d{2})$/iu.exec(normalized);
  if (!english) return undefined;
  const startMonth = monthNumber(english[1]!);
  const endMonth = monthNumber(english[3] ?? english[1]!);
  return checkedDateRange([english[5]!, String(startMonth), english[2]!], [english[5]!, String(endMonth), english[4]!]);
}

function planningSingleDate(value: string): string | undefined {
  const iso = /\b(20\d{2})[-/](\d{1,2})[-/](\d{1,2})\b/.exec(value);
  if (iso) return checkedDate(iso[1]!, iso[2]!, iso[3]!);
  const chinese = /(20\d{2})年\s*(\d{1,2})月\s*(\d{1,2})[日号]?/.exec(value);
  if (chinese) return checkedDate(chinese[1]!, chinese[2]!, chinese[3]!);
  const english = /\b(January|February|March|April|May|June|July|August|September|October|November|December)\s+(\d{1,2})(?:st|nd|rd|th)?,?\s+(20\d{2})\b/i.exec(value);
  if (!english) return undefined;
  return checkedDate(english[3]!, String(monthNumber(english[1]!)), english[2]!);
}

function monthNumber(value: string): number {
  return ["january", "february", "march", "april", "may", "june", "july", "august", "september", "october", "november", "december"].indexOf(value.toLowerCase()) + 1;
}

function checkedDateRange(start: [string, string, string], end: [string, string, string]): PlanningTravelDateRange | undefined {
  const startDate = checkedDate(...start);
  const endDate = checkedDate(...end);
  if (!startDate || !endDate || startDate > endDate) return undefined;
  return { startDate, endDate };
}

function checkedDate(yearValue: string, monthValue: string, dayValue: string): string | undefined {
  const year = Number(yearValue);
  const month = Number(monthValue);
  const day = Number(dayValue);
  if (!Number.isInteger(year) || !Number.isInteger(month) || !Number.isInteger(day) || month < 1 || month > 12 || day < 1 || day > 31) return undefined;
  const date = new Date(Date.UTC(year, month - 1, day));
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) return undefined;
  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

function extractTravelYear(message: string): string | undefined {
  const full = /(?:^|[^\d])(20\d{2})\s*年/u.exec(message)?.[1];
  if (full) return full;
  const short = /(?:^|[^\d])(\d{2})\s*年/u.exec(message)?.[1];
  if (!short) return undefined;
  const numeric = Number(short);
  return numeric >= 20 && numeric <= 99 ? `20${short}` : undefined;
}

function arrivalFollowUpQuestion(facts: PlanningFact[]): string {
  if (valueOf(facts, "arrival_status") === "not_booked") return "After booking, share the departure point, arrival airport or station, and expected arrival time.";
  const origin = valueOf(facts, "arrival_origin");
  const node = valueOf(facts, "arrival_node");
  const time = valueOf(facts, "arrival_time");
  const remembered = [origin ? `departing from ${origin}` : "", time ? `arriving at about ${time}` : ""].filter(Boolean).join(", ");
  if (!origin) return `${remembered ? `I noted ${remembered}. ` : ""}Where will you depart from?`;
  if (!node) return `${remembered ? `I noted ${remembered}. ` : ""}Which airport or station will you arrive at?`;
  if (!time) return `I noted departure from ${origin} and arrival at ${node}. About what time will you arrive?`;
  return "Where will you depart from, which airport or station will you arrive at, and at about what time?";
}

function normalizeDestination(value: string): string {
  return value
    .replace(/(?:旅行|旅游|出行|度假|玩|旅居)?\s*(?:大约|约)?\s*(?:\d+|[一二三四五六七八九十两]+)\s*(?:天|晚|周|个月).*$/u, "")
    .replace(/(?:旅行|旅游|出行|玩|度假)$/u, "")
    .trim();
}

function normalizeTransport(value: string): string {
  if (/打车|出租车|网约车/u.test(value)) return "打车";
  if (/地铁|公交|公共交通/u.test(value)) return "公共交通";
  if (/Landi\s*推荐/iu.test(value)) return "Landi推荐";
  return value.trim();
}

function hasArrivalNode(message: string): boolean {
  return /机场|航站楼|火车站|高铁站|车站|港口|码头|自驾|开车抵达|airport|terminal|railway station|train station|ferry terminal|port|driv(?:e|ing)/i.test(message)
    || /\b[A-Z]{3}\b/.test(message);
}

function hasArrivalOrigin(message: string): boolean {
  return /从[^，。；;,!！?？\n]{1,40}(?:出发|启程)|(?:departing|leaving|flying|travelling|traveling)\s+from\s+[^,.!?;\n]{1,40}/i.test(message);
}

function hasDepartureIntent(message: string): boolean {
  return /返程|回程|离开|起飞|出发回|depart(?:ure|ing)?|leav(?:e|ing)|return flight/i.test(message);
}

function hasDepartureNode(message: string): boolean {
  return /(?:从|由)[^，。；;,!！?？\n]{0,32}(?:机场|航站楼|火车站|高铁站|车站|港口|码头)|(?:机场|航站楼|火车站|高铁站|车站|港口|码头)[^，。；;,!！?？\n]{0,16}(?:离开|出发|起飞)|(?:from\s+)?[^,.!?;\n]{1,40}(?:airport|terminal|railway station|train station|port)/i.test(message)
    || /\b[A-Z]{3}\b/.test(message);
}

function hasArrivalTime(message: string): boolean {
  return /(?:[01]?\d|2[0-3])[:：][0-5]\d|(?:上午|下午|晚上|凌晨)?\s*\d{1,2}\s*[点時时](?:\s*\d{1,2}\s*分)?|\b(?:1[0-2]|0?[1-9])(?::[0-5]\d)?\s*(?:am|pm)\b/i.test(message);
}

function isLikelyDestination(message: string): boolean {
  return message.length <= 28 && !/[，。；;,!！?？\s]/u.test(message) && !/^(我|想|计划|去|到|还|没有|嗯|好的)/u.test(message);
}
