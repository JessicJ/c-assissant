import { MahCarrierError } from "./mah-generation-contract.js";

type ReadinessQuery = (args: string[]) => Promise<unknown>;
const record = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value);
const text = (value: unknown): value is string => typeof value === "string" && Boolean(value.trim());

/** Host prerequisites and advertised candidates only; never grants production readiness. */
export async function checkMahCodexReadiness(query: ReadinessQuery, projectRoot: string): Promise<void> {
  const setup = await query(["setup", "status", "--format", "json"]);
  if (!record(setup) || setup.schema_version !== 1 || setup.projection_kind !== "setup_readiness"
    || !text(setup.overall_status) || !record(setup.git) || !text(setup.git.state)
    || !Array.isArray(setup.dependencies) || !setup.dependencies.every(record)) {
    throw new MahCarrierError("mah_setup_schema_unsupported", "MAH 就绪报告结构不受支持，已停止准入检查。");
  }
  const codex = setup.dependencies.filter((item) => item.dependency_id === "codex");
  if (codex.length !== 1 || codex[0]!.category !== "agent_cli" || !text(codex[0]!.probe_status) || !text(codex[0]!.authentication_status)) {
    throw new MahCarrierError("mah_codex_setup_invalid", "MAH 就绪报告未提供唯一、完整的 Codex 状态。");
  }
  if (setup.git.state !== "ready") throw new MahCarrierError("mah_git_not_ready", "MAH 的 Git 尚未就绪。");
  if (codex[0]!.probe_status !== "ready" || codex[0]!.authentication_status !== "authenticated") {
    throw new MahCarrierError("mah_codex_not_ready", "MAH 的 Codex 尚未就绪或未确认登录，请在 MAH 中检查 Codex。");
  }
  if (setup.overall_status !== "ready") throw new MahCarrierError("mah_setup_not_ready", "MAH 的整体设置尚未就绪。");

  const report = await query(["capabilities", "--agent", "codex", "--project-root", projectRoot, "--format", "json"]);
  if (!record(report) || report.protocol !== "mah/1" || report.message_type !== "capability_report"
    || !record(report.agent) || report.agent.agent_id !== "codex"
    || !record(report.constraints) || !text(report.constraints.availability)
    || !record(report.capabilities) || !Array.isArray(report.capabilities.models)) {
    throw new MahCarrierError("mah_capability_schema_unsupported", "MAH Codex 能力报告的协议、身份或结构不受支持。");
  }
  if (report.constraints.availability !== "available") throw new MahCarrierError("mah_capability_unavailable", "MAH 报告 Codex 当前不可用。");
  const models = report.capabilities.models;
  const identities = new Set<string>();
  for (const model of models) {
    if (!record(model) || !text(model.model_id) || identities.has(model.model_id)
      || !["configured_enabled", "family_disabled"].includes(String(model.enabled_state)) || !text(model.runtime_profile)) {
      throw new MahCarrierError("mah_capability_schema_unsupported", "MAH 模型候选的身份或启用状态无效，已停止准入检查。");
    }
    identities.add(model.model_id);
  }
  const candidates = models.filter((model) => record(model) && model.enabled_state === "configured_enabled" && model.runtime_profile === "codex-cli");
  if (!candidates.some((model) => record(model) && record(model.capabilities)
    && Array.isArray(model.capabilities.output_channel) && model.capabilities.output_channel.every(text)
    && model.capabilities.output_channel.includes("native_schema_constrained_generation"))) {
    throw new MahCarrierError("mah_capability_unavailable", "MAH 未声明具有原生结构化输出能力的已启用 Codex 候选。");
  }
  // This is not a routing receipt, materialization proof, or permission to submit a task.
}
