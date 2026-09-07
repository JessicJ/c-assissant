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

test("current itinerary renders the linked Trip Blueprint over a stale Plan presentation", async ({ page }) => {
  const pageErrors: string[] = [];
  page.on("pageerror", (error) => pageErrors.push(error.message));
  const workspace = {
    profile: { status: "ready", displayName: "Trip tester", preferredLanguage: "English", nationality: "Singapore", gender: "prefer_not_to_say", immigrationStatus: "short_term_visitor" },
    runtime: { selectedKind: "codex" },
    inbox: [],
    activeBlueprint: {
      schemaVersion: 1,
      id: "blueprint-source",
      version: 2,
      generationKey: "generation-source",
      proposalRef: { sessionId: "session-source", proposalVersion: 1 },
      skillLineage: { skillId: "interactive-trip-planner", skillVersion: "0.2.0" },
      researchSetId: "research-source",
      title: "Blueprint Tokyo",
      summary: "Blueprint should win.",
      language: "en",
      destinations: ["Tokyo"],
      startDate: "2026-10-04",
      endDate: "2026-10-04",
      sources: [],
      places: [
        { id: "museum", name: "Blueprint Museum", locationLabel: "Tokyo", city: "Tokyo", category: "museum", priority: "must", coordinates: [35.681, 139.797], whyWorthIt: "Fresh Blueprint anchor.", plan: "Visit first.", durationMinutes: 60, evidence: [] },
        { id: "cafe", name: "Blueprint Cafe", locationLabel: "Tokyo", city: "Tokyo", category: "coffee cafe", priority: "preferred", coordinates: [35.683, 139.799], whyWorthIt: "Fresh Blueprint break.", plan: "Use as a pause.", durationMinutes: 45, evidence: [] }
      ],
      events: [],
      days: [{ id: "day-1", date: "2026-10-04", kind: "scheduled", city: "Tokyo", title: "Fresh day", summary: "Use the Blueprint schedule.", stops: [{ placeId: "museum", order: 1, time: "09:00" }, { placeId: "cafe", order: 2, time: "11:00" }], candidatePlaceIds: [] }],
      movements: [{ id: "movement-1", dayId: "day-1", originPlaceId: "museum", destinationPlaceId: "cafe", mode: "walking", status: "recheck", label: "Route needs refresh", detail: "Refresh this movement before execution.", evidence: [] }],
      actionRequirements: [],
      createdAt: "2026-08-26T00:00:00.000Z"
    },
    activePlan: {
      id: "plan-source", version: 3, title: "Plan with stale presentation", location: "Tokyo", dates: "2026-10-04", status: "draft", knownInformation: [], assumptions: [], nextAction: "Review.", createdAt: "2026-08-26T00:00:00.000Z",
      configuration: { accommodation: { status: "not_set" }, arrival: {}, transport: { preference: "plan_recommended" }, travelContext: { partySize: 2 } },
      stages: [{ id: "itinerary", title: "Itinerary", description: "Mapped day.", status: "not_started", presentationKind: "itinerary", tasks: [] }],
      sources: [],
      presentation: {
        kind: "itinerary",
        summary: "stale stored presentation",
        startDate: "2026-10-04",
        endDate: "2026-10-04",
        cities: ["Tokyo"],
        days: [{ id: "stale-day", label: "Stale day", shortLabel: "10/04", city: "Tokyo", title: "Stale day", summary: "Do not render this.", placeIds: ["stale"], stops: [{ placeId: "stale", order: 1, time: "08:00" }] }],
        places: [{ id: "stale", name: "Stale Museum", locationLabel: "Tokyo", city: "Tokyo", category: "museum", priority: "preferred", coordinates: [35.68, 139.76], whyWorthIt: "Old adapter data.", plan: "Do not show.", durationMinutes: 30, detailSections: [], sourceRefs: [] }],
        routeSegments: []
      }
    }
  };
  await page.route("**/api/workspace", (route) => route.fulfill({ contentType: "application/json", body: JSON.stringify(workspace) }));
  await page.route("**/api/plans/history", (route) => route.fulfill({ contentType: "application/json", body: "[]" }));
  await page.route("**/api/configuration", (route) => route.fulfill({ contentType: "application/json", body: "{}" }));
  await page.route("**/api/runtimes", (route) => route.fulfill({ contentType: "application/json", body: "[]" }));
  await page.route("**/api/agent/chat", (route) => route.fulfill({ status: 500, contentType: "application/json", body: JSON.stringify({ error: "Agent route should not be used." }) }));

  await page.goto("/");
  await expect(page.getByLabel("Landi Blueprint workspace")).toBeVisible();
  await expect(page.locator(".blueprint-timeline-list .blueprint-itinerary-card-main")).toHaveText([
    /09:00.*Blueprint Museum/s,
    /11:00.*Blueprint Cafe/s
  ]);
  await expect(page.getByText("Stale Museum")).toHaveCount(0);
  await expect(page.locator(".blueprint-map-bubble").filter({ hasText: "Blueprint Museum" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Refresh routes" })).toBeVisible();
  expect(pageErrors).toEqual([]);
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
          { id: "lx", name: "LX Factory", city: "里斯本", area: "Alcântara", locationLabel: "Alcântara", coordinates: [38.703,-9.179], category: "art", priority: "preferred", durationMinutes: 180, whyWorthIt: "旧工业空间中的书店、工作室和餐饮适合观察城市更新的现实使用。", plan: "第二日上午慢走并在同区午餐。", detailSections: [], sourceRefs: [] },
          { id: "bookshop", name: "Livraria Bertrand", localizedName: "伯特兰书店", city: "里斯本", area: "Chiado", locationLabel: "Chiado", coordinates: [38.7102,-9.1421], category: "bookstore shopping", priority: "nearby", durationMinutes: 45, whyWorthIt: "作为轻量购物点，适合在市中心路线中补进一段书店与街区浏览。", plan: "如果当天还有余力，把它作为短购物停留加入。", detailSections: [], sourceRefs: [] }
        ],
        routeSegments: [{ id: "r1", dayId: "d1", originPlaceId: "belem", destinationPlaceId: "alfama", mode: "transit", verification: "verified", durationMinutes: 45, checkedAt: "2026-08-17T00:00:00Z", label: "沿河公共交通进入旧城", detail: "具体线路与耗时出发前复核。", sourceRefs: ["google_maps"] }]
      }
    }
  }) }));
  let appliedWorkspace: any;
  const directRevisionRequests: unknown[] = [];
  await page.route("**/api/plans/native-trip/blueprint-revisions/direct", async (route) => {
    const requestBody = route.request().postDataJSON();
    directRevisionRequests.push(requestBody);
    await new Promise((resolve) => setTimeout(resolve, 120));
    const updatedWorkspace = {
      profile: { status: "ready", displayName: "Trip tester", preferredLanguage: "简体中文", nationality: "Singapore", gender: "prefer_not_to_say", immigrationStatus: "short_term_visitor" },
      runtime: { selectedKind: "codex" },
      inbox: [],
      activePlan: {
        id: "native-trip", version: 2, title: "里斯本建筑与街区生活", location: "里斯本", dates: "2026-10-12 至 2026-10-13", status: "draft", knownInformation: ["两天建筑与当地生活"], assumptions: [], nextAction: "审阅并确认计划。", createdAt: "2026-08-17T00:00:00.000Z",
        configuration: { accommodation: { status: "not_set" }, arrival: {}, transport: { preference: "plan_recommended" }, travelContext: { partySize: 3, luggage: "light" } },
        stages: [],
        sources: [],
        presentation: {
          kind: "itinerary", summary: "里斯本建筑与街区生活", language: "zh-CN", startDate: "2026-10-12", endDate: "2026-10-13", cities: ["里斯本"],
          days: [
            { id: "d1", label: "10 月 12 日", shortLabel: "10/12", city: "里斯本", title: "河岸建筑与旧城方向感", summary: "从河岸进入旧城，只保留一座重型主锚点。", anchors: ["belem"], candidates: [], placeIds: ["belem", "alfama", "bookshop"], stops: [{ placeId: "belem", order: 1, time: "09:30" }, { placeId: "alfama", order: 2, time: "15:30" }, { placeId: "bookshop", order: 3, time: "16:30" }] },
            { id: "d2", label: "10 月 13 日", shortLabel: "10/13", city: "里斯本", title: "街区生活与当代空间", summary: "用市场、咖啡和社区空间组成较轻的一天。", anchors: ["lx"], candidates: [], placeIds: ["lx", "market"], stops: [{ placeId: "lx", order: 1, time: "10:00" }, { placeId: "market", order: 2, time: "15:00" }] }
          ],
          places: [
            { id: "belem", name: "Mosteiro dos Jerónimos", localizedName: "热罗尼莫斯修道院", city: "里斯本", area: "贝伦", locationLabel: "Belém", coordinates: [38.6979,-9.2065], category: "sight", priority: "must", durationMinutes: 180, whyWorthIt: "从曼努埃尔式石雕理解里斯本如何把航海财富写进宗教建筑。", plan: "上午入场，之后沿河向东移动。", detailSections: [], sourceRefs: [] },
            { id: "alfama", name: "Alfama", localizedName: "阿尔法玛", city: "里斯本", area: "Alfama", locationLabel: "Alfama", coordinates: [38.711,-9.13], category: "local-life", priority: "preferred", durationMinutes: 120, whyWorthIt: "用坡道、晾衣阳台和小广场理解旧城仍在运转的生活结构。", plan: "下午从低处向上步行，控制爬坡强度。", detailSections: [], sourceRefs: [] },
            { id: "bookshop", name: "Livraria Bertrand", localizedName: "伯特兰书店", city: "里斯本", area: "Chiado", locationLabel: "Chiado", coordinates: [38.7102,-9.1421], category: "bookstore shopping", priority: "nearby", durationMinutes: 45, whyWorthIt: "作为轻量购物点，适合在市中心路线中补进一段书店与街区浏览。", plan: "如果当天还有余力，把它作为短购物停留加入。", detailSections: [], sourceRefs: [] },
            { id: "lx", name: "LX Factory", city: "里斯本", area: "Alcântara", locationLabel: "Alcântara", coordinates: [38.703,-9.179], category: "art", priority: "preferred", durationMinutes: 180, whyWorthIt: "旧工业空间中的书店、工作室和餐饮适合观察城市更新的现实使用。", plan: "第二日上午慢走并在同区午餐。", detailSections: [], sourceRefs: [] },
            { id: "market", name: "Mercado de Campo de Ourique", localizedName: "坎波德欧里克市场", city: "里斯本", area: "Campo de Ourique", locationLabel: "Campo de Ourique", coordinates: [38.716,-9.166], category: "market", priority: "nearby", durationMinutes: 60, whyWorthIt: "市场兼顾居民采购与短暂停留，适合作为体力下降时的同方向替代。", plan: "有余力时加入第一天下午。", detailSections: [], sourceRefs: [] }
          ],
          routeSegments: [
            { id: "r1", dayId: "d1", originPlaceId: "belem", destinationPlaceId: "alfama", mode: "transit", verification: "verified", durationMinutes: 45, checkedAt: "2026-08-17T00:00:00Z", label: "沿河公共交通进入旧城", detail: "具体线路与耗时出发前复核。", sourceRefs: [] },
            { id: "r2", dayId: "d1", originPlaceId: "alfama", destinationPlaceId: "bookshop", mode: "walking", verification: "needs_verification", label: "Route needs refresh", detail: "This day was edited directly. Refresh routing, timing, meals, and opening constraints before execution.", sourceRefs: [] },
            { id: "r3", dayId: "d2", originPlaceId: "lx", destinationPlaceId: "market", mode: "transit", verification: "needs_verification", label: "Route needs refresh", detail: "This day was edited directly. Refresh routing, timing, meals, and opening constraints before execution.", sourceRefs: [] }
          ]
        }
      }
    };
    appliedWorkspace = updatedWorkspace;
    await route.fulfill({ contentType: "application/json", body: JSON.stringify({
      ...updatedWorkspace,
      workspace: updatedWorkspace,
      revision: {
        affectedDayIds: ["d2", "d1"],
        affectedPlaceIds: ["market", "bookshop"],
        revisionCount: 2,
        routeRefresh: { dayIds: ["d2", "d1"], movementIds: ["r2", "r3"], reason: "This itinerary day was edited directly." }
      }
    }) });
  });
  const routeRefreshRequests: unknown[] = [];
  await page.route("**/api/plans/native-trip/presentation/routes/refresh", async (route) => {
    const requestBody = route.request().postDataJSON();
    routeRefreshRequests.push(requestBody);
    if (!appliedWorkspace) {
      await route.fulfill({ status: 500, contentType: "application/json", body: JSON.stringify({ error: "No applied workspace was available." }) });
      return;
    }
    const refreshedWorkspace = {
      ...appliedWorkspace,
      activePlan: {
        ...appliedWorkspace.activePlan,
        version: 3,
        presentation: {
          ...appliedWorkspace.activePlan.presentation,
          routeSegments: appliedWorkspace.activePlan.presentation.routeSegments.map((segment: any) => segment.id === "r2" ? {
            ...segment,
            verification: "verified",
            durationMinutes: 18,
            checkedAt: "2026-08-18T00:00:00Z",
            label: "Alfama to Chiado walk",
            detail: "Refreshed walking route from Alfama toward Chiado."
          } : segment)
        }
      }
    };
    await route.fulfill({ contentType: "application/json", body: JSON.stringify({
      workspace: refreshedWorkspace,
      routeRefresh: {
        segmentIds: requestBody.segmentIds,
        refreshedSegmentIds: ["r2"],
        scheduleConflictDayIds: []
      }
    }) });
  });
  const agentRequests: unknown[] = [];
  await page.route("**/api/agent/chat", (route) => {
    agentRequests.push(route.request().postDataJSON());
    return route.fulfill({ status: 500, contentType: "application/json", body: JSON.stringify({ error: "Agent route should not be used for direct itinerary edits." }) });
  });

  await page.goto("/");
  await expect(page.getByLabel("Landi Blueprint workspace")).toBeVisible();
  await expect(page.getByRole("button", { name: "Itinerary" })).toHaveClass(/active/);
  await expect(page.locator(".blueprint-map-stage")).toBeVisible();
  await expect(page.locator(".blueprint-map-stage.blueprint-google-map, .blueprint-map-stage.leaflet-container")).toBeVisible();
  await expect(page.locator(".blueprint-map-bubble")).toHaveCount(2, { timeout: 15000 });
  await expect(page.locator(".blueprint-map-dot")).toHaveCount(2);
  await expect.poll(async () => page.locator(".blueprint-map-dot").evaluateAll((dots) => dots.map((dot) => dot.textContent?.trim() ?? ""))).toEqual(["", ""]);
  await expect(page.locator(".blueprint-map-bubble").filter({ hasText: "Mosteiro dos Jerónimos" })).toBeVisible();
  await expect(page.locator(".blueprint-map-bubble").filter({ hasText: "Mercado de Campo de Ourique" })).toHaveCount(0);
  await expect(page.locator(".blueprint-timeline-list .blueprint-itinerary-card-main")).toHaveText([
    /09:30.*Mosteiro dos Jerónimos/s,
    /15:30.*Alfama/s
  ]);
  await page.locator(".blueprint-timeline-list .blueprint-itinerary-card-main").filter({ hasText: "Alfama" }).click();
  await expect(page.locator(".blueprint-map-bubble.selected").filter({ hasText: "Alfama" })).toBeVisible();
  await expect(page.locator(".blueprint-map-bubble.selected").filter({ hasText: "Mosteiro dos Jerónimos" })).toHaveCount(0);
  await page.getByLabel("Itinerary side panel").getByRole("button", { name: "Back to explore" }).click();

  await page.locator(".blueprint-day-strip button").filter({ hasText: "10/13" }).click();
  await expect(page.locator(".blueprint-map-bubble")).toHaveCount(1, { timeout: 15000 });
  await expect(page.locator(".blueprint-map-bubble").filter({ hasText: "LX Factory" })).toBeVisible();
  await page.locator(".blueprint-day-strip button").filter({ hasText: "10/12" }).click();

  const sidePanel = page.getByLabel("Itinerary side panel");
  const explorePanel = sidePanel.locator(".blueprint-explore-panel");
  await expect(sidePanel.getByRole("heading", { name: "Explore" })).toBeVisible();
  await expect(sidePanel.getByRole("button", { name: "All", exact: true })).toHaveCount(0);
  await expect(sidePanel.locator(".blueprint-guide-filters button.active")).toHaveCount(0);
  await expect(explorePanel).toContainText("Mosteiro dos Jerónimos");
  await expect(explorePanel).toContainText("Alfama");
  await expect(explorePanel).toContainText("LX Factory");
  await expect(explorePanel).toContainText("Mercado de Campo de Ourique");
  await expect(explorePanel).toContainText("Livraria Bertrand");
  await expect(sidePanel.locator(".blueprint-source-marker")).toHaveCount(0);
  await expect(sidePanel.getByRole("button", { name: /^i$/ })).toHaveCount(0);

  await sidePanel.getByRole("button", { name: "Attractions" }).click();
  await expect(sidePanel.locator(".blueprint-guide-filters button.active")).toHaveText("Attractions");
  await expect(explorePanel).not.toContainText("Mercado de Campo de Ourique");
  await sidePanel.getByRole("button", { name: "Attractions" }).click();
  await expect(sidePanel.locator(".blueprint-guide-filters button.active")).toHaveCount(0);
  await expect(explorePanel).toContainText("Mercado de Campo de Ourique");

  await sidePanel.getByRole("button", { name: "Dining" }).click();
  await expect(sidePanel.locator(".blueprint-guide-filters button.active")).toHaveText("Dining");
  await expect(explorePanel).toContainText("Mercado de Campo de Ourique");
  await expect(explorePanel).not.toContainText("LX Factory");
  await expect(explorePanel).not.toContainText("Livraria Bertrand");

  await sidePanel.getByRole("button", { name: /Mercado de Campo de Ourique/ }).click();
  await expect(sidePanel.getByRole("heading", { name: /Mercado de Campo de Ourique/ })).toBeVisible();
  await expect(sidePanel.getByRole("button", { name: "Add to itinerary" })).toBeVisible();
  await expect(sidePanel.getByRole("button", { name: "Back to explore" })).toBeVisible();
  await expect(sidePanel.getByRole("button", { name: "Detail" })).toHaveCount(0);

  await sidePanel.getByRole("button", { name: "Add to itinerary" }).click();
  await expect(sidePanel.getByText("Placement", { exact: true })).toBeVisible();
  await expect(sidePanel.getByText("Meaning", { exact: true })).toHaveCount(0);
  await expect(sidePanel.getByRole("button", { name: "Scheduled", exact: true })).toHaveCount(0);
  await expect(sidePanel.getByRole("button", { name: "Optional", exact: true })).toHaveCount(0);

  await sidePanel.getByRole("button", { name: "10/13" }).click();
  await sidePanel.getByRole("button", { name: "Add to draft" }).click();
  const editBar = page.getByRole("toolbar", { name: "Unsaved itinerary edits" });
  await expect(editBar.getByText("1 unsaved change")).toBeVisible();
  await expect(editBar.getByText("10/13", { exact: true })).toBeVisible();
  await expect(page.locator(".blueprint-map-status")).toContainText("Routes will be checked");
  await expect(page.getByText("After confirm", { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Refresh routes" })).toHaveCount(0);
  expect(routeRefreshRequests).toEqual([]);
  await expect(sidePanel.getByRole("heading", { name: "Explore" })).toBeVisible();
  await expect(page.locator(".blueprint-timeline-list").getByRole("button", { name: /Pending itinerary edit for Mercado de Campo de Ourique/ })).toContainText("Draft");
  await expect(page.locator(".blueprint-map-bubble.pending").filter({ hasText: "Mercado de Campo de Ourique" })).toBeVisible();
  await expect(page.locator(".blueprint-map-bubble.selected").filter({ hasText: "Mercado de Campo de Ourique" })).toBeVisible();
  await page.getByRole("button", { name: "Cancel", exact: true }).click();
  await expect(page.getByText("unsaved change")).toHaveCount(0);
  await expect(page.getByText("After confirm", { exact: true })).toHaveCount(0);
  await expect(page.getByText("Routes will be checked", { exact: true })).toHaveCount(0);
  await expect(page.locator(".blueprint-timeline-list").getByRole("button", { name: /Pending itinerary edit for Mercado de Campo de Ourique/ })).toHaveCount(0);
  await expect(page.locator(".blueprint-map-bubble").filter({ hasText: "Mercado de Campo de Ourique" })).toHaveCount(0);
  await expect(page.locator(".blueprint-map-bubble.selected").filter({ hasText: "LX Factory" })).toBeVisible();

  await sidePanel.getByRole("button", { name: /Mercado de Campo de Ourique/ }).click();
  await sidePanel.getByRole("button", { name: "Add to itinerary" }).click();
  await sidePanel.getByRole("button", { name: "Add to draft" }).click();
  await expect(editBar.getByText("1 unsaved change")).toBeVisible();
  await sidePanel.getByRole("button", { name: "Dining" }).click();
  await sidePanel.getByRole("button", { name: "Shopping" }).click();
  await sidePanel.getByRole("button", { name: /Livraria Bertrand/ }).click();
  await sidePanel.getByRole("button", { name: "Add to itinerary" }).click();
  await sidePanel.getByRole("button", { name: "10/12" }).click();
  await sidePanel.getByRole("button", { name: "Add to draft" }).click();
  await expect(editBar.getByText("2 unsaved changes")).toBeVisible();
  await expect(editBar.getByText("10/13, 10/12")).toBeVisible();

  await page.getByRole("button", { name: "Apply", exact: true }).click();
  await expect(page.getByRole("button", { name: "Applying...", exact: true })).toBeDisabled();
  await expect.poll(() => directRevisionRequests.length).toBe(1);
  expect(directRevisionRequests[0]).toMatchObject({
    expectedVersion: 1,
    revisions: [
      { kind: "add_place_to_day", placeId: "market", dayId: "d2", position: { kind: "end" } },
      { kind: "add_place_to_day", placeId: "bookshop", dayId: "d1", position: { kind: "end" } }
    ]
  });
  expect(agentRequests).toEqual([]);
  await expect(page.getByRole("region", { name: "Adjust your plan with Landi" })).toHaveCount(0);
  await expect(page.getByText("unsaved change")).toHaveCount(0);
  await expect(page.getByText(/Applied 2 itinerary updates for 10\/13, 10\/12/)).toBeVisible();
  await expect(page.getByText("After confirm", { exact: true })).toHaveCount(0);
  await expect(page.getByText("Routes will be checked", { exact: true })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Refresh routes" })).toBeVisible();
  await page.getByRole("button", { name: "Refresh routes" }).click();
  await expect.poll(() => routeRefreshRequests.length).toBe(1);
  expect(routeRefreshRequests[0]).toMatchObject({
    expectedVersion: 2,
    segmentIds: ["r2"]
  });
  await expect(page.getByText("Routes refreshed for 10/12 (1 legs).")).toBeVisible();
  await expect(page.getByRole("button", { name: "Refresh routes" })).toHaveCount(0);
  await page.locator(".blueprint-day-strip button").filter({ hasText: "10/13" }).click();
  await expect(page.locator(".blueprint-timeline-list .blueprint-itinerary-card-main").filter({ hasText: "Mercado de Campo de Ourique" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Refresh routes" })).toBeVisible();
  await expect(sidePanel.getByRole("heading", { name: "Explore" })).toBeVisible();
  expect(pageErrors).toEqual([]);
});

test("failed direct itinerary Apply keeps the local draft available", async ({ page }) => {
  const pageErrors: string[] = [];
  page.on("pageerror", (error) => pageErrors.push(error.message));
  const workspace = {
    profile: { status: "ready", displayName: "Trip tester", preferredLanguage: "English", nationality: "Singapore", gender: "prefer_not_to_say", immigrationStatus: "short_term_visitor" },
    runtime: { selectedKind: "codex" },
    inbox: [],
    activePlan: {
      id: "conflict-trip", version: 4, title: "Lisbon market day", location: "Lisbon", dates: "2026-10-12", status: "draft", knownInformation: [], assumptions: [], nextAction: "Review.", createdAt: "2026-08-17T00:00:00.000Z",
      configuration: { accommodation: { status: "not_set" }, arrival: {}, transport: { preference: "plan_recommended" }, travelContext: { partySize: 2 } },
      stages: [],
      sources: [],
      presentation: {
        kind: "itinerary", summary: "Lisbon market day", language: "en", startDate: "2026-10-12", endDate: "2026-10-12", cities: ["Lisbon"],
        days: [{ id: "d1", label: "October 12", shortLabel: "10/12", city: "Lisbon", title: "Neighborhood day", summary: "A compact day.", placeIds: ["anchor"], stops: [{ placeId: "anchor", order: 1, time: "09:00" }], candidates: ["market"] }],
        places: [
          { id: "anchor", name: "Morning Museum", city: "Lisbon", area: "Baixa", locationLabel: "Baixa", coordinates: [38.711, -9.14], category: "museum", priority: "preferred", durationMinutes: 90, whyWorthIt: "A compact morning anchor.", plan: "Visit first.", detailSections: [], sourceRefs: [] },
          { id: "market", name: "Neighborhood Market", city: "Lisbon", area: "Campo de Ourique", locationLabel: "Campo de Ourique", coordinates: [38.716, -9.166], category: "food market", priority: "nearby", durationMinutes: 60, whyWorthIt: "A flexible food stop.", plan: "Add if the day has room.", detailSections: [], sourceRefs: [] }
        ],
        routeSegments: []
      }
    }
  };
  await page.route("**/api/workspace", (route) => route.fulfill({ contentType: "application/json", body: JSON.stringify(workspace) }));
  await page.route("**/api/plans/history", (route) => route.fulfill({ contentType: "application/json", body: "[]" }));
  await page.route("**/api/configuration", (route) => route.fulfill({ contentType: "application/json", body: "{}" }));
  await page.route("**/api/runtimes", (route) => route.fulfill({ contentType: "application/json", body: "[]" }));
  const directRevisionRequests: unknown[] = [];
  await page.route("**/api/plans/conflict-trip/blueprint-revisions/direct", async (route) => {
    directRevisionRequests.push(route.request().postDataJSON());
    await route.fulfill({ status: 409, contentType: "application/json", body: JSON.stringify({ error: "The plan changed before this edit could be saved." }) });
  });
  const agentRequests: unknown[] = [];
  await page.route("**/api/agent/chat", (route) => {
    agentRequests.push(route.request().postDataJSON());
    return route.fulfill({ status: 500, contentType: "application/json", body: JSON.stringify({ error: "Agent route should not be used for direct itinerary edits." }) });
  });

  await page.goto("/");
  const sidePanel = page.getByLabel("Itinerary side panel");
  await sidePanel.getByRole("button", { name: /Neighborhood Market/ }).click();
  await sidePanel.getByRole("button", { name: "Add to itinerary" }).click();
  await sidePanel.getByRole("button", { name: "Add to draft" }).click();
  const editBar = page.getByRole("toolbar", { name: "Unsaved itinerary edits" });
  await expect(editBar.getByText("1 unsaved change")).toBeVisible();
  await expect(page.locator(".blueprint-timeline-list").getByRole("button", { name: /Pending itinerary edit for Neighborhood Market/ })).toContainText("Draft");
  await expect(page.locator(".blueprint-map-stage")).toBeVisible();
  await expect(page.locator(".blueprint-map-status")).toContainText("Routes will be checked");
  await expect(page.getByRole("button", { name: "Refresh routes" })).toHaveCount(0);

  await editBar.getByRole("button", { name: "Apply", exact: true }).click();
  await expect.poll(() => directRevisionRequests.length).toBe(1);
  expect(directRevisionRequests[0]).toMatchObject({
    expectedVersion: 4,
    revisions: [{ kind: "add_place_to_day", placeId: "market", dayId: "d1", position: { kind: "end" } }]
  });
  expect(agentRequests).toEqual([]);
  await expect(page.getByRole("region", { name: "Adjust your plan with Landi" })).toHaveCount(0);
  await expect(page.locator(".inline-alert")).toContainText("The plan changed before this edit could be saved.");
  await expect(page.locator(".agent-status-float.error")).toContainText("The plan changed before this edit could be saved.");
  await expect(editBar.getByText("1 unsaved change")).toBeVisible();
  await expect(editBar.getByRole("button", { name: "Apply", exact: true })).toBeEnabled();
  await expect(page.locator(".blueprint-map-status")).toContainText("Routes will be checked");
  await expect(page.getByText("After confirm", { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Refresh routes" })).toHaveCount(0);
  await expect(page.locator(".blueprint-timeline-list").getByRole("button", { name: /Pending itinerary edit for Neighborhood Market/ })).toBeVisible();
  await editBar.getByRole("button", { name: "Cancel", exact: true }).click();
  await expect(page.getByText("unsaved change")).toHaveCount(0);
  await expect(page.locator(".blueprint-map-bubble").filter({ hasText: "Neighborhood Market" })).toHaveCount(0);
  expect(pageErrors).toEqual([]);
});

test("failed route refresh keeps the affected itinerary routes retryable", async ({ page }) => {
  const pageErrors: string[] = [];
  page.on("pageerror", (error) => pageErrors.push(error.message));
  const workspace = {
    profile: { status: "ready", displayName: "Trip tester", preferredLanguage: "English", nationality: "Singapore", gender: "prefer_not_to_say", immigrationStatus: "short_term_visitor" },
    runtime: { selectedKind: "codex" },
    inbox: [],
    activePlan: {
      id: "refresh-fail", version: 7, title: "Lisbon route check", location: "Lisbon", dates: "2026-10-12", status: "draft", knownInformation: [], assumptions: [], nextAction: "Review.", createdAt: "2026-08-17T00:00:00.000Z",
      configuration: { accommodation: { status: "not_set" }, arrival: {}, transport: { preference: "plan_recommended" }, travelContext: { partySize: 2 } },
      stages: [],
      sources: [],
      presentation: {
        kind: "itinerary", summary: "Lisbon route check", language: "en", startDate: "2026-10-12", endDate: "2026-10-12", cities: ["Lisbon"],
        days: [{ id: "d1", label: "October 12", shortLabel: "10/12", city: "Lisbon", title: "Neighborhood day", summary: "A compact day.", placeIds: ["anchor", "market"], stops: [{ placeId: "anchor", order: 1, time: "09:00" }, { placeId: "market", order: 2, time: "11:00" }] }],
        places: [
          { id: "anchor", name: "Morning Museum", city: "Lisbon", area: "Baixa", locationLabel: "Baixa", coordinates: [38.711, -9.14], category: "museum", priority: "preferred", durationMinutes: 90, whyWorthIt: "A compact morning anchor.", plan: "Visit first.", detailSections: [], sourceRefs: [] },
          { id: "market", name: "Neighborhood Market", city: "Lisbon", area: "Campo de Ourique", locationLabel: "Campo de Ourique", coordinates: [38.716, -9.166], category: "food market", priority: "nearby", durationMinutes: 60, whyWorthIt: "A flexible food stop.", plan: "Use after the museum.", detailSections: [], sourceRefs: [] }
        ],
        routeSegments: [{ id: "route-1", dayId: "d1", originPlaceId: "anchor", destinationPlaceId: "market", mode: "transit", verification: "needs_verification", label: "Route needs refresh", detail: "This day was edited directly. Refresh routing, timing, meals, and opening constraints before execution.", sourceRefs: [] }]
      }
    }
  };
  await page.route("**/api/workspace", (route) => route.fulfill({ contentType: "application/json", body: JSON.stringify(workspace) }));
  await page.route("**/api/plans/history", (route) => route.fulfill({ contentType: "application/json", body: "[]" }));
  await page.route("**/api/configuration", (route) => route.fulfill({ contentType: "application/json", body: "{}" }));
  await page.route("**/api/runtimes", (route) => route.fulfill({ contentType: "application/json", body: "[]" }));
  const routeRefreshRequests: unknown[] = [];
  await page.route("**/api/plans/refresh-fail/presentation/routes/refresh", async (route) => {
    routeRefreshRequests.push(route.request().postDataJSON());
    await route.fulfill({ status: 409, contentType: "application/json", body: JSON.stringify({ error: "Routes changed before refresh could run." }) });
  });
  const agentRequests: unknown[] = [];
  await page.route("**/api/agent/chat", (route) => {
    agentRequests.push(route.request().postDataJSON());
    return route.fulfill({ status: 500, contentType: "application/json", body: JSON.stringify({ error: "Agent route should not be used for route refresh." }) });
  });

  await page.goto("/");
  await expect(page.getByRole("button", { name: "Refresh routes" })).toBeVisible();
  await page.getByRole("button", { name: "Refresh routes" }).click();
  await expect.poll(() => routeRefreshRequests.length).toBe(1);
  expect(routeRefreshRequests[0]).toMatchObject({
    expectedVersion: 7,
    segmentIds: ["route-1"]
  });
  expect(agentRequests).toEqual([]);
  await expect(page.locator(".inline-alert")).toContainText("Routes changed before refresh could run.");
  await expect(page.locator(".agent-status-float.error")).toContainText("Routes changed before refresh could run.");
  await expect(page.getByRole("button", { name: "Refresh routes" })).toBeEnabled();
  await expect(page.locator(".blueprint-map-status")).toContainText("Routes need refresh");
  expect(pageErrors).toEqual([]);
});

test("place status updates save directly to the Trip Blueprint workspace", async ({ page }) => {
  const pageErrors: string[] = [];
  page.on("pageerror", (error) => pageErrors.push(error.message));
  const workspace = {
    profile: { status: "ready", displayName: "Trip tester", preferredLanguage: "English", nationality: "Singapore", gender: "prefer_not_to_say", immigrationStatus: "short_term_visitor" },
    runtime: { selectedKind: "codex" },
    inbox: [],
    activePlan: {
      id: "priority-trip", version: 1, title: "Lisbon status day", location: "Lisbon", dates: "2026-10-12", status: "draft", knownInformation: [], assumptions: [], nextAction: "Review.", createdAt: "2026-08-17T00:00:00.000Z",
      configuration: { accommodation: { status: "not_set" }, arrival: {}, transport: { preference: "plan_recommended" }, travelContext: { partySize: 2 } },
      stages: [],
      sources: [],
      presentation: {
        kind: "itinerary", summary: "Lisbon status day", language: "en", startDate: "2026-10-12", endDate: "2026-10-12", cities: ["Lisbon"],
        days: [{ id: "d1", label: "October 12", shortLabel: "10/12", city: "Lisbon", title: "Neighborhood day", summary: "A compact day.", placeIds: ["anchor"], stops: [{ placeId: "anchor", order: 1, time: "09:00" }], candidates: ["market"] }],
        places: [
          { id: "anchor", name: "Morning Museum", city: "Lisbon", area: "Baixa", locationLabel: "Baixa", coordinates: [38.711, -9.14], category: "museum", priority: "preferred", durationMinutes: 90, whyWorthIt: "A compact morning anchor.", plan: "Visit first.", detailSections: [], sourceRefs: [] },
          { id: "market", name: "Neighborhood Market", city: "Lisbon", area: "Campo de Ourique", locationLabel: "Campo de Ourique", coordinates: [38.716, -9.166], category: "food market", priority: "nearby", durationMinutes: 60, whyWorthIt: "A flexible food stop.", plan: "Add if the day has room.", detailSections: [], sourceRefs: [] }
        ],
        routeSegments: []
      }
    }
  };
  await page.route("**/api/workspace", (route) => route.fulfill({ contentType: "application/json", body: JSON.stringify(workspace) }));
  await page.route("**/api/plans/history", (route) => route.fulfill({ contentType: "application/json", body: "[]" }));
  await page.route("**/api/configuration", (route) => route.fulfill({ contentType: "application/json", body: "{}" }));
  await page.route("**/api/runtimes", (route) => route.fulfill({ contentType: "application/json", body: "[]" }));
  const directRevisionRequests: unknown[] = [];
  await page.route("**/api/plans/priority-trip/blueprint-revisions/direct", async (route) => {
    const requestBody = route.request().postDataJSON();
    directRevisionRequests.push(requestBody);
    const updatedWorkspace = {
      ...workspace,
      activePlan: {
        ...workspace.activePlan,
        version: 2,
        presentation: {
          ...workspace.activePlan.presentation,
          places: workspace.activePlan.presentation.places.map((place) => place.id === "market" ? { ...place, priority: "must" } : place)
        }
      }
    };
    await route.fulfill({ contentType: "application/json", body: JSON.stringify({
      ...updatedWorkspace,
      workspace: updatedWorkspace,
      revision: {
        id: "direct-revision-batch-blueprint-priority-v1-to-v2",
        baseBlueprintVersion: 1,
        appliedBlueprintVersion: 2,
        createdAt: "2026-08-17T00:00:01.000Z",
        revisionCount: 1,
        kinds: ["update_place_priority"],
        affectedDayIds: [],
        affectedPlaceIds: ["market"],
        routeRefresh: { dayIds: [], movementIds: [], reason: "These place status updates do not change route order." },
        undo: { previousBlueprintVersion: 1, previousDays: [], previousMovements: [], previousPlaces: [workspace.activePlan.presentation.places[1]] },
        revisions: []
      }
    }) });
  });
  const agentRequests: unknown[] = [];
  await page.route("**/api/agent/chat", (route) => {
    agentRequests.push(route.request().postDataJSON());
    return route.fulfill({ status: 500, contentType: "application/json", body: JSON.stringify({ error: "Agent route should not be used for direct place status updates." }) });
  });

  await page.goto("/");
  const sidePanel = page.getByLabel("Itinerary side panel");
  await expect(sidePanel.getByRole("button", { name: /Neighborhood Market/ })).toContainText("Nearby");
  await sidePanel.getByRole("button", { name: /Neighborhood Market/ }).click();
  await expect(sidePanel.getByRole("region", { name: "Place status" })).toContainText("Nearby");
  await sidePanel.getByRole("button", { name: "Must go" }).click();
  await expect.poll(() => directRevisionRequests.length).toBe(1);
  expect(directRevisionRequests[0]).toMatchObject({
    expectedVersion: 1,
    revisions: [{ kind: "update_place_priority", placeId: "market", priority: "must" }]
  });
  expect(agentRequests).toEqual([]);
  await expect(page.getByRole("button", { name: "Refresh routes" })).toHaveCount(0);
  await expect(page.getByText("Updated Neighborhood Market.")).toBeVisible();
  await expect(sidePanel.getByRole("button", { name: /Neighborhood Market/ })).toContainText("Must go");
  await sidePanel.getByRole("button", { name: /Neighborhood Market/ }).click();
  await expect(sidePanel.getByRole("region", { name: "Place status" })).toContainText("Must go");
  expect(pageErrors).toEqual([]);
});

test("same-day itinerary drag reorder stages and confirms a direct Blueprint move", async ({ page }) => {
  const pageErrors: string[] = [];
  page.on("pageerror", (error) => pageErrors.push(error.message));
  const workspace = {
    profile: { status: "ready", displayName: "Trip tester", preferredLanguage: "简体中文", nationality: "Singapore", gender: "prefer_not_to_say", immigrationStatus: "short_term_visitor" },
    runtime: { selectedKind: "codex" },
    inbox: [],
    activePlan: {
      id: "drag-trip", version: 1, title: "Tokyo route", location: "Tokyo", dates: "2026-10-12", status: "draft", knownInformation: [], assumptions: [], nextAction: "Review.", createdAt: "2026-08-17T00:00:00.000Z",
      configuration: { accommodation: { status: "not_set" }, arrival: {}, transport: { preference: "plan_recommended" }, travelContext: { partySize: 2 } },
      stages: [],
      sources: [],
      presentation: {
        kind: "itinerary", summary: "Tokyo route", language: "en", startDate: "2026-10-12", endDate: "2026-10-12", cities: ["Tokyo"],
        days: [{ id: "d1", label: "October 12", shortLabel: "10/12", city: "Tokyo", title: "Neighborhood day", summary: "A compact same-day route.", placeIds: ["a", "b", "c"], stops: [{ placeId: "a", order: 1, time: "09:00" }, { placeId: "b", order: 2 }, { placeId: "c", order: 3 }] }],
        places: [
          { id: "a", name: "Fixed Museum", city: "Tokyo", area: "Ueno", locationLabel: "Ueno", coordinates: [35.714, 139.774], category: "museum", priority: "preferred", durationMinutes: 90, whyWorthIt: "A timed morning anchor.", plan: "Visit at opening.", detailSections: [], sourceRefs: [] },
          { id: "b", name: "Book Street", city: "Tokyo", area: "Jimbocho", locationLabel: "Jimbocho", coordinates: [35.695, 139.758], category: "shopping street", priority: "preferred", durationMinutes: 60, whyWorthIt: "A flexible browsing stop.", plan: "Use after the anchor.", detailSections: [], sourceRefs: [] },
          { id: "c", name: "Coffee Stop", city: "Tokyo", area: "Kanda", locationLabel: "Kanda", coordinates: [35.691, 139.77], category: "coffee cafe", priority: "preferred", durationMinutes: 45, whyWorthIt: "A flexible rest stop.", plan: "Use when energy dips.", detailSections: [], sourceRefs: [] }
        ],
        routeSegments: []
      }
    }
  };
  await page.route("**/api/workspace", (route) => route.fulfill({ contentType: "application/json", body: JSON.stringify(workspace) }));
  await page.route("**/api/plans/history", (route) => route.fulfill({ contentType: "application/json", body: "[]" }));
  await page.route("**/api/configuration", (route) => route.fulfill({ contentType: "application/json", body: "{}" }));
  await page.route("**/api/runtimes", (route) => route.fulfill({ contentType: "application/json", body: "[]" }));
  const directRevisionRequests: unknown[] = [];
  await page.route("**/api/plans/drag-trip/blueprint-revisions/direct", async (route) => {
    directRevisionRequests.push(route.request().postDataJSON());
    const updatedWorkspace = {
      ...workspace,
      activePlan: {
        ...workspace.activePlan,
        version: 2,
        presentation: {
          ...workspace.activePlan.presentation,
          days: [{ ...workspace.activePlan.presentation.days[0], placeIds: ["a", "c", "b"], stops: [{ placeId: "a", order: 1, time: "09:00" }, { placeId: "c", order: 2 }, { placeId: "b", order: 3 }] }],
          routeSegments: [
            { id: "r1", dayId: "d1", originPlaceId: "a", destinationPlaceId: "c", mode: "walking", verification: "needs_verification", label: "Route needs refresh", detail: "This day was edited directly. Refresh routing, timing, meals, and opening constraints before execution.", sourceRefs: [] },
            { id: "r2", dayId: "d1", originPlaceId: "c", destinationPlaceId: "b", mode: "walking", verification: "needs_verification", label: "Route needs refresh", detail: "This day was edited directly. Refresh routing, timing, meals, and opening constraints before execution.", sourceRefs: [] }
          ]
        }
      }
    };
    await route.fulfill({ contentType: "application/json", body: JSON.stringify({
      ...updatedWorkspace,
      workspace: updatedWorkspace,
      revision: {
        affectedDayIds: ["d1"],
        affectedPlaceIds: ["c", "a", "b"],
        revisionCount: 1,
        routeRefresh: { dayIds: ["d1"], movementIds: ["r1", "r2"], reason: "This itinerary day was edited directly." }
      }
    }) });
  });

  await page.goto("/");
  const timeline = page.locator(".blueprint-timeline-list");
  await expect(timeline.getByRole("button", { name: /Move Fixed Museum/ })).toBeEnabled();
  await expect(timeline.getByRole("button", { name: /Move Coffee Stop/ })).toBeEnabled();
  const coffeeHandleBox = await timeline.getByRole("button", { name: /Move Coffee Stop/ }).boundingBox();
  const targetDropBox = await timeline.locator(".blueprint-itinerary-drop-zone").nth(1).boundingBox();
  if (!coffeeHandleBox || !targetDropBox) throw new Error("Drag handle or target drop zone is not visible.");
  await page.mouse.move(coffeeHandleBox.x + coffeeHandleBox.width / 2, coffeeHandleBox.y + coffeeHandleBox.height / 2);
  await page.mouse.down();
  await page.mouse.move(targetDropBox.x + targetDropBox.width / 2, targetDropBox.y + targetDropBox.height / 2, { steps: 10 });
  await page.mouse.up();
  await expect(page.getByText("1 unsaved change")).toBeVisible();
  await expect(timeline.locator(".blueprint-itinerary-card-main").filter({ hasText: "Coffee Stop" })).toContainText("Not saved");
  await expect(timeline.locator(".blueprint-itinerary-card-main strong")).toHaveText(["Fixed Museum", "Coffee Stop", "Book Street"]);
  await expect(timeline.locator(".blueprint-itinerary-card-main > span")).toHaveText(["09:00", "Late morning option", "Afternoon"]);

  const movedCoffeeHandleBox = await timeline.getByRole("button", { name: /Move Coffee Stop/ }).boundingBox();
  const restoreDropBox = await timeline.locator(".blueprint-itinerary-drop-zone").last().boundingBox();
  if (!movedCoffeeHandleBox || !restoreDropBox) throw new Error("Restoring drag handle or drop zone is not visible.");
  await page.mouse.move(movedCoffeeHandleBox.x + movedCoffeeHandleBox.width / 2, movedCoffeeHandleBox.y + movedCoffeeHandleBox.height / 2);
  await page.mouse.down();
  await page.mouse.move(restoreDropBox.x + restoreDropBox.width / 2, restoreDropBox.y + restoreDropBox.height / 2, { steps: 10 });
  await page.mouse.up();
  await expect(page.getByText("unsaved change")).toHaveCount(0);
  await expect(timeline.locator(".blueprint-itinerary-card-main strong")).toHaveText(["Fixed Museum", "Book Street", "Coffee Stop"]);
  await expect(timeline.locator(".blueprint-itinerary-card-main > span")).toHaveText(["09:00", "Late morning option", "Afternoon"]);

  const secondCoffeeHandleBox = await timeline.getByRole("button", { name: /Move Coffee Stop/ }).boundingBox();
  const secondTargetDropBox = await timeline.locator(".blueprint-itinerary-drop-zone").nth(1).boundingBox();
  if (!secondCoffeeHandleBox || !secondTargetDropBox) throw new Error("Second drag handle or target drop zone is not visible.");
  await page.mouse.move(secondCoffeeHandleBox.x + secondCoffeeHandleBox.width / 2, secondCoffeeHandleBox.y + secondCoffeeHandleBox.height / 2);
  await page.mouse.down();
  await page.mouse.move(secondTargetDropBox.x + secondTargetDropBox.width / 2, secondTargetDropBox.y + secondTargetDropBox.height / 2, { steps: 10 });
  await page.mouse.up();
  await expect(page.getByText("1 unsaved change")).toBeVisible();
  await expect(timeline.locator(".blueprint-itinerary-card-main strong")).toHaveText(["Fixed Museum", "Coffee Stop", "Book Street"]);
  await expect(timeline.locator(".blueprint-itinerary-card-main > span")).toHaveText(["09:00", "Late morning option", "Afternoon"]);
  await expect(page.locator(".blueprint-map-status")).toContainText("Routes will be checked");
  await expect(page.getByText("After confirm", { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Refresh routes" })).toHaveCount(0);

  await page.getByRole("button", { name: "Apply", exact: true }).click();
  await expect.poll(() => directRevisionRequests.length).toBe(1);
  expect(directRevisionRequests[0]).toMatchObject({
    expectedVersion: 1,
    revisions: [{ kind: "move_place_within_day", placeId: "c", dayId: "d1", position: { kind: "after", afterPlaceId: "a" } }]
  });
  await expect(page.getByText("unsaved change")).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Refresh routes" })).toBeVisible();
  expect(pageErrors).toEqual([]);
});
