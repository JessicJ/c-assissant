import { useState } from "react";
import type { Plan, Task } from "@c-assistant/core";
import { appDownloads } from "./plan-external-display.js";
import { groupPreparationItems, isExplicitPreparationTask } from "./plan-preparation-display.js";

export function FeaturedChecklist({ plan, index, items, onTaskToggle }: { plan: Plan; index: number; items: Array<{ task: Task; stageTitle: string }>; onTaskToggle: (planId: string, taskId: string, checked: boolean) => Promise<void> }) {
  const groups = groupPreparationItems(items);
  return <section className="plan-content-section featured checklist"><header><div><span>{String(index + 1).padStart(2, "0")}</span><h3>Pre-departure preparation</h3></div><small>{items.length} items</small></header><p>Packing lists contain only physical items. Documents, bookings, and digital setup are shown separately. Completion status affects later reminders.</p><div className="preparation-groups">{groups.map((group) => <section className="preparation-group" key={group.title}><header><strong>{group.title}</strong><small>{group.items.length} items</small></header><div className={`preparation-checklist ${group.title === "Packing" ? "packing-items" : ""}`}>{group.items.map(({ task }) => { const downloads = appDownloads(task, plan.sources); const checked = task.status === "completed"; return <div className={checked ? "checked" : ""} key={task.id}><input type="checkbox" checked={checked} onChange={(event) => void onTaskToggle(plan.id, task.id, event.target.checked)} aria-label={`Complete ${task.title}`} /><div><strong>{task.title}</strong>{group.title !== "Packing" && task.description ? <small>{task.description}</small> : null}{group.title !== "Packing" ? <small>{task.dueLabel}</small> : null}</div>{downloads.length ? <div className="download-actions">{downloads.map((download) => <a className="download-action" href={download.url} target="_blank" rel="noreferrer" key={download.label}>{download.label} ↗</a>)}</div> : null}</div>; })}</div></section>)}</div></section>;
}

export function FeaturedTimeline({ plan, index, items, onTaskReorder }: { plan: Plan; index: number; items: Array<{ task: Task; canMoveUp: boolean; canMoveDown: boolean }>; onTaskReorder: (planId: string, taskId: string, direction: "up" | "down") => Promise<void> }) {
  const movement = new Map(items.map((item) => [item.task.id, item]));
  return <section className="plan-content-section featured itinerary"><header><div><span>{String(index + 1).padStart(2, "0")}</span><h3>Complete itinerary timeline</h3></div><small>{items.length} milestones</small></header><p>Arrival, transport, check-in, fixed events, and return travel appear on one continuous timeline. Draft plans can reorder items within the same stage.</p><ItineraryView tasks={items.map((item) => item.task)} editable={plan.status === "draft"} canMove={(taskId, direction) => direction === "up" ? movement.get(taskId)?.canMoveUp === true : movement.get(taskId)?.canMoveDown === true} onReorder={(taskId, direction) => onTaskReorder(plan.id, taskId, direction)} /></section>;
}

export function PlanContentSection({ plan, stage, index, onTaskToggle, onTaskReorder }: { plan: Plan; stage: Plan["stages"][number]; index: number; onTaskToggle: (planId: string, taskId: string, checked: boolean) => Promise<void>; onTaskReorder: (planId: string, taskId: string, direction: "up" | "down") => Promise<void> }) {
  const kind = stage.presentationKind ?? "details";
  const countLabel = kind === "itinerary" ? `${stage.tasks.length} milestones` : kind === "reservations" ? `${stage.tasks.length} reservations` : kind === "budget" ? `${stage.tasks.length} cost categories` : kind === "transport" ? `${stage.tasks.length} route options` : `${stage.tasks.length} items`;
  return <section className={`plan-content-section ${kind}`}><header><div><span>{String(index + 1).padStart(2, "0")}</span><h3>{stage.title}</h3></div><small>{countLabel}</small></header><p>{stage.description}</p>{kind === "itinerary" ? <ItineraryView tasks={stage.tasks} editable={plan.status === "draft"} onReorder={(taskId, direction) => onTaskReorder(plan.id, taskId, direction)} /> : kind === "reservations" ? <ReservationView tasks={stage.tasks} onToggle={(task, checked) => onTaskToggle(plan.id, task.id, checked)} /> : kind === "budget" ? <BudgetView tasks={stage.tasks} /> : kind === "transport" ? <TransportView tasks={stage.tasks} /> : kind === "overview" ? <OverviewView tasks={stage.tasks} /> : <PlanDetailView tasks={stage.tasks} />}</section>;
}

function OverviewView({ tasks }: { tasks: Task[] }) {
  return <div className="overview-grid">{tasks.map((task) => <article key={task.id}><span>{task.dueLabel}</span><strong>{task.title}</strong>{task.description ? <p>{task.description}</p> : null}</article>)}</div>;
}

function ItineraryView({ tasks, editable = false, canMove, onReorder }: { tasks: Task[]; editable?: boolean; canMove?: (taskId: string, direction: "up" | "down") => boolean; onReorder?: (taskId: string, direction: "up" | "down") => Promise<void> }) {
  const [movingTaskId, setMovingTaskId] = useState<string | null>(null);
  async function move(taskId: string, direction: "up" | "down") { if (!onReorder || movingTaskId) return; setMovingTaskId(taskId); try { await onReorder(taskId, direction); } finally { setMovingTaskId(null); } }
  return <div className="journey-timeline">{tasks.map((task, index) => <article key={task.id}><div className="journey-marker"><span>{index + 1}</span></div><div><time>{task.dueLabel}</time><strong>{task.title}</strong>{task.description ? <p>{task.description}</p> : null}{task.reminder ? <em>Reminder set</em> : null}{editable ? <div className="journey-order-actions"><button type="button" onClick={() => void move(task.id, "up")} disabled={movingTaskId !== null || !(canMove ? canMove(task.id, "up") : index > 0)} aria-label={`Move ${task.title} up`}>↑ Up</button><button type="button" onClick={() => void move(task.id, "down")} disabled={movingTaskId !== null || !(canMove ? canMove(task.id, "down") : index < tasks.length - 1)} aria-label={`Move ${task.title} down`}>↓ Down</button></div> : null}</div></article>)}</div>;
}

function ReservationView({ tasks, onToggle }: { tasks: Task[]; onToggle: (task: Task, checked: boolean) => Promise<void> }) {
  return <div className="reservation-table">{tasks.map((task) => { const checkable = isExplicitPreparationTask(task); return <div key={task.id}>{checkable ? <input type="checkbox" checked={task.status === "completed"} onChange={(event) => void onToggle(task, event.target.checked)} aria-label={`Complete ${task.title}`} /> : <span className={`task-state ${task.status}`} />}<div><strong>{task.title}</strong><small>{task.description ?? "Record the confirmation number, local time, address, and change or cancellation policy"}</small></div><span>{task.dueLabel}</span></div>; })}</div>;
}

function BudgetView({ tasks }: { tasks: Task[] }) {
  return <div className="budget-grid">{tasks.map((task) => <article key={task.id}><span>Budget item</span><strong>{task.title}</strong><small>{task.dueLabel}</small></article>)}</div>;
}

function TransportView({ tasks }: { tasks: Task[] }) {
  return <div className="transport-grid">{tasks.map((task) => <article key={task.id}><span>⇢</span><div><strong>{task.title}</strong><small>{task.description ?? task.dueLabel}</small>{task.description ? <em>{task.dueLabel}</em> : null}</div></article>)}</div>;
}

function PlanDetailView({ tasks }: { tasks: Task[] }) {
  return <div className="plan-detail-grid">{tasks.map((task) => <article key={task.id}><span>{task.dueLabel}</span><strong>{task.title}</strong>{task.description ? <p>{task.description}</p> : null}{task.reminder ? <small>Remind me</small> : null}</article>)}</div>;
}
