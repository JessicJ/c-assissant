import { test } from './evidence-test';
import { expect } from "@playwright/test";

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
    destinationArrivals: [], sourceSnapshots: [], system: { core: "ready", storage: "local", runtime: "configured" },
    activePlan: starter
  };
  const readyWorkspace = {
    ...incompleteWorkspace,
    profile: { status: "ready", displayName: "Ricky", preferredLanguage: "English", assistantPersonality: "travel_buddy", travelPreferences: "Food, culture, nature, modern cities", nationality: "To be confirmed", gender: "woman", immigrationStatus: "unknown" }
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
      gender: "woman",
      assistantPersonality: "travel_buddy",
      immigrationStatus: "unknown"
    });
    await route.fulfill({ contentType: "application/json", body: JSON.stringify(readyWorkspace) });
  });

  await page.goto("/");

  await expect(page.getByRole("heading", { name: "Tell me where you want to go." })).toBeVisible();
  await expect(page.getByRole("button", { name: "Skip introduction" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Go to step 5: Stay ahead of every change" })).toBeDisabled();
  await page.locator(".first-run-next").click();
  await expect(page.getByRole("heading", { name: "Fine-tune it your way." })).toBeVisible();
  await page.locator(".first-run-next").click();

  await expect(page.getByRole("heading", { name: "Tell me once, and that’s enough." })).toBeVisible();
  const nameInput = page.getByRole("textbox", { name: "Name", exact: true });
  await expect(nameInput).toHaveValue("");
  await expect(nameInput).toHaveAttribute("placeholder", "New explorer");
  await nameInput.fill("Ricky");
  await expect(page.getByRole("textbox", { name: "Nationality" })).toHaveCount(0);
  await page.getByRole("combobox", { name: "Gender", exact: true }).selectOption("woman");
  await expect(page.getByRole("textbox", { name: "Language", exact: true })).toHaveCount(0);
  await page.getByRole("textbox", { name: "Travel preferences" }).fill("Food, culture, nature, modern cities");
  await expect(page.getByRole("combobox", { name: "Destination visa or residence status" })).toHaveValue("unknown");
  const createButton = page.locator(".first-run-tour .first-run-next");
  await expect(createButton).toBeVisible();
  await createButton.click();
  await expect(page.getByRole("heading", { name: "Choose your travel company." })).toBeVisible();
  const people = page.locator('.onboarding-person');
  await expect(people).toHaveCount(3);
  await expect(page.getByRole('button', { name: /^Choose Luca/ })).toHaveAttribute('aria-pressed', 'true');
  for (const name of ['Miles', 'Luca', 'Coco']) {
    await page.getByRole('button', { name: new RegExp(`^Choose ${name}`) }).click();
    await expect(page.locator('.onboarding-person[aria-pressed="true"]')).toHaveCount(1);
    await expect(page.getByRole('button', { name: new RegExp(`^Choose ${name}`) })).toHaveAttribute('aria-pressed', 'true');
  }
  await expect(page.locator('.personality-preview')).toHaveCount(0);
  await expect(createButton).toHaveText('Next');
  await createButton.click();
  await expect(page.getByRole('heading', { name: 'Stay ahead of every change.' })).toBeVisible();
  await createButton.click();
  await expect(page.getByRole('heading', { name: 'A personal assistant for your entire journey.' })).toBeVisible();
  await expect(createButton).toHaveText('Start planning');
  await createButton.click();

  await expect(page.getByRole("heading", { name: "Plan your trip with Landi" })).toBeVisible();
  await expect(page.getByPlaceholder("Chat with Landi")).toBeVisible();
  await expect(page.getByText("Ooh, a new trip!", { exact: false })).toBeVisible();
  await expect.poll(() => page.evaluate(() => localStorage.getItem("landi:first-run-tour:v1"))).toBe("complete");
});

test('an interrupted personality step returns to the unsaved profile details on reload', async ({ page, request }) => {
  const snapshot = await (await request.get('/api/workspace')).json();
  snapshot.profile = { ...snapshot.profile, status: 'incomplete', displayName: 'New explorer' };
  await page.route('**/api/workspace', route => route.fulfill({ contentType: 'application/json', body: JSON.stringify(snapshot) }));
  await page.addInitScript(() => {
    localStorage.setItem('landi:first-run-tour:progress:v1', '3');
  });
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Tell me once, and that’s enough.' })).toBeVisible();
  await page.getByRole('textbox', { name: 'Name', exact: true }).fill('Alex');
  await page.locator('.first-run-next').click();
  await expect(page.getByRole('heading', { name: 'Choose your travel company.' })).toBeVisible();
  await page.reload();
  await expect(page.getByRole('heading', { name: 'Tell me once, and that’s enough.' })).toBeVisible();
  await expect(page.getByRole('textbox', { name: 'Name', exact: true })).toHaveValue('');
});

for (const { width, height } of [
  { width: 320, height: 568 }, { width: 375, height: 844 },
  { width: 414, height: 844 }, { width: 600, height: 800 },
  { width: 768, height: 844 }, { width: 1280, height: 960 },
  { width: 1280, height: 568 }
]) {
  test(`all six onboarding pages fit ${width}x${height}`, async ({ page, request }, testInfo) => {
    await page.setViewportSize({ width, height });
    const snapshot = await (await request.get('/api/workspace')).json();
    snapshot.profile = { ...snapshot.profile, status: 'ready', displayName: 'Alex' };
    await page.route('**/api/workspace', route => route.fulfill({ contentType: 'application/json', body: JSON.stringify(snapshot) }));
    await page.goto('/?onboarding=1');
    for (let step = 1; step <= 6; step++) {
      await page.getByRole('button', { name: new RegExp(`^Go to step ${step}:`) }).click();
      await expect(page.locator('.first-run-skip')).toHaveCount(0);
      await expect(page.locator('.first-run-next')).toBeInViewport();
      await expect(page.locator('.first-run-page h1')).toBeInViewport();
      const layout = await page.locator('.first-run-tour').evaluate(dialog => {
        const article = dialog.querySelector('.first-run-page')!;
        const footer = dialog.querySelector('.first-run-controls')!;
        const rect = article.getBoundingClientRect();
        return {
          scrollWidth: article.scrollWidth, width: article.clientWidth,
          pageBottom: rect.bottom, footerTop: footer.getBoundingClientRect().top,
          outside: Array.from(article.querySelectorAll('*')).filter(element => {
            const box = element.getBoundingClientRect();
            return box.width > 0 && (box.left < rect.left - 1 || box.right > rect.right + 1);
          }).map(element => element.className)
        };
      });
      expect(layout.scrollWidth).toBeLessThanOrEqual(layout.width + 1);
      expect(layout.pageBottom).toBeLessThanOrEqual(layout.footerTop + 1);
      expect(layout.outside).toEqual([]);
      await page.screenshot({ path: testInfo.outputPath(`step-${step}.png`) });
      const lastContent = page.locator('.first-run-page').locator('img, input, select, .onboarding-person-description, .tour-updated-plan > div').last();
      await lastContent.scrollIntoViewIfNeeded();
      await expect(lastContent).toBeInViewport();
      const lastBox = await lastContent.boundingBox();
      const footerBox = await page.locator('.first-run-controls').boundingBox();
      expect(lastBox!.y + lastBox!.height).toBeLessThanOrEqual(footerBox!.y + 1);
      await expect(page.locator('.first-run-next')).toBeInViewport();
    }
  });
}
