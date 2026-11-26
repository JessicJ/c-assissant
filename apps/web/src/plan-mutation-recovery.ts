import { safePlanError } from "./api-client.js";
import type { Plan, WorkspaceSnapshot } from "@c-assistant/core";
import type { PendingItineraryEditDisplay } from "./landi-blueprint-workspace-display.js";

export type StagedItineraryDraft = {
  planId: string;
  version: number;
  edits: PendingItineraryEditDisplay[];
};

export const staleItineraryDraftMessage = "The plan changed. Your staged itinerary edits have been kept with their original version. Review them before applying; cancel them to start editing the latest plan.";

export function stagedItineraryMatches(draft: StagedItineraryDraft | null, plan: Pick<Plan, "id" | "version">): boolean {
  return !draft || (draft.planId === plan.id && draft.version === plan.version);
}

export function updateStagedItineraryDraft(draft: StagedItineraryDraft | null, plan: Pick<Plan, "id" | "version">, update: PendingItineraryEditDisplay[] | ((current: PendingItineraryEditDisplay[]) => PendingItineraryEditDisplay[])): StagedItineraryDraft | null {
  const edits = typeof update === "function" ? update(draft?.edits ?? []) : update;
  if (!edits.length) return null;
  return { planId: draft?.planId ?? plan.id, version: draft?.version ?? plan.version, edits };
}

/** Reads current truth after a mutation error; it neither retries nor attributes success. */
export async function reconcilePlanMutationFailure(caught: unknown, dependencies: {
  read: () => Promise<WorkspaceSnapshot>;
  publish: (workspace: WorkspaceSnapshot) => void | Promise<void>;
}): Promise<string> {
  const detail = safePlanError(caught);
  try {
    const current = await dependencies.read();
    await dependencies.publish(current);
    return `${detail} The latest plan is displayed. The original operation is still unconfirmed; it has not been submitted again.`;
  } catch {
    return `${detail} The latest plan could not be loaded. The original operation result is still unknown; it has not been submitted again.`;
  }
}
