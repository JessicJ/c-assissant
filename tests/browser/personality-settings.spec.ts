import { test } from './evidence-test';
import { expect } from '@playwright/test';

test('settings persist personality and gender across reloads using the shared profile API', async ({ page, request }, testInfo) => {
  const snapshot = await (await request.get('/api/workspace')).json();
  await request.put('/api/profile', { data: { ...snapshot.profile, displayName: 'Alex', gender: 'man', assistantPersonality: 'local_insider', preferredLanguage: 'English' } });
  await page.goto('/');
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Assistant Personality' })).toBeVisible();
  await expect(page.getByRole('combobox', { name: 'Gender', exact: true }).locator('option:not([disabled])')).toHaveText(['Man', 'Woman', 'Prefer not to say']);
  await expect(page.getByRole('textbox', { name: 'Preferred language' })).toHaveCount(0);
  const miles = page.getByRole('button', { name: /Miles Laid-back, witty/ });
  await miles.click();
  await expect(page.locator('.personality-options button')).toHaveCount(3);
  await expect(page.locator('.personality-avatar')).toHaveCount(3);
  await expect(page.locator('.personality-preview, .personality-preview-stages, .personality-description, .personality-note')).toHaveCount(0);
  await page.getByRole('button', { name: 'Save profile', exact: true }).click();
  await expect.poll(async () => (await (await request.get('/api/workspace')).json()).profile.assistantPersonality).toBe('miles');
  await page.reload();
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  await expect(miles).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByRole('combobox', { name: 'Gender', exact: true })).toHaveValue('man');
  await page.locator('section[aria-labelledby="settings-personality-title"]').screenshot({ path: testInfo.outputPath('personality-settings-desktop.png') });

  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole('button', { name: /Coco Curious, cheerful/ }).click();
  await page.getByRole('combobox', { name: 'Gender', exact: true }).selectOption('woman');
  await page.getByRole('button', { name: 'Save profile', exact: true }).click();
  await expect.poll(async () => (await (await request.get('/api/workspace')).json()).profile.assistantPersonality).toBe('travel_buddy');
  const saved = await (await request.get('/api/workspace')).json();
  expect(saved.profile).toMatchObject({ gender: 'woman', assistantPersonality: 'travel_buddy', preferredLanguage: 'English' });
  const invalid = await request.put('/api/profile', { data: { ...saved.profile, assistantPersonality: 'unknown' } });
  expect(invalid.status()).toBe(400);
  expect((await (await request.get('/api/workspace')).json()).profile.assistantPersonality).toBe('travel_buddy');
  await page.locator('.personality-picker').scrollIntoViewIfNeeded();
  await page.locator('section[aria-labelledby="settings-personality-title"]').screenshot({ path: testInfo.outputPath('personality-settings-mobile.png') });
  await page.getByRole('combobox', { name: 'Gender', exact: true }).selectOption('prefer_not_to_say');
  await page.getByRole('button', { name: 'Save profile', exact: true }).click();
  await expect.poll(async () => (await (await request.get('/api/workspace')).json()).profile.gender).toBe('prefer_not_to_say');
  await page.reload();
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  await expect(page.getByRole('combobox', { name: 'Gender', exact: true })).toHaveValue('prefer_not_to_say');
});

for (const width of [320, 375, 414, 768, 1280]) {
  test(`personality onboarding fits at ${width}px`, async ({ page, request }, testInfo) => {
    await page.setViewportSize({ width, height: 844 });
    const snapshot = await (await request.get('/api/workspace')).json();
    snapshot.profile = { ...snapshot.profile, status: 'ready', assistantPersonality: 'local_insider' };
    await page.route('**/api/workspace', route => route.fulfill({ contentType: 'application/json', body: JSON.stringify(snapshot) }));
    await page.goto('/?onboarding=1');
    await page.getByRole('button', { name: 'Go to step 1: Tell me where you want to go', exact: true }).click();
    const otherSize = await page.locator('.first-run-tour').boundingBox();
    await page.getByRole('button', { name: 'Go to step 4: Choose your travel company', exact: true }).click();
    const personaSize = await page.locator('.first-run-tour').boundingBox();
    expect(personaSize?.width).toBe(otherSize?.width);
    expect(personaSize?.height).toBe(otherSize?.height);
    await expect(page.locator('.first-run-next')).toHaveText('Next');
    await expect(page.getByRole('button', { name: /^Choose Luca/ })).toHaveAttribute('aria-pressed', 'true');
    await page.getByRole('button', { name: /^Choose Miles/ }).click();
    await expect(page.getByRole('button', { name: /^Choose Miles/ })).toHaveAttribute('aria-pressed', 'true');
    await expect(page.locator('.onboarding-person[aria-pressed="true"]')).toHaveCount(1);
    await expect(page.locator('.onboarding-person[aria-pressed="true"] .onboarding-avatar-ring')).toHaveCSS('border-top-color', 'rgb(36, 125, 255)');
    await expect(page.locator('.onboarding-person[aria-pressed="false"] .onboarding-avatar-ring').first()).toHaveCSS('border-top-color', 'rgba(0, 0, 0, 0)');
    await expect(page.locator('.personality-preview')).toHaveCount(0);
    await expect(page.locator('.first-run-next')).toBeInViewport();
    const layout = await page.locator('.first-run-tour').evaluate(element => ({
      width: element.clientWidth, scrollWidth: element.scrollWidth,
      people: Array.from(element.querySelectorAll('.onboarding-person')).map(person => {
        const rect = person.getBoundingClientRect(); return { left: rect.left, right: rect.right, top: rect.top };
      })
    }));
    expect(layout.scrollWidth).toBeLessThanOrEqual(layout.width);
    for (const person of layout.people) { expect(person.left).toBeGreaterThanOrEqual(0); expect(person.right).toBeLessThanOrEqual(width); }
    expect(new Set(layout.people.map(person => person.top)).size).toBe(1);
    await page.screenshot({ path: testInfo.outputPath(`personality-onboarding-${width}.png`) });
  });
}

for (const [name, id, gender] of [['Luca', 'local_insider', 'man'], ['Coco', 'travel_buddy', 'woman'], ['Miles', 'miles', 'prefer_not_to_say']] as const) {
  test(`onboarding saves ${name} through the existing profile API`, async ({ page, request }) => {
    const snapshot = await (await request.get('/api/workspace')).json();
    snapshot.profile = { ...snapshot.profile, status: 'incomplete', displayName: 'New explorer', assistantPersonality: 'local_insider' };
    await page.route('**/api/workspace', route => route.fulfill({ contentType: 'application/json', body: JSON.stringify(snapshot) }));
    await page.goto('/');
    await page.locator('.first-run-next').click();
    await page.locator('.first-run-next').click();
    await page.getByRole('textbox', { name: 'Name', exact: true }).fill('Alex');
    const genderSelect = page.getByRole('combobox', { name: 'Gender', exact: true });
    await expect(genderSelect.locator('option:not([disabled])')).toHaveText(['Man', 'Woman', 'Prefer not to say']);
    await genderSelect.selectOption(gender);
    await page.locator('.first-run-next').click();
    await page.getByRole('button', { name: new RegExp(`^Choose ${name}`) }).click();
    await page.locator('.first-run-tour').getByRole('button', { name: 'Next', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'Stay ahead of every change.' })).toBeVisible();
    await page.unroute('**/api/workspace');
    await page.reload();
    await expect(page.getByRole('heading', { name: 'Stay ahead of every change.' })).toBeVisible();
    await page.locator('.first-run-next').click();
    await page.locator('.first-run-next').click();
    await expect(page.locator('.first-run-tour')).toHaveCount(0);
    await expect.poll(async () => (await (await request.get('/api/workspace')).json()).profile.assistantPersonality).toBe(id);
    await page.unroute('**/api/workspace');
    await page.reload();
    await expect(page.locator('.first-run-tour')).toHaveCount(0);
    await page.getByRole('button', { name: 'Settings', exact: true }).click();
    await expect(page.locator('.personality-option.selected')).toContainText(name);
    await expect(page.getByRole('combobox', { name: 'Gender', exact: true })).toHaveValue(gender);
  });
}
