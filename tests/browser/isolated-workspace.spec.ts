import { test, expect, type Locator, type Page } from "@playwright/test";
import { randomUUID } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import path from "node:path";
import { pageEvidence } from "./page-evidence";

// 对真实隔离 Server 执行。普通浏览器套件不拥有此实例，不得隐式认领端口。
const workspaceUrl = process.env.LANDI_WORKSPACE_BASE_URL;
async function clickGuide(explore: Locator, name: RegExp) {
  const card = explore.getByRole("button", { name });
  await expect(card).toHaveCount(1);
  await card.click();
}
async function tabToImageSource(page: Page, summary: Locator, label: string) {
  await page.mouse.move(0, 0);
  const states = [];
  for (let step = 1; step <= 150; step++) {
    await page.keyboard.press("Tab");
    const state = await summary.evaluate((target) => {
      const active = document.activeElement;
      return { targetActive: active === target, focusVisible: target.matches(":focus-visible"), open: target.closest("details")?.hasAttribute("open") ?? null, activeTag: active?.tagName, activeLabel: active?.getAttribute("aria-label"), activeText: active?.textContent?.slice(0, 200) };
    });
    states.push({ step, ...state });
    if (state.targetActive) {
      await test.info().attach(`${label}键盘焦点遍历`, { body: JSON.stringify(states, null, 2), contentType: "application/json" });
      expect(state.open).toBe(false);
      expect(state.targetActive).toBe(true);
      expect(state.focusVisible).toBe(true);
      return;
    }
  }
  await test.info().attach(`${label}键盘焦点遍历失败`, { body: JSON.stringify(states, null, 2), contentType: "application/json" });
  expect(states.at(-1)?.targetActive, "有界Tab遍历未到达目标图片来源标记").toBe(true);
}
async function expectCurrentBlock(current: Locator, other: Locator) {
  await expect(current).toHaveAttribute("aria-current", "true");
  await expect(other).not.toHaveAttribute("aria-current", "true");
  await expect.poll(() => current.evaluate((element) => getComputedStyle(element).borderColor)).toBe("rgb(39, 133, 114)");
  await expect.poll(() => other.evaluate((element) => getComputedStyle(element).boxShadow.includes("39, 133, 114"))).toBe(false);
  const visual = (element: Element) => {
    const style = getComputedStyle(element);
    return { border: style.borderColor, background: style.backgroundColor, shadow: style.boxShadow };
  };
  const selected = await current.evaluate(visual);
  const unselected = await other.evaluate(visual);
  expect(selected).not.toEqual(unselected);
  expect(selected.shadow).not.toBe("none");
}
async function expectReadableSource(source: Locator, container: Locator) {
  await source.scrollIntoViewIfNeeded();
  await expect(source).toBeVisible();
  const bounds = await container.boundingBox();
  expect(bounds).not.toBeNull();
  const reading = await source.evaluate((element) => {
    const nodes = [element, ...element.querySelectorAll("a,span,small")];
    const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT);
    const lines: { left: number; right: number; top: number; bottom: number }[] = [];
    while (walker.nextNode()) {
      if (!walker.currentNode.textContent?.trim()) continue;
      const range = document.createRange();
      range.selectNodeContents(walker.currentNode);
      lines.push(...[...range.getClientRects()].map((rect) => ({ left: rect.left, right: rect.right, top: rect.top, bottom: rect.bottom })));
    }
    const visible = { left: 0, right: innerWidth, top: 0, bottom: innerHeight };
    for (let ancestor = element.parentElement; ancestor; ancestor = ancestor.parentElement) {
      const style = getComputedStyle(ancestor), rect = ancestor.getBoundingClientRect();
      if (/hidden|auto|scroll|clip/.test(style.overflowX)) { visible.left = Math.max(visible.left, rect.left); visible.right = Math.min(visible.right, rect.right); }
      if (/hidden|auto|scroll|clip/.test(style.overflowY)) { visible.top = Math.max(visible.top, rect.top); visible.bottom = Math.min(visible.bottom, rect.bottom); }
    }
    return { clipped: nodes.some((node) => node.scrollWidth > node.clientWidth + 1 && node.clientWidth > 0), lines, visible, viewportHeight: innerHeight };
  });
  expect(reading.clipped).toBe(false);
  expect(reading.lines.length).toBeGreaterThan(0);
  for (const line of reading.lines) {
    expect(line.left).toBeGreaterThanOrEqual(bounds!.x - 1);
    expect(line.right).toBeLessThanOrEqual(bounds!.x + bounds!.width + 1);
    expect(line.top).toBeGreaterThanOrEqual(Math.max(0, bounds!.y) - 1);
    expect(line.bottom).toBeLessThanOrEqual(Math.min(reading.viewportHeight, bounds!.y + bounds!.height) + 1);
    expect(line.left).toBeGreaterThanOrEqual(reading.visible.left - 1);
    expect(line.right).toBeLessThanOrEqual(reading.visible.right + 1);
    expect(line.top).toBeGreaterThanOrEqual(reading.visible.top - 1);
    expect(line.bottom).toBeLessThanOrEqual(reading.visible.bottom + 1);
  }
}
test.describe("旅行工作区真实持久闭环", () => {
  test.skip(!workspaceUrl, "需要主会话声明的真实隔离实例。");
  test.describe.configure({ mode: "serial" });
  test.beforeEach(async ({ page }) => {
    const workspaceOrigin = new URL(workspaceUrl!).origin;
    await page.route("**/*", (route) => {
      const url = route.request().url();
      return new URL(url).origin === workspaceOrigin ? route.continue() : route.abort();
    });
  });
  test.afterEach(async ({ page }, info) => {
    if (!page.isClosed() && page.url() !== 'about:blank') await pageEvidence(page, 'final');
  });

  test("主题比较、无地点、跨日返回与坏图文字", async ({ page }) => {
    await page.goto(workspaceUrl!);
    const explore = page.locator(".blueprint-explore-panel");
    await expect(page.getByRole("button", { name: /^(Whole trip|Current day)$/ })).toHaveCount(0);
    await expect(explore.getByRole("heading", { name: "Explore", exact: true })).toHaveCount(0);
    await expect(explore.getByRole("combobox")).toHaveCount(0);
    const photoCard = explore.locator(".blueprint-guide-card").filter({ has: page.getByRole("button", { name: /^海湾市场 Dining/ }) });
    await expect(photoCard).toHaveCount(1);
    await expect(photoCard.locator("img")).toBeVisible();
    const marker = photoCard.getByLabel("Image source", { exact: true });
    await marker.hover();
    await expect(marker.getByRole("tooltip")).toBeVisible();
    await expect(marker.getByRole("tooltip")).toContainText("Inspiration · recheck");
    await expectReadableSource(marker.getByRole("tooltip"), explore);
    await pageEvidence(page, 'source-hover');
    await tabToImageSource(page, marker, "浏览卡片");
    await expect(marker.getByRole("tooltip")).toBeVisible();
    await pageEvidence(page, 'source-focus');
    await expect(marker.getByRole("tooltip")).toContainText("Inspiration · recheck");
    await expectReadableSource(marker.getByRole("tooltip"), explore);
    await marker.click();
    await expect(photoCard.locator(".blueprint-image-source[open] > .blueprint-entry-sources")).toContainText("Inspiration");
    await expectReadableSource(photoCard.locator(".blueprint-image-source[open] > .blueprint-entry-sources"), explore);
    await clickGuide(explore, /^海湾茶点 Local food/);
    const detail = page.locator(".blueprint-detail-panel:not([hidden])");
    await expect(detail.getByRole("table")).toBeVisible();
    const options = detail.getByRole("rowgroup");
    await expect(options).toHaveCount(7);
    for (const width of [1440, 1920]) {
      await page.setViewportSize({ width, height: 900 });
      const layout = await options.first().locator('[role="row"]').first().evaluate((row) => {
        const action = row.querySelector('.blueprint-comparison-actions')!;
        const button = action.querySelector('button')!;
        const reference = row.children[5] as HTMLElement;
        const actionBox = action.getBoundingClientRect();
        const referenceBox = reference.getBoundingClientRect();
        const range = document.createRange(); range.selectNodeContents(button);
        return { buttonLines: range.getClientRects().length, buttonFits: button.scrollWidth <= button.clientWidth + 1, separate: referenceBox.right <= actionBox.left, label: getComputedStyle(reference, '::before').content };
      });
      expect(layout.buttonLines).toBe(1);
      expect(layout.buttonFits).toBe(true);
      expect(layout.separate).toBe(true);
      expect(layout.label).toContain('Reference');
    }

    await expect(options.getByRole("rowheader")).toHaveText(["海湾市场", "灯塔茶馆", "河畔食堂", "北岸餐厅", "桥头茶铺", "庭院点心", "海边小馆"]);
    await expect(detail.getByRole("button", { name: "Open", exact: true })).toHaveCount(7);
    for (const option of await options.all()) {
      await expectReadableSource(option.locator(".blueprint-comparison-evidence .blueprint-entry-sources").last(), detail);
    }
    await options.first().getByRole("button", { name: "Open", exact: true }).click();
    await expect(detail.getByRole("heading", { name: "海湾市场", exact: true })).toBeVisible();
    const longComparisonSource = detail.getByRole("rowgroup").first().locator(".blueprint-comparison-evidence .blueprint-entry-sources").last();
    await expect(longComparisonSource).toContainText("来源标题持续阅读至末尾");
    await expectReadableSource(longComparisonSource, detail);
    const detailMarker = detail.getByLabel("Image source", { exact: true });
    await tabToImageSource(page, detailMarker, "地点详情");
    await expect(detailMarker.getByRole("tooltip")).toContainText("Inspiration · recheck");
    await expectReadableSource(detailMarker.getByRole("tooltip"), detail);
    await detailMarker.press("Enter");
    await expectReadableSource(detail.locator(".blueprint-image-source[open] > .blueprint-entry-sources"), detail);
    await detail.getByRole("button", { name: "Back to explore" }).click();
    for (const [theme, names] of [
      [/^手作茶器 Local find/, ["海湾市场", "陶艺工坊"]],
      [/^手艺与市集体验 Experience/, ["海湾市场", "陶艺工坊"]]
    ] as const) {
      await clickGuide(explore, theme);
      await expect(detail.getByRole("rowgroup").getByRole("rowheader")).toHaveText([...names]);
      await expect(detail.getByRole("button", { name: "Open", exact: true })).toHaveCount(2);
      await detail.getByRole("button", { name: "Back to explore" }).click();
    }
    await clickGuide(explore, /^无地点的节令饮食 Local food/);
    await expect(detail.getByRole("button", { name: /Add to day|Remove from day/ })).toHaveCount(0);
    await detail.getByRole("button", { name: "Back to explore" }).click();
    await explore.getByRole("button", { name: "Shopping", exact: true }).click();
    await expect(explore.getByRole("button", { name: /^海湾市场 Shopping/ })).toHaveCount(1);
    const guideOrderBefore = await explore.locator(".blueprint-guide-card-main strong").allTextContents();
    const dayBefore = await page.locator(".blueprint-day-strip button.active").textContent();
    await clickGuide(explore, /^陶艺工坊 Shopping/);
    await expect(detail.getByRole("heading", { name: "陶艺工坊", exact: true })).toBeVisible();
    await detail.getByRole("button", { name: "Back to explore" }).click();
    await expect(page.locator(".blueprint-day-strip button.active")).toHaveText(dayBefore!);
    await expect(explore.locator(".blueprint-guide-card-main strong")).toHaveText(guideOrderBefore);
    await expect(explore.getByLabel("Explore order")).toHaveCount(0);
    await expect(explore.getByRole("button", { name: "Shopping", exact: true })).toHaveAttribute("aria-pressed", "true");
    await explore.getByRole("button", { name: "Shopping", exact: true }).click();
    await clickGuide(explore, /^灯塔茶馆 Dining/);
    await expect(detail.locator(".blueprint-detail-image img")).toHaveCount(0);
    await detail.locator(".blueprint-detail-sources > summary").click();
    await expect(detail.locator(".blueprint-detail-sources").getByText(/历史事实/)).toBeVisible();
    await page.screenshot({ path: test.info().outputPath("主题与来源.png"), fullPage: true });
    await pageEvidence(page, 'theme-and-source');
  });

  test("Tips 和 Guide 进入同一确认批次，刷新可回读且已保存编辑可撤销", async ({ page, request }) => {
    await page.goto(workspaceUrl!);
    const before = await (await request.get(`${workspaceUrl}/api/workspace`)).json();
    await page.getByRole("navigation", { name: "Plan workspace areas" }).getByRole("button", { name: "Tips", exact: true }).click();
    const tip = page.locator("#tip-fixture-tip-block");
    await tip.getByRole("button", { name: "Pin", exact: true }).click();
    await tip.getByRole("button", { name: "Hide", exact: true }).click();
    await tip.getByRole("button", { name: "Add to preparation", exact: true }).click();
    await expect(page.getByRole("toolbar", { name: "Unsaved itinerary edits" })).toContainText("3 unsaved changes");
    const staged = await (await request.get(`${workspaceUrl}/api/workspace`)).json();
    expect(staged.activeBlueprint.version).toBe(before.activeBlueprint.version);
    await page.getByRole("toolbar", { name: "Unsaved itinerary edits" }).getByRole("button", { name: "Apply", exact: true }).click();
    await expect(page.getByRole("button", { name: "Undo saved blueprint edit" })).toBeVisible();
    await page.reload();
    const saved = await (await request.get(`${workspaceUrl}/api/workspace`)).json();
    expect(saved.activeBlueprint.travelTips.find((item: { id: string }) => item.id === "fixture-tip-block")).toMatchObject({ pinned: true, hidden: true });
    expect(saved.activeBlueprint.preparationChecklist.some((item: { origin?: { kind: string; id: string } }) => item.origin?.kind === "tip" && item.origin.id === "fixture-tip-block")).toBeTruthy();
    await page.getByRole("button", { name: "Undo saved blueprint edit" }).click();
    await expect(page.getByRole("button", { name: "Undo saved blueprint edit" })).toHaveCount(0);
    const undone = await (await request.get(`${workspaceUrl}/api/workspace`)).json();
    expect(undone.activeBlueprint.version).toBe(saved.activeBlueprint.version + 1);
    expect(undone.activeBlueprint.travelTips.find((item: { id: string }) => item.id === "fixture-tip-block").hidden).not.toBe(true);
  });

  test("必访删除先展示真实影响，再确认保存及撤销", async ({ page, request }) => {
    await page.goto(workspaceUrl!);
    await clickGuide(page.locator(".blueprint-explore-panel"), /^海湾市场 Dining/);
    await page.locator(".blueprint-detail-panel:not([hidden])").getByRole("button", { name: "Remove from day", exact: true }).click();
    await page.getByRole("toolbar", { name: "Unsaved itinerary edits" }).getByRole("button", { name: "Apply", exact: true }).click();
    const review = page.getByRole("dialog", { name: "审阅本批重要修改" });
    await expect(review).toBeVisible();
    const before = await (await request.get(`${workspaceUrl}/api/workspace`)).json();
    expect(before.activeBlueprint.days[0].stops.some((stop: { placeId: string }) => stop.placeId === "fixture-place-1")).toBeTruthy();
    await review.getByRole("button", { name: "确认并保存本批修改" }).click();
    await expect(review).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Undo saved blueprint edit" })).toBeVisible();
    const saved = await (await request.get(`${workspaceUrl}/api/workspace`)).json();
    expect(saved.activeBlueprint.days[0].stops.some((stop: { placeId: string }) => stop.placeId === "fixture-place-1")).toBe(false);
    await page.getByRole("button", { name: "Undo saved blueprint edit" }).click();
    await page.reload();
    const undone = await (await request.get(`${workspaceUrl}/api/workspace`)).json();
    expect(undone.activeBlueprint.days[0].stops.some((stop: { placeId: string }) => stop.placeId === "fixture-place-1")).toBeTruthy();
  });

  test("块上下文切换及详情内跨日返回保留浏览状态", async ({ page }) => {
    await page.goto(workspaceUrl!);
    const explore = page.locator(".blueprint-explore-panel");
    await expect(page.getByRole("button", { name: /^(Whole trip|Current day)$/ })).toHaveCount(0);
    await expect(explore.getByRole("heading", { name: "Explore", exact: true })).toHaveCount(0);
    await expect(explore.getByRole("combobox")).toHaveCount(0);
    const detail = page.locator(".blueprint-detail-panel:not([hidden])");
    const blocks = page.locator(".blueprint-timeline-list .blueprint-itinerary-card-main");
    const marketBlock = blocks.filter({ has: page.getByText("海湾市场", { exact: true }) });
    await expect(marketBlock).toHaveCount(1);
    await marketBlock.click();
    await expect(detail.getByRole("heading", { name: "海湾市场", exact: true })).toBeVisible();
    await detail.getByRole("button", { name: "Back to explore" }).click();
    await expect(page.locator(".blueprint-explore-context")).toHaveCount(0);
    await expect(explore.locator(".blueprint-guide-card.selected strong").first()).toHaveText("海湾市场");
    const teaBlock = blocks.filter({ has: page.getByText("灯塔茶馆", { exact: true }) });
    await expect(teaBlock).toHaveCount(1);
    await expectCurrentBlock(marketBlock, teaBlock);
    await expect(marketBlock.locator("img")).toBeVisible();
    await expect(teaBlock.locator("img")).toHaveCount(0);
    await teaBlock.click();
    await expect(detail.getByRole("heading", { name: "灯塔茶馆", exact: true })).toBeVisible();
    await detail.getByRole("button", { name: "Back to explore" }).click();
    await expect(explore.locator(".blueprint-guide-card.selected strong").first()).toHaveText("灯塔茶馆");
    await expectCurrentBlock(teaBlock, marketBlock);
    await expect(page.locator(".blueprint-context-tip").filter({ hasText: "仅关联茶馆块的提示" })).toBeVisible();
    await explore.getByRole("button", { name: "Shopping", exact: true }).click();
    const guideOrderBefore = await explore.locator(".blueprint-guide-card-main strong").allTextContents();
    const dayBefore = await page.locator(".blueprint-day-strip button.active").textContent();
    await clickGuide(explore, /^陶艺工坊 Shopping/);
    await page.locator(".blueprint-day-strip").getByRole("button", { name: /^12-02 / }).click();
    await detail.getByRole("button", { name: "Back to explore" }).click();
    await expect(page.locator(".blueprint-day-strip button.active")).toHaveText(dayBefore!);
    await expect(explore.locator(".blueprint-guide-card-main strong")).toHaveText(guideOrderBefore);
    await expect(explore.getByLabel("Explore order")).toHaveCount(0);
    await expect(explore.getByRole("button", { name: "Shopping", exact: true })).toHaveAttribute("aria-pressed", "true");
    await expectCurrentBlock(teaBlock, marketBlock);
    await page.screenshot({ path: test.info().outputPath("块上下文与跨日返回.png"), fullPage: true });
    await pageEvidence(page, 'cross-day-return');
  });

  test("Guide 转准备、独立完成和第二轮待确认刷新恢复", async ({ page, request }) => {
    await page.goto(workspaceUrl!);
    const before = await (await request.get(`${workspaceUrl}/api/workspace`)).json();
    await clickGuide(page.locator(".blueprint-explore-panel"), /^陶艺工坊 Experiences/);
    await page.locator(".blueprint-detail-panel:not([hidden])").getByRole("button", { name: "Add to preparation" }).click();
    const bar = page.getByRole("toolbar", { name: "Unsaved itinerary edits" });
    await expect(bar).toContainText("1 unsaved changes");
    await bar.getByRole("button", { name: "Apply" }).click();
    await page.getByRole("navigation", { name: "Plan workspace areas" }).getByRole("button", { name: "Preparation", exact: true }).click();
    const checkbox = page.getByRole("checkbox", { name: /Complete 陶艺工坊/ });
    await expect(checkbox).toBeVisible();
    await checkbox.click();
    await expect(bar).toContainText("1 unsaved changes");
    const staged = await (await request.get(`${workspaceUrl}/api/workspace`)).json();
    expect(staged.activeBlueprint.preparationChecklist.find((item: { origin?: { id: string } }) => item.origin?.id === "fixture-place-3").completed).toBe(false);
    await page.reload();
    await expect(bar).toContainText("1 unsaved changes");
    await bar.getByRole("button", { name: "Apply" }).click();
    await page.getByRole("navigation", { name: "Plan workspace areas" }).getByRole("button", { name: "Preparation", exact: true }).click();
    await expect(checkbox).toBeChecked();
    const saved = await (await request.get(`${workspaceUrl}/api/workspace`)).json();
    const created = saved.activeBlueprint.preparationChecklist.find((item: { origin?: { kind: string; id: string } }) => item.origin?.kind === "place" && item.origin.id === "fixture-place-3");
    expect(created).toBeTruthy();
    expect(created.completed).toBe(true);
    expect(saved.activeBlueprint.version).toBe(before.activeBlueprint.version + 2);
    await page.screenshot({ path: test.info().outputPath("准备项与刷新恢复.png"), fullPage: true });
    await pageEvidence(page, 'preparation-recovery');
  });

  test("优先级及候选归档在取消前只属于待确认批次", async ({ page, request }) => {
    await page.goto(workspaceUrl!);
    const before = await (await request.get(`${workspaceUrl}/api/workspace`)).json();
    const explore = page.locator(".blueprint-explore-panel");
    await expect(page.getByRole("button", { name: /^(Whole trip|Current day)$/ })).toHaveCount(0);
    await expect(explore.getByRole("heading", { name: "Explore", exact: true })).toHaveCount(0);
    await expect(explore.getByRole("combobox")).toHaveCount(0);
    const detail = page.locator(".blueprint-detail-panel:not([hidden])");
    await clickGuide(explore, /^河畔食堂 Dining/);
    await detail.getByRole("button", { name: "Must go", exact: true }).click();
    await detail.getByRole("button", { name: "Keep for later", exact: true }).click();
    const bar = page.getByRole("toolbar", { name: "Unsaved itinerary edits" });
    await expect(bar).toBeVisible();
    const staged = await (await request.get(`${workspaceUrl}/api/workspace`)).json();
    expect(staged.activeBlueprint.version).toBe(before.activeBlueprint.version);
    await bar.getByRole("button", { name: "Cancel", exact: true }).click();
    await expect(bar).toHaveCount(0);
    await page.reload();
    const after = await (await request.get(`${workspaceUrl}/api/workspace`)).json();
    expect(after.activeBlueprint.version).toBe(before.activeBlueprint.version);
    expect(after.activeBlueprint.places.find((place: { id: string }) => place.id === "fixture-place-4").priority).toBe("preferred");
  });

  test("未关联选项不可打开，隐藏提示可恢复", async ({ page, request }) => {
    await page.goto(workspaceUrl!);
    await clickGuide(page.locator(".blueprint-explore-panel"), /^桥头茶铺 Dining/);
    const detail = page.locator(".blueprint-detail-panel:not([hidden])");
    const unknown = detail.getByRole("row").filter({ hasText: "未核实对象" });
    await expect(unknown).toHaveCount(1);
    await expect(unknown.getByRole("button", { name: /Open|Add/ })).toHaveCount(0);
    await page.getByRole("navigation", { name: "Plan workspace areas" }).getByRole("button", { name: "Tips", exact: true }).click();
    const tip = page.locator("#tip-fixture-tip-day");
    const bar = page.getByRole("toolbar", { name: "Unsaved itinerary edits" });
    await tip.getByRole("button", { name: "Hide", exact: true }).click();
    await bar.getByRole("button", { name: "Apply" }).click();
    await expect(bar).toHaveCount(0);
    await page.reload();
    await page.getByRole("navigation", { name: "Plan workspace areas" }).getByRole("button", { name: "Tips", exact: true }).click();
    await tip.getByRole("button", { name: "Restore", exact: true }).click();
    await bar.getByRole("button", { name: "Apply" }).click();
    const saved = await (await request.get(`${workspaceUrl}/api/workspace`)).json();
    expect(saved.activeBlueprint.travelTips.find((item: { id: string }) => item.id === "fixture-tip-day").hidden).toBe(false);
    await expect(tip.getByText("无来源时应保留未知，不伪造可信事实。")).toBeVisible();
  });

  test("其他保存生成同版本新 Plan 后，旧待确认批次保留并禁止提交", async ({ page, request }) => {
    await page.goto(workspaceUrl!);
    const before = await (await request.get(`${workspaceUrl}/api/workspace`)).json();
    await page.getByRole("navigation", { name: "Plan workspace areas" }).getByRole("button", { name: "Tips", exact: true }).click();
    const tip = page.locator("#tip-fixture-tip-day");
    await tip.getByRole("button", { name: "Pin", exact: true }).click();
    const bar = page.getByRole("toolbar", { name: "Unsaved itinerary edits" });
    await expect(bar).toContainText("1 unsaved changes");
    const response = await request.post(`${workspaceUrl}/api/plans/${before.activePlan.id}/blueprint-revisions/direct`, { data: {
      expectedVersion: before.activePlan.version,
      expectedBlueprintVersion: before.activeBlueprint.version,
      requestId: randomUUID(),
      revisions: [{ kind: "set_tip_state", tipId: "fixture-tip-block-only", pinned: true }]
    } });
    expect(response.status()).toBe(200);
    const updated = (await response.json()).workspace;
    expect(updated.activePlan.id).not.toBe(before.activePlan.id);
    expect(updated.activePlan.version).toBe(before.activePlan.version);
    await page.reload();
    await expect(bar).toContainText("1 unsaved changes");
    await expect(bar.getByRole("button", { name: "Apply", exact: true })).toBeDisabled();
    await bar.getByRole("button", { name: "Cancel", exact: true }).click();
    await expect(bar).toHaveCount(0);
    const after = await (await request.get(`${workspaceUrl}/api/workspace`)).json();
    expect(after.activePlan.id).toBe(updated.activePlan.id);
    expect(after.activeBlueprint.version).toBe(updated.activeBlueprint.version);
    expect(after.activeBlueprint.travelTips.find((item: { id: string }) => item.id === "fixture-tip-day").pinned).not.toBe(true);
    expect(after.activeBlueprint.travelTips.find((item: { id: string }) => item.id === "fixture-tip-block-only").pinned).toBe(true);
    await page.screenshot({ path: test.info().outputPath("过期待确认批次取消.png"), fullPage: true });
    await pageEvidence(page, 'stale-batch');
  });
  test("保存响应与回执暂不可用时保留原操作，刷新后按回执恢复", async ({ page, request }) => {
    await page.goto(workspaceUrl!);
    const before = await (await request.get(`${workspaceUrl}/api/workspace`)).json();
    await page.getByRole("navigation", { name: "Plan workspace areas" }).getByRole("button", { name: "Tips", exact: true }).click();
    await page.locator("#tip-fixture-tip-day").getByRole("button", { name: "Pin", exact: true }).click();
    const bar = page.getByRole("toolbar", { name: "Unsaved itinerary edits" });
    await page.route("**/blueprint-revisions/receipts/**", route => route.abort());
    await page.route("**/blueprint-revisions/direct", async route => { await route.fetch(); await route.abort(); }, { times: 1 });
    await bar.getByRole("button", { name: "Apply", exact: true }).click();
    await expect(page.getByRole("button", { name: "核对上次操作结果" })).toBeVisible();
    await expect(bar.getByRole("button", { name: "Apply", exact: true })).toBeDisabled();
    const committed = await (await request.get(`${workspaceUrl}/api/workspace`)).json();
    expect(committed.activeBlueprint.version).toBe(before.activeBlueprint.version + 1);
    await page.unroute("**/blueprint-revisions/receipts/**");
    await page.reload();
    await expect(page.getByRole("button", { name: "核对上次操作结果" })).toHaveCount(0);
    await expect(bar).toHaveCount(0);
    const recovered = await (await request.get(`${workspaceUrl}/api/workspace`)).json();
    expect(recovered.activeBlueprint.version).toBe(committed.activeBlueprint.version);
    expect(recovered.activeBlueprint.travelTips.find((item: { id: string }) => item.id === "fixture-tip-day").pinned).toBe(true);
  });

  test("真实事务回滚保留草稿并以原请求恢复", async ({ page, request, context }) => {
    await page.goto(workspaceUrl!);
    const databasePath = process.env.LANDI_TEST_SQLITE_PATH;
    if (!databasePath || !path.isAbsolute(databasePath)) throw new Error('须指定本次自有隔离 SQLite');
    const before = await (await request.get(`${workspaceUrl}/api/workspace`)).json();
    const readCounts = (requestId?: string) => {
      const db = new DatabaseSync(databasePath, { readOnly: true });
      try { return { versions: (db.prepare('SELECT COUNT(*) n FROM trip_blueprints').get() as { n: number }).n, edits: (db.prepare('SELECT COUNT(*) n FROM direct_blueprint_edits').get() as { n: number }).n, matching: requestId ? (db.prepare('SELECT COUNT(*) n FROM direct_blueprint_edits WHERE request_id = ?').get(requestId) as { n: number }).n : 0 }; }
      finally { db.close(); }
    };
    const snapshot = () => {
      const db = new DatabaseSync(databasePath, { readOnly: true });
      try {
        const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name").all() as { name: string }[];
        return Object.fromEntries(tables.map(({ name }) => [name, db.prepare(`SELECT * FROM "${name}" ORDER BY rowid`).all()]));
      } finally { db.close(); }
    };
    const baseline = readCounts();
    const beforeTables = snapshot();
    const tipBefore = before.activeBlueprint.travelTips.find((item: { id: string }) => item.id === 'fixture-tip-day').pinned === true;
    await page.getByRole('navigation', { name: 'Plan workspace areas' }).getByRole('button', { name: 'Tips', exact: true }).click();
    await page.locator('#tip-fixture-tip-day').getByRole('button', { name: tipBefore ? 'Unpin' : 'Pin', exact: true }).click();
    const bar = page.getByRole('toolbar', { name: 'Unsaved itinerary edits' });
    const control = await context.newPage();
    await control.goto(`${workspaceUrl}/__fixture/`);
    await control.getByRole('button', { name: '下一次保存真实回滚' }).click();
    await expect(control.locator('#result')).toContainText('rollback');
    const failedResponse = page.waitForResponse(response => response.url().endsWith('/blueprint-revisions/direct') && response.request().method() === 'POST');
    await bar.getByRole('button', { name: 'Apply', exact: true }).click();
    const failure = await failedResponse;
    expect(failure.status()).toBe(500);
    const failedBody = failure.request().postDataJSON();
    const state = await (await request.get(`${workspaceUrl}/__fixture/state`)).json();
    expect(state.captured.body).toEqual(failedBody);
    const after = await (await request.get(`${workspaceUrl}/api/workspace`)).json();
    expect(after.activeBlueprint.version).toBe(before.activeBlueprint.version);
    expect(readCounts(failedBody.requestId)).toEqual(baseline);
    expect(snapshot()).toEqual(beforeTables);
    await expect(bar).toContainText('1 unsaved changes');
    await expect(page.getByRole('button', { name: '重新提交原操作' })).toBeVisible();
    await expect(bar.getByRole('button', { name: 'Apply', exact: true })).toBeDisabled();
    await expect(page.locator('body')).not.toContainText('/private/fixture-only');
    await pageEvidence(page, 'rollback-unknown');
    await control.getByRole('button', { name: '解除故障' }).click();
    const receipt = page.waitForResponse(response => response.url().includes('/blueprint-revisions/receipts/') && response.request().method() === 'GET');
    await page.getByRole('button', { name: '核对上次操作结果' }).click();
    expect((await (await receipt).json()).status).toBe('not_found');
    await expect(page.getByRole('button', { name: '重新提交原操作' })).toBeEnabled();
    const retry = page.waitForResponse(response => response.url().endsWith('/blueprint-revisions/direct') && response.request().method() === 'POST');
    await page.getByRole('button', { name: '重新提交原操作' }).click();
    const success = await retry;
    expect(success.status()).toBe(200);
    expect(success.request().postDataJSON()).toEqual(failedBody);
    await expect.poll(() => readCounts(failedBody.requestId).matching).toBe(1);
    const committed = await (await request.get(`${workspaceUrl}/api/workspace`)).json();
    expect(committed.activeBlueprint.version).toBe(before.activeBlueprint.version + 1);
    expect(committed.activeBlueprint.travelTips.find((item: { id: string }) => item.id === 'fixture-tip-day').pinned === true).toBe(!tipBefore);
    expect(readCounts(failedBody.requestId)).toEqual({ versions: baseline.versions + 1, edits: baseline.edits + 1, matching: 1 });
    await pageEvidence(page, 'rollback-recovered');
    await page.reload();
    const reloaded = await (await request.get(`${workspaceUrl}/api/workspace`)).json();
    expect(reloaded.activeBlueprint.version).toBe(committed.activeBlueprint.version);
    expect(reloaded.activeBlueprint.travelTips.find((item: { id: string }) => item.id === 'fixture-tip-day').pinned === true).toBe(!tipBefore);
    await control.close();
  });

});
