import type { ItineraryDay, Plan, PlanPlace, PlanPresentation, PlanRouteSegment, SourceReference, Task } from "@c-assistant/core";

export type BlueprintWorkspaceArea = "itinerary" | "preparation" | "tips" | "sources";
export type GuideFilter = "all" | "attraction" | "dining" | "shopping" | "experience";
export type GuideState = "scheduled" | "unscheduled" | "informational";
export type GuideStateFilter = "all" | GuideState;
export type PlacementMeaning = "scheduled" | "optional";

export type TimelineBlock = {
  day: ItineraryDay;
  place: PlanPlace;
  order: number;
  timeLabel: string;
  type: GuideFilter;
  status?: string;
  routeAfter?: PlanRouteSegment;
};

export type GuideCardDisplay = {
  place: PlanPlace;
  type: GuideFilter;
  state: GuideState;
  summary: string;
  tags: string[];
  timeline?: { dayId: string; label: string; timeLabel: string };
  source?: SourceMarkerDisplay;
};

export type SourceMarkerDisplay = {
  label: string;
  summary: string;
  url?: string;
};

export type ComparisonRow = {
  id: string;
  name: string;
  area: string;
  routeFit: string;
  timing: string;
  effort: string;
  sourceState: string;
};

export type TipDisplay = {
  id: string;
  title: string;
  body: string;
  context: string;
  source?: SourceMarkerDisplay;
};

export type TipGroupDisplay = {
  theme: string;
  tips: TipDisplay[];
};

export type ItineraryPlacementOption = {
  id: string;
  label: string;
  kind: "start" | "after" | "end";
  afterPlaceId?: string;
};

export type PlacementAdvisory = {
  tone: "neutral" | "attention";
  text: string;
};

export type PendingItineraryEditDisplay = {
  placeId: string;
  placeName: string;
  dayId: string;
  dayLabel: string;
  meaning: PlacementMeaning;
  positionId: string;
  positionLabel: string;
  advisories: PlacementAdvisory[];
  requestText: string;
};

export function guideTypeForPlace(place: Pick<PlanPlace, "category" | "visitRole" | "name" | "plan" | "detailSections">): GuideFilter {
  const text = `${place.category} ${place.visitRole ?? ""} ${place.name} ${place.plan} ${place.detailSections.map((section) => section.title).join(" ")}`.toLocaleLowerCase();
  if (/experience|workshop|class|tour|show|performance|theatre|theater|festival|ceremony|onsen|spa|cruise|walk|ride/.test(text)) return "experience";
  if (/restaurant|dining|food|meal|breakfast|lunch|dinner|cafe|coffee|tea|dessert|bar|market|izakaya|ramen|sushi|noodle|bakery/.test(text)) return "dining";
  if (/shopping|shop|store|mall|market|craft|souvenir|product|design|boutique|bookstore|department/.test(text)) return "shopping";
  return "attraction";
}

export function isGuidePlace(place: PlanPlace): boolean {
  const text = `${place.category} ${place.visitRole ?? ""} ${place.name}`.toLocaleLowerCase();
  return !/hotel|accommodation|lodg|airport|station|flight|rail|transfer|transport/.test(text);
}

export function guideStateForPlace(place: PlanPlace, scheduledPlaceIds: Set<string>): GuideState {
  if (scheduledPlaceIds.has(place.id)) return "scheduled";
  const text = `${place.category} ${place.visitRole ?? ""}`.toLocaleLowerCase();
  if (/informational|theme|local food|local product|background|context/.test(text)) return "informational";
  return "unscheduled";
}

export function timelineBlocksForDay(presentation: PlanPresentation, day: ItineraryDay): TimelineBlock[] {
  const placeById = new Map(presentation.places.map((place) => [place.id, place] as const));
  const stops: Array<{ placeId: string; order: number; time?: string; role?: string }> = day.stops?.length
    ? [...day.stops].sort((left, right) => left.order - right.order)
    : day.placeIds.map((placeId, index) => ({ placeId, order: index + 1 }));
  return stops.flatMap((stop, index) => {
    const place = placeById.get(stop.placeId);
    if (!place) return [];
    const routeAfter = presentation.routeSegments.find((segment) => segment.dayId === day.id && segment.originPlaceId === place.id);
    const status = itineraryBlockStatus(place);
    return [{
      day,
      place,
      order: stop.order,
      timeLabel: roughTimeLabel(stop.time, stop.role, place, index),
      type: guideTypeForPlace(place),
      ...(status ? { status } : {}),
      ...(routeAfter ? { routeAfter } : {})
    }];
  });
}

export function guideCardsForPresentation(presentation: PlanPresentation, planSources: SourceReference[] = []): GuideCardDisplay[] {
  const scheduledPlaceIds = new Set(presentation.days.flatMap((day) => day.placeIds));
  const firstTimelineByPlace = new Map<string, GuideCardDisplay["timeline"]>();
  for (const day of presentation.days) {
    for (const block of timelineBlocksForDay(presentation, day)) {
      if (firstTimelineByPlace.has(block.place.id)) continue;
      firstTimelineByPlace.set(block.place.id, { dayId: day.id, label: day.shortLabel ?? day.date ?? day.label, timeLabel: block.timeLabel });
    }
  }
  return presentation.places
    .filter(isGuidePlace)
    .map((place) => {
      const state = guideStateForPlace(place, scheduledPlaceIds);
      return {
        place,
        type: guideTypeForPlace(place),
        state,
        summary: shortGuideSummary(place),
        tags: guideTags(place),
        ...(firstTimelineByPlace.get(place.id) ? { timeline: firstTimelineByPlace.get(place.id)! } : {}),
        ...(sourceMarkerForPlace(place, planSources) ? { source: sourceMarkerForPlace(place, planSources)! } : {})
      };
    });
}

export function comparisonRowsForPlace(presentation: PlanPresentation, selectedPlace: PlanPlace): ComparisonRow[] {
  const selectedType = guideTypeForPlace(selectedPlace);
  return presentation.places
    .filter((place) => place.id !== selectedPlace.id && isGuidePlace(place) && guideTypeForPlace(place) === selectedType)
    .slice(0, 5)
    .map((place) => ({
      id: place.id,
      name: displayPlaceName(place),
      area: place.area ?? place.locationLabel,
      routeFit: routeFitLabel(place, selectedPlace),
      timing: timingLabel(place),
      effort: effortLabel(place),
      sourceState: sourceStateLabel(place)
    }));
}

export function filterGuideCards(cards: GuideCardDisplay[], options: { type: GuideFilter; state?: GuideStateFilter }): GuideCardDisplay[] {
  return cards.filter((card) => {
    if (options.type !== "all" && card.type !== options.type) return false;
    if (options.state && options.state !== "all" && card.state !== options.state) return false;
    return true;
  });
}

export function itineraryPlacementOptions(blocks: TimelineBlock[]): ItineraryPlacementOption[] {
  return [
    { id: "start", label: "At the start of the day", kind: "start" },
    ...blocks.map((block) => ({ id: `after-${block.place.id}`, label: `After ${displayPlaceName(block.place)}`, kind: "after" as const, afterPlaceId: block.place.id })),
    { id: "end", label: "At the end of the day", kind: "end" }
  ];
}

export function buildPendingItineraryEdit(presentation: PlanPresentation, place: PlanPlace, input: { dayId: string; positionId: string; meaning: PlacementMeaning }): PendingItineraryEditDisplay {
  const day = presentation.days.find((candidate) => candidate.id === input.dayId) ?? presentation.days[0];
  const blocks = day ? timelineBlocksForDay(presentation, day) : [];
  const options = itineraryPlacementOptions(blocks);
  const position = options.find((option) => option.id === input.positionId) ?? options[options.length - 1];
  const dayLabel = day ? day.shortLabel ?? day.date ?? day.label : "the selected day";
  const positionLabel = position?.label ?? "At the end of the day";
  const itemMeaning = input.meaning === "optional" ? "optional itinerary item" : "scheduled itinerary item";
  return {
    placeId: place.id,
    placeName: displayPlaceName(place),
    dayId: day?.id ?? input.dayId,
    dayLabel,
    meaning: input.meaning,
    positionId: position?.id ?? input.positionId,
    positionLabel,
    advisories: placementAdvisories(presentation, place, day, position),
    requestText: `I want to add ${displayPlaceName(place)} to ${dayLabel} as a ${itemMeaning}, ${positionLabel.toLocaleLowerCase()}. Show the placement impact before saving.`
  };
}

export function groupTipsByTheme(tips: TipDisplay[]): TipGroupDisplay[] {
  const groups = new Map<string, TipDisplay[]>();
  for (const tip of tips) {
    const theme = tipTheme(tip);
    groups.set(theme, [...(groups.get(theme) ?? []), tip]);
  }
  return [...groups].map(([theme, values]) => ({ theme, tips: values }));
}

export function localTipsForPlan(plan: Pick<Plan, "stages" | "presentation" | "location">): TipDisplay[] {
  const placeTips = (plan.presentation?.places ?? []).flatMap((place) => {
    const body = place.tip?.trim();
    if (!body || !isDestinationRelevantTip(body)) return [];
    return [{
      id: `place-${place.id}`,
      title: tipTitle(body),
      body,
      context: [place.area, place.city, place.name].filter(Boolean).join(" · "),
      ...(sourceMarkerForPlace(place, []) ? { source: sourceMarkerForPlace(place, [])! } : {})
    }];
  });
  const taskTips = plan.stages.flatMap((stage) => stage.tasks.flatMap((task) => {
    const text = `${task.title}. ${task.description ?? ""}`.trim();
    if (task.owner !== "assistant" || !/tip|custom|safety|payment|transport|etiquette|local|礼仪|安全|支付|交通|风俗/.test(`${stage.title} ${task.title}`.toLocaleLowerCase()) || !isDestinationRelevantTip(text)) return [];
    return [{ id: `task-${task.id}`, title: task.title, body: task.description ?? task.title, context: stage.title }];
  }));
  return uniqueTips([...placeTips, ...taskTips]).slice(0, 12);
}

export function preparationItemsForPlan(plan: Plan): Array<{ task: Task; stageTitle: string }> {
  return plan.stages.flatMap((stage) => stage.tasks
    .filter((task) => task.owner === "user" && task.preparationCategory !== undefined && task.preparationCategory !== "not_applicable")
    .map((task) => ({ task, stageTitle: stage.title })));
}

export function roughTimeLabel(time: string | undefined, role: string | undefined, place: Pick<PlanPlace, "category" | "name" | "visitRole">, index: number): string {
  if (time && /^\d{2}:\d{2}$/.test(time)) return time;
  const text = `${role ?? ""} ${place.visitRole ?? ""} ${place.category} ${place.name}`.toLocaleLowerCase();
  if (/breakfast|morning meal/.test(text)) return "Breakfast window";
  if (/lunch|midday|noon/.test(text)) return "Around lunch";
  if (/dinner|supper/.test(text)) return "Dinner window";
  if (/night|evening|bar|show|performance/.test(text)) return "Optional evening";
  if (/shopping|shop|market|souvenir|product/.test(text)) return index < 2 ? "Late morning option" : "Flexible afternoon";
  if (/rest|buffer|free|flex/.test(text)) return index >= 3 ? "Flexible afternoon" : "Flexible time";
  if (index === 0) return "Morning";
  if (index === 1) return "Late morning";
  if (index === 2) return "Afternoon";
  return "Flexible afternoon";
}

export function sourceMarkerForPlace(place: Pick<PlanPlace, "evidenceSources" | "sourceRefs">, planSources: SourceReference[]): SourceMarkerDisplay | undefined {
  return sourceSummariesForPlace(place, planSources)[0];
}

export function sourceSummariesForPlace(place: Pick<PlanPlace, "evidenceSources" | "sourceRefs">, planSources: SourceReference[]): SourceMarkerDisplay[] {
  const sources = [
    ...(place.evidenceSources?.map((evidence) => {
      const sourceState = evidence.status === "verified" ? "Source verified" : "Source needs recheck";
      return {
        label: "i",
        summary: [sourceState, evidence.title, evidence.role, evidence.supports?.slice(0, 2).join("; "), evidence.checkedAt ? `checked ${evidence.checkedAt}` : undefined].filter(Boolean).join(" · "),
        url: evidence.url
      };
    }) ?? []),
    ...place.sourceRefs.flatMap((sourceUrl) => {
      const source = planSources.find((candidate) => candidate.url === sourceUrl);
      return [{ label: "i", summary: source ? sourceReferenceSummary(source) : sourceUrl, url: sourceUrl }];
    })
  ];
  const seen = new Set<string>();
  return sources.filter((source) => {
    const key = source.url ?? source.summary;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

export function sourceMarkersForPlan(plan: Plan): SourceMarkerDisplay[] {
  const fromPlan = plan.sources.map((source) => ({ label: "i", summary: sourceReferenceSummary(source), url: source.url }));
  const fromPlaces = (plan.presentation?.places ?? []).flatMap((place) => place.evidenceSources?.map((source) => ({ label: "i", summary: [source.status === "verified" ? "Source verified" : "Source needs recheck", source.title, source.role, source.checkedAt ? `checked ${source.checkedAt}` : undefined].filter(Boolean).join(" · "), url: source.url })) ?? []);
  const seen = new Set<string>();
  return [...fromPlan, ...fromPlaces].filter((source) => {
    const key = source.url ?? source.summary;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

export function displayPlaceName(place: Pick<PlanPlace, "name" | "localizedName">): string {
  return place.localizedName && place.localizedName !== place.name ? `${place.name} · ${place.localizedName}` : place.name;
}

export function guideFilterLabel(filter: GuideFilter): string {
  return filter === "all" ? "All" : filter === "attraction" ? "Attractions" : filter === "dining" ? "Dining" : filter === "shopping" ? "Shopping" : "Experiences";
}

function shortGuideSummary(place: PlanPlace): string {
  return shorten(firstUsefulSentence(place.plan) || firstUsefulSentence(place.whyWorthIt) || `${place.area ?? place.locationLabel}.`, 125);
}

function firstUsefulSentence(value: string): string {
  return value.split(/(?<=[.!?。！？])\s+/)[0]?.trim() ?? "";
}

function shorten(value: string, max: number): string {
  if (value.length <= max) return value;
  return `${value.slice(0, max - 1).replace(/\s+\S*$/, "")}…`;
}

function guideTags(place: PlanPlace): string[] {
  return [place.area, place.city, place.durationMinutes ? `${place.durationMinutes} min` : undefined, place.reservation?.requirement === "required" ? "Reservation" : undefined].filter(Boolean).slice(0, 4) as string[];
}

function placementAdvisories(presentation: PlanPresentation, place: PlanPlace, day: ItineraryDay | undefined, position: ItineraryPlacementOption | undefined): PlacementAdvisory[] {
  const advisories: PlacementAdvisory[] = [];
  if (day?.city && place.city && !sameText(day.city, place.city)) {
    advisories.push({ tone: "attention", text: `This is in ${place.city}, while the selected day is centered on ${day.city}.` });
  }
  if (place.reservation?.requirement === "required") {
    advisories.push({ tone: "attention", text: "Reservation or timed entry should be checked before saving this placement." });
  } else if (place.reservation?.requirement === "recommended") {
    advisories.push({ tone: "neutral", text: "Reservation may reduce friction for this stop." });
  }
  if (place.priority === "recheck" || place.reservation?.verification === "needs_recheck" || place.evidenceSources?.some((source) => source.status && source.status !== "verified")) {
    advisories.push({ tone: "attention", text: "Some details need recheck before this becomes execution-ready." });
  }
  if (place.durationMinutes && place.durationMinutes >= 180) {
    advisories.push({ tone: "attention", text: "This is a long stop, so day pacing may need adjustment." });
  }
  const routeAfter = position?.afterPlaceId ? presentation.routeSegments.find((segment) => segment.originPlaceId === position.afterPlaceId) : undefined;
  if (routeAfter?.verification === "stale" || routeAfter?.verification === "needs_verification") {
    advisories.push({ tone: "attention", text: "The nearby route context needs verification after placement changes." });
  }
  if (!advisories.length) advisories.push({ tone: "neutral", text: "Landi will check route fit and timing before saving this edit." });
  return advisories;
}

function sameText(left: string, right: string): boolean {
  return left.trim().toLocaleLowerCase() === right.trim().toLocaleLowerCase();
}

function itineraryBlockStatus(place: PlanPlace): string | undefined {
  if (place.reservation?.requirement === "required") return "Reservation required";
  if (place.priority === "recheck" || place.reservation?.verification === "needs_recheck") return "Needs recheck";
  if (place.priority === "booked") return "Booked";
  return undefined;
}

function routeFitLabel(place: PlanPlace, selectedPlace: PlanPlace): string {
  if (place.area && selectedPlace.area && place.area === selectedPlace.area) return "Same area";
  if (place.city && selectedPlace.city && place.city === selectedPlace.city) return "Same city";
  return place.locationLabel;
}

function timingLabel(place: PlanPlace): string {
  if (place.reservation?.requirement === "required") return "Reserve ahead";
  if (place.reservation?.requirement === "recommended") return "Reservation useful";
  return place.durationMinutes ? `${place.durationMinutes} min` : "Flexible timing";
}

function effortLabel(place: PlanPlace): string {
  if (place.priority === "recheck") return "Recheck before use";
  if (place.bookingUrl || place.officialUrl) return "Official link saved";
  if (place.mapUrl) return "Map link saved";
  return place.area ?? "Review details";
}

function sourceStateLabel(place: PlanPlace): string {
  if (place.evidenceSources?.some((source) => source.status === "verified")) return "Verified source";
  if (place.evidenceSources?.length || place.sourceRefs.length) return "Referenced";
  return "No source listed";
}

function sourceReferenceSummary(source: SourceReference): string {
  return [source.title, source.authority, source.retrievedAt].filter(Boolean).join(" · ") || source.url;
}

function tipTheme(tip: Pick<TipDisplay, "title" | "body">): string {
  const text = `${tip.title} ${tip.body}`.toLocaleLowerCase();
  if (/payment|cash|card|tax|支付|现金/.test(text)) return "Payment";
  if (/transport|taxi|metro|train|bus|交通|地铁|电车/.test(text)) return "Transport";
  if (/temple|shrine|etiquette|custom|礼仪|风俗|寺|神社/.test(text)) return "Etiquette";
  if (/safety|safe|scam|risk|安全|诈骗/.test(text)) return "Safety";
  if (/weather|dress|rain|heat|cold|天气|穿|雨/.test(text)) return "Weather";
  if (/reservation|queue|opening|hours|预约|排队|营业/.test(text)) return "Timing";
  if (/language|phrase|translation|语言/.test(text)) return "Language";
  return "Local norms";
}

function isDestinationRelevantTip(value: string): boolean {
  const text = value.toLocaleLowerCase();
  if (/rest early|stay positive|enjoy the journey|take photos|have fun|relax and enjoy/.test(text)) return false;
  return /local|custom|etiquette|safety|safe|scam|payment|cash|card|transport|taxi|metro|train|bus|weather|dress|temple|shrine|market|queue|reservation|opening|hours|passport|visa|entry|neighborhood|area|language|tip|礼仪|安全|支付|现金|交通|天气|寺|神社|市场|排队|预约|营业|签证|入境/.test(text);
}

function tipTitle(value: string): string {
  const first = firstUsefulSentence(value).replace(/[:：].*$/, "").trim();
  return shorten(first || "Local tip", 54);
}

function uniqueTips(tips: TipDisplay[]): TipDisplay[] {
  const seen = new Set<string>();
  return tips.filter((tip) => {
    const key = tip.body.toLocaleLowerCase();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}
