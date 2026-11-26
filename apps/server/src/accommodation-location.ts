import type { BlueprintPlace } from "@c-assistant/core";

/** Match harmless locality suffixes and bilingual names without treating distinct towns as equal. */
export function accommodationMatchesCity(place: BlueprintPlace, city: string): boolean {
  const target = normalizeLocality(city);
  if (!target) return false;
  return [place.city, place.accommodation?.baseLabel].some((label) => {
    if (!label) return false;
    const full = normalizeLocality(label);
    const firstAlias = normalizeLocality(label.split("/")[0] ?? "");
    return full === target || firstAlias === target;
  });
}

function normalizeLocality(value: string): string {
  return value.normalize("NFKD").replace(/\p{M}/gu, "")
    .toLocaleLowerCase().replace(/[^a-z0-9]+/g, " ")
    .replace(/\b(?:village|town centre|town center)\b$/g, "")
    .replace(/\s+/g, " ").trim();
}
