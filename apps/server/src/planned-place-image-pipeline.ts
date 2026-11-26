import { readPublicMedia } from './public-media-fetch.js';
export { isPublicMediaAddress as isPublicIpAddress } from './public-media-fetch.js';
import { isIP } from "node:net";
import { RuntimeAdapterError, type SkillImageEnrichmentArtifact } from "@c-assistant/agent-adapters";
import type { BlueprintPlace, ResearchSet, TripBlueprint } from "@c-assistant/core";
import { itinerarySemanticSnapshot, mergePlannedPlaceImageEnrichment, missingPlannedPlaceImages, plannedConcretePlaceIds, removeInvalidPlannedPlaceImages } from "./planned-place-image-coverage.js";

const BATCH_SIZE = 3;
const CONCURRENT_BATCHES = 3;
const BATCH_TIMEOUT_MS = 90_000;
const TOTAL_TIMEOUT_MS = 3 * 60_000;
const KNOWN_SOURCE_LOOKUP_MS = 24_000;
const READ_ONLY_PREFETCH_MS = 48_000;
// MAH owns queue and acceptance supervision; this is production time only.
const MAH_IMAGE_PRODUCTION_MS = 8 * 60_000;

export type PlannedPlaceImagePassResult = {
  research: ResearchSet;
  blueprint: TripBlueprint;
  requestedPlaceCount: number;
  acceptedImageCount: number;
  remainingPlaceCount: number;
  failedBatchCount: number;
};

export async function runPlannedPlaceImagePass(input: {
  research: ResearchSet;
  blueprint: TripBlueprint;
  search: (places: BlueprintPlace[], timeoutMs: number, rejectedImageUrls: string[], signal: AbortSignal, stage: { round: number }) => Promise<SkillImageEnrichmentArtifact>;
  lookupKnownImages?: (places: BlueprintPlace[], signal: AbortSignal) => Promise<SkillImageEnrichmentArtifact>;
  save: (research: ResearchSet, blueprint: TripBlueprint, context: {
    source: "validation_cleanup" | "known_lookup" | "agent_generation";
    requestedPlaceIds: string[];
    candidate?: SkillImageEnrichmentArtifact;
  }) => { research: ResearchSet; blueprint: TripBlueprint };
  probeImageUrl?: (url: string, signal: AbortSignal) => Promise<boolean | undefined>;
  signal?: AbortSignal;
  onBatch?: (result: { requested: number; accepted: number; error?: unknown }) => void;
  now?: () => number;
  totalTimeoutMs?: number;
  retryMissingOnce?: boolean;
  sequentialCarriers?: boolean;
  rejectCandidate?: (candidate: SkillImageEnrichmentArtifact) => void;
}): Promise<PlannedPlaceImagePassResult> {
  const now = input.now ?? Date.now;
  const deadline = now() + (input.totalTimeoutMs ?? TOTAL_TIMEOUT_MS);
  const semanticBefore = JSON.stringify(itinerarySemanticSnapshot(input.blueprint));
  let research = input.research;
  let blueprint = input.blueprint;
  let acceptedImageCount = 0;
  let failedBatchCount = 0;
  const rejectedImageUrls = new Set<string>();
  const unconfirmedImageUrls = new Set<string>();
  const checkCancelled = () => { if (input.signal?.aborted) throw new RuntimeAdapterError("cancelled", "Image enrichment was cancelled."); };
  const bounded = <T>(limitMs: number, operation: (signal: AbortSignal) => Promise<T>) => boundedImageOperation(operation, Math.min(limitMs, Math.max(1, deadline - now())), input.signal);
  const probe = (url: string, afterMahProduction = false) => (afterMahProduction
    ? boundedImageOperation(signal => input.probeImageUrl!(url, signal), 8_000, input.signal)
    : bounded(8_000, signal => input.probeImageUrl!(url, signal))).catch(() => undefined);

  if (input.probeImageUrl) {
    const plannedIds = new Set(plannedConcretePlaceIds(blueprint));
    const urls = [...new Set([...blueprint.places, ...research.places].filter((place) => plannedIds.has(place.id)).flatMap((place) => place.images?.map((image) => image.url) ?? []))];
    for (let index = 0; index < urls.length; index += 8) {
      if (input.signal?.aborted) throw new RuntimeAdapterError("cancelled", "Image enrichment was cancelled.");
      const wave = urls.slice(index, index + 8);
      const checks = await Promise.all(wave.map((url) => probe(url)));
      checks.forEach((valid, offset) => {
        if (valid === false) rejectedImageUrls.add(wave[offset]!);
        else if (valid === undefined) unconfirmedImageUrls.add(normalizeUrl(wave[offset]!));
      });
    }
    checkCancelled();
    if (rejectedImageUrls.size) {
      const cleaned = removeInvalidPlannedPlaceImages(research, blueprint, new Set([...rejectedImageUrls].map(normalizeUrl)), new Date().toISOString());
      if (JSON.stringify(itinerarySemanticSnapshot(cleaned.blueprint)) !== semanticBefore) throw new Error("Image validation changed itinerary semantics.");
      ({ research, blueprint } = input.save(cleaned.research, cleaned.blueprint, { source: "validation_cleanup", requestedPlaceIds: [] }));
    }
  }
  const missing = missingPlannedPlaceImages(blueprint, research, unconfirmedImageUrls);

  if (input.lookupKnownImages && missing.length) {
    try {
      let lookupFailed = false;
      const lookup = startImageLookups(missing, input.lookupKnownImages, Math.min(KNOWN_SOURCE_LOOKUP_MS, Math.max(1, deadline - now())), input.signal,
        error => { lookupFailed = true; input.onBatch?.({ requested: 1, accepted: 0, error }); });
      await lookup.completion;
      if (lookupFailed) failedBatchCount += 1;
      const artifact = combineImageArtifacts((await Promise.all([...lookup.results.values()])).filter((value): value is SkillImageEnrichmentArtifact => value !== undefined));
      if (input.probeImageUrl) {
        const checks = await Promise.all(artifact.images.map((candidate) => probe(candidate.url)));
        artifact.images = artifact.images.filter((candidate, index) => {
          if (checks[index] === true) unconfirmedImageUrls.delete(normalizeUrl(candidate.url));
          return checks[index] === true;
        });
      }
      checkCancelled();
      const merged = mergePlannedPlaceImageEnrichment(research, blueprint, artifact, new Date().toISOString(), unconfirmedImageUrls);
      if (JSON.stringify(itinerarySemanticSnapshot(merged.blueprint)) !== semanticBefore) throw new Error("Known-image lookup changed itinerary semantics.");
      if (merged.acceptedImageCount) ({ research, blueprint } = input.save(merged.research, merged.blueprint, { source: "known_lookup", requestedPlaceIds: missing.map((place) => place.id) }));
      acceptedImageCount += merged.acceptedImageCount;
      input.onBatch?.({ requested: missing.length, accepted: merged.acceptedImageCount });
    } catch (error) {
      checkCancelled();
      failedBatchCount += 1;
      input.onBatch?.({ requested: missing.length, accepted: 0, error });
    }
  }

  for (let round = 0; round < (input.retryMissingOnce === false ? 1 : 2); round += 1) {
    const acceptedBeforeRound = acceptedImageCount;
    const target = missingPlannedPlaceImages(blueprint, research, unconfirmedImageUrls);
    if (!target.length) break;
    const batches: BlueprintPlace[][] = [];
    for (let index = 0; index < target.length; index += BATCH_SIZE) batches.push(target.slice(index, index + BATCH_SIZE));
    let nextBatch = 0;
    const worker = async () => {
      while (nextBatch < batches.length) {
        if (input.signal?.aborted) throw new RuntimeAdapterError("cancelled", "Image enrichment was cancelled.");
        const remainingMs = deadline - now();
        if (!input.sequentialCarriers && remainingMs < 15_000) break;
        const places = batches[nextBatch++]!;
        // Each worker advances independently; a stalled batch cannot idle other slots.
        let candidate: SkillImageEnrichmentArtifact | undefined;
        try {
          candidate = input.sequentialCarriers
            // The real transport bounds queue, production and acceptance separately.
            // A generic image timer must not cancel an accepted carrier or freeze
            // the remaining lookup time as its production budget.
            ? await input.search(places, MAH_IMAGE_PRODUCTION_MS, [...rejectedImageUrls], input.signal ?? new AbortController().signal, { round: round + 1 })
            : await bounded(BATCH_TIMEOUT_MS, (signal) => input.search(places, Math.min(BATCH_TIMEOUT_MS, remainingMs), [...rejectedImageUrls], signal, { round: round + 1 }));
          // 保存原候选引用；图片过滤使用副本，任务回执身份不依赖副本。
          const artifact = structuredClone(candidate);
          if (input.probeImageUrl) {
            const checks = await Promise.all(artifact.images.map((candidate) => probe(candidate.url, input.sequentialCarriers)));
            artifact.images = artifact.images.flatMap((candidate, offset) => {
              if (checks[offset] === false) rejectedImageUrls.add(candidate.url);
              if (checks[offset] === true) unconfirmedImageUrls.delete(normalizeUrl(candidate.url));
              return checks[offset] === true ? [candidate] : [];
            });
          }
          checkCancelled();
          const merged = mergePlannedPlaceImageEnrichment(research, blueprint, artifact, new Date().toISOString(), unconfirmedImageUrls);
          if (JSON.stringify(itinerarySemanticSnapshot(merged.blueprint)) !== semanticBefore) throw new Error("Image enrichment changed itinerary semantics.");
          if (merged.acceptedImageCount) ({ research, blueprint } = input.save(merged.research, merged.blueprint, { source: "agent_generation", requestedPlaceIds: places.map((place) => place.id), candidate }));
          else input.rejectCandidate?.(candidate);
          acceptedImageCount += merged.acceptedImageCount;
          input.onBatch?.({ requested: places.length, accepted: merged.acceptedImageCount });
        } catch (error) {
          if (candidate) input.rejectCandidate?.(candidate);
          checkCancelled();
          if (input.sequentialCarriers && requiresMahImageRecovery(error)) throw error;
          failedBatchCount += 1;
          input.onBatch?.({ requested: places.length, accepted: 0, error });
        }
      }
    };
    await Promise.all(Array.from({ length: Math.min(input.sequentialCarriers ? 1 : CONCURRENT_BATCHES, batches.length) }, () => worker()));
    // A failed or empty whole round is evidence that an immediate identical retry
    // cannot improve coverage. Keep the draft moving and let a later pass resume gaps.
    if (acceptedImageCount === acceptedBeforeRound) break;
  }
  checkCancelled();
  return { research, blueprint, requestedPlaceCount: missing.length, acceptedImageCount, remainingPlaceCount: missingPlannedPlaceImages(blueprint, research, unconfirmedImageUrls).length, failedBatchCount };
}


/** In-flight or unverifiable carriers retain their exact identity for recovery.
 * A definite terminal/invalid optional photo must not fail the accepted route. */
export function requiresMahImageRecovery(error: unknown): boolean {
  if (!error || typeof error !== "object" || !("code" in error)) return false;
  const code = String(error.code);
  if (["cancelled", "superseded"].includes(code)) return true;
  return code.startsWith("mah_") && !["mah_task_failed", "mah_task_timed_out", "mah_business_payload_invalid",
    "mah_business_integrity_failed", "mah_business_candidate_not_accepted"].includes(code);
}

/** Speculative public reads only. Writes remain in the final latest-blueprint pass. */
export function prefetchPlannedPlaceImages(input: {
  places: BlueprintPlace[];
  lookup: NonNullable<Parameters<typeof runPlannedPlaceImagePass>[0]["lookupKnownImages"]>;
  signal: AbortSignal;
  onError?: (error: unknown) => void;
}) {
  const snapshot = structuredClone(input.places);
  const identities = new Map(snapshot.map(place => [place.id, imagePlaceIdentity(place)]));
  const lookup = startImageLookups(snapshot, input.lookup, READ_ONLY_PREFETCH_MS, input.signal, input.onError);
  return async (places: BlueprintPlace[], signal: AbortSignal,
    fallback: NonNullable<Parameters<typeof runPlannedPlaceImagePass>[0]["lookupKnownImages"]>): Promise<SkillImageEnrichmentArtifact> => {
    const pieces = await Promise.all(places.map(async place => {
      if (signal.aborted) throw new RuntimeAdapterError("cancelled", "Image lookup was cancelled.");
      const pending = identities.get(place.id) === imagePlaceIdentity(place) ? lookup.results.get(place.id) : undefined;
      const artifact = pending ? await abortableImageRead(() => pending, signal) : undefined;
      // A complete empty result is still a settled read; do not immediately
      // repeat the same lookup. Only a failed/new/changed identity uses fallback.
      return artifact ?? fallback([place], signal);
    }));
    return combineImageArtifacts(pieces);
  };
}

type KnownImageLookup = NonNullable<Parameters<typeof runPlannedPlaceImagePass>[0]["lookupKnownImages"]>;

/** One deadline and four in-flight reads for the whole set. Each place settles
 * independently; deadline/abort closes only unresolved entries, never successes. */
function startImageLookups(places: BlueprintPlace[], lookup: KnownImageLookup, timeoutMs: number, parent?: AbortSignal, onError?: (error: unknown) => void) {
  const controller = new AbortController();
  const signal = parent ? AbortSignal.any([parent, controller.signal]) : controller.signal;
  const resolveById = new Map<string, (value: SkillImageEnrichmentArtifact | undefined) => void>();
  const results = new Map(places.map(place => [place.id, new Promise<SkillImageEnrichmentArtifact | undefined>(resolve => resolveById.set(place.id, resolve))]));
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  let next = 0;
  const worker = async () => {
    while (!signal.aborted && next < places.length) {
      const place = places[next++]!;
      try {
        const artifact = structuredClone(await abortableImageRead(readSignal => lookup([place], readSignal), signal));
        const images = artifact.images.filter(image => image.placeId === place.id);
        const urls = new Set(images.map(image => image.sourceUrl));
        resolveById.get(place.id)!({ images, sources: artifact.sources.filter(source => urls.has(source.url)), omitted: artifact.omitted.filter(item => item.placeId === place.id) });
      } catch (error) { onError?.(error); resolveById.get(place.id)!(undefined); }
    }
  };
  const completion = Promise.all(Array.from({ length: Math.min(4, places.length) }, worker)).finally(() => {
    clearTimeout(timer);
    for (const resolve of resolveById.values()) resolve(undefined);
  });
  return { results, completion };
}

function combineImageArtifacts(pieces: SkillImageEnrichmentArtifact[]): SkillImageEnrichmentArtifact {
  return { images: pieces.flatMap(piece => piece.images), sources: pieces.flatMap(piece => piece.sources), omitted: pieces.flatMap(piece => piece.omitted) };
}

/** No additional timer: the owning set controls its single deadline. */
function abortableImageRead<T>(operation: (signal: AbortSignal) => Promise<T>, signal: AbortSignal): Promise<T> {
  return new Promise((resolve, reject) => {
    const cancelled = () => { signal.removeEventListener("abort", cancelled); reject(new RuntimeAdapterError("cancelled", "Image lookup stopped before completion.")); };
    signal.addEventListener("abort", cancelled, { once: true });
    if (signal.aborted) { cancelled(); return; }
    Promise.resolve().then(() => { if (signal.aborted) throw new RuntimeAdapterError("cancelled", "Image lookup was cancelled."); return operation(signal); })
      .then(value => { signal.removeEventListener("abort", cancelled); if (!signal.aborted) resolve(value); }, error => { signal.removeEventListener("abort", cancelled); reject(error); });
  });
}

function imagePlaceIdentity(place: BlueprintPlace): string {
  return JSON.stringify([place.id, place.name, place.localizedName, place.locationLabel, place.city, place.area,
    place.coordinates, place.officialUrl, place.mapUrl, place.evidence]);
}

/** Bound every wait even when a dependency ignores timeout/abort; late responses never reach persistence. */
function boundedImageOperation<T>(operation: (signal: AbortSignal) => Promise<T>, timeoutMs: number, parent?: AbortSignal): Promise<T> {
  const controller = new AbortController();
  return new Promise<T>((resolve, reject) => {
    let settled = false;
    const finish = (value?: T, error?: unknown, failed = false) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      parent?.removeEventListener("abort", cancelled);
      if (failed) reject(error); else resolve(value!);
    };
    const cancelled = () => { controller.abort(); finish(undefined, new RuntimeAdapterError("cancelled", "Image enrichment was cancelled."), true); };
    const timer = setTimeout(() => { controller.abort(); finish(undefined, new RuntimeAdapterError("timed_out", "Image lookup exceeded its time budget."), true); }, timeoutMs);
    parent?.addEventListener("abort", cancelled, { once: true });
    if (parent?.aborted) { cancelled(); return; }
    Promise.resolve().then(() => {
      if (controller.signal.aborted) throw new RuntimeAdapterError("cancelled", "Image enrichment was cancelled.");
      return operation(controller.signal);
    }).then((value) => finish(value), (error) => finish(undefined, error, true));
  });
}

export async function probeRemoteImageUrl(url: string, options: { resolveHost?: (host: string) => Promise<Array<{ address: string }>>; fetcher?: typeof fetch; signal?: AbortSignal } = {}): Promise<boolean | undefined> {
  try {
    let current = new URL(url);
    const signal = options.signal ? AbortSignal.any([options.signal, AbortSignal.timeout(8_000)]) : AbortSignal.timeout(8_000);
    for (let redirectCount = 0; redirectCount < 4; redirectCount += 1) {
      if (!isPublicHttpsImageUrl(current) || /(?:\.svg(?:\.png)?(?:[/?#]|$)|(?:^|[/_. -])(?:logo|icon|flag)(?:[/_. -]|$))/iu.test(current.pathname)) return false;
      if (signal.aborted) return undefined;
      const read = await readPublicMedia(current.toString(), { kind: "image", signal, maxBytes: 1024, prefixBytes: 32,
        ...(options.resolveHost ? { resolveHost: options.resolveHost } : {}), ...(options.fetcher ? { fetcher: options.fetcher } : {}) });
      current = new URL(read.url);
      if (!isPublicHttpsImageUrl(current) || /(?:\.svg(?:\.png)?(?:[/?#]|$)|(?:^|[/_. -])(?:logo|icon|flag)(?:[/_. -]|$))/iu.test(current.pathname)) {
        void read.response.body?.cancel().catch(() => {}); return false;
      }
      const response = read.response;
      if ([301, 302, 303, 307, 308].includes(response.status)) {
        const location = response.headers.get("location");
        await response.body?.cancel();
        if (!location) return false;
        current = new URL(location, current);
        continue;
      }
      if (!response.ok) {
        await response.body?.cancel();
        return [404, 410].includes(response.status) ? false : undefined;
      }
      const type = response.headers.get("content-type")?.split(";", 1)[0]?.trim().toLowerCase();
      if (!type || !["image/jpeg", "image/png", "image/webp", "image/gif", "image/avif"].includes(type) || !response.body) {
        void response.body?.cancel().catch(() => {});
        return false;
      }
      const reader = response.body.getReader();
      const prefix = new Uint8Array(32);
      let length = 0;
      try {
        while (length < prefix.length) {
          const part = await abortableImageRead(() => reader.read(), signal);
          if (part.done) break;
          const piece = part.value.subarray(0, prefix.length - length);
          prefix.set(piece, length); length += piece.length;
        }
      } finally {
        // Never buffer the photo or wait for a non-cooperative cancel response.
        void reader.cancel().catch(() => {});
      }
      return length === prefix.length && rasterPrefixMatches(type, prefix);
    }
    return false;
  } catch {
    return undefined;
  }
}

/** Header agreement only; complete decoding and visible photo identity remain
 * browser/source acceptance checks. The probe reads at most 32 prefix bytes. */
function rasterPrefixMatches(type: string, bytes: Uint8Array): boolean {
  const ascii = (start: number, end: number) => String.fromCharCode(...bytes.subarray(start, end));
  const be16 = (offset: number) => bytes[offset]! * 256 + bytes[offset + 1]!;
  const le32 = (offset: number) => new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).getUint32(offset, true);
  if (type === "image/png") return bytes.subarray(0, 8).every((value, index) => value === [137, 80, 78, 71, 13, 10, 26, 10][index])
    && ascii(8, 16) === "\0\0\0\rIHDR" && new DataView(bytes.buffer).getUint32(16) > 0 && new DataView(bytes.buffer).getUint32(20) > 0;
  if (type === "image/jpeg") {
    if (bytes[0] !== 255 || bytes[1] !== 216 || bytes[2] !== 255 || be16(4) < 2) return false;
    const marker = bytes[3]!;
    if (marker === 224) return be16(4) >= 7 && ["JFIF\0", "JFXX\0"].includes(ascii(6, 11));
    if (marker === 225) return be16(4) >= 8 && (ascii(6, 12) === "Exif\0\0" || ascii(6, 11) === "http:");
    if (marker === 219) return be16(4) >= 67 && (bytes[6]! & 15) <= 3 && (bytes[6]! >> 4) <= 1;
    if ([192, 193, 194].includes(marker)) return be16(4) >= 8 && [8, 12].includes(bytes[6]!) && be16(7) > 0 && be16(9) > 0;
    return marker === 226 && be16(4) >= 14 && ascii(6, 18) === "ICC_PROFILE\0"
      || marker === 238 && be16(4) >= 7 && ascii(6, 11) === "Adobe";
  }
  if (type === "image/gif") return ["GIF87a", "GIF89a"].includes(ascii(0, 6)) && (bytes[6]! + bytes[7]! * 256) > 0 && (bytes[8]! + bytes[9]! * 256) > 0;
  if (type === "image/webp") {
    if (ascii(0, 4) !== "RIFF" || ascii(8, 12) !== "WEBP" || le32(4) < 18) return false;
    const chunk = ascii(12, 16);
    return chunk === "VP8 " && le32(16) >= 10 && ascii(23, 26) === "\x9d\x01\x2a"
      || chunk === "VP8L" && le32(16) >= 5 && bytes[20] === 47
      || chunk === "VP8X" && le32(16) === 10;
  }
  if (type === "image/avif") return ascii(4, 8) === "ftyp" && new DataView(bytes.buffer).getUint32(0) >= 16
    && [ascii(8, 12), ascii(16, 20), ascii(20, 24), ascii(24, 28), ascii(28, 32)].some(brand => brand === "avif" || brand === "avis");
  return false;
}

export function isPublicHttpsImageUrl(url: URL): boolean {
  const host = url.hostname.replace(/^\[|\]$/g, "").toLowerCase();
  return url.protocol === "https:" && !url.username && !url.password && !isIP(host)
    && host.includes(".") && !/(^|\.)(?:localhost|local|internal|test|invalid)$/.test(host);
}

function normalizeUrl(value: string): string {
  try {
    const url = new URL(value);
    url.hash = "";
    return url.toString();
  } catch {
    return value;
  }
}
