import type { LocalTransportOption } from "./execution-action-card.js";

export interface DestinationExecutionContext {
  country: string;
  city?: string;
  area?: string;
  label?: string;
}

export interface ServiceCatalogEntry {
  id: string;
  serviceName: string;
  options: LocalTransportOption[];
  handoff: "prefill_capable" | "manual";
  countries: string[];
  areas?: string[];
  url?: string;
  instructions: string;
}

export interface ResolvedServiceCapability {
  serviceId: string;
  serviceName: string;
  option: LocalTransportOption;
  handoff: "prefill_capable" | "manual";
  url?: string;
  instructions: string;
}

export const executionServiceCatalog: ServiceCatalogEntry[] = [
  {
    id: "google_maps",
    serviceName: "Google Maps",
    options: ["walking", "ride_hail_car", "ride_hail_motorbike", "private_driver", "scooter_rental"],
    handoff: "prefill_capable",
    countries: ["*"],
    instructions: "Open the prefilled route, then review the live route before moving."
  },
  {
    id: "uber",
    serviceName: "Uber",
    options: ["ride_hail_car"],
    handoff: "prefill_capable",
    countries: ["United States", "Canada", "United Kingdom", "Australia", "Japan"],
    instructions: "Open Uber and review pickup, destination, live fare, vehicle, and payment before requesting."
  },
  {
    id: "grab_bali",
    serviceName: "Grab",
    options: ["ride_hail_car", "ride_hail_motorbike"],
    handoff: "manual",
    countries: ["Indonesia"],
    areas: ["bali", "denpasar", "ubud", "canggu", "seminyak", "kuta", "sanur"],
    url: "https://www.grab.com/id/en/download/",
    instructions: "Tap Open Grab, choose Car, enter the Pickup and Destination shown below, compare ETA and price, then request only after the driver, vehicle, and payment look right."
  },
  {
    id: "gojek_bali",
    serviceName: "Gojek",
    options: ["ride_hail_car", "ride_hail_motorbike"],
    handoff: "manual",
    countries: ["Indonesia"],
    areas: ["bali", "denpasar", "ubud", "canggu", "seminyak", "kuta", "sanur"],
    url: "https://www.gojek.com/en-id/download/",
    instructions: "Tap Open Gojek, choose GoCar for a car, enter the Pickup and Destination shown below, compare ETA and price, then request only after the driver, vehicle, and payment look right."
  },
  {
    id: "bluebird_bali",
    serviceName: "Bluebird",
    options: ["ride_hail_car"],
    handoff: "manual",
    countries: ["Indonesia"],
    areas: ["bali", "denpasar", "ubud", "canggu", "seminyak", "kuta", "sanur"],
    url: "https://www.bluebirdgroup.com/",
    instructions: "Tap Open Bluebird, choose a taxi booking, enter the Pickup and Destination shown below, then confirm fare or meter, vehicle, pickup point, and payment before requesting. If the app is awkward, ask your lodging to call one."
  },
  {
    id: "private_driver_bali",
    serviceName: "Private driver",
    options: ["private_driver"],
    handoff: "manual",
    countries: ["Indonesia"],
    areas: ["bali", "denpasar", "ubud", "canggu", "seminyak", "kuta", "sanur"],
    instructions: "Message or call your lodging, host, or a driver you already trust. Send the Pickup and Destination shown below, then confirm total price, vehicle, pickup time, and payment before agreeing."
  }
];

export function resolveServiceCapabilities(input: { destination: DestinationExecutionContext; option: LocalTransportOption; catalog?: ServiceCatalogEntry[] }): ResolvedServiceCapability[] {
  const catalog = input.catalog ?? executionServiceCatalog;
  return catalog
    .filter((entry) => entry.options.includes(input.option) && destinationMatches(entry, input.destination))
    .map((entry) => ({
      serviceId: entry.id,
      serviceName: entry.serviceName,
      option: input.option,
      handoff: entry.handoff,
      ...(entry.url ? { url: entry.url } : {}),
      instructions: entry.instructions
    }));
}

function destinationMatches(entry: ServiceCatalogEntry, destination: DestinationExecutionContext): boolean {
  const country = normalize(destination.country);
  const countryMatches = entry.countries.some((candidate) => candidate === "*" || normalize(candidate) === country || country.includes(normalize(candidate)));
  if (!countryMatches) return false;
  if (!entry.areas?.length) return true;
  const destinationText = normalize([destination.country, destination.city, destination.area, destination.label].filter(Boolean).join(" "));
  return entry.areas.some((area) => destinationText.includes(normalize(area)));
}

function normalize(value: string): string {
  return value.toLocaleLowerCase("en-US").normalize("NFKD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9]+/g, " ").trim();
}
