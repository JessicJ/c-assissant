import { useEffect, useMemo, useRef, useState } from "react";
import type { CSSProperties } from "react";
import L from "leaflet";
import leafletCss from "leaflet/dist/leaflet.css?inline";
import type { DestinationArrivalEvent, PlanPresentation, WorkspaceSnapshot } from "@c-assistant/core";
import tripMapCss from "./trip-map/trip-map-public.css?inline";
import tripMapThemeCss from "./trip-map/trip-map-public-theme.css?inline";
import tripMapEditorialCss from "./trip-map/trip-map-editorial.css?inline";
import { patchPlanPresentation, searchMapPlaces } from "./api-client.js";
import { CurrentDestinationWeather } from "./CurrentDestinationWeather.js";
import { toNativeTrip, type NativeStateSnapshot, type NativeTrip } from "./trip-map-adapter.js";
import { resolveMissingCoordinates } from "./trip-map-coordinate-resolver.js";
import { tripMapShadowHtml } from "./trip-map-embed-shell.js";

type NativeRuntime = {
  TripMapCore?: { mount(input: { root: HTMLElement; trip: NativeTrip; onStateChange: (state: NativeStateSnapshot) => Promise<void>; onEditSummaryChange?: (summary: NativeEditSummary) => void; readOnly: boolean; onEditBlocked: () => void }): NativeMapController };
  L?: typeof L;
};

type MapProgress = { tone: "working" | "success" | "error"; step: number; text: string };
type NativeEditSummary = { count: number; affectedLabels: string[]; highImpact: boolean };
type NativeMapController = { openSaveDialog: () => void; discardMapEdits: () => void };
type ToolbarStyle = CSSProperties & { "--native-map-column-offset"?: string };

export function PlanMapWorkspace({ planId, planVersion, presentation, partySize, arrivals, editable, onWorkspace, onStatus, onRevise, onError }: {
  planId: string;
  planVersion: number;
  presentation: PlanPresentation;
  partySize?: number | undefined;
  arrivals?: DestinationArrivalEvent[];
  editable: boolean;
  onWorkspace: (workspace: WorkspaceSnapshot) => Promise<void>;
  onStatus: (message: string) => void;
  onError: (message: string) => void;
  onRevise: (message?: string) => void;
}) {
  const hostRef = useRef<HTMLDivElement>(null);
  const callbacksRef = useRef({ onWorkspace, onStatus, onRevise, onError });
  callbacksRef.current = { onWorkspace, onStatus, onRevise, onError };
  const [resolved, setResolved] = useState<PlanPresentation | null>(null);
  const [resolving, setResolving] = useState(false);
  const [saving, setSaving] = useState(false);
  const [progress, setProgress] = useState<MapProgress | null>(null);
  const [editSummary, setEditSummary] = useState<NativeEditSummary>({ count: 0, affectedLabels: [], highImpact: false });
  const [mapColumnOffset, setMapColumnOffset] = useState<number | null>(null);
  const retryRef = useRef<null | (() => Promise<void>)>(null);
  const mapControllerRef = useRef<NativeMapController | null>(null);

  useEffect(() => {
    let cancelled = false;
    setResolved(null);
    setResolving(true);
    void resolveMissingCoordinates(presentation, { searchMapPlaces })
      .then((next) => { if (!cancelled) setResolved(next); })
      .catch((caught) => { if (!cancelled) { callbacksRef.current.onError(caught instanceof Error ? caught.message : "Unable to locate places on the map."); setResolved(presentation); } })
      .finally(() => { if (!cancelled) setResolving(false); });
    return () => { cancelled = true; };
  }, [planId, planVersion, presentation]);

  const nativeTrip = useMemo(() => resolved ? toNativeTrip(planId, planVersion, resolved, partySize) : null, [partySize, planId, planVersion, resolved]);

  useEffect(() => {
    if (!hostRef.current || !nativeTrip) return;
    const runtime = globalThis as NativeRuntime;
    runtime.L = L;
    if (!runtime.TripMapCore) {
      callbacksRef.current.onError("The trip map did not finish loading. Please refresh the page.");
      return;
    }
    const shadow = hostRef.current.shadowRoot ?? hostRef.current.attachShadow({ mode: "open" });
    shadow.innerHTML = tripMapShadowHtml({ leafletCss, tripMapCss, tripMapThemeCss, tripMapEditorialCss });
    const appRoot = shadow.querySelector<HTMLElement>("#trip-app");
    if (!appRoot) return;
    mapControllerRef.current = runtime.TripMapCore.mount({ root: appRoot, trip: nativeTrip, readOnly: !editable, onEditSummaryChange: setEditSummary, onEditBlocked: () => callbacksRef.current.onRevise("I want to adjust the current trip. Create a replacement draft based on the active plan without overwriting it."), onStateChange: async (state) => {
      const saveMapChanges = async () => {
        setSaving(true);
        setProgress({ tone: "working", step: 1, text: "Saving map changes…" });
        try {
          const payload = await patchPlanPresentation(planId, { expectedVersion: planVersion, ...state });
          await callbacksRef.current.onWorkspace(payload);
          retryRef.current = null;
          setProgress({ tone: "success", step: 2, text: "Affected day updated" });
          callbacksRef.current.onStatus("Map changes were saved directly to the plan. Affected routes were refreshed or marked for review.");
          window.setTimeout(() => setProgress((current) => current?.tone === "success" ? null : current), 2600);
        } catch (caught) {
          const message = caught instanceof Error ? caught.message : "The map changes could not be saved to the plan.";
          setProgress({ tone: "error", step: 1, text: message });
          callbacksRef.current.onError(message);
        } finally {
          setSaving(false);
        }
      };
      retryRef.current = saveMapChanges;
      await saveMapChanges();
    } });
    return () => { mapControllerRef.current = null; setEditSummary({ count: 0, affectedLabels: [], highImpact: false }); setMapColumnOffset(null); };
  }, [editable, nativeTrip, planId, planVersion]);

  useEffect(() => {
    if (!editSummary.count || !hostRef.current) {
      setMapColumnOffset(null);
      return;
    }
    let animationFrame = 0;
    const measureMapColumn = () => {
      const workspace = hostRef.current?.parentElement;
      const mapStage = hostRef.current?.shadowRoot?.querySelector<HTMLElement>(".map-stage");
      if (!workspace || !mapStage) return;
      const nextOffset = Math.max(0, Math.round(mapStage.getBoundingClientRect().left - workspace.getBoundingClientRect().left));
      setMapColumnOffset((current) => current === nextOffset ? current : nextOffset);
    };
    const scheduleMeasure = () => {
      window.cancelAnimationFrame(animationFrame);
      animationFrame = window.requestAnimationFrame(measureMapColumn);
    };
    scheduleMeasure();
    window.addEventListener("resize", scheduleMeasure);
    return () => {
      window.cancelAnimationFrame(animationFrame);
      window.removeEventListener("resize", scheduleMeasure);
    };
  }, [editSummary.count, nativeTrip]);

  if (presentation.kind !== "itinerary" || !presentation.places.length) return null;
  const pendingChangeLabel = `${editSummary.count} ${editSummary.count === 1 ? "change" : "changes"} pending`;
  const affectedDatesLabel = editSummary.affectedLabels.length ? `Affected dates: ${editSummary.affectedLabels.join(", ")}` : "Affected dates";
  const toolbarStyle: ToolbarStyle | undefined = mapColumnOffset === null ? undefined : { "--native-map-column-offset": `${mapColumnOffset}px` };
  return <div className="native-map-workspace-frame">
    {editSummary.count ? <div className="native-map-edit-bar" role="status" aria-live="polite" title={affectedDatesLabel} style={toolbarStyle}>
      <div><strong>{pendingChangeLabel}</strong></div>
      <button type="button" className="secondary-action" onClick={() => mapControllerRef.current?.discardMapEdits()}>Discard</button>
      <button type="button" className="primary-action" onClick={() => mapControllerRef.current?.openSaveDialog()}>Save changes</button>
    </div> : null}
    <section className={`native-trip-workspace${saving ? " is-map-processing" : ""}`} aria-label="Interactive trip plan" aria-busy={saving}>
      <CurrentDestinationWeather presentation={presentation} arrivals={arrivals ?? []} />
      {resolving ? <div className="trip-map-loading">Locating planned places and creating map markers…</div> : null}
      {progress ? <div className={`map-agent-progress ${progress.tone}`} role="status" aria-live="polite"><span className="map-agent-progress-icon" aria-hidden="true">{progress.tone === "success" ? "✓" : progress.tone === "error" ? "!" : ""}</span><div><strong>{progress.text}</strong><span>{progress.tone === "working" ? `Step ${progress.step} of 2` : progress.tone === "success" ? "Changes synced to the plan" : "Your changes were not saved"}</span><i><b style={{ width: `${progress.tone === "success" ? 100 : progress.step * 50}%` }} /></i></div>{progress.tone === "error" && retryRef.current ? <button type="button" onClick={() => void retryRef.current?.()}>Retry</button> : null}</div> : null}
      <div ref={hostRef} />
    </section>
  </div>;
}
