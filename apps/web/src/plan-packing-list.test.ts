import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { Plan } from "@c-assistant/core";
import { groupPackingItems, packingChecksKey, planPackingItems, readPackingChecks, writePackingChecks } from "./plan-packing-list.js";

class MemoryStorage {
  private readonly values = new Map<string, string>();
  getItem(key: string): string | null { return this.values.get(key) ?? null; }
  setItem(key: string, value: string): void { this.values.set(key, value); }
}

function itineraryPlan(patch: Partial<Plan> = {}): Plan {
  return {
    id: "plan-1",
    version: 2,
    title: "Tokyo and Kyoto temples",
    location: "Tokyo / Kyoto",
    dates: "2026-10-05 2026-10-08",
    status: "active",
    assumptions: [],
    knownInformation: [],
    nextAction: "Confirm",
    sources: [],
    stages: [],
    createdAt: "2026-09-01T00:00:00.000Z",
    configuration: {},
    presentation: {
      kind: "itinerary",
      summary: "Temple walks, museums, rail transfers, and restaurant reservations.",
      startDate: "2026-10-05",
      endDate: "2026-10-08",
      days: [{ id: "day-1", date: "2026-10-05", title: "Kyoto temples", city: "Kyoto", summary: "A temple and museum day.", placeIds: [] }],
      places: [{ id: "place-1", name: "Kiyomizu-dera", category: "temple", city: "Kyoto" }],
      routeSegments: []
    },
    ...patch
  } as unknown as Plan;
}

describe("plan packing list", () => {
  it("uses explicit packing tasks before inferred suggestions", () => {
    const plan = itineraryPlan({
      stages: [{ id: "stage-1", title: "Prep", description: "", tasks: [{ id: "task-1", title: "Pack passport pouch", description: "Ticket copies", dueLabel: "Before departure", status: "waiting_user", owner: "user", preparationCategory: "packing_item" }] }]
    });

    const items = planPackingItems(plan);

    assert.deepEqual(items.map((item) => item.key), ["task-1"]);
    assert.equal(items[0]?.group, "Essentials");
  });

  it("suggests seasonal, activity, and transfer items from itinerary context", () => {
    const titles = planPackingItems(itineraryPlan()).map((item) => item.title);

    assert.ok(titles.includes("Light jacket, cardigan, or thin overshirt"));
    assert.ok(titles.includes("Clean socks for shoes-off stops"));
    assert.ok(titles.includes("Luggage tag and compact lock"));
  });

  it("groups items in stable display order", () => {
    const groups = groupPackingItems([
      { key: "weather", title: "Umbrella", detail: "", group: "Weather" },
      { key: "essentials", title: "Passport", detail: "", group: "Essentials" }
    ]);

    assert.deepEqual(groups.map((group) => group.title), ["Essentials", "Weather"]);
  });

  it("reads and writes checks through an injected storage boundary", () => {
    const storage = new MemoryStorage();

    writePackingChecks(storage, "plan-1", 2, new Set(["a", "b"]));

    assert.equal(storage.getItem(packingChecksKey("plan-1", 2)), "[\"a\",\"b\"]");
    assert.deepEqual([...readPackingChecks(storage, "plan-1", 2)], ["a", "b"]);
  });

  it("ignores malformed persisted checks", () => {
    const storage = new MemoryStorage();
    storage.setItem(packingChecksKey("plan-1", 2), "{\"not\":\"a list\"}");

    assert.equal(readPackingChecks(storage, "plan-1", 2).size, 0);
  });
});
