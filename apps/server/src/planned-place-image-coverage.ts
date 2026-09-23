import type { SkillImageEnrichmentArtifact } from "@c-assistant/agent-adapters";
import {
  assertResearchSetIntegrity,
  assertTripBlueprintIntegrity,
  type BlueprintPlace,
  type BlueprintPlaceImage,
  type BlueprintSource,
  type ResearchSet,
  type TripBlueprint
} from "@c-assistant/core";

export type PlannedPlaceImageCoverageRow = {
  placeId: string;
  place: string;
  candidateCount: number;
  status: "image_available" | "image_missing";
  sourceUrls: string[];
};

export function plannedConcretePlaceIds(blueprint: TripBlueprint): string[] {
  const placeById = new Map(blueprint.places.map((place) => [place.id, place] as const));
  const ids: string[] = [];
  for (const day of blueprint.days) {
    for (const block of [...(day.blocks ?? [])].sort((left, right) => left.order - right.order)) {
      if (block.planRole !== "planned" || !block.placeId || ids.includes(block.placeId)) continue;
      const place = placeById.get(block.placeId);
      if (!place || !isConcreteTimelinePlace(block.kind, place)) continue;
      ids.push(place.id);
    }
  }
  return ids;
}

export function auditPlannedPlaceImageCoverage(blueprint: TripBlueprint, research: ResearchSet): PlannedPlaceImageCoverageRow[] {
  const sourceById = new Map(research.sources.map((source) => [source.id, source] as const));
  const researchPlaceById = new Map(research.places.map((place) => [place.id, place] as const));
  const blueprintPlaceById = new Map(blueprint.places.map((place) => [place.id, place] as const));
  return plannedConcretePlaceIds(blueprint).map((placeId) => {
    const place = researchPlaceById.get(placeId) ?? blueprintPlaceById.get(placeId)!;
    const images = usableImageCandidates(place.images ?? [], sourceById);
    return {
      placeId,
      place: place.name,
      candidateCount: images.length,
      status: images.length ? "image_available" : "image_missing",
      sourceUrls: images.flatMap((image) => sourceById.get(image.sourceId)?.url ?? [])
    };
  });
}

export function missingPlannedPlaceImages(blueprint: TripBlueprint, research: ResearchSet): BlueprintPlace[] {
  const missingIds = new Set(auditPlannedPlaceImageCoverage(blueprint, research).filter((row) => row.status === "image_missing").map((row) => row.placeId));
  const researchPlaceById = new Map(research.places.map((place) => [place.id, place] as const));
  return plannedConcretePlaceIds(blueprint).flatMap((placeId) => {
    const place = researchPlaceById.get(placeId) ?? blueprint.places.find((candidate) => candidate.id === placeId);
    return place && missingIds.has(placeId) ? [place] : [];
  });
}

export function mergePlannedPlaceImageEnrichment(
  research: ResearchSet,
  blueprint: TripBlueprint,
  enrichment: SkillImageEnrichmentArtifact,
  updatedAt: string
): { research: ResearchSet; blueprint: TripBlueprint; acceptedImageCount: number } {
  const allowedPlaceIds = new Set(missingPlannedPlaceImages(blueprint, research).map((place) => place.id));
  const existingSourceByUrl = new Map(research.sources.map((source) => [normalizeUrl(source.url), source] as const));
  const enrichmentSourceByUrl = new Map(enrichment.sources.map((source) => [normalizeUrl(source.url), source] as const));
  const usedSourceByUrl = new Map<string, BlueprintSource>();
  const imagesByPlaceId = new Map<string, BlueprintPlaceImage[]>();

  for (const candidate of enrichment.images) {
    if (!allowedPlaceIds.has(candidate.placeId)) continue;
    const imageUrl = safeHttpsUrl(candidate.url);
    const sourceUrl = [candidate.sourceUrl, ...(candidate.sourceUrls ?? [])].map(normalizeUrl).find((url) => enrichmentSourceByUrl.has(url));
    if (!imageUrl || !candidate.alt.trim() || !sourceUrl) continue;
    const sourceArtifact = enrichmentSourceByUrl.get(sourceUrl)!;
    const source = existingSourceByUrl.get(sourceUrl) ?? usedSourceByUrl.get(sourceUrl) ?? sourceForEnrichment(sourceArtifact, sourceUrl, new Set([...research.sources, ...usedSourceByUrl.values()].map((item) => item.id)));
    usedSourceByUrl.set(sourceUrl, source);
    const images = imagesByPlaceId.get(candidate.placeId) ?? [];
    if (images.some((image) => normalizeUrl(image.url) === normalizeUrl(imageUrl))) continue;
    images.push({
      url: imageUrl,
      alt: candidate.alt.trim(),
      sourceId: source.id,
      ...(candidate.caption?.trim() ? { caption: candidate.caption.trim() } : {}),
      usage: ["card", "detail"],
      status: candidate.status === "verified" ? "verified" : "recheck"
    });
    imagesByPlaceId.set(candidate.placeId, images.slice(0, 3));
  }

  const acceptedImageCount = [...imagesByPlaceId.values()].reduce((sum, images) => sum + images.length, 0);
  if (!acceptedImageCount) return { research, blueprint, acceptedImageCount: 0 };
  const sources = dedupeSources([...research.sources, ...usedSourceByUrl.values()]);
  const mergePlaces = (places: BlueprintPlace[]) => places.map((place) => {
    const incoming = imagesByPlaceId.get(place.id);
    if (!incoming?.length) return structuredClone(place);
    const images = [...(place.images ?? []), ...incoming]
      .filter((image, index, all) => all.findIndex((candidate) => normalizeUrl(candidate.url) === normalizeUrl(image.url)) === index)
      .slice(0, 3);
    return { ...structuredClone(place), images };
  });
  const nextResearch: ResearchSet = { ...structuredClone(research), sources, places: mergePlaces(research.places), updatedAt };
  const nextBlueprint: TripBlueprint = {
    ...structuredClone(blueprint),
    version: blueprint.version + 1,
    createdAt: updatedAt,
    sources: dedupeSources([...blueprint.sources, ...usedSourceByUrl.values()]),
    places: mergePlaces(blueprint.places)
  };
  assertResearchSetIntegrity(nextResearch);
  assertTripBlueprintIntegrity(nextBlueprint, { expectedResearchPlaceIds: nextResearch.places.map((place) => place.id) });
  return { research: nextResearch, blueprint: nextBlueprint, acceptedImageCount };
}

export function itinerarySemanticSnapshot(blueprint: TripBlueprint): unknown {
  return {
    days: blueprint.days,
    movements: blueprint.movements,
    actionRequirements: blueprint.actionRequirements,
    bookingConstraints: blueprint.bookingConstraints,
    places: blueprint.places.map(({ images: _images, ...place }) => place)
  };
}

function isConcreteTimelinePlace(kind: string, place: BlueprintPlace): boolean {
  if (place.accommodation) return false;
  if (kind === "transfer" || kind === "rest" || kind === "lodging" || kind === "flexible") return false;
  const identity = `${place.name} ${place.category} ${place.visitRole ?? ""}`.toLocaleLowerCase();
  if (/\b(airport|terminal|station|transport|transfer|immigration|customs|check.?in|check.?out)\b/.test(identity)) return false;
  if (kind === "meal" && !/\b(restaurant|cafe|café|warung|dining|kitchen|academy|food|bar|bakery)\b/.test(identity)) return false;
  return true;
}

function usableImageCandidates(images: BlueprintPlaceImage[], sourceById: Map<string, BlueprintSource>): BlueprintPlaceImage[] {
  return images.filter((image) => Boolean(safeHttpsUrl(image.url) && image.alt.trim() && sourceById.has(image.sourceId)))
    .filter((image, index, all) => all.findIndex((candidate) => normalizeUrl(candidate.url) === normalizeUrl(image.url)) === index)
    .slice(0, 3);
}

function sourceForEnrichment(source: SkillImageEnrichmentArtifact["sources"][number], normalizedUrl: string, usedIds: Set<string>): BlueprintSource {
  const base = `source-planned-image-${slug(source.id || source.title)}-${shortHash(normalizedUrl)}`;
  let id = base;
  let suffix = 2;
  while (usedIds.has(id)) id = `${base}-${suffix++}`;
  return {
    id,
    title: source.title.trim(),
    authority: source.authority.trim(),
    url: normalizedUrl,
    retrievedAt: source.retrievedAt,
    status: source.status === "verified" || source.status === "stale" ? source.status : "recheck",
    ...(source.official === undefined ? {} : { official: source.official })
  };
}

function dedupeSources(sources: BlueprintSource[]): BlueprintSource[] {
  const byUrl = new Map<string, BlueprintSource>();
  for (const source of sources) if (!byUrl.has(normalizeUrl(source.url))) byUrl.set(normalizeUrl(source.url), structuredClone(source));
  return [...byUrl.values()];
}

function normalizeUrl(value: string): string {
  try {
    const url = new URL(value);
    url.hash = "";
    return url.toString();
  } catch {
    return "";
  }
}

function safeHttpsUrl(value: string): string | undefined {
  const normalized = normalizeUrl(value);
  return normalized.startsWith("https://") ? normalized : undefined;
}

function slug(value: string): string {
  return value.toLocaleLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 42) || "source";
}

function shortHash(value: string): string {
  let hash = 2166136261;
  for (const character of value) hash = Math.imul(hash ^ character.charCodeAt(0), 16777619);
  return (hash >>> 0).toString(36);
}
