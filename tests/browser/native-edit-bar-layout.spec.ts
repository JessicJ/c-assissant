import { test } from './evidence-test';
import { expect } from "@playwright/test";

test("nearby option edits show a review toolbar above the itinerary", async ({ page }) => {
  await page.route("**/api/workspace", async (route) => route.fulfill({ contentType: "application/json", body: JSON.stringify({
    profile: { status: "ready", displayName: "Trip tester", preferredLanguage: "en", nationality: "Singapore", gender: "prefer_not_to_say", immigrationStatus: "short_term_visitor" },
    runtime: { selectedKind: "codex" }, inbox: [],
    activePlan: {
      id: "native-edit-bar-trip", version: 1, title: "Tokyo Neighborhoods", location: "Tokyo", dates: "2026-10-04 to 2026-10-05", status: "draft", knownInformation: ["Two focused days in Tokyo"], assumptions: [], nextAction: "Review the plan.", createdAt: "2026-08-17T00:00:00.000Z",
      configuration: { accommodation: { status: "not_set" }, arrival: {}, transport: { preference: "plan_recommended" }, travelContext: { partySize: 2, luggage: "light" } }, stages: [], sources: [],
      presentation: {
        kind: "itinerary", summary: "Tokyo Neighborhoods", language: "en", startDate: "2026-10-04", endDate: "2026-10-05", cities: ["Tokyo"],
        days: [
          { id: "d1", label: "October 4", shortLabel: "10/4", city: "Tokyo", title: "Garden and old-town rhythm", summary: "Start with a quiet garden, then move through nearby streets at an easy pace.", anchors: ["garden"], candidates: ["market"], placeIds: ["garden"], stops: [{ placeId: "garden", order: 1, time: "09:00" }], routeReview: { sequenceRationale: "Keep the first morning gentle and close together.", fixedConstraints: [] } },
          { id: "d2", label: "October 5", shortLabel: "10/5", city: "Tokyo", title: "Design and coffee", summary: "Use smaller stops and breaks to keep the day flexible.", anchors: ["museum"], candidates: [], placeIds: ["museum"], stops: [{ placeId: "museum", order: 1, time: "10:00" }] }
        ],
        places: [
          { id: "garden", name: "Kiyosumi Garden", city: "Tokyo", area: "Kiyosumi", locationLabel: "Kiyosumi", coordinates: [35.6811, 139.7978], category: "sight", priority: "must", contentTier: "deep", durationMinutes: 90, whyWorthIt: "The stepping-stone paths and pond make the morning feel calm without leaving the neighborhood.", plan: "Begin here before nearby stops.", detailSections: [], sourceRefs: [] },
          { id: "market", name: "Ningyocho Snack Street", city: "Tokyo", area: "Ningyocho", locationLabel: "Ningyocho", coordinates: [35.6866, 139.7824], category: "food", priority: "nearby", durationMinutes: 60, whyWorthIt: "A compact food stop that can replace a longer lunch plan.", plan: "Add if the morning moves faster than expected.", detailSections: [], sourceRefs: [] },
          { id: "museum", name: "Nezu Museum", city: "Tokyo", area: "Aoyama", locationLabel: "Aoyama", coordinates: [35.6621, 139.7171], category: "art", priority: "preferred", durationMinutes: 120, whyWorthIt: "A compact art visit with a garden break built in.", plan: "Use as the second-day anchor.", detailSections: [], sourceRefs: [] }
        ],
        routeSegments: []
      }
    }
  }) }));

  await page.goto("/#day=d1&poi=garden");
  const workspace = page.getByRole("region", { name: "Landi Blueprint workspace" });
  await expect(workspace).toBeVisible();
  await page.getByLabel("Itinerary side panel").locator(".blueprint-guide-card").filter({ hasText: "Ningyocho Snack Street" }).getByRole("button", { name: "Add", exact: true }).click();
  await page.getByRole("button", { name: "Add to draft" }).click();
  const bar = page.getByRole("toolbar", { name: "Unsaved itinerary edits" });
  await expect(bar).toContainText("1 unsaved change");
  await expect(bar.getByRole("button", { name: "Apply" })).toBeVisible();
  expect(await bar.evaluate((element) => element.closest(".blueprint-topbar") !== null && element.closest(".blueprint-itinerary-grid") === null)).toBe(true);
});
