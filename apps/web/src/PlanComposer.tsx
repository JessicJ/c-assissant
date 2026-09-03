import { useEffect, useRef, useState } from "react";
import type { Plan, PlanningProposal, PlanningSession, WorkspaceSnapshot } from "@c-assistant/core";
import landiLogoUrl from "../../../assets/branding/landi-round-otter-earth-icon-final.png";
import { confirmPlanningProposal, getPlanningGeneration, planningGenerationEventsUrl, previewPlanChangeImpact, sendAgentChat } from "./api-client.js";
import { BookingImportPanel } from "./BookingImportPanel.js";
import { conversationFromPlanningSession, conversationStorageKey, loadConversation, type ChatMessage } from "./conversation-state.js";
import { refinementIntro } from "./plan-display.js";
import { generationProgressMessage, generationStageMessage } from "./plan-generation-display.js";
import type { AgentStatus } from "./ui-types.js";

export type ComposerMode = "new_plan" | "revise_plan";

export function InlineComposerWorkspace({ mode, currentPlan, planningSession, initialMessage, onClose, onPlanCreated, onStatus, onError }: { mode: ComposerMode; currentPlan: Plan | null; planningSession?: PlanningSession | undefined; initialMessage: string; onClose: () => void; onPlanCreated: (workspace: WorkspaceSnapshot) => Promise<void>; onStatus: (status: AgentStatus) => void; onError: (message: string) => void }) {
  const [busy, setBusy] = useState(false);
  return <section className="inline-composer-workspace" aria-label={mode === "new_plan" ? "Tell Landi your goal" : "Adjust current plan"}><header><div><h1>{mode === "new_plan" ? "Plan your trip with Landi" : "Adjust your plan with Landi"}</h1></div><button type="button" onClick={onClose} disabled={busy}>{busy ? "Working…" : mode === "new_plan" && planningSession ? "Exit for now" : "Back"}</button></header><PlanComposer mode={mode} currentPlan={currentPlan} planningSession={planningSession} initialMessage={initialMessage} onPlanCreated={onPlanCreated} onStatus={onStatus} onComplete={onClose} onError={onError} onBusyChange={setBusy} /></section>;
}

export function PlanComposer({ mode, currentPlan, planningSession, initialMessage = "", onPlanCreated, onStatus, onComplete, onError, onBusyChange }: { mode: ComposerMode; currentPlan: Plan | null; planningSession?: PlanningSession | undefined; initialMessage?: string; onPlanCreated: (workspace: WorkspaceSnapshot) => Promise<void>; onStatus: (status: AgentStatus) => void; onComplete: () => void; onError: (message: string) => void; onBusyChange?: (busy: boolean) => void }) {
  const welcome = mode === "new_plan" ? "Tell me where you want to go, when, and what matters most. You can also add flights, accommodation, food, transport, budget, or luggage preferences. I will organize the details and create the complete plan." : refinementIntro(currentPlan);
  const conversationKey = useRef(conversationStorageKey(mode, currentPlan?.id)).current;
  const [input, setInput] = useState(initialMessage);
  const [busy, setBusy] = useState(false);
  const [activeMode, setActiveMode] = useState<ComposerMode>(mode);
  const [readyForReview, setReadyForReview] = useState(false);
  const [proposal, setProposal] = useState<PlanningProposal | undefined>(planningSession?.proposal);
  const [planningSessionId, setPlanningSessionId] = useState<string | undefined>(planningSession?.id);
  const [planningSessionStatus, setPlanningSessionStatus] = useState<PlanningSession["status"] | undefined>(planningSession?.status);
  const [processingStatus, setProcessingStatus] = useState(mode === "new_plan" ? "Waiting for your trip details" : "Waiting for your answer about the current plan");
  const [messages, setMessages] = useState<ChatMessage[]>(() => mode === "new_plan" ? conversationFromPlanningSession(planningSession, welcome) : loadConversation(localStorage, conversationKey, welcome));
  const autoConfirmedProposalRef = useRef<string | null>(null);
  const proposalReadyFromTurnRef = useRef<string | null>(null);
  const planGenerationInProgress = planningSessionStatus === "generating" || (busy && planningSessionStatus === "proposal_ready");
  const composerWorking = busy || planningSessionStatus === "generating";
  const generationCanRetry = mode === "new_plan" && planningSessionStatus === "proposal_ready" && Boolean(proposal && planningSessionId) && !busy;
  useEffect(() => { onBusyChange?.(busy); return () => onBusyChange?.(false); }, [busy, onBusyChange]);
  useEffect(() => {
    if (mode !== "new_plan" || !proposal || !planningSessionId || planningSessionStatus !== "proposal_ready" || busy) return;
    const confirmationKey = `${planningSessionId}:${proposal.version}`;
    if (proposalReadyFromTurnRef.current !== confirmationKey) return;
    if (autoConfirmedProposalRef.current === confirmationKey) return;
    proposalReadyFromTurnRef.current = null;
    autoConfirmedProposalRef.current = confirmationKey;
    void confirmProposal();
  }, [mode, proposal, planningSessionId, planningSessionStatus, busy]);

  useEffect(() => { setInput(initialMessage); setActiveMode(mode); setReadyForReview(false); setProposal(mode === "new_plan" ? planningSession?.proposal : undefined); setPlanningSessionId(mode === "new_plan" ? planningSession?.id : undefined); setPlanningSessionStatus(mode === "new_plan" ? planningSession?.status : undefined); setProcessingStatus(mode === "new_plan" ? planningSession?.status === "generating" ? "Starting complete plan generation…" : "Waiting for your trip details" : initialMessage ? "Map changes are ready. Send them and Landi will replan" : "Waiting for your answer about the current plan"); setMessages(mode === "new_plan" ? conversationFromPlanningSession(planningSession, welcome) : loadConversation(localStorage, conversationKey, welcome)); }, [mode, initialMessage]);
  useEffect(() => {
    if (mode !== "new_plan" || !planningSession) return;
    setPlanningSessionId(planningSession.id);
    setPlanningSessionStatus(planningSession.status);
    setProposal(planningSession.proposal);
    if (planningSession.status === "generating") setProcessingStatus("Starting complete plan generation…");
  }, [mode, planningSession?.id, planningSession?.status, planningSession?.proposal?.version]);
  useEffect(() => {
    if (mode !== "new_plan" || !planningSessionId || planningSessionStatus !== "generating") return;
    let cancelled = false;
    const pollGeneration = async () => {
      try {
        const payload = await getPlanningGeneration(planningSessionId);
        if (!payload || cancelled) return;
        if (cancelled) return;
        setPlanningSessionStatus(payload.sessionStatus);
        if (payload.generation) setProcessingStatus(generationProgressMessage(payload.generation));
        if (payload.generation?.status === "failed") onError(payload.generation.message ?? "Plan generation did not finish. Your trip details are saved.");
      } catch { /* Workspace polling remains the fallback. */ }
    };
    void pollGeneration();
    const events = new EventSource(planningGenerationEventsUrl(planningSessionId));
    events.addEventListener("generation", () => void pollGeneration());
    const interval = window.setInterval(() => void pollGeneration(), 5_000);
    return () => { cancelled = true; events.close(); window.clearInterval(interval); };
  }, [mode, planningSessionId, planningSessionStatus, onError]);
  useEffect(() => {
    const frame = window.requestAnimationFrame(() => {
      const conversations = document.querySelectorAll<HTMLElement>(".conversation");
      const latest = conversations.item(conversations.length - 1);
      if (latest) latest.scrollTo({ top: latest.scrollHeight, behavior: "smooth" });
    });
    return () => window.cancelAnimationFrame(frame);
  }, [messages, busy]);

  async function confirmProposal() {
    if (!planningSessionId || !proposal || busy) return;
    onError(""); setBusy(true); setProcessingStatus("Starting complete plan generation…"); onStatus({ tone: "working", text: "Creating your complete plan…" });
    try {
      const payload = await confirmPlanningProposal(planningSessionId, proposal.version);
      if (!payload.workspace) throw new Error(payload.error ?? "Plan confirmation did not finish.");
      if (payload.accepted) {
        setPlanningSessionId(payload.planningSession?.id ?? payload.workspace.planningSession?.id);
        setProposal((payload.proposal ?? payload.planningSession?.proposal ?? payload.workspace.planningSession?.proposal) as PlanningProposal);
        setPlanningSessionStatus("generating");
        setProcessingStatus(generationStageMessage(payload.generation?.stage ?? "queued"));
        await onPlanCreated(payload.workspace);
        onStatus({ tone: "working", text: "Generating your complete plan…" });
        return;
      }
      if (!payload.generated) {
        const assistantMessage = { id: crypto.randomUUID(), role: "assistant" as const, text: payload.reply ?? "The plan direction is confirmed. Add the remaining details needed to generate it." };
        setMessages((current) => [...current, assistantMessage]);
        setPlanningSessionId(payload.planningSession?.id ?? payload.workspace.planningSession?.id);
        setProposal((payload.proposal ?? payload.planningSession?.proposal ?? payload.workspace.planningSession?.proposal) as PlanningProposal);
        setPlanningSessionStatus(payload.planningSession?.status ?? payload.workspace.planningSession?.status);
        setProcessingStatus("Plan direction confirmed. Waiting for the remaining details");
        await onPlanCreated(payload.workspace);
        onStatus({ tone: "success", text: "Plan direction confirmed. Please add the remaining key details." });
        return;
      }
      setActiveMode("revise_plan"); setProcessingStatus("Complete plan ready. Return to the workspace to review it."); setReadyForReview(true); onError(""); await onPlanCreated(payload.workspace); onStatus({ tone: "success", text: payload.evidenceStatus === "verified" ? "Complete plan ready with official sources attached." : "Complete plan ready. Some sources still need verification." });
    } catch (caught) {
      const messageText = caught instanceof Error ? caught.message : "Unable to generate the complete plan.";
      setProcessingStatus("Generation did not finish. Adjust the proposal or try again."); onStatus({ tone: "error", text: messageText }); onError(messageText);
    } finally { setBusy(false); }
  }

  async function send() {
    const message = input.trim(); if (!message || busy) return;
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
      } catch (caught) { const messageText = caught instanceof Error ? caught.message : "Unable to assess the impact of this change."; onError(messageText); onStatus({ tone: "error", text: messageText }); return; }
    }
    const userMessage = { id: crypto.randomUUID(), role: "user" as const, text: message };
    setMessages((current) => { const next = [...current, userMessage]; localStorage.setItem(conversationKey, JSON.stringify(next)); return next; }); setInput(""); setBusy(true);
    const collecting = activeMode === "new_plan";
    setProcessingStatus(collecting ? "Organizing your goal and essential details…" : "Answer received. Rechecking the destination and applicable sources…"); if (!collecting) onStatus({ tone: "working", text: "Rechecking the destination and applicable sources…" });
    const progressTimers = [
      window.setTimeout(() => { setProcessingStatus(collecting ? "Identifying the next essential detail…" : "Checking which itinerary points and preparations are affected…"); if (!collecting) onStatus({ tone: "working", text: "Reviewing the new details and adjusting the plan…" }); }, 45_000),
      window.setTimeout(() => { setProcessingStatus(collecting ? "Creating the complete plan. Please wait a little longer…" : "Reordering the timeline and reviewing official sources. Please wait…"); if (!collecting) onStatus({ tone: "working", text: "Reordering the timeline and reviewing official sources…" }); }, 150_000)
    ];
    if (collecting) {
      try {
        const payload = await sendAgentChat({ mode: "new_plan", message });
        if (!payload.workspace) throw new Error(payload.error ?? "Landi is temporarily unavailable.");
        const assistantMessage = { id: crypto.randomUUID(), role: "assistant" as const, text: payload.reply ?? "Got it." };
        setMessages((current) => { const next = [...current, assistantMessage]; localStorage.setItem(conversationKey, JSON.stringify(next)); return next; });
        if (payload.generated) {
          setActiveMode("revise_plan"); setReadyForReview(true); setProcessingStatus("Complete plan ready. Return to the workspace to review it.");
          await onPlanCreated(payload.workspace);
          onStatus({ tone: "success", text: payload.evidenceStatus === "verified" ? "Complete plan ready with official sources attached." : "Complete plan ready. Some sources still need verification." });
          return;
        }
        const nextSessionId = payload.planningSession?.id ?? payload.workspace.planningSession?.id;
        const nextProposal = (payload.proposal ?? payload.planningSession?.proposal) as PlanningProposal | undefined;
        const nextStatus = payload.planningStatus ?? payload.planningSession?.status ?? payload.workspace.planningSession?.status;
        if (nextSessionId && nextProposal && nextStatus === "proposal_ready") proposalReadyFromTurnRef.current = `${nextSessionId}:${nextProposal.version}`;
        setPlanningSessionId(nextSessionId);
        setProposal(nextProposal);
        setPlanningSessionStatus(nextStatus);
        const nextSession = payload.planningSession ?? payload.workspace.planningSession;
        setProcessingStatus(payload.accepted ? generationStageMessage(payload.generation?.stage ?? "queued") : nextSession?.unresolved[0]?.question ?? "Details complete. Preparing to generate the plan");
        await onPlanCreated(payload.workspace);
        if (payload.accepted) onStatus({ tone: "working", text: "Generating your complete plan…" });
      } catch (caught) {
        const messageText = caught instanceof Error ? caught.message : "Landi is temporarily unavailable.";
        const assistantMessage = { id: crypto.randomUUID(), role: "assistant" as const, text: messageText };
        setMessages((current) => { const next = [...current, assistantMessage]; localStorage.setItem(conversationKey, JSON.stringify(next)); return next; });
        setProcessingStatus("The update did not finish. Please try again."); onStatus({ tone: "error", text: "The update did not finish. Please try again." }); onError(messageText);
      } finally {
        progressTimers.forEach((timer) => window.clearTimeout(timer)); setBusy(false);
      }
      return;
    }
    try { const payload = await sendAgentChat({ mode: activeMode, message, ...(currentPlan ? { expectedPlanId: currentPlan.id, expectedVersion: currentPlan.version } : {}), ...(impactConfirmed ? { impactConfirmed: true } : {}) }); if (!payload.workspace) throw new Error(payload.error ?? "Landi cannot create the plan right now."); const assistantMessage = { id: crypto.randomUUID(), role: "assistant" as const, text: payload.reply ?? "The plan is saved." }; setMessages((current) => { const next = [...current, assistantMessage]; localStorage.setItem(conversationKey, JSON.stringify(next)); localStorage.setItem(conversationStorageKey("revise_plan", payload.workspace!.activePlan.id), JSON.stringify(next)); return next; }); setActiveMode("revise_plan"); setReadyForReview(Boolean(payload.readyForReview)); setProcessingStatus(payload.followUpQuestion ? "Plan updated. Finish now or answer the remaining key question." : "Plan updated and ready for review."); await onPlanCreated(payload.workspace); onStatus({ tone: "success", text: payload.followUpQuestion ? "Plan updated. You can finish refining at any time." : "Plan updated and ready for review." }); }
    catch (caught) { const messageText = caught instanceof Error ? caught.message : "Landi is temporarily unavailable."; const assistantMessage = { id: crypto.randomUUID(), role: "assistant" as const, text: messageText }; setMessages((current) => { const next = [...current, assistantMessage]; localStorage.setItem(conversationKey, JSON.stringify(next)); return next; }); setProcessingStatus("The update did not finish. Please try again."); onStatus({ tone: "error", text: "The update did not finish. Please try again." }); onError(messageText); }
    finally { progressTimers.forEach((timer) => window.clearTimeout(timer)); setBusy(false); }
  }

  return <div className="plan-composer">
    <div className="conversation" aria-live="polite">{messages.map((message) => <div className={`chat-bubble ${message.role}`} key={message.id}>{message.role === "assistant" ? <img className="chat-avatar" src={landiLogoUrl} alt="Landi" /> : null}<p>{message.text}</p></div>)}{composerWorking ? <div className="chat-bubble assistant thinking"><img className="chat-avatar" src={landiLogoUrl} alt="Landi" /><p><span className="thinking-label">{planGenerationInProgress ? "Your details are confirmed. Landi is creating your complete plan…" : "Understanding and organizing your details…"}</span></p></div> : null}</div>
    {composerWorking ? <div className={`composer-status working${planGenerationInProgress ? " generating" : ""}`} aria-live="polite"><b>●</b>{processingStatus}</div> : null}
    {generationCanRetry ? <div className="generation-retry" role="status"><span>Your trip details are saved and ready.</span><button type="button" onClick={() => void confirmProposal()}>Generate plan</button></div> : null}
    {readyForReview && activeMode !== "new_plan" ? <div className="review-ready"><div><strong>Your plan is ready</strong><span>Return to the workspace to review the complete plan, or keep telling Landi what to change.</span></div><button type="button" onClick={onComplete}>View complete plan</button></div> : null}
    {activeMode === "new_plan" ? <BookingImportPanel scope={planningSessionId ? { type: "planning", sessionId: planningSessionId } : { type: "planning" }} compact onWorkspace={onPlanCreated} onPlanningSession={(session) => { setPlanningSessionId(session.id); setPlanningSessionStatus(session.status); setProposal(session.proposal); }} onStatus={onStatus} onError={onError} /> : null}
    <div className="chat-input"><textarea value={input} onChange={(event) => setInput(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter" && !event.shiftKey) { event.preventDefault(); void send(); } }} placeholder={activeMode === "new_plan" ? "Chat with Landi" : "Answer the previous question or add another request…"} rows={2} maxLength={1500} disabled={composerWorking} /><div className="composer-actions"><button className="send-button" onClick={() => void send()} disabled={composerWorking || !input.trim()} aria-label="Send">↑</button></div></div>
  </div>;
}
