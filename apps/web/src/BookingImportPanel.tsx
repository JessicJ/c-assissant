import { createPortal } from "react-dom";
import "./booking-import-context.css";
import { useEffect, useRef, useState } from "react";
import type { BookingConstraintStrength, BookingImportPreview, PlanningSession, TravelBooking, WorkspaceSnapshot } from "@c-assistant/core";
import { confirmBookingImport, listBookings, previewBookingImport, getBookingImportBaseline, readBookingImportReceipt, safePlanError, isDefiniteMutationRejection, type BookingImportBaseline, type BookingImportConfirmBody } from "./api-client.js";
import { clearBookingImportRecovery, frozenBookingImport, persistBookingImportRecovery, readBookingImportRecovery, type BookingImportRecovery } from "./booking-import-recovery.js";
import { bookingStatusLabel } from "./plan-external-display.js";
import type { AgentStatus } from "./ui-types.js";

type BookingImportScope = { type: "planning"; sessionId?: string } | { type: "plan"; planId: string };
type BookingImportSource = { sourceLabel: string; content: string };
type PendingBookingPreview = { id: string; preview: BookingImportPreview; booking: TravelBooking; sourceLabel: string; sourceContent: string; baseline: BookingImportBaseline };

export function BookingImportPanel({ scope, expectedVersion, compact = false, contextual = false, contextTarget = null, prompted = false, onWorkspace, onPlanningSession, onStatus, onError }: { scope: BookingImportScope; expectedVersion?: number; compact?: boolean; contextual?: boolean; contextTarget?: HTMLElement | null; prompted?: boolean; onWorkspace: (workspace: WorkspaceSnapshot) => Promise<void>; onPlanningSession?: (session: PlanningSession) => void; onStatus: (status: AgentStatus) => void; onError: (message: string) => void }) {
  const [open, setOpen] = useState(false);
  const [sourceLabel, setSourceLabel] = useState("");
  const [content, setContent] = useState("");
  const [queuedSources, setQueuedSources] = useState<BookingImportSource[]>([]);
  const [previewItems, setPreviewItems] = useState<PendingBookingPreview[]>([]);
  const [existing, setExisting] = useState<TravelBooking[]>([]);
  const [busy, setBusy] = useState(false);
  const busyRef = useRef(false);
  const [pending, setPending] = useState<BookingImportRecovery | null>(null);
  const [recoveryUnreadable, setRecoveryUnreadable] = useState(false);
  const originalPayload = useRef<{ recovery: BookingImportRecovery; body: BookingImportConfirmBody } | null>(null);
  const scopeKey = scope.type === "planning" ? `planning:${scope.sessionId ?? "new"}` : `plan:${scope.planId}`;
  const currentScope = useRef(scopeKey); currentScope.current = scopeKey;

  useEffect(() => {
    try { setPending(readBookingImportRecovery(sessionStorage)); }
    catch { setRecoveryUnreadable(true); onError("The previous booking import could not be checked. Keep your draft and check its result before starting another import."); }
    setPreviewItems([]);
  }, [scopeKey]);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        const payload = await listBookings(scope);
        if (cancelled || !payload) return;
        setExisting(payload.bookings ?? []);
      } catch { /* Existing bookings are supplementary. */ }
    }
    void load();
    return () => { cancelled = true; };
  }, [scopeKey]);

  async function readFiles(files: FileList | null) {
    const selected = Array.from(files ?? []);
    if (!selected.length) return;
    const sources = await Promise.all(selected.slice(0, 5).map(async (file) => ({ sourceLabel: file.name, content: await file.text() })));
    setQueuedSources(sources);
    setSourceLabel(sources.length === 1 ? sources[0]!.sourceLabel : `${sources.length} booking files selected`);
    setContent(sources.length === 1 ? sources[0]!.content : "");
    setPreviewItems([]);
  }

  async function previewImport() {
    const sources = queuedSources.length ? queuedSources : content.trim() ? [{ sourceLabel: sourceLabel || "Pasted booking confirmation", content: content.trim() }] : [];
    if (!sources.length || busyRef.current || pending || recoveryUnreadable) return;
    const capturedScope = scopeKey;
    busyRef.current = true;
    setBusy(true);
    onError("");
    try {
      const baseline = await getBookingImportBaseline(scope, expectedVersion);
      const items: PendingBookingPreview[] = [];
      for (const source of sources) {
        const payload = await previewBookingImport(baseline.scope, { sourceLabel: source.sourceLabel, content: source.content });
        for (const booking of payload.bookings) items.push({ id: crypto.randomUUID(), preview: payload, booking, sourceLabel: source.sourceLabel, sourceContent: source.content, baseline });
      }
      if (currentScope.current === capturedScope) { setPreviewItems(items); setExisting(baseline.bookings); }
    } catch (caught) {
      const message = safePlanError(caught);
      onError(message); onStatus({ tone: "error", text: message });
    } finally { busyRef.current = false; setBusy(false); }
  }

  async function settleImport(record: BookingImportRecovery): Promise<boolean> {
    const receipt = await readBookingImportReceipt(record);
    if (receipt.status !== "committed") { onError("The original booking receipt is not available yet. Your request and draft are kept. Check again, or explicitly retry the unchanged request while it is still in memory."); return false; }
    clearBookingImportRecovery(sessionStorage, record); setPending(null); originalPayload.current = null;
    const recordScope = record.scope.type === "plan" ? `plan:${record.scope.planId}` : `planning:${record.scope.sessionId ?? "new"}`;
    if (currentScope.current === recordScope) {
      setPreviewItems([]);
      onError("");
      await onWorkspace(receipt.workspace);
      onStatus({ tone: "success", text: "The original receipt confirms your booking was saved. Preview the remaining bookings again and confirm each one against the current version." });
      const listed = await listBookings(record.scope); setExisting(listed.bookings ?? []);
    }
    return true;
  }
  async function recoverImport(retry: boolean) {
    if (!pending || busyRef.current) return;
    busyRef.current = true; setBusy(true);
    try {
      if (await settleImport(pending) || !retry) return;
      const original = originalPayload.current;
      if (!original || original.recovery.requestId !== pending.requestId) { onError("The original private booking details are no longer in memory. Check the original receipt before providing the details again."); return; }
      await confirmBookingImport(original.recovery.scope, original.body);
      await settleImport(pending);
    } catch (caught) {
      const message = safePlanError(caught);
      onError(message); onStatus({ tone: "error", text: message });
    } finally { busyRef.current = false; setBusy(false); }
  }
  async function acceptImport(itemId: string) {
    const item = previewItems.find((candidate) => candidate.id === itemId);
    if (!item || busyRef.current || pending || recoveryUnreadable) return;
    busyRef.current = true; setBusy(true); onError("");
    try {
      const frozen = frozenBookingImport(item.baseline, item.booking, item.sourceContent);
      persistBookingImportRecovery(sessionStorage, frozen.recovery);
      originalPayload.current = frozen; setPending(frozen.recovery);
      const payload = await confirmBookingImport(frozen.recovery.scope, frozen.body);
      if (payload.planningSession && currentScope.current === scopeKey) onPlanningSession?.(payload.planningSession);
      await settleImport(frozen.recovery);
    } catch (caught) {
      const original = originalPayload.current;
      if (isDefiniteMutationRejection(caught) && original) {
        clearBookingImportRecovery(sessionStorage, original.recovery); setPending(null); originalPayload.current = null;
        onError(safePlanError(caught));
      } else onError("The booking save result is unverified. Your draft and request identity are kept. Check the original receipt before retrying.");
    } finally { busyRef.current = false; setBusy(false); }
  }

  function discardImport(itemId: string) {
    setPreviewItems((items) => items.filter((item) => item.id !== itemId));
  }

  function updateBooking(itemId: string, patch: Partial<TravelBooking>) {
    setPreviewItems((items) => items.map((item) => item.id === itemId ? { ...item, booking: { ...item.booking, ...patch } } : item));
  }

  function updateSegment(itemId: string, segmentId: string, patch: Partial<TravelBooking["segments"][number]>) {
    setPreviewItems((items) => items.map((item) => item.id === itemId ? { ...item, booking: { ...item.booking, segments: item.booking.segments.map((segment) => segment.id === segmentId ? { ...segment, ...patch, fixedCommitment: patch.constraintStrength ? patch.constraintStrength === "hard" : segment.fixedCommitment } : segment) } } : item));
  }

  const fileSelectionLabel = queuedSources.length === 1 ? queuedSources[0]!.sourceLabel : queuedSources.length ? `${queuedSources.length} files selected` : "No file selected";

  // Keep the component mounted so an open import and its draft survive a new question.
  if (contextual && !open && !pending && !recoveryUnreadable) return prompted && contextTarget ? createPortal(<button type="button" className="booking-import-prompt" onClick={() => setOpen(true)}>Upload booking</button>, contextTarget) : null;

  const panel = <section className={compact ? "booking-import-panel compact" : "booking-import-panel"}>
    <header><div><span className="section-eyebrow">{scope.type === "planning" ? "TRIP INPUTS" : "TRIP LOGISTICS"}</span><strong>{scope.type === "planning" ? "Import booking confirmations" : "Add booking details"}</strong></div><button type="button" onClick={() => setOpen((value) => !value)}>{open ? "Close" : "Import"}</button></header>
    {pending ? <section aria-label="Check previous booking import"><p>Check the previous booking save before starting another import. After a refresh, only its request identity is retained. Private booking details are kept in memory only.</p><button type="button" disabled={busy} onClick={() => void recoverImport(false)}>Check original booking receipt</button>{originalPayload.current ? <button type="button" disabled={busy} onClick={() => void recoverImport(true)}>Retry unchanged original request</button> : <p>The original private booking details are no longer in memory. Check the original receipt first.</p>}</section> : null}
    {recoveryUnreadable ? <p role="alert">The booking recovery record could not be verified. Keep your original details and check the saved record before starting another import.</p> : null}
    {existing.length ? <div className="booking-import-existing">{existing.slice(0, 4).map((item) => <article key={item.id}><span>{bookingStatusLabel(item.status)}</span><strong>{item.title}</strong><small>{item.segments.map((segment) => segment.startAtLocal || segment.location || segment.origin || segment.destination).filter(Boolean).slice(0, 2).join(" · ") || item.sourceLabel}</small></article>)}</div> : compact ? null : <p className="booking-import-empty">Imported flights, hotels, rental cars, and train bookings will appear here after review.</p>}
    {open ? <div className="booking-import-body">
      <div className="booking-import-inputs"><label>Source label<input value={sourceLabel} onChange={(event) => setSourceLabel(event.target.value)} placeholder="For example: United confirmation email" /></label><label className="file-input"><span>Upload .eml, .html, or .txt</span><span className="file-picker-control"><strong>Select files</strong><small>{fileSelectionLabel}</small></span><input className="native-file-input" type="file" multiple accept=".eml,.html,.txt,text/html,text/plain,message/rfc822" onChange={(event) => void readFiles(event.target.files)} /></label><label className="wide">Paste confirmation text<textarea value={content} onChange={(event) => { setContent(event.target.value); setQueuedSources([]); setPreviewItems([]); }} rows={compact ? 4 : 6} placeholder="Paste an English booking confirmation email or upload up to 5 files." /></label><button type="button" onClick={() => void previewImport()} disabled={busy || (!content.trim() && !queuedSources.length)}>{busy ? "Reading…" : previewItems.length ? "Preview again" : "Preview import"}</button></div>
      {previewItems.length ? <div className="booking-preview">
        {previewItems.length > 1 ? <div className="booking-preview-header"><strong>{previewItems.length} bookings to review</strong><p>Confirm each booking separately. After each save, preview the remaining bookings again against the current version.</p></div> : null}
        {previewItems.map((item) => <article className="booking-preview-item" key={item.id}>
          <header><div><strong>{item.sourceLabel}</strong><small>{item.preview.duplicate ? "Exact duplicate" : item.preview.possibleDuplicate ? "Possible duplicate" : "Ready to import"}</small></div><button type="button" onClick={() => discardImport(item.id)}>Discard</button></header>
          {item.preview.duplicate ? <p className="booking-warning">This exact source was already imported.</p> : null}
          {!item.preview.duplicate && item.preview.possibleDuplicate ? <p className="booking-warning">This looks similar to an existing booking. Review before accepting.</p> : null}
          <label>保存方式<select disabled={busy || Boolean(pending)} value={item.baseline.records.some((record) => record.bookingId === item.booking.id) ? item.booking.id : ""} onChange={(event) => { const selected = item.baseline.bookings.find((booking) => booking.id === event.target.value); const original = item.preview.bookings.find((booking) => !item.baseline.records.some((record) => record.bookingId === booking.id)); if (selected) updateBooking(item.id, structuredClone(selected)); else if (original) setPreviewItems((items) => items.map((value) => value.id === item.id ? { ...value, booking: structuredClone(original) } : value)); }}><option value="">保存为新预订</option>{item.baseline.bookings.filter((booking) => item.baseline.records.some((record) => record.bookingId === booking.id)).map((booking) => <option key={booking.id} value={booking.id}>更正：{booking.title}</option>)}</select></label>
          {item.baseline.records.some((record) => record.bookingId === item.booking.id) ? <p>The saved record is selected. Review its fields below. Corrections keep the original booking and segment identities and are checked against the version shown in this preview.</p> : null}
          <div className="booking-preview-card"><label>Booking title<input value={item.booking.title} onChange={(event) => updateBooking(item.id, { title: event.target.value })} /></label><label>Type<select value={item.booking.type} onChange={(event) => updateBooking(item.id, { type: event.target.value as TravelBooking["type"] })}><option value="accommodation">Accommodation</option><option value="flight">Flight</option><option value="train">Train</option><option value="rental_car">Rental car</option><option value="ticket">Ticket</option><option value="restaurant">Restaurant</option><option value="other">Other</option></select></label><label>Status<select value={item.booking.status} onChange={(event) => updateBooking(item.id, { status: event.target.value as TravelBooking["status"] })}><option value="confirmed">Confirmed</option><option value="pending">Pending</option><option value="needs_review">Needs review</option><option value="cancelled">Cancelled</option></select></label></div>
          <div className="booking-segment-list">{item.booking.segments.map((segment) => <article key={segment.id}><header><strong>{segment.title}</strong><select value={segment.constraintStrength} onChange={(event) => updateSegment(item.id, segment.id, { constraintStrength: event.target.value as BookingConstraintStrength })}><option value="hard">Hard</option><option value="soft">Soft</option><option value="ignored">Ignored</option></select></header><div><label>Start<input value={segment.startAtLocal ?? ""} onChange={(event) => updateSegment(item.id, segment.id, { startAtLocal: event.target.value })} placeholder="Local date/time" /></label><label>End<input value={segment.endAtLocal ?? ""} onChange={(event) => updateSegment(item.id, segment.id, { endAtLocal: event.target.value })} placeholder="Local date/time" /></label><label>Origin<input value={segment.origin ?? ""} onChange={(event) => updateSegment(item.id, segment.id, { origin: event.target.value })} /></label><label>Destination<input value={segment.destination ?? ""} onChange={(event) => updateSegment(item.id, segment.id, { destination: event.target.value })} /></label><label className="wide">Location<input value={segment.location ?? ""} onChange={(event) => updateSegment(item.id, segment.id, { location: event.target.value })} /></label></div>{segment.needsReviewReasons.length ? <p>{segment.needsReviewReasons.join(" ")}</p> : null}</article>)}</div>
          <div className="booking-preview-actions"><button type="button" disabled={busy} onClick={() => discardImport(item.id)}>Discard preview</button><button type="button" onClick={() => void acceptImport(item.id)} disabled={busy || Boolean(pending) || recoveryUnreadable}>{busy ? "Saving…" : "确认本项预订"}</button></div>
        </article>)}
      </div> : null}
    </div> : null}
  </section>;
  return contextual ? contextTarget ? createPortal(panel, contextTarget) : null : panel;
}
