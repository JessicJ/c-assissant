import type { Plan, Task } from "@c-assistant/core";
import { formatDate } from "./plan-display.js";

export function WorkspaceEmpty({ title, detail }: { title: string; detail: string }) {
  return <section className="workspace-empty"><span>✓</span><strong>{title}</strong><p>{detail}</p></section>;
}

export function PlanRemindersView({ items, active }: { items: Array<{ task: Task; stageTitle: string }>; active: boolean }) {
  if (!items.length) return <WorkspaceEmpty title="No plan reminders" detail="Only reminders with a clear local date, time, and time zone appear here." />;
  return <section className="plan-reminders"><header><div><span className="section-eyebrow">REMINDERS</span><h3>{active ? "Active reminders" : "Enabled after confirmation"}</h3></div><small>{items.length} items</small></header><div className="reminder-list">{items.map(({ task, stageTitle }) => <article key={task.id}><span className={active ? "active" : "proposed"}>{active ? "Enabled" : "Pending"}</span><div><strong>{task.title}</strong><p>{task.reminder!.purpose}</p><small>{task.reminder!.scheduledAtLocal} · {task.reminder!.timeZone} · {stageTitle}</small></div></article>)}</div></section>;
}

export function PlanSourcesView({ sources }: { sources: Plan["sources"] }) {
  return <section className="plan-evidence"><div className="section-title"><p>Document and policy sources</p><span>Official information affecting visas, entry, residence, or document preparation</span></div><div className="evidence-list">{sources.map((source) => <a href={source.url} target="_blank" rel="noreferrer" key={`${source.url}-${source.retrievedAt}`}><div><strong>{source.title}</strong><small>{source.authority} · {source.retrievedAt}</small></div><b>↗</b></a>)}</div></section>;
}

export function HistoricalPlans({ plans, onDelete }: { plans: Plan[]; onDelete: (plan: Plan) => Promise<void> }) {
  if (!plans.length) return <section className="history-empty"><span>◴</span><h2>No archived plans yet</h2><p>After you confirm a complete replacement draft, the previous active plan will appear here.</p></section>;
  return <section className="history-grid">{plans.map((plan) => <details className="history-card" key={plan.id}><summary><div><h2>{plan.title}</h2><p>{plan.location} · {plan.dates}</p></div><div className="history-card-actions"><time>{formatDate(plan.createdAt)}</time><button type="button" onClick={(event) => { event.preventDefault(); event.stopPropagation(); void onDelete(plan); }}>Delete</button></div></summary><HistoryPlanMarkdown plan={plan} /></details>)}</section>;
}

function HistoryPlanMarkdown({ plan }: { plan: Plan }) {
  const summary = plan.presentation?.summary || plan.knownInformation[0] || `A trip to ${plan.location} on ${plan.dates}.`;
  const placeById = new Map((plan.presentation?.places ?? []).map((place) => [place.id, place]));
  return <article className="history-markdown">
    <section><h2>Trip overview</h2><p>{summary}</p></section>
    {plan.knownInformation.length ? <section><h2>Confirmed details</h2><ul>{plan.knownInformation.map((item) => <li key={item}>{item}</li>)}</ul></section> : null}
    {plan.presentation?.days.length ? <section><h2>Daily itinerary</h2>{plan.presentation.days.map((day) => <div className="history-markdown-day" key={day.id}><h3>{day.label}{day.title ? ` · ${day.title}` : ""}</h3>{day.summary ? <p>{day.summary}</p> : null}{day.placeIds.length ? <ul>{day.placeIds.map((placeId) => { const place = placeById.get(placeId); return <li key={placeId}><strong>{place?.name ?? placeId}</strong>{place?.plan ? ` — ${place.plan}` : ""}</li>; })}</ul> : null}</div>)}</section> : null}
    <section><h2>Complete plan</h2>{plan.stages.map((stage) => <div className="history-markdown-stage" key={stage.id}><h3>{stage.title}</h3>{stage.description ? <p>{stage.description}</p> : null}{stage.tasks.length ? <ul>{stage.tasks.map((task) => <li key={task.id}><strong>{task.title}</strong>{task.description ? ` — ${task.description}` : ""}<small>{task.dueLabel}</small></li>)}</ul> : null}</div>)}</section>
    {plan.assumptions.length ? <section><h2>Items to confirm</h2><ul>{plan.assumptions.map((item) => <li key={item}>{item}</li>)}</ul></section> : null}
    {plan.sources.length ? <section><h2>Sources</h2><ul>{plan.sources.map((source) => <li key={`${source.url}-${source.title}`}><a href={source.url} target="_blank" rel="noreferrer">{source.title}</a><small>{source.authority}</small></li>)}</ul></section> : null}
  </article>;
}
