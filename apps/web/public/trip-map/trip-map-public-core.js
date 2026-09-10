(function installTripMapCore(root) {
  "use strict";

  function mount({ root: appRoot, trip, onStateChange, onEditSummaryChange, readOnly = false, onEditBlocked }) {
    if (!appRoot) throw new Error("Trip map container not found");
    if (!trip || !Array.isArray(trip.pois) || !Array.isArray(trip.days)) {
      throw new Error("The trip map is missing places or daily route data");
    }
    if (!root.L || !root.TripMapRoute || !root.TripMapState) throw new Error("Trip map resources did not finish loading");

    const shadowRoot = appRoot.getRootNode();
    const $ = (selector) => appRoot.querySelector(selector) || shadowRoot.querySelector?.(selector) || document.querySelector(selector);
    const unique = (values) => [...new Set(values.filter(Boolean))];
    const storageKey = `${trip.slug || "trip-planner-public"}:${trip.dataRevision || "v1"}`;
    const pois = new Map(trip.pois.map((poi) => [poi.id, poi]));
    const days = new Map(trip.days.map((day) => [day.id, day]));
    const categoryLabels = trip.categories || {};
    const priorityLabels = trip.priorities || {};
    const cityLabels = trip.cities || {};
    const categoryGlyphs = { hotel: "H", top50: "50", wine: "W", sweet: "S", coffee: "C", food: "F", art: "A", "local-life": "L", sight: "T", event: "E", architecture: "B", history: "H", local: "L", market: "M", nightlife: "N" };
    const categoryMarkerGlyphs = { hotel: "⌂", top50: "★", wine: "♢", sweet: "◌", coffee: "☕", food: "♨", art: "▧", "local-life": "⌖", sight: "♜", event: "◇", architecture: "▥", history: "♜", local: "⌖", market: "♨", nightlife: "N", transport: "↗" };
    let state = root.TripMapState.createState(trip, loadSavedState());
    let map;
    let markerLayer;
    let routeLayer;
    let layerControl;
    const markerLayers = new Map();
    const layerKeyByLeafletId = new Map();
    let markerByPoi = new Map();
    let pendingAction = null;
    let shouldFitMap = true;
    let hashMapView = null;
    let pointerSort = null;

    appRoot.classList.toggle("is-readonly", readOnly);

    applyHashState();
    if (state.view.activeDayId) state.view.layers.itinerary = true;
    initializeMap();
    renderFilters();
    bindEvents();
    renderAll();

    function loadSavedState() {
      try {
        const saved = JSON.parse(root.localStorage.getItem(storageKey) || "{}");
        // The Plan is authoritative for assignments, order and priorities. Only
        // viewport preferences belong to this browser session.
        return saved && typeof saved === "object" && saved.view ? { view: saved.view } : {};
      } catch (_error) {
        return {};
      }
    }

    function persistState() {
      if (map) {
        const center = map.getCenter();
        state.view.map = { lat: center.lat, lng: center.lng, zoom: map.getZoom() };
      }
      try {
        root.localStorage.setItem(storageKey, JSON.stringify(state));
      } catch (_error) {
        // The map remains usable when browser storage is unavailable.
      }
      const params = new URLSearchParams();
      if (state.view.map) {
        params.set("lat", Number(state.view.map.lat).toFixed(5));
        params.set("lng", Number(state.view.map.lng).toFixed(5));
        params.set("z", String(state.view.map.zoom));
      }
      if (state.view.activeDayId) params.set("day", state.view.activeDayId);
      if (state.view.selectedPoiId) params.set("poi", state.view.selectedPoiId);
      params.set("layers", Object.entries(state.view.layers || {}).filter(([, enabled]) => enabled).map(([key]) => key).join(","));
      const nextHash = params.toString();
      root.history.replaceState(null, "", `${root.location.pathname}${root.location.search}${nextHash ? `#${nextHash}` : ""}`);
    }

    function applyHashState() {
      const params = new URLSearchParams(root.location.hash.replace(/^#/, ""));
      const dayId = params.get("day");
      const poiId = params.get("poi") || params.get("place");
      const lat = Number(params.get("lat"));
      const lng = Number(params.get("lng"));
      const zoom = Number(params.get("z"));
      if (Number.isFinite(lat) && Number.isFinite(lng) && Number.isFinite(zoom)) {
        hashMapView = { lat, lng, zoom };
        state.view.map = hashMapView;
      }
      const hasRequestedDay = days.has(dayId);
      if (hasRequestedDay) state.view.activeDayId = dayId;
      if (pois.has(poiId)) {
        const poiDayId = assignedDayId(poiId)
          || trip.days.find((day) => candidatePoisForDay(day.id).includes(poiId))?.id
          || "";
        if (!hasRequestedDay && poiDayId) state.view.activeDayId = poiDayId;
        const selectedDay = state.view.activeDayId;
        const belongsToSelectedDay = !selectedDay
          || assignedDayId(poiId) === selectedDay
          || candidatePoisForDay(selectedDay).includes(poiId);
        state.view.selectedPoiId = belongsToSelectedDay ? poiId : "";
      } else if (hasRequestedDay) {
        state.view.selectedPoiId = "";
      }
      if (params.has("layers")) {
        const enabled = new Set(String(params.get("layers") || "").split(",").filter(Boolean));
        const currentKeys = Object.keys(state.view.layers || {});
        const categoryKeys = currentKeys.filter((key) => key !== "itinerary");
        if (categoryKeys.some((key) => enabled.has(key))) {
          for (const key of currentKeys) state.view.layers[key] = enabled.has(key);
        }
      }
      const activeDay = days.get(state.view.activeDayId);
      if (activeDay && state.view.filters.city && state.view.filters.city !== activeDay.city) {
        state.view.filters.city = "";
      }
    }

    function initializeMap() {
      const initialView = hashMapView || state.view.map;
      map = root.L.map($("#map"), { zoomControl: true, attributionControl: true }).setView(
        initialView ? [initialView.lat, initialView.lng] : (trip.map?.center || [48.8588, 2.3295]),
        Number(initialView?.zoom || trip.map?.zoom || 13),
      );
      root.L.tileLayer("https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Light_Gray_Base/MapServer/tile/{z}/{y}/{x}", {
        maxNativeZoom: 16,
        maxZoom: 19,
        attribution: "Tiles &copy; Esri",
      }).addTo(map);
      markerLayer = root.L.layerGroup().addTo(map);
      routeLayer = root.L.layerGroup();
      for (const category of Object.keys(categoryLabels)) markerLayers.set(category, root.L.layerGroup());
      syncLayerVisibility();
      initializeLayerControl();
      map.on("moveend", persistState);
    }

    function themeValue(name, fallback) {
      const value = root.getComputedStyle?.(appRoot)?.getPropertyValue(name)?.trim();
      return value || fallback;
    }

    function syncLayerVisibility() {
      const layers = new Map([["itinerary", routeLayer], ...markerLayers.entries()]);
      for (const [key, layer] of layers) {
        if (state.view.layers[key] !== false) {
          if (!map.hasLayer(layer)) layer.addTo(map);
        } else if (map.hasLayer(layer)) {
          map.removeLayer(layer);
        }
      }
    }

    function decorateLayerControl() {
      const container = layerControl?.getContainer();
      const list = container?.querySelector(".leaflet-control-layers-list");
      const overlays = container?.querySelector(".leaflet-control-layers-overlays");
      if (!list || !overlays) return;
      list.querySelectorAll(".map-control-title").forEach((node) => node.remove());
      overlays.querySelectorAll(".map-control-group-label").forEach((node) => node.remove());
      const labels = [...overlays.children].filter((node) => node.matches("label"));
      const title = document.createElement("div");
      title.className = "map-control-title";
      title.textContent = "Map display";
      list.prepend(title);
      const routeHeading = document.createElement("div");
      routeHeading.className = "map-control-group-label";
      routeHeading.textContent = "Routes and transfers";
      overlays.prepend(routeHeading);
      if (labels[1]) {
        const poiHeading = document.createElement("div");
        poiHeading.className = "map-control-group-label";
        poiHeading.textContent = "Place categories";
        overlays.insertBefore(poiHeading, labels[1]);
      }
    }

    function initializeLayerControl() {
      const entries = { [`Daily routes (${trip.days.length})`]: routeLayer };
      layerKeyByLeafletId.set(root.L.stamp(routeLayer), "itinerary");
      for (const [category, layer] of markerLayers) {
        const count = trip.pois.filter((poi) => poi.category === category).length;
        entries[`${categoryGlyphs[category] || "P"} | ${categoryLabels[category] || category} (${count})`] = layer;
        layerKeyByLeafletId.set(root.L.stamp(layer), category);
      }
      layerControl = root.L.control.layers(null, entries, { collapsed: true }).addTo(map);
      if (typeof layerControl.collapse === "function") layerControl.collapse();
      decorateLayerControl();
      map.on("layeradd layerremove", decorateLayerControl);
      map.on("overlayadd overlayremove", (event) => {
        const key = layerKeyByLeafletId.get(root.L.stamp(event.layer));
        if (!key) return;
        state.view.layers[key] = event.type === "overlayadd";
        persistState();
      });
    }

    function escapeHtml(value) {
      return String(value ?? "").replace(/[&<>"']/g, (character) => ({
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        '"': "&quot;",
        "'": "&#39;",
      })[character]);
    }

    function shortDate(date) {
      const parts = String(date || "").split("-");
      return parts.length === 3 ? `${Number(parts[1])}/${Number(parts[2])}` : date;
    }

    function assignedDayId(poiId) {
      return state.assignments[poiId] || "";
    }

    function isRecurringOnDay(poi, dayId) {
      return Boolean(poi?.recurring && days.get(dayId)?.routeStops?.some((stop) => stop.poiId === poi.id));
    }

    function isPoiOnDay(poiId, dayId) {
      const poi = pois.get(poiId);
      return assignedDayId(poiId) === dayId || isRecurringOnDay(poi, dayId);
    }

    function assignedLabel(poiId) {
      const poi = pois.get(poiId);
      if (poi?.recurring && poi.category === "hotel") return "Accommodation anchor for this trip segment";
      if (poi?.recurring) {
        const labels = trip.days.filter((day) => isRecurringOnDay(poi, day.id)).map((day) => shortDate(day.date));
        return `Scheduled on ${labels.join(", ")}`;
      }
      const dayId = assignedDayId(poiId);
      if (!dayId) return "Not scheduled";
      const day = days.get(dayId);
      return day ? `Scheduled ${shortDate(day.date)}` : "Not scheduled";
    }

    function priorityLabel(poiId) {
      return priorityLabels[state.priorities[poiId]] || "Unmarked";
    }

    function categoryLabel(poi) {
      return categoryLabels[poi.category] || poi.category;
    }

    function cityLabel(value) {
      return cityLabels[value] || value;
    }

    function displayName(poi) {
      return String(poi?.name || poi?.name_zh || "").trim();
    }

    function localName(poi) {
      const local = String(poi?.name_zh || "").trim();
      const primary = displayName(poi);
      return local && local !== primary ? local : "";
    }

    function nonHotelOrder(dayId, poiId) {
      const ordered = (state.orders[dayId] || []).filter((id) => pois.get(id)?.category !== "hotel");
      const index = ordered.indexOf(poiId);
      return index >= 0 ? index + 1 : "";
    }

    function routeStop(day, poiId) {
      return (day.routeStops || []).find((stop) => stop.poiId === poiId);
    }

    function timelineTimeLabel(time, durationMinutes) {
      const match = /^(\d{2}):(\d{2})$/.exec(time || "");
      if (!match || !Number.isInteger(durationMinutes) || durationMinutes < 1) return time || "";
      const start = Number(match[1]) * 60 + Number(match[2]);
      const end = start + durationMinutes;
      const endHours = Math.floor(end / 60) % 24;
      const endMinutes = end % 60;
      return `${time}–${String(endHours).padStart(2, "0")}:${String(endMinutes).padStart(2, "0")}`;
    }

    function candidatePoisForDay(dayId) {
      const day = days.get(dayId);
      if (!day || day.city === "Transit") return [];
      const scheduled = (state.orders[dayId] || []).map((poiId) => pois.get(poiId)).filter(Boolean);
      const areas = new Set(scheduled.map((poi) => poi.area));
      const coords = scheduled.map((poi) => poi.coords).filter(Boolean);
      const priorityRank = { must: 0, preferred: 1, nearby: 2, pending: 3, archive: 4 };
      const distance = (poi) => coords.length
        ? Math.min(...coords.map((point) => (point[0] - poi.coords[0]) ** 2 + (point[1] - poi.coords[1]) ** 2))
        : Number.POSITIVE_INFINITY;
      const explicit = (day.candidates || []).filter((poiId) => pois.has(poiId) && !isPoiOnDay(poiId, dayId));
      const discovered = trip.pois
        .filter((poi) => poi.city === day.city && poi.category !== "hotel" && !assignedDayId(poi.id) && !poi.recurring)
        .sort((left, right) => (
          (priorityRank[state.priorities[left.id]] ?? 5) - (priorityRank[state.priorities[right.id]] ?? 5)
          || Number(areas.has(right.area)) - Number(areas.has(left.area))
          || distance(left) - distance(right)
          || displayName(left).localeCompare(displayName(right), "en-US")
        ))
        .slice(0, 8)
        .map((poi) => poi.id);
      return [...new Set([...explicit, ...discovered])].slice(0, 8);
    }

    function filters() {
      return state.view.filters;
    }

    function filteredPois() {
      const activeDayId = state.view.activeDayId;
      const day = days.get(activeDayId);
      const query = filters().search.trim().toLowerCase();
      return trip.pois.filter((poi) => {
        const haystack = [poi.name, poi.name_zh, poi.city, poi.area, categoryLabel(poi), poi.note, poi.plan]
          .join(" ")
          .toLowerCase();
        if (query && !haystack.includes(query)) return false;
        if (filters().city && poi.city !== filters().city) return false;
        if (filters().category && poi.category !== filters().category) return false;
        if (filters().priority && state.priorities[poi.id] !== filters().priority) return false;
        if (filters().plan === "scheduled" && !isPoiOnDay(poi.id, activeDayId)) return false;
        if (filters().plan === "candidate" && !candidatePoisForDay(day?.id).includes(poi.id)) return false;
        if (filters().plan === "unassigned" && (assignedDayId(poi.id) || poi.recurring)) return false;
        if (filters().plan === "other-day" && (poi.recurring || !assignedDayId(poi.id) || assignedDayId(poi.id) === activeDayId)) return false;
        return true;
      });
    }

    function renderAll(options = {}) {
      shouldFitMap = options.preserveMapView ? false : shouldFitMap;
      const inDay = Boolean(state.view.activeDayId);
      appRoot.classList.toggle("is-detail-browse", inDay);
      window.setTimeout(() => {
        if (layerControl && $("#map").clientWidth < 760 && typeof layerControl.collapse === "function") layerControl.collapse();
      }, 0);
      $("#trip-overview").hidden = inDay;
      $("#detail-browse").hidden = !inDay;
      renderOverview();
      renderCityTabs();
      renderCandidateToggle();
      renderDayRail();
      renderDayPlaceList(state.view.activeDayId);
      renderPoiDetail(state.view.selectedPoiId);
      renderFilters();
      renderChangeSummary();
      renderMapLayers();
      persistState();
    }

    function renderOverview() {
      $("#trip-title").textContent = trip.title;
      $("#trip-eyebrow").textContent = trip.eyebrow || "Public trip map";
      $("#trip-summary").textContent = trip.summary;
      $("#trip-day-count").textContent = trip.days.length;
      $("#trip-party-count").textContent = Number.isInteger(trip.partySize) && trip.partySize > 0 ? trip.partySize : "—";
      $("#trip-day-trip-count").textContent = Number.isInteger(trip.dayTripCount) && trip.dayTripCount >= 0 ? trip.dayTripCount : 0;
      $("#trip-place-count").textContent = trip.pois.length;
      $("#day-list").innerHTML = trip.days.map((day) => {
        const routeRationale = String(day.routeReview?.sequenceRationale || "").trim();
        const ordered = (state.orders[day.id] || (day.routeStops || []).map((stop) => stop.poiId))
          .filter((poiId) => isPoiOnDay(poiId, day.id));
        const hasScheduledTimes = ordered.some((poiId) => Boolean(timelineTimeLabel(routeStop(day, poiId)?.time, pois.get(poiId)?.durationMinutes)));
        const timeline = ordered.map((poiId, index) => {
          const poi = pois.get(poiId);
          if (!poi) return "";
          const stop = routeStop(day, poiId);
          const nextPoiId = ordered[index + 1];
          const transit = nextPoiId ? transitInfo(day, poiId, nextPoiId) : null;
          const timeLabel = timelineTimeLabel(stop?.time, poi.durationMinutes);
          const transitMinutes = transit?.minutes ? `${transit.minutes} min` : "";
          const transitLabelText = transit ? String(transit.label || "").trim() : "";
          const transitDetail = transit ? String(transit.detail || "").trim() : "";
          return `<span class="day-timeline-stop ${timeLabel ? "" : "has-no-time"}">${timeLabel ? `<span class="day-timeline-time">${escapeHtml(timeLabel)}</span>` : ""}<span class="day-timeline-name">${escapeHtml(displayName(poi))}</span></span>
            ${transit ? `<span class="day-timeline-transit"><span class="day-transit-arrow" aria-hidden="true">↓</span><span class="day-transit-copy"><span class="day-transit-primary"><strong>${escapeHtml(transitModeLabel(transit.mode))}</strong>${transitLabelText ? `<span> · ${escapeHtml(transitLabelText)}</span>` : ""}${transitMinutes ? `<span> · ${escapeHtml(transitMinutes)}</span>` : ""}</span>${transitDetail && transitDetail !== transitLabelText ? `<small>${escapeHtml(transitDetail)}</small>` : ""}</span></span>` : ""}`;
        }).join("");
        const summary = String(day.summary || "").trim();
        const showRationale = routeRationale && routeRationale !== summary;
        return `<button class="day-card" type="button" data-open-day="${escapeHtml(day.id)}">
          <span class="day-heading"><span class="day-meta">${escapeHtml(day.date)} · ${escapeHtml(cityLabel(day.city))}</span><span class="day-title">${escapeHtml(day.title)}</span></span>
          ${summary ? `<span class="day-summary">${escapeHtml(summary)}</span>` : ""}
          ${showRationale ? `<span class="day-reason">${escapeHtml(routeRationale)}</span>` : ""}
          ${timeline ? `<span class="day-timeline ${hasScheduledTimes ? "has-times" : "has-no-times"}" aria-label="Day timeline">${timeline}</span>` : ""}
        </button>`;
      }).join("");
      renderQuickList();
    }

    function renderCityTabs() {
      const container = $("#trip-city-tabs");
      const selectedCity = filters().city;
      container.innerHTML = `<button class="trip-city-tab ${selectedCity ? "" : "is-active"}" type="button" data-select-city="">Full trip</button>${Object.entries(cityLabelsForTrip()).map(([city, label]) => `<button class="trip-city-tab ${selectedCity === city ? "is-active" : ""}" type="button" data-select-city="${escapeHtml(city)}">${escapeHtml(label)}</button>`).join("")}`;
    }

    function cityLabelsForTrip() {
      return trip.cities || Object.fromEntries([...new Set(trip.pois.map((poi) => poi.city))].map((city) => [city, cityLabel(city)]));
    }

    function renderCandidateToggle() {
      const toggle = $("#show-candidates-toggle");
      toggle.checked = state.view.showCandidates !== false;
    }

    function renderQuickList() {
      const visible = filteredPois();
      $("#quick-count").textContent = `${visible.length} / ${trip.pois.length} places`;
      $("#quick-list").innerHTML = visible.map((poi) => `
        <button class="quick-place ${state.view.selectedPoiId === poi.id ? "is-selected" : ""}" type="button" data-open-place="${escapeHtml(poi.id)}">
          <span class="place-meta">${escapeHtml(cityLabel(poi.city))} · ${escapeHtml(poi.area)}</span>
          <span class="place-name">${escapeHtml(displayName(poi))}</span>
          <span class="place-tags">
            <span class="tag">${escapeHtml(categoryLabel(poi))}</span>
            <span class="tag accent">${escapeHtml(priorityLabel(poi.id))}</span>
            <span class="tag">${escapeHtml(assignedLabel(poi.id))}</span>
          </span>
        </button>`).join("") || '<div class="empty-state">No places match the current filters.</div>';
    }

    function selectDay(dayId, options = {}) {
      if (!days.has(dayId)) return;
      state.view.activeDayId = dayId;
      if (state.view.filters.city && state.view.filters.city !== days.get(dayId)?.city) {
        state.view.filters.city = "";
      }
      state.view.layers.itinerary = true;
      syncLayerVisibility();
      if (!options.keepPlace) {
        state.view.selectedPoiId = (state.orders[dayId] || []).find((poiId) => isPoiOnDay(poiId, dayId)) || "";
      }
      shouldFitMap = !options.preserveMapView;
      renderAll({ preserveMapView: options.preserveMapView });
    }

    function openPoiDetail(poiId, options = {}) {
      const poi = pois.get(poiId);
      if (!poi) return;
      if (!state.view.activeDayId) {
        const targetDay = assignedDayId(poiId)
          || trip.days.find((day) => candidatePoisForDay(day.id).includes(poiId))?.id
          || trip.days[0]?.id;
        state.view.activeDayId = targetDay || "";
      }
      state.view.layers.itinerary = true;
      syncLayerVisibility();
      const categoryLayer = markerLayers.get(poi.category);
      if (categoryLayer && !map.hasLayer(categoryLayer)) {
        state.view.layers[poi.category] = true;
        categoryLayer.addTo(map);
      }
      state.view.selectedPoiId = poiId;
      shouldFitMap = false;
      renderAll({ preserveMapView: true });
      markerByPoi.get(poiId)?.openTooltip();
      if (options.pan !== false) map.panTo(poi.coords, { animate: false });
      if (root.innerWidth <= 820) $("#poi-detail").scrollIntoView({ block: "start" });
    }

    function returnToOverview() {
      state.view.activeDayId = "";
      state.view.selectedPoiId = "";
      shouldFitMap = true;
      renderAll();
    }

    function selectCity(city) {
      state.view.activeDayId = "";
      state.view.selectedPoiId = "";
      state.view.filters.city = city || "";
      state.view.filters.plan = "";
      shouldFitMap = true;
      renderAll();
    }

    function renderDayRail() {
      const rail = $("#day-rail");
      if (!state.view.activeDayId) {
        rail.innerHTML = "";
        return;
      }
      rail.innerHTML = `<button class="day-pill" type="button" data-return-overview><strong>Full trip</strong><span>Back to overview</span></button>${trip.days.map((day) => `
        <button class="day-pill ${state.view.activeDayId === day.id ? "is-active" : ""}" type="button" data-select-day="${escapeHtml(day.id)}">
          <strong>${escapeHtml(shortDate(day.date))}</strong>
          <span>${escapeHtml(cityLabel(day.city))}</span>
        </button>`).join("")}`;
    }

    function transitInfo(day, fromPoiId, toPoiId) {
      const segment = (day.transitSegments || []).find(
        (item) => item.fromPoiId === fromPoiId && item.toPoiId === toPoiId,
      );
      return segment || null;
    }

    function transitLabel(segment) {
      return segment.label || `${segment.mode || "Transfer"}${segment.minutes ? ` about ${segment.minutes} min` : ""}`;
    }

    function transitModeLabel(mode) {
      return ({ walking: "Walking", transit: "Public transport", driving: "Driving", rail: "Rail", flight: "Flight", unknown: "Transfer" })[mode] || "Transfer";
    }

    function renderDayPlaceList(dayId) {
      const container = $("#day-place-list");
      const day = days.get(dayId);
      if (!day) {
        container.innerHTML = "";
        return;
      }
      const ordered = (state.orders[dayId] || []).filter((poiId) => isPoiOnDay(poiId, dayId));
      const rows = ordered.map((poiId, index) => {
        const poi = pois.get(poiId);
        if (!poi) return "";
        const order = poi.category === "hotel" ? "H" : nonHotelOrder(dayId, poiId);
        const transit = index > 0 ? transitInfo(day, ordered[index - 1], poiId) : null;
        const canMove = poi.category !== "hotel";
        const thumbnail = poi.thumbnail?.url
          ? `<img class="place-thumbnail" src="${escapeHtml(poi.thumbnail.url)}" alt="${escapeHtml(poi.thumbnail.alt || displayName(poi))}" loading="lazy" referrerpolicy="no-referrer">`
          : `<span class="place-thumbnail placeholder" aria-hidden="true">${escapeHtml(displayName(poi).slice(0, 1).toLocaleUpperCase())}</span>`;
        return `<div class="place-row-wrap" ${canMove ? `data-sortable-poi="${escapeHtml(poiId)}"` : ""}>
          ${transit ? `<details class="place-transit"><summary><span>${escapeHtml(transitLabel(transit))}</span><small>${escapeHtml(transitModeLabel(transit.mode))} · View details</small></summary><div class="place-transit-detail">${escapeHtml(transit.detail || "Recheck the exact route and live travel time before departure.")}</div></details>` : ""}
          <div class="place-row ${state.view.selectedPoiId === poiId ? "is-selected" : ""}">
            ${canMove ? `<button class="place-drag-handle" type="button" data-drag-poi="${escapeHtml(poiId)}" aria-label="Drag to reorder ${escapeHtml(displayName(poi))}" title="Drag to reorder">⠿</button>` : '<span class="place-drag-spacer" aria-hidden="true"></span>'}
            <button class="place-main" type="button" data-open-place="${escapeHtml(poiId)}">
              ${thumbnail}
              <span class="place-order ${poi.category === "hotel" ? "hotel" : ""}" hidden>${escapeHtml(order)}</span>
              <span><span class="place-name">${escapeHtml(displayName(poi))}</span><span class="place-meta">${escapeHtml(routeStop(day, poiId)?.time || "Time TBD")}</span></span>
            </button>
            <span class="place-actions">
              <button type="button" title="Remove from day" aria-label="Remove ${escapeHtml(displayName(poi))} from ${escapeHtml(shortDate(day.date))}" data-action="remove-day" data-poi-id="${escapeHtml(poiId)}" ${canMove ? "" : "disabled"}>−</button>
              <button class="order-shift" type="button" title="Move up" aria-label="Move ${escapeHtml(displayName(poi))} up" data-move-order="-1" data-poi-id="${escapeHtml(poiId)}" ${canMove ? "" : "disabled"}>↑</button>
              <button class="order-shift" type="button" title="Move down" aria-label="Move ${escapeHtml(displayName(poi))} down" data-move-order="1" data-poi-id="${escapeHtml(poiId)}" ${canMove ? "" : "disabled"}>↓</button>
            </span>
          </div>
        </div>`;
      }).join("");
      const candidates = candidatePoisForDay(day.id).map((poiId) => pois.get(poiId)).filter(Boolean);
      const routeReview = day.routeReview || {};
      const routeRationale = String(routeReview.sequenceRationale || "").trim();
      const fixedConstraints = Array.isArray(routeReview.fixedConstraints) ? routeReview.fixedConstraints.filter(Boolean) : [];
      const intentionalDetours = Array.isArray(routeReview.intentionalDetours) ? routeReview.intentionalDetours.filter(Boolean) : [];
      container.innerHTML = `<section class="day-context">
          <div class="day-meta">${escapeHtml(day.date)} · ${escapeHtml(cityLabel(day.city))}</div>
          <h2>${escapeHtml(day.title)}</h2>
          <p>${escapeHtml(day.summary)}</p>
          ${routeRationale ? `<div class="day-rationale"><strong>Why this order</strong><p>${escapeHtml(routeRationale)}</p>${fixedConstraints.length ? `<small>Fixed constraints: ${escapeHtml(fixedConstraints.join("; "))}</small>` : ""}${intentionalDetours.length ? `<small>Necessary detours: ${escapeHtml(intentionalDetours.join("; "))}</small>` : ""}</div>` : ""}
        </section>
        <section class="section-block"><div class="section-heading-row"><h3 class="section-title">Day itinerary</h3><span class="muted">${ordered.filter((id) => pois.get(id)?.category !== "hotel").length} / ${Number(day.capacity || 6)} main places</span></div><div class="place-list">${rows || '<div class="empty-state">No places are scheduled for this day.</div>'}</div></section>
        <section class="section-block"><h3 class="section-title">Nearby options</h3><div class="quick-list">${candidates.map((poi) => {
          const action = assignedDayId(poi.id) ? "move-day" : "assign-day";
          return `<div class="quick-place candidate-place"><button class="candidate-main" type="button" data-open-place="${escapeHtml(poi.id)}"><span class="place-name">${escapeHtml(displayName(poi))}</span><span class="place-meta">${escapeHtml(poi.area)} · ${escapeHtml(priorityLabel(poi.id))}</span></button><button class="candidate-add" type="button" aria-label="Add ${escapeHtml(displayName(poi))} to ${escapeHtml(shortDate(day.date))}" data-action="${action}" data-poi-id="${escapeHtml(poi.id)}" data-day-id="${escapeHtml(day.id)}">＋</button></div>`;
        }).join("") || '<div class="empty-state">No additional options right now.</div>'}</div></section>`;
      container.querySelectorAll("[data-move-order]").forEach((button) => button.addEventListener("click", (event) => {
        event.stopPropagation();
        requestAction({
          type: "move-order",
          poiId: button.dataset.poiId,
          direction: Number(button.dataset.moveOrder),
        });
      }));
    }

    function renderPoiDetail(poiId) {
      const container = $("#poi-detail");
      const poi = pois.get(poiId);
      if (!poi) {
        container.innerHTML = '<div class="empty-state">Select a scheduled place, option, or map marker to view details.</div>';
        return;
      }
      const currentDayId = poi.recurring ? state.view.activeDayId : assignedDayId(poi.id);
      const assignmentOptions = `<option value="">Not scheduled</option>${trip.days.map((day) => `<option value="${escapeHtml(day.id)}" ${currentDayId === day.id ? "selected" : ""}>${escapeHtml(shortDate(day.date))} · ${escapeHtml(cityLabel(day.city))} · ${escapeHtml(day.title)}</option>`).join("")}`;
      container.dataset.poiId = poi.id;
      container.innerHTML = `<div class="detail-heading-row">
          <div><div class="detail-meta">${escapeHtml(cityLabel(poi.city))} · ${escapeHtml(poi.area)} · ${escapeHtml(categoryLabel(poi))}</div><h2 class="detail-title">${escapeHtml(displayName(poi))}</h2>${localName(poi) ? `<div class="detail-original-name">${escapeHtml(localName(poi))}</div>` : ""}</div>
          <button class="icon-button" type="button" aria-label="Close place details" title="Close place details" data-close-detail>×</button>
        </div>
        <div class="place-tags"><span class="tag accent">${escapeHtml(priorityLabel(poi.id))}</span><span class="tag">${escapeHtml(assignedLabel(poi.id))}</span>${state.dirtyDays[currentDayId] ? '<span class="tag warning">Route needs adjustment</span>' : ""}</div>
        <section class="detail-section image-section"><h3>Image preview</h3><div class="image-status" data-image-status>Finding images…</div><div class="image-preview-viewer" data-image-viewer></div><div class="image-preview-grid" data-image-grid></div></section>
        <div class="detail-sections">
          <section class="detail-section"><h3>Why visit</h3><p>${escapeHtml(poi.note)}</p></section>
          <section class="detail-section"><h3>How to plan it</h3><p>${escapeHtml(poi.plan)}</p></section>
          <section class="detail-section"><h3>Things to know</h3><p>${escapeHtml(poi.tip)}</p></section>
        </div>
        <div class="detail-actions">
          ${poi.officialUrl ? `<a href="${escapeHtml(poi.officialUrl)}" target="_blank" rel="noreferrer">Official site / booking</a>` : ""}
          <a href="${escapeHtml(poi.mapUrl || `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(`${poi.name} ${poi.city}`)}`)}" target="_blank" rel="noreferrer">Google Maps</a>
          ${poi.experienceUrl ? `<a href="${escapeHtml(poi.experienceUrl)}" target="_blank" rel="noreferrer">Experience link</a>` : ""}
        </div>
        <section class="section-block"><h3 class="section-title">Priority</h3><div class="priority-controls">${Object.entries(priorityLabels).map(([value, label]) => `<button type="button" class="${state.priorities[poi.id] === value ? "is-active" : ""}" data-action="set-priority" data-poi-id="${escapeHtml(poi.id)}" data-priority="${escapeHtml(value)}">${escapeHtml(label)}</button>`).join("")}</div></section>
        <section class="section-block"><h3 class="section-title">Schedule date</h3><div class="assignment-controls">${poi.recurring ? `<div class="empty-state compact">${poi.category === "hotel" ? "The accommodation area appears on every day of this trip segment and does not need to be added repeatedly." : `This fixed event is scheduled on ${escapeHtml(assignedLabel(poi.id))}. Ask Landi to review timing if you remove one occurrence.`}</div>` : `<select class="filter-control" data-assign-select data-poi-id="${escapeHtml(poi.id)}" aria-label="Select schedule date">${assignmentOptions}</select>`}</div></section>`;
      void loadCommonsImages(poi);
    }

    function imageSearchUrl(poi) {
      return `https://www.google.com/search?tbm=isch&q=${encodeURIComponent(poi.imageQuery || `${poi.name} ${poi.city}`)}`;
    }

    function renderImageFallback(poi, message) {
      const container = $("#poi-detail");
      if (container.dataset.poiId !== poi.id) return;
      const status = container.querySelector("[data-image-status]");
      const viewer = container.querySelector("[data-image-viewer]");
      const grid = container.querySelector("[data-image-grid]");
      if (status) status.textContent = message;
      if (viewer) viewer.innerHTML = `<div class="empty-state">No displayable image is available right now.<br><a href="${escapeHtml(imageSearchUrl(poi))}" target="_blank" rel="noreferrer">Open Google Image Search</a></div>`;
      if (grid) grid.innerHTML = "";
    }

    async function loadCommonsImages(poi) {
      const query = poi.imageQuery || `${poi.name} ${poi.city}`;
      const endpoint = new URL("https://commons.wikimedia.org/w/api.php");
      endpoint.search = new URLSearchParams({
        action: "query",
        generator: "search",
        gsrsearch: query,
        gsrnamespace: "6",
        gsrlimit: "8",
        prop: "imageinfo",
        iiprop: "url|mime",
        iiurlwidth: "1000",
        origin: "*",
        format: "json",
      }).toString();
      try {
        const response = await fetch(endpoint);
        if (!response.ok) throw new Error(`image request ${response.status}`);
        const payload = await response.json();
        const images = Object.values(payload.query?.pages || {})
          .map((page) => page.imageinfo?.[0])
          .filter((info) => info && /^image\/(jpeg|png|webp)$/.test(info.mime || ""))
          .map((info) => ({ full: info.url, thumb: info.thumburl || info.url }))
          .slice(0, 4);
        if (!images.length) return renderImageFallback(poi, "No suitable image was found. Try image search instead.");
        const container = $("#poi-detail");
        if (container.dataset.poiId !== poi.id) return;
        const status = container.querySelector("[data-image-status]");
        const viewer = container.querySelector("[data-image-viewer]");
        const grid = container.querySelector("[data-image-grid]");
        status.textContent = `${images.length} images from Wikimedia Commons. Select one to preview.`;
        viewer.innerHTML = `<img src="${escapeHtml(images[0].thumb)}" alt="Image preview for ${escapeHtml(displayName(poi))}">`;
        grid.innerHTML = images.map((image, index) => `<button type="button" class="${index === 0 ? "is-active" : ""}" data-preview-image="${escapeHtml(image.thumb)}" aria-label="View image ${index + 1}"><img src="${escapeHtml(image.thumb)}" alt=""></button>`).join("");
      } catch (_error) {
        renderImageFallback(poi, "The image service is temporarily unavailable. The map and itinerary still work normally.");
      }
    }

    function renderFilters() {
      const city = $("#filter-city");
      const category = $("#filter-category");
      const priority = $("#filter-priority");
      const plan = $("#filter-plan");
      if (!city.dataset.ready) {
        city.innerHTML = '<option value="">All cities / areas</option>' + [...new Set(trip.pois.map((poi) => poi.city))].map((value) => `<option value="${escapeHtml(value)}">${escapeHtml(value)}</option>`).join("");
        category.innerHTML = '<option value="">All categories</option>' + Object.entries(categoryLabels).map(([value, label]) => `<option value="${escapeHtml(value)}">${escapeHtml(label)}</option>`).join("");
        priority.innerHTML = '<option value="">All priorities</option>' + Object.entries(priorityLabels).map(([value, label]) => `<option value="${escapeHtml(value)}">${escapeHtml(label)}</option>`).join("");
        plan.innerHTML = '<option value="">All places</option><option value="scheduled">Scheduled today</option><option value="candidate">Today\'s options</option><option value="unassigned">Not scheduled</option><option value="other-day">Other dates</option>';
        city.dataset.ready = "true";
      }
      $("#quick-search").value = filters().search;
      city.value = filters().city;
      category.value = filters().category;
      priority.value = filters().priority;
      plan.value = filters().plan;
      renderQuickList();
    }

    function renderChangeSummary() {
      renderEditBar(itineraryEditSummary());
    }

    function renderEditBar(editSummary = itineraryEditSummary()) {
      const highImpactReasons = unique(state.changes.flatMap((change) => change.reasons || []));
      if (typeof onEditSummaryChange === "function") {
        onEditSummaryChange({
          count: editSummary.count,
          affectedLabels: editSummary.affectedLabels,
          highImpact: highImpactReasons.length > 0,
        });
      }
    }

    function itineraryEditSummary() {
      const base = root.TripMapState.createState(trip, { view: state.view });
      const affectedDayIds = new Set();
      let count = 0;
      for (const poi of trip.pois || []) {
        const previousDayId = base.assignments[poi.id] || "";
        const nextDayId = state.assignments[poi.id] || "";
        const previousPriority = base.priorities[poi.id] || "";
        const nextPriority = state.priorities[poi.id] || "";
        if (previousDayId !== nextDayId) {
          count += 1;
          if (previousDayId) affectedDayIds.add(previousDayId);
          if (nextDayId) affectedDayIds.add(nextDayId);
        }
        if (previousPriority !== nextPriority) {
          count += 1;
          const dayId = nextDayId || previousDayId;
          if (dayId) affectedDayIds.add(dayId);
        }
      }
      for (const day of trip.days || []) {
        const previousOrder = base.orders[day.id] || [];
        const nextOrder = state.orders[day.id] || [];
        const sameMembers = previousOrder.length === nextOrder.length && previousOrder.every((poiId) => nextOrder.includes(poiId));
        if (sameMembers && previousOrder.some((poiId, index) => nextOrder[index] !== poiId)) {
          count += 1;
          affectedDayIds.add(day.id);
        }
      }
      return {
        count,
        affectedDayIds: [...affectedDayIds],
        affectedLabels: [...affectedDayIds].map((dayId) => days.get(dayId)?.date || days.get(dayId)?.title).filter(Boolean),
      };
    }

    function renderSequenceGuide(dayId, { hasVerifiedRoute = false, dirty = false } = {}) {
      if (!dayId || (hasVerifiedRoute && !dirty)) return false;
      const points = (state.orders[dayId] || [])
        .filter((poiId) => pois.get(poiId)?.category !== "hotel" && isPoiOnDay(poiId, dayId))
        .map((poiId) => pois.get(poiId)?.coords)
        .filter((coords) => Array.isArray(coords) && coords.length === 2);
      if (points.length < 2) return false;
      root.L.polyline(points, {
        className: "trip-sequence-guide",
        color: themeValue("--trip-sequence", "#64748b"),
        weight: 4,
        opacity: 0.92,
        dashArray: "6 8",
        lineCap: "round",
        lineJoin: "round",
        interactive: false,
      }).addTo(routeLayer);
      return true;
    }

    function renderMapLayers() {
      markerLayer.clearLayers();
      routeLayer.clearLayers();
      for (const layer of markerLayers.values()) layer.clearLayers();
      markerByPoi = new Map();
      const activeDayId = state.view.activeDayId;
      const activeDay = days.get(activeDayId);
      const activeCandidates = state.view.showCandidates === false ? new Set() : new Set(candidatePoisForDay(activeDayId));
      const visiblePois = filteredPois().filter((poi) =>
        !activeDayId
        || isPoiOnDay(poi.id, activeDayId)
        || activeCandidates.has(poi.id)
        || state.view.selectedPoiId === poi.id,
      );
      const bounds = [];
      let activeHasVerifiedRoute = false;

      if (!activeDayId) {
        const cityGroups = new Map();
        for (const poi of visiblePois) {
          const group = cityGroups.get(poi.city) || [];
          group.push(poi);
          cityGroups.set(poi.city, group);
        }
        const cityPoints = [];
        for (const [city, cityPois] of cityGroups) {
          const coords = [
            cityPois.reduce((sum, poi) => sum + poi.coords[0], 0) / cityPois.length,
            cityPois.reduce((sum, poi) => sum + poi.coords[1], 0) / cityPois.length,
          ];
          cityPoints.push(coords);
          const icon = root.L.divIcon({
            className: "",
            html: `<span class="city-summary-marker"><strong>${escapeHtml(cityLabel(city))}</strong><small>${cityPois.length} places</small></span>`,
            iconSize: [92, 48],
            iconAnchor: [46, 24],
          });
          const firstDay = trip.days.find((day) => day.city === city || day.routeStops?.some((stop) => pois.get(stop.poiId)?.city === city));
          root.L.marker(coords, { icon, keyboard: true, title: `${cityLabel(city)} · ${cityPois.length} places` })
            .on("click", () => firstDay && selectDay(firstDay.id))
            .addTo(markerLayer);
        }
        $("#map-note").textContent = `Select a city to view its dates. Compare the full ${trip.days.length}-day route on the left.`;
        if (cityPoints.length) map.fitBounds(cityPoints, { padding: [90, 90], maxZoom: 10, animate: false });
        shouldFitMap = false;
        window.setTimeout(() => map.invalidateSize(false), 0);
        return;
      }

      for (const day of trip.days) {
        if (!root.TripMapRoute.hasVerifiedRouteGeometry(day)) continue;
        const active = day.id === activeDayId;
        if (active) activeHasVerifiedRoute = true;
        const dirty = Boolean(state.dirtyDays[day.id]);
        const latLngs = day.routeGeometry.map(([lng, lat]) => [lat, lng]);
        root.L.polyline(latLngs, {
          color: active ? themeValue("--trip-route", "#0f766e") : themeValue("--trip-other-route", "#94a3b8"),
          weight: active ? 4 : 2,
          opacity: dirty ? 0.36 : (active ? 0.88 : 0.32),
          dashArray: dirty ? "8 8" : null,
          interactive: false,
        }).addTo(routeLayer);
        if (active) bounds.push(...latLngs);
      }

      const sequenceGuideVisible = renderSequenceGuide(activeDayId, {
        hasVerifiedRoute: activeHasVerifiedRoute,
        dirty: Boolean(state.dirtyDays[activeDayId]),
      });

      for (const poi of visiblePois) {
        const savedAssignment = assignedDayId(poi.id);
        const assignment = activeDayId && isRecurringOnDay(poi, activeDayId) ? activeDayId : savedAssignment;
        const recurringElsewhere = Boolean(activeDayId && poi.recurring && !isRecurringOnDay(poi, activeDayId));
        const isOther = Boolean(recurringElsewhere || (activeDayId && assignment && assignment !== activeDayId));
        const isUnassigned = !assignment && !poi.recurring;
        const isSelected = state.view.selectedPoiId === poi.id;
        const dirty = Boolean(assignment && state.dirtyDays[assignment]);
        const order = activeDayId && assignment === activeDayId ? nonHotelOrder(activeDayId, poi.id) : "";
        const glyph = categoryMarkerGlyphs[poi.category] || categoryGlyphs[poi.category] || "P";
        const markerLabel = displayName(poi);
        const statusGlyph = order || (state.priorities[poi.id] === "booked" ? "✓" : "");
        const classNames = ["trip-marker", `category-${poi.category}`, isOther && "is-other", isUnassigned && "is-unassigned", isSelected && "is-selected", dirty && "is-dirty"].filter(Boolean).join(" ");
        const icon = root.L.divIcon({
          className: "",
          html: `<span class="${classNames}"><span class="marker-symbol">${escapeHtml(glyph)}</span>${statusGlyph ? `<span class="marker-status">${escapeHtml(statusGlyph)}</span>` : ""}<span class="marker-label">${escapeHtml(markerLabel)}</span></span>`,
          iconSize: [210, 40],
          iconAnchor: [18, 20],
        });
        const marker = root.L.marker(poi.coords, { icon, keyboard: true, title: displayName(poi) })
          .bindTooltip(escapeHtml(displayName(poi)), { direction: "top", offset: [0, -16] })
          .on("click", () => openPoiDetail(poi.id, { pan: false }))
          .addTo(markerLayers.get(poi.category) || markerLayer);
        markerByPoi.set(poi.id, marker);
        if (assignment === activeDayId) bounds.push(poi.coords);
      }

      const mapNote = $("#map-note");
      if (activeDayId && state.dirtyDays[activeDayId] && activeHasVerifiedRoute) {
        mapNote.textContent = sequenceGuideVisible
          ? "This day changed. The faint line is the last verified route; numbered dashed lines show visit order, not roads."
          : "This day changed. The faint line is the last verified route, and new places are waiting for route verification.";
      } else if (activeDayId && state.dirtyDays[activeDayId]) {
        mapNote.textContent = "This day changed. Numbered dashed lines show visit order, not roads or live navigation.";
      } else if (activeDayId && activeHasVerifiedRoute) {
        mapNote.textContent = "Showing the verified route for this day. The day view focuses on scheduled places, options, and the current place.";
      } else if (activeDayId) {
        mapNote.textContent = "Numbered dashed lines show the day's visit order and do not represent roads or live navigation.";
      } else {
        mapNote.textContent = "Select a daily route to open the day itinerary, or select a map place for details.";
      }
      if (shouldFitMap && bounds.length) {
        map.fitBounds(bounds, { padding: [38, 38], maxZoom: 16, animate: false });
        shouldFitMap = false;
      } else if (shouldFitMap && activeDayId) {
        const cityPoints = trip.pois.filter((poi) => poi.city === activeDay?.city).map((poi) => poi.coords).filter(Boolean);
        if (cityPoints.length) map.fitBounds(cityPoints, { padding: [38, 38], maxZoom: 13, animate: false });
        else map.setView(trip.map?.center || [20, 0], Number(trip.map?.zoom || 5), { animate: false });
        shouldFitMap = false;
      }
      window.setTimeout(() => map.invalidateSize(false), 0);
    }

    function requestAction(action) {
      if (readOnly) {
        if (typeof onEditBlocked === "function") onEditBlocked();
        return;
      }
      commitAndRender(action);
    }

    function commitAndRender(action) {
      state = root.TripMapState.commitAction(trip, state, action);
      persistState();
      closeImpactDialog();
      renderAll({ preserveMapView: true });
    }

    function openImpactDialog() {
      const editSummary = itineraryEditSummary();
      if (editSummary.count === 0) return;
      const title = $("#impact-title");
      const confirm = $("#confirm-impact");
      title.textContent = "Save changes?";
      confirm.textContent = "Save changes";
      $("#impact-dialog").hidden = false;
      confirm.focus();
    }

    function closeImpactDialog() {
      $("#impact-dialog").hidden = true;
      pendingAction = null;
    }

    function cancelImpactDialog() {
      closeImpactDialog();
      renderAll({ preserveMapView: true });
    }

    function discardMapEdits() {
      const view = JSON.parse(JSON.stringify(state.view || {}));
      state = root.TripMapState.createState(trip, { view });
      persistState();
      closeImpactDialog();
      renderAll({ preserveMapView: true });
    }

    function saveMapEdits() {
      if (itineraryEditSummary().count === 0) {
        closeImpactDialog();
        return;
      }
      closeImpactDialog();
      if (typeof onStateChange === "function") void onStateChange({ assignments: state.assignments, priorities: state.priorities, orders: state.orders, replanPrompt: root.TripMapState.buildReplanPrompt(trip, state) });
    }

    function openReplanDialog() {
      $("#replan-text").value = root.TripMapState.buildReplanPrompt(trip, state);
      $("#copy-feedback").textContent = "";
      $("#replan-dialog").hidden = false;
      $("#copy-replan").focus();
    }

    function closeReplanDialog() {
      $("#replan-dialog").hidden = true;
    }

    async function copyReplanPrompt() {
      const textarea = $("#replan-text");
      const feedback = $("#copy-feedback");
      feedback.textContent = "Copying…";
      try {
        await navigator.clipboard.writeText(textarea.value);
        feedback.textContent = "Copied.";
      } catch (_error) {
        textarea.focus();
        textarea.select();
        feedback.textContent = "The browser blocked automatic copying. The full text is selected for manual copying.";
      }
    }

    function clearFilters() {
      state.view.filters = { search: "", city: "", category: "", priority: "", plan: "" };
      renderAll({ preserveMapView: true });
    }

    function updateFilter(target) {
      const field = target.dataset.filterField;
      if (!field) return;
      state.view.filters[field] = target.value;
      renderAll({ preserveMapView: true });
    }

    function assignmentAction(poiId, currentDayId, nextDayId) {
      if (!nextDayId) return { type: "remove-day", poiId };
      if (currentDayId) return { type: "move-day", poiId, dayId: nextDayId };
      return { type: "assign-day", poiId, dayId: nextDayId };
    }

    function sortableRowAt(clientX, clientY) {
      return [...appRoot.querySelectorAll("[data-sortable-poi]")].find((candidate) => {
        const rect = candidate.getBoundingClientRect();
        return clientX >= rect.left && clientX <= rect.right && clientY >= rect.top && clientY <= rect.bottom;
      });
    }

    function bindEvents() {
      appRoot.addEventListener("pointerdown", (event) => {
        const handle = event.target.closest("[data-drag-poi]");
        if (!handle || event.button !== 0) return;
        event.preventDefault();
        pointerSort = {
          poiId: handle.dataset.dragPoi,
          pointerId: event.pointerId,
          startY: event.clientY,
          moved: false,
          handle,
        };
        handle.closest("[data-sortable-poi]")?.classList.add("is-dragging");
        handle.setPointerCapture?.(event.pointerId);
        window.addEventListener("pointerup", (pointerEvent) => finishPointerSort(pointerEvent, true), { once: true });
      });

      appRoot.addEventListener("pointermove", (event) => {
        if (!pointerSort || event.pointerId !== pointerSort.pointerId) return;
        if (!pointerSort.moved && Math.abs(event.clientY - pointerSort.startY) < 4) return;
        event.preventDefault();
        pointerSort.moved = true;
        const dragged = appRoot.querySelector(`[data-sortable-poi="${pointerSort.poiId}"]`);
        const target = sortableRowAt(event.clientX, event.clientY);
        if (!dragged || !target || dragged === target) return;
        const rect = target.getBoundingClientRect();
        const list = target.closest(".place-list");
        if (!list || dragged.closest(".place-list") !== list) return;
        const targetWrap = target.closest(".place-row-wrap");
        const draggedWrap = dragged.closest(".place-row-wrap");
        if (!targetWrap || !draggedWrap) return;
        list.insertBefore(draggedWrap, event.clientY < rect.top + rect.height / 2 ? targetWrap : targetWrap.nextSibling);
        [...list.querySelectorAll("[data-sortable-poi]")].forEach((row, index) => {
          const order = row.querySelector(".place-order");
          if (order && !order.classList.contains("hotel")) order.textContent = String(index + 1);
        });
      });

      const finishPointerSort = (event, commit) => {
        if (!pointerSort) return;
        pointerSort.handle.releasePointerCapture?.(pointerSort.pointerId);
        appRoot.querySelectorAll(".is-dragging").forEach((node) => node.classList.remove("is-dragging"));
        if (commit && pointerSort.moved && state.view.activeDayId) {
          const orderedPoiIds = [...appRoot.querySelectorAll("#day-place-list [data-sortable-poi]")]
            .map((row) => row.dataset.sortablePoi);
          const hotelCount = (state.orders[state.view.activeDayId] || []).filter((poiId) => pois.get(poiId)?.category === "hotel").length;
          const nextIndex = orderedPoiIds.indexOf(pointerSort.poiId);
          const action = { type: "move-order", poiId: pointerSort.poiId, toIndex: hotelCount + nextIndex };
          pointerSort = null;
          requestAction(action);
          return;
        }
        pointerSort = null;
        renderDayPlaceList(state.view.activeDayId);
      };

      appRoot.addEventListener("pointerup", (event) => finishPointerSort(event, true));
      appRoot.addEventListener("pointercancel", (event) => finishPointerSort(event, false));

      appRoot.addEventListener("click", (event) => {
        const selectCityButton = event.target.closest("[data-select-city]");
        const openDay = event.target.closest("[data-open-day]");
        const selectDayButton = event.target.closest("[data-select-day]");
        const openPlace = event.target.closest("[data-open-place]");
        const moveOrder = event.target.closest("[data-move-order]");
        const actionButton = event.target.closest("[data-action]");
        const segmentButton = event.target.closest("[data-segment-day]");
        const previewButton = event.target.closest("[data-preview-image]");
        if (selectCityButton) return selectCity(selectCityButton.dataset.selectCity);
        if (segmentButton) return selectDay(segmentButton.dataset.segmentDay);
        if (previewButton) {
          const viewer = $("#poi-detail").querySelector("[data-image-viewer]");
          if (viewer) viewer.innerHTML = `<img src="${escapeHtml(previewButton.dataset.previewImage)}" alt="Place image preview">`;
          $("#poi-detail").querySelectorAll("[data-preview-image]").forEach((button) => button.classList.toggle("is-active", button === previewButton));
          return;
        }
        if (openDay) return selectDay(openDay.dataset.openDay);
        if (selectDayButton) return selectDay(selectDayButton.dataset.selectDay);
        if (event.target.closest("[data-return-overview]")) return returnToOverview();
        if (openPlace && !event.target.closest("[data-move-order]")) return openPoiDetail(openPlace.dataset.openPlace);
        if (event.target.closest("[data-close-detail]")) {
          state.view.selectedPoiId = "";
          return renderAll({ preserveMapView: true });
        }
        if (moveOrder) return;
        if (actionButton) {
          const type = actionButton.dataset.action;
          return requestAction({
            type,
            poiId: actionButton.dataset.poiId,
            dayId: actionButton.dataset.dayId,
            priority: actionButton.dataset.priority,
          });
        }
        if (event.target.closest("#clear-filters")) return clearFilters();
      });

      appRoot.addEventListener("input", (event) => {
        if (event.target.matches("[data-filter-field]")) updateFilter(event.target);
      });
      appRoot.addEventListener("change", (event) => {
        if (event.target.matches("#show-candidates-toggle")) {
          state.view.showCandidates = event.target.checked;
          renderAll({ preserveMapView: true });
          return;
        }
        if (event.target.matches("[data-filter-field]")) updateFilter(event.target);
        if (event.target.matches("[data-assign-select]")) {
          const poiId = event.target.dataset.poiId;
          const currentDayId = assignedDayId(poiId);
          const nextDayId = event.target.value;
          if (nextDayId === currentDayId) return;
          requestAction(assignmentAction(poiId, currentDayId, nextDayId));
        }
      });

      $("#cancel-impact").addEventListener("click", cancelImpactDialog);
      $("#confirm-impact").addEventListener("click", () => {
        saveMapEdits();
      });
      $("#close-replan").addEventListener("click", closeReplanDialog);
      $("#copy-replan").addEventListener("click", copyReplanPrompt);
      document.addEventListener("keydown", (event) => {
        if (event.key !== "Escape") return;
        if (!$("#impact-dialog").hidden) cancelImpactDialog();
        else if (!$("#replan-dialog").hidden) closeReplanDialog();
      });
    }

    return {
      renderOverview,
      selectDay,
      openPoiDetail,
      returnToOverview,
      renderDayRail,
      renderDayPlaceList,
      renderPoiDetail,
      renderMapLayers,
      renderFilters,
      renderChangeSummary,
      loadCommonsImages,
      openSaveDialog: openImpactDialog,
      discardMapEdits,
    };
  }

  root.TripMapCore = { mount };
})(typeof globalThis !== "undefined" ? globalThis : window);
