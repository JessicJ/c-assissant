import type { Plan } from "@c-assistant/core";

export const DEFAULT_HANDOFF_WAIT_SECONDS = 10 * 60;
export const DEFAULT_HANDOFF_SAFETY_SECONDS = 10 * 60;
export const HANDOFF_DELAY_SECONDS = 15 * 60;

export type ExpectedHandoffState = "expected_waiting" | "expected_in_transit" | "expected_arrived";

export function expectedArrivalAt(input: {
  basisAt: string;
  routeDurationSeconds: number;
  waitBufferSeconds?: number;
  safetyMarginSeconds?: number;
}): string {
  const basis = Date.parse(input.basisAt);
  const wait = input.waitBufferSeconds ?? DEFAULT_HANDOFF_WAIT_SECONDS;
  const safety = input.safetyMarginSeconds ?? DEFAULT_HANDOFF_SAFETY_SECONDS;
  if (!Number.isFinite(basis) || ![input.routeDurationSeconds, wait, safety].every((value) => Number.isFinite(value) && value >= 0)) {
    throw new Error("A route handoff needs valid timing facts.");
  }
  return new Date(basis + (wait + input.routeDurationSeconds + safety) * 1_000).toISOString();
}

/** Expected states are derived projections. They are never confirmed journey facts. */
export function expectedHandoffState(input: { basisAt: string; expectedArrivalAt: string; waitBufferSeconds: number; now?: string }): ExpectedHandoffState {
  const basis = Date.parse(input.basisAt);
  const expectedArrival = Date.parse(input.expectedArrivalAt);
  const now = Date.parse(input.now ?? new Date().toISOString());
  if (![basis, expectedArrival, now].every(Number.isFinite) || !Number.isFinite(input.waitBufferSeconds) || input.waitBufferSeconds < 0) {
    throw new Error("A route handoff needs valid projection times.");
  }
  if (now >= expectedArrival) return "expected_arrived";
  if (now >= basis + input.waitBufferSeconds * 1_000) return "expected_in_transit";
  return "expected_waiting";
}

export function formatExpectedArrivalGuidance(plan: Plan): string {
  const stay = plan.configuration.accommodation;
  const destination = stay.name?.trim() || plan.location;
  const address = stay.address?.trim();
  return `You should be approaching ${destination}.\n\nWhen you arrive, show this address at reception:${address ? `\n${address}` : "\nOpen the saved destination in your current Plan."}\n\nThis message follows Landi's estimated timeline. It does not mean Landi has confirmed your location, ride, or arrival. If everything is proceeding normally, you do not need to reply.`;
}
