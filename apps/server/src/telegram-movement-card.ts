import type { TelegramReplyMarkup } from "@c-assistant/connectors";
import type { MovementActionCard, RecommendedMovementAction } from "./execution-action-card.js";
import type { NextPlannedStopResult } from "./next-planned-stop.js";

export function parseTelegramMovementGoStaleCallback(value: string | undefined): { planId: string; version: number; stopId: string } | undefined {
  const match = value?.match(/^go_stale:(plan-[0-9a-f-]{36}):(\d+):([A-Za-z0-9_.~%:-]+)$/);
  if (!match) return undefined;
  const version = Number(match[2]);
  if (!Number.isInteger(version) || version < 1) return undefined;
  try {
    return { planId: match[1]!, version, stopId: decodeURIComponent(match[3]!) };
  } catch {
    return undefined;
  }
}

export function formatTelegramMovementStaleConfirmation(selection: Extract<NextPlannedStopResult, { status: "stale_confirmation_required" }>): { text: string; replyMarkup: TelegramReplyMarkup } {
  return {
    text: `${selection.recoveryMessage}\n\nThis confirmation affects only the current /go interaction. It will not change your Plan or mark any stop complete.`,
    replyMarkup: { inline_keyboard: [[{ text: "Yes, still go", callback_data: `go_stale:${selection.planId}:${selection.planVersion}:${safeCallbackStopId(selection.place.id)}` }]] }
  };
}

export function formatTelegramMovementLocationRequest(stopName: string): { text: string; replyMarkup: TelegramReplyMarkup } {
  return {
    text: `Share your current location to prepare movement help for ${stopName}. Landi will use it once for this /go card, it expires after 15 minutes, and it will not be saved to your Profile or Plan.`,
    replyMarkup: { keyboard: [[{ text: "Share current location", request_location: true }]], resize_keyboard: true, one_time_keyboard: true }
  };
}

export function formatTelegramMovementActionCard(card: MovementActionCard): { text: string; replyMarkup?: TelegramReplyMarkup } {
  if (card.status === "blocked" || !card.primaryRecommendation) return { text: `${card.recoveryMessage ?? "Landi cannot prepare movement help for this Plan right now."}\n\nNo booking, ride, payment, route start, or Plan change was made.` };
  const primary = card.primaryRecommendation;
  const routeText = formatRoute(primary);
  const alternatives = card.alternatives.length ? `\n\nOther useful options:\n${card.alternatives.map((action) => `- ${action.title}${action.route ? ` · ${formatDistance(action.route.distanceMeters)}${action.route.durationSeconds !== undefined ? ` · about ${formatDuration(action.route.durationSeconds)}` : ""}` : ""}`).join("\n")}` : "";
  const manual = primary.handoffs.filter((handoff) => handoff.kind === "manual");
  const manualText = manual.length ? `\n\nUse a local app:\n${manual.map((handoff) => `- ${handoff.serviceName}: ${handoff.instructions}`).join("\n")}` : "";
  const copyText = `\n\nPickup:\n${primary.handoffs.find((handoff) => handoff.id.endsWith(":copy_pickup"))?.copyText ?? card.originName ?? "Shared current location"}\n\nDestination:\n${primary.handoffs.find((handoff) => handoff.id.endsWith(":copy_destination"))?.copyText ?? card.destinationName ?? "Next planned stop"}`;
  const degraded = card.degradedReasons.length ? `\n\nLimited context: ${card.degradedReasons.map(readableReason).join(", ")}.` : "";
  const buttons = primary.handoffs.filter((handoff) => (handoff.kind === "map_link" || handoff.kind === "manual" || handoff.kind === "prefill_capable") && handoff.url).slice(0, 4).map((handoff) => [{ text: handoff.label, url: handoff.url! }]);
  return {
    text: `Movement card\nTo: ${card.stopName ?? card.destinationName}\nPrimary: ${primary.title}${routeText}${alternatives}${manualText}${copyText}${degraded}`,
    ...(buttons.length ? { replyMarkup: { inline_keyboard: buttons } } : {})
  };
}

function formatRoute(action: RecommendedMovementAction): string {
  if (!action.route) return "\nRoute: Google Maps route facts are unavailable, so verify the live route in the handoff before moving.";
  return `\nRoute: ${formatDistance(action.route.distanceMeters)}${action.route.durationSeconds !== undefined ? ` · about ${formatDuration(action.route.durationSeconds)}` : ""} · Google Maps ${action.route.mode} fact.`;
}

function formatDistance(distanceMeters: number): string {
  return distanceMeters >= 1_000 ? `${(distanceMeters / 1_000).toFixed(1)} km` : `${Math.round(distanceMeters)} m`;
}

function formatDuration(durationSeconds: number): string {
  return `${Math.max(1, Math.round(durationSeconds / 60))} min`;
}

function readableReason(reason: string): string {
  return reason.replaceAll("_", " ");
}

function safeCallbackStopId(stopId: string): string {
  return encodeURIComponent(stopId);
}
