import { useEffect, useState } from "react";
import type { BookingConstraintStrength, BookingImportPreview, PlanningSession, TravelBooking, WorkspaceSnapshot } from "@c-assistant/core";
import { confirmBookingImport, listBookings, previewBookingImport } from "./api-client.js";
import { bookingStatusLabel } from "./plan-external-display.js";
import type { AgentStatus } from "./ui-types.js";

type BookingImportScope = { type: "planning"; sessionId?: string } | { type: "plan"; planId: string };
type BookingImportSource = { sourceLabel: string; content: string };
type PendingBookingPreview = { id: string; preview: BookingImportPreview; booking: TravelBooking; sourceLabel: string; sourceContent: string };

export function BookingImportPanel({ scope, expectedVersion, compact = false, onWorkspace, onPlanningSession, onStatus, onError }: { scope: BookingImportScope; expectedVersion?: number; compact?: boolean; onWorkspace: (workspace: WorkspaceSnapshot) => Promise<void>; onPlanningSession?: (session: PlanningSession) => void; onStatus: (status: AgentStatus) => void; onError: (message: string) => void }) {
  const [open, setOpen] = useState(false);
  const [sourceLabel, setSourceLabel] = useState("");
  const [content, setContent] = useState("");
  const [queuedSources, setQueuedSources] = useState<BookingImportSource[]>([]);
  const [previewItems, setPreviewItems] = useState<PendingBookingPreview[]>([]);
  const [existing, setExisting] = useState<TravelBooking[]>([]);
  const [busy, setBusy] = useState(false);
  const scopeKey = scope.type === "planning" ? `planning:${scope.sessionId ?? "new"}` : `plan:${scope.planId}`;

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
    if (!sources.length || busy) return;
    setBusy(true);
    onError("");
    try {
      const items: PendingBookingPreview[] = [];
      for (const source of sources) {
        const payload = await previewBookingImport(scope, { sourceLabel: source.sourceLabel, content: source.content });
        for (const booking of payload.bookings) items.push({ id: crypto.randomUUID(), preview: payload, booking, sourceLabel: source.sourceLabel, sourceContent: source.content });
      }
      setPreviewItems(items);
    } catch (caught) {
      const message = caught instanceof Error ? caught.message : "Unable to preview this booking.";
      onError(message); onStatus({ tone: "error", text: message });
    } finally { setBusy(false); }
  }

  async function acceptImport(itemId: string) {
    const item = previewItems.find((candidate) => candidate.id === itemId);
    if (!item || busy) return;
    setBusy(true);
    onError("");
    try {
      const payload = await confirmBookingImport(scope, { booking: item.booking, sourceContent: item.sourceContent, ...(expectedVersion !== undefined ? { expectedVersion } : {}) });
      if (payload.planningSession) onPlanningSession?.(payload.planningSession);
      await onWorkspace(payload.workspace);
      if (payload.booking) setExisting((items) => [payload.booking!, ...items.filter((item) => item.id !== payload.booking!.id)]);
      setPreviewItems((items) => {
        const remaining = items.filter((candidate) => candidate.id !== itemId);
        if (!remaining.length) { setContent(""); setSourceLabel(""); setQueuedSources([]); setOpen(false); }
        return remaining;
      });
      onStatus({ tone: payload.requiresBlueprintRevision ? "working" : "success", text: payload.requiresBlueprintRevision ? "Booking saved. Structural timing may need a replacement draft before it changes the active itinerary." : "Booking saved for this trip." });
    } catch (caught) {
      const message = caught instanceof Error ? caught.message : "Unable to save this booking.";
      onError(message); onStatus({ tone: "error", text: message });
    } finally { setBusy(false); }
  }

  async function acceptAllImports() {
    for (const item of [...previewItems]) await acceptImport(item.id);
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

  return <section className={compact ? "booking-import-panel compact" : "booking-import-panel"}>
    <header><div><span className="section-eyebrow">{scope.type === "planning" ? "TRIP INPUTS" : "TRIP LOGISTICS"}</span><strong>{scope.type === "planning" ? "Import booking confirmations" : "Add booking details"}</strong></div><button type="button" onClick={() => setOpen((value) => !value)}>{open ? "Close" : "Import"}</button></header>
    {existing.length ? <div className="booking-import-existing">{existing.slice(0, 4).map((item) => <article key={item.id}><span>{bookingStatusLabel(item.status)}</span><strong>{item.title}</strong><small>{item.segments.map((segment) => segment.startAtLocal || segment.location || segment.origin || segment.destination).filter(Boolean).slice(0, 2).join(" · ") || item.sourceLabel}</small></article>)}</div> : compact ? null : <p className="booking-import-empty">Imported flights, hotels, rental cars, and train bookings will appear here after review.</p>}
    {open ? <div className="booking-import-body">
      <div className="booking-import-inputs"><label>Source label<input value={sourceLabel} onChange={(event) => setSourceLabel(event.target.value)} placeholder="For example: United confirmation email" /></label><label className="file-input"><span>Upload .eml, .html, or .txt</span><span className="file-picker-control"><strong>Select files</strong><small>{fileSelectionLabel}</small></span><input className="native-file-input" type="file" multiple accept=".eml,.html,.txt,text/html,text/plain,message/rfc822" onChange={(event) => void readFiles(event.target.files)} /></label><label className="wide">Paste confirmation text<textarea value={content} onChange={(event) => { setContent(event.target.value); setQueuedSources([]); setPreviewItems([]); }} rows={compact ? 4 : 6} placeholder="Paste an English booking confirmation email or upload up to 5 files." /></label><button type="button" onClick={() => void previewImport()} disabled={busy || (!content.trim() && !queuedSources.length)}>{busy ? "Reading…" : previewItems.length ? "Preview again" : "Preview import"}</button></div>
      {previewItems.length ? <div className="booking-preview">
        {previewItems.length > 1 ? <div className="booking-preview-header"><strong>{previewItems.length} bookings ready for review</strong><button type="button" onClick={() => void acceptAllImports()} disabled={busy}>{busy ? "Saving…" : "Accept all"}</button></div> : null}
        {previewItems.map((item) => <article className="booking-preview-item" key={item.id}>
          <header><div><strong>{item.sourceLabel}</strong><small>{item.preview.duplicate ? "Exact duplicate" : item.preview.possibleDuplicate ? "Possible duplicate" : "Ready to import"}</small></div><button type="button" onClick={() => discardImport(item.id)}>Discard</button></header>
          {item.preview.duplicate ? <p className="booking-warning">This exact source was already imported.</p> : null}
          {!item.preview.duplicate && item.preview.possibleDuplicate ? <p className="booking-warning">This looks similar to an existing booking. Review before accepting.</p> : null}
          <div className="booking-preview-card"><label>Booking title<input value={item.booking.title} onChange={(event) => updateBooking(item.id, { title: event.target.value })} /></label><label>Type<select value={item.booking.type} onChange={(event) => updateBooking(item.id, { type: event.target.value as TravelBooking["type"] })}><option value="accommodation">Accommodation</option><option value="flight">Flight</option><option value="train">Train</option><option value="rental_car">Rental car</option><option value="ticket">Ticket</option><option value="restaurant">Restaurant</option><option value="other">Other</option></select></label><label>Status<select value={item.booking.status} onChange={(event) => updateBooking(item.id, { status: event.target.value as TravelBooking["status"] })}><option value="confirmed">Confirmed</option><option value="pending">Pending</option><option value="needs_review">Needs review</option><option value="cancelled">Cancelled</option></select></label></div>
          <div className="booking-segment-list">{item.booking.segments.map((segment) => <article key={segment.id}><header><strong>{segment.title}</strong><select value={segment.constraintStrength} onChange={(event) => updateSegment(item.id, segment.id, { constraintStrength: event.target.value as BookingConstraintStrength })}><option value="hard">Hard</option><option value="soft">Soft</option><option value="ignored">Ignored</option></select></header><div><label>Start<input value={segment.startAtLocal ?? ""} onChange={(event) => updateSegment(item.id, segment.id, { startAtLocal: event.target.value })} placeholder="Local date/time" /></label><label>End<input value={segment.endAtLocal ?? ""} onChange={(event) => updateSegment(item.id, segment.id, { endAtLocal: event.target.value })} placeholder="Local date/time" /></label><label>Origin<input value={segment.origin ?? ""} onChange={(event) => updateSegment(item.id, segment.id, { origin: event.target.value })} /></label><label>Destination<input value={segment.destination ?? ""} onChange={(event) => updateSegment(item.id, segment.id, { destination: event.target.value })} /></label><label className="wide">Location<input value={segment.location ?? ""} onChange={(event) => updateSegment(item.id, segment.id, { location: event.target.value })} /></label></div>{segment.needsReviewReasons.length ? <p>{segment.needsReviewReasons.join(" ")}</p> : null}</article>)}</div>
          <div className="booking-preview-actions"><button type="button" onClick={() => discardImport(item.id)}>Discard preview</button><button type="button" onClick={() => void acceptImport(item.id)} disabled={busy}>{busy ? "Saving…" : "Accept booking"}</button></div>
        </article>)}
      </div> : null}
    </div> : null}
  </section>;
}
