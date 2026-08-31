import type { ConnectorResult } from "@c-assistant/connectors";
import { listJapanPolicySourceIds, listJapanReferenceSourceIds } from "@c-assistant/japan-country-pack/reference-catalog";
import type { SourceSnapshot, SourceSnapshotWriteResult, WorkspaceSnapshot } from "@c-assistant/core";

export interface JapanSourceStore { getWorkspace(): WorkspaceSnapshot; linkSourceSnapshotToPlan(planId: string, sourceSnapshotId: string): WorkspaceSnapshot }
export interface JapanSourceRefresher { refresh(input: { sourceId: string }): Promise<ConnectorResult<SourceSnapshotWriteResult>> }
export interface JapanSourceItem { sourceId: string; status: "ready" | "unavailable"; linkedToPlan: boolean; origin?: "cache" | "refresh" }
export type JapanSourcePreparationResult = { status: "ready"; workspace: WorkspaceSnapshot; sources: JapanSourceItem[] } | { status: "blocked"; reasonCode: string; message: string; sources: JapanSourceItem[] };

export function createJapanSourcePreparationService(input: { store: JapanSourceStore; refresher: JapanSourceRefresher }) {
  return { async prepareCurrentPlan(options: { planId: string; now?: string }): Promise<JapanSourcePreparationResult> {
    const nowMs = Date.parse(options.now ?? new Date().toISOString());
    if (!Number.isFinite(nowMs)) return blocked("invalid_now", "Source preparation requires a valid current instant.", []);
    const initial = input.store.getWorkspace();
    if (initial.activePlan.id !== options.planId || initial.activePlan.status !== "draft") return blocked("plan_not_draft", "Only the exact current draft Plan can receive Japan sources.", []);
    const critical = new Set(listJapanPolicySourceIds());
    const sourceIds = [...new Set([...critical, ...listJapanReferenceSourceIds()])];
    const results: JapanSourceItem[] = [];
    for (const sourceId of sourceIds) {
      let snapshot = fresh(input.store.getWorkspace().sourceSnapshots, sourceId, nowMs, critical.has(sourceId) ? 6 * 60 * 60_000 : 24 * 60 * 60_000);
      let origin: "cache" | "refresh" = "cache";
      if (!snapshot) {
        origin = "refresh";
        try { const result = await input.refresher.refresh({ sourceId }); snapshot = result.status === "available" ? result.data?.snapshot : undefined; } catch { snapshot = undefined; }
      }
      if (!snapshot) {
        results.push({ sourceId, status: "unavailable", linkedToPlan: false });
        if (critical.has(sourceId)) return blocked("critical_source_unavailable", "Current MOFA evidence could not be prepared; the Plan was not changed.", results);
        continue;
      }
      const current = input.store.getWorkspace();
      if (current.activePlan.id !== options.planId || current.activePlan.status !== "draft") return blocked("plan_changed", "The Plan changed while Japan sources were being prepared.", results);
      if (!current.activePlan.sources.some((item) => item.sourceSnapshotId === snapshot!.id && item.contentHash === snapshot!.contentHash)) {
        try { input.store.linkSourceSnapshotToPlan(options.planId, snapshot.id); } catch { return blocked("plan_changed", "The Plan changed before Japan evidence could be linked.", results); }
      }
      results.push({ sourceId, status: "ready", linkedToPlan: true, origin });
    }
    return { status: "ready", workspace: input.store.getWorkspace(), sources: results };
  } };
}
function fresh(items: SourceSnapshot[], sourceId: string, now: number, maxAge: number): SourceSnapshot | undefined { return items.filter((item) => item.sourceId === sourceId && Date.parse(item.retrievedAt) <= now + 5 * 60_000 && Date.parse(item.retrievedAt) >= now - maxAge).sort((a, b) => Date.parse(b.retrievedAt) - Date.parse(a.retrievedAt))[0]; }
function blocked(reasonCode: string, message: string, sources: JapanSourceItem[]): JapanSourcePreparationResult { return { status: "blocked", reasonCode, message, sources }; }
