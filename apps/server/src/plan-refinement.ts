import type { Plan } from "@c-assistant/core";

export interface PlanRefinementState {
  readyForReview: boolean;
  followUpQuestion?: string;
  unresolvedCount: number;
}

/**
 * Selects at most one optional high-value question for progressive Plan
 * refinement. A Plan is always reviewable: unanswered details stay visible as
 * assumptions instead of turning confirmation into an intake-form gate.
 */
export function planRefinementState(plan: Pick<Plan, "title" | "location" | "dates" | "assumptions" | "nextAction"> & Partial<Pick<Plan, "knownInformation" | "sources">>): PlanRefinementState {
  const answerable = plan.assumptions.filter(isUserAnswerableAssumption);
  const explicitQuestion = isQuestion(plan.nextAction)
    && !/review|confirm|核对|审阅|确认完整计划/i.test(plan.nextAction)
    && !isSourceResearchQuestion(plan.nextAction)
    && !isRedundantDocumentQuestion(plan.nextAction, plan)
    ? plan.nextAction.trim()
    : undefined;
  const followUpQuestion = explicitQuestion ?? questionForAssumptions(answerable, plan);
  return {
    readyForReview: true,
    ...(followUpQuestion ? { followUpQuestion } : {}),
    unresolvedCount: answerable.length
  };
}

function isRedundantDocumentQuestion(value: string, plan: Pick<Plan, "title" | "location" | "assumptions"> & Partial<Pick<Plan, "knownInformation" | "sources">>): boolean {
  const question = value.toLocaleLowerCase();
  const asksForDocumentName = /(?:what|which).*(?:exact|full|official).*(?:institution|university|college|school).*name|(?:institution|university|college|school).*name.*(?:admission|offer|letter|document)|录取通知书.*(?:学校|院校|机构).*名称|(?:学校|院校|机构).*名称.*录取通知书/.test(question);
  if (!asksForDocumentName) return false;
  const context = [plan.title, plan.location, ...plan.assumptions, ...(plan.knownInformation ?? []), ...(plan.sources ?? []).flatMap((source) => [source.title, source.authority])].join(" ");
  return /\b[A-Z][A-Za-z'’&.-]+(?:\s+[A-Z][A-Za-z'’&.-]+){0,5}\s+(?:University|College|School|Institute)\b|[\u3400-\u9fff]{2,24}(?:大学|学院|学校)/.test(context);
}

function isUserAnswerableAssumption(value: string): boolean {
  const normalized = value.toLocaleLowerCase();
  if (/official source|official guidance|policy entitlement|provider availability|not been verified|requires source-backed|academic calendar|registration date|institutional deadline|official deadline|官方来源|官方指引|政策适用|尚未核验|尚未验证|官方日期|报到日期|注册日期|校历|机构截止日期/.test(normalized)) return false;
  return /fixed event|fixed commitment|appointment|meeting|concert|exhibition|flight|train|origin|check-in|program|degree|semester|intake|date|time|day|arrival|departure|return|venue|address|location|city|airport|station|accommodation|hotel|stay|budget|currency|travell?er|party|people|luggage|baggage|preference|priority|固定事项|关键活动|预约|会议|演出|展会|航班|列车|出发地|入住|项目类型|学位|学期|入学季|日期|时间|抵达|出发|返程|场馆|地址|地点|城市|机场|车站|住宿|酒店|预算|币种|同行|人数|行李|偏好|优先/.test(normalized);
}

function questionForAssumptions(assumptions: string[], plan: Pick<Plan, "title" | "location" | "dates">): string | undefined {
  if (!assumptions.length) return undefined;
  const joined = assumptions.join(" ").toLocaleLowerCase();
  const questions = {
    fixedNode: "What must you attend at a fixed time? Share its place and date or time, or say there is no fixed event.",
    arrivalNode: "Where will you depart from, which airport or station will you arrive at, and at about what time?",
    returnNode: "Which airport or station will you depart from for the return trip, and at about what time? Say not booked yet if it is undecided.",
    program: "Is this an undergraduate, master's, doctoral, language, or exchange program?",
    intake: "Which year and academic term do you plan to start?",
    dates: "What date do you expect to arrive, and when will you leave? Approximate dates are fine.",
    venue: "Where is the main event, exhibition, or place you need to visit? A name or address is enough.",
    accommodation: "Have you booked accommodation? If yes, send its name or address; if not, I can recommend an area based on access.",
    arrival: "Which airport or station will you arrive at, and at about what time?",
    travelers: "How many people are travelling, and roughly how much luggage will you have?",
    budget: "For this Plan, do you care most about budget, convenience, or comfort? You can also share a budget range."
  };

  if (/travel date|arrival date|departure date|return date|travel day|旅行日期|抵达日期|出发日期|返程日期/.test(joined)) return questions.dates;
  if (/fixed event|fixed commitment|appointment|meeting|concert|exhibition|固定事项|关键活动|预约|会议|演出|展会/.test(joined)) return questions.fixedNode;
  if (/arrival point|arrival airport|arrival station|origin|flight arrival|train arrival|抵达机场|抵达车站|出发地|抵达节点/.test(joined)) return questions.arrivalNode;
  if (/return airport|return station|return flight|return train|返程机场|返程车站|返程航班|返程列车/.test(joined)) return questions.returnNode;
  if (/venue|event location|exhibition|场馆|展会地点|活动地点/.test(joined)) return questions.venue;
  if (/accommodation|hotel|stay|住宿|酒店/.test(joined)) return questions.accommodation;
  if (/arrival|airport|station|terminal|抵达|机场|车站|航站楼/.test(joined)) return questions.arrival;
  if (/program|degree|本科|硕士|博士|语言项目|交换项目|项目类型|学位/.test(joined)) return questions.program;
  if (/semester|academic term|intake|学期|入学季/.test(joined)) return questions.intake;
  if (/travell?er|party|people|luggage|baggage|同行|人数|行李/.test(joined)) return questions.travelers;
  if (/budget|currency|preference|priority|预算|币种|偏好|优先/.test(joined)) return questions.budget;
  return undefined;
}

function isQuestion(value: string): boolean {
  return /[?？]\s*$/.test(value.trim());
}

function isSourceResearchQuestion(value: string): boolean {
  const normalized = value.toLocaleLowerCase();
  return /official|published|academic calendar|registration date|institutional deadline|official deadline|opening hours|policy requirement|tuition fee|weather forecast|官网|官方|校历|报到日期|注册日期|截止日期|开放时间|政策要求|学费|天气预报/.test(normalized);
}
