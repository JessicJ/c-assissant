import { createGoogleMapsPlaceHandoff, type NearbyPlaceFact, type TelegramReplyMarkup } from "@c-assistant/connectors";
import type { FoodNearbySkillResult } from "@c-assistant/china-country-pack";

export function parseTelegramFoodPartyCallback(value: string | undefined): { planId: string; version: number; partySize: number } | undefined {
  const match = value?.match(/^food_party:(plan-[0-9a-f-]{36}):(\d+):(\d+)$/);
  if (!match) return undefined;
  const version = Number(match[2]);
  const partySize = Number(match[3]);
  if (!Number.isInteger(version) || version < 1 || !Number.isInteger(partySize) || partySize < 1 || partySize > 20) return undefined;
  return { planId: match[1]!, version, partySize };
}

export function telegramFoodPartyMarkup(planId: string, version: number): TelegramReplyMarkup {
  return {
    inline_keyboard: [
      [1, 2, 3].map((partySize) => ({ text: String(partySize), callback_data: `food_party:${planId}:${version}:${partySize}` })),
      [4, 5, 6].map((partySize) => ({ text: String(partySize), callback_data: `food_party:${planId}:${version}:${partySize}` }))
    ]
  };
}

export function formatTelegramNearbyFood(input: { result: FoodNearbySkillResult; places: NearbyPlaceFact[]; partySize: number }): { text: string; replyMarkup?: TelegramReplyMarkup } {
  if (input.result.status !== "success" || input.result.facts.length === 0) {
    return { text: `Google Maps returned no nearby restaurant candidates for this location (party size: ${input.partySize}). No distance limit was imposed by Landi. Your shared coordinates were not saved.` };
  }
  const facts = input.result.facts.map((place) => `${place.position}. ${place.name}\n${formatDistance(place.distanceMeters)} · ${place.address}\n${place.type}`);
  const handoffs = input.result.actionCards.flatMap((card) => {
    const place = input.places.find((candidate) => candidate.id === card.candidateId);
    return place ? [{ text: `Open ${input.result.facts.find((fact) => fact.id === place.id)?.position ?? "place"} in Google Maps`, url: createGoogleMapsPlaceHandoff({ place }).url }] : [];
  });
  return {
    text: `Nearby food for ${input.partySize} ${input.partySize === 1 ? "person" : "people"}\n\nGoogle Maps returned these candidates with straight-line distance facts. Landi has not ranked them or checked table availability.\n\n${facts.join("\n\n")}\n\nOpen a candidate in Google Maps to inspect it and take the next action yourself. No order, reservation, or payment was started. The shared coordinates were not saved.`,
    ...(handoffs.length ? { replyMarkup: { inline_keyboard: handoffs.map((button) => [button]) } } : {})
  };
}

function formatDistance(distanceMeters: number): string {
  return distanceMeters < 1_000 ? `${Math.round(distanceMeters)} m away` : `${(distanceMeters / 1_000).toFixed(1)} km away`;
}
