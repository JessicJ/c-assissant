import type { Plan, Task } from "@c-assistant/core";

export type PackingDisplayItem = { key: string; title: string; detail: string; group: string; task?: Task };
export type PackingCheckStorage = Pick<Storage, "getItem" | "setItem">;

export function planPackingItems(plan: Plan): PackingDisplayItem[] {
  const taskItems = plan.stages.flatMap((stage) => stage.tasks)
    .filter((task) => task.owner === "user" && task.preparationCategory === "packing_item")
    .map((task) => ({ key: task.id, title: task.title, detail: task.description ?? task.dueLabel, group: packingGroup(task.title, task.description), task }));
  if (taskItems.length) return taskItems;
  if (plan.presentation?.kind !== "itinerary") return [];
  return suggestedPackingItems(plan);
}

export function suggestedPackingItems(plan: Plan): PackingDisplayItem[] {
  const presentation = plan.presentation;
  if (presentation?.kind !== "itinerary") return [];
  const text = [
    plan.title,
    plan.location,
    plan.dates,
    presentation.summary,
    ...presentation.days.flatMap((day) => [day.city, day.title, day.summary]),
    ...presentation.places.flatMap((place) => [place.name, place.localizedName, place.category, place.area, place.whyWorthIt, place.plan, place.tip])
  ].filter(Boolean).join(" ").toLocaleLowerCase();
  const months = tripMonths(plan);
  const cities = new Set([plan.location, ...presentation.days.map((day) => day.city), ...presentation.places.map((place) => place.city)].flatMap((value) => value?.split(/\s*(?:\/|,|、|，|&|\band\b)\s*/i).map((city) => city.trim().toLocaleLowerCase()).filter(Boolean) ?? []));
  const items: PackingDisplayItem[] = [
    { key: "suggested-passport-wallet", group: "Essentials", title: "Passport, payment cards, and a small cash wallet", detail: "Keep hotel check-in, rail, reservation, and small cash-only stop essentials in one reachable pouch." },
    { key: "suggested-phone-power", group: "Essentials", title: "Charged phone, cable, and power bank", detail: "This trip leans on maps, booking pages, translation, and live route checks throughout the day." },
    { key: "suggested-walking-shoes-socks", group: "Daily Carry", title: "Broken-in walking shoes and spare socks", detail: "The route combines transfers, neighborhoods, cultural stops, meals, and outdoor walking." },
    { key: "suggested-day-bag", group: "Daily Carry", title: "Light day bag", detail: "Carry essentials while larger luggage is stored, forwarded, or left at the accommodation." }
  ];
  if (months.some((month) => month >= 9 && month <= 11)) items.push({ key: "suggested-light-layer", group: "Weather", title: "Light jacket, cardigan, or thin overshirt", detail: "October sightseeing can move from warm afternoons to cooler river, garden, and evening routes." });
  if (months.some((month) => month >= 6 && month <= 10) || /rain|typhoon|river|garden|park|outdoor|walk/.test(text)) items.push({ key: "suggested-rain-gear", group: "Weather", title: "Compact umbrella or packable rain shell", detail: "Useful for station transfers, gardens, and outdoor walks until a date-specific forecast is confirmed." });
  if (/bath|spa|onsen|sento|laqua|hot spring/.test(text)) items.push({ key: "suggested-bath-kit", group: "Activity", title: "Bath kit: small towel, fresh socks, and hair tie if needed", detail: "Spa and public-bath stops are easier when you can reset afterward without relying on rentals." });
  if (/temple|shrine|tatami|shoes off/.test(text)) items.push({ key: "suggested-temple-socks", group: "Activity", title: "Clean socks for shoes-off stops", detail: "Some temples, traditional spaces, and dining rooms may ask you to remove shoes." });
  if (/museum|gallery|restaurant|reservation|ticket|booking|official/.test(text)) items.push({ key: "suggested-reservation-copies", group: "Activity", title: "Offline reservation and ticket screenshots", detail: "Save timed-entry, restaurant, hotel, and transport details before each long day." });
  if (cities.size > 1 || /shinkansen|rail|train|station|luggage|forward/.test(text)) items.push({ key: "suggested-luggage-kit", group: "Transfer", title: "Luggage tag and compact lock", detail: "Helpful if you use luggage forwarding, station storage, or a hotel luggage room between trip areas." });
  return dedupePackingDisplayItems(items);
}

export function groupPackingItems(items: PackingDisplayItem[]): Array<{ title: string; items: PackingDisplayItem[] }> {
  const order = ["Essentials", "Daily Carry", "Weather", "Activity", "Transfer", "Other"];
  const groups = new Map<string, PackingDisplayItem[]>();
  for (const item of items) groups.set(item.group, [...(groups.get(item.group) ?? []), item]);
  return order.filter((title) => groups.has(title)).map((title) => ({ title, items: groups.get(title)! }));
}

export function packingChecksKey(planId: string, planVersion: number): string {
  return `landi:packing-checks:${planId}:v${planVersion}`;
}

export function readPackingChecks(storage: PackingCheckStorage, planId: string, planVersion: number): Set<string> {
  try {
    const value = JSON.parse(storage.getItem(packingChecksKey(planId, planVersion)) ?? "[]") as unknown;
    return new Set(Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : []);
  } catch {
    return new Set();
  }
}

export function writePackingChecks(storage: PackingCheckStorage, planId: string, planVersion: number, checks: Set<string>): void {
  try { storage.setItem(packingChecksKey(planId, planVersion), JSON.stringify([...checks])); }
  catch { /* Suggested packing remains usable without local persistence. */ }
}

function packingGroup(title: string, detail = ""): string {
  const text = `${title} ${detail}`.toLocaleLowerCase();
  if (/passport|payment|cash|wallet|card|reservation|ticket|id/.test(text)) return "Essentials";
  if (/shoe|sock|day bag|bottle|charger|power|phone|cable/.test(text)) return "Daily Carry";
  if (/jacket|layer|umbrella|rain|shell|weather|sun|sunscreen/.test(text)) return "Weather";
  if (/bath|towel|spa|onsen|sento|temple|shrine|museum|gallery/.test(text)) return "Activity";
  if (/luggage|lock|tag|train|rail|transfer|storage|forward/.test(text)) return "Transfer";
  return "Other";
}

function tripMonths(plan: Plan): number[] {
  const presentation = plan.presentation?.kind === "itinerary" ? plan.presentation : undefined;
  const values = [presentation?.startDate, presentation?.endDate, ...((presentation?.days ?? []).map((day) => day.date)), ...plan.dates.split(/\s+/)];
  return values.flatMap((value) => {
    const match = /^\d{4}-(\d{2})-\d{2}$/.exec(value ?? "");
    return match ? [Number(match[1])] : [];
  });
}

function dedupePackingDisplayItems(items: PackingDisplayItem[]): PackingDisplayItem[] {
  const seen = new Set<string>();
  return items.filter((item) => !seen.has(item.title.toLocaleLowerCase()) && Boolean(seen.add(item.title.toLocaleLowerCase())));
}
