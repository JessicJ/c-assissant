import type { LuggageLevel, TransportPreference } from "@c-assistant/core";
import type { RouteFact } from "@c-assistant/connectors";

export type ExecutionActionCardKind = "movement" | "nearby_food" | "weather_impact";
export type LocalTransportOption = "walking" | "ride_hail_car" | "ride_hail_motorbike" | "private_driver" | "scooter_rental";
export type ExecutionHandoffKind = "map_link" | "prefill_capable" | "manual" | "copy";
export type MovementWeatherImpact = "clear" | "rain" | "severe" | "heat" | "unknown";

export interface RecommendationContext {
  distanceMeters?: number;
  durationSeconds?: number;
  weatherImpact: MovementWeatherImpact;
  localTime: string;
  isNight: boolean;
  luggage: LuggageLevel;
  luggageDefaulted: boolean;
  partySize: number;
  partySizeDefaulted: boolean;
  preference: TransportPreference;
}

export interface ExecutionHandoff {
  id: string;
  kind: ExecutionHandoffKind;
  label: string;
  url?: string;
  serviceName?: string;
  copyText?: string;
  instructions?: string;
}

export interface RecommendedMovementAction {
  id: LocalTransportOption;
  option: LocalTransportOption;
  title: string;
  routeMode: RouteFact["mode"];
  route?: RouteFact;
  handoffs: ExecutionHandoff[];
  rationaleCodes: string[];
  visibleRationale: string;
  externalActionReminder?: string;
}

export interface MovementActionCard {
  kind: "movement";
  status: "ready" | "degraded" | "blocked";
  planId: string;
  planVersion: number;
  stopId?: string;
  stopName?: string;
  originName?: string;
  destinationName?: string;
  destinationAddress?: string;
  primaryRecommendation?: RecommendedMovementAction;
  alternatives: RecommendedMovementAction[];
  recommendationContext?: RecommendationContext;
  degradedReasons: string[];
  blockingReasons: string[];
  recoveryMessage?: string;
}
