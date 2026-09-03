export function tripMapShadowHtml(input: { leafletCss: string; tripMapCss: string; tripMapThemeCss: string; tripMapEditorialCss: string }): string {
  return `<style>${input.leafletCss}\n${shadowCss(input.tripMapCss)}\n${shadowCss(input.tripMapThemeCss)}\n${shadowCss(input.tripMapEditorialCss)}\n${embedOverrides}</style>${nativeShell}`;
}

export function shadowCss(value: string): string {
  return value.replaceAll(":root", ":host");
}

const embedOverrides = `
:host { display: block; width: 100%; color: #17212b; font-family: var(--trip-font); }
.is-readonly .place-actions, .is-readonly .priority-controls, .is-readonly .assignment-controls { display: none !important; }
.trip-app { height: min(760px, calc(100vh - 180px)); min-height: 680px; }
@media (max-width: 820px) {
  .trip-app, .trip-app.is-detail-browse { height: calc(100dvh - 150px); min-height: 600px; }
  .leaflet-control-layers { max-height: 44px; overflow: hidden; }
  .leaflet-control-layers-expanded { max-height: 52vh; overflow-y: auto; }
}
`;

const nativeShell = `
<main class="trip-app" id="trip-app">
  <aside class="planner-shell" aria-label="Trip plan">
    <section class="overview-panel" id="trip-overview"><header class="trip-header">
      <div class="trip-eyebrow" id="trip-eyebrow"></div><h1 class="trip-title" id="trip-title"></h1><p class="trip-summary" id="trip-summary"></p>
      <div class="trip-stats" aria-label="Trip overview"><div class="trip-stat"><strong id="trip-day-count">0</strong><span>Trip days</span></div><div class="trip-stat"><strong id="trip-party-count">—</strong><span>Travelers</span></div><div class="trip-stat"><strong id="trip-day-trip-count">0</strong><span>Day trips</span></div><div class="trip-stat"><strong id="trip-place-count">0</strong><span>Planned places</span></div></div>
    </header><div class="trip-quick-controls"><div class="trip-city-tabs" id="trip-city-tabs" aria-label="Jump to a city"></div><label class="candidate-toggle"><input type="checkbox" id="show-candidates-toggle"><span>Show optional places</span></label></div>
    <section class="section-block" aria-labelledby="days-heading"><div class="section-heading-row"><div><div class="section-kicker">Start with the route</div><h2 class="section-title" id="days-heading">Daily routes</h2></div></div><div class="day-list" id="day-list"></div></section>
    <section class="section-block" aria-labelledby="quick-heading"><div class="section-heading-row"><div><div class="section-kicker">Explore every option</div><h2 class="section-title" id="quick-heading">Places</h2></div></div>
      <div class="filter-grid"><input class="filter-control search-control" id="quick-search" type="search" data-filter-field="search" placeholder="Search places, neighborhoods, or notes" aria-label="Search places"><select class="filter-control" id="filter-city" data-filter-field="city" aria-label="Filter by city or area"></select><select class="filter-control" id="filter-category" data-filter-field="category" aria-label="Filter by category"></select><select class="filter-control" id="filter-priority" data-filter-field="priority" aria-label="Filter by priority"></select><select class="filter-control" id="filter-plan" data-filter-field="plan" aria-label="Filter by itinerary assignment"></select></div>
      <div class="quick-list-meta"><span id="quick-count">0 places</span><button class="text-button" id="clear-filters" type="button">Clear filters</button></div><div class="quick-list" id="quick-list"></div>
    </section></section>
    <section class="detail-browse" id="detail-browse" hidden><nav class="day-rail" id="day-rail" aria-label="Switch itinerary by date"></nav><section class="day-list-panel" id="day-place-list" aria-label="Day itinerary"></section><article class="poi-detail" id="poi-detail" aria-live="polite"></article></section>
  </aside>
  <section class="map-stage" aria-label="Map"><div id="map" aria-label="Trip map"></div><div class="map-note" id="map-note" aria-live="polite"></div></section>
  <section class="dialog-backdrop" id="impact-dialog" hidden role="dialog" aria-modal="true" aria-labelledby="impact-title"><div class="dialog-panel impact-panel"><div class="dialog-heading"><h2 id="impact-title">Save changes?</h2></div><div class="dialog-actions"><button class="text-button" id="cancel-impact" type="button">Keep editing</button><button class="text-button primary" id="confirm-impact" type="button">Save changes</button></div></div></section>
  <section class="dialog-backdrop" id="replan-dialog" hidden role="dialog" aria-modal="true" aria-labelledby="replan-title"><div class="dialog-panel"><div class="dialog-heading"><div><div class="section-kicker">My itinerary changes</div><h2 id="replan-title">Affected day update</h2></div><button class="icon-button" id="close-replan" type="button" aria-label="Close">×</button></div><p class="muted">These map changes are saved directly to the current Plan and limited to affected dates.</p><textarea id="replan-text" readonly aria-label="Itinerary change summary"></textarea><div class="dialog-actions"><button class="text-button primary" id="copy-replan" type="button">Copy summary</button></div><div class="copy-feedback" id="copy-feedback" aria-live="polite"></div></div></section>
</main>`;
