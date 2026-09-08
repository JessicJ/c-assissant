import assert from "node:assert/strict";
import test from "node:test";

import { checkWorkspace, parseArgs } from "./check-workspace.mjs";

const completeWorkspace = {
  profile: { status: "ready" },
  runtime: { selectedKind: "codex" },
  activePlan: { id: "plan-1", version: 1 }
};

function jsonResponse(payload, status = 200) {
  return new Response(JSON.stringify(payload), { status, headers: { "content-type": "application/json" } });
}

test("workspace check passes when web, core, proxy health, and workspace data respond", async () => {
  const seen = [];
  const result = await checkWorkspace({
    fetch: async (url) => {
      seen.push(String(url));
      if (String(url) === "http://127.0.0.1:5173") return new Response("<html></html>");
      if (String(url) === "http://127.0.0.1:8787/health") return jsonResponse({ status: "ok" });
      if (String(url) === "http://127.0.0.1:5173/health") return jsonResponse({ status: "ok" });
      if (String(url) === "http://127.0.0.1:5173/api/workspace") return jsonResponse(completeWorkspace);
      return new Response("missing", { status: 404 });
    }
  });

  assert.equal(result.ok, true);
  assert.deepEqual(result.failures, []);
  assert.ok(seen.includes("http://127.0.0.1:5173/api/workspace"));
});

test("workspace check detects the root dev core port", async () => {
  const result = await checkWorkspace({
    fetch: async (url) => {
      if (String(url) === "http://127.0.0.1:5173") return new Response("<html></html>");
      if (String(url) === "http://127.0.0.1:8787/health") throw new TypeError("connect failed");
      if (String(url) === "http://127.0.0.1:8877/health") return jsonResponse({ status: "ok" });
      if (String(url) === "http://127.0.0.1:5173/health") return jsonResponse({ status: "ok" });
      if (String(url) === "http://127.0.0.1:5173/api/workspace") return jsonResponse(completeWorkspace);
      return new Response("missing", { status: 404 });
    }
  });

  assert.equal(result.ok, true);
  assert.match(result.lines.join("\n"), /8877\/health/);
});

test("workspace check reports incomplete workspace data", async () => {
  const result = await checkWorkspace({
    fetch: async (url) => {
      if (String(url) === "http://127.0.0.1:5173") return new Response("<html></html>");
      if (String(url) === "http://127.0.0.1:8787/health") return jsonResponse({ status: "ok" });
      if (String(url) === "http://127.0.0.1:5173/health") return jsonResponse({ status: "ok" });
      if (String(url) === "http://127.0.0.1:5173/api/workspace") return jsonResponse({ profile: { status: "ready" } });
      return new Response("missing", { status: 404 });
    }
  });

  assert.equal(result.ok, false);
  assert.match(result.failures.join("\n"), /Workspace data is incomplete/);
});

test("workspace check options parse explicit urls and timeout", () => {
  const parsed = parseArgs(["--web-url", "http://localhost:3000/", "--core-url=http://localhost:9000/", "--timeout-ms", "250"]);
  assert.deepEqual(parsed, {
    webUrl: "http://localhost:3000",
    coreUrl: "http://localhost:9000",
    corePort: "",
    timeoutMs: 250
  });
});
