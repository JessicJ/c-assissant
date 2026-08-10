import type { Plan } from "@c-assistant/core";

export type WebAgentMode = "new_plan" | "revise_plan";

export type WebPlanIntake = {
  destination: string;
  arrivalDate: string;
  departureDate?: string;
  openEnded: boolean;
  purpose: string;
  arrivalPoint?: string;
  arrivalTime?: string;
  partySize: number;
  luggage: "unknown" | "light" | "standard" | "heavy";
  accommodation: "not_set" | "needs_recommendation" | "booked";
  accommodationDetail?: string;
  transportPreference: "plan_recommended" | "taxi" | "public_transit" | "walking";
  priority: "balanced" | "budget" | "convenience" | "comfort";
  notes?: string;
};

export function parseWebAgentTurn(value: unknown): { message: string; mode: WebAgentMode; intake?: WebPlanIntake } {
  if (!value || typeof value !== "object") throw new Error("Tell the Agent what you need first.");
  const body = value as { message?: unknown; mode?: unknown; intake?: unknown };
  const mode = body.mode ?? "new_plan";
  if (mode !== "new_plan" && mode !== "revise_plan") throw new Error("Choose whether to create a new Plan or revise the current draft.");
  if (mode === "new_plan") {
    const intake = parsePlanIntake(body.intake);
    return { message: formatPlanIntakeRequest(intake), mode, intake };
  }
  const message = typeof body.message === "string" ? body.message.trim() : "";
  if (!message) throw new Error("Tell the Agent what you need first.");
  if (message.length > 1_500) throw new Error("Keep the message under 1,500 characters.");
  return { message, mode };
}

function parsePlanIntake(value: unknown): WebPlanIntake {
  if (!value || typeof value !== "object") throw new Error("Complete the Plan basics before generating a Plan.");
  const input = value as Record<string, unknown>;
  const text = (key: string, limit: number, required = false) => {
    const result = typeof input[key] === "string" ? input[key].trim() : "";
    if (required && !result) throw new Error(`Plan basic field ${key} is required.`);
    if (result.length > limit) throw new Error(`Plan basic field ${key} is too long.`);
    return result;
  };
  const destination = text("destination", 160, true);
  const arrivalDate = text("arrivalDate", 10, true);
  const openEnded = input.openEnded === true;
  const departureDate = text("departureDate", 10);
  const purpose = text("purpose", 500, true);
  if (!isISODate(arrivalDate)) throw new Error("Choose a valid arrival date.");
  if ((!openEnded || departureDate) && !isISODate(departureDate)) throw new Error("Choose a valid departure date or mark it as open-ended.");
  if (departureDate && departureDate < arrivalDate) throw new Error("Departure cannot be earlier than arrival.");
  const arrivalTime = text("arrivalTime", 5);
  if (arrivalTime && !isLocalTime(arrivalTime)) throw new Error("Choose a valid arrival time.");
  const partySize = typeof input.partySize === "number" ? input.partySize : Number(input.partySize);
  if (!Number.isInteger(partySize) || partySize < 1 || partySize > 20) throw new Error("Party size must be between 1 and 20.");
  const luggage = input.luggage;
  if (!(["unknown", "light", "standard", "heavy"] as unknown[]).includes(luggage)) throw new Error("Choose a supported luggage setting.");
  const accommodation = input.accommodation;
  if (!(["not_set", "needs_recommendation", "booked"] as unknown[]).includes(accommodation)) throw new Error("Choose an accommodation status.");
  const accommodationDetail = text("accommodationDetail", 240);
  if (accommodation === "booked" && !accommodationDetail) throw new Error("Add the booked accommodation name or address.");
  const transportPreference = input.transportPreference;
  if (!(["plan_recommended", "taxi", "public_transit", "walking"] as unknown[]).includes(transportPreference)) throw new Error("Choose a supported transport preference.");
  const priority = input.priority;
  if (!(["balanced", "budget", "convenience", "comfort"] as unknown[]).includes(priority)) throw new Error("Choose a supported Plan priority.");
  return {
    destination,
    arrivalDate,
    ...(departureDate ? { departureDate } : {}),
    openEnded,
    purpose,
    ...(text("arrivalPoint", 160) ? { arrivalPoint: text("arrivalPoint", 160) } : {}),
    ...(arrivalTime ? { arrivalTime } : {}),
    partySize,
    luggage: luggage as WebPlanIntake["luggage"],
    accommodation: accommodation as WebPlanIntake["accommodation"],
    ...(accommodationDetail ? { accommodationDetail } : {}),
    transportPreference: transportPreference as WebPlanIntake["transportPreference"],
    priority: priority as WebPlanIntake["priority"],
    ...(text("notes", 600) ? { notes: text("notes", 600) } : {})
  };
}

function isISODate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00Z`);
  return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

function isLocalTime(value: string): boolean {
  const match = value.match(/^(\d{2}):(\d{2})$/);
  return Boolean(match && Number(match[1]) <= 23 && Number(match[2]) <= 59);
}

function formatPlanIntakeRequest(input: WebPlanIntake): string {
  const lines = [
    "Create a concrete China regional-life Plan from these user-confirmed Plan basics.",
    `Destination: ${input.destination}`,
    `Arrival date: ${input.arrivalDate}${input.arrivalTime ? ` at approximately ${input.arrivalTime}` : ""}`,
    `Departure: ${input.openEnded ? "No fixed departure date" : input.departureDate}`,
    `Purpose: ${input.purpose}`,
    `Party size: ${input.partySize}`,
    `Luggage: ${input.luggage}`,
    `Accommodation: ${input.accommodation}${input.accommodationDetail ? ` — ${input.accommodationDetail}` : ""}`,
    `Transport preference for this Plan: ${input.transportPreference}`,
    `Priority for this Plan: ${input.priority}`
  ];
  if (input.arrivalPoint) lines.push(`Arrival airport or station: ${input.arrivalPoint}`);
  if (input.notes) lines.push(`Additional requirements: ${input.notes}`);
  lines.push("Treat every field above as user-confirmed. Generate the complete draft now; ask at most one later question only if a dependent action still lacks a critical fact.");
  return lines.join("\n");
}

export function assertWebAgentPlanUnchanged(expected: Pick<Plan, "id" | "version">, current: Pick<Plan, "id" | "version">): void {
  if (expected.id !== current.id || expected.version !== current.version) {
    throw new Error("The Plan changed while the Agent was working. Your newer changes were preserved; send the request again if it is still needed.");
  }
}

export function formatWebAgentPlanReply(input: { runtimeName: string; mode: WebAgentMode; plan: Pick<Plan, "title" | "nextAction">; followUpQuestion?: string }): string {
  const action = input.mode === "revise_plan" ? "updated the current draft" : "prepared a new draft";
  if (input.followUpQuestion) {
    return `${input.runtimeName} ${action}: “${input.plan.title}”. You can review or stop now; unanswered details will remain visible as pending confirmation items. If you want to improve one important detail, answer this: ${input.followUpQuestion}`;
  }
  return `${input.runtimeName} ${action}: “${input.plan.title}”. The Plan is ready to review. Check its facts and pending confirmation items, then confirm it when you are ready to activate eligible reminders and execution.`;
}
