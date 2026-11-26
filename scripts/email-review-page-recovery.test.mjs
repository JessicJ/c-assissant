import assert from 'node:assert/strict';
import test from 'node:test';
import vm from 'node:vm';
import { emailReviewPage } from '../apps/server/src/email-review-page.ts';

// Actual page script, synthetic DOM/HTTP only; no server, database or SMTP.
class Element {
  children = []; text = ''; hidden = false; disabled = false; listeners = new Map();
  set textContent(value) { this.text = value; this.children = []; }
  get textContent() { return this.text + this.children.map(child => child.textContent ?? '').join(' '); }
  append(...children) { this.children.push(...children); }
  prepend(...children) { this.children.unshift(...children); }
  replaceChildren(...children) { this.text = ''; this.children = children; }
  addEventListener(event, callback) { this.listeners.set(event, callback); }
  click() { return this.listeners.get('click')?.(); }
}
const scope = { basePlanId: 'fictional-original', baseVersion: 2, draftPlanId: 'fictional-draft', draftVersion: 3, blueprintVersion: 4, recipientRevision: 1 };
const plan = { title: 'Fictional itinerary', assumptions: [], days: [] };
const view = (status = 'proposed') => ({ status, scope, original: plan, proposed: plan, impact: [], ...(status === 'confirmed' ? { confirmedAt: '2026-10-21T08:00:00Z' } : {}) });
const reply = (data, status = 200) => ({ ok: status < 400, status, json: async () => data });
async function page(respond) {
  const ids = Object.fromEntries(['status', 'content', 'actions', 'confirm', 'keep', 'check', 'error'].map(id => [id, new Element()]));
  ids.actions.hidden = true; ids.check.hidden = true; ids.confirm.disabled = true;
  const calls = [], location = { hash: '#token=synthetic-capability', pathname: '/email-review' };
  const document = { getElementById: id => ids[id], createElement: () => new Element(), createTextNode: text => ({ textContent: text }) };
  const fetch = async (url, options) => { const call = { url, ...options, body: JSON.parse(options.body) }; calls.push(call); return respond(call, calls.length); };
  const script = emailReviewPage('synthetic-nonce').match(/<script nonce="synthetic-nonce">([\s\S]*?)<\/script>/)[1];
  vm.runInNewContext(script, { document, location, history: { replaceState: () => { location.hash = ''; } }, URLSearchParams, fetch, Date });
  await new Promise(resolve => setImmediate(resolve));
  return { ids, calls, location, text: () => ids.status.textContent + ' ' + ids.error.textContent };
}

test('versions are visible and keeping the original performs no confirmation', async () => {
  const p = await page(() => reply(view()));
  assert.match(p.ids.content.textContent, /Version 2/);
  assert.match(p.ids.content.textContent, /Version 3 · Blueprint version 4/);
  await p.ids.keep.click();
  assert.equal(p.calls.length, 1);
  assert.equal(p.ids.actions.hidden, true);
});

test('network read failure retries with the in-memory capability after URL removal', async () => {
  const p = await page((_call, count) => { if (count === 1) throw new Error('synthetic interruption'); return reply(view()); });
  assert.equal(p.location.hash, '');
  assert.match(p.text(), /connection/);
  assert.doesNotMatch(p.text(), /expired|plan was not changed/i);
  assert.equal(p.ids.check.hidden, false);
  await p.ids.check.click();
  assert.equal(p.ids.actions.hidden, false);
  assert.equal(p.calls[1].headers.Authorization, 'Bearer synthetic-capability');
  assert.ok(p.calls.every(call => call.url === '/api/email-review/view'));
});

test('committed confirmation with a lost reply is recovered by reading, never resubmitting', async () => {
  let active = false;
  const p = await page(call => {
    if (call.url.endsWith('/confirm')) { active = true; throw new Error('synthetic lost reply'); }
    return reply(view(active ? 'confirmed' : 'proposed'));
  });
  await p.ids.confirm.click();
  assert.equal(p.ids.actions.hidden, true);
  assert.equal(p.ids.check.hidden, false);
  assert.doesNotMatch(p.text(), /confirmed and active|plan was not changed/);
  await p.ids.check.click();
  assert.match(p.text(), /confirmed and active/);
  assert.equal(p.ids.check.hidden, true);
  assert.equal(p.calls.filter(call => call.url.endsWith('/confirm')).length, 1);
  assert.deepEqual(p.calls[1].body, { confirmed: true, expectedPlanId: scope.draftPlanId, expectedVersion: 3, expectedBasePlanId: scope.basePlanId, expectedBaseVersion: 2, expectedBlueprintVersion: 4 });
  await p.ids.confirm.click();
  assert.equal(p.calls.length, 3);
});

test('failed status read after uncertain confirmation keeps the result unknown', async () => {
  const p = await page((_call, count) => { if (count > 1) throw new Error('synthetic interruption'); return reply(view()); });
  await p.ids.confirm.click();
  await p.ids.check.click();
  assert.match(p.text(), /couldn’t confirm whether/);
  assert.doesNotMatch(p.text(), /expired|plan was not changed|confirmed and active/);
  assert.equal(p.ids.actions.hidden, true);
  assert.equal(p.ids.check.hidden, false);
});

test('expired review hides confirmation without claiming the plan was unchanged', async () => {
  const p = await page(() => reply({}, 409));
  assert.match(p.text(), /expired or is no longer available/);
  assert.doesNotMatch(p.text(), /plan was not changed/);
  assert.equal(p.ids.actions.hidden, true);
  assert.equal(p.ids.check.hidden, true);
});

test('a pending proposal read permits explicit confirmation but never retries it automatically', async () => {
  const p = await page(call => { if (call.url.endsWith('/confirm')) throw new Error('synthetic interruption'); return reply(view()); });
  await p.ids.confirm.click();
  await p.ids.check.click();
  assert.equal(p.ids.actions.hidden, false);
  assert.equal(p.ids.confirm.disabled, false);
  assert.equal(p.calls.filter(call => call.url.endsWith('/confirm')).length, 1);
  assert.equal((p.ids.content.textContent.match(/Original itinerary/g) ?? []).length, 1);
});

test('malformed successful confirmation reply is not displayed as confirmed', async () => {
  const p = await page(call => reply(call.url.endsWith('/confirm') ? {} : view()));
  await p.ids.confirm.click();
  assert.match(p.text(), /not yet verified/);
  assert.doesNotMatch(p.text(), /confirmed and active/);
  assert.equal(p.ids.check.hidden, false);
});
