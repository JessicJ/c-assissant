import { planningSaveReceipt } from "./planning-save-fixture";
import { test } from './evidence-test';
import { expect } from '@playwright/test';

test('保存回执丢失后刷新按原身份只读核对，不重发消息', async ({ page }) => {
  let revision = 1, saves = 0, allowSaveRead = false;
  let session = { id: 'fictional-session', status: 'collecting', objectiveType: 'travel', messages: [{ id: 'existing', role: 'user', text: 'Tokyo', createdAt: '2026-08-25T00:00:00Z' }], facts: [], unresolved: [], deferred: [], createdAt: '2026-08-25T00:00:00Z', updatedAt: '2026-08-25T00:00:00Z' };
  const plan = { id: 'starter', version: 1, title: 'Attend an exhibition in Shanghai', location: 'Shanghai', dates: 'To be confirmed', status: 'draft', knownInformation: [], assumptions: [], nextAction: 'Create a plan', createdAt: '2026-08-25T00:00:00Z', configuration: { accommodation: { status: 'not_set' } }, stages: [], sources: [] };
  const workspace = () => ({ profile: { status: 'ready', displayName: 'Tester', preferredLanguage: 'English', nationality: 'Singapore', gender: 'prefer_not_to_say', immigrationStatus: 'short_term_visitor' }, runtime: { selectedKind: 'codex' }, inbox: [], destinationArrivals: [], activePlan: plan, planningSession: session });
  const requests: any[] = [], unexpected: string[] = [];
  let statusStarted!: () => void, releaseStatus!: () => void;
  const statusSeen = new Promise<void>(resolve => { statusStarted = resolve; });
  const statusRelease = new Promise<void>(resolve => { releaseStatus = resolve; });
  let firstStatus = true;
  await page.route('**/api/**', async route => {
    const url = new URL(route.request().url()), path = url.pathname;
    if (path === '/api/workspace') return route.fulfill({ json: workspace() });
    if (path === '/api/plans/history' || path === '/api/runtimes') return route.fulfill({ json: [] });
    if (path === '/api/configuration') return route.fulfill({ json: {} });
    if (path.includes('/bookings')) return route.fulfill({ json: { bookings: [] } });
    if (path === '/api/planning-sessions/fictional-session/revision') return route.fulfill({ json: { revision } });
    if (path === '/api/agent-readiness' || path.endsWith('/return-check')) return route.fulfill({ status: 503, json: {} });
    if (path.startsWith('/api/planning-messages/')) {
      const original = requests.find(request => path.includes(encodeURIComponent(request.messageId)));
      if (!allowSaveRead || !original) return route.fulfill({ status: 404, json: { requirementsSaved: null, executable: false } });
      return route.fulfill({ json: { schemaVersion: 1, sessionId: session.id, messageId: original.messageId, observedAt: new Date().toISOString(), executable: false, requirementsSaved: true,
        saveReceipt: { sessionId: session.id, messageId: original.messageId, expectedRevision: original.expectedRevision, savedRevision: original.expectedRevision + 1 }, inputSha256: url.searchParams.get('inputSha256'), planningRevision: revision } });
    }
    if (path.endsWith('/status')) {
      if (firstStatus) {
        firstStatus = false; statusStarted(); await statusRelease;
        return route.fulfill({ json: { schemaVersion: 1, sessionId: 'fictional-session', messageId: 'existing', observedAt: new Date().toISOString(), executable: false, requirementsSaved: true, saveReceipt: { sessionId: 'fictional-session', messageId: 'existing', expectedRevision: 0, savedRevision: 1 }, planningRevision: 1, localWork: null } });
      }
      return route.fulfill({ status: 404, json: {} });
    }
    if (path === '/api/agent/chat') {
      const body = route.request().postDataJSON(); requests.push(body);
      if (!session.messages.some(message => message.id === body.messageId)) {
        saves++; revision++; session = { ...session, messages: [...session.messages, { id: body.messageId, role: 'user', text: body.message, createdAt: '2026-08-25T00:00:01Z' }] };
      }
      if (requests.length === 1) return route.abort('failed');
      return route.fulfill({ json: { ...planningSaveReceipt(route, session), workspace: workspace(), planningSession: session, planningRevision: revision, generated: false, blocked: false } });
    }
    unexpected.push(`${route.request().method()} ${path}`); return route.abort('failed');
  });
  const revisionResponse = () => page.waitForResponse(response => new URL(response.url()).pathname === '/api/planning-sessions/fictional-session/revision');
  let ready = revisionResponse(); await page.goto('/'); await ready;
  const input = page.getByPlaceholder('Chat with Landi');
  await statusSeen; await input.fill('A quiet fictional trip'); releaseStatus();
  await expect(page.getByLabel('Planning availability')).toContainText('Your requirements have not been saved to the server.');
  await expect(page.getByLabel('Planning availability')).toContainText('Previously submitted requirements: Requirements saved. No processing task is recorded.');
  await page.getByRole('button', { name: 'Send', exact: true }).click();
  await expect(input).toHaveValue('A quiet fictional trip');
  await expect(page.locator('.inline-alert')).toBeVisible();
  await expect(page.getByLabel('Planning availability')).toContainText('original save is still unverified');
  await expect(page.getByLabel('Planning availability')).not.toContainText('have not been saved');
  expect(requests).toHaveLength(1); expect(saves).toBe(1);
  allowSaveRead = true;
  ready = revisionResponse(); await page.reload(); await ready;
  await expect(input).toHaveValue('');
  expect(requests).toHaveLength(1); expect(saves).toBe(1);
  await expect.poll(() => page.evaluate(() => localStorage.getItem('landi.conversation.new_plan.new:pending-message'))).toBeNull();
  await expect(page.locator('.planning-session-panel .conversation').getByText('A quiet fictional trip', { exact: true })).toHaveCount(1);
  ready = revisionResponse(); await page.reload(); await ready;
  await expect(input).toHaveValue('');
  await expect(page.locator('.planning-session-panel .conversation').getByText('A quiet fictional trip', { exact: true })).toHaveCount(1);
  expect(requests).toHaveLength(1); expect(saves).toBe(1); expect(unexpected).toEqual([]);
});
