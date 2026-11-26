import { useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { PlanComposer } from '../../apps/web/src/PlanComposer.js';
import { createIsolatedPlanningContinuation } from '../../apps/web/src/planning-continuation.js';
import type { WorkspaceSnapshot } from '@c-assistant/core';
import '../../apps/web/src/styles.css';
const continuation = createIsolatedPlanningContinuation(async scope => {
  const response = await fetch(`/__continuation/check?sessionId=${encodeURIComponent(scope.sessionId)}`, { cache: 'no-store' });
  if (!response.ok) throw Error('Development readiness unavailable');
  return response.json();
});
function Harness() {
  const [workspace, setWorkspace] = useState<WorkspaceSnapshot | null>(null);
  const [error, setError] = useState('');
  const [selected, setSelected] = useState<string | undefined>();
  const [status, setStatus] = useState('collecting');
  async function control(body: object) { const response = await fetch('/__continuation/control', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }); if (!response.ok) throw Error('Test control rejected'); return response.json(); }
  async function selectSlot(slot: 'A' | 'B') {
    let parent = await (await fetch('/__continuation/parent', { cache: 'no-store' })).json();
    if (!parent.slots[slot]) { await control({ action: 'session', slot, status: 'collecting' }); parent = await (await fetch('/__continuation/parent', { cache: 'no-store' })).json(); }
    const session = await (await fetch(`/api/planning-sessions/${parent.slots[slot]}`, { cache: 'no-store' })).json();
    setSelected(parent.slots[slot]); setWorkspace({ ...parent.workspace, planningSession: session.session ?? session });
  }
  async function reloadSelected() {
    if (!selected) return;
    const response = await (await fetch(`/api/planning-sessions/${selected}`, { cache: 'no-store' })).json();
    setWorkspace(current => current ? { ...current, planningSession: response.session ?? response } : current);
  }
  useEffect(() => { void fetch('/api/workspace', { cache: 'no-store' }).then(r => r.json()).then(next => { setWorkspace(next); setSelected(next.planningSession?.id); }); }, []);
  return <main><h1>Isolated development continuation</h1><p>Fictional admission and fake MAH transport. Not production readiness.</p><section aria-label="Test parent controls"><h2>Test parent controls</h2><p>These controls exercise the real component's parent boundary; they do not prove production navigation.</p><button onClick={() => void selectSlot('A')}>Show session A</button><button onClick={() => void selectSlot('B')}>Show session B</button><button onClick={() => { setSelected(undefined); setWorkspace(current => current ? { ...current, planningSession: undefined } : current); }}>New draft</button><button disabled={!selected} onClick={() => void reloadSelected()}>Reload selected session</button><select aria-label="Fixture session status" value={status} onChange={event => setStatus(event.target.value)}>{['collecting','proposal_ready','proposal_confirmed','generating','draft_ready','abandoned'].map(value => <option key={value}>{value}</option>)}</select><button disabled={!selected} onClick={() => void fetch('/__continuation/parent').then(r => r.json()).then(async parent => { const slot = parent.slots.A === selected ? 'A' : 'B'; await control({ action: 'session', slot, status }); await reloadSelected(); })}>Set fixture session status</button><button disabled={!selected} onClick={() => void control({ action: 'booking-question', sessionId: selected }).then(reloadSelected)}>Seed booking question</button><span data-testid="selected-session">{selected ?? 'new'}</span></section><p role="alert">{error}</p>{workspace ?
    <PlanComposer mode="new_plan" currentPlan={null} profile={workspace.profile} planningSession={workspace.planningSession ?? undefined}
      continuation={continuation} onPlanCreated={async next => { setWorkspace(next); setSelected(next.planningSession?.id); }} onStatus={() => {}} onComplete={() => {}} onError={setError} /> : <p>Loading fictional session…</p>}</main>;
}
createRoot(document.getElementById('root')!).render(<Harness />);
