import type { FastifyInstance } from "fastify";
import type { SqliteWorkspaceStore } from "@c-assistant/storage";

export function registerMaintenanceRoutes(server: FastifyInstance, dependencies: { store: SqliteWorkspaceStore }): void {
  const { store } = dependencies;
  let creatingBackup = false;

  server.get("/api/runs", async () => store.listRecentAgentRuns());
  server.get("/api/runs/task-reminders", async () => store.listRecentTaskReminderRuns());
  server.get("/api/runs/plan-compilations", async () => store.listRecentPlanCompilationRuns());
  server.get("/api/runs/country-pack-skills", async () => store.listRecentCountryPackSkillRuns());
  server.get("/api/maintenance", async () => store.getDatabaseMaintenanceStatus());
  server.post("/api/backups", async (_request, reply) => {
    if (creatingBackup) return reply.code(409).send({ error: "A local backup is already being created." });
    try {
      creatingBackup = true;
      return store.createBackup();
    } catch (error) {
      return reply.code(500).send({ error: error instanceof Error ? error.message : "The local backup could not be created." });
    } finally {
      creatingBackup = false;
    }
  });
}
