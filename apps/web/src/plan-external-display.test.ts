import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { Plan, PlanPlace, Task } from "@c-assistant/core";
import { appDownloads, bookingStatusLabel, formatDistance, googleMapsRouteUrl, googleMapsSearchUrl, routeModeLabel, visibleDocumentPolicySources } from "./plan-external-display.js";

describe("plan external display helpers", () => {
  it("formats booking, route, and distance labels", () => {
    assert.equal(bookingStatusLabel("needs_review"), "Needs review");
    assert.equal(bookingStatusLabel("confirmed"), "Confirmed");
    assert.equal(routeModeLabel("rail"), "Rail connection");
    assert.equal(formatDistance(950), "950 m");
    assert.equal(formatDistance(1_250), "1.3 km");
    assert.equal(formatDistance(12_000), "12 km");
  });

  it("builds Google Maps URLs without depending on components", () => {
    const origin = { name: "Kyoto Station", locationLabel: "Kyoto", city: "Kyoto" } as PlanPlace;
    const destination = { name: "Kiyomizu-dera", locationLabel: "Kyoto", city: "Kyoto" } as PlanPlace;

    assert.equal(googleMapsSearchUrl(" Kyoto Station "), "https://www.google.com/maps/search/?api=1&query=Kyoto%20Station");
    assert.ok(googleMapsRouteUrl(origin, destination, "walking").includes("travelmode=walking"));
  });

  it("filters document and policy sources", () => {
    const plan = {
      sources: [
        { title: "Visa policy", authority: "Consulate", url: "https://example.com/visa", retrievedAt: "2026-09-01" },
        { title: "Cafe guide", authority: "Blog", url: "https://example.com/cafe", retrievedAt: "2026-09-01" }
      ]
    } as Plan;

    assert.deepEqual(visibleDocumentPolicySources(plan).map((source) => source.title), ["Visa policy"]);
  });

  it("uses official app sources before fallback download links", () => {
    const task = { title: "Install WeChat", description: "Set up account" } as Task;
    const downloads = appDownloads(task, [{ title: "WeChat official site", authority: "WeChat", url: "https://official.example/wechat", retrievedAt: "2026-09-01" }]);

    assert.deepEqual(downloads, [{ label: "Download WeChat", url: "https://official.example/wechat" }]);
  });
});
