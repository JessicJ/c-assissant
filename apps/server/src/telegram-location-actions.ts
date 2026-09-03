import { createUberRideHandoff, type PlaceFact, type RouteFact } from "@c-assistant/connectors";
import { runFoodNearbySkill } from "@c-assistant/china-country-pack";
import { resolveCurrentPlanDestination, type Plan } from "@c-assistant/core";
import type { SqliteWorkspaceStore } from "@c-assistant/storage";
import { arrivalRouteDestination, formatArrivalRoute, selectArrivalTransport } from "./arrival-route.js";
import type { ConnectorBundle } from "./connector-bundle.js";
import { createMovementActionCard } from "./movement-action-card.js";
import { DEFAULT_HANDOFF_SAFETY_SECONDS, DEFAULT_HANDOFF_WAIT_SECONDS, expectedArrivalAt } from "./route-handoff.js";
import { formatTelegramNearbyFood } from "./telegram-food.js";
import { formatTelegramMovementActionCard, formatTelegramMovementLocationRequest } from "./telegram-movement-card.js";
import type { TelegramLocationActions } from "./telegram-location-actions-contract.js";

type SharedLocation = { latitude: number; longitude: number };
type TransportOverride = "taxi" | "public_transit" | "walking";

export function createTelegramLocationActions(dependencies: {
  store: SqliteWorkspaceStore;
  getConnectors: () => Pick<ConnectorBundle, "maps" | "googleWeather" | "telegram">;
  uberClientId: () => string | undefined;
  logWarning: (details: Record<string, unknown>, message: string) => void;
}): TelegramLocationActions {
  const { store, getConnectors, uberClientId, logWarning } = dependencies;
  const movementGoLocationSessions = new Map<string, { planVersion: number; stopId: string; confirmedStale: boolean }>();
  let requestingArrivalLocation = false;
  let requestingFoodLocation = false;
  let requestingMovementGoLocation = false;

  function rememberMovementGoLocationSession(planId: string, session: { planVersion: number; stopId: string; confirmedStale: boolean }): void {
    movementGoLocationSessions.set(planId, session);
  }

  async function sendMovementGoFromSharedLocation(chatId: string, location: SharedLocation, planId: string): Promise<void> {
    const { maps, googleWeather, telegram } = getConnectors();
    const plan = store.getExecutionPlan();
    const session = movementGoLocationSessions.get(planId);
    movementGoLocationSessions.delete(planId);
    if (!plan || plan.id !== planId || plan.status !== "active") {
      await telegram.sendMessage({ chatId, text: "Location received, but there is no current Execution Plan for /go. No location was saved." });
      return;
    }
    const card = await createMovementActionCard({
      plan,
      currentLocation: location,
      maps: {
        convertGpsCoordinate: (input) => maps.convertGpsCoordinate(input),
        drivingRoute: (input) => maps.drivingRoute(input),
        walkingRoute: (input) => maps.walkingRoute(input),
        transitRoute: (input) => maps.transitRoute(input),
        reverseGeocode: (input) => maps.reverseGeocode(input)
      },
      weather: { weather: (input) => googleWeather.weather(input) },
      ...(session?.planVersion === plan.version && session.confirmedStale ? { confirmedStaleStopId: session.stopId } : {})
    });
    await telegram.sendMessage({ chatId, ...formatTelegramMovementActionCard(card) });
  }

  async function requestArrivalLocation(chatId: string, intro: string, allowRepeat = false): Promise<void> {
    if (requestingArrivalLocation) return;
    const { telegram } = getConnectors();
    const planId = store.getExecutionPlan()?.id;
    if (!planId) return;
    const existing = store.getTelegramArrivalCheckin(planId);
    const activeIntent = store.getTelegramLocationIntent();
    if ((!allowRepeat && existing?.locationReceivedAt) || (activeIntent?.purpose === "arrival_route" && activeIntent.planId === planId)) return;
    requestingArrivalLocation = true;
    try {
      const receipt = await telegram.sendMessage({ chatId, text: `${intro} Landi will use it only for this interaction and will not save it to your Profile.`, replyMarkup: { keyboard: [[{ text: "Share current location", request_location: true }]], resize_keyboard: true, one_time_keyboard: true } });
      if (receipt.status === "available") {
        store.markTelegramArrivalLocationRequested(planId, new Date().toISOString());
        store.startTelegramLocationIntent({ purpose: "arrival_route", planId });
      }
      else logWarning({ status: receipt.status, code: receipt.failure?.code }, "Telegram arrival location request could not be delivered");
    } finally {
      requestingArrivalLocation = false;
    }
  }

  async function requestFoodLocation(chatId: string): Promise<void> {
    if (requestingFoodLocation) return;
    const { telegram } = getConnectors();
    requestingFoodLocation = true;
    const workspace = store.getWorkspace();
    const planId = (store.getExecutionPlan() ?? workspace.activePlan).id;
    try {
      const receipt = await telegram.sendMessage({
        chatId,
        text: "Tap below to share your current location for this nearby food check. It will be used once, expires after 15 minutes, and will not be saved to your Profile or database.",
        replyMarkup: { keyboard: [[{ text: "Share current location", request_location: true }]], resize_keyboard: true, one_time_keyboard: true }
      });
      if (receipt.status === "available") store.startTelegramLocationIntent({ purpose: "nearby_food", planId });
      else logWarning({ status: receipt.status, code: receipt.failure?.code }, "Telegram food location request could not be delivered");
    } finally {
      requestingFoodLocation = false;
    }
  }

  async function requestMovementGoLocation(chatId: string, planId: string, stopName: string): Promise<void> {
    if (requestingMovementGoLocation) return;
    const { telegram } = getConnectors();
    requestingMovementGoLocation = true;
    try {
      const reply = formatTelegramMovementLocationRequest(stopName);
      const receipt = await telegram.sendMessage({ chatId, ...reply });
      if (receipt.status === "available") store.startTelegramLocationIntent({ purpose: "movement_go", planId });
      else logWarning({ status: receipt.status, code: receipt.failure?.code }, "Telegram /go location request could not be delivered");
    } finally {
      requestingMovementGoLocation = false;
    }
  }

  async function sendArrivalRouteFromSharedLocation(chatId: string, location: SharedLocation, planId: string, transportOverride?: TransportOverride): Promise<void> {
    const { maps, telegram } = getConnectors();
    const workspace = store.getWorkspace();
    const plan = workspace.activePlan.id === planId ? workspace.activePlan : store.getExecutionPlan();
    if (!plan || plan.id !== planId) return;
    store.markTelegramArrivalLocationReceived(plan.id, new Date().toISOString());
    const destination = arrivalRouteDestination(plan);
    if (!destination) {
      await telegram.sendMessage({ chatId, text: "Location received for this interaction, but this Plan does not yet contain a specific accommodation or destination. Add the hotel or destination in the Web workspace, then request route help again. The shared coordinates were not saved to your Profile or database." });
      return;
    }
    const gpsLocation = `${location.longitude},${location.latitude}`;
    const converted = await maps.convertGpsCoordinate({ location: gpsLocation });
    if (converted.status !== "available" || !converted.data) {
      await telegram.sendMessage({ chatId, text: "Location received, but Google Maps could not prepare a route from it right now. No location has been saved." });
      return;
    }
    const origin: PlaceFact = { provider: "google_maps", id: "", name: "Shared current location", address: "", location: converted.data.location, type: "Temporary location", city: "", district: "" };
    const routeFacts: RouteFact[] = [];
    const preference = transportOverride ?? plan.configuration.transport.preference;
    if (preference === "taxi") {
      const route = await maps.drivingRoute({ origin: origin.location, destination: destination.location, destinationId: destination.id || undefined });
      if (route.status === "available" && route.data) routeFacts.push(route.data);
    } else if (preference === "walking") {
      const route = await maps.walkingRoute({ origin: origin.location, destination: destination.location, destinationId: destination.id || undefined });
      if (route.status === "available" && route.data) routeFacts.push(route.data);
    } else if (preference === "public_transit") {
      const route = await arrivalTransitRoute(origin, destination);
      if (route) routeFacts.push(route);
    } else if (preference === "plan_recommended") {
      const [driving, walking, transit] = await Promise.all([
        maps.drivingRoute({ origin: origin.location, destination: destination.location, destinationId: destination.id || undefined }),
        maps.walkingRoute({ origin: origin.location, destination: destination.location, destinationId: destination.id || undefined }),
        arrivalTransitRoute(origin, destination)
      ]);
      if (driving.status === "available" && driving.data) routeFacts.push(driving.data);
      if (walking.status === "available" && walking.data) routeFacts.push(walking.data);
      if (transit) routeFacts.push(transit);
    }
    const transport = selectArrivalTransport(plan, routeFacts, transportOverride);
    const selectedRoute = routeFacts.find((route) => route.mode === transport);
    const result = formatArrivalRoute({
      origin,
      destination,
      transport,
      taxiRequested: preference === "taxi",
      ...(preference === "taxi" ? { uberPickup: location, uberClientId: uberClientId() } : {}),
      ...(selectedRoute ? { route: selectedRoute } : {})
    });
    const receipt = await telegram.sendMessage({ chatId, text: result.text, replyMarkup: { inline_keyboard: [[{ text: result.handoffLabel, url: result.handoffUrl }]] } });
    if (receipt.status === "available" && selectedRoute?.durationSeconds !== undefined) {
      const offeredAt = receipt.observedAt;
      store.recordTelegramRouteHandoffOffered({
        planId: plan.id,
        offeredAt,
        routeDurationSeconds: selectedRoute.durationSeconds,
        waitBufferSeconds: DEFAULT_HANDOFF_WAIT_SECONDS,
        safetyMarginSeconds: DEFAULT_HANDOFF_SAFETY_SECONDS,
        expectedArrivalAt: expectedArrivalAt({ basisAt: offeredAt, routeDurationSeconds: selectedRoute.durationSeconds })
      });
    }
  }

  async function sendUberTestFromSharedLocation(chatId: string, location: SharedLocation, planId: string): Promise<void> {
    const { telegram } = getConnectors();
    const workspace = store.getWorkspace();
    const plan = workspace.activePlan.id === planId ? workspace.activePlan : store.getExecutionPlan();
    if (!plan || plan.id !== planId) return;
    await telegram.sendMessage({ chatId, ...formatUberTestReply(store, plan, location, uberClientId()) });
  }

  async function sendNearbyFoodFromSharedLocation(chatId: string, location: SharedLocation, planId: string): Promise<void> {
    const { maps, telegram } = getConnectors();
    const workspace = store.getWorkspace();
    const plan = workspace.activePlan.id === planId ? workspace.activePlan : store.getExecutionPlan();
    if (!plan || plan.id !== planId) return;
    const partySize = plan.configuration.travelContext.partySize;
    if (!partySize) {
      await telegram.sendMessage({ chatId, text: "Party size is missing from this Plan. The shared coordinates were not used or saved. Send /food followed by the number of people, for example /food 2." });
      return;
    }
    const converted = await maps.convertGpsCoordinate({ location: `${location.longitude},${location.latitude}` });
    if (converted.status !== "available" || !converted.data) {
      await telegram.sendMessage({ chatId, text: "Location received, but Google Maps could not use it for nearby discovery right now. No location was saved and no restaurant facts were guessed." });
      return;
    }
    const result = await maps.nearbyRestaurants({ location: converted.data.location, limit: 8 });
    if (result.status !== "available" || !result.data) {
      await telegram.sendMessage({ chatId, text: `Google Maps could not return nearby food right now. ${result.failure?.message ?? "The provider is unavailable."}\n\nNo location was saved, and no candidate, order, reservation, or payment was created.` });
      return;
    }
    const skillResult = runFoodNearbySkill({ partySize, candidates: result.data, observedAt: result.observedAt, provider: "google_maps" });
    await telegram.sendMessage({ chatId, ...formatTelegramNearbyFood({ result: skillResult, places: result.data, partySize }) });
  }

  async function arrivalTransitRoute(origin: PlaceFact, destination: PlaceFact): Promise<RouteFact | undefined> {
    const { maps } = getConnectors();
    const [originArea, destinationArea] = await Promise.all([
      maps.reverseGeocode({ location: origin.location }),
      maps.reverseGeocode({ location: destination.location })
    ]);
    if (originArea.status !== "available" || !originArea.data || destinationArea.status !== "available" || !destinationArea.data) return undefined;
    const route = await maps.transitRoute({
      origin: origin.location,
      destination: destination.location,
      originCityCode: originArea.data.cityCode,
      destinationCityCode: destinationArea.data.cityCode
    });
    return route.status === "available" && route.data ? route.data : undefined;
  }

  return {
    rememberMovementGoLocationSession,
    requestArrivalLocation,
    requestFoodLocation,
    requestMovementGoLocation,
    sendArrivalRouteFromSharedLocation,
    sendMovementGoFromSharedLocation,
    sendNearbyFoodFromSharedLocation,
    sendUberTestFromSharedLocation
  };
}

function formatUberTestReply(store: SqliteWorkspaceStore, plan: Plan, location: SharedLocation, uberClientId: string | undefined) {
  const accommodation = plan.configuration.accommodation;
  const destination = accommodation.name && accommodation.address
    ? { name: accommodation.name, address: accommodation.address }
    : { name: currentPlanDestination(store, plan), address: plan.location };
  const handoff = createUberRideHandoff({
    pickup: location,
    destination,
    ...(uberClientId ? { clientId: uberClientId } : {})
  });
  return {
    text: `Uber test ready\nPickup: one-time test location\nDropoff: ${destination.name}\n\nTap Open Uber to check whether Uber can resolve the route, show nearby vehicles, estimate fare, and use your payment method. Landi has not requested a ride, made a booking, or started payment.`,
    replyMarkup: { inline_keyboard: [[{ text: "Open Uber", url: handoff.url }]] }
  };
}

function currentPlanDestination(store: SqliteWorkspaceStore, plan: Plan): string {
  if (!plan.presentation || plan.presentation.kind !== "itinerary") return plan.location;
  return resolveCurrentPlanDestination(plan.presentation, { arrivals: store.listPlanDestinationArrivals(plan.id) })?.city ?? plan.location;
}
