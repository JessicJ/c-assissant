import { expect, test } from "@playwright/test";

test("an incomplete travel draft has direct retry and inline discard recovery", async ({ page }) => {
  const starter = {
    id: "incomplete-trip", version: 1, title: "Paris proposal trip", location: "Paris", dates: "2026-10-06 to 2026-10-17", status: "draft",
    knownInformation: ["Dates and flights confirmed"], assumptions: [], nextAction: "Generate the itinerary.", createdAt: "2026-08-19T00:00:00.000Z",
    configuration: { accommodation: { status: "not_set" }, arrival: {}, transport: { preference: "taxi" }, travelContext: { partySize: 2 } },
    stages: [{ id: "trip", title: "Trip", description: "Paris trip", status: "not_started", presentationKind: "itinerary", tasks: [] }], sources: [],
    presentation: { kind: "timeline", summary: "Paris trip", items: [] }
  };
  const workspace = { profile: { status: "ready", displayName: "Tester", preferredLanguage: "简体中文", nationality: "United States", gender: "prefer_not_to_say", immigrationStatus: "short_term_visitor" }, runtime: { selectedKind: "codex" }, inbox: [], destinationArrivals: [], activePlan: starter };
  await page.route("**/api/workspace", (route) => route.fulfill({ contentType: "application/json", body: JSON.stringify(workspace) }));
  await page.route("**/api/plans/history", (route) => route.fulfill({ contentType: "application/json", body: "[]" }));
  await page.route("**/api/configuration", (route) => route.fulfill({ contentType: "application/json", body: JSON.stringify({ amap: { configured: false }, qweather: { configured: false, host: "" }, telegram: { configured: false } }) }));
  await page.route("**/api/runtimes", (route) => route.fulfill({ contentType: "application/json", body: "[]" }));
  await page.route("**/api/agent/chat", async (route) => {
    await new Promise((resolve) => setTimeout(resolve, 120));
    await route.fulfill({ status: 504, contentType: "application/json", body: JSON.stringify({ error: "生成超时，请再次尝试。" }) });
  });

  await page.goto("/");
  await expect(page.getByRole("button", { name: "Create mapped itinerary" })).toBeVisible();
  await page.getByRole("button", { name: "Create mapped itinerary" }).click();
  await expect(page.getByRole("button", { name: "Creating itinerary…" })).toBeDisabled();
  await expect(page.getByRole("button", { name: "＋ Creating" })).toBeDisabled();
  await expect(page.getByText("生成超时，请再次尝试。", { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Generate again" })).toBeEnabled();
  await expect(page.getByRole("dialog")).toHaveCount(0);

  await page.getByRole("button", { name: "Discard this plan" }).click();
  await expect(page.getByRole("button", { name: "Keep plan" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Confirm discard" })).toBeVisible();
  await page.getByRole("button", { name: "Keep plan" }).click();
  await expect(page.getByRole("button", { name: "Discard this plan" })).toBeVisible();
});

test("Plan History hides an open planning conversation and Plan restores it", async ({ page }) => {
  const starter = {
    id: "starter", version: 1, title: "Attend an exhibition in Shanghai", location: "Shanghai", dates: "To be confirmed", status: "draft",
    knownInformation: [], assumptions: [], nextAction: "Create a plan.", createdAt: "2026-08-25T00:00:00.000Z",
    configuration: { accommodation: { status: "not_set" } }, stages: [], sources: []
  };
  const workspace = { profile: { status: "ready", displayName: "Tester", preferredLanguage: "English", nationality: "United States", gender: "prefer_not_to_say", immigrationStatus: "no_visa" }, runtime: { selectedKind: "codex" }, inbox: [], destinationArrivals: [], activePlan: starter };
  await page.route("**/api/workspace", (route) => route.fulfill({ contentType: "application/json", body: JSON.stringify(workspace) }));
  await page.route("**/api/plans/history", (route) => route.fulfill({ contentType: "application/json", body: "[]" }));
  await page.route("**/api/configuration", (route) => route.fulfill({ contentType: "application/json", body: "{}" }));
  await page.route("**/api/runtimes", (route) => route.fulfill({ contentType: "application/json", body: "[]" }));

  await page.goto("/");
  await page.getByRole("button", { name: "Start a conversation" }).click();
  const conversation = page.getByRole("region", { name: "Tell Landi your goal" });
  await expect(conversation).toBeVisible();

  await page.getByRole("button", { name: "Plan History", exact: true }).click();
  await expect(page.getByRole("heading", { name: "No archived plans yet" })).toBeVisible();
  await expect(conversation).toHaveCount(0);

  await page.getByRole("button", { name: "Plan", exact: true }).click();
  await expect(conversation).toBeVisible();
});

test("a new Plan confirms direction before collecting generation-critical facts", async ({ page }) => {
  test.skip(!process.env.LANDI_LIVE_AGENT_E2E, "requires an authenticated live Codex runtime");
  const pageErrors: string[] = [];
  page.on("pageerror", (error) => pageErrors.push(error.message));

  await page.goto("/");
  await expect(page.getByRole("dialog", { name: "先让 Landi 了解你" })).toBeVisible();
  await page.getByRole("textbox", { name: "希望 Landi 如何称呼你 必填" }).fill("Browser test user");
  await page.getByRole("textbox", { name: "国籍 必填" }).fill("Singapore");
  await page.getByRole("combobox", { name: "性别 请选择；可以选择不愿透露" }).selectOption("prefer_not_to_say");
  await page.getByRole("combobox", { name: "当前来华身份 必填，用于匹配适用的官方信息" }).selectOption("short_term_visitor");
  await page.getByRole("button", { name: "保存并开始使用" }).click();

  await page.getByRole("button", { name: "开始对话" }).click();
  const dialog = page.getByRole("dialog", { name: "告诉 Landi 你的目标" });
  await expect(dialog).toBeVisible();
  await expect(dialog.locator("form")).toHaveCount(0);
  const input = dialog.getByPlaceholder("例如：我想在葡萄牙旅行 10 天，重点看建筑和当地生活…");
  await input.fill("我想去葡萄牙旅行10天，主要看建筑和当地生活，预算适中。我从上海出发，抵达里斯本机场，航班预计当地时间10月12日14:30到达。");
  await dialog.getByRole("button", { name: "发送" }).click();

  const proposal = dialog.locator(".planning-proposal");
  await expect(proposal.getByText("PLAN PROPOSAL · V1")).toBeVisible();
  await expect(proposal.getByText("地点：葡萄牙；时间：10天", { exact: false })).toBeVisible();
  await expect(page.getByRole("button", { name: "确认计划方向" })).toHaveCount(1);
  await expect(page.getByText("PLANNING SESSION", { exact: true })).toHaveCount(0);

  await input.fill("改成7天，节奏轻松一些");
  await dialog.getByRole("button", { name: "发送" }).click();
  await expect(proposal.getByText("PLAN PROPOSAL · V2")).toBeVisible();
  await expect(proposal.getByText("地点：葡萄牙；时间：7天", { exact: false })).toBeVisible();
  await expect(page.getByRole("button", { name: "确认计划方向" })).toHaveCount(1);

  await page.getByRole("button", { name: "确认计划方向" }).click();
  await expect(page.getByRole("button", { name: "继续补充关键信息" })).toBeDisabled();

  await input.fill("2026年10月12日至10月18日，3个人出行，交通倾向于打车；从上海出发，抵达里斯本机场，预计14:30到达；返程从里斯本机场预计18:20离开");
  await dialog.getByRole("button", { name: "发送" }).click();
  await expect(dialog.getByText(/生成正式 Plan 所需的信息已经完整/)).toBeVisible();
  await expect(page.getByRole("button", { name: "生成完整 Plan" })).toBeEnabled();

  await dialog.getByRole("button", { name: "关闭", exact: true }).click();
  await expect(page.getByText("PLANNING SESSION", { exact: true })).toBeVisible();
  await expect(page.getByText("PLAN PROPOSAL · V2")).toBeVisible();
  await expect(page.getByRole("button", { name: "生成完整 Plan" })).toHaveCount(1);

  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.getByText("PLAN PROPOSAL · V2")).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  expect(pageErrors).toEqual([]);
});

test("an itinerary Plan renders the Skill-native interactive result inside Landi", async ({ page }) => {
  const pageErrors: string[] = [];
  page.on("pageerror", (error) => pageErrors.push(error.message));
  await page.route("**/api/workspace", async (route) => route.fulfill({ contentType: "application/json", body: JSON.stringify({
    profile: { status: "ready", displayName: "Trip tester", preferredLanguage: "简体中文", nationality: "Singapore", gender: "prefer_not_to_say", immigrationStatus: "short_term_visitor" },
    runtime: { selectedKind: "codex" }, inbox: [],
    activePlan: {
      id: "native-trip", version: 1, title: "里斯本建筑与街区生活", location: "里斯本", dates: "2026-10-12 至 2026-10-13", status: "draft", knownInformation: ["两天建筑与当地生活"], assumptions: [], nextAction: "审阅并确认计划。", createdAt: "2026-08-17T00:00:00.000Z",
      configuration: { accommodation: { status: "not_set" }, arrival: {}, transport: { preference: "plan_recommended" }, travelContext: { partySize: 3, luggage: "light" } }, stages: [], sources: [],
      presentation: {
        kind: "itinerary", summary: "里斯本建筑与街区生活", language: "zh-CN", startDate: "2026-10-12", endDate: "2026-10-13", cities: ["里斯本"],
        days: [
          { id: "d1", label: "10 月 12 日", shortLabel: "10/12", city: "里斯本", title: "河岸建筑与旧城方向感", summary: "从河岸进入旧城，只保留一座重型主锚点。", anchors: ["belem"], candidates: ["market"], placeIds: ["belem", "alfama"], stops: [{ placeId: "belem", order: 1, time: "09:30" }, { placeId: "alfama", order: 2, time: "15:30" }], routeReview: { sequenceRationale: "上午先看需要集中精力的建筑，下午顺着同一方向进入旧城。", fixedConstraints: ["修道院上午入场"] } },
          { id: "d2", label: "10 月 13 日", shortLabel: "10/13", city: "里斯本", title: "街区生活与当代空间", summary: "用市场、咖啡和社区空间组成较轻的一天。", anchors: ["lx"], candidates: [], placeIds: ["lx"], stops: [{ placeId: "lx", order: 1, time: "10:00" }] }
        ],
        places: [
          { id: "belem", name: "Mosteiro dos Jerónimos", localizedName: "热罗尼莫斯修道院", city: "里斯本", area: "贝伦", locationLabel: "Belém", coordinates: [38.6979,-9.2065], category: "sight", priority: "must", contentTier: "deep", durationMinutes: 180, whyWorthIt: "从曼努埃尔式石雕理解里斯本如何把航海财富写进宗教建筑。", plan: "上午入场，之后沿河向东移动。", tip: "门票与开放时间需临近复核。", detailSections: [{ title: "到这里看什么", items: ["从南门辨认航海符号与石雕层次", "进入回廊比较光线和柱式变化"] }], sourceRefs: [] },
          { id: "alfama", name: "Alfama", localizedName: "阿尔法玛", city: "里斯本", area: "Alfama", locationLabel: "Alfama", coordinates: [38.711,-9.13], category: "local-life", priority: "preferred", durationMinutes: 120, whyWorthIt: "用坡道、晾衣阳台和小广场理解旧城仍在运转的生活结构。", plan: "下午从低处向上步行，控制爬坡强度。", detailSections: [], sourceRefs: [] },
          { id: "market", name: "Mercado de Campo de Ourique", localizedName: "坎波德欧里克市场", city: "里斯本", area: "Campo de Ourique", locationLabel: "Campo de Ourique", coordinates: [38.716,-9.166], category: "market", priority: "nearby", durationMinutes: 60, whyWorthIt: "市场兼顾居民采购与短暂停留，适合作为体力下降时的同方向替代。", plan: "有余力时加入第一天下午。", detailSections: [], sourceRefs: [] },
          { id: "lx", name: "LX Factory", city: "里斯本", area: "Alcântara", locationLabel: "Alcântara", coordinates: [38.703,-9.179], category: "art", priority: "preferred", durationMinutes: 180, whyWorthIt: "旧工业空间中的书店、工作室和餐饮适合观察城市更新的现实使用。", plan: "第二日上午慢走并在同区午餐。", detailSections: [], sourceRefs: [] }
        ],
        routeSegments: [{ id: "r1", dayId: "d1", originPlaceId: "belem", destinationPlaceId: "alfama", mode: "transit", verification: "verified", durationMinutes: 45, checkedAt: "2026-08-17T00:00:00Z", label: "沿河公共交通进入旧城", detail: "具体线路与耗时出发前复核。", sourceRefs: ["google_maps"] }]
      }
    }
  }) }));

  await page.goto("/#day=d2&poi=belem");
  await expect(page.getByRole("region", { name: "Interactive trip plan" })).toBeVisible();
  await expect(page.getByText("目标", { exact: true })).toHaveCount(0);
  await expect(page.locator(".leaflet-container")).toBeVisible();
  await expect(page.getByRole("heading", { name: "热罗尼莫斯修道院" })).toHaveCount(0);
  await expect(page.getByRole("region", { name: "Day itinerary" }).getByText("10/13 · 里斯本", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Full trip Back to overview" }).click();
  const tripOverview = page.getByLabel("Trip overview");
  await expect(tripOverview).toContainText("3Travelers");
  await expect(tripOverview).toContainText("0Day trips");
  await expect(tripOverview).toContainText("4Planned places");
  await expect(page.locator(".trip-city-tabs").getByRole("button", { name: "Full trip" })).toBeVisible();
  await expect(page.locator(".trip-city-tabs").getByRole("button", { name: "里斯本" })).toBeVisible();
  const candidateToggle = page.getByRole("checkbox", { name: "Show optional places" });
  await expect(candidateToggle).toBeChecked();
  await candidateToggle.uncheck();
  await candidateToggle.check();
  await expect(page.locator('[data-open-day="d1"] .day-timeline-time')).toHaveText(["09:30–12:30", "15:30–17:30"]);
  await expect(page.locator('[data-open-day="d1"] .day-timeline-name')).toHaveText(["Mosteiro dos Jerónimos", "Alfama"]);
  await expect(page.locator('[data-open-day="d1"] .day-summary')).toContainText("从河岸进入旧城");
  await expect(page.locator('[data-open-day="d1"] .day-reason')).toContainText("上午先看需要集中精力的建筑");
  await expect(page.locator('[data-open-day="d1"] .day-timeline-transit')).toContainText("Public transport · 沿河公共交通进入旧城 · 45 min");
  await expect(page.locator('[data-open-day="d1"] .day-transit-expand')).toHaveCount(0);
  await expect(page.locator('[data-open-day="d2"] .day-timeline-time')).toHaveText(["10:00–13:00"]);
  await expect(tripOverview).not.toContainText("待定");
  await expect(tripOverview).not.toContainText("当天保留弹性");
  await expect(tripOverview).not.toContainText("主锚点");
  await page.getByRole("button", { name: /河岸建筑与旧城方向感/ }).click();
  await expect(page.getByText("沿河公共交通进入旧城", { exact: true })).toBeVisible();
  await expect(page.locator(".place-transit summary").getByText("沿河公共交通进入旧城", { exact: true })).toBeVisible();
  await page.locator(".place-transit summary").click();
  await expect(page.getByRole("region", { name: "Day itinerary" }).getByText("具体线路与耗时出发前复核。", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: /^1 Mosteiro dos Jerónimos/ }).click();
  await expect(page.getByRole("link", { name: "Google Maps", exact: true })).toHaveAttribute("href", /google\.com\/maps\/search/);
  await page.route("**/api/plans/native-trip/presentation", async (route) => route.abort("blockedbyclient"));
  await page.locator('[data-sortable-poi="belem"]').hover();
  await page.getByRole("button", { name: "Move Mosteiro dos Jerónimos down" }).click();
  await expect.poll(async () => page.locator("#day-place-list [data-sortable-poi]").evaluateAll((rows) => rows.map((row) => row.getAttribute("data-sortable-poi")))).toEqual(["alfama", "belem"]);
  await page.getByRole("button", { name: /^2 Mosteiro dos Jerónimos/ }).click();
  await expect(page.getByRole("heading", { name: "Mosteiro dos Jerónimos" })).toBeVisible();
  await page.getByRole("button", { name: "Close place details" }).click();
  expect(pageErrors).toEqual([]);
});
