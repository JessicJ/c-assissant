import assert from "node:assert/strict";
import test from "node:test";
import { linkPlanAccommodation, sendAgentChat, safePlanError, ApiRequestError, getSettingsSnapshot, getWorkspace, listPlanHistory, refreshPlanRoutes } from "./api-client.js";

test("refreshPlanRoutes posts the requested route refresh body to the Plan endpoint", async () => {
  const originalFetch = globalThis.fetch;
  let observed: { input: string | URL | Request; init: RequestInit | undefined } | undefined;
  globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    observed = { input, init };
    return new Response(JSON.stringify({
      workspace: { profile: {}, runtime: {}, system: {}, destinationArrivals: [], inbox: [], sourceSnapshots: [], activePlan: { id: "plan-1", version: 5, status: "draft", configuration: {}, stages: [], knownInformation: [], assumptions: [], sources: [] } },
      routeRefresh: {
        segmentIds: ["move-1"],
        refreshedSegmentIds: ["move-1"],
        scheduleConflictDayIds: []
      }
    }), { status: 200, headers: { "content-type": "application/json" } });
  }) as typeof fetch;

  try {
    const payload = await refreshPlanRoutes("plan 1", {
      expectedVersion: 4,
      expectedBlueprintVersion: 7,
      segmentIds: ["move-1"]
    });

    assert.equal(String(observed?.input), "/api/plans/plan%201/presentation/routes/refresh");
    assert.equal(observed?.init?.method, "POST");
    assert.equal((observed?.init?.headers as Record<string, string>)["content-type"], "application/json");
    assert.deepEqual(JSON.parse(String(observed?.init?.body)), {
      expectedVersion: 4,
      expectedBlueprintVersion: 7,
      segmentIds: ["move-1"]
    });
    assert.deepEqual(payload.routeRefresh.refreshedSegmentIds, ["move-1"]);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("工作区错误不展示不可信诊断消息", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async () => new Response(JSON.stringify({ message: "The local workspace is not initialized." }), { status: 500, headers: { "content-type": "application/json" } })) as typeof fetch;

  try {
    await assert.rejects(
      () => getWorkspace(),
      (error: unknown) => error instanceof ApiRequestError && !error.message.includes("not initialized")
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("getWorkspace explains when the core service cannot be reached", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async () => { throw new TypeError("Failed to fetch"); }) as typeof fetch;

  try {
    await assert.rejects(
      () => getWorkspace(),
      /Landi could not be reached/
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("getWorkspace rejects incomplete workspace payloads explicitly", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async () => new Response(JSON.stringify({ profile: { status: "ready" } }), { status: 200, headers: { "content-type": "application/json" } })) as typeof fetch;

  try {
    await assert.rejects(
      () => getWorkspace(),
      /workspace data was incomplete/i
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("history reports failure while optional settings degrade quietly", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async () => { throw new TypeError("Failed to fetch"); }) as typeof fetch;

  try {
    await assert.rejects(listPlanHistory(), /Landi could not be reached/);
    assert.deepEqual(await getSettingsSnapshot(), {});
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("HTTP错误字段、HTML正文与畸形成功正文不泄露诊断", async () => {
  const { applyDirectBlueprintRevisionBatch } = await import("./api-client.js");
  const originalFetch = globalThis.fetch;
  const body = { expectedVersion: 1, expectedBlueprintVersion: 1, requestId: "request", revisions: [{ kind: "set_tip_state" as const, tipId: "tip", pinned: true }] };
  try {
    for (const response of [
      new Response(JSON.stringify({ code: "version_conflict", error: "存储诊断哨兵", message: "存储诊断哨兵" }), { status: 409 }),
      new Response("<html>存储诊断哨兵</html>", { status: 502 }),
      new Response("{bad 存储诊断哨兵", { status: 200 }),
      new Response(JSON.stringify({ workspace: {}, revision: {} }), { status: 200 })
    ]) {
      globalThis.fetch = async () => response;
      await assert.rejects(() => applyDirectBlueprintRevisionBatch("plan", body), (caught: unknown) => caught instanceof ApiRequestError && !caught.message.includes("诊断哨兵"));
    }
    globalThis.fetch = async () => { throw new Error("存储诊断哨兵"); };
    await assert.rejects(() => applyDirectBlueprintRevisionBatch("plan", body), (caught: unknown) => caught instanceof ApiRequestError && caught.status === 0 && !caught.message.includes("诊断哨兵"));
    globalThis.fetch = async () => ({ status: 200, ok: true, text: async () => { throw new Error("存储诊断哨兵"); } }) as unknown as Response;
    await assert.rejects(() => applyDirectBlueprintRevisionBatch("plan", body), (caught: unknown) => caught instanceof ApiRequestError && !caught.code && !caught.message.includes("诊断哨兵"));
  } finally { globalThis.fetch = originalFetch; }
});

test("回执查询携带完整原身份并拒绝错配，成功返回当前工作区", async () => {
  const { getDirectBlueprintReceipt } = await import("./api-client.js");
  const originalFetch = globalThis.fetch;
  const identity = { operation: "undo" as const, requestId: "request", requestDigest: "a".repeat(64), expectedPlanId: "original plan", expectedVersion: 2, expectedBlueprintVersion: 3, revisionId: "revision" };
  const current = { profile: {}, runtime: {}, system: {}, destinationArrivals: [], inbox: [], sourceSnapshots: [], activePlan: { id: "new-plan", version: 9, status: "draft", configuration: {}, stages: [], knownInformation: [], assumptions: [], sources: [] } };
  try {
    globalThis.fetch = async (input, init) => {
      const url = new URL(String(input), "http://localhost");
      assert.equal(init?.cache, "no-store");
      assert.equal(url.searchParams.get("revisionId"), "revision");
      assert.equal(url.searchParams.get("expectedVersion"), "2");
      assert.ok(url.pathname.includes("original%20plan"));
      return new Response(JSON.stringify({ ...identity, status: "committed", workspace: current }));
    };
    const result = await getDirectBlueprintReceipt(identity);
    assert.equal(result.status, "committed");
    if (result.status === "committed") assert.equal(result.workspace.activePlan.id, "new-plan");
    globalThis.fetch = async () => new Response(JSON.stringify({ ...identity, revisionId: "other", status: "committed", workspace: current }));
    await assert.rejects(() => getDirectBlueprintReceipt(identity), /could not be matched/);
  } finally { globalThis.fetch = originalFetch; }
});

test("无正文成功仅适用于原有void接口，工作区写入的畸形2xx保持未知", async () => {
  const api = await import("./api-client.js");
  const originalFetch = globalThis.fetch;
  try {
    globalThis.fetch = async () => new Response(null, { status: 204 });
    await api.deleteHistoricalPlan("archived"); await api.cancelPlanningGeneration("session");
    await assert.rejects(() => api.undoDirectBlueprintRevision("plan", "revision", { expectedVersion: 1, expectedBlueprintVersion: 1, requestId: "request" }), ApiRequestError);
    globalThis.fetch = async () => new Response("{}");
    const operations = [
      () => api.refreshPlanRoutes("plan", { expectedVersion: 1, segmentIds: ["route"] }),
      () => api.prepareDirectBlueprintAssistedReplanning("plan", { expectedVersion: 1, revisions: [], replanRequirement: {} as any }),
      () => api.undoPlanChange("plan", "change", 1),
      () => api.undoPlanReplacement("plan", 1),
      () => api.setPlanTaskChecked("plan", "task", true),
      () => api.confirmPlan("plan", 1),
      () => api.patchPlanPresentation("plan", { expectedVersion: 1, assignments: {}, priorities: {}, orders: {} })
    ];
    for (const operation of operations) await assert.rejects(operation, (caught: unknown) => caught instanceof ApiRequestError && caught.status === 200 && !caught.code);
  } finally { globalThis.fetch = originalFetch; }
});


test("已知计划保护拒绝分别保留准确动作，不统一导向辅助重规划", () => {
  const cases = [
    ["history_plan_protected", "The current or executing itinerary cannot be deleted from history. Choose an archived itinerary."],
    ["unconfirmed_draft_required", "Only unconfirmed drafts can be discarded. Use End trip for an approved itinerary."],
    ["active_plan_required", "Only the executing itinerary can be ended. Return to the current itinerary and check its status."],
    ["draft_required", "Create a replacement draft before adjusting the approved itinerary."]
  ];
  for (const [code, expected] of cases) {
    const message = safePlanError(new ApiRequestError("虚构内部诊断", 409, { code }));
    assert.equal(message, expected);
    assert.equal(message.includes("辅助重规划"), false);
    assert.equal(message.includes("虚构内部诊断"), false);
  }
});


test("调整行程与手写住宿接口保留稳定HTTP业务拒绝代码", async () => {
  const originalFetch = globalThis.fetch;
  try {
    globalThis.fetch = (async () => new Response(JSON.stringify({ code: "version_conflict", error: "虚构内部诊断 /private/fixture-only" }), { status: 409 })) as typeof fetch;
    const calls = [
      () => sendAgentChat({ mode: "revise_plan", message: "虚构调整", expectedPlanId: "fictional-plan", expectedVersion: 1 }),
      () => linkPlanAccommodation("fictional-plan", { expectedVersion: 1, name: "虚构住宿", address: "虚构地区", status: "candidate" })
    ];
    for (const call of calls) await assert.rejects(call, (error: unknown) => {
      assert.ok(error instanceof ApiRequestError);
      assert.equal(error.status, 409); assert.equal(error.code, "version_conflict");
      assert.equal(safePlanError(error), "The plan has changed. Refresh and review the latest version. Your pending edits have been kept.");
      assert.equal(error.message.includes("虚构内部诊断"), false);
      return true;
    });
  } finally { globalThis.fetch = originalFetch; }
});

test("unknown errors use a safe English fallback and never trust service or native exception text", () => {
  for (const error of [new Error("私密诊断 /private/secret"), new ApiRequestError("Internal traceback /private/secret", 503, { code: "unknown_future_code" }), { message: "PRIVATE" }]) {
    assert.equal(safePlanError(error), "The operation could not be completed. Keep your draft and check the result before trying again.");
    assert.equal(safePlanError(error, "The map changes could not be verified. Check the current plan."), "The map changes could not be verified. Check the current plan.");
  }
});

 test("unchanged edit states that no changes were saved", () => {
  assert.equal(safePlanError(new ApiRequestError("private detail", 409, { code: "unchanged_edit" })), "This item is already in the selected state. No changes were saved.");
});
