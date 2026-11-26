import { useEffect, useRef, useState } from "react";
import type { DestinationArrivalEvent, DirectBlueprintReplanRequirement, DirectBlueprintRevisionBatchMetadata, Plan, PlanChangeSet, PlanReplacementAudit, TripBlueprint, WorkspaceSnapshot } from "@c-assistant/core";
import { abandonActivePlan, ApiRequestError, isDefiniteMutationRejection, safePlanError, getDirectBlueprintReceipt, applyDirectBlueprintRevisionBatch, deletePlan, getWorkspace, prepareDirectBlueprintAssistedReplanning, refreshPlanRoutes, sendAgentChat, undoDirectBlueprintRevision, undoPlanReplacement, type DirectBlueprintRevisionInput, type DirectBlueprintRevisionBatchRequest } from "./api-client.js";
import { blueprintOperationDigest, validatePendingBlueprintOperation, acknowledgeBlueprintOperation, clearPendingBlueprintOperation, persistPendingBlueprintOperation, readPendingBlueprintOperation, receiptMatchesOperation, unknownBlueprintOperationMessage, type PendingBlueprintOperation, type SubmittedDraft } from "./direct-blueprint-recovery.js";
import { reconcilePlanMutationFailure } from "./plan-mutation-recovery.js";
import { BookingImportPanel } from "./BookingImportPanel.js";
import { getBookingRelationshipReview } from "./api-client.js";
import { rebaseReviewedBlueprintDraft, reviewRecoveryBinding } from "./direct-blueprint-recovery.js";
import { LandiBlueprintWorkspace } from "./LandiBlueprintWorkspace.js";
import { PlanMapWorkspace } from "./PlanMapWorkspace.js";
import { PlanChangeNotice, PlanCommandCenter, PlanDecisionBoard, PlanGrounding, PlanReplacementNotice } from "./PlanStatusWidgets.js";
import { PlanRemindersView, PlanSourcesView, WorkspaceEmpty } from "./PlanSupportingViews.js";
import { FeaturedChecklist, FeaturedTimeline, PlanContentSection } from "./PlanTaskSections.js";
import { currentPlanReadModel } from "./current-plan-read-model.js";
import { routeRefreshCompletedStatus, routeRefreshUncheckedStatus, routeRefreshWorkingStatus } from "./current-plan-route-refresh.js";
import { appliedItineraryRevisionSummary, compactPendingItineraryEdits, type ItineraryRouteRefreshDisplay, type PendingItineraryEditDisplay } from "./landi-blueprint-workspace-display.js";
import { planRefinementQuestion } from "./plan-display.js";
import { visibleDocumentPolicySources } from "./plan-external-display.js";
import { isExplicitPreparationTask } from "./plan-preparation-display.js";
import { displayPlanTitle } from "./trip-title.js";
import type { AgentStatus } from "./ui-types.js";

type PlanWorkspaceView = "plan" | "preparation" | "bookings" | "decisions" | "reminders" | "sources";

function itineraryRevisionImpactStatus(revision: DirectBlueprintRevisionBatchMetadata, presentation?: Plan["presentation"]): string {
  return appliedItineraryRevisionSummary(revision, presentation).statusText;
}

function directBlueprintRevisionInputs(edits: PendingItineraryEditDisplay[]): DirectBlueprintRevisionInput[] {
  return edits.map((edit) => edit.kind === "remove_place_from_day"
    ? { kind: edit.kind, placeId: edit.placeId, dayId: edit.dayId }
    : {
      kind: edit.kind,
      placeId: edit.placeId,
      dayId: edit.dayId,
      position: edit.position!
    });
}

export function CurrentPlan({ plan, blueprint, latestDirectBlueprintRevision, destinationArrivals, latestPlanChange, latestPlanReplacement, onRevise, onTaskToggle, onTaskReorder, onUndoChange, onConfirm, onWorkspace, onStatus, onError, onOperationBusy, confirming }: { plan: Plan; blueprint?: TripBlueprint | undefined; latestDirectBlueprintRevision?: WorkspaceSnapshot["latestDirectBlueprintRevision"] | undefined; destinationArrivals: DestinationArrivalEvent[]; latestPlanChange?: PlanChangeSet | undefined; latestPlanReplacement?: PlanReplacementAudit | undefined; onRevise: (message?: string) => void; onTaskToggle: (planId: string, taskId: string, checked: boolean) => Promise<void>; onTaskReorder: (planId: string, taskId: string, direction: "up" | "down") => Promise<void>; onUndoChange: (planId: string, changeId: string) => Promise<void>; onConfirm: (planId: string) => Promise<void>; onWorkspace: (workspace: WorkspaceSnapshot) => Promise<void>; onStatus: (status: AgentStatus) => void; onError: (message: string) => void; onOperationBusy: (busy: boolean) => void; confirming: boolean }) {
  const planReadModel = currentPlanReadModel(plan, blueprint);
  plan = planReadModel.plan;
  const presentation = planReadModel.presentation;
  const [restoredOperation] = useState(() => {
    try { return { pending: readPendingBlueprintOperation(sessionStorage), unreadable: false }; }
    catch { return { pending: null, unreadable: true }; }
  });
  const [pendingOperation, setPendingOperation] = useState<PendingBlueprintOperation | null>(restoredOperation.pending);
  const recoveryUnreadable = restoredOperation.unreadable;
  const mutationBlocked = Boolean(pendingOperation) || recoveryUnreadable;
  const pendingOperationRef = useRef(pendingOperation);
  const mutationStartingRef = useRef(false);
  const [acknowledgedDraft, setAcknowledgedDraft] = useState<SubmittedDraft | undefined>();
  const [rebasedDraft, setRebasedDraft] = useState<SubmittedDraft | undefined>();
  const [checkingPending, setCheckingPending] = useState(false);
  function rememberOperation(operation: PendingBlueprintOperation) {
    const saved = persistPendingBlueprintOperation(sessionStorage, operation);
    pendingOperationRef.current = saved; setPendingOperation(saved); return saved;
  }
  function forgetOperation(operation: PendingBlueprintOperation) {
    clearPendingBlueprintOperation(sessionStorage, operation);
    pendingOperationRef.current = null; setPendingOperation(null);
  }
  function acknowledgeOperation(operation: PendingBlueprintOperation) {
    acknowledgeBlueprintOperation(sessionStorage, operation);
    pendingOperationRef.current = null; setPendingOperation(null);
    // 原操作已核实，先清除旧未知提示，再保留随后工作区加载的真实错误。
    onError("");
    if (operation.draft) setAcknowledgedDraft(operation.draft);
  }
  async function publishCommittedWorkspace(workspace: WorkspaceSnapshot) {
    try { await onWorkspace(workspace); }
    catch { onError("The operation is confirmed, but the workspace could not be updated. Refresh to see the current plan."); }
  }
  async function recoverOperation(operation: PendingBlueprintOperation, onCommitted?: () => void): Promise<boolean> {
    await validatePendingBlueprintOperation(operation);
    const receipt = await getDirectBlueprintReceipt(operation.identity);
    if (!receiptMatchesOperation(receipt, operation) || receipt.status !== "committed") return false;
    let draftNeedsReview = false;
    if (operation.reviewRebase && receipt.workspace.activePlan && receipt.workspace.activeBlueprint) {
      const context = await getBookingRelationshipReview(receipt.workspace.activePlan, receipt.workspace.activeBlueprint);
      const rebased = rebaseReviewedBlueprintDraft(sessionStorage, operation, receipt, context);
      if (rebased) setRebasedDraft(rebased);
      else draftNeedsReview = true;
    }
    acknowledgeOperation(operation); onCommitted?.();
    onStatus({ tone: "success", text: draftNeedsReview ? "The booking link review is saved. Your original edits have been kept. Review them against the current itinerary before previewing again." : operation.identity.operation === "save" ? "Confirmed: your previous changes were saved and the current plan is updated." : "Confirmed: your previous undo completed and the current plan is updated." });
    await publishCommittedWorkspace(receipt.workspace);
    return true;
  }
  async function checkPendingOperation() {
    const operation = pendingOperationRef.current;
    if (!operation || checkingPending) return;
    setCheckingPending(true);
    try { if (!await recoverOperation(operation)) onError(unknownBlueprintOperationMessage); }
    catch { onError(unknownBlueprintOperationMessage); }
    finally { setCheckingPending(false); }
  }
  useEffect(() => {
    if (pendingOperationRef.current) void checkPendingOperation();
    else { try { readPendingBlueprintOperation(sessionStorage); } catch { onError("The previous recovery information could not be read. Keep your draft and check the result first."); } }
  }, []);
  const [workspaceView, setWorkspaceView] = useState<PlanWorkspaceView>("plan");
  const [discarding, setDiscarding] = useState(false);
  const [confirmingDiscard, setConfirmingDiscard] = useState(false);
  const [regenerating, setRegenerating] = useState(false);
  const [applyingItineraryEdits, setApplyingItineraryEdits] = useState(false);
  const [refreshingRoutes, setRefreshingRoutes] = useState(false);
  const [regenerationStatus, setRegenerationStatus] = useState<string | null>(null);
  useEffect(() => { onOperationBusy(mutationBlocked || checkingPending || applyingItineraryEdits || refreshingRoutes || regenerating || discarding); }, [mutationBlocked, checkingPending, applyingItineraryEdits, refreshingRoutes, regenerating, discarding, onOperationBusy]);
  async function discardDraft() {
    if (recoveryUnreadable || mutationStartingRef.current || pendingOperationRef.current || discarding || plan.status !== "draft") return;
    setDiscarding(true);

    try {
      await onWorkspace(await deletePlan(plan.id));
    } catch (caught) {
      const message = safePlanError(caught);
      onError(message);
    } finally { setDiscarding(false); }
  }
  async function abandonActive() {
    if (recoveryUnreadable || mutationStartingRef.current || pendingOperationRef.current || discarding || plan.status !== "active") return;
    setDiscarding(true);

    try {
      await onWorkspace(await abandonActivePlan(plan.id));
      onStatus({ tone: "success", text: "The active Plan was abandoned. Reminders and execution guidance for it no longer run." });
    } catch (caught) {
      const message = safePlanError(caught);
      onError(message); onStatus({ tone: "error", text: message });
    } finally { setDiscarding(false); }
  }
  async function regenerateItinerary() {
    if (recoveryUnreadable || mutationStartingRef.current || pendingOperationRef.current || regenerating || plan.status !== "draft") return;
    setRegenerating(true);

    onError("");
    setRegenerationStatus("Reviewing the destination and confirmed trip details…");
    const timers = [
      window.setTimeout(() => setRegenerationStatus("Finding places, reservation requirements, and map coordinates…"), 20_000),
      window.setTimeout(() => setRegenerationStatus("Building the daily timeline and connecting routes…"), 120_000)
    ];
    try {
      const message = "Keep all confirmed trip details, research the destination again, and create a complete mapped itinerary. Include a continuous day-by-day timeline, specific places, map markers, and routes between adjacent stops. Do not return a generic plan without places.";
      const payload = await sendAgentChat({ mode: "revise_plan", message, expectedPlanId: plan.id, expectedVersion: plan.version, impactConfirmed: true });
      if (!payload.workspace) throw new Error("The mapped itinerary was not completed.");
      setRegenerationStatus("Mapped itinerary ready.");
      await onWorkspace(payload.workspace);
    } catch (caught) {
      const message = safePlanError(caught);
      setRegenerationStatus(message);
    } finally {
      timers.forEach((timer) => window.clearTimeout(timer));
      setRegenerating(false);

    }
  }
  async function sendPendingOperation(operation: PendingBlueprintOperation, onCommitted?: () => void) {
    await validatePendingBlueprintOperation(operation);
    if (operation.identity.operation === "save") {
      const payload = await applyDirectBlueprintRevisionBatch(operation.identity.expectedPlanId, operation.body as DirectBlueprintRevisionBatchRequest);
      // 成功响应和丢响应使用同一只读回执边界，绝不以最新 workspace 代替原提交结果。
      if (operation.reviewRebase) { if (!await recoverOperation(operation, onCommitted)) throw new Error(unknownBlueprintOperationMessage); return; }
      acknowledgeOperation(operation); onCommitted?.();
      onStatus({ tone: "success", text: itineraryRevisionImpactStatus(payload.revision, presentation) });
      await publishCommittedWorkspace(payload.workspace);
    } else {
      const payload = await undoDirectBlueprintRevision(operation.identity.expectedPlanId, operation.identity.revisionId!, operation.body as { expectedVersion: number; expectedBlueprintVersion: number; requestId: string });
      acknowledgeOperation(operation);
      onStatus({ tone: "success", text: "The saved changes were undone. Review the new draft before approving it." });
      await publishCommittedWorkspace(payload);
    }
  }
  async function handlePendingFailure(caught: unknown, operation: PendingBlueprintOperation, onCommitted?: () => void): Promise<boolean> {
    if (isDefiniteMutationRejection(caught)) forgetOperation(operation);
    else {
      try { if (await recoverOperation(operation, onCommitted)) return true; } catch { /* 保留不可变原请求与草稿，等待明确恢复。 */ }
    }
    const message = await reconcilePlanMutationFailure(caught, { read: () => getWorkspace({ cache: "no-store" }), publish: onWorkspace });
    onError(message); onStatus({ tone: "error", text: message });
    return false;
  }
  async function retryPendingOperation() {
    const operation = pendingOperationRef.current;
    if (mutationStartingRef.current || !operation || checkingPending || applyingItineraryEdits) return;
    setApplyingItineraryEdits(true);
    try {
      // 每次明确重试仍先核对只读回执。
      if (!await recoverOperation(operation)) await sendPendingOperation(operation);
    } catch (caught) { await handlePendingFailure(caught, operation); }
    finally { setApplyingItineraryEdits(false); }
  }
  async function applyBlueprintItineraryEdits(edits: PendingItineraryEditDisplay[], extra: DirectBlueprintRevisionInput[] = [], highImpactConfirmation?: string, onCommitted?: () => void, draft?: SubmittedDraft) {
    if (mutationStartingRef.current || applyingItineraryEdits) return;
    if (recoveryUnreadable || pendingOperationRef.current) { onError(unknownBlueprintOperationMessage); throw new Error(unknownBlueprintOperationMessage); }
    const revisions = [...directBlueprintRevisionInputs(compactPendingItineraryEdits(edits)), ...extra];
    if (!revisions.length || planReadModel.mutationVersion.expectedBlueprintVersion === undefined) throw new Error("The current blueprint cannot be edited. Refresh the workspace.");
    mutationStartingRef.current = true;
    let operation: PendingBlueprintOperation;
    try {
      const body = { ...planReadModel.mutationVersion, expectedBlueprintVersion: planReadModel.mutationVersion.expectedBlueprintVersion, revisions, requestId: crypto.randomUUID(), ...(highImpactConfirmation ? { highImpactConfirmation } : {}) };
      let reviewRebase: PendingBlueprintOperation["reviewRebase"];
      if (revisions.length === 1 && revisions[0]?.kind === "review_booking_relationships" && blueprint) {
        const key = `landi:pending-blueprint:blueprint:${blueprint.id}`;
        const signature = sessionStorage.getItem(key);
        if (signature) { const context = await getBookingRelationshipReview(plan, blueprint); reviewRebase = { draft: { key, signature }, blueprintId: blueprint.id, sourceSetDigest: context.sourceSetDigest, targetDigests: context.targetDigests }; }
      }
      const boundBody = { ...body, ...(reviewRebase ? { recoveryBinding: await reviewRecoveryBinding(reviewRebase) } : {}) };
      const requestDigest = await blueprintOperationDigest("save", plan.id, boundBody);
      operation = rememberOperation({ identity: { operation: "save", requestId: body.requestId, requestDigest, expectedPlanId: plan.id, expectedVersion: body.expectedVersion, expectedBlueprintVersion: body.expectedBlueprintVersion }, body: boundBody, ...(draft ? { draft } : {}), ...(reviewRebase ? { reviewRebase } : {}) });
    } catch { onError("Recovery information could not be saved, so these changes were not submitted. Keep your draft and try again."); throw new Error("Recovery information could not be saved."); }
    finally { mutationStartingRef.current = false; }
    setApplyingItineraryEdits(true); onError("");
    onStatus({ tone: "working", text: "Saving itinerary changes…" });
    try { await sendPendingOperation(operation, onCommitted); }
    catch (caught) { if (!await handlePendingFailure(caught, operation, onCommitted)) throw caught; }
    finally { setApplyingItineraryEdits(false); }
  }
  async function refreshItineraryRoutes(refresh: ItineraryRouteRefreshDisplay) {
    if (recoveryUnreadable || mutationStartingRef.current || pendingOperationRef.current || refreshingRoutes) return;
    setRefreshingRoutes(true);

    onError("");
    onStatus(routeRefreshWorkingStatus(refresh.dayLabel));
    try {
      if (!refresh.segmentIds.length) throw new Error("There were no route legs to refresh.");
      const payload = await refreshPlanRoutes(plan.id, {
        ...planReadModel.mutationVersion,
        segmentIds: refresh.segmentIds
      });
      await onWorkspace(payload.workspace);
      onStatus(routeRefreshCompletedStatus(refresh.dayLabel, payload));
    } catch (caught) {
      onError(await reconcilePlanMutationFailure(caught, { read: () => getWorkspace({ cache: "no-store" }), publish: onWorkspace }));
      onStatus(routeRefreshUncheckedStatus(refresh.dayLabel));
    } finally {
      setRefreshingRoutes(false);

    }
  }
  async function requestAssistedReplanning(edits: PendingItineraryEditDisplay[], extra: DirectBlueprintRevisionInput[], requirement: DirectBlueprintReplanRequirement) {
    if (recoveryUnreadable || pendingOperationRef.current) { onError(unknownBlueprintOperationMessage); return; }
    try {
      const payload = await prepareDirectBlueprintAssistedReplanning(plan.id, { ...planReadModel.mutationVersion, revisions: [...directBlueprintRevisionInputs(edits), ...extra], replanRequirement: requirement });
      onRevise(payload.handoff.request);
    } catch (caught) { onError(await reconcilePlanMutationFailure(caught, { read: () => getWorkspace({ cache: "no-store" }), publish: onWorkspace })); throw caught; }
  }
  async function undoSavedEdit() {
    if (mutationStartingRef.current || !latestDirectBlueprintRevision || applyingItineraryEdits) return;
    if (recoveryUnreadable || pendingOperationRef.current) { onError(unknownBlueprintOperationMessage); return; }
    const expectedBlueprintVersion = planReadModel.mutationVersion.expectedBlueprintVersion;
    if (expectedBlueprintVersion === undefined) return;
    mutationStartingRef.current = true;
    let operation: PendingBlueprintOperation;
    try {
      const body = { ...planReadModel.mutationVersion, expectedBlueprintVersion, requestId: crypto.randomUUID() };
      const requestDigest = await blueprintOperationDigest("undo", plan.id, { ...body, revisionId: latestDirectBlueprintRevision.id });
      operation = rememberOperation({ identity: { operation: "undo", requestId: body.requestId, requestDigest, expectedPlanId: plan.id, expectedVersion: body.expectedVersion, expectedBlueprintVersion, revisionId: latestDirectBlueprintRevision.id }, body });
    } catch { onError("Undo recovery information could not be saved, so the undo was not submitted."); return; }
    finally { mutationStartingRef.current = false; }
    setApplyingItineraryEdits(true);
    try { await sendPendingOperation(operation); }
    catch (caught) { await handlePendingFailure(caught, operation); }
    finally { setApplyingItineraryEdits(false); }
  }
  async function undoReplacement() {
    if (recoveryUnreadable || pendingOperationRef.current) { onError(unknownBlueprintOperationMessage); return; }
    try {
      const payload = await undoPlanReplacement(plan.id, plan.version);
      await onWorkspace(payload);
      onStatus({ tone: "success", text: "The latest replacement was undone and the previous plan is active again." });
    } catch (caught) {
      const message = await reconcilePlanMutationFailure(caught, { read: () => getWorkspace({ cache: "no-store" }), publish: onWorkspace });
      onError(message); onStatus({ tone: "error", text: message });
    }
  }
  const documentPolicySources = visibleDocumentPolicySources(plan);
  const visibleWorkspaceView = workspaceView === "sources" && !documentPolicySources.length ? "plan" : workspaceView;
  const refinementQuestion = planRefinementQuestion(plan);
  const checklistItems = plan.stages.flatMap((stage) => stage.tasks
    .filter(isExplicitPreparationTask)
    .map((task) => ({ task, stageTitle: stage.title })));
  const checklistTaskIds = new Set(checklistItems.map((item) => item.task.id));
  const timelineItems = plan.stages.flatMap((stage) => {
    const visibleTasks = stage.presentationKind === "itinerary"
      ? stage.tasks.filter((task) => !checklistTaskIds.has(task.id))
      : [];
    const visibleIds = new Set(visibleTasks.map((task) => task.id));
    return visibleTasks.map((task) => {
      const stageIndex = stage.tasks.findIndex((candidate) => candidate.id === task.id);
      return {
        task,
        canMoveUp: stageIndex > 0 && visibleIds.has(stage.tasks[stageIndex - 1]!.id),
        canMoveDown: stageIndex >= 0 && stageIndex < stage.tasks.length - 1 && visibleIds.has(stage.tasks[stageIndex + 1]!.id)
      };
    });
  });
  const timelineTasks = timelineItems.map((item) => item.task);
  const featuredTaskIds = new Set([...checklistItems.map((item) => item.task.id), ...timelineTasks.map((task) => task.id)]);
  const remainingStages = plan.stages
    .map((stage) => ({ ...stage, tasks: stage.tasks.filter((task) => !featuredTaskIds.has(task.id)) }))
    .filter((stage) => stage.tasks.length > 0);
  const leadSectionCount = Number(timelineTasks.length > 0);
  const reminderTasks = plan.stages.flatMap((stage) => stage.tasks.filter((task) => task.reminder).map((task) => ({ task, stageTitle: stage.title })));
  const workspaceViews: Array<{ id: PlanWorkspaceView; label: string; count?: number }> = [
    { id: "plan", label: "Plan" },
    { id: "preparation", label: "Preparation", count: checklistItems.length },
    { id: "bookings", label: "Bookings" },
    { id: "decisions", label: "Decisions", count: plan.assumptions.length },
    { id: "reminders", label: "Reminders", count: reminderTasks.length },
    ...(documentPolicySources.length ? [{ id: "sources" as const, label: "Document sources", count: documentPolicySources.length }] : [])
  ];
  const isTravelPlan = plan.stages.some((stage) => stage.presentationKind === "itinerary");
  const discardControl = (disabled = false) => confirmingDiscard
    ? <><button className="secondary-action" disabled={discarding || mutationBlocked} onClick={() => setConfirmingDiscard(false)}>Keep plan</button><button className="discard-plan-button confirm" disabled={discarding || disabled || mutationBlocked} onClick={() => void discardDraft()}>{discarding ? "Discarding…" : "Confirm discard"}</button></>
    : <button className="discard-plan-button" disabled={discarding || disabled || mutationBlocked} onClick={() => setConfirmingDiscard(true)}>Discard this plan</button>;
  const abandonControl = (disabled = false) => confirmingDiscard
    ? <><button className="secondary-action" disabled={discarding || mutationBlocked} onClick={() => setConfirmingDiscard(false)}>Keep plan</button><button className="discard-plan-button confirm" disabled={discarding || disabled || mutationBlocked} onClick={() => void abandonActive()}>{discarding ? "Abandoning…" : "Confirm abandon"}</button></>
    : <button className="discard-plan-button" disabled={discarding || disabled || mutationBlocked} onClick={() => setConfirmingDiscard(true)}>Abandon plan</button>;
  if (isTravelPlan && (presentation?.kind !== "itinerary" || !presentation.places.length)) {
    return <article className="current-plan-card native-trip-plan itinerary-generation-gap">
      <header><div><span className="section-eyebrow">TRIP ITINERARY</span><h2>{displayPlanTitle(plan)}</h2><p>{plan.location} · {plan.dates}</p></div><span className="plan-status draft">Mapped itinerary pending</span></header>
      <section><span>Trip details saved</span><h3>{regenerating ? "Landi is creating the complete itinerary" : "This itinerary is not complete yet"}</h3><p>{regenerating ? "Stay on this page to follow progress. The map and daily timeline will appear here when generation finishes." : "Regeneration will reuse confirmed dates, flights, party size, transport preferences, and trip goals. You will not need to answer the same questions again."}</p>{regenerationStatus ? <div className={regenerating ? "generation-progress working" : "generation-progress"} role="status"><i />{regenerationStatus}</div> : null}<button className="primary-action" disabled={regenerating || discarding} onClick={() => void regenerateItinerary()}>{regenerating ? "Creating itinerary…" : regenerationStatus ? "Generate again" : "Create mapped itinerary"}</button></section>
      <footer className="plan-footer"><div><strong>Create the itinerary or discard this plan</strong><span>Discarding returns to the previous plan, or to an empty workspace if none exists.</span></div><div className="plan-footer-actions">{discardControl(regenerating)}</div></footer>
    </article>;
  }
  if (presentation?.kind === "itinerary" && presentation.places.length) {
    return <article className="current-plan-card native-trip-plan">
      {latestPlanReplacement ? <PlanReplacementNotice audit={latestPlanReplacement} active={plan.status === "active"} onUndo={undoReplacement} /> : null}
      {recoveryUnreadable ? <section className="blueprint-operation-recovery" role="status"><p>The previous recovery information could not be read. The original record and draft have been kept. Check the result first.</p><button type="button" onClick={() => window.location.reload()}>Refresh and check recovery information</button></section> : null}
      {pendingOperation ? <section className="blueprint-operation-recovery" role="status"><p>{unknownBlueprintOperationMessage}</p><button type="button" disabled={checkingPending || applyingItineraryEdits} onClick={() => void checkPendingOperation()}>Check previous result</button><button type="button" disabled={checkingPending || applyingItineraryEdits} onClick={() => void retryPendingOperation()}>Resubmit original operation</button></section> : null}
      {latestDirectBlueprintRevision && latestDirectBlueprintRevision.planId === plan.id && latestDirectBlueprintRevision.planVersion === plan.version ? <button type="button" className="blueprint-saved-undo" disabled={applyingItineraryEdits || mutationBlocked} onClick={() => void undoSavedEdit()}>Undo saved blueprint edit</button> : null}
      <LandiBlueprintWorkspace rebasedDraft={rebasedDraft} reviewBlueprint={blueprint} acknowledgedDraft={acknowledgedDraft} mutationRecoveryPending={mutationBlocked} savedEditUndoAvailable={Boolean(latestDirectBlueprintRevision && latestDirectBlueprintRevision.planId === plan.id && latestDirectBlueprintRevision.planVersion === plan.version)} blueprintIdentity={blueprint ? { id: blueprint.id, version: blueprint.version } : undefined} plan={plan} presentation={presentation} onTaskToggle={onTaskToggle} onApplyItineraryEdits={applyBlueprintItineraryEdits} onRequestAssistedReplanning={requestAssistedReplanning} onRequestRouteRefresh={refreshItineraryRoutes} onReplanBookingSources={() => onRevise("请保留当前草稿和待确认编辑，先让我逐项确认真实预订资料，再重新生成有明确来源基准的行程。不要把旧来源继承缺口当作已修复，不自动取消预订或切换执行行程。")} onWorkspace={onWorkspace} onStatus={onStatus} onError={onError} itineraryEditBusy={applyingItineraryEdits} routeRefreshBusy={refreshingRoutes} />
      <footer className="plan-footer actions-only"><div className="plan-footer-actions">{plan.status === "draft" ? discardControl() : abandonControl()}<button className="secondary-action" onClick={() => onRevise()}>Adjust in conversation</button>{plan.status === "draft" ? <button className="primary-action" disabled={confirming || mutationBlocked} onClick={() => void onConfirm(plan.id)}>{confirming ? "Confirming…" : "Confirm and activate"}</button> : null}</div></footer>
    </article>;
  }
  return <article className="current-plan-card">
    <header className="plan-hero"><div><span className={`plan-status ${plan.status}`}>{plan.status === "draft" ? "Draft for review" : "Active"}</span><h2>{plan.title}</h2><div className="plan-meta"><span>⌖ {plan.location}</span><span>◷ {plan.dates}</span></div></div></header>
    <PlanCommandCenter plan={plan} tasks={plan.stages.flatMap((stage) => stage.tasks)} onRevise={onRevise} />
    {latestPlanReplacement ? <PlanReplacementNotice audit={latestPlanReplacement} active={plan.status === "active"} onUndo={undoReplacement} /> : null}
    {latestPlanChange ? <PlanChangeNotice change={latestPlanChange} onUndo={() => onUndoChange(plan.id, latestPlanChange.id)} /> : null}
    <nav className="plan-workspace-tabs" aria-label="Plan workspace views">{workspaceViews.map((item) => <button type="button" className={visibleWorkspaceView === item.id ? "active" : ""} aria-current={visibleWorkspaceView === item.id ? "page" : undefined} onClick={() => setWorkspaceView(item.id)} key={item.id}>{item.label}{item.count !== undefined ? <span>{item.count}</span> : null}</button>)}</nav>
    {visibleWorkspaceView === "plan" ? <><PlanGrounding plan={plan} onContinue={onRevise} />{presentation ? <PlanMapWorkspace key={planReadModel.presentationKey} planId={plan.id} planVersion={plan.version} presentation={presentation} partySize={plan.configuration.travelContext.partySize} arrivals={destinationArrivals} editable={plan.status === "draft"} onWorkspace={onWorkspace} onStatus={(text) => onStatus({ tone: "success", text })} onError={onError} onRevise={onRevise} /> : null}<section className="plan-sections">{timelineItems.length ? <FeaturedTimeline plan={plan} index={0} items={timelineItems} onTaskReorder={onTaskReorder} /> : null}{remainingStages.map((stage, index) => <PlanContentSection key={stage.id} plan={plan} stage={stage} index={index + leadSectionCount} onTaskToggle={onTaskToggle} onTaskReorder={onTaskReorder} />)}</section></> : null}
    {visibleWorkspaceView === "preparation" ? checklistItems.length ? <section className="plan-sections"><FeaturedChecklist plan={plan} index={0} items={checklistItems} onTaskToggle={onTaskToggle} /></section> : <WorkspaceEmpty title="No pre-departure tasks" detail="Items to pack or complete before departure will appear here." /> : null}
    {visibleWorkspaceView === "bookings" ? <section className="plan-sections"><BookingImportPanel scope={{ type: "plan", planId: plan.id }} expectedVersion={plan.version} onWorkspace={onWorkspace} onStatus={onStatus} onError={onError} /></section> : null}
    {visibleWorkspaceView === "decisions" ? plan.assumptions.length ? <PlanDecisionBoard assumptions={plan.assumptions} onRevise={onRevise} /> : <WorkspaceEmpty title="No pending decisions" detail="The plan currently has no assumptions or tradeoffs that need your decision." /> : null}
    {visibleWorkspaceView === "reminders" ? <PlanRemindersView items={reminderTasks} active={plan.status === "active"} /> : null}
    {visibleWorkspaceView === "sources" ? <PlanSourcesView sources={documentPolicySources} /> : null}
    <footer className="plan-footer"><div><strong>{plan.status === "draft" ? "Confirm the complete plan" : "Need an adjustment?"}</strong><span>{plan.status === "draft" ? refinementQuestion ? "The complete plan is ready. The question above can improve execution accuracy but does not block review or confirmation." : "Confirmation enables only reminders and execution tasks backed by sufficient information." : "Changes first create a replacement draft. The current plan stays active until you confirm it."}</span></div><div className="plan-footer-actions">{plan.status === "draft" ? discardControl() : abandonControl()}<button className="secondary-action" onClick={() => onRevise()}>{plan.status === "draft" && refinementQuestion ? "Add plan details" : "Modify current plan"}</button>{plan.status === "draft" ? <button className="primary-action" disabled={confirming || mutationBlocked} onClick={() => void onConfirm(plan.id)}>{confirming ? "Confirming…" : "Confirm and activate"}</button> : null}</div></footer>
  </article>;
}
