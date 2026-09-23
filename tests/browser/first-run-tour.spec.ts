import { expect, test } from "@playwright/test";

test("first-run tour saves the shared profile before opening the plan composer", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 960 });
  await page.addInitScript(() => {
    localStorage.clear();
    // A workspace reset creates a new profile lifecycle even when this origin
    // still remembers that an earlier user completed the tour.
    localStorage.setItem("landi:first-run-tour:v1", "complete");
  });

  const starter = {
    id: "starter-plan",
    version: 1,
    title: "Attend an exhibition in Shanghai",
    location: "Shanghai",
    dates: "To be confirmed",
    status: "draft",
    knownInformation: [],
    assumptions: [],
    nextAction: "Create your first plan.",
    createdAt: "2026-09-20T00:00:00.000Z",
    configuration: { accommodation: { status: "not_set" }, arrival: {}, transport: { preference: "taxi" }, travelContext: { partySize: 1 } },
    stages: [],
    sources: [],
    presentation: { kind: "timeline", summary: "", items: [] }
  };
  const incompleteWorkspace = {
    profile: { status: "incomplete", displayName: "New explorer", preferredLanguage: "English", nationality: "To be confirmed", gender: "not_specified", immigrationStatus: "unknown" },
    runtime: { selectedKind: "codex" },
    inbox: [],
    destinationArrivals: [],
    activePlan: starter
  };
  const readyWorkspace = {
    ...incompleteWorkspace,
    profile: { status: "ready", displayName: "Ricky", preferredLanguage: "English", travelPreferences: "Food, culture, nature, modern cities", nationality: "To be confirmed", gender: "not_specified", immigrationStatus: "short_term_visitor" }
  };

  await page.route("**/api/workspace", (route) => route.fulfill({ contentType: "application/json", body: JSON.stringify(incompleteWorkspace) }));
  await page.route("**/api/plans/history", (route) => route.fulfill({ contentType: "application/json", body: "[]" }));
  await page.route("**/api/configuration", (route) => route.fulfill({ contentType: "application/json", body: "{}" }));
  await page.route("**/api/profile", async (route) => {
    const body = route.request().postDataJSON();
    expect(body).toMatchObject({
      displayName: "Ricky",
      preferredLanguage: "English",
      travelPreferences: "Food, culture, nature, modern cities",
      nationality: "To be confirmed",
      gender: "not_specified",
      immigrationStatus: "short_term_visitor"
    });
    await route.fulfill({ contentType: "application/json", body: JSON.stringify(readyWorkspace) });
  });

  await page.goto("/");

  await expect(page.getByRole("heading", { name: "Tell me where you want to go." })).toBeVisible();
  await expect(page.getByText("Skip introduction")).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Go to step 4: Stay ahead of every change" })).toBeDisabled();
  await page.getByRole("button", { name: "Go to step 2: Fine-tune it your way" }).click();
  await expect(page.getByRole("heading", { name: "Fine-tune it your way." })).toBeVisible();
  await page.getByRole("button", { name: "Go to step 1: Tell me where you want to go" }).click();
  await expect(page.getByRole("heading", { name: "Tell me where you want to go." })).toBeVisible();
  await page.getByRole("button", { name: "Next" }).click();
  await page.getByRole("button", { name: "Next" }).click();

  await expect(page.getByRole("heading", { name: "Tell me once, and that’s enough." })).toBeVisible();
  const nameInput = page.getByRole("textbox", { name: "Name", exact: true });
  await expect(nameInput).toHaveValue("");
  await expect(nameInput).toHaveAttribute("placeholder", "New explorer");
  await nameInput.fill("Ricky");
  await expect(page.getByRole("textbox", { name: "Nationality" })).toHaveCount(0);
  await expect(page.getByRole("combobox", { name: "Gender" })).toHaveCount(0);
  await page.getByRole("textbox", { name: "Travel preferences" }).fill("Food, culture, nature, modern cities");
  await page.getByRole("combobox", { name: "Destination visa or residence status" }).selectOption("short_term_visitor");
  await page.getByRole("button", { name: "Next" }).click();

  await expect(page.getByRole("heading", { name: "Stay ahead of every change." })).toBeVisible();
  await expect(page.getByRole("button", { name: "Go to step 5: A personal assistant for your entire journey" })).toBeEnabled();
  await expect(page.getByRole("dialog", { name: "Help Landi get to know you" })).toHaveCount(0);
  await page.getByRole("button", { name: "Next" }).click();

  const createButton = page.getByRole("button", { name: "Create My First Plan" });
  await expect(createButton).toBeVisible();
  await createButton.click();

  await expect(page.getByRole("heading", { name: "Plan your trip with Landi" })).toBeVisible();
  await expect(page.getByPlaceholder("Chat with Landi")).toBeVisible();
  await expect.poll(() => page.evaluate(() => localStorage.getItem("landi:first-run-tour:v1"))).toBe("complete");
});
