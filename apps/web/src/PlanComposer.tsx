import { shouldOfferBookingImport } from "./booking-import-context.js";
import { checkedPlanningSaveReceipt, checkedPlanningWorkSave, planningWorkNotice, savedProcessingUnverified, unverifiedPlanningWork, mergeSubmittedPlanningNotice, type SubmittedPlanningNotice } from './planning-work-display.js';
import { MahPlanningGuide } from "./MahPlanningGuide.js";
import { readPlanningDraftSignature, persistPlanningDraft, reconcileSavedPlanningMessage, preparePlanningMessage, forgetRejectedPlanningMessage, settlePlanningMessage, pendingPlanningMessage, migratePlanningDraft, refreshAfterPlanningSave, type PlanningMessageIdentity } from "./planning-message-identity.js";
import { hasStatedBudgetAmount } from "@c-assistant/core/planning-budget";
import { assistantPlanningWelcome, resolveAssistantPersonality, type PersonalityContext } from "@c-assistant/core/assistant-personality";
import { useEffect, useRef, useState } from "react";
import type { Plan, PlanningProposal, PlanningSession, WorkspaceSnapshot } from "@c-assistant/core";
import landiLogoUrl from "../../../assets/branding/landi-round-otter-earth-icon-final.png";
import { PlanningMessageRejected, PlanningRequirementsSaved, getPlanningMessageSaveStatus, getPlanningWorkStatus, confirmPlanningProposal, getPlanningRevision, getPlanningGeneration, getWorkspace, planningGenerationEventsUrl, previewPlanChangeImpact, sendAgentChat, type PlanGenerationState, type PlanningGenerationResponse } from "./api-client.js";
import { BookingImportPanel } from "./BookingImportPanel.js";
import { conversationFromPlanningSession, conversationStorageKey, loadConversation, type ChatMessage } from "./conversation-state.js";
import { refinementIntro } from "./plan-display.js";
import { generationFailureMessage, generationProgressMessage, generationStageMessage } from "./plan-generation-display.js";
import type { AgentStatus } from "./ui-types.js";
import { serverPlanningContinuation, readPlanningContinuation, type PlanningContinuationPort, type PlanningContinuationScope } from "./planning-continuation.js";

export type ComposerMode = "new_plan" | "revise_plan";
const requiredGenerationFacts = ["destination", "purpose", "travel_dates", "arrival", "departure", "party_size", "transport_preference"];
const generationFactLabels: Record<string, string> = { destination: "Destination", purpose: "Trip goal", travel_dates: "Travel dates", arrival: "Arrival", departure: "Return departure", party_size: "Travelers", transport_preference: "Local transport", budget_scope: "International flights in budget" };

export function InlineComposerWorkspace({ profile, mode, currentPlan, planningSession, initialMessage, onClose, onPlanCreated, onStatus, onError }: { profile?: PersonalityContext; mode: ComposerMode; currentPlan: Plan | null; planningSession?: PlanningSession | undefined; initialMessage: string; onClose: () => void; onPlanCreated: (workspace: WorkspaceSnapshot) => Promise<void>; onStatus: (status: AgentStatus) => void; onError: (message: string) => void }) {
  const [busy, setBusy] = useState(false);
  return <section className="inline-composer-workspace" aria-label={mode === "new_plan" ? "Tell Landi your goal" : "Adjust current plan"}><header><div><h1>{mode === "new_plan" ? "Plan your trip with Landi" : "Adjust your plan with Landi"}</h1></div><button type="button" onClick={onClose} disabled={busy}>{busy ? "Working…" : mode === "new_plan" && planningSession ? "Exit for now" : "Back"}</button></header><PlanComposer profile={profile ?? {}} mode={mode} currentPlan={currentPlan} planningSession={planningSession} initialMessage={initialMessage} onPlanCreated={onPlanCreated} onStatus={onStatus} onComplete={onClose} onError={onError} onBusyChange={setBusy} continuation={serverPlanningContinuation} /></section>;
}

export function PlanComposer({ profile, mode, currentPlan, planningSession, initialMessage = "", onPlanCreated, onStatus, onComplete, onError, onBusyChange, continuation }: { profile?: PersonalityContext; mode: ComposerMode; currentPlan: Plan | null; planningSession?: PlanningSession | undefined; initialMessage?: string; onPlanCreated: (workspace: WorkspaceSnapshot) => Promise<void>; onStatus: (status: AgentStatus) => void; onComplete: () => void; onError: (message: string) => void; onBusyChange?: (busy: boolean) => void; continuation?: PlanningContinuationPort }) {
  const persona = resolveAssistantPersonality(profile?.assistantPersonality);
  const welcome = mode === "new_plan" ? assistantPlanningWelcome(profile ?? {}) : refinementIntro(currentPlan, persona.id);
  const conversationKey = useRef(conversationStorageKey(mode, currentPlan?.id)).current;
  const [planningSessionId, setPlanningSessionId] = useState<string | undefined>(planningSession?.id);
  const propVersion = JSON.stringify([planningSession?.proposal?.version ?? null, planningSession?.updatedAt ?? null]);
  const ownSessionBinding = useRef<string | undefined>(undefined);
  const ownPropAdoption = useRef(false);
  const externalScope = useRef({ id: planningSession?.id, version: propVersion, generation: 0 });
  if (externalScope.current.id !== planningSession?.id || externalScope.current.version !== propVersion) {
    const ownBinding = externalScope.current.id === undefined && planningSession?.id !== undefined && ownSessionBinding.current === planningSession.id;
    ownPropAdoption.current = ownBinding;
    externalScope.current = { id: planningSession?.id, version: propVersion, generation: externalScope.current.generation + (ownBinding ? 0 : 1) };
    ownSessionBinding.current = undefined;
  }
  const draftKey = `${conversationKey}:input:${planningSessionId ?? "new"}`;
  const readDraft = () => { try { return localStorage.getItem(draftKey) ?? pendingPlanningMessage(localStorage, `${conversationKey}:pending-message`, planningSessionId)?.message ?? ""; } catch { return ""; } };
  const pendingMessageKey = `${conversationKey}:pending-message`;
  const [input, setInput] = useState(() => initialMessage || readDraft());
  const previousDraftKey = useRef(`${conversationKey}:input:${planningSession?.id ?? "new"}`);
  useEffect(() => {
    if (mode !== "new_plan") return;
    const from = previousDraftKey.current === draftKey ? `${conversationKey}:input:new` : previousDraftKey.current;
    try {
      // Only an unscoped draft belongs to a newly created session. Keep named sessions separate.
      const restored = migratePlanningDraft(localStorage, from === `${conversationKey}:input:new` && (ownSessionBinding.current === planningSessionId || ownPropAdoption.current) ? from : draftKey, draftKey);
      if (from !== draftKey && (restored !== undefined || from !== `${conversationKey}:input:new`)) setInput(restored ?? "");
      previousDraftKey.current = draftKey;
    } catch { /* Preserve the original draft when browser storage cannot complete the copy. */ }
  }, [draftKey, mode]);
  type DraftNotice = { kind: "unknown" | "rejected"; sessionId: string | undefined; draftKey: string; epoch: number; messageId: string; text: string };
  const [requirementsNotice, setRequirementsNotice] = useState<DraftNotice | null>(() => {
    try { const message = initialMessage || readDraft(); const pending = message && pendingPlanningMessage(localStorage, pendingMessageKey, planningSessionId, message); return pending ? { kind: "unknown", sessionId: planningSessionId, draftKey, epoch: 0, messageId: pending.identity.messageId, text: "We couldn’t confirm whether your requirements were saved. Your text is kept here. Retry to confirm." } : null; } catch { return null; }
  });
  const [resultCheck, setResultCheck] = useState<{ sessionId: string; messageId: string; expectedRevision: number } | null>(null);
  const resultCheckInFlight = useRef(false);
  const [submittedNotice, setSubmittedNotice] = useState<SubmittedPlanningNotice | null>(null);
  const currentScope = useRef({ sessionId: planningSessionId, draftKey });
  currentScope.current = { sessionId: planningSessionId, draftKey };
  const inputEdits = useRef(0);
  function saveInput(value: string, userEdit = false) { if (userEdit) { inputEdits.current++; setRequirementsNotice(null); } setInput(value); try { persistPlanningDraft(localStorage, draftKey, value, userEdit); } catch { /* 保留输入；未核实的持久签名阻断发送。 */ } }

  function cacheConversation(key: string, value: ChatMessage[]) { try { localStorage.setItem(key, JSON.stringify(value)); } catch { /* Optional display cache never changes save acknowledgement. */ } }
  async function refreshSavedWorkspace(workspace: WorkspaceSnapshot) {
    const result = await refreshAfterPlanningSave(workspace, onPlanCreated);
    if (!result.ok) onError("Requirements saved. Some workspace details could not be refreshed. Check again before continuing.");
  }
  function clearSavedInput() { try { localStorage.removeItem(draftKey); localStorage.removeItem(`${draftKey}:edit`); return true; } catch { return false; } }
  const [busy, setBusy] = useState(false);
  const busyOwner = useRef<object | null>(null);
  useEffect(() => { busyOwner.current = null; setBusy(false); }, [planningSession?.id, propVersion]);
  const [activeMode, setActiveMode] = useState<ComposerMode>(mode);
  const [readyForReview, setReadyForReview] = useState(false);
  const [proposal, setProposal] = useState<PlanningProposal | undefined>(planningSession?.proposal);
  const [missingDetails, setMissingDetails] = useState(planningSession?.unresolved ?? []);
  const [sessionFacts, setSessionFacts] = useState(planningSession?.facts ?? []);
  type RevisionState = { sessionId: string | undefined; highest: number | undefined; available: boolean; epoch: number };
  const [revisionState, setRevisionState] = useState<RevisionState>({ sessionId: planningSession?.id, highest: planningSession?.id ? undefined : 0, available: !planningSession?.id, epoch: 0 });
  const requirementsRevision = revisionState.sessionId === planningSessionId && revisionState.available ? revisionState.highest : undefined;
  // 所有修订观察、失效和外部切换共用一个状态入口；失效保留本会话已知上限。
  function updateRequirementsRevision(action: { kind: 'reset'; sessionId: string | undefined } | { kind: 'invalidate' } | { kind: 'observe'; value: number | undefined; sessionId: string | undefined; epoch: number }) {
    setRevisionState(current => {
      if (action.kind === 'reset') return { sessionId: action.sessionId, highest: action.sessionId ? undefined : 0, available: !action.sessionId, epoch: current.epoch + 1 };
      if (action.kind === 'invalidate') return { ...current, available: false, epoch: current.epoch + 1 };
      if (!Number.isSafeInteger(action.value) || action.value! < 0 || (current.sessionId !== action.sessionId && current.sessionId !== undefined)) return current;
      const highest = current.highest === undefined ? action.value! : Math.max(current.highest, action.value!);
      return { ...current, sessionId: action.sessionId, highest, available: current.available || (action.epoch === current.epoch && action.value! >= highest) };
    });
  }
  const [revisionReadAttempt, setRevisionReadAttempt] = useState(0);
  useEffect(() => {
    let cancelled = false;
    const generation = externalScope.current.generation, epoch = revisionState.epoch;
    if (!planningSessionId) return;
    void getPlanningRevision(planningSessionId).then(value => { if (!cancelled && generation === externalScope.current.generation) updateRequirementsRevision({ kind: 'observe', value, sessionId: planningSessionId, epoch }); }).catch(() => { if (!cancelled && generation === externalScope.current.generation) updateRequirementsRevision({ kind: 'invalidate' }); });
    return () => { cancelled = true; };
  }, [planningSessionId, revisionReadAttempt, propVersion]);
  const [planningSessionStatus, setPlanningSessionStatus] = useState<PlanningSession["status"] | undefined>(planningSession?.status);
  const [resultLoadingPlanId, setResultLoadingPlanId] = useState<string | null>(planningSession?.status === "draft_ready" && planningSession.outputPlanId ? planningSession.outputPlanId : null);
  const [processingStatus, setProcessingStatus] = useState(mode === "new_plan" ? planningSession?.status === "generating" ? "Starting complete plan generation…" : "Waiting for your trip details" : "Waiting for your answer about the current plan");
  const [messages, setMessages] = useState<ChatMessage[]>(() => mode === "new_plan" ? conversationFromPlanningSession(planningSession, welcome) : loadConversation(localStorage, conversationKey, welcome));
  const [messagesSessionId, setMessagesSessionId] = useState(planningSession?.id);
  const priorPropSession = useRef(planningSession?.id);
  useEffect(() => {
    const previous = priorPropSession.current; priorPropSession.current = planningSession?.id;
    if (mode !== "new_plan") return;
    if (!planningSession?.id) {
      if (previous) {
        updateRequirementsRevision({ kind: 'reset', sessionId: undefined });
        setPlanningSessionId(undefined); setPlanningSessionStatus(undefined); setProposal(undefined); setMissingDetails([]); setSessionFacts([]); setResultLoadingPlanId(null);
        let value = ''; try { value = localStorage.getItem(`${conversationKey}:input:new`) ?? ''; } catch { /* 保留无法读取的原存储。 */ }
        setInput(value); setRequirementsNotice(null); setSubmittedNotice(null); setMessages(conversationFromPlanningSession(undefined, welcome)); setMessagesSessionId(undefined);
      }
      return;
    }
    if (!previous && ownPropAdoption.current) { setMessagesSessionId(planningSession.id); return; }
    if (previous === planningSession.id) return;
    updateRequirementsRevision({ kind: 'reset', sessionId: planningSession.id });
    const key = `${conversationKey}:input:${planningSession.id}`;
    let value = ""; try { value = localStorage.getItem(key) ?? ""; } catch { /* preserve readable state */ }
    let pending; try { pending = value && pendingPlanningMessage(localStorage, pendingMessageKey, planningSession.id, value); } catch { /* storage unavailable */ }
    setInput(value); setRequirementsNotice(pending ? { kind: "unknown", sessionId: planningSession.id, draftKey: key, epoch: inputEdits.current, messageId: pending.identity.messageId, text: "We couldn’t confirm whether your requirements were saved. Your text is kept here. Retry to confirm." } : null);
    setSubmittedNotice(null); setMessages(conversationFromPlanningSession(planningSession, welcome)); setMessagesSessionId(planningSession.id); busyOwner.current = null; setBusy(false);
  }, [planningSession?.id, mode]);
  const [bookingImportTarget, setBookingImportTarget] = useState<HTMLDivElement | null>(null);
  const latestAssistantId = messages.filter(message => message.role === "assistant").at(-1)?.id;
  const latestUserId = messages.filter(message => message.role === 'user').at(-1)?.id;
  useEffect(() => {
    if (activeMode !== 'new_plan' || busy || !planningSessionId || !latestUserId || (planningSession?.id && (planningSession.id !== planningSessionId || messagesSessionId !== planningSessionId))) return;
    const observedInputEdits = inputEdits.current, generation = externalScope.current.generation;
    let cancelled = false;
    void getPlanningWorkStatus(planningSessionId, latestUserId).then(value => {
      if (cancelled || generation !== externalScope.current.generation) return;
      const scope = { sessionId: planningSessionId, messageId: latestUserId };
      const saved = checkedPlanningWorkSave(value, scope);
      const text = planningWorkNotice(value, scope);
      const observedWork = (value as { localWork?: { status?: string } } | null)?.localWork;
      setResultCheck(saved && observedWork && ['submission_unknown', 'queued', 'running', 'completed', 'validated'].includes(observedWork.status ?? '')
        ? { ...scope, expectedRevision: saved.receipt.expectedRevision } : null);
      if (!text) setSubmittedNotice(current => current?.sessionId === scope.sessionId && current.messageId === scope.messageId ? null : current);
      if (text) setSubmittedNotice(current => mergeSubmittedPlanningNotice(current, { ...scope, text, verified: Boolean(saved) }));
      const persistedMessage = planningSession?.id === planningSessionId
        ? planningSession.messages.find(message => message.id === latestUserId && message.role === 'user') : undefined;
      if (saved && persistedMessage) {
        try {
          const originalDraft = localStorage.getItem(draftKey);
          if (reconcileSavedPlanningMessage(localStorage, pendingMessageKey, draftKey, saved.receipt, persistedMessage, inputEdits.current !== observedInputEdits)) {
            setInput(current => current === originalDraft ? '' : current);
          }
        } catch { /* Keep unresolved browser records when storage cleanup fails. */ }
      }
    }).catch(() => { if (!cancelled && generation === externalScope.current.generation) setSubmittedNotice(current => mergeSubmittedPlanningNotice(current, { sessionId: planningSessionId, messageId: latestUserId, text: unverifiedPlanningWork, verified: false })); });
    return () => { cancelled = true; };
  }, [activeMode, busy, planningSessionId, latestUserId, messagesSessionId, planningSession?.id, propVersion]);
  const pendingReadEpoch = useRef(0);
  async function reconcilePendingSave(pending: NonNullable<ReturnType<typeof pendingPlanningMessage>>): Promise<boolean> {
    const generation = externalScope.current.generation, observedEdits = inputEdits.current, scope = currentScope.current;
    const epoch = ++pendingReadEpoch.current;
    try {
      const value = await getPlanningMessageSaveStatus(pending.identity, pending.message);
      if (generation !== externalScope.current.generation || epoch !== pendingReadEpoch.current || scope.draftKey !== currentScope.current.draftKey) return false;
      const facts = value as { schemaVersion?: number; executable?: boolean; observedAt?: string; requirementsSaved?: boolean; saveReceipt?: unknown; planningRevision?: number; sessionId?: string; messageId?: string } | null;
      const receipt = facts?.requirementsSaved === true ? checkedPlanningSaveReceipt(facts.saveReceipt, pending.identity) : null;
      const at = Date.parse(facts?.observedAt ?? '');
      if (!receipt || facts?.schemaVersion !== 1 || facts.executable !== false || facts.sessionId !== receipt.sessionId || facts.messageId !== receipt.messageId
        || !Number.isFinite(at) || at > Date.now() || Date.now() - at > 60000 || !Number.isSafeInteger(facts.planningRevision) || facts.planningRevision! < receipt.savedRevision
        || (scope.sessionId !== undefined && scope.sessionId !== receipt.sessionId)) throw new Error();
      const recorded = planningSession?.id === receipt.sessionId ? planningSession.messages.find(item => item.id === receipt.messageId && item.role === 'user') : undefined;
      if (recorded && recorded.text !== pending.message) throw new Error();
      const clear = reconcileSavedPlanningMessage(localStorage, pendingMessageKey, scope.draftKey, receipt, { id: receipt.messageId, text: pending.message }, inputEdits.current !== observedEdits);
      if (clear) setInput(current => current === pending.draft?.raw ? '' : current);
      setRequirementsNotice(null);
      setSubmittedNotice(current => mergeSubmittedPlanningNotice(current, { sessionId: receipt.sessionId, messageId: receipt.messageId, text: savedProcessingUnverified, verified: true }));
      updateRequirementsRevision({ kind: 'observe', value: facts.planningRevision, sessionId: receipt.sessionId, epoch: revisionState.epoch });
      if (!scope.sessionId) { ownSessionBinding.current = receipt.sessionId; setPlanningSessionId(receipt.sessionId); }
      return true;
    } catch {
      if (generation === externalScope.current.generation && epoch === pendingReadEpoch.current && scope.draftKey === currentScope.current.draftKey && inputEdits.current === observedEdits) {
        setRequirementsNotice({ kind: 'unknown', sessionId: scope.sessionId, draftKey: scope.draftKey, epoch: observedEdits, messageId: pending.identity.messageId,
          text: 'The original save is still unverified. Your text and original request are kept. Check again or explicitly retry the original save.' });
      }
      return false;
    }
  }
  async function checkPendingSave() {
    try {
      const pending = pendingPlanningMessage(localStorage, pendingMessageKey, planningSessionId);
      if (pending) await reconcilePendingSave(pending);
    } catch { onError('The original browser save record could not be read. Keep your draft and restore that record before saving.'); }
  }
  useEffect(() => { if (activeMode === 'new_plan' && !busy) void checkPendingSave(); return () => { pendingReadEpoch.current++; }; }, [activeMode, planningSessionId, busy, propVersion]);
  const openingSavedPlanRef = useRef<string | null>(null);
  const openedSavedPlanRef = useRef<string | null>(null);
  const planGenerationInProgress = planningSessionStatus === "generating" || Boolean(resultLoadingPlanId) || (busy && planningSessionStatus === "proposal_ready");
  const composerWorking = busy || planningSessionStatus === "generating" || Boolean(resultLoadingPlanId);
  const generationReadyToConfirm = planningSessionStatus === "proposal_ready";
  const budgetMentioned = sessionFacts.some((fact) => fact.confirmed && hasStatedBudgetAmount(fact.value, fact.key === "budget"))
    || messages.some((message) => message.role === "user" && hasStatedBudgetAmount(message.text));
  const hasUnconfirmedBudgetScope = budgetMentioned
    && !sessionFacts.some((fact) => fact.key === "budget_scope" && fact.confirmed && (fact.value === "includes international flights" || fact.value === "excludes international flights"));
  const confirmedFact = (key: string) => sessionFacts.find((fact) => fact.key === key && fact.confirmed && fact.value.trim());
  const provisionalTransport = confirmedFact("arrival_status")?.value === "not_booked";
  const completeGenerationFacts = requiredGenerationFacts.every((key) => Boolean(confirmedFact(key)
    || (provisionalTransport && key === "arrival" && confirmedFact("arrival_origin") && confirmedFact("destination"))
    || (provisionalTransport && key === "departure" && confirmedFact("departure_destination"))));
  const generationCanRetry = mode === "new_plan" && generationReadyToConfirm && missingDetails.length === 0 && !hasUnconfirmedBudgetScope && completeGenerationFacts && Boolean(proposal && planningSessionId) && !busy;
  const [resumableGeneration, setResumableGeneration] = useState<{ sessionId: string; proposalVersion: number } | null>(null);
  const canResumeGeneration = resumableGeneration !== null && resumableGeneration.sessionId === planningSessionId
    && resumableGeneration?.proposalVersion === proposal?.version;
  const [continuationReadAttempt, setContinuationReadAttempt] = useState(0);
  const [continuationObservation, setContinuationObservation] = useState<{ key: string; validUntil: number } | null>(null);
  const continuationInFlight = useRef(false);
  const latestContinuationPort = useRef(continuation); latestContinuationPort.current = continuation;
  const continuationScope: PlanningContinuationScope | undefined = planningSessionId && requirementsRevision !== undefined && proposal
    ? { sessionId: planningSessionId, revision: requirementsRevision, proposalVersion: proposal.version } : undefined;
  const continuationKey = JSON.stringify(continuationScope ?? null);
  const latestContinuationKey = useRef(continuationKey); latestContinuationKey.current = continuationKey;
  useEffect(() => {
    let cancelled = false, timer: number | undefined;
    setContinuationObservation(null);
    if (continuation && continuationScope && generationCanRetry) void readPlanningContinuation(continuation, continuationScope).then(observed => {
      if (cancelled || !observed) return;
      setContinuationObservation({ key: continuationKey, validUntil: observed.validUntil });
      timer = window.setTimeout(() => {
        if (cancelled) return;
        setContinuationObservation(null);
        setContinuationReadAttempt(value => value + 1);
      }, Math.max(0, observed.validUntil - Date.now()));
    });
    return () => { cancelled = true; if (timer !== undefined) window.clearTimeout(timer); };
  }, [continuation, continuationKey, continuationReadAttempt, generationCanRetry]);
  const continuationReady = continuationObservation?.key === continuationKey && continuationObservation.validUntil > Date.now();
  const reviewFacts = [...requiredGenerationFacts, ...(sessionFacts.some((fact) => fact.key === "budget_scope" && fact.confirmed) ? ["budget_scope"] : [])]
    .map((key) => ({ key, label: generationFactLabels[key], value: confirmedFact(key)?.value
      ?? (provisionalTransport && key === "arrival" ? `Unbooked, from ${confirmedFact("arrival_origin")?.value ?? ""}; arrival point and time to confirm` : undefined)
      ?? (provisionalTransport && key === "departure" ? `Unbooked, returning to ${confirmedFact("departure_destination")?.value ?? ""}; departure point and time to confirm` : undefined)
      ?? "" }));
  function applyGenerationSnapshot(payload: PlanningGenerationResponse) {
    const snapshot = payload.snapshot;
    setResumableGeneration(snapshot?.status === 'failed' && snapshot.failure?.resumable === true
      && snapshot.proposalRef.sessionId === planningSessionId && snapshot.proposalRef.proposalVersion === proposal?.version
      && snapshot.generationKey === payload.generation?.generationKey
      ? { ...snapshot.proposalRef } : null);
    if (payload.sessionStatus === "draft_ready" && payload.outputPlanId) {
      setResultLoadingPlanId(payload.outputPlanId);
      setProcessingStatus(`Plan saved. Loading draft ${payload.outputPlanId}…`);
      return;
    }
    setPlanningSessionStatus(payload.sessionStatus);
    setResultLoadingPlanId(null);
    if (payload.generation) setProcessingStatus(generationProgressMessage(payload.generation));
    if (payload.generation?.status === "failed") onError(generationFailureMessage(payload.generation));
  }
  async function openSavedPlan(sessionId: string, outputPlanId: string) {
    const resultKey = `${sessionId}:${outputPlanId}`;
    if (openingSavedPlanRef.current === resultKey || openedSavedPlanRef.current === resultKey) return;
    openingSavedPlanRef.current = resultKey;
    const generation = externalScope.current.generation, observedEdits = inputEdits.current;
    try {
      const next = await getWorkspace({ cache: "no-store" });
      if (next.activePlan.id !== outputPlanId || generation !== externalScope.current.generation || observedEdits !== inputEdits.current || currentScope.current.sessionId !== sessionId) return;
      openedSavedPlanRef.current = resultKey;
      void onPlanCreated(next).catch(() => undefined);
      onComplete();
    } catch { /* Keep the saved result visible and retry through the existing generation poll. */ }
    finally { if (openingSavedPlanRef.current === resultKey) openingSavedPlanRef.current = null; }
  }
  useEffect(() => { onBusyChange?.(busy); return () => onBusyChange?.(false); }, [busy, onBusyChange]);
  useEffect(() => { saveInput(initialMessage || readDraft()); setActiveMode(mode); setReadyForReview(false); setProposal(mode === "new_plan" ? planningSession?.proposal : undefined); setMissingDetails(mode === "new_plan" ? planningSession?.unresolved ?? [] : []); setSessionFacts(mode === "new_plan" ? planningSession?.facts ?? [] : []); setPlanningSessionId(mode === "new_plan" ? planningSession?.id : undefined); setPlanningSessionStatus(mode === "new_plan" ? planningSession?.status : undefined); setResultLoadingPlanId(mode === "new_plan" && planningSession?.status === "draft_ready" && planningSession.outputPlanId ? planningSession.outputPlanId : null); setProcessingStatus(mode === "new_plan" ? planningSession?.status === "generating" ? "Starting complete plan generation…" : planningSession?.status === "draft_ready" && planningSession.outputPlanId ? `Plan saved. Loading draft ${planningSession.outputPlanId}…` : "Waiting for your trip details" : initialMessage ? "Map changes are ready. Send them and Landi will replan" : "Waiting for your answer about the current plan"); setMessages(mode === "new_plan" ? conversationFromPlanningSession(planningSession, welcome) : loadConversation(localStorage, conversationKey, welcome)); }, [mode, initialMessage]);
  useEffect(() => {
    if (mode !== "new_plan" || !planningSession) return;
    setPlanningSessionId(planningSession.id);
    setPlanningSessionStatus(planningSession.status);
    setResultLoadingPlanId(planningSession.status === "draft_ready" && planningSession.outputPlanId ? planningSession.outputPlanId : null);
    setProposal(planningSession.proposal);
    setMissingDetails(planningSession.unresolved);
    setSessionFacts(planningSession.facts);
    if (planningSession.status === "generating") setProcessingStatus("Starting complete plan generation…");
    if (planningSession.status === "draft_ready" && planningSession.outputPlanId) setProcessingStatus(`Plan saved. Loading draft ${planningSession.outputPlanId}…`);
  }, [mode, planningSession?.id, planningSession?.status, planningSession?.proposal?.version, planningSession?.updatedAt]);
  useEffect(() => {
    if (mode !== "new_plan" || !planningSession || !(planningSession.status === "generating"
      || (planningSession.status === "proposal_ready" && planningSession.confirmedProposalVersion === planningSession.proposal?.version))) return;
    let cancelled = false;
    const generation = externalScope.current.generation;
    void getPlanningGeneration(planningSession.id).then((payload) => {
      if (!payload || cancelled || generation !== externalScope.current.generation) return;
      applyGenerationSnapshot(payload);
    }).catch(() => undefined);
    return () => { cancelled = true; };
  }, [mode, planningSession?.id, planningSession?.status, propVersion]);
  useEffect(() => {
    if (mode !== "new_plan" || !planningSessionId || planningSessionStatus !== "generating") return;
    let cancelled = false;
    const generation = externalScope.current.generation;
    const pollGeneration = async () => {
      try {
        const payload = await getPlanningGeneration(planningSessionId);
        if (!payload || cancelled || generation !== externalScope.current.generation) return;
        if (cancelled) return;
        applyGenerationSnapshot(payload);
        if (payload.sessionStatus === "draft_ready" && payload.outputPlanId) void openSavedPlan(planningSessionId, payload.outputPlanId);
      } catch { /* Workspace polling remains the fallback. */ }
    };
    void pollGeneration();
    const events = new EventSource(planningGenerationEventsUrl(planningSessionId));
    events.addEventListener("generation", () => void pollGeneration());
    const interval = window.setInterval(() => void pollGeneration(), 5_000);
    return () => { cancelled = true; events.close(); window.clearInterval(interval); };
  }, [mode, planningSessionId, planningSessionStatus, onError, propVersion]);
  useEffect(() => {
    if (mode !== "new_plan" || !planningSessionId || !resultLoadingPlanId) return;
    void openSavedPlan(planningSessionId, resultLoadingPlanId);
    const interval = window.setInterval(() => void openSavedPlan(planningSessionId, resultLoadingPlanId), 5_000);
    return () => window.clearInterval(interval);
  }, [mode, planningSessionId, resultLoadingPlanId]);
  useEffect(() => {
    const frame = window.requestAnimationFrame(() => {
      const conversations = document.querySelectorAll<HTMLElement>(".conversation");
      const latest = conversations.item(conversations.length - 1);
      if (latest) latest.scrollTo({ top: latest.scrollHeight, behavior: "smooth" });
    });
    return () => window.cancelAnimationFrame(frame);
  }, [messages, busy]);

  async function confirmProposal() {
    if (!planningSessionId || !proposal || !generationCanRetry || !continuationScope || !continuationReady || continuationInFlight.current) return;
    continuationInFlight.current = true;
    const confirmedContinuationKey = continuationKey, confirmationPort = continuation, confirmationBusyOwner = {};
    const confirmationScope = externalScope.current.generation, confirmationEdits = inputEdits.current;
    const confirmationCurrent = () => confirmationScope === externalScope.current.generation && confirmationEdits === inputEdits.current && confirmedContinuationKey === latestContinuationKey.current && confirmationPort === latestContinuationPort.current;
    try {
      const rechecked = await readPlanningContinuation(continuation, continuationScope);
      if (!confirmationCurrent()) return;
      if (!rechecked) { setContinuationObservation(null); onError("Plan generation is not ready. Check again to refresh. Your saved requirements are kept."); return; }
      busyOwner.current = confirmationBusyOwner; onError(""); setBusy(true); setProcessingStatus("Starting complete plan generation…"); onStatus({ tone: "working", text: "Creating your complete plan…" });
      const payload = await confirmPlanningProposal(planningSessionId, proposal.version, continuationScope.revision);
      if (!confirmationCurrent()) return;
      if (!payload.workspace) throw new Error(payload.error ?? "Plan confirmation did not finish.");
      if (payload.accepted) {
        setPlanningSessionId(payload.planningSession?.id ?? payload.workspace.planningSession?.id);
        setProposal((payload.proposal ?? payload.planningSession?.proposal ?? payload.workspace.planningSession?.proposal) as PlanningProposal);
        setPlanningSessionStatus("generating");
        setProcessingStatus(generationStageMessage(payload.generation?.stage ?? "queued"));
        await onPlanCreated(payload.workspace);
        if (!confirmationCurrent()) return;
        onStatus({ tone: "working", text: "Generating your complete plan…" });
        return;
      }
      if (!payload.generated) {
        const assistantMessage = { id: crypto.randomUUID(), role: "assistant" as const, text: payload.reply ?? "The plan direction is confirmed. Add the remaining details needed to generate it." };
        setMessages((current) => [...current, assistantMessage]);
        setPlanningSessionId(payload.planningSession?.id ?? payload.workspace.planningSession?.id);
        setProposal((payload.proposal ?? payload.planningSession?.proposal ?? payload.workspace.planningSession?.proposal) as PlanningProposal);
        setPlanningSessionStatus(payload.planningSession?.status ?? payload.workspace.planningSession?.status);
        setMissingDetails(payload.planningSession?.unresolved ?? payload.workspace.planningSession?.unresolved ?? []);
        setSessionFacts(payload.planningSession?.facts ?? payload.workspace.planningSession?.facts ?? []);
        setProcessingStatus("Plan direction confirmed. Waiting for the remaining details");
        await onPlanCreated(payload.workspace);
        if (!confirmationCurrent()) return;
        onStatus({ tone: "success", text: "Plan direction confirmed. Please add the remaining key details." });
        return;
      }
      setActiveMode("revise_plan"); setProcessingStatus("Complete plan ready. Return to the workspace to review it."); setReadyForReview(true); onError(""); await onPlanCreated(payload.workspace); onStatus({ tone: "success", text: payload.evidenceStatus === "verified" ? "Complete plan ready with official sources attached." : "Complete plan ready. Some sources still need verification." });
    } catch (caught) {
      if (!confirmationCurrent()) return;
      const messageText = "Unable to generate the complete plan.";
      setMessages((current) => [...current, { id: crypto.randomUUID(), role: "assistant", text: messageText }]);
      setProcessingStatus("Generation did not finish. Adjust the proposal or try again."); onStatus({ tone: "error", text: messageText }); onError(messageText);
    } finally {
      continuationInFlight.current = false;
      // Losing permission to publish a response does not transfer ownership of this busy flag.
      if (busyOwner.current === confirmationBusyOwner) {
        busyOwner.current = null;
        if (confirmationScope === externalScope.current.generation) setBusy(false);
      }
    }
  }

  useEffect(() => () => { externalScope.current = { ...externalScope.current, generation: externalScope.current.generation + 1 }; pendingReadEpoch.current++; }, []);
  const sendInFlight = useRef(false);
  async function send(retryOriginal = false) {
    if (sendInFlight.current) return;
    sendInFlight.current = true;
    try { await sendOperation(retryOriginal); } finally { sendInFlight.current = false; }
  }
  async function sendOperation(retryOriginal = false) {
    const rawInput = input, message = rawInput.trim(); if (!message || busy) return;
    let impactConfirmed = false;
    if (activeMode === "revise_plan") {
      if (!currentPlan) { onError("There is no current plan to modify."); return; }
      try {
        const preview = await previewPlanChangeImpact(currentPlan.id, message, currentPlan.version);
        if (preview.requiresConfirmation) {
          const details = preview.reasons.map((reason, index) => `${index + 1}. ${reason}`).join("\n");
          impactConfirmed = window.confirm(`${preview.summary}\n\n${details}\n\nAfter confirmation, Landi will create a complete replacement draft. The active plan will not switch immediately. Continue?`);
          if (!impactConfirmed) { setProcessingStatus("The high-impact change was not confirmed. The current plan is unchanged."); onStatus({ tone: "success", text: "High-impact change cancelled. The current plan is unchanged." }); return; }
        }
      } catch (caught) { const messageText = "Unable to assess the impact of this change."; onError(messageText); onStatus({ tone: "error", text: messageText }); return; }
    }
    const preflightScope = externalScope.current.generation, preflightEdits = inputEdits.current;
    let planningIdentity: PlanningMessageIdentity | undefined;
    if (activeMode === "new_plan") {
      try {
        const pending = pendingPlanningMessage(localStorage, pendingMessageKey, planningSessionId, message);
        if (pending) {
          const found = await reconcilePendingSave(pending);
          if (externalScope.current.generation !== preflightScope || inputEdits.current !== preflightEdits) return;
          if (found || !retryOriginal || (pending.identity.sessionId === undefined && planningSessionId !== undefined)) return;
        }
        if (requirementsRevision === undefined && !pending) { onError("Refresh the workspace to load the current requirements version before saving."); return; }
        const signature = readPlanningDraftSignature(localStorage, draftKey);
        if (!signature || signature.raw !== input) { onError('Your browser draft could not be verified. Keep the text and restore local storage before saving.'); return; }
        planningIdentity = preparePlanningMessage(localStorage, pendingMessageKey, message, { ...(planningSessionId ? { sessionId: planningSessionId } : {}), revision: requirementsRevision ?? pending!.identity.expectedRevision }, undefined, signature);
      }
      catch { onError("Browser storage is unavailable. Keep this text and enable local storage before saving."); return; }
    }
    const operation = { epoch: inputEdits.current, sessionId: planningSessionId, draftKey, generation: externalScope.current.generation };
    const sameScope = () => externalScope.current.generation === operation.generation;
    const operationCurrent = () => inputEdits.current === operation.epoch && currentScope.current.draftKey === operation.draftKey && currentScope.current.sessionId === operation.sessionId;
    const userMessage = { id: planningIdentity?.messageId ?? crypto.randomUUID(), role: "user" as const, text: message };
    setMessages((current) => { const next = current.some(item => item.id === userMessage.id) ? current : [...current, userMessage]; cacheConversation(conversationKey, next); return next; }); setInput(""); busyOwner.current = {}; setBusy(true);
    const collecting = activeMode === "new_plan";
    setProcessingStatus(collecting ? "Saving your requirements…" : "Answer received. Rechecking the destination and applicable sources…"); if (!collecting) onStatus({ tone: "working", text: "Rechecking the destination and applicable sources…" });
    const progressTimers = [
      window.setTimeout(() => { if (!sameScope()) return; setProcessingStatus(collecting ? "Saving your requirements…" : "Checking which itinerary points and preparations are affected…"); if (!collecting) onStatus({ tone: "working", text: "Reviewing the new details and adjusting the plan…" }); }, 45_000),
      window.setTimeout(() => { if (!sameScope()) return; setProcessingStatus(collecting ? "Saving your requirements…" : "Reordering the timeline and reviewing official sources. Please wait…"); if (!collecting) onStatus({ tone: "working", text: "Reordering the timeline and reviewing official sources…" }); }, 150_000)
    ];
    if (collecting) {
      let requirementsSaved = false;
      let savedNotice = "Requirements saved.";
      try {
        const payload = await sendAgentChat({ mode: "new_plan", message, ...planningIdentity! });
        if (!payload.workspace) throw new Error(payload.error ?? "Landi is temporarily unavailable.");
        if (!sameScope()) return;
        updateRequirementsRevision({ kind: 'observe', value: payload.planningRevision, sessionId: payload.planningSession?.id ?? payload.workspace.planningSession?.id ?? operation.sessionId, epoch: revisionState.epoch });
        requirementsSaved = true;
        setResultCheck(payload.mahTask && payload.mahTask.status !== 'failed' ? { sessionId: payload.saveReceipt!.sessionId, messageId: payload.saveReceipt!.messageId,
          expectedRevision: payload.saveReceipt!.expectedRevision } : null);
        savedNotice = payload.blocked ? "Requirements saved. Processing is not ready. Check MAH and try again." : "Requirements saved.";
        if (payload.blocked) {
          setSubmittedNotice({ sessionId: planningIdentity?.sessionId ?? payload.planningSession?.id ?? "", messageId: planningIdentity!.messageId, text: savedNotice, verified: true });
        }
        // Retain the receipt if draft cleanup failed, so a restored draft still retries safely.
        if (!operationCurrent() || clearSavedInput()) settlePlanningMessage(localStorage, pendingMessageKey, planningIdentity!.messageId);
        const assistantMessage = { id: crypto.randomUUID(), role: "assistant" as const, text: payload.blocked ? savedNotice : payload.reply ?? "Got it." };
        setMessages((current) => { const next = [...current, assistantMessage]; cacheConversation(conversationKey, next); return next; });
        if (payload.generated) {
          setActiveMode("revise_plan"); setReadyForReview(true); setProcessingStatus("Complete plan ready. Return to the workspace to review it.");
          await refreshSavedWorkspace(payload.workspace);
          if (!sameScope()) return;
          onStatus({ tone: "success", text: payload.evidenceStatus === "verified" ? "Complete plan ready with official sources attached." : "Complete plan ready. Some sources still need verification." });
          return;
        }
        const nextSessionId = payload.planningSession?.id ?? payload.workspace.planningSession?.id;
        const nextProposal = (payload.proposal ?? payload.planningSession?.proposal) as PlanningProposal | undefined;
        const nextStatus = payload.planningStatus ?? payload.planningSession?.status ?? payload.workspace.planningSession?.status;
        if (!operation.sessionId && nextSessionId) ownSessionBinding.current = nextSessionId;
        setPlanningSessionId(nextSessionId);
        setProposal(nextProposal);
        setPlanningSessionStatus(nextStatus);
        const nextSession = payload.planningSession ?? payload.workspace.planningSession;
        setMissingDetails(nextSession?.unresolved ?? []);
        setSessionFacts(nextSession?.facts ?? []);
        setProcessingStatus(payload.blocked ? savedNotice : payload.accepted ? generationStageMessage(payload.generation?.stage ?? "queued") : nextSession?.unresolved.length ? "More trip details are needed. Answer the question below." : "Details complete. Preparing to generate the plan");
        await refreshSavedWorkspace(payload.workspace);
        if (!sameScope()) return;
        if (payload.accepted) onStatus({ tone: "working", text: "Generating your complete plan…" });
      } catch (caught) {
        if (!sameScope()) return;
        if (caught instanceof PlanningRequirementsSaved) {
          requirementsSaved = true; savedNotice = savedProcessingUnverified;
          if (!operation.sessionId) ownSessionBinding.current = caught.saveReceipt.sessionId;
          setPlanningSessionId(caught.saveReceipt.sessionId);
          updateRequirementsRevision({ kind: 'observe', value: caught.saveReceipt.savedRevision, sessionId: caught.saveReceipt.sessionId, epoch: revisionState.epoch });
          if (operationCurrent()) setInput('');
          if (!operationCurrent() || clearSavedInput()) settlePlanningMessage(localStorage, pendingMessageKey, planningIdentity!.messageId);
          setSubmittedNotice({ sessionId: caught.saveReceipt.sessionId, messageId: planningIdentity!.messageId, text: savedNotice, verified: true }); setProcessingStatus(savedNotice);
          onStatus({ tone: 'error', text: savedNotice });
          return;
        }
        if (requirementsSaved) {
          setSubmittedNotice({ sessionId: planningIdentity?.sessionId ?? "", messageId: planningIdentity!.messageId, text: savedNotice, verified: true }); setProcessingStatus(savedNotice);
          onError("Some workspace details could not be refreshed.");
          return;
        }
        const definitelyRejected = caught instanceof PlanningMessageRejected && caught.code === 'planning_revision_conflict';
        if (definitelyRejected) { forgetRejectedPlanningMessage(localStorage, pendingMessageKey, caught.code, planningIdentity!.messageId); updateRequirementsRevision({ kind: 'invalidate' }); if (caught.code === 'planning_revision_conflict') setRevisionReadAttempt(attempt => attempt + 1); }
        if (operationCurrent()) setInput(rawInput);
        const messageText = "Landi is temporarily unavailable.";
        const assistantMessage = { id: crypto.randomUUID(), role: "assistant" as const, text: messageText };
        setMessages((current) => { const next = [...current, assistantMessage]; cacheConversation(conversationKey, next); return next; });
        const notice = definitelyRejected ? messageText : "We couldn’t confirm whether your requirements were saved. Your text is kept here. Retry to confirm.";
        if (operationCurrent()) setRequirementsNotice({ kind: definitelyRejected ? "rejected" : "unknown", sessionId: operation.sessionId, draftKey: operation.draftKey, epoch: operation.epoch, messageId: planningIdentity!.messageId, text: notice }); setProcessingStatus(notice); onStatus({ tone: "error", text: notice }); onError(messageText);
      } finally {
        progressTimers.forEach((timer) => window.clearTimeout(timer)); if (sameScope()) setBusy(false);
      }
      return;
    }
    try { const payload = await sendAgentChat({ mode: activeMode, message, ...(currentPlan ? { expectedPlanId: currentPlan.id, expectedVersion: currentPlan.version } : {}), ...(impactConfirmed ? { impactConfirmed: true } : {}) }); if (!payload.workspace) throw new Error(payload.error ?? "Landi cannot create the plan right now."); clearSavedInput(); const assistantMessage = { id: crypto.randomUUID(), role: "assistant" as const, text: payload.reply ?? "The plan is saved." }; setMessages((current) => { const next = [...current, assistantMessage]; localStorage.setItem(conversationKey, JSON.stringify(next)); localStorage.setItem(conversationStorageKey("revise_plan", payload.workspace!.activePlan.id), JSON.stringify(next)); return next; }); setActiveMode("revise_plan"); setReadyForReview(Boolean(payload.readyForReview)); setProcessingStatus(payload.followUpQuestion ? "Plan updated. Finish now or answer the remaining key question." : "Plan updated and ready for review."); await onPlanCreated(payload.workspace); onStatus({ tone: "success", text: payload.followUpQuestion ? "Plan updated. You can finish refining at any time." : "Plan updated and ready for review." }); }
    catch (caught) { setInput(message);
        const messageText = "Landi is temporarily unavailable."; const assistantMessage = { id: crypto.randomUUID(), role: "assistant" as const, text: messageText }; setMessages((current) => { const next = [...current, assistantMessage]; localStorage.setItem(conversationKey, JSON.stringify(next)); return next; }); setProcessingStatus("The update did not finish. Please try again."); onStatus({ tone: "error", text: "The update did not finish. Please try again." }); onError(messageText); }
    finally { progressTimers.forEach((timer) => window.clearTimeout(timer)); setBusy(false); }
  }

  async function checkPlanningResult() {
    if (!resultCheck || busy || resultCheckInFlight.current || resultCheck.sessionId !== planningSessionId) return;
    const message = messages.find(item => item.id === resultCheck.messageId && item.role === 'user');
    if (!message) return;
    const scope = { ...resultCheck }, generation = externalScope.current.generation;
    resultCheckInFlight.current = true;
    setBusy(true);
    try {
      const payload = await sendAgentChat({ mode: 'new_plan', message: message.text, ...scope, checkResultOnly: true });
      if (generation !== externalScope.current.generation || currentScope.current.sessionId !== scope.sessionId) return;
      if (!payload.workspace || payload.planningSession?.id !== scope.sessionId) throw new Error('The original request could not be verified.');
      const session = payload.planningSession;
      const text = payload.blocked ? 'Your requirements are saved. Processing is not ready. Check MAH and try again.' : 'The saved request has been checked.';
      setSubmittedNotice({ sessionId: scope.sessionId, messageId: scope.messageId, text, verified: true });
      setProcessingStatus(text);
      setProposal(session.proposal);
      setPlanningSessionStatus(session.status);
      setMissingDetails(session.unresolved);
      setSessionFacts(session.facts);
      if (!payload.blocked) {
        setMessages(conversationFromPlanningSession(session, welcome));
        setResultCheck(null);
      }
      updateRequirementsRevision({ kind: 'observe', value: payload.planningRevision, sessionId: scope.sessionId, epoch: revisionState.epoch });
      await onPlanCreated(payload.workspace);
    } catch {
      if (generation === externalScope.current.generation) setProcessingStatus('The result could not be verified. The original request is preserved.');
    } finally {
      resultCheckInFlight.current = false;
      setBusy(false);
    }
  }

  return <div className="plan-composer">
    {activeMode === 'new_plan' && resultCheck?.sessionId === planningSessionId ? <button type="button" disabled={busy} onClick={() => void checkPlanningResult()}>Check planning result</button> : null}
    {activeMode === "new_plan" ? <MahPlanningGuide generationAdmission={continuationReady && continuationScope && continuationObservation ? { ...continuationScope, validUntil: continuationObservation.validUntil } : undefined} generationInProgress={planningSessionStatus === "generating"} generationResumable={canResumeGeneration} onRecheck={() => { void checkPendingSave(); setContinuationReadAttempt(value => value + 1); }} baseline={{ ...(planningSessionId ? { sessionId: planningSessionId } : {}), ...(requirementsRevision !== undefined ? { revision: requirementsRevision } : {}), proposalVersion: proposal?.version ?? null }} /> : null}
    {activeMode === "new_plan" && (input.trim() || submittedNotice) ? <aside className="mah-planning-entry" aria-label="Planning availability"><p>{input.trim() ? requirementsNotice && requirementsNotice.draftKey === draftKey && requirementsNotice.epoch === inputEdits.current ? requirementsNotice.text : "Your requirements have not been saved to the server. Unsent text is kept in this browser when local storage is available." : submittedNotice?.sessionId === planningSessionId && submittedNotice?.messageId === latestUserId ? submittedNotice?.text : null}</p>{input.trim() && submittedNotice?.sessionId === planningSessionId && submittedNotice?.messageId === latestUserId ? <p>Previously submitted requirements: {submittedNotice?.text}</p> : null}</aside> : null}
    <div className="conversation" aria-live="polite">{messages.map((message) => <div className={`chat-bubble ${message.role}`} key={message.id}>{message.role === "assistant" ? <img className="chat-avatar" src={landiLogoUrl} alt="Landi" /> : null}{activeMode === "new_plan" && message.role === "assistant" && message.id === latestAssistantId ? <div className="booking-question-body"><p>{message.text}</p><div className="booking-import-slot" ref={setBookingImportTarget} /></div> : <p>{message.text}</p>}</div>)}{composerWorking && !planGenerationInProgress ? <div className="chat-bubble assistant thinking"><img className="chat-avatar" src={landiLogoUrl} alt="Landi" /><p><span className="thinking-label">{activeMode === "new_plan" ? "Saving your requirements…" : "Understanding and organizing your details…"}</span></p></div> : null}</div>
    {composerWorking ? <div className={`composer-status working${planGenerationInProgress ? " generating" : ""}`} aria-live="polite"><b>●</b>{processingStatus}</div> : null}
    {generationCanRetry ? <div className="generation-retry" role="status"><div><strong>Review your trip details</strong><dl>{reviewFacts.map((item) => <div key={item.key}><dt>{item.label}</dt><dd>{item.value}</dd></div>)}</dl><span>To correct anything, send another message before generating.</span></div><button type="button" disabled={!continuationReady || busy} title={continuationReady ? undefined : "Plan generation is not ready. Check again to refresh."} onClick={() => void confirmProposal()}>{canResumeGeneration ? "Continue plan generation" : "Generate plan"}</button></div> : null}
    {readyForReview && activeMode !== "new_plan" ? <div className="review-ready"><div><strong>Your plan is ready</strong><span>Return to the workspace to review the complete plan, or keep telling Landi what to change.</span></div><button type="button" onClick={onComplete}>View complete plan</button></div> : null}
    {activeMode === "new_plan" ? <BookingImportPanel scope={planningSessionId ? { type: "planning", sessionId: planningSessionId } : { type: "planning" }} compact contextual contextTarget={bookingImportTarget} prompted={!composerWorking && shouldOfferBookingImport(messages)} onWorkspace={onPlanCreated} onPlanningSession={(session) => { if (!planningSessionId) ownSessionBinding.current = session.id; setPlanningSessionId(session.id); setPlanningSessionStatus(session.status); setProposal(session.proposal); setMissingDetails(session.unresolved); setSessionFacts(session.facts); }} onStatus={onStatus} onError={onError} /> : null}
    {activeMode === "new_plan" && requirementsNotice?.kind === 'unknown' && requirementsNotice.draftKey === draftKey && requirementsNotice.epoch === inputEdits.current ? <div className="mah-planning-guide-actions"><button type="button" disabled={busy} onClick={() => void checkPendingSave()}>Check original save</button><button type="button" disabled={busy} onClick={() => void send(true)}>Retry original save</button></div> : null}
    <div className="chat-input"><textarea value={input} onChange={(event) => saveInput(event.target.value, true)} onKeyDown={(event) => { if (event.key === "Enter" && !event.shiftKey) { event.preventDefault(); void send(); } }} placeholder={activeMode === "new_plan" ? "Chat with Landi" : "Answer the previous question or add another request…"} rows={2} maxLength={1500} disabled={composerWorking} /><div className="composer-actions"><button className="send-button" onClick={() => void send()} disabled={composerWorking || !input.trim()} aria-label="Send">↑</button></div></div>
  </div>;
}
