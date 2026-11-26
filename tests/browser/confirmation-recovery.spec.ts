import { test } from './evidence-test';
import { expect } from '@playwright/test';
for (const scenario of ['committed', 'retry', 'changed'] as const) test(`confirmation readback: ${scenario}`, async ({ page }) => {
  const plan = { id: 'fictional-plan', version: 3, title: 'Fictional trip', location: 'Tokyo', dates: '2026-11-15', status: 'draft', knownInformation: [], assumptions: [], nextAction: 'Review', createdAt: '2026-08-25T00:00:00Z', configuration: { accommodation: { status: 'not_set' } }, stages: [], sources: [] };
  let current = { profile: { status: 'ready', displayName: 'Tester', preferredLanguage: 'English', nationality: 'Singapore', gender: 'prefer_not_to_say', immigrationStatus: 'short_term_visitor' }, runtime: { selectedKind: 'codex' }, inbox: [], destinationArrivals: [], sourceSnapshots: [], system: { core: "ready", storage: "local", runtime: "configured" }, activePlan: plan };
  const events: string[] = [], bodies: any[] = [], unexpected: string[] = [];
  await page.route('**/api/**', async route => {
    const path = new URL(route.request().url()).pathname, method = route.request().method();
    if (path === '/api/workspace') { events.push('GET'); return route.fulfill({ json: current }); }
    if (path === '/api/plans/history' || path === '/api/runtimes') return route.fulfill({ json: [] });
    if (path === '/api/configuration') return route.fulfill({ json: {} });
    if (path === '/api/plans/fictional-plan/confirm' && method === 'POST') {
      events.push('POST'); bodies.push(route.request().postDataJSON());
      if (bodies.length === 1) { if (scenario === 'committed') current = { ...current, activePlan: { ...plan, status: 'active' } }; return route.abort('failed'); }
      current = { ...current, activePlan: { ...plan, status: 'active' } }; return route.fulfill({ json: current });
    }
    unexpected.push(`${method} ${path}`); return route.abort('failed');
  });
  await page.goto('/');
  const confirm = page.getByRole('button', { name: 'Confirm and activate' });
  await confirm.click();
  if (scenario === 'committed') {
    await expect(confirm).toHaveCount(0);
    await page.reload(); await expect(confirm).toHaveCount(0);
    expect(bodies).toHaveLength(1);
  } else {
    await expect(page.locator('.inline-alert')).toContainText('confirmation result is still unknown');
    expect(bodies).toHaveLength(1);
    if (scenario === 'changed') current = { ...current, activePlan: { ...plan, version: 4 } };
    const before = events.length;
    await confirm.click();
    if (scenario === 'retry') {
      await expect.poll(() => bodies.length).toBe(2);
      await expect(confirm).toHaveCount(0);
      expect(events.slice(before)).toEqual(['GET', 'POST']);
      expect(bodies).toHaveLength(2); expect(bodies[1]).toEqual(bodies[0]);
    } else {
      await expect(page.locator('.inline-alert')).toContainText('Review the latest plan before confirming');
      expect(events.slice(before)).toEqual(['GET']); expect(bodies).toHaveLength(1);
    }
  }
  expect(bodies[0]).toMatchObject({ expectedVersion: 3 }); expect(unexpected).toEqual([]);
});
