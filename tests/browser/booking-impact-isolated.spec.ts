import { test, expect, type Page } from '@playwright/test';
import { existsSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { DatabaseSync } from 'node:sqlite';
import { randomUUID } from 'node:crypto';
import { pageEvidence } from './page-evidence';

test.skip(process.env.LANDI_BOOKING_IMPACT_E2E !== '1' || !process.env.LANDI_WORKSPACE_BASE_URL, '仅连接调用方明确启动的自有隔离实例。');

async function openSoftTarget(page: Page) {
  const target = page.locator('.blueprint-explore-panel:visible').getByRole('button', { name: /^软关联目标 Dining(?:\s| ·)/ });
  await expect(target).toHaveCount(1);
  await target.click();
  await expect(page.locator('.blueprint-detail-panel:not([hidden])').getByRole('heading', { name: '软关联目标', exact: true })).toBeVisible();
}

async function pageCheckpoint(page: Page, name: string) {
  await pageEvidence(page, name);
  const directory = process.env.LANDI_NATIVE_OBSERVE_DIR;
  if (!directory) return;
  if (!path.isAbsolute(directory)) throw new Error('原生观察目录须为绝对路径');
  await page.bringToFront();
  const browser = page.context().browser();
  writeFileSync(path.join(directory, `${name}.ready`), JSON.stringify({ checkpoint: name, scenario: process.env.LANDI_BOOKING_SCENARIO, createdAt: new Date().toISOString(), url: page.url(), workerPid: process.pid, browserVersion: browser?.version(), executable: browser?.browserType().executablePath(), headless: test.info().project.use.headless }, null, 2));
  for (let count = 0; count < 1200; count++) {
    if (existsSync(path.join(directory, `${name}.observed`))) return;
    await delay(100);
  }
  throw new Error('原生窗口观察未在限时内完成');
}
test.afterEach(async ({ page }) => {
  if (!page.isClosed() && page.url() !== 'about:blank') await pageEvidence(page, 'final');
});
async function restartCheckpoint() {
  const directory = process.env.LANDI_RESTART_CONTROL_DIR;
  if (!directory || !path.isAbsolute(directory)) throw new Error('历史场景须由隔离 runner 提供重启控制目录');
  writeFileSync(path.join(directory, 'restart.ready'), '请求重启本次自有服务');
  for (let count = 0; count < 500; count++) {
    if (existsSync(path.join(directory, 'restart.completed'))) return;
    await delay(100);
  }
  throw new Error('本次自有服务未在限时内重启');
}

test('真实界面从未知审阅到关系保存、精确确认与撤销', async ({ page, request }) => {
  test.skip(process.env.LANDI_BOOKING_SCENARIO !== 'booking-relationships', '需要普通预订关系隔离夹具。');
  test.setTimeout(process.env.LANDI_NATIVE_OBSERVE_DIR ? 480_000 : 180_000);
  const origin = new URL(process.env.LANDI_WORKSPACE_BASE_URL!).origin;
  await page.route('**/*', route => new URL(route.request().url()).origin === origin ? route.continue() : route.abort());
  await page.goto('/');
  const before = await (await request.get('/api/workspace')).json();
  expect(before.activeBlueprint.bookingRelationshipAssessment).toBeFalsy();
  await openSoftTarget(page);
  await page.locator('.blueprint-detail-panel:not([hidden])').getByRole('button', { name: 'Remove from day', exact: true }).click();
  const bar = page.getByRole('toolbar', { name: 'Unsaved itinerary edits' });
  const impact = page.getByRole('dialog', { name: '审阅本批重要修改' });
  await expect(bar).toContainText('1 unsaved changes');
  await page.getByRole('navigation', { name: 'Plan workspace areas' }).getByRole('button', { name: 'Bookings', exact: true }).click();
  await page.getByRole('button', { name: '审阅或更正预订关联' }).click();
  const panel = page.getByRole('region', { name: '审阅预订关联' });
  await expect(panel).toBeVisible();
  const units = panel.locator('.booking-review-unit');
  await expect(units).toHaveCount(4);
  for (const unit of await units.all()) await expect(unit.getByLabel('审阅范围')).toHaveValue('unknown');
  await page.screenshot({ path: test.info().outputPath('初始关系未知.png'), fullPage: true });
  await pageCheckpoint(page, 'unknown-assessment');
  const first = units.filter({ has: page.getByRole('heading', { name: /虚构双分段凭证.*虚构凭证首日场次/ }) });
  await first.getByRole('button', { name: '建立关联' }).click();
  const relationship = first.locator('fieldset').first();
  await relationship.getByRole('checkbox', { name: /软关联目标.*第 1 次出现/ }).check();
  await relationship.getByLabel('关联理由').fill('虚构凭证与此具体安排有关');
  await relationship.getByLabel('关联来源').fill('旅行者声明');
  await first.getByRole('button', { name: '建立关联' }).click();
  const globalRelation = first.locator('fieldset').nth(1);
  await globalRelation.getByLabel('关系范围').selectOption('place_global');
  await globalRelation.getByRole('checkbox', { name: /同日双次旅馆.*All occurrences/ }).check();
  await globalRelation.getByLabel('关联理由').fill('本人声明与旅馆各次出现有关');
  await globalRelation.getByLabel('关联来源').fill('旅行者声明');
  await first.getByRole('button', { name: '建立关联' }).click();
  const dependency = first.locator('fieldset').nth(2);
  await dependency.getByLabel('关系范围').selectOption('dependency');
  await dependency.getByRole('checkbox', { name: /同日双次旅馆.*第 2 次出现/ }).check();
  await dependency.getByRole('checkbox', { name: /同日双次旅馆.*第 1 次出现/ }).nth(1).check();
  await dependency.getByRole('checkbox', { name: /跨日无关目标 → 同日双次旅馆/ }).check();
  await dependency.getByLabel('关联理由').fill('本人核对跨日地点和交通的明确依赖');
  await dependency.getByLabel('关联来源').fill('旅行者声明');
  const fixedUnit = units.filter({ has: page.getByRole('heading', { name: /虚构固定双分段凭证.*固定凭证首日场次/ }) });
  await fixedUnit.getByRole('button', { name: '建立关联' }).click();
  const fixedRelation = fixedUnit.locator('fieldset').first();
  await fixedRelation.getByLabel('业务作用').selectOption('direct_commitment');
  await fixedRelation.getByRole('checkbox', { name: /独立固定目标.*第 1 次出现/ }).check();
  await fixedRelation.getByLabel('关联理由').fill('本人确认此目标是固定凭证的直接承诺');
  await fixedRelation.getByLabel('关联来源').fill('旅行者声明');
  for (const unit of await units.all()) {
    await unit.getByLabel('审阅范围').selectOption('complete');
    await unit.getByLabel('本项判断理由').fill('已逐项核对全部地点、交通和跨日依赖');
    await unit.getByLabel('本项来源').fill('旅行者声明');
    await unit.getByRole('checkbox', { name: /我已核对/ }).check();
  }
  await panel.getByLabel('整体审阅理由').fill('已核对所有虚构预订及完整行程');
  await panel.getByLabel('整体审阅来源').fill('旅行者声明');
  await page.screenshot({ path: test.info().outputPath('关系审阅.png'), fullPage: true });
  await pageCheckpoint(page, 'relationship-review');
  await panel.getByRole('button', { name: '单独保存关联审阅' }).click();
  await expect(panel).toHaveCount(0);
  const reviewed = await (await request.get('/api/workspace')).json();
  expect(reviewed.activeBlueprint.bookingRelationshipAssessment.status).toBe('reviewed');
  expect(reviewed.activeBlueprint.bookingRelationshipAssessment.units.some((unit: { relations: unknown[] }) => unit.relations.length > 0)).toBe(true);
  expect(reviewed.activeBlueprint.bookingRelationshipAssessment.units.flatMap((unit: { relations: { scope: string }[] }) => unit.relations).map((relation: { scope: string }) => relation.scope)).toEqual(expect.arrayContaining(['occurrence', 'place_global', 'dependency']));
  await expect(bar).toContainText('1 unsaved changes');
  const previewResponse = page.waitForResponse(response => response.url().includes('/blueprint-revisions/direct') && response.request().method() === 'POST');
  await bar.getByRole('button', { name: 'Apply', exact: true }).click();
  const preview = await previewResponse;
  const oldPreviewBody = await preview.json();
  const oldRequest = preview.request().postDataJSON();
  expect(oldRequest.revisions).toEqual(expect.arrayContaining([expect.objectContaining({ kind: 'remove_place_from_day', placeId: 'fixture-place-1', dayId: 'fixture-day-1' })]));
  await expect(impact.getByRole('heading', { name: '已知受影响' })).toBeVisible();
  await expect(impact.getByText('当前审阅没有未决项。')).toBeVisible();
  // 在真实预览已经出现后，仅对后续确认响应注入故障；不执行该次保存。
  expect(oldPreviewBody.impact.bookingImpact.affected.length).toBeGreaterThan(0);
  const faults: [string, (body: any) => void][] = [
    ['missing-context', body => { delete body.impact.sourceContext; }],
    ['wrong-plan', body => { body.impact.sourceContext.planId = '错误的虚构计划'; }],
    ['wrong-blueprint', body => { body.impact.sourceContext.blueprintId = '错误的虚构蓝图'; }],
    ['missing-coverage', body => {
      body.impact.bookingImpact.affected = [];
      body.impact.bookingConstraintIds = [];
    }]
  ];
  for (const [name, damage] of faults) {
    const invalid = structuredClone(oldPreviewBody);
    damage(invalid);
    await page.route('**/blueprint-revisions/direct', route => route.fulfill({ status: preview.status(), contentType: 'application/json', body: JSON.stringify(invalid) }), { times: 1 });
    await impact.getByRole('button', { name: '确认并保存本批修改' }).click();
    await expect(impact).toHaveCount(0);
    await expect(bar).toContainText('1 unsaved changes');
    await pageEvidence(page, `invalid-${name}`);
    const fresh = page.waitForResponse(response => response.url().includes('/blueprint-revisions/direct') && response.request().method() === 'POST');
    await bar.getByRole('button', { name: 'Apply', exact: true }).click();
    expect((await fresh).status()).toBe(preview.status());
    await expect(impact.getByRole('button', { name: '确认并保存本批修改' })).toBeVisible();
  }
  await pageEvidence(page, 'valid-preview-recovered');
  await impact.getByRole('button', { name: '确认并保存本批修改' }).click();
  await expect(page.getByRole('button', { name: 'Undo saved blueprint edit' })).toBeVisible();
  await pageCheckpoint(page, 'relationship-saved');
  await page.reload();
  const saved = await (await request.get('/api/workspace')).json();
  expect(saved.activeBlueprint.days[0].stops.some((stop: { placeId: string }) => stop.placeId === 'fixture-place-1')).toBe(false);
  const undoResponse = page.waitForResponse(response => response.url().includes('/blueprint-revisions/') && response.url().endsWith('/undo') && response.request().method() === 'POST');
  await page.getByRole('button', { name: 'Undo saved blueprint edit' }).click();
  expect((await undoResponse).status()).toBe(200);
  await expect.poll(async () => {
    const current = await (await request.get('/api/workspace')).json();
    return current.activeBlueprint.version > saved.activeBlueprint.version && current.activeBlueprint.days[0].stops.some((stop: { placeId: string }) => stop.placeId === 'fixture-place-1');
  }).toBe(true);
  await pageEvidence(page, 'undo-committed');
  await page.reload();
  const undone = await (await request.get('/api/workspace')).json();
  expect(undone.activeBlueprint.days[0].stops.some((stop: { placeId: string }) => stop.placeId === 'fixture-place-1')).toBe(true);
  await page.locator('.blueprint-day-strip').getByRole('button', { name: /^12-02 / }).click();
  for (const name of ['已预订目标', '独立预约目标', '独立固定目标']) {
    await expect(page.getByRole('complementary', { name: 'Daily itinerary cards' }).getByRole('button', { name: `Move ${name}`, exact: true })).toHaveCount(0);
    await page.locator('.blueprint-explore-panel').getByRole('button', { name: new RegExp(`^${name} `) }).click();
    const detail = page.locator('.blueprint-detail-panel:not([hidden])');
    await expect(detail.getByRole('button', { name: 'Fixed booking' })).toBeDisabled();
    for (const action of ['Must go', 'Prefer', 'Nearby', 'Keep for later']) {
      await expect(detail.locator('.blueprint-detail-priorities').getByRole('button', { name: action, exact: true })).toBeDisabled();
    }
    await page.screenshot({ path: test.info().outputPath(`${name}保护.png`), fullPage: true });
    await pageEvidence(page, `fixed-protection-${['已预订目标', '独立预约目标', '独立固定目标'].indexOf(name) + 1}`);
    await detail.getByRole('button', { name: 'Back to explore' }).click();
  }
  await page.getByRole('navigation', { name: 'Plan workspace areas' }).getByRole('button', { name: 'Bookings', exact: true }).click();
  await page.getByRole('button', { name: '审阅或更正预订关联' }).click();
  await expect(panel.locator('.booking-review-unit')).toHaveCount(4);
  const revisedUnit = panel.locator('.booking-review-unit').filter({ has: page.getByRole('heading', { name: /虚构双分段凭证.*虚构凭证首日场次/ }) });
  const revisedRelation = revisedUnit.locator('fieldset').first();
  await revisedRelation.getByRole('checkbox', { name: /软关联目标.*第 1 次出现/ }).uncheck();
  await revisedRelation.getByRole('checkbox', { name: /同日双次旅馆.*第 1 次出现/ }).first().check();
  await revisedRelation.getByLabel('关联理由').fill('本人更正为首日旅馆的具体出现');
  for (const unit of await panel.locator('.booking-review-unit').all()) await unit.getByRole('checkbox', { name: /我已核对/ }).check();
  await panel.getByLabel('整体审阅理由').fill('更正具体出现并重新核对全部行程');
  await panel.getByLabel('整体审阅来源').fill('旅行者声明');
  await panel.getByRole('button', { name: '单独保存关联审阅' }).click();
  await expect(panel).toHaveCount(0);
  const corrected = await (await request.get('/api/workspace')).json();
  expect(corrected.activeBlueprint.version).toBeGreaterThan(reviewed.activeBlueprint.version);
  const softUnit = corrected.activeBlueprint.bookingRelationshipAssessment.units.find((unit: { segmentId?: string }) => unit.segmentId?.includes('fixture-source-soft-first'));
  expect(softUnit.relations.find((relation: { scope: string }) => relation.scope === 'occurrence').targets[0]).toMatchObject({ dayId: 'fixture-day-1', blockId: 'fixture-block-2', placeId: 'fixture-place-2' });
  const databasePath = process.env.LANDI_TEST_SQLITE_PATH;
  if (!databasePath || !path.isAbsolute(databasePath)) throw new Error('须指定本次自有隔离 SQLite');
  const database = new DatabaseSync(databasePath, { readOnly: true });
  try {
    const historical = database.prepare('SELECT content_json FROM trip_blueprints WHERE id = ? AND version = ?').get(reviewed.activeBlueprint.id, reviewed.activeBlueprint.version) as { content_json: string };
    expect(JSON.parse(historical.content_json).bookingRelationshipAssessment).toEqual(reviewed.activeBlueprint.bookingRelationshipAssessment);
  } finally { database.close(); }
  const stale = await request.post(preview.url(), { data: { ...oldRequest, requestId: randomUUID(), highImpactConfirmation: oldPreviewBody.impact.id } });
  expect(stale.status()).toBe(409);
  await page.getByRole('navigation', { name: 'Plan workspace areas' }).getByRole('button', { name: 'Itinerary', exact: true }).click();
  await page.locator('.blueprint-day-strip').getByRole('button', { name: /^12-01 / }).click();
  await openSoftTarget(page);
  await page.locator('.blueprint-detail-panel:not([hidden])').getByRole('button', { name: 'Remove from day', exact: true }).click();
  await bar.getByRole('button', { name: 'Apply', exact: true }).click();
  const unaffected = impact.locator('section').filter({ has: page.getByRole('heading', { name: '已知不受影响' }) });
  await expect(unaffected.getByText('虚构双分段凭证').first()).toBeVisible();
  await impact.getByRole('button', { name: 'Cancel batch' }).click();
});

test('旧固定来源逐预订逐分段映射，错误结构拒绝后独立审阅', async ({ page, request }) => {
  test.skip(process.env.LANDI_BOOKING_SCENARIO !== 'legacy-booking-sources', '需要旧固定来源隔离夹具。');
  test.setTimeout(process.env.LANDI_NATIVE_OBSERVE_DIR ? 240_000 : 120_000);
  const origin = new URL(process.env.LANDI_WORKSPACE_BASE_URL!).origin;
  await page.route('**/*', route => new URL(route.request().url()).origin === origin ? route.continue() : route.abort());
  await page.goto('/');
  const before = await (await request.get('/api/workspace')).json();
  expect(before.activeBlueprint.bookingRelationshipAssessment).toBeFalsy();
  await page.getByRole('navigation', { name: 'Plan workspace areas' }).getByRole('button', { name: 'Bookings', exact: true }).click();
  await page.getByRole('button', { name: '审阅或更正预订关联' }).click();
  const panel = page.getByRole('region', { name: '审阅预订关联' });
  await expect(panel.getByText('先恢复原预订来源')).toBeVisible();
  const bindings = panel.locator('.booking-source-binding');
  await expect(bindings).toHaveCount(2);
  await expect(bindings.first()).toContainText('历史未单独记录');
  const choose = async (index: number, source: string, firstSegment: string, secondSegment: string) => {
    const binding = bindings.nth(index);
    await binding.locator('select').first().selectOption(source);
    await binding.locator('select').nth(1).selectOption(firstSegment);
    await binding.locator('select').nth(2).selectOption(secondSegment);
    await binding.locator('textarea').fill('本人逐项核对原始资料');
    await binding.locator('input').fill('旅行者声明');
  };
  await choose(0, 'fixture-source-soft', 'fixture-source-soft-first', 'fixture-source-soft-second');
  await choose(1, 'fixture-source-legacy-second', 'fixture-source-legacy-second-first', 'fixture-source-legacy-second-second');
  await page.screenshot({ path: test.info().outputPath('旧来源结构不等价.png'), fullPage: true });
  const rejected = page.waitForResponse(response => response.url().includes('/blueprint-revisions/direct') && response.request().method() === 'POST');
  await panel.getByRole('button', { name: '保存所选原预订并重新核对' }).click();
  expect((await rejected).status()).toBe(409);
  const afterReject = await (await request.get('/api/workspace')).json();
  expect(afterReject.activeBlueprint.version).toBe(before.activeBlueprint.version);
  await panel.getByRole('checkbox', { name: /虚构双分段凭证 · 旅行者虚构验收声明/ }).uncheck();
  await choose(0, 'fixture-source-fixed', 'fixture-source-fixed-first', 'fixture-source-fixed-second');
  await page.screenshot({ path: test.info().outputPath('旧来源逐段映射.png'), fullPage: true });
  await pageCheckpoint(page, 'legacy-binding');
  const accepted = page.waitForResponse(response => response.url().includes('/blueprint-revisions/direct') && response.request().method() === 'POST');
  await panel.getByRole('button', { name: '保存所选原预订并重新核对' }).click();
  expect((await accepted).status()).toBe(200);
  const selected = await (await request.get('/api/workspace')).json();
  expect(selected.activeBlueprint.bookingRelationshipAssessment).toBeFalsy();
  await expect(panel.locator('.booking-review-unit')).toHaveCount(4);
  for (const unit of await panel.locator('.booking-review-unit').all()) {
    await unit.getByLabel('审阅范围').selectOption('complete');
    await unit.getByLabel('本项判断理由').fill('逐项核对全部直接、间接及跨日依赖后明确无关联');
    await unit.getByLabel('本项来源').fill('旅行者声明');
    await unit.getByRole('checkbox', { name: /明确没有关联/ }).check();
  }
  await panel.getByLabel('整体审阅理由').fill('本人完整核对所有虚构预订及行程');
  await panel.getByLabel('整体审阅来源').fill('旅行者声明');
  await panel.getByRole('button', { name: '单独保存关联审阅' }).click();
  await expect(panel).toHaveCount(0);
  const reviewed = await (await request.get('/api/workspace')).json();
  expect(reviewed.activeBlueprint.bookingRelationshipAssessment.status).toBe('reviewed');
  expect(reviewed.activeBlueprint.bookingRelationshipAssessment.units.every((unit: { coverage: string; relations: unknown[] }) => unit.coverage === 'complete' && unit.relations.length === 0)).toBe(true);
});

for (const [scenario, label] of [['empty-source-snapshot', '空快照来源义务'], ['missing-source-snapshot', '缺失快照来源义务']] as const) {
  test(`${label}逐项纳入并独立审阅`, async ({ page, request }) => {
    test.skip(process.env.LANDI_BOOKING_SCENARIO !== scenario, '需要对应的历史隔离夹具。');
    test.setTimeout(process.env.LANDI_NATIVE_OBSERVE_DIR ? 480_000 : 180_000);
    const origin = new URL(process.env.LANDI_WORKSPACE_BASE_URL!).origin;
    await page.route('**/*', route => new URL(route.request().url()).origin === origin ? route.continue() : route.abort());
    await page.goto('/');
    let workspace = await (await request.get('/api/workspace')).json();
    expect(workspace.activeBlueprint.bookingRelationshipAssessment).toBeFalsy();
    const getContext = async () => (await request.get(`/api/plans/${workspace.activePlan.id}/booking-relationship-review`)).json();
    let context = await getContext();
    expect(context.pendingSourceBookingIds).toHaveLength(2);
    await openSoftTarget(page);
    await page.locator('.blueprint-detail-panel:not([hidden])').getByRole('button', { name: 'Remove from day', exact: true }).click();
    const bar = page.getByRole('toolbar', { name: 'Unsaved itinerary edits' });
    await page.route('**/blueprint-revisions/direct', async route => {
      expect(route.request().postDataJSON().revisions).toEqual(expect.arrayContaining([expect.objectContaining({ kind: 'remove_place_from_day', placeId: 'fixture-place-1', dayId: 'fixture-day-1' })]));
      const response = await route.fetch();
      const body = await response.json();
      if (!body.impact?.bookingImpact?.unknown?.some((item: { kind: string }) => item.kind === 'source_obligation')) throw new Error('夹具缺少待纳入来源义务');
      body.impact.bookingImpact.unknown = body.impact.bookingImpact.unknown.filter((item: { kind: string }) => item.kind !== 'source_obligation');
      await route.fulfill({ response, json: body });
    }, { times: 1 });
    await bar.getByRole('button', { name: 'Apply', exact: true }).click();
    const impact = page.getByRole('dialog', { name: '审阅本批重要修改' });
    await expect(impact).toHaveCount(0);
    await expect(bar).toContainText('1 unsaved changes');
    await pageEvidence(page, `${scenario}-missing-source-coverage`);
    await bar.getByRole('button', { name: 'Apply', exact: true }).click();
    await expect(impact.getByRole('heading', { name: '尚待核对' })).toBeVisible();
    await expect(impact.getByRole('button', { name: '确认并保存本批修改' })).toHaveCount(0);
    // 使用真实待纳入来源响应，检验畸形集合不能留下上一次合法未决预览。
    await page.route('**/blueprint-revisions/direct', async route => {
      const response = await route.fetch();
      const body = await response.json();
      expect(body.impact.sourceContext.pendingSources.length).toBeGreaterThan(0);
      expect(body.impact.bookingImpact.unknown.some((item: { kind: string }) => item.kind === 'source_obligation')).toBe(true);
      body.impact.bookingImpact.unknown = [null];
      await route.fulfill({ response, json: body });
    }, { times: 1 });
    await bar.getByRole('button', { name: 'Apply', exact: true }).click();
    await expect(impact).toHaveCount(0);
    await expect(bar).toContainText('1 unsaved changes');
    await pageEvidence(page, `${scenario}-null-unknown`);
    await bar.getByRole('button', { name: 'Apply', exact: true }).click();
    await expect(impact.getByRole('heading', { name: '尚待核对' })).toBeVisible();
    await expect(impact.getByRole('button', { name: '确认并保存本批修改' })).toHaveCount(0);
    await pageCheckpoint(page, `${scenario}-unknown`);
    await impact.getByRole('button', { name: '审阅或更正预订关联' }).click();
    const panel = page.getByRole('region', { name: '审阅预订关联' });
    await panel.getByRole('checkbox', { name: /虚构双分段凭证 · 旅行者虚构验收声明/ }).check();
    await panel.getByRole('button', { name: '保存所选原预订并重新核对' }).click();
    await expect.poll(async () => (await (await request.get('/api/workspace')).json()).activeBlueprint.version).toBe(workspace.activeBlueprint.version + 1);
    workspace = await (await request.get('/api/workspace')).json();
    context = await getContext();
    expect(context.pendingSourceBookingIds).toEqual(['fixture-source-fixed']);
    const softSource = panel.locator('article').filter({ has: page.getByRole('checkbox', { name: '虚构双分段凭证 · 旅行者虚构验收声明', exact: true }) });
    const fixedSource = panel.locator('article').filter({ has: page.getByRole('checkbox', { name: '虚构固定双分段凭证 · 旅行者虚构验收声明', exact: true }) });
    await expect(softSource).toHaveCount(1);
    await expect(softSource.getByRole('checkbox')).toBeDisabled();
    await expect(softSource.getByText('Used by this version')).toBeVisible();
    await expect(fixedSource).toHaveCount(1);
    await expect(fixedSource.getByRole('checkbox')).toBeEnabled();
    await expect(fixedSource.getByText('Saved and awaiting review')).toBeVisible();
    await page.screenshot({ path: test.info().outputPath(`${scenario}-部分来源.png`), fullPage: true });
    await pageCheckpoint(page, `${scenario}-partial`);
    const secondPage = await page.context().newPage();
    await secondPage.route('**/*', route => new URL(route.request().url()).origin === origin ? route.continue() : route.abort());
    await secondPage.goto('/');
    await secondPage.getByRole('navigation', { name: 'Plan workspace areas' }).getByRole('button', { name: 'Tips', exact: true }).click();
    await secondPage.locator('#tip-fixture-tip-day').getByRole('button', { name: 'Pin', exact: true }).click();
    await secondPage.getByRole('toolbar', { name: 'Unsaved itinerary edits' }).getByRole('button', { name: 'Apply', exact: true }).click();
    await expect(secondPage.getByRole('button', { name: 'Undo saved blueprint edit' })).toBeVisible();
    await secondPage.close();
    await restartCheckpoint();
    await page.reload();
    workspace = await (await request.get('/api/workspace')).json();
    context = await getContext();
    expect(context.pendingSourceBookingIds).toEqual(['fixture-source-fixed']);
    await expect(bar).toContainText('1 unsaved changes');
    await page.getByRole('navigation', { name: 'Plan workspace areas' }).getByRole('button', { name: 'Bookings', exact: true }).click();
    await page.getByRole('button', { name: '审阅或更正预订关联' }).click();
    await panel.getByRole('checkbox', { name: /虚构固定双分段凭证 · 旅行者虚构验收声明/ }).check();
    await panel.getByRole('button', { name: '保存所选原预订并重新核对' }).click();
    await expect(panel.locator('.booking-review-unit')).toHaveCount(4);
    for (const unit of await panel.locator('.booking-review-unit').all()) {
      await unit.getByLabel('审阅范围').selectOption('complete');
      await unit.getByLabel('本项判断理由').fill('逐项核对所有直接、间接及跨日依赖后明确无关联');
      await unit.getByLabel('本项来源').fill('旅行者声明');
      await unit.getByRole('checkbox', { name: /明确没有关联/ }).check();
    }
    await panel.getByLabel('整体审阅理由').fill('全部虚构来源与行程已经完整核对');
    await panel.getByLabel('整体审阅来源').fill('旅行者声明');
    await panel.getByRole('button', { name: '单独保存关联审阅' }).click();
    await expect(panel).toHaveCount(0);
    await page.getByRole('button', { name: '按当前行程重新审阅原修改' }).click();
    await page.getByRole('button', { name: '我已逐项核对，重新预览原修改' }).click();
    await bar.getByRole('button', { name: 'Apply', exact: true }).click();
    await expect(impact.getByText('当前审阅没有未决项。')).toBeVisible();
    await pageCheckpoint(page, `${scenario}-reviewed`);
    await impact.getByRole('button', { name: '确认并保存本批修改' }).click();
    await expect(page.getByRole('button', { name: 'Undo saved blueprint edit' })).toBeVisible();
    workspace = await (await request.get('/api/workspace')).json();
    expect(workspace.activeBlueprint.days[0].stops.some((stop: { placeId: string }) => stop.placeId === 'fixture-place-1')).toBe(false);
  });
}

test('关系保存响应丢失时保留原草稿并只读回执恢复', async ({ page, request }) => {
  test.skip(process.env.LANDI_BOOKING_SCENARIO !== 'booking-relationships', '需要普通预订关系隔离夹具。');
  const origin = new URL(process.env.LANDI_WORKSPACE_BASE_URL!).origin;
  await page.route('**/*', route => new URL(route.request().url()).origin === origin ? route.continue() : route.abort());
  await page.goto('/');
  const before = await (await request.get('/api/workspace')).json();
  await openSoftTarget(page);
  await page.locator('.blueprint-detail-panel:not([hidden])').getByRole('button', { name: 'Remove from day', exact: true }).click();
  const bar = page.getByRole('toolbar', { name: 'Unsaved itinerary edits' });
  await page.getByRole('navigation', { name: 'Plan workspace areas' }).getByRole('button', { name: 'Bookings', exact: true }).click();
  await page.getByRole('button', { name: '审阅或更正预订关联' }).click();
  const panel = page.getByRole('region', { name: '审阅预订关联' });
  const units = panel.locator('.booking-review-unit');
  await expect(units).toHaveCount(4);
  for (const unit of await units.all()) {
    await unit.getByLabel('本项判断理由').fill('本项保留未知，尚需核对');
    await unit.getByLabel('本项来源').fill('旅行者声明');
    await unit.getByRole('checkbox', { name: /仍有尚未核对/ }).check();
  }
  await panel.getByLabel('整体审阅理由').fill('保留未知及原待确认编辑');
  await panel.getByLabel('整体审阅来源').fill('旅行者声明');
  let posts = 0;
  page.on('request', request => { if (request.method() === 'POST' && request.url().includes('/blueprint-revisions/direct')) posts++; });
  await page.route('**/blueprint-revisions/receipts/**', route => route.abort());
  await page.route('**/blueprint-revisions/direct', async route => { await route.fetch(); await route.abort(); }, { times: 1 });
  await panel.getByRole('button', { name: '单独保存关联审阅' }).click();
  await expect(page.getByRole('button', { name: '核对上次操作结果' })).toBeVisible();
  await pageEvidence(page, 'lost-response-unknown');
  expect(posts).toBe(1);
  const committed = await (await request.get('/api/workspace')).json();
  expect(committed.activeBlueprint.version).toBe(before.activeBlueprint.version + 1);
  await page.unroute('**/blueprint-revisions/receipts/**');
  await page.reload();
  await expect(bar).toContainText('1 unsaved changes');
  await expect(page.getByRole('button', { name: '核对上次操作结果' })).toHaveCount(0);
  await pageEvidence(page, 'lost-response-recovered');
  const recovered = await (await request.get('/api/workspace')).json();
  expect(recovered.activeBlueprint.version).toBe(committed.activeBlueprint.version);
  expect(posts).toBe(1);
  await page.screenshot({ path: test.info().outputPath('关系保存丢响应恢复.png'), fullPage: true });
});

test('优先级未知与未排程地点的准确影响范围', async ({ page, request }) => {
  test.skip(process.env.LANDI_BOOKING_SCENARIO !== 'booking-priority', '需要软预订优先级隔离夹具。');
  test.setTimeout(process.env.LANDI_NATIVE_OBSERVE_DIR ? 360_000 : 180_000);
  const origin = new URL(process.env.LANDI_WORKSPACE_BASE_URL!).origin;
  await page.route('**/*', route => new URL(route.request().url()).origin === origin ? route.continue() : route.abort());
  await page.goto('/');
  await page.locator('.blueprint-explore-panel').getByRole('button', { name: /^同日双次旅馆 / }).click();
  await page.locator('.blueprint-detail-panel:not([hidden])').getByRole('button', { name: 'Must go', exact: true }).click();
  const bar = page.getByRole('toolbar', { name: 'Unsaved itinerary edits' });
  await bar.getByRole('button', { name: 'Apply', exact: true }).click();
  const impact = page.getByRole('dialog', { name: '审阅本批重要修改' });
  await expect(impact.getByRole('heading', { name: '尚待核对' })).toBeVisible();
  await expect(impact.getByRole('button', { name: '确认并保存本批修改' })).toHaveCount(0);
  const exactDates = await page.evaluate(() => ['2026-12-01', '2026-12-02'].map(date => new Date(`${date}T12:00:00`).toLocaleDateString()).join('，'));
  await expect(impact.getByText(/^受影响日期：/)).toHaveText(`受影响日期：${exactDates}`);
  await pageCheckpoint(page, 'priority-unknown');
  await impact.getByRole('button', { name: '审阅或更正预订关联' }).click();
  const panel = page.getByRole('region', { name: '审阅预订关联' });
  const units = panel.locator('.booking-review-unit');
  await expect(units).toHaveCount(2);
  const first = units.first();
  await first.getByRole('button', { name: '建立关联' }).click();
  const relation = first.locator('fieldset').first();
  await relation.getByLabel('关系范围').selectOption('place_global');
  await relation.getByRole('checkbox', { name: /同日双次旅馆.*All occurrences/ }).check();
  await relation.getByLabel('关联理由').fill('本人核对旅馆全部出现及优先级');
  await relation.getByLabel('关联来源').fill('旅行者声明');
  for (const unit of await units.all()) {
    await unit.getByLabel('审阅范围').selectOption('complete');
    await unit.getByLabel('本项判断理由').fill('已核对全部直接间接及跨日依赖');
    await unit.getByLabel('本项来源').fill('旅行者声明');
    await unit.getByRole('checkbox', { name: /我已核对/ }).check();
  }
  await panel.getByLabel('整体审阅理由').fill('已完整核对旅馆与预订');
  await panel.getByLabel('整体审阅来源').fill('旅行者声明');
  await panel.getByRole('button', { name: '单独保存关联审阅' }).click();
  await expect(panel).toHaveCount(0);
  await expect(bar).toContainText('1 unsaved changes');
  await bar.getByRole('button', { name: 'Apply', exact: true }).click();
  await expect(impact.getByText(/^受影响日期：/)).toHaveText(`受影响日期：${exactDates}`);
  await expect(impact.getByRole('heading', { name: '已知受影响' })).toBeVisible();
  await impact.getByRole('button', { name: '确认并保存本批修改' }).click();
  const saved = await (await request.get('/api/workspace')).json();
  expect(saved.activeBlueprint.places.find((place: { id: string }) => place.id === 'fixture-place-2').priority).toBe('must');
  await page.getByRole('navigation', { name: 'Plan workspace areas' }).getByRole('button', { name: 'Bookings', exact: true }).click();
  await page.getByRole('button', { name: '审阅或更正预订关联' }).click();
  const rechecked = panel.locator('.booking-review-unit');
  await expect(rechecked).toHaveCount(2);
  await rechecked.first().getByRole('button', { name: '建立关联' }).click();
  const global = rechecked.first().locator('fieldset').last();
  await global.getByLabel('关系范围').selectOption('place_global');
  await global.getByRole('checkbox', { name: /无关软候选.*All occurrences/ }).check();
  await global.getByLabel('关联理由').fill('本人确认未排程地点整体与此预订有关');
  await global.getByLabel('关联来源').fill('旅行者声明');
  for (const unit of await rechecked.all()) await unit.getByRole('checkbox', { name: /我已核对/ }).check();
  await panel.getByLabel('整体审阅理由').fill('重新核对未排程地点的明确关系');
  await panel.getByLabel('整体审阅来源').fill('旅行者声明');
  await panel.getByRole('button', { name: '单独保存关联审阅' }).click();
  await expect(panel).toHaveCount(0);
  await page.getByRole('navigation', { name: 'Plan workspace areas' }).getByRole('button', { name: 'Itinerary', exact: true }).click();
  await page.locator('.blueprint-explore-panel').getByRole('button', { name: /^无关软候选 / }).click();
  await page.locator('.blueprint-detail-panel:not([hidden])').getByRole('button', { name: 'Keep for later', exact: true }).click();
  await bar.getByRole('button', { name: 'Apply', exact: true }).click();
  await expect(impact).toContainText('这些地点当前未安排到任何日期');
  await expect(impact.getByRole('heading', { name: '已知受影响' })).toBeVisible();
  await pageCheckpoint(page, 'priority-unscheduled');
  await impact.getByRole('button', { name: '确认并保存本批修改' }).click();
  const archived = await (await request.get('/api/workspace')).json();
  expect(archived.activeBlueprint.places.find((place: { id: string }) => place.id === 'fixture-place-7').priority).toBe('archive');
  await page.getByRole('navigation', { name: 'Plan workspace areas' }).getByRole('button', { name: 'Bookings', exact: true }).click();
  await page.getByRole('button', { name: '审阅或更正预订关联' }).click();
  await expect(panel.locator('.booking-review-unit')).toHaveCount(2);
  for (const unit of await panel.locator('.booking-review-unit').all()) {
    while (await unit.getByRole('button', { name: '移除此关联' }).count()) await unit.getByRole('button', { name: '移除此关联' }).first().click();
    await unit.getByLabel('审阅范围').selectOption('complete');
    await unit.getByLabel('本项判断理由').fill('逐项核对全部目标及跨日依赖，明确没有关联');
    await unit.getByLabel('本项来源').fill('旅行者声明');
    await unit.getByRole('checkbox', { name: /明确没有关联/ }).check();
  }
  await panel.getByLabel('整体审阅理由').fill('完整核对全部预订与所有地点，明确没有关联');
  await panel.getByLabel('整体审阅来源').fill('旅行者声明');
  await panel.getByRole('button', { name: '单独保存关联审阅' }).click();
  await expect(panel).toHaveCount(0);
  const unlinked = await (await request.get('/api/workspace')).json();
  expect(unlinked.activeBlueprint.bookingRelationshipAssessment.units.every((unit: { coverage: string; relations: unknown[] }) => unit.coverage === 'complete' && unit.relations.length === 0)).toBe(true);
  await page.getByRole('navigation', { name: 'Plan workspace areas' }).getByRole('button', { name: 'Itinerary', exact: true }).click();
  await page.locator('.blueprint-explore-panel').getByRole('button', { name: /^额外无关目标 / }).click();
  await page.locator('.blueprint-detail-panel:not([hidden])').getByRole('button', { name: 'Keep for later', exact: true }).click();
  await bar.getByRole('button', { name: 'Apply', exact: true }).click();
  await expect(bar).toHaveCount(0);
  await expect(impact).toHaveCount(0);
  const knownSafe = await (await request.get('/api/workspace')).json();
  expect(knownSafe.activeBlueprint.places.find((place: { id: string }) => place.id === 'fixture-place-8').priority).toBe('archive');
});
