import type { LuggageLevel, TransportPreference } from "@c-assistant/core";
import type { RouteFact, WeatherSnapshot } from "@c-assistant/connectors";
import type { LocalTransportOption, MovementWeatherImpact, RecommendationContext, RecommendedMovementAction } from "./execution-action-card.js";

export interface LocalTransportRecommendationInput {
  routeFacts: RouteFact[];
  preference: TransportPreference;
  localTime: string;
  luggage?: LuggageLevel;
  partySize?: number;
  weather?: WeatherSnapshot;
  riderConfirmedScooter?: boolean;
}

export interface LocalTransportRecommendationResult {
  primary: Omit<RecommendedMovementAction, "handoffs">;
  alternatives: Array<Omit<RecommendedMovementAction, "handoffs">>;
  context: RecommendationContext;
  degradedReasons: string[];
}

export function recommendLocalTransport(input: LocalTransportRecommendationInput): LocalTransportRecommendationResult {
  const degradedReasons: string[] = [];
  const luggageDefaulted = input.luggage === undefined || input.luggage === "unknown";
  const luggage = luggageDefaulted ? "light" : input.luggage!;
  if (luggageDefaulted) degradedReasons.push("unknown_luggage_defaulted_to_light_bag");
  const partySizeDefaulted = input.partySize === undefined;
  const partySize = partySizeDefaulted ? 1 : input.partySize!;
  if (partySizeDefaulted) degradedReasons.push("unknown_party_size_defaulted_to_one");
  const weatherImpact = classifyMovementWeather(input.weather);
  if (!input.weather) degradedReasons.push("weather_unavailable");
  const isNight = isNightLocalTime(input.localTime);
  const drivingRoute = bestRoute(input.routeFacts, "driving");
  const walkingRoute = bestRoute(input.routeFacts, "walking");
  const transitRoute = bestRoute(input.routeFacts, "transit");
  const distanceMeters = drivingRoute?.distanceMeters ?? walkingRoute?.distanceMeters ?? transitRoute?.distanceMeters;
  const durationSeconds = drivingRoute?.durationSeconds ?? walkingRoute?.durationSeconds ?? transitRoute?.durationSeconds;
  if (distanceMeters === undefined) degradedReasons.push("route_distance_unavailable");
  const context: RecommendationContext = {
    ...(distanceMeters !== undefined ? { distanceMeters } : {}),
    ...(durationSeconds !== undefined ? { durationSeconds } : {}),
    weatherImpact,
    localTime: input.localTime,
    isNight,
    luggage,
    luggageDefaulted,
    partySize,
    partySizeDefaulted,
    preference: input.preference
  };

  const walkingFriendly = distanceMeters !== undefined && distanceMeters <= 800;
  const longDistance = distanceMeters !== undefined && distanceMeters > 8_000;
  const badWeather = weatherImpact === "rain" || weatherImpact === "severe" || weatherImpact === "heat";
  const twoWheelAllowed = !isNight && !badWeather && luggage === "light" && partySize === 1 && !luggageDefaulted && !longDistance;

  let primaryOption = "ride_hail_car" as LocalTransportOption;
  const rationaleCodes: string[] = [];
  if (input.preference === "taxi") {
    primaryOption = "ride_hail_car";
    rationaleCodes.push("taxi_preference_maps_to_ride_hail_car");
  } else if (input.preference === "walking") {
    if (walkingFriendly && !badWeather && !isNight) {
      primaryOption = "walking";
      rationaleCodes.push("walking_preference_kept_for_short_daytime_movement");
    } else {
      primaryOption = "ride_hail_car";
      rationaleCodes.push("walking_preference_overridden_by_safety_context");
    }
  } else if (input.preference === "public_transit") {
    primaryOption = "ride_hail_car";
    rationaleCodes.push(transitRoute ? "public_transit_preference_treated_as_weak" : "public_transit_facts_unavailable_use_safer_local_option");
  } else if (walkingFriendly && !badWeather && !isNight) {
    primaryOption = "walking";
    rationaleCodes.push("short_daytime_good_weather_walk");
  } else {
    primaryOption = "ride_hail_car";
    rationaleCodes.push(longDistance ? "plan_recommended_long_distance_car_default" : "plan_recommended_safe_car_default");
  }
  if (isNight) rationaleCodes.push("night_travel_prefers_car");
  if (weatherImpact === "rain") rationaleCodes.push("rain_prefers_car");
  if (weatherImpact === "severe") rationaleCodes.push("severe_weather_prefers_car");
  if (weatherImpact === "heat") rationaleCodes.push("heat_prefers_car");
  if (luggageDefaulted) rationaleCodes.push("unknown_luggage_blocks_two_wheel_primary");

  const actions = new Map<LocalTransportOption, Omit<RecommendedMovementAction, "handoffs">>();
  const add = (option: LocalTransportOption, codes: string[]) => actions.set(option, movementAction(option, input.routeFacts, codes));
  add(primaryOption, rationaleCodes);
  if (primaryOption !== "ride_hail_car") add("ride_hail_car", ["comfortable_fallback_for_current_conditions"]);
  if (primaryOption !== "walking" && walkingFriendly && !isNight && weatherImpact !== "severe") add("walking", [badWeather ? "walking_available_but_weather_is_less_comfortable" : "short_distance_walking_alternative"]);
  if (!actions.has("ride_hail_motorbike") && distanceMeters !== undefined && distanceMeters > 800 && distanceMeters <= 8_000 && !isNight && !badWeather && luggage === "light" && partySize === 1) add("ride_hail_motorbike", [twoWheelAllowed ? "short_or_medium_daytime_no_rain_one_traveler" : "two_wheel_secondary_because_luggage_context_is_conservative"]);
  if (longDistance && !actions.has("private_driver")) add("private_driver", ["long_or_cross_area_alternative"]);
  if (input.riderConfirmedScooter && twoWheelAllowed && !actions.has("scooter_rental")) add("scooter_rental", ["rider_confirmed_scooter_access"]);

  const primary = actions.get(primaryOption)!;
  const alternatives = [...actions.values()].filter((action) => action.option !== primaryOption);
  return { primary, alternatives, context, degradedReasons };
}

export function classifyMovementWeather(weather: WeatherSnapshot | undefined): MovementWeatherImpact {
  if (!weather) return "unknown";
  const text = `${weather.current.condition} ${weather.current.conditionCode}`.toLocaleLowerCase("en-US");
  if (/thunder|storm|typhoon|hurricane|tornado|severe/.test(text)) return "severe";
  if (weather.current.precipitationMm > 0 || /rain|shower|drizzle/.test(text)) return "rain";
  if (weather.current.feelsLikeC >= 32 || weather.current.temperatureC >= 34) return "heat";
  return "clear";
}

export function isNightLocalTime(localTime: string): boolean {
  const match = localTime.match(/^(\d{2}):(\d{2})$/);
  if (!match) return false;
  const hour = Number(match[1]);
  return hour >= 20 || hour < 6;
}

function movementAction(option: LocalTransportOption, routeFacts: RouteFact[], rationaleCodes: string[]): Omit<RecommendedMovementAction, "handoffs"> {
  const routeMode = option === "walking" ? "walking" : "driving";
  const route = bestRoute(routeFacts, routeMode);
  return {
    id: option,
    option,
    title: transportOptionTitle(option),
    routeMode,
    ...(route ? { route } : {}),
    rationaleCodes,
    visibleRationale: visibleRationale(option, rationaleCodes, routeFacts, route)
  };
}

function visibleRationale(option: LocalTransportOption, codes: string[], routeFacts: RouteFact[], route: RouteFact | undefined): string {
  const carComparison = routeComparison(routeFacts, route);
  if (codes.includes("walking_preference_overridden_by_safety_context")) return carComparison ? `${carComparison} That makes the car handoff the clearer option for this stop.` : "Walking looks less suitable right now, so use a car handoff and confirm the pickup details before you go.";
  if (codes.includes("taxi_preference_maps_to_ride_hail_car")) return carComparison ? `${carComparison} Choose the local ride app yourself and confirm the pickup details there.` : "This keeps your taxi-style preference while letting you choose the local ride app yourself.";
  if (codes.includes("public_transit_facts_unavailable_use_safer_local_option")) return carComparison ? `${carComparison} I could not verify a usable transit route, so confirm a local car pickup instead.` : "I could not verify a usable transit route for this stop, so use a local car option and confirm the details in the app.";
  if (codes.includes("public_transit_preference_treated_as_weak")) return carComparison ? `${carComparison} Transit may still work, but check it live before choosing it.` : "Transit may still work, but a car gives you a more direct handoff to confirm now.";
  if (option === "walking") return walkingRationale(route) ?? "This stop is close enough for a short daytime walk. Check the street conditions before you set off.";
  if (option === "ride_hail_motorbike") return carComparison ? `${carComparison} A motorbike may be quicker for this local hop, but choose it only if helmet and luggage fit feel right.` : "A motorbike may be quicker for this local hop. Choose it only if the pickup, helmet, and luggage fit feel right.";
  if (option === "private_driver") return route ? `This is a ${formatRationaleDistance(route.distanceMeters)} move. A private driver can be useful for a longer or cross-area trip; confirm price and pickup directly.` : "A private driver may be useful for a longer or cross-area move. Confirm price and pickup directly.";
  if (option === "scooter_rental") return route ? `This is a ${formatRationaleDistance(route.distanceMeters)} move. Scooter rental is shown because you confirmed you can ride one; check licensing, insurance, and road conditions first.` : "Scooter rental is shown because you confirmed you can ride one. Check licensing, insurance, and road conditions first.";
  return carComparison ? `${carComparison} Use the car handoffs and confirm pickup point, price, and vehicle details before you go.` : "Use a local car handoff for this stop, then confirm pickup point, price, and vehicle details in the app before you go.";
}

function routeComparison(routeFacts: RouteFact[], route: RouteFact | undefined): string | undefined {
  if (!route) return undefined;
  const distance = formatRationaleDistance(route.distanceMeters);
  const carDuration = route.durationSeconds !== undefined ? `about ${formatRationaleDuration(route.durationSeconds)} by car` : "a car route ready";
  const walking = bestRoute(routeFacts, "walking");
  if (walking?.durationSeconds !== undefined) return `For this ${distance} move, Google Maps shows ${carDuration} versus about ${formatRationaleDuration(walking.durationSeconds)} walking.`;
  return `For this ${distance} move, Google Maps has ${carDuration}.`;
}

function walkingRationale(route: RouteFact | undefined): string | undefined {
  if (!route) return undefined;
  const duration = route.durationSeconds !== undefined ? `, about ${formatRationaleDuration(route.durationSeconds)}` : "";
  return `Google Maps shows this as a ${formatRationaleDistance(route.distanceMeters)} walk${duration}. Check the street conditions before you set off.`;
}

function formatRationaleDistance(distanceMeters: number): string {
  return distanceMeters >= 1_000 ? `${(distanceMeters / 1_000).toFixed(1)} km` : `${Math.round(distanceMeters)} m`;
}

function formatRationaleDuration(durationSeconds: number): string {
  return `${Math.max(1, Math.round(durationSeconds / 60))} min`;
}

function transportOptionTitle(option: LocalTransportOption): string {
  if (option === "ride_hail_car") return "Ride-hail car";
  if (option === "ride_hail_motorbike") return "Ride-hail motorbike";
  if (option === "private_driver") return "Private driver";
  if (option === "scooter_rental") return "Scooter rental";
  return "Walk";
}

function bestRoute(routeFacts: RouteFact[], mode: RouteFact["mode"]): RouteFact | undefined {
  return routeFacts.filter((route) => route.mode === mode).sort((left, right) => (left.durationSeconds ?? Number.MAX_SAFE_INTEGER) - (right.durationSeconds ?? Number.MAX_SAFE_INTEGER))[0];
}
