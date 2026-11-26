import { registerMahReadinessRoute } from "./mah-readiness-route.js";
import { buildMahReadinessReport } from "./mah-readiness-report.js";
import { productionReadiness } from "./production-readiness.js";
import { createEmailTransportFromEnvironment } from "./email-transport.js";
import type { FastifyInstance } from "fastify";
import { RuntimeAdapterError, type RuntimeCheck, type RuntimeKind } from "@c-assistant/agent-adapters";
import type { RuntimeSelectionUpdate } from "@c-assistant/core";
import type { SqliteWorkspaceStore } from "@c-assistant/storage";
import { runtimeName } from "./runtime-display.js";
import { assessSetupReadiness } from "./setup-readiness.js";

type RuntimeHealthAdapter = {
  check(): Promise<RuntimeCheck>;
};

type LocalConfigurationSnapshot = {
  google: { configured: boolean };
};

export function registerRuntimeRoutes(server: FastifyInstance, dependencies: {
  store: SqliteWorkspaceStore;
  runtimes: Record<RuntimeKind, RuntimeHealthAdapter>;
  getLocalConfiguration: () => LocalConfigurationSnapshot;
  conversationSubmissionConfigured?: boolean;
  getMahDiagnostics?: () => Promise<Omit<ReturnType<typeof buildMahReadinessReport>, "evidenceMode"> & { evidenceMode: string }>;
}): void {
  const { store, runtimes, getLocalConfiguration } = dependencies;

  registerMahReadinessRoute(server, dependencies.getMahDiagnostics, dependencies.conversationSubmissionConfigured === true);

  server.get("/api/runtimes/codex", async () => runtimes.codex.check());
  server.get("/api/runtimes/claude-code", async () => runtimes["claude-code"].check());
  server.get("/api/runtimes", async () => Promise.all([runtimes.codex.check(), runtimes["claude-code"].check()]));

  server.post<{ Params: { kind: string } }>("/api/runtimes/:kind/test", async (request, reply) => {
    const selected = runtimeForKind(request.params.kind, runtimes);
    if (!selected) return reply.code(400).send({ error: "Unsupported runtime." });
    try {
      const health = await selected.runtime.check();
      const { kind } = selected;
      if (!health.installed) throw new RuntimeAdapterError("not_installed", health.message ?? `${runtimeName(kind)} is not installed.`);
      if (!health.authenticated) throw new RuntimeAdapterError("not_authenticated", health.message ?? `${runtimeName(kind)} is not authenticated.`);
      return {
        ok: true,
        message: kind === "codex"
          ? "Codex is installed and authenticated. Blueprint generation will verify the Interactive Trip Planner Skill when a confirmed proposal starts."
          : "Claude Code is installed and authenticated. Blueprint generation currently requires Codex and will not fall back to the legacy Plan generator."
      };
    } catch (error) {
      return reply.code(error instanceof RuntimeAdapterError && (error.code === "not_installed" || error.code === "not_authenticated") ? 503 : 400).send({ error: error instanceof Error ? error.message : "Runtime test failed." });
    }
  });

  server.get("/api/setup-readiness", async () => {
    const workspace = store.getWorkspace();
    const configuration = getLocalConfiguration();
    const runtimeChecks = await Promise.all([runtimes.codex.check(), runtimes["claude-code"].check()]);
    const diagnostic = assessSetupReadiness({
      profileStatus: workspace.profile.status,
      selectedRuntime: workspace.runtime.selectedKind,
      runtimeChecks,
      googleConfigured: configuration.google.configured,
      emailConfigured: createEmailTransportFromEnvironment().configured(),
      emailVerified: store.email.settings().verified
    });
    const items = diagnostic.items.map(item => item.id === "runtime" ? { ...item, status: "needs_attention" as const, label: "MAH integration", detail: "Local Agent login does not verify MAH readiness. Plan generation and continuous operation are not ready for use." } : item);
    return { ...diagnostic, status: "needs_attention", items, readyCount: items.filter(item => item.status === "ready").length, nextAction: items.find(item => item.status === "needs_attention")!.detail, production: productionReadiness() };
  });

  server.put<{ Body: RuntimeSelectionUpdate }>("/api/runtime", async (request, reply) => {
    try {
      return store.updateRuntimeSelection(request.body);
    } catch (error) {
      return reply.code(400).send({ error: error instanceof Error ? error.message : "The Plan runtime could not be selected." });
    }
  });
}

function runtimeForKind(kind: string, runtimes: Record<RuntimeKind, RuntimeHealthAdapter>): { kind: RuntimeKind; runtime: RuntimeHealthAdapter } | undefined {
  if (kind !== "codex" && kind !== "claude-code") return undefined;
  return { kind, runtime: runtimes[kind] };
}
