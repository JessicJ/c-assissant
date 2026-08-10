import type { ConnectorResult } from "@c-assistant/connectors";
import { listChinaDigitalLifeSourceIds, listChinaLocalFoodSourceIds } from "@c-assistant/china-country-pack/reference-catalog";
import type { SourceSnapshot, SourceSnapshotWriteResult, WorkspaceSnapshot } from "@c-assistant/core";

export interface ChinaOfficialSourceRefresher {
  refresh(input: { sourceId: string }): Promise<ConnectorResult<SourceSnapshotWriteResult>>;
}

export interface ChinaSourcePreparationStore {
  getWorkspace(): WorkspaceSnapshot;
  linkSourceSnapshotToPlan(planId: string, sourceSnapshotId: string): WorkspaceSnapshot;
}

export interface ChinaSourcePreparationItem {
  sourceId: string;
  status: "ready" | "unavailable";
  origin?: "cache" | "refresh";
  linkedToPlan: boolean;
  failureCode?: "refresh_failed";
}

export type ChinaSourcePreparationResult =
  | { status: "ready"; workspace: WorkspaceSnapshot; sources: ChinaSourcePreparationItem[] }
  | { status: "blocked"; reasonCode: "invalid_now" | "plan_not_draft" | "plan_changed" | "critical_source_unavailable"; message: string; sources: ChinaSourcePreparationItem[] };

const HOUR_MS = 60 * 60 * 1_000;

/** Refreshes only allowlisted source IDs and links every evidence version used by the exact draft. */
export function createChinaSourcePreparationService(input: { store: ChinaSourcePreparationStore; refresher: ChinaOfficialSourceRefresher }) {
  return {
    async prepareCurrentPlan(options: { planId: string; now?: string }): Promise<ChinaSourcePreparationResult> {
      const now = options.now ?? new Date().toISOString();
      const nowMs = Date.parse(now);
      if (!Number.isFinite(nowMs)) return blocked("invalid_now", "Source preparation requires a valid current instant.", []);
      const initial = input.store.getWorkspace();
      if (initial.activePlan.id !== options.planId || initial.activePlan.status !== "draft") {
        return blocked("plan_not_draft", "Only the exact current draft Plan can receive refreshed China sources.", []);
      }
      const requirements = [
        { sourceId: "nia-english", critical: true, linkToPlan: true, maxAgeMs: 6 * HOUR_MS },
        ...listChinaDigitalLifeSourceIds().map((sourceId) => ({ sourceId, critical: false, linkToPlan: true, maxAgeMs: 24 * HOUR_MS })),
        ...listChinaLocalFoodSourceIds(initial.activePlan.location).map((sourceId) => ({ sourceId, critical: false, linkToPlan: true, maxAgeMs: 24 * HOUR_MS }))
      ];

      const results: ChinaSourcePreparationItem[] = [];
      for (const requirement of requirements) {
        const currentSnapshots = input.store.getWorkspace().sourceSnapshots;
        const cached = latestFreshSnapshot(currentSnapshots, requirement.sourceId, nowMs, requirement.maxAgeMs);
        let snapshot = cached;
        let origin: "cache" | "refresh" = "cache";
        if (!snapshot) {
          origin = "refresh";
          try {
            const refreshed = await input.refresher.refresh({ sourceId: requirement.sourceId });
            snapshot = refreshed.status === "available" ? refreshed.data?.snapshot : undefined;
          } catch {
            snapshot = undefined;
          }
        }
        if (!snapshot) {
          results.push({ sourceId: requirement.sourceId, status: "unavailable", linkedToPlan: false, failureCode: "refresh_failed" });
          if (requirement.critical) return blocked("critical_source_unavailable", "Current National Immigration Administration evidence could not be prepared. The Plan was not changed.", results);
          continue;
        }

        let linkedToPlan = false;
        if (requirement.linkToPlan) {
          const current = input.store.getWorkspace();
          if (current.activePlan.id !== options.planId || current.activePlan.status !== "draft") {
            return blocked("plan_changed", "The Plan changed while official sources were being prepared.", results);
          }
          const alreadyLinked = current.activePlan.sources.some((source) => source.sourceSnapshotId === snapshot!.id && source.contentHash === snapshot!.contentHash);
          if (!alreadyLinked) {
            try {
              input.store.linkSourceSnapshotToPlan(options.planId, snapshot.id);
            } catch {
              return blocked("plan_changed", "The Plan changed before official evidence could be linked.", results);
            }
          }
          linkedToPlan = true;
        }
        results.push({ sourceId: requirement.sourceId, status: "ready", origin, linkedToPlan });
      }
      return { status: "ready", workspace: input.store.getWorkspace(), sources: results };
    }
  };
}

function latestFreshSnapshot(snapshots: SourceSnapshot[], sourceId: string, nowMs: number, maxAgeMs: number): SourceSnapshot | undefined {
  return snapshots.filter((snapshot) => snapshot.sourceId === sourceId && Number.isFinite(Date.parse(snapshot.retrievedAt)))
    .sort((left, right) => Date.parse(right.retrievedAt) - Date.parse(left.retrievedAt))
    .find((snapshot) => Date.parse(snapshot.retrievedAt) <= nowMs + 5 * 60_000 && Date.parse(snapshot.retrievedAt) >= nowMs - maxAgeMs);
}

function blocked(reasonCode: Extract<ChinaSourcePreparationResult, { status: "blocked" }>["reasonCode"], message: string, sources: ChinaSourcePreparationItem[]): ChinaSourcePreparationResult {
  return { status: "blocked", reasonCode, message, sources };
}
