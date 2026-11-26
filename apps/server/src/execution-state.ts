import type { Plan, PlanPlace } from "@c-assistant/core";
import type { SqliteWorkspaceStore } from "@c-assistant/storage";
import type { CompiledExecutionItinerary } from "./execution-itinerary.js";
import type { DepartureDetails } from "./departure-assistance.js";

export interface ActivityProgress {
  expectedArrivalAt?: number;
  phase: "preparing" | "travelling" | "active" | "done" | "skipped";
  startedAt?: string;
  destination?: PlanPlace;
  travelMinutes?: number;
}
interface Delivery { status: "sending" | "sent" | "retry" | "failed"; attempts: number; retryAt: number; failureCode?: string }
export interface ExecutionAssistantState {
  compiled?: CompiledExecutionItinerary;
  obstructionMonitor?: unknown;
  steps: Record<string, ActivityProgress>;
  deliveries: Record<string, Delivery>;
  timeZones?: Record<string, string>;
  dayGreetings?: Record<string, boolean>;
  timezonePromptSent?: boolean;
  gapPromptSent?: boolean;
  snoozeUntil?: number;
  requestedNextActivityId?: string;
  movementTarget?: { activityId: string; requestedAt: number; destination?: PlanPlace };
  mealDestinations?: Record<string, PlanPlace[]>;
  departure?: DepartureDetails;
  airportDepartures?: Record<string, DepartureDetails>;
  airportInputActivityId?: string;
}
export function readExecutionState(store: SqliteWorkspaceStore, plan: Plan) {
  const saved = store.getExecutionAssistantState(plan.id, plan.version);
  return { revision: saved?.revision ?? 0, data: (saved?.data ?? { steps: {}, deliveries: {} }) as ExecutionAssistantState };
}
