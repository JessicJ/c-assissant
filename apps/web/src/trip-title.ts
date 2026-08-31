import type { Plan, PlanPresentation } from "@c-assistant/core";

type TitledPlan = Pick<Plan, "title" | "location" | "dates"> & { presentation?: PlanPresentation };

const themeSignals: Array<{ label: string; patterns: RegExp[] }> = [
  { label: "Culture", patterns: [/culture/i, /museum/i, /gallery/i, /art/i, /sculpture/i, /temple/i, /shrine/i, /heritage/i, /architecture/i] },
  { label: "Cafes", patterns: [/caf[eé]/i, /coffee/i, /kissaten/i] },
  { label: "Bathing", patterns: [/bath/i, /spa/i, /onsen/i, /sento/i, /laqua/i] },
  { label: "Food", patterns: [/food/i, /restaurant/i, /dining/i, /market/i, /izakaya/i, /ramen/i, /sushi/i] },
  { label: "Nature", patterns: [/garden/i, /park/i, /river/i, /mountain/i, /trail/i, /coast/i] },
  { label: "Neighborhoods", patterns: [/neighbou?rhood/i, /local.life/i, /district/i, /shopping/i, /arcade/i, /street/i] }
];

export function displayPlanTitle(plan: TitledPlan): string {
  if (plan.presentation?.kind === "itinerary") return displayTripTitle(plan.presentation, plan.title);
  return cleanStoredTitle(plan.title) || plan.location || "Trip plan";
}

export function displayTripTitle(presentation: PlanPresentation, fallbackTitle = ""): string {
  const dayCount = tripDayCount(presentation);
  const cities = cityNames(presentation);
  const themes = tripThemes(presentation, fallbackTitle);
  const duration = dayCount ? `${dayCount}-Day` : "";
  const destination = cityList(cities) || cleanStoredTitle(fallbackTitle) || "Trip";
  const focus = themes.length ? themeList(themes) : "Highlights";
  return [duration, destination, focus].filter(Boolean).join(" ");
}

function tripDayCount(presentation: PlanPresentation): number | undefined {
  const start = parseDateOnly(presentation.startDate);
  const end = parseDateOnly(presentation.endDate);
  if (start && end && end.getTime() >= start.getTime()) return Math.round((end.getTime() - start.getTime()) / 86_400_000) + 1;
  const datedDays = new Set(presentation.days.map((day) => day.date).filter(Boolean));
  return datedDays.size || presentation.days.length || undefined;
}

function parseDateOnly(value?: string): Date | undefined {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return undefined;
  const date = new Date(`${value}T00:00:00Z`);
  return Number.isNaN(date.getTime()) ? undefined : date;
}

function cityNames(presentation: PlanPresentation): string[] {
  const values = [
    ...(presentation.cities ?? []),
    ...presentation.days.map((day) => day.city),
    ...presentation.places.map((place) => place.city || place.locationLabel)
  ];
  return uniqueClean(values.flatMap(splitCityValue)).filter((city) => !/^(transit|trip day|unknown)$/i.test(city));
}

function tripThemes(presentation: PlanPresentation, fallbackTitle: string): string[] {
  const weightedText = [
    fallbackTitle,
    presentation.summary,
    ...presentation.days.flatMap((day) => [day.title, day.summary]),
    ...presentation.places.flatMap((place) => [
      place.category,
      place.name,
      place.localizedName,
      place.whyWorthIt,
      place.plan,
      ...place.detailSections.flatMap((section) => [section.title, section.body, ...(section.items ?? [])])
    ])
  ].filter(Boolean).join(" ");
  const scores = themeSignals
    .map((theme) => ({ label: theme.label, score: theme.patterns.reduce((count, pattern) => count + (weightedText.match(pattern) ? 1 : 0), 0) }))
    .filter((theme) => theme.score > 0)
    .sort((a, b) => b.score - a.score || themeSignals.findIndex((theme) => theme.label === a.label) - themeSignals.findIndex((theme) => theme.label === b.label));
  const selected = new Set(scores.slice(0, 3).map((theme) => theme.label));
  return themeSignals.map((theme) => theme.label).filter((label) => selected.has(label));
}

function cleanStoredTitle(value: string): string {
  return value.replace(/^landi\s+plan:\s*/i, "").trim();
}

function cityList(cities: string[]): string {
  if (cities.length === 2) return `${cities[0]}-${cities[1]}`;
  return list(cities.slice(0, 3));
}

function themeList(themes: string[]): string {
  return list(themes);
}

function list(values: string[]): string {
  if (values.length <= 2) return values.join(" and ");
  return `${values.slice(0, -1).join(", ")}, and ${values[values.length - 1]}`;
}

function uniqueClean(values: Array<string | undefined>): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const value of values) {
    const cleaned = value?.trim();
    if (!cleaned) continue;
    const key = cleaned.toLocaleLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(cleaned);
  }
  return result;
}

function splitCityValue(value?: string): string[] {
  return value?.split(/\s*(?:\/|,|、|，|&|\band\b)\s*/i).map((city) => city.trim()).filter(Boolean) ?? [];
}
