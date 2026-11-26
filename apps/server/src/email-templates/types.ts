export type EmailKind = "morning" | "transfer" | "dining" | "change";
export interface EmailImage { url: string; alt: string }
export interface EmailLink { label: string; url: string; accessibleLabel?: string }
export interface EmailRideAction { provider: "uber" | "grab"; link: EmailLink; destination: string; note: string }
export interface EmailContext {
  subject: string;
  preheader: string;
  brandLabel: string;
  footer: string;
  disclosure: string;
  sample: boolean;
}
export interface PlannedTime { label: string; kind: "planned" | "flexible" | "confirmed" }
export interface MorningEmailData extends EmailContext {
  hero?: EmailImage;
  date: string;
  day: string;
  title: string;
  introduction: string;
  poeticLine?: string;
  summary: Array<{ value: string; label: string }>;
  weather: { title: string; text: string; link: EmailLink };
  itinerary: Array<{ time: PlannedTime; title: string; detail: string; reminder?: string; iconKind?: import("./icons.js").ItineraryIconKind }>;
  places: Array<{ image?: EmailImage; kicker: string; name: string; description: string; link?: EmailLink; ride?: EmailRideAction }>;
  routes: Array<{ title: string; description: string; link: EmailLink }>;
  preparation: string;
  booking: string;
  links: EmailLink[];
}
export interface TransferEmailData extends EmailContext {
  hero?: EmailImage;
  plannedTime: string;
  title: string;
  introduction: string;
  origin: string;
  destination: string;
  mode: string;
  estimatedDistance: string;
  estimatedDuration: string;
  estimatedArrival?: string;
  scheduledArrival?: string;
  lateMinutes?: number;
  supportLinks?: { about?: EmailLink; weather?: EmailLink; transport?: EmailLink };
  ride?: EmailRideAction;
  routeLink: EmailLink;
  estimateNote: string;
  nearby: string;
  reminder: string;
  links: EmailLink[];
}
export interface DiningEmailData extends EmailContext {
  hero?: EmailImage;
  fallbackLinks?: EmailLink[];
  title: string;
  introduction: string;
  plannedTime: string;
  plannedOrigin: string;
  restaurants: Array<{
    image?: EmailImage; name: string; cuisine: string; price: string;
    description: string; dishes: string; priceNote: string;
    distanceMeters?: number;
    estimatedDurationMinutes?: number;
    topPick?: boolean;
    transport: string; links: EmailLink[]; ride?: EmailRideAction;
  }>;
  reminder: string;
}
export type ChangeStatus =
  | { kind: "proposed"; explanation: string }
  | { kind: "confirmed"; confirmedAt: string; explanation: string }
  | { kind: "applied"; appliedAt: string; explanation: string };
/** Explicit event projection; verification state is independent of Plan approval. */
export interface ImportantUpdateData {
  kind: "attraction_closure" | "weather_impact" | "transport_disruption" | "reservation_change" | "arrival_conflict" | "opening_hours_change";
  city: string;
  tripDate: string;
  verification: { kind: "confirmed" | "forecast" | "estimated"; sourceName: string; sourceUrl?: string; checkedAt: string };
  evaluatedAt: string;
  tag: string;
  before: { label: string; value: string };
  after: { label: string; value: string };
  delta?: string;
  action?: EmailLink & { expiresAt?: string };
  /** Inert label for isolated visual fixtures only, never a production action. */
  previewActionLabel?: string;
  route?: { date: string; departure: string; durationMinutes: number; departureZone: string; destinationZone: string; scheduledStart: string };
}
export interface ChangeEmailData extends EmailContext {
  visualKind?: ImportantUpdateData['kind'];
  update?: ImportantUpdateData;
  hero?: EmailImage;
  title: string;
  introduction: string;
  impact: string;
  options: Array<{ title: string; description: string; requiresConfirmation: boolean }>;
  status: ChangeStatus;
  ride?: EmailRideAction;
  links: EmailLink[];
  note: string;
}
export type RenderedEmail = import("@c-assistant/storage").EmailDeliveryContent;
