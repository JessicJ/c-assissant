import { useState } from "react";
import type { Plan, PlanChangeSet, PlanReplacementAudit, Task } from "@c-assistant/core";
import { googleMapsSearchUrl } from "./plan-external-display.js";
import { planRefinementQuestion } from "./plan-display.js";

export function PlanChangeNotice({ change, onUndo }: { change: PlanChangeSet; onUndo: () => Promise<void> }) {
  const [undoing, setUndoing] = useState(false);
  async function undo() { if (undoing) return; setUndoing(true); try { await onUndo(); } finally { setUndoing(false); } }
  return <aside className="plan-change-notice"><div><span>Order changed</span><strong>Affected transfer times need review</strong><small>This low-impact change is linked to Plan v{change.appliedVersion} and saved locally.</small></div><button type="button" onClick={() => void undo()} disabled={undoing}>{undoing ? "Undoing…" : "Undo change"}</button></aside>;
}

export function PlanReplacementNotice({ audit, active, onUndo }: { audit: PlanReplacementAudit; active: boolean; onUndo: () => Promise<void> }) {
  const [undoing, setUndoing] = useState(false);
  const scopeLabels: Record<PlanReplacementAudit["revalidationScopes"][number], string> = {
    route_facts: "Route facts",
    time_estimates: "Timing and buffers",
    official_sources: "Official source applicability",
    reminders: "Reminder times",
    accommodation_options: "Accommodation options"
  };
  async function undo() { if (undoing) return; setUndoing(true); try { await onUndo(); } finally { setUndoing(false); } }
  return <aside className={`plan-replacement-notice ${audit.impact}`}>
    <div><span>{active ? "Latest plan replacement" : audit.impact === "high" ? "High-impact replacement draft" : "Replacement draft"}</span><strong>{active ? "This replacement plan is active" : "Review affected content before confirmation"}</strong><small>Created from Plan v{audit.sourcePlanVersion}; current Plan v{audit.replacementPlanVersion}.</small>{active ? <button type="button" onClick={() => void undo()} disabled={undoing}>{undoing ? "Undoing…" : "Undo replacement"}</button> : null}</div>
    <div className="replacement-audit-groups"><p><b>Needs revalidation</b>{audit.revalidationScopes.map((scope) => <em key={scope}>{scopeLabels[scope]}</em>)}</p><p><b>Preserved completion status</b><span>{audit.preservedCompletedTasks.length ? `${audit.preservedCompletedTasks.length} items` : "None"}</span></p></div>
  </aside>;
}

export function PlanCommandCenter({ plan, tasks, onRevise }: { plan: Plan; tasks: Task[]; onRevise: () => void }) {
  const actionable = tasks.filter((task) => task.owner === "user");
  const completed = actionable.filter((task) => task.status === "completed" || task.status === "skipped").length;
  const progress = actionable.length ? Math.round((completed / actionable.length) * 100) : 0;
  const accommodation = plan.configuration.accommodation;
  const mapQuery = accommodation.address || accommodation.location || plan.location;
  const mapUrl = googleMapsSearchUrl(mapQuery);
  return <section className="plan-command-center"><article><span className="command-label">Goal</span><strong>{plan.knownInformation[0] ?? "Complete this trip around the current destination"}</strong><small>{plan.nextAction}</small></article><article><span className="command-label">Progress</span><strong>{completed} / {actionable.length || 0} completed</strong><div className="progress-track"><span style={{ width: `${progress}%` }} /></div><small>{progress ? `${progress}% of your tasks completed` : "Progress updates as you complete tasks"}</small></article><article><span className="command-label">Location and routes</span><strong>{accommodation.name || accommodation.location || "Accommodation location pending"}</strong><small>{accommodation.address || "Once confirmed, Landi will use the accommodation as the arrival-route anchor."}</small><div className="command-actions"><a href={mapUrl} target="_blank" rel="noreferrer">View in Google Maps ↗</a><button type="button" onClick={onRevise}>Adjust plan</button></div></article></section>;
}

export function PlanDecisionBoard({ assumptions, onRevise }: { assumptions: string[]; onRevise: () => void }) {
  const [acknowledged, setAcknowledged] = useState<Set<number>>(() => new Set());
  const decisions = assumptions.slice(0, 4);
  if (!decisions.length) return null;
  function acknowledge(index: number) { setAcknowledged((current) => new Set(current).add(index)); }
  return <section className="plan-decision-board"><header><div><span className="section-eyebrow">DECISIONS</span><h3>Items that still need your decision</h3><p>These assumptions and tradeoffs are not treated as confirmed facts.</p></div><button type="button" onClick={onRevise}>Adjust in conversation</button></header><div className="decision-grid">{decisions.map((decision, index) => <article className={acknowledged.has(index) ? "acknowledged" : ""} key={`${decision}-${index}`}><span>{String(index + 1).padStart(2, "0")}</span><div><strong>{acknowledged.has(index) ? "Saved for confirmation" : "To confirm"}</strong><p>{decision}</p></div><button type="button" onClick={() => acknowledge(index)}>{acknowledged.has(index) ? "Saved" : "Confirm later"}</button></article>)}</div></section>;
}

export function PlanGrounding({ plan, onContinue }: { plan: Plan; onContinue: () => void }) {
  const known = plan.knownInformation.slice(0, 4);
  const missing = plan.assumptions.slice(0, 3);
  const question = planRefinementQuestion(plan);
  return <section className="plan-grounding"><div><span>Known details</span>{known.length ? <ul>{known.map((item) => <li key={item}>{item}</li>)}</ul> : <p>The plan's foundational details will appear here.</p>}</div><div className={question ? "needs-input" : "ready"}><span>{question ? "Optional detail" : "Ready for full review"}</span>{question ? <><p>{question}</p><small>{missing.length > 1 ? `${missing.length - 1} non-critical unknowns remain in the plan and do not block full review.` : "Your answer will update the draft, or you can review and confirm it now."}</small><button type="button" onClick={onContinue}>Add this detail</button></> : <p>The foundational details are sufficient. Source checks and non-critical assumptions do not block review.</p>}</div></section>;
}
