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
export function planRefinementState(plan: Pick<Plan, "title" | "location" | "dates" | "assumptions" | "nextAction">): PlanRefinementState {
  const answerable = plan.assumptions.filter(isUserAnswerableAssumption);
  const explicitQuestion = isQuestion(plan.nextAction) && !/review|confirm|核对|审阅|确认完整计划/i.test(plan.nextAction)
    ? plan.nextAction.trim()
    : undefined;
  const followUpQuestion = explicitQuestion ?? questionForAssumptions(answerable, plan);
  return {
    readyForReview: true,
    ...(followUpQuestion ? { followUpQuestion } : {}),
    unresolvedCount: answerable.length
  };
}

function isUserAnswerableAssumption(value: string): boolean {
  const normalized = value.toLocaleLowerCase();
  if (/official source|official guidance|policy entitlement|provider availability|not been verified|requires source-backed|官方来源|官方指引|政策适用|尚未核验|尚未验证/.test(normalized)) return false;
  return /date|time|day|arrival|departure|return|venue|address|location|city|airport|station|accommodation|hotel|stay|budget|currency|travell?er|party|people|luggage|baggage|preference|priority|日期|时间|抵达|出发|返程|场馆|地址|地点|城市|机场|车站|住宿|酒店|预算|币种|同行|人数|行李|偏好|优先/.test(normalized);
}

function questionForAssumptions(assumptions: string[], plan: Pick<Plan, "title" | "location" | "dates">): string | undefined {
  if (!assumptions.length) return undefined;
  const joined = assumptions.join(" ").toLocaleLowerCase();
  const chinese = /[\u3400-\u9fff]/.test(`${plan.title} ${plan.location} ${plan.dates} ${assumptions.join(" ")}`);
  const questions = chinese ? {
    dates: "你预计哪一天抵达，哪一天离开？大致日期也可以。",
    venue: "这次主要活动、展会或办事地点在哪里？发送名称或地址都可以。",
    accommodation: "住宿已经订好了吗？如果有，请告诉我名称或地址；如果没有，我会按通勤条件推荐区域。",
    arrival: "你将从哪个机场或车站抵达，大约几点到？",
    travelers: "这次有几个人同行，行李大概有多少？",
    budget: "这次计划更重视预算、便利还是舒适？如果有预算范围也可以一起告诉我。"
  } : {
    dates: "What date do you expect to arrive, and when will you leave? Approximate dates are fine.",
    venue: "Where is the main event, exhibition, or place you need to visit? A name or address is enough.",
    accommodation: "Have you booked accommodation? If yes, send its name or address; if not, I can recommend an area based on access.",
    arrival: "Which airport or station will you arrive at, and at about what time?",
    travelers: "How many people are travelling, and roughly how much luggage will you have?",
    budget: "For this Plan, do you care most about budget, convenience, or comfort? You can also share a budget range."
  };

  if (/date|day|departure|return|日期|出发|返程/.test(joined)) return questions.dates;
  if (/venue|event location|exhibition|场馆|展会地点|活动地点/.test(joined)) return questions.venue;
  if (/accommodation|hotel|stay|住宿|酒店/.test(joined)) return questions.accommodation;
  if (/arrival|airport|station|terminal|抵达|机场|车站|航站楼/.test(joined)) return questions.arrival;
  if (/travell?er|party|people|luggage|baggage|同行|人数|行李/.test(joined)) return questions.travelers;
  if (/budget|currency|preference|priority|预算|币种|偏好|优先/.test(joined)) return questions.budget;
  return undefined;
}

function isQuestion(value: string): boolean {
  return /[?？]\s*$/.test(value.trim());
}
