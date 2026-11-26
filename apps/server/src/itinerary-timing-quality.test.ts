import assert from "node:assert/strict";
import test from "node:test";
import type { TripBlueprint } from "@c-assistant/core";
import { sparseItineraryTimingDates, unselectedAccommodationDates } from "./itinerary-timing-quality.js";

function blueprint(starts: Array<string | undefined>): TripBlueprint {
  return {
    days: starts.map((startTime, index) => ({
      id: `day-${index + 1}`,
      date: `2026-12-${String(index + 14).padStart(2, "0")}`,
      city: "Wellington",
      kind: "scheduled",
      stops: [{ placeId: `place-${index}`, order: 1 }],
      blocks: [{ id: `block-${index}`, kind: "stop", order: 1, placeId: `place-${index}`, ...(startTime ? { startTime } : {}), evidence: [] }]
    }))
  } as unknown as TripBlueprint;
}

test("flags the sparse timing pattern in the Wellington generation", () => {
  assert.deepEqual(sparseItineraryTimingDates(blueprint(["15:00", undefined, undefined, undefined, undefined, undefined, undefined, undefined])), [
    "2026-12-15", "2026-12-16", "2026-12-17", "2026-12-18", "2026-12-19", "2026-12-20", "2026-12-21"
  ]);
});

test("accepts a mostly timed plan and small intentionally flexible trips", () => {
  assert.deepEqual(sparseItineraryTimingDates(blueprint(["09:00", "10:00", undefined, "13:00"])), []);
  assert.deepEqual(sparseItineraryTimingDates(blueprint([undefined, undefined])), []);
});

test("flags a pending hotel block when the same base has researched recommendations", () => {
  const value = blueprint(["10:00"]);
  value.places = [{ id: "hotel", name: "Park Hotel", city: "Wellington", category: "hotel", accommodation: { state: "recommended", baseLabel: "Wellington" } }] as TripBlueprint["places"];
  value.days[0]!.blocks!.push({ id: "stay", kind: "lodging", order: 2, title: "Wellington accommodation not selected", evidence: [] });
  assert.deepEqual(unselectedAccommodationDates(value), ["2026-12-14"]);
  value.days[0]!.blocks![1]!.placeId = "hotel";
  assert.deepEqual(unselectedAccommodationDates(value), []);
  value.days[0]!.blocks!.pop();
  value.days.push({ ...value.days[0]!, id: "second-day", date: "2026-12-15" });
  assert.deepEqual(unselectedAccommodationDates(value), ["2026-12-14"]);
});

test("accepts an existing hotel whose locality has a village suffix", () => {
  const value = blueprint(["10:00"]);
  value.days[0]!.city = "Aoraki / Mount Cook";
  value.places = [{ id: "hotel", name: "The Hermitage Hotel", city: "Aoraki/Mount Cook Village", category: "hotel", accommodation: { state: "recommended", baseLabel: "Aoraki/Mount Cook Village" } }] as TripBlueprint["places"];
  value.days[0]!.blocks!.push({ id: "stay", kind: "lodging", order: 2, placeId: "hotel", evidence: [] });
  value.days.push({ ...value.days[0]!, id: "second-day", date: "2026-12-15" });
  assert.deepEqual(unselectedAccommodationDates(value), []);
});
