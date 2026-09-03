export interface ActivePlanMonitoringService {
  runArrivalLocationPrompt(): Promise<void>;
  runArrivalReminder(): Promise<void>;
  runItineraryDepartureReminders(): Promise<void>;
  runPlanVenueMonitor(): Promise<void>;
  runPlanWeatherMonitor(): Promise<void>;
  runRouteHandoffGuidance(): Promise<void>;
  runTaskReminders(): Promise<void>;
  startActivePlanMonitoring(): void;
}
