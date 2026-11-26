import { MahBusinessContractError } from "./mah-business-contract.js";
import { MahCarrierError } from "./mah-generation-contract.js";
import assert from "node:assert/strict";
import test from "node:test";
import { setImmediate as nextTurn } from "node:timers/promises";
import { LANDI_BLUEPRINT_SKILL, type SkillImageEnrichmentArtifact } from "@c-assistant/agent-adapters";
import { importSkillItinerary, importSkillResearchBatches, type SkillItineraryArtifact, type SkillResearchBatchArtifact } from "@c-assistant/core";
import { mergePlannedPlaceImageEnrichment } from "./planned-place-image-coverage.js";
import { prefetchPlannedPlaceImages, probeRemoteImageUrl, runPlannedPlaceImagePass } from "./planned-place-image-pipeline.js";

const date = "2026-10-06";

function fixture(count = 6) {
  const places = Array.from({ length: count }, (_, index) => ({ id: `place-${index + 1}`, name: `Place ${index + 1}`, locationLabel: "Lisbon", city: "Lisbon", category: "museum", whyWorthIt: "Visit", plan: "Explore", sourceUrls: [] }));
  const batch: SkillResearchBatchArtifact = { id: "lisbon", scopeLabel: "Lisbon", completedAt: `${date}T00:00:00.000Z`, sources: [], places, events: [], relationships: [], localFoods: [], localProducts: [], experienceThemes: [], travelTips: [], actionRequirements: [] };
  const research = importSkillResearchBatches([batch], { researchSetId: "research", generationKey: "generation", proposalRef: { sessionId: "session", proposalVersion: 1 }, skillLineage: LANDI_BLUEPRINT_SKILL, createdAt: `${date}T00:00:00.000Z`, updatedAt: `${date}T00:00:00.000Z` });
  const ids = research.places.map((place) => place.id);
  const itinerary: SkillItineraryArtifact = { title: "Lisbon", summary: "Lisbon", language: "en", destinations: ["Lisbon"], startDate: date, endDate: date, days: [{ id: "day", date, kind: "scheduled", city: "Lisbon", title: "Lisbon", summary: "Museums", stops: ids.map((placeId, index) => ({ placeId, order: index + 1 })), candidatePlaceIds: [], blocks: ids.map((placeId, index) => ({ id: `block-${index + 1}`, kind: "stop" as const, order: index + 1, placeId, planRole: "planned" as const, evidence: [] })) }], movements: ids.slice(0, -1).map((originPlaceId, index) => ({ id: `movement-${index + 1}`, dayId: "day", originPlaceId, destinationPlaceId: ids[index + 1]!, mode: "unknown" as const, status: "recheck" as const, evidence: [] })) };
  const blueprint = importSkillItinerary(research, itinerary, { blueprintId: "blueprint", blueprintVersion: 1, createdAt: `${date}T00:00:00.000Z` });
  return { research, blueprint };
}

function imagesFor(places: { id: string; name: string }[]): SkillImageEnrichmentArtifact {
  return {
    sources: places.map((place) => ({ id: `source-${place.id}`, title: place.name, authority: place.name, url: `https://example.com/${place.id}`, retrievedAt: date, status: "verified" as const })),
    images: places.map((place) => ({ placeId: place.id, url: `https://example.com/${place.id}.jpg`, alt: place.name, sourceUrl: `https://example.com/${place.id}`, usage: ["card" as const, "detail" as const], status: "verified" as const })),
    omitted: []
  };
}

test("small image batches save successes despite another batch failing, then resume only missing places", async () => {
  const original = fixture();
  const firstCalls: string[][] = [];
  const first = await runPlannedPlaceImagePass({
    ...original,
    retryMissingOnce: false,
    search: async (places) => {
      firstCalls.push(places.map((place) => place.id));
      if (firstCalls.length === 2) throw new Error("Search unavailable for this batch");
      return imagesFor(places.slice(0, 2));
    },
    save: (research, blueprint) => ({ research, blueprint })
  });
  assert.deepEqual(firstCalls.map((batch) => batch.length), [3, 3]);
  assert.equal(first.acceptedImageCount, 2);
  assert.equal(first.remainingPlaceCount, 4);
  assert.equal(first.failedBatchCount, 1);
  assert.equal(original.research.places.every((place) => !place.images?.length), true);

  const resumedCalls: string[][] = [];
  const resumed = await runPlannedPlaceImagePass({
    research: first.research,
    blueprint: first.blueprint,
    search: async (places) => { resumedCalls.push(places.map((place) => place.id)); return imagesFor(places); },
    save: (research, blueprint) => ({ research, blueprint })
  });
  assert.deepEqual(resumedCalls.map((batch) => batch.length), [3, 1]);
  assert.equal(resumed.acceptedImageCount, 4);
  assert.equal(resumed.remainingPlaceCount, 0);
});

test("automatic retry asks only for places still missing after the first round", async () => {
  const original = fixture();
  const calls: string[][] = [];
  const result = await runPlannedPlaceImagePass({
    ...original,
    search: async (places) => {
      calls.push(places.map((place) => place.id));
      return imagesFor(calls.length <= 2 ? places.slice(0, 1) : places);
    },
    save: (research, blueprint) => ({ research, blueprint })
  });
  assert.deepEqual(calls.map((batch) => batch.length), [3, 3, 3, 1]);
  assert.equal(result.acceptedImageCount, 6);
  assert.equal(result.remainingPlaceCount, 0);
});

test("image-only pass does not repeat a wholly failed search round before publishing the draft", async () => {
  const original = fixture();
  let calls = 0;
  const result = await runPlannedPlaceImagePass({
    ...original,
    search: async () => { calls += 1; throw new Error("Image search timed out"); },
    save: (research, blueprint) => ({ research, blueprint })
  });
  assert.equal(calls, 2);
  assert.equal(result.failedBatchCount, 2);
  assert.equal(result.remainingPlaceCount, 6);
  assert.deepEqual(result.blueprint.days, original.blueprint.days);
});

test("exact sourced lookup saves a valid photo before the slower image search", async () => {
  const original = fixture();
  const searched: string[][] = [];
  const result = await runPlannedPlaceImagePass({
    ...original,
    retryMissingOnce: false,
    probeImageUrl: async () => true,
    lookupKnownImages: async (places) => imagesFor(places.slice(0, 1)),
    search: async (places) => { searched.push(places.map((place) => place.id)); return imagesFor(places); },
    save: (research, blueprint) => ({ research, blueprint })
  });
  assert.equal(result.acceptedImageCount, 6);
  assert.equal(result.remainingPlaceCount, 0);
  assert.equal(searched.flat().includes(original.research.places[0]!.id), false);
});

test("an image URL that serves HTML is removed and searched again without changing the itinerary", async () => {
  const original = fixture();
  const withImages = mergePlannedPlaceImageEnrichment(original.research, original.blueprint, imagesFor(original.research.places), `${date}T01:00:00.000Z`);
  const badUrl = `https://example.com/${original.research.places[0]!.id}.jpg`;
  const calls: string[][] = [];
  const result = await runPlannedPlaceImagePass({
    research: withImages.research,
    blueprint: withImages.blueprint,
    probeImageUrl: async (url) => url === badUrl ? false : true,
    search: async (places, _timeoutMs, rejectedUrls) => {
      calls.push(rejectedUrls);
      return {
        sources: [{ id: "replacement", title: "Replacement", authority: "Museum", url: "https://example.com/replacement", retrievedAt: date, status: "verified" }],
        images: places.map((place) => ({ placeId: place.id, url: "https://example.com/replacement.jpg", alt: place.name, sourceUrl: "https://example.com/replacement", usage: ["card", "detail"], status: "verified" })),
        omitted: []
      };
    },
    save: (research, blueprint) => ({ research, blueprint })
  });
  assert.equal(result.requestedPlaceCount, 1);
  assert.equal(result.remainingPlaceCount, 0);
  assert.equal(result.acceptedImageCount, 1);
  assert.deepEqual(calls, [[badUrl]]);
  const images = result.blueprint.places.find((place) => place.id === original.research.places[0]!.id)?.images;
  assert.deepEqual(images?.map((image) => image.url), ["https://example.com/replacement.jpg"]);
  assert.deepEqual(result.blueprint.days, withImages.blueprint.days);
});


test("blocked network probes preserve existing images without fetching private addresses", async () => {
  let fetched = false;
  assert.equal(await probeRemoteImageUrl("https://photos.example.com/hotel.jpg", {
    resolveHost: async () => [{ address: "10.0.0.1" }],
    fetcher: async () => { fetched = true; return new Response(); }
  }), undefined);
  assert.equal(fetched, false);
  const original = fixture();
  const saved = mergePlannedPlaceImageEnrichment(original.research, original.blueprint, imagesFor(original.research.places), `${date}T01:00:00.000Z`);
  const result = await runPlannedPlaceImagePass({ ...saved, probeImageUrl: async () => undefined,
    retryMissingOnce: false,
    search: async () => ({ images: [], sources: [], omitted: [] }),
    save: (research, blueprint) => ({ research, blueprint }) });
  assert.equal(result.remainingPlaceCount, original.research.places.length);
  assert.deepEqual(result.blueprint, saved.blueprint);
});

test("image probe distinguishes missing files from access restrictions and HTML", async () => {
  const resolveHost = async () => [{ address: "93.184.216.34" }];
  for (const [status, type, expected] of [[403, "text/html", undefined], [429, "text/html", undefined], [404, "text/html", false], [200, "text/html", false], [200, "image/jpeg", true]] as const) {
    assert.equal(await probeRemoteImageUrl("https://photos.example.com/image.jpg", { resolveHost,
      fetcher: async () => new Response(type === "image/jpeg" ? rasterFixture("jpeg") : "body", { status, headers: { "content-type": type } }) }), expected);
  }
});


test("inconclusive new photo probes stay missing even when source pages are present", async () => {
  const original = fixture();
  const result = await runPlannedPlaceImagePass({ ...original, probeImageUrl: async () => undefined,
    retryMissingOnce: false, search: async (places) => {
      const artifact = imagesFor(places);
      artifact.images[0]!.sourceUrl = "https://unrelated.example.com/not-in-sources";
      return artifact;
    }, save: (research, blueprint) => ({ research, blueprint }) });
  assert.equal(result.acceptedImageCount, 0);
  assert.equal(result.remainingPlaceCount, 6);
  assert.equal(result.blueprint.places.some(place => place.images?.length), false);
  assert.deepEqual(result.blueprint.days, original.blueprint.days);
});

test("a hung fast lookup obeys its deadline and cannot save a late response", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const original = fixture();
  let clock = 0;
  let enter!: () => void;
  const entered = new Promise<void>((resolve) => { enter = resolve; });
  let late!: (artifact: SkillImageEnrichmentArtifact) => void;
  let saves = 0;
  let searches = 0;
  const resultPromise = runPlannedPlaceImagePass({ ...original, totalTimeoutMs: 100, now: () => clock,
    lookupKnownImages: async () => { enter(); return new Promise((resolve) => { late = resolve; }); },
    search: async (places) => { searches++; return imagesFor(places); },
    save: (research, blueprint) => { saves++; return { research, blueprint }; }
  });
  await entered;
  clock = 100; t.mock.timers.tick(100);
  const result = await resultPromise;
  assert.equal(result.remainingPlaceCount, 6);
  assert.equal(searches, 0);
  assert.equal(result.failedBatchCount, 1);
  late(imagesFor(original.research.places));
  await Promise.resolve(); await Promise.resolve();
  assert.equal(saves, 0);
  assert.deepEqual(result.blueprint, original.blueprint);
});

test("hung probes preserve existing photos and let the saved plan continue", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const original = fixture();
  const saved = mergePlannedPlaceImageEnrichment(original.research, original.blueprint, imagesFor(original.research.places), `${date}T01:00:00.000Z`);
  let enter!: () => void;
  const entered = new Promise<void>((resolve) => { enter = resolve; });
  let clock = 0;
  const pending = runPlannedPlaceImagePass({ ...saved, totalTimeoutMs: 100, now: () => clock,
    probeImageUrl: async () => { enter(); return new Promise(() => {}); },
    search: async () => { throw new Error("Do not research existing photos"); }, save: (research, blueprint) => ({ research, blueprint }) });
  await entered;
  clock = 100; t.mock.timers.tick(100);
  const result = await pending;
  assert.equal(result.remainingPlaceCount, original.research.places.length);
  assert.deepEqual(result.blueprint, saved.blueprint);
});

test("a completed image batch persists before its stalled sibling, and timeout aborts the sibling", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const original = fixture();
  let clock = 0;
  let saved!: () => void;
  const checkpoint = new Promise<void>((resolve) => { saved = resolve; });
  let stalledSignal: AbortSignal | undefined;
  let late!: (artifact: SkillImageEnrichmentArtifact) => void;
  let saves = 0;
  const pending = runPlannedPlaceImagePass({ ...original, totalTimeoutMs: 60_000, now: () => clock, retryMissingOnce: false,
    search: async (places, _timeout, _rejected, signal) => {
      if (places[0]!.id === original.research.places[0]!.id) return imagesFor(places);
      stalledSignal = signal;
      return new Promise((resolve) => { late = resolve; });
    }, save: (research, blueprint) => { saves++; saved(); return { research, blueprint }; } });
  await checkpoint;
  assert.equal(saves, 1);
  assert.equal(stalledSignal?.aborted, false);
  clock = 60_000; t.mock.timers.tick(60_000);
  const result = await pending;
  assert.equal(stalledSignal?.aborted, true);
  assert.equal(result.acceptedImageCount, 3);
  assert.equal(result.remainingPlaceCount, 3);
  assert.equal(result.failedBatchCount, 1);
  late(imagesFor(original.research.places.slice(3)));
  await Promise.resolve(); await Promise.resolve();
  assert.equal(saves, 1);
});

test("cancelling a hung image dependency returns promptly and never saves photos", async () => {
  const original = fixture();
  const controller = new AbortController();
  let enter!: () => void;
  const entered = new Promise<void>((resolve) => { enter = resolve; });
  let dependencySignal: AbortSignal | undefined;
  let saves = 0;
  const pending = runPlannedPlaceImagePass({ ...original, signal: controller.signal,
    lookupKnownImages: async (_places, signal) => { dependencySignal = signal; enter(); return new Promise(() => {}); },
    search: async (places) => imagesFor(places), save: (research, blueprint) => { saves++; return { research, blueprint }; } });
  const rejected = assert.rejects(pending, (error: unknown) => Boolean(error && typeof error === "object" && "code" in error && error.code === "cancelled"));
  await entered;
  controller.abort();
  await rejected;
  assert.equal(dependencySignal?.aborted, true);
  assert.equal(saves, 0);
});


test("a cancelled DNS probe never starts a later image fetch", async () => {
  const controller = new AbortController();
  let fetched = false;
  const result = await probeRemoteImageUrl("https://photos.example.com/image.jpg", { signal: controller.signal,
    resolveHost: async () => { controller.abort(); return [{ address: "93.184.216.34" }]; },
    fetcher: async () => { fetched = true; return new Response("photo", { headers: { "content-type": "image/jpeg" } }); } });
  assert.equal(result, undefined);
  assert.equal(fetched, false);
});


test("available image workers drain the queue while an earlier batch remains stalled", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const original = fixture(12);
  let ready!: () => void;
  const drained = new Promise<void>(resolve => { ready = resolve; });
  let stalledSignal: AbortSignal | undefined;
  let active = 0;
  let peak = 0;
  const pending = runPlannedPlaceImagePass({ ...original, retryMissingOnce: false, totalTimeoutMs: 60_000,
    search: async (places, _timeout, _rejected, signal) => {
      active++; peak = Math.max(peak, active);
      if (places[0]!.id === original.research.places[0]!.id) {
        stalledSignal = signal;
        return new Promise(() => {});
      }
      active--;
      return imagesFor(places);
    },
    save: (research, blueprint) => {
      if (blueprint.places.filter(place => place.images?.length).length === 9) ready();
      return { research, blueprint };
    }
  });
  await drained;
  assert.equal(stalledSignal?.aborted, false, "Later batches finish before the stalled batch's timeout.");
  assert.ok(peak <= 3);
  t.mock.timers.tick(60_001);
  const result = await pending;
  assert.equal(result.acceptedImageCount, 9);
  assert.equal(result.remainingPlaceCount, 3);
  assert.equal(stalledSignal?.aborted, true);
});


test("MAH顺序图片批次零接受后立即拒绝原候选，再以新轮次补齐并保存", async () => {
  const original = fixture(6);
  const empty = { images: [], sources: [], omitted: [] } satisfies SkillImageEnrichmentArtifact;
  const rejected = new Set<SkillImageEnrichmentArtifact>();
  const calls: number[] = [];
  const savedCandidates: SkillImageEnrichmentArtifact[] = [];
  const result = await runPlannedPlaceImagePass({ ...original, sequentialCarriers: true,
    search: async (places, _timeout, _rejected, _signal, stage) => {
      calls.push(stage.round);
      if (calls.length === 1) return empty;
      assert.ok(rejected.has(empty), "在兄弟批次及第二轮开始前必须已明确拒绝零接受候选。");
      return imagesFor(places);
    },
    rejectCandidate: candidate => { rejected.add(candidate); },
    save: (research, blueprint, context) => {
      if (context.candidate) savedCandidates.push(context.candidate);
      return { research, blueprint };
    }
  });
  assert.deepEqual(calls, [1, 1, 2]);
  assert.equal(rejected.size, 1);
  assert.equal(savedCandidates.length, 2);
  assert.equal(savedCandidates.includes(empty), false);
  assert.equal(result.acceptedImageCount, 6);
  assert.equal(result.remainingPlaceCount, 0);
});


test("read-only prefetch starts before planning and consumes only current exact place identities", async () => {
  const original = fixture(3);
  const resolveLookups: Array<() => void> = [];
  let started = false;
  const prefetch = prefetchPlannedPlaceImages({ places: original.research.places, signal: new AbortController().signal,
    lookup: async places => { started = true; return new Promise(resolve => { resolveLookups.push(() => resolve(imagesFor(places))); }); } });
  await Promise.resolve();
  assert.equal(started, true);
  assert.equal(original.research.places.some(place => place.images?.length), false);
  resolveLookups.forEach(resolve => resolve());
  const current = [original.research.places[0]!, { ...original.research.places[1]!, city: "Porto" }];
  let fallbackIds: string[] = [];
  const artifact = await prefetch(current, new AbortController().signal, async places => { fallbackIds = places.map(place => place.id); return { sources: [], images: [], omitted: [] }; });
  assert.deepEqual(artifact.images.map(image => image.placeId), [current[0]!.id]);
  assert.deepEqual(fallbackIds, [current[1]!.id]);
  assert.equal(artifact.sources.length, 1);
  assert.equal(original.research.places.some(place => place.images?.length), false);
});

test("prefetch failure is diagnosed and leaves the normal latest-place lookup available", async () => {
  const original = fixture(1), errors: unknown[] = [];
  const failure = new Error("public source unavailable");
  const prefetch = prefetchPlannedPlaceImages({ places: original.research.places, signal: new AbortController().signal,
    lookup: async () => { throw failure; }, onError: error => errors.push(error) });
  const artifact = await prefetch(original.research.places, new AbortController().signal, async places => imagesFor(places));
  assert.deepEqual(errors, [failure]);
  assert.equal(artifact.images.length, 1);
});

test("cancelled prefetch cannot deliver cached images to a cancelled consumer", async () => {
  const original = fixture(1), controller = new AbortController();
  const prefetch = prefetchPlannedPlaceImages({ places: original.research.places, signal: controller.signal, lookup: async places => imagesFor(places) });
  controller.abort();
  await assert.rejects(prefetch(original.research.places, controller.signal, async places => imagesFor(places)), { code: "cancelled" });
});

test("MAH production receives its independent eight-minute budget after slow public lookup", async () => {
  const original = fixture(4);
  let time = 0, active = 0, peak = 0;
  const budgets: number[] = [];
  const result = await runPlannedPlaceImagePass({ ...original, sequentialCarriers: true, retryMissingOnce: false,
    now: () => time, totalTimeoutMs: 180_000,
    lookupKnownImages: async () => { time = 190_000; return { sources: [], images: [], omitted: [] }; },
    search: async (places, timeoutMs) => { active++; peak = Math.max(peak, active); budgets.push(timeoutMs); await Promise.resolve(); active--; return imagesFor(places); },
    save: (research, blueprint) => ({ research, blueprint }) });
  assert.deepEqual(budgets, [480_000, 480_000]);
  assert.equal(peak, 1);
  assert.equal(result.remainingPlaceCount, 0);
});

for (const code of ["mah_queue_wait_timed_out", "mah_acceptance_wait_timed_out", "mah_business_task_changed_during_read", "mah_provider_route_unverified"]) test(`MAH image ${code} remains visible for same-task diagnosis/recovery`, async () => {
  const original = fixture(4);
  let searches = 0, saves = 0;
  await assert.rejects(runPlannedPlaceImagePass({ ...original, sequentialCarriers: true,
    search: async () => { searches++; throw new MahCarrierError(code, "original carrier retained"); },
    save: (research, blueprint) => { saves++; return { research, blueprint }; } }), { code });
  assert.equal(searches, 1);
  assert.equal(saves, 0);
});


test("MAH public reader errors also preserve the stage instead of publishing past it", async () => {
  const original = fixture(1);
  const error = new MahBusinessContractError("mah_business_task_changed_during_read");
  await assert.rejects(runPlannedPlaceImagePass({ ...original, sequentialCarriers: true,
    search: async () => { throw error; }, save: (research, blueprint) => ({ research, blueprint }) }), candidate => candidate === error);
});


for (const code of ["mah_task_failed", "mah_task_timed_out", "mah_business_payload_invalid"]) test(`definite optional MAH image failure ${code} preserves the route without an immediate retry`, async () => {
  const original = fixture(4);
  let searches = 0;
  const result = await runPlannedPlaceImagePass({ ...original, sequentialCarriers: true,
    search: async () => { searches++; throw new MahCarrierError(code, "definite photo failure"); },
    save: (research, blueprint) => ({ research, blueprint }) });
  assert.equal(searches, 2, "Only the two original batches run; a wholly failed round never retries");
  assert.equal(result.failedBatchCount, 2);
  assert.equal(result.remainingPlaceCount, 4);
  assert.deepEqual(result.blueprint, original.blueprint);
});


test("a read-only prefetch deadline preserves completed A while B ignores abort", async t => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const original = fixture(2);
  let entered!: () => void;
  const waiting = new Promise<void>(resolve => { entered = resolve; });
  let late!: (artifact: SkillImageEnrichmentArtifact) => void;
  const prefetch = prefetchPlannedPlaceImages({ places: original.research.places, signal: new AbortController().signal,
    lookup: async places => places[0]!.id === original.research.places[0]!.id ? imagesFor(places) : (entered(), new Promise(resolve => { late = resolve; })) });
  await waiting;
  // A settles before the single whole-set deadline; only B is closed by it.
  await nextTurn();
  t.mock.timers.tick(48_000);
  const artifact = await prefetch(original.research.places, new AbortController().signal, async () => ({ images: [], sources: [], omitted: [] }));
  assert.deepEqual(artifact.images.map(image => image.placeId), [original.research.places[0]!.id]);
  assert.equal(original.blueprint.places.some(place => place.images?.length), false);
  late(imagesFor(original.research.places.slice(1)));
  await Promise.resolve(); await Promise.resolve();
  assert.deepEqual(artifact.images.map(image => image.placeId), [original.research.places[0]!.id]);
});

test("prefetched A survives a hung new B and MAH searches only unresolved B", async t => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const original = fixture(2), controller = new AbortController();
  let readsA = 0;
  const prefetch = prefetchPlannedPlaceImages({ places: original.research.places.slice(0, 1), signal: controller.signal, lookup: async places => { readsA++; return imagesFor(places); } });
  const cached = await prefetch(original.research.places.slice(0, 1), controller.signal, async () => { throw new Error("A must come from its existing prefetch"); });
  assert.equal(cached.images.length, 1);
  let entered!: () => void;
  const waiting = new Promise<void>(resolve => { entered = resolve; });
  let time = 0;
  const searched: string[][] = [];
  const pending = runPlannedPlaceImagePass({ ...original, now: () => time, totalTimeoutMs: 100,
    sequentialCarriers: true, retryMissingOnce: false,
    lookupKnownImages: (places, signal) => prefetch(places, signal, async () => { entered(); return new Promise(() => {}); }),
    search: async places => { searched.push(places.map(place => place.id)); return { images: [], sources: [], omitted: [] }; },
    save: (research, blueprint) => ({ research, blueprint }) });
  await waiting;
  await nextTurn();
  time = 100; t.mock.timers.tick(100);
  const result = await pending;
  assert.equal(result.acceptedImageCount, 1);
  assert.equal(result.remainingPlaceCount, 1);
  assert.deepEqual(searched, [[original.research.places[1]!.id]]);
  assert.equal(readsA, 1, "A is not looked up again");
  assert.equal(result.blueprint.places.find(place => place.id === original.research.places[0]!.id)!.images!.length, 1);
});

test("public image lookups limit concurrency and use one total deadline for a long itinerary", async t => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const original = fixture(12);
  let active = 0, peak = 0, started = 0, time = 0, entered!: () => void;
  const waiting = new Promise<void>(resolve => { entered = resolve; });
  const pending = runPlannedPlaceImagePass({ ...original, now: () => time, totalTimeoutMs: 100,
    lookupKnownImages: async () => { started++; active++; peak = Math.max(peak, active); if (started === 4) entered(); return new Promise(() => {}); },
    search: async () => { throw new Error('The exhausted set must not start agent work'); }, save: (research, blueprint) => ({ research, blueprint }) });
  await waiting;
  time = 100; t.mock.timers.tick(100);
  const result = await pending;
  assert.equal(peak, 4);
  assert.equal(started, 4, 'Queued places do not start a second timeout window');
  assert.equal(result.remainingPlaceCount, 12);
});

test("a slow MAH delivery receives a fresh bounded availability check after the lookup deadline", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const original = fixture(1);
  let time = 0;
  let enter!: () => void;
  const entered = new Promise<void>(resolve => { enter = resolve; });
  let release!: () => void;
  let checkSignal: AbortSignal | undefined;
  const pending = runPlannedPlaceImagePass({ ...original, sequentialCarriers: true, retryMissingOnce: false,
    now: () => time, totalTimeoutMs: 180_000,
    search: async places => { time = 600_000; return imagesFor(places); },
    probeImageUrl: async (_url, signal) => {
      checkSignal = signal;
      enter();
      await new Promise<void>(resolve => { release = resolve; });
      return true;
    },
    save: (research, blueprint) => ({ research, blueprint }) });
  await entered;
  t.mock.timers.tick(100);
  await Promise.resolve();
  assert.equal(checkSignal?.aborted, false);
  release();
  const result = await pending;
  assert.equal(result.acceptedImageCount, 1);
  assert.equal(result.remainingPlaceCount, 0);
});

test("an unknown standard lookup candidate is not saved as available", async () => {
  const original = fixture(1);
  let saves = 0;
  const result = await runPlannedPlaceImagePass({ ...original, retryMissingOnce: false,
    lookupKnownImages: async places => imagesFor(places), probeImageUrl: async () => undefined,
    search: async () => ({ images: [], sources: [], omitted: [] }),
    save: (research, blueprint) => { saves++; return { research, blueprint }; } });
  assert.equal(result.acceptedImageCount, 0);
  assert.equal(result.remainingPlaceCount, 1);
  assert.equal(saves, 0);
});

test("a hung MAH candidate check stops at eight seconds and does not save its late answer", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const original = fixture(1);
  let entered!: () => void;
  const checking = new Promise<void>(resolve => { entered = resolve; });
  let late!: (value: boolean) => void;
  let checkSignal: AbortSignal | undefined;
  let saves = 0;
  const pending = runPlannedPlaceImagePass({ ...original, sequentialCarriers: true, retryMissingOnce: false,
    now: () => 1_000_000, search: async places => imagesFor(places),
    probeImageUrl: async (_url, signal) => { checkSignal = signal; entered(); return new Promise<boolean>(resolve => { late = resolve; }); },
    save: (research, blueprint) => { saves++; return { research, blueprint }; } });
  await checking;
  t.mock.timers.tick(8_000);
  const result = await pending;
  assert.equal(checkSignal?.aborted, true);
  assert.equal(result.acceptedImageCount, 0);
  assert.equal(result.remainingPlaceCount, 1);
  late(true);
  await Promise.resolve();
  assert.equal(saves, 0);
});


test("unknown existing candidates remain while the same places can receive checked replacements", async () => {
  const original = fixture(1);
  const saved = mergePlannedPlaceImageEnrichment(original.research, original.blueprint, imagesFor(original.research.places), `${date}T01:00:00.000Z`);
  const oldUrl = saved.blueprint.places[0]!.images![0]!.url;
  let searches = 0;
  const result = await runPlannedPlaceImagePass({ research: saved.research, blueprint: saved.blueprint, retryMissingOnce: false,
    probeImageUrl: async url => url === oldUrl ? undefined : true,
    search: async places => {
      searches++;
      const artifact = imagesFor(places);
      artifact.images[0]!.url = 'https://example.com/checked-replacement.jpg';
      return artifact;
    }, save: (research, blueprint) => ({ research, blueprint }) });
  assert.equal(searches, 1);
  assert.equal(result.remainingPlaceCount, 0);
  assert.equal(result.acceptedImageCount, 1);
  assert.deepEqual(result.blueprint.places[0]!.images!.map(image => image.url), ['https://example.com/checked-replacement.jpg', oldUrl]);
  assert.deepEqual(result.blueprint.days, saved.blueprint.days);
  for (const source of saved.research.sources) assert.ok(result.research.sources.some(after => after.id === source.id && after.url === source.url));
});

test("a place with a checked existing image is not searched because another historical candidate is unknown", async () => {
  const original = fixture(1);
  const photos = imagesFor(original.research.places);
  photos.images.push({ ...photos.images[0]!, url: 'https://example.com/unknown.jpg' });
  const saved = mergePlannedPlaceImageEnrichment(original.research, original.blueprint, photos, `${date}T01:00:00.000Z`);
  const result = await runPlannedPlaceImagePass({ research: saved.research, blueprint: saved.blueprint,
    probeImageUrl: async url => url.endsWith('/unknown.jpg') ? undefined : true,
    search: async () => { throw new Error('This place already has an affirmatively checked image.'); },
    save: (research, blueprint) => ({ research, blueprint }) });
  assert.equal(result.remainingPlaceCount, 0);
  assert.deepEqual(result.blueprint, saved.blueprint);
});


test("checked replacements retain the existing bounded gallery and all source evidence", async () => {
  const original = fixture(1), photos = imagesFor(original.research.places);
  photos.images.push({ ...photos.images[0]!, url: 'https://example.com/old-2.jpg' }, { ...photos.images[0]!, url: 'https://example.com/old-3.jpg' });
  const saved = mergePlannedPlaceImageEnrichment(original.research, original.blueprint, photos, `${date}T01:00:00.000Z`);
  const result = await runPlannedPlaceImagePass({ research: saved.research, blueprint: saved.blueprint, retryMissingOnce: false,
    probeImageUrl: async url => url.endsWith('/new.jpg') ? true : undefined,
    search: async places => { const replacement = imagesFor(places); replacement.images[0]!.url = 'https://example.com/new.jpg'; return replacement; },
    save: (research, blueprint) => ({ research, blueprint }) });
  assert.equal(result.remainingPlaceCount, 0);
  assert.equal(result.blueprint.places[0]!.images!.length, 3);
  assert.equal(result.blueprint.places[0]!.images![0]!.url, 'https://example.com/new.jpg');
  for (const source of saved.research.sources) assert.ok(result.research.sources.some(after => after.id === source.id && after.url === source.url));
});


function rasterFixture(type: "jpeg" | "png" | "webp" | "gif" | "avif"): Uint8Array<ArrayBuffer> {
  const bytes = new Uint8Array(32);
  const text = (offset: number, value: string) => bytes.set(Buffer.from(value, "latin1"), offset);
  if (type === "jpeg") { bytes.set([255, 216, 255, 224, 0, 16]); text(6, "JFIF\0"); }
  if (type === "png") { bytes.set([137, 80, 78, 71, 13, 10, 26, 10]); text(8, "\0\0\0\rIHDR"); bytes[19] = 1; bytes[23] = 1; }
  if (type === "webp") { text(0, "RIFF"); bytes[4] = 32; text(8, "WEBPVP8L"); bytes[16] = 5; bytes[20] = 47; }
  if (type === "gif") { text(0, "GIF89a"); bytes[6] = 1; bytes[8] = 1; }
  if (type === "avif") { bytes[3] = 32; text(4, "ftypavif"); }
  return bytes;
}

for (const format of ["jpeg", "png", "webp", "gif", "avif"] as const) test(`image probe checks declared ${format} against a bounded raster prefix`, async () => {
  let cancelled = false, sent = false, range: string | undefined;
  const body = new ReadableStream<Uint8Array>({ pull(controller) { if (!sent) { sent = true; controller.enqueue(rasterFixture(format)); } }, cancel() { cancelled = true; } });
  const result = await probeRemoteImageUrl(`https://upload.wikimedia.org/test.${format}`, { resolveHost: async () => [{ address: "8.8.8.8" }], fetcher: async (_url, init) => {
    range = (init!.headers as Record<string, string>).Range;
    return new Response(body, { headers: { "content-type": `image/${format}` } });
  } });
  assert.equal(result, true);
  assert.equal(range, "bytes=0-1023");
  assert.equal(cancelled, true);
});

for (const [label, content, type] of [
  ["empty", new Uint8Array(), "image/jpeg"],
  ["HTML with JPEG header", Buffer.from("<!DOCTYPE html><html>proxy denied access</html>"), "image/jpeg"],
  ["truncated JPEG signature", new Uint8Array([255, 216, 255]), "image/jpeg"],
  ["forged JPEG", Buffer.concat([Buffer.from([255, 216, 255]), Buffer.from("not a real jpeg file, just disguised HTML")]), "image/jpeg"],
  ["PNG declared as JPEG", rasterFixture("png"), "image/jpeg"],
  ["JPEG declared as PNG", rasterFixture("jpeg"), "image/png"],
  ["SVG", Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><path/></svg>'), "image/svg+xml"]
] as const) test(`image probe rejects ${label}`, async () => {
  assert.equal(await probeRemoteImageUrl('https://upload.wikimedia.org/test-photo', { resolveHost: async () => [{ address: "8.8.8.8" }], fetcher: async () => new Response(content, { headers: { "content-type": type } }) }), false);
});

test("decorative logo URLs are not admitted by a valid raster signature", async () => {
  let fetched = false;
  assert.equal(await probeRemoteImageUrl('https://upload.wikimedia.org/Brand_logo.jpg', { resolveHost: async () => [{ address: "8.8.8.8" }], fetcher: async () => { fetched = true; return new Response(rasterFixture("jpeg"), { headers: { "content-type": "image/jpeg" } }); } }), false);
  assert.equal(fetched, false);
});

test("image-body transmission errors retain unknown and cancel their reader", async () => {
  const body = new ReadableStream<Uint8Array>({ start(controller) { controller.error(new Error("connection reset")); } });
  assert.equal(await probeRemoteImageUrl('https://upload.wikimedia.org/test.jpg', { resolveHost: async () => [{ address: "8.8.8.8" }], fetcher: async () => new Response(body, { headers: { "content-type": "image/jpeg" } }) }), undefined);
});

test("aborting a stalled body returns unknown even if the stream ignores abort", async () => {
  const controller = new AbortController();
  let entered!: () => void;
  const waiting = new Promise<void>(resolve => { entered = resolve; });
  let cancelled = false;
  // Only signal entry when the actual body reader requests bytes, not stream prefetch.
  const body = new ReadableStream<Uint8Array>({ pull() { entered(); return new Promise(() => {}); }, cancel() { cancelled = true; } }, { highWaterMark: 0 });
  const pending = probeRemoteImageUrl('https://upload.wikimedia.org/test.jpg', { signal: controller.signal, resolveHost: async () => [{ address: "8.8.8.8" }], fetcher: async () => new Response(body, { headers: { "content-type": "image/jpeg" } }) });
  await waiting; controller.abort();
  assert.equal(await pending, undefined);
  assert.equal(cancelled, true);
});


test("a valid source needing fourteen seconds finishes before agent fallback", async t => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const original = fixture(1);
  let entered!: () => void, searches = 0;
  const started = new Promise<void>(resolve => { entered = resolve; });
  const pending = runPlannedPlaceImagePass({ ...original,
    lookupKnownImages: async places => { entered(); return new Promise(resolve => setTimeout(() => resolve(imagesFor(places)), 14_000)); },
    search: async () => { searches++; return { images: [], sources: [], omitted: [] }; },
    save: (research, blueprint) => ({ research, blueprint }) });
  await started;
  t.mock.timers.tick(14_000);
  const result = await pending;
  assert.equal(result.acceptedImageCount, 1);
  assert.equal(result.remainingPlaceCount, 0);
  assert.equal(searches, 0);
});

test("read-only prefetch supports two fourteen-second waves while retaining four-read concurrency", async t => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const original = fixture(8);
  let entered!: () => void, active = 0, peak = 0, started = 0;
  const firstWave = new Promise<void>(resolve => { entered = resolve; });
  const prefetch = prefetchPlannedPlaceImages({ places: original.research.places, signal: new AbortController().signal,
    lookup: async places => {
      active++; peak = Math.max(peak, active); started++; if (started === 4) entered();
      return new Promise(resolve => setTimeout(() => { active--; resolve(imagesFor(places)); }, 14_000));
    } });
  await firstWave;
  t.mock.timers.tick(14_000); await nextTurn();
  assert.equal(started, 8);
  t.mock.timers.tick(14_000); await nextTurn();
  const artifact = await prefetch(original.research.places, new AbortController().signal, async () => { throw Error('completed sources must be retained'); });
  assert.equal(artifact.images.length, 8);
  assert.equal(peak, 4);
  assert.equal(original.blueprint.places.some(place => place.images?.length), false);
});

for (const target of ['Brand_logo.jpg', 'logo.svg.png']) test(`redirected decorative URL ${target} remains rejected`, async () => {
  assert.equal(await probeRemoteImageUrl('https://photos.example.org/photo.jpg', {
    resolveHost: async () => [{ address: '8.8.8.8' }],
    fetcher: async url => new URL(String(url)).pathname === '/photo.jpg'
      ? new Response(null, { status: 302, headers: { location: '/' + target } })
      : new Response(rasterFixture('jpeg'), { headers: { 'content-type': 'image/jpeg' } })
  }), false);
});
