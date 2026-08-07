import { createAmapPlaceHandoff, type AmapNearbyPlace, type TelegramReplyMarkup } from "@c-assistant/connectors";

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

export function formatTelegramNearbyFood(input: { places: AmapNearbyPlace[]; partySize: number }): { text: string; replyMarkup?: TelegramReplyMarkup } {
  if (input.places.length === 0) {
    return { text: `Amap returned no nearby restaurant candidates for this location (party size: ${input.partySize}). No distance limit was imposed by C-assistant. Your shared coordinates were not saved.` };
  }
  const places = input.places.slice(0, 5);
  const facts = places.map((place, index) => `${index + 1}. ${place.name}\n${formatDistance(place.distanceMeters)} · ${place.address}\n${place.type}`);
  return {
    text: `Nearby food for ${input.partySize} ${input.partySize === 1 ? "person" : "people"}\n\nAmap returned these candidates in provider distance order. C-assistant has not ranked them or checked table availability.\n\n${facts.join("\n\n")}\n\nOpen a candidate in Amap to inspect it and take the next action yourself. No order, reservation, or payment was started. The shared coordinates were not saved.`,
    replyMarkup: { inline_keyboard: places.map((place, index) => [{ text: `Open ${index + 1} in Amap`, url: createAmapPlaceHandoff({ place }).url }]) }
  };
}

function formatDistance(distanceMeters: number): string {
  return distanceMeters < 1_000 ? `${Math.round(distanceMeters)} m away` : `${(distanceMeters / 1_000).toFixed(1)} km away`;
}
