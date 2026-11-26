import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { checkMahCodexReadiness } from "./mah-readiness.js";
import { assertMahMaterializationContract } from "./mah-materialization-contract.js";
import { productionReadiness } from "./production-readiness.js";

const projectRoot = "/fictional/landi-project";
function setup() {
  return { schema_version: 1, projection_kind: "setup_readiness", overall_status: "ready", git: { state: "ready" }, dependencies: [
    { dependency_id: "codex", category: "agent_cli", probe_status: "ready", authentication_status: "authenticated" },
    { dependency_id: "claude", category: "agent_cli", probe_status: "probe_failed", authentication_status: "unknown" }
  ] };
}
function model(enabled_state = "configured_enabled", channel = "native_schema_constrained_generation") {
  return { model_id: "fictional-model", enabled_state, runtime_profile: "codex-cli", capabilities: { output_channel: [channel] } };
}
function capabilities() {
  return { protocol: "mah/1", message_type: "capability_report", agent: { agent_id: "codex" }, constraints: { availability: "available" }, capabilities: { models: [model()] } };
}
function queryWith(setupResult: unknown = setup(), report: unknown = capabilities()) {
  const calls: string[][] = [];
  return { calls, query: async (args: string[]) => {
    calls.push([...args]);
    if (args[0] === "setup") return setupResult;
    if (args[0] === "capabilities") return report;
    throw new Error("Unexpected command; no process runner is available in this test");
  } };
}
const hasCode = (code: string) => (error: unknown) => error instanceof Error && "code" in error && error.code === code;

test("current public reports pass using only setup and project-scoped Codex capabilities", async () => {
  const mock = queryWith();
  await checkMahCodexReadiness(mock.query, projectRoot);
  assert.deepEqual(mock.calls, [
    ["setup", "status", "--format", "json"],
    ["capabilities", "--agent", "codex", "--project-root", projectRoot, "--format", "json"]
  ]);
  assert.deepEqual(productionReadiness(), {
    status: "blocked", code: "public_mah_contract_unverified", conversation: false, generation: false,
    revision: false, unattendedEmail: false, hosting: false
  });
});

test("overall readiness cannot hide a missing, duplicate, wrong-category or unauthenticated Codex", async () => {
  for (const change of [
    (value: ReturnType<typeof setup>) => { value.dependencies = value.dependencies.filter((item) => item.dependency_id !== "codex"); return "mah_codex_setup_invalid"; },
    (value: ReturnType<typeof setup>) => { value.dependencies.push({ ...value.dependencies[0]! }); return "mah_codex_setup_invalid"; },
    (value: ReturnType<typeof setup>) => { value.dependencies[0]!.category = "other"; return "mah_codex_setup_invalid"; },
    (value: ReturnType<typeof setup>) => { value.dependencies[0]!.authentication_status = "unknown"; return "mah_codex_not_ready"; },
    (value: ReturnType<typeof setup>) => { value.dependencies[0]!.probe_status = "missing"; return "mah_codex_not_ready"; },
    (value: ReturnType<typeof setup>) => { value.git.state = "missing"; return "mah_git_not_ready"; },
    (value: ReturnType<typeof setup>) => { value.overall_status = "blocked"; return "mah_setup_not_ready"; }
  ]) {
    const value = setup(), code = change(value), mock = queryWith(value);
    await assert.rejects(checkMahCodexReadiness(mock.query, projectRoot), hasCode(code));
    assert.equal(mock.calls.length, 1);
  }
});

test("unknown or incomplete setup structures fail closed without querying capabilities", async () => {
  for (const value of [null, [], {}, { ...setup(), schema_version: 2 }, { ...setup(), projection_kind: "other" }, { ...setup(), dependencies: {} }]) {
    const mock = queryWith(value);
    await assert.rejects(checkMahCodexReadiness(mock.query, projectRoot), hasCode("mah_setup_schema_unsupported"));
    assert.equal(mock.calls.length, 1);
  }
});

test("capability protocol, identity, availability and model structures are validated", async () => {
  for (const value of [null, {}, { ...capabilities(), protocol: "mah/2" }, { ...capabilities(), message_type: "other" },
    { ...capabilities(), agent: { agent_id: "claude" } }, { ...capabilities(), capabilities: { models: {} } },
    { ...capabilities(), capabilities: { models: [model("unknown")] } },
    { ...capabilities(), capabilities: { models: [model(), model()] } }]) {
    const mock = queryWith(setup(), value);
    await assert.rejects(checkMahCodexReadiness(mock.query, projectRoot), hasCode("mah_capability_schema_unsupported"));
  }
  const mock = queryWith(setup(), { ...capabilities(), constraints: { availability: "unavailable" } });
  await assert.rejects(checkMahCodexReadiness(mock.query, projectRoot), hasCode("mah_capability_unavailable"));
});

test("disabled models and strings outside candidate output channels cannot establish support", async () => {
  for (const models of [[], [model("family_disabled")], [{ ...model(), runtime_profile: "other-cli" }],
    [{ ...model(), capabilities: { output_channel: ["text"], note: "native_schema_constrained_generation" } }],
    [model("family_disabled"), { ...model("configured_enabled", "text"), model_id: "enabled-without-schema" }]]) {
    const mock = queryWith(setup(), { ...capabilities(), capabilities: { models } });
    await assert.rejects(checkMahCodexReadiness(mock.query, projectRoot), hasCode("mah_capability_unavailable"));
  }
  const mock = queryWith(setup(), { ...capabilities(), capabilities: { models: [model("family_disabled"), { ...model(), model_id: "enabled" }] } });
  await checkMahCodexReadiness(mock.query, projectRoot);
});

test("query failures propagate and do not advance to further checks", async () => {
  for (const failAt of ["setup", "capabilities"]) {
    const sentinel = new Error("Fictional CLI query failed"), calls: string[][] = [];
    await assert.rejects(checkMahCodexReadiness(async (args) => {
      calls.push(args);
      if (args[0] === failAt) throw sentinel;
      return setup();
    }, projectRoot), (error) => error === sentinel);
    assert.equal(calls.length, failAt === "setup" ? 1 : 2);
  }
});

test("宿主就绪不能解除公共合同门禁，普通队列保留公开结果与执行来源核验", async () => {
  // 宿主诊断只确认候选能力；公开物化合同由业务 gateway 的独立门禁拥有。
  await checkMahCodexReadiness(queryWith().query, projectRoot);
  assert.throws(assertMahMaterializationContract, hasCode("mah_task_materialization_contract_unverified"));
  assert.deepEqual(productionReadiness(), {
    status: "blocked", code: "public_mah_contract_unverified", conversation: false, generation: false,
    revision: false, unattendedEmail: false, hosting: false
  });
  const gateway = readFileSync(new URL("mah-business-gateway.ts", import.meta.url), "utf8");
  assert.match(gateway, /else assertMahMaterializationContract\(\)/);
  assert.match(gateway, /await this\.assertPublicContract\(request\)/);

  // 权威设计的普通队列由 MAH 路由，不重接本地 Codex 或旧 execution-carriers 协议。
  const transport = readFileSync(new URL("mah-cli-transport.ts", import.meta.url), "utf8");
  assert.doesNotMatch(transport, /checkMahCodexReadiness|CodexRuntimeAdapter|codex-cli|execution-carriers|\["health"|containsValue\(/);
  assert.match(transport, /new MahBusinessPublicResultReader\(/);
  assert.match(transport, /await createMahPublicReceiptVerifier\(/);
});
