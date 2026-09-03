type SharedLocation = { latitude: number; longitude: number };
type TransportOverride = "taxi" | "public_transit" | "walking";

export interface TelegramLocationActions {
  rememberMovementGoLocationSession(planId: string, session: { planVersion: number; stopId: string; confirmedStale: boolean }): void;
  requestArrivalLocation(chatId: string, intro: string, allowRepeat?: boolean): Promise<void>;
  requestFoodLocation(chatId: string): Promise<void>;
  requestMovementGoLocation(chatId: string, planId: string, stopName: string): Promise<void>;
  sendArrivalRouteFromSharedLocation(chatId: string, location: SharedLocation, planId: string, transportOverride?: TransportOverride): Promise<void>;
  sendMovementGoFromSharedLocation(chatId: string, location: SharedLocation, planId: string): Promise<void>;
  sendNearbyFoodFromSharedLocation(chatId: string, location: SharedLocation, planId: string): Promise<void>;
  sendUberTestFromSharedLocation(chatId: string, location: SharedLocation, planId: string): Promise<void>;
}
