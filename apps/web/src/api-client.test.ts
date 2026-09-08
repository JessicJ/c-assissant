import assert from "node:assert/strict";
import test from "node:test";
import { ApiRequestError, getSettingsSnapshot, getWorkspace, listPlanHistory, refreshPlanRoutes } from "./api-client.js";

test("refreshPlanRoutes posts the requested route refresh body to the Plan endpoint", async () => {
  const originalFetch = globalThis.fetch;
  let observed: { input: string | URL | Request; init: RequestInit | undefined } | undefined;
  globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    observed = { input, init };
    return new Response(JSON.stringify({
      workspace: { activePlan: { id: "plan-1", version: 5 } },
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

test("getWorkspace surfaces the core service diagnostic message", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async () => new Response(JSON.stringify({ message: "The local workspace is not initialized." }), { status: 500, headers: { "content-type": "application/json" } })) as typeof fetch;

  try {
    await assert.rejects(
      () => getWorkspace(),
      (error: unknown) => error instanceof ApiRequestError && error.message === "The local workspace is not initialized."
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

test("optional workspace detail requests degrade quietly on network failure", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async () => { throw new TypeError("Failed to fetch"); }) as typeof fetch;

  try {
    assert.equal(await listPlanHistory(), undefined);
    assert.deepEqual(await getSettingsSnapshot(), {});
  } finally {
    globalThis.fetch = originalFetch;
  }
});
