import type { NearbyPlaceFact } from "@c-assistant/connectors";

export interface RestaurantMenuFact {
  sourceUrl: string;
  checkedAt: string;
  dishes: Array<{ name: string; description?: string; kind: "menu_item" | "signature" }>;
}
// Verified official menu routes. Identity checks prevent matching a namesake in another city.
const sources = [
  { name: "amano", city: "auckland", hosts: ["savor.co.nz", "amano.nz"], url: "https://savor.co.nz/amano" },
  { name: "ortolana", city: "auckland", hosts: ["ortolana.co.nz", "savor.co.nz"], url: "https://savor.co.nz/ortolana" }
];
const cache = new Map<string, { at: number; fact?: RestaurantMenuFact }>();
export async function restaurantMenu(place: NearbyPlaceFact, meal: string, fetcher: typeof fetch = fetch): Promise<RestaurantMenuFact | undefined> {
  let host: string;
  try { host = new URL(place.dining?.websiteUrl ?? "").hostname.replace(/^www\./, ""); } catch { return undefined; }
  const source = sources.find(source => source.name === place.name.trim().toLowerCase() && source.hosts.includes(host) && [place.city, place.address].join(" ").toLowerCase().includes(source.city));
  if (!source) return undefined;
  const key = `${source.url}:${mealKind(meal)}`;
  const saved = fetcher === fetch ? cache.get(key) : undefined;
  if (saved && Date.now() - saved.at < (saved.fact ? 6 * 3600000 : 60000)) return saved.fact;
  let fact: RestaurantMenuFact | undefined;
  try {
    const response = await fetcher(source.url, { signal: AbortSignal.timeout(6000), redirect: "error", headers: { accept: "text/html" } });
    if (!response.ok || !response.headers.get("content-type")?.includes("text/html")) return undefined;
    const html = await boundedHtml(response);
    const dishes = extractSavorMenu(html, meal);
    if (dishes.length) fact = { sourceUrl: source.url, checkedAt: new Date().toISOString(), dishes };
  } catch { /* Keep the restaurant recommendation usable when the menu cannot be checked. */ }
  if (fetcher === fetch) cache.set(key, { at: Date.now(), ...(fact ? { fact } : {}) });
  return fact;
}

async function boundedHtml(response: Response): Promise<string> {
  const reader = response.body?.getReader();
  if (!reader) return "";
  let size = 0;
  const chunks: Uint8Array[] = [];
  try {
    while (true) {
      const next = await reader.read();
      if (next.done) break;
      size += next.value.byteLength;
      if (size > 1_000_000) return "";
      chunks.push(next.value);
    }
  } finally { await reader.cancel(); }
  return new TextDecoder().decode(Buffer.concat(chunks));
}
const mealKind = (meal: string) => /breakfast|早餐/i.test(meal) ? "breakfast" : /dinner|晚餐/i.test(meal) ? "dinner" : "lunch";
export function extractSavorMenu(html: string, meal: string): RestaurantMenuFact["dishes"] {
  const tabs = [...html.matchAll(/<li\b[^>]*data-tab-type="menu"[^>]*data-tab="([^"]+)"[^>]*>([\s\S]*?)<\/li>/g)].map(match => ({ id: match[1]!, label: text(match[2]!) }));
  const kind = mealKind(meal);
  const desired = kind === "breakfast" ? /breakfast|brunch/i : kind === "dinner" ? /lunch.*dinner|^dinner$/i : /lunch/i;
  // Lunch cannot silently use a dinner-only menu. A brunch menu is a valid daytime alternative.
  const tab = tabs.find(tab => desired.test(tab.label)) ?? (kind === "lunch" ? tabs.find(tab => /brunch/i.test(tab.label)) : undefined);
  if (!tab) return [];
  const sections = [...html.matchAll(/<div\b[^>]*class="[^"]*tab-content[^\"]*"[^>]*data-tab-type="menu"[^>]*data-tab="([^"]+)"[^>]*>/g)];
  const index = sections.findIndex(match => match[1] === tab.id);
  if (index < 0) return [];
  const start = sections[index]!.index! + sections[index]![0].length;
  const body = html.slice(start, sections[index + 1]?.index ?? html.length);
  const dishes: RestaurantMenuFact["dishes"] = [];
  const extras: RestaurantMenuFact["dishes"] = [];
  for (const group of body.matchAll(/<ul\b[^>]*>([\s\S]*?)<\/ul>/g)) {
    const content = group[1]!;
    const category = text(content.match(/<span\b[^>]*font-gt-light[^>]*>([\s\S]*?)<\/span>/)?.[1] ?? "");
    if (/cocktail|wine|drink|beer|soda|juice|additions|on the side/i.test(category)) continue;
    const items = [...content.matchAll(/<li\b[^>]*class="[^"]*font-maison-semibold[^\"]*"[^>]*>([\s\S]*?)<\/li>\s*<div\b[^>]*>([\s\S]*?)<\/div>/g)];
    for (const [position, item] of items.entries()) {
    const name = text(item[1]!);
    const description = text(item[2]!.match(/<span\b[^>]*max-w-450[^>]*>([\s\S]*?)<\/span>/)?.[1] ?? "").replace(/\s+\d+(?:\.\d+)?$/, "");
    if (!name || name.length > 100 || /^add$/i.test(name) || dishes.some(dish => dish.name === name)) continue;
    // The restaurant's menu proves availability, not signature status or popularity.
    (position === 0 ? dishes : extras).push({ name, ...(description && !/^(?:Each|UNTIL|per person)$/i.test(description) && description.length <= 180 ? { description } : {}), kind: "menu_item" });
    }
  }
  return [...dishes, ...extras].filter((dish,index,all) => all.findIndex(other => other.name === dish.name) === index).slice(0,3);
}
function text(html: string): string {
  return html.replace(/<[^>]*>/g, " ").replace(/&amp;/g, "&").replace(/&#0?39;|&apos;/g, "'").replace(/&quot;/g, '"').replace(/&nbsp;/g, " ").replace(/\s+/g, " ").trim();
}
export function menuCopy(menu: RestaurantMenuFact | undefined): string {
  if (!menu?.dishes.length) return "";
  const names = menu.dishes.slice(0,3);
  let words = names.reduce((count,dish) => count + dish.name.split(/\s+/).length, 0);
  const short = names.map(dish => {
    const description = dish.description && words + dish.description.split(/\s+/).length <= 25 ? dish.description : undefined;
    if (description) words += description.split(/\s+/).length;
    return { ...dish, description };
  });
  return menu?.dishes.length ? `\n${menu.dishes.every(dish => dish.kind === "signature") ? "Signature dishes" : "You might like"}:\n${short.map(dish => `• ${dish.name}${dish.description ? ` — ${dish.description}` : ""}`).join("\n")}\nFrom the restaurant's current menu; dishes may change with the season.` : "";
}
