import type { AssistantPersonalityId } from "@c-assistant/core/assistant-personality";
import type { Plan } from "@c-assistant/core";

export function isStarterPlan(plan: Plan): boolean {
  return plan.title === "Attend an exhibition in Shanghai" && plan.version === 1;
}

export function refinementIntro(plan: Plan | null, personality: AssistantPersonalityId = "local_insider"): string {
  if (!plan) return "There is no plan to refine yet. Start with the destination, dates, and the goal that matters most.";
  const question = planRefinementQuestion(plan);
  if (personality === "travel_buddy") return question ? `One little detail to figure out (˶ᵔᵕᵔ˶) ${question}\nYou can answer it or review the plan as it is; the remaining details will stay marked for confirmation.` : 'Want to switch something up? Tell me what you have in mind (˶ᵔᵕᵔ˶) Or review and confirm the plan when you’re ready.';
  if (personality === "miles") return question ? `Alright, one thing to figure out: ${question}\nAnswer it or review the draft now. Anything still unknown will stay marked for confirmation.` : 'Alright, what are we switching up? Tell me what you want to change, or review and confirm the plan.';
  return question
    ? `One detail worth settling: ${question}\nYou can answer it or review the draft now. Anything still unknown stays marked for confirmation.`
    : "The draft is ready to review. If something doesn’t suit you, tell me what you’d like to change; otherwise, confirm it when you’re ready.";
}

export function planRefinementQuestion(plan: Pick<Plan, "title" | "location" | "dates" | "assumptions" | "nextAction"> & Partial<Pick<Plan, "knownInformation" | "sources">>): string | null {
  const sourceResearch = /official|published|academic calendar|registration date|institutional deadline|official deadline|opening hours|policy requirement|tuition fee|weather forecast/i;
  if (questionLike(plan.nextAction) && !/review|confirm/i.test(plan.nextAction) && !sourceResearch.test(plan.nextAction) && !redundantDocumentQuestion(plan.nextAction, plan)) return plan.nextAction.trim();
  const answerable = plan.assumptions.filter((item) => !/official source|official guidance|policy entitlement|provider availability|not been verified|requires source-backed|academic calendar|registration date|institutional deadline|official deadline/i.test(item));
  const joined = answerable.join(" ").toLocaleLowerCase();
  if (!joined) return null;
  if (/travel date|arrival date|departure date|return date|travel day/.test(joined)) return "What date do you expect to arrive, and when will you leave? Approximate dates are fine.";
  if (/fixed event|fixed commitment|appointment|meeting|concert|exhibition/.test(joined)) return "What must you attend at a fixed time? Share its place and date or time, or say there is no fixed event.";
  if (/arrival point|arrival airport|arrival station|origin|flight arrival|train arrival/.test(joined)) return "Where will you depart from, which airport or station will you arrive at, and at about what time?";
  if (/return airport|return station|return flight|return train/.test(joined)) return "Which airport or station will you depart from for the return trip, and at about what time? Say not booked yet if it is undecided.";
  if (/venue|event location|exhibition/.test(joined)) return "Where is the main event, exhibition, or place you need to visit? A name or address is enough.";
  if (/accommodation|hotel|stay/.test(joined)) return "Have you booked accommodation? If yes, send its name or address; if not, I can recommend an area based on access.";
  if (/arrival|airport|station|terminal/.test(joined)) return "Which airport or station will you arrive at, and at about what time?";
  if (/program|degree/.test(joined)) return "Is this an undergraduate, master's, doctoral, language, or exchange program?";
  if (/semester|academic term|intake/.test(joined)) return "Which year and academic term do you plan to start?";
  if (/travell?er|party|people|luggage|baggage/.test(joined)) return "How many people are travelling, and roughly how much luggage will you have?";
  if (/budget|currency|preference|priority/.test(joined)) return "For this Plan, do you care most about budget, convenience, or comfort? You can also share a budget range.";
  return null;
}

export function formatDate(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : new Intl.DateTimeFormat("en-US", { year: "numeric", month: "long", day: "numeric" }).format(date);
}

function questionLike(value: string): boolean {
  return /\?\s*$/.test(value.trim());
}

function redundantDocumentQuestion(value: string, plan: Pick<Plan, "title" | "location" | "assumptions"> & Partial<Pick<Plan, "knownInformation" | "sources">>): boolean {
  const question = value.toLocaleLowerCase();
  if (!/(?:what|which).*(?:exact|full|official).*(?:institution|university|college|school).*name|(?:institution|university|college|school).*name.*(?:admission|offer|letter|document)/.test(question)) return false;
  const context = [plan.title, plan.location, ...plan.assumptions, ...(plan.knownInformation ?? []), ...(plan.sources ?? []).flatMap((source) => [source.title, source.authority])].join(" ");
  return /\b[A-Z][A-Za-z'’&.-]+(?:\s+[A-Z][A-Za-z'’&.-]+){0,5}\s+(?:University|College|School|Institute)\b/.test(context);
}
