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
  coverage?: ServiceCoverageRecord[];
  exclusions?: ServiceExclusionRecord[];
}

export interface ServiceCoverageRecord {
  countries: string[];
  cities: string[];
  sourceUrl: string;
  checkedAt: string;
  expiresAt: string;
}

export interface ServiceExclusionRecord {
  countries: string[];
  cities?: string[];
  sourceUrl: string;
  checkedAt: string;
  expiresAt: string;
  reason: string;
}

const checkedAt = "2026-10-08T00:00:00Z";
const expiresAt = "2027-01-06T00:00:00Z";
const coverage = (countries: string[], cities: string[], sourceUrl: string): ServiceCoverageRecord => ({ countries, cities, sourceUrl, checkedAt, expiresAt });

export interface ResolvedServiceCapability {
  serviceId: string;
  serviceName: string;
  option: LocalTransportOption;
  coverageStatus?: "supported" | "check_in_app";
  evidenceUrl?: string;
  handoff: "prefill_capable" | "manual";
  url?: string;
  instructions: string;
}

export const executionServiceCatalog: ServiceCatalogEntry[] = [
  {
    id: "google_maps",
    serviceName: "Google Maps",
    options: ["public_transit", "driving", "walking", "ride_hail_car", "ride_hail_motorbike", "private_driver", "scooter_rental"],
    handoff: "prefill_capable",
    countries: ["*"],
    instructions: "Open the prefilled route, then review the live route before moving."
  },
  {
    id: "uber",
    serviceName: "Uber",
    options: ["ride_hail_car"],
    handoff: "prefill_capable",
    countries: ["United States", "USA", "US", "美国", "New Zealand", "新西兰", "Portugal", "葡萄牙"],
    exclusions: [{
      countries: ["Indonesia", "印度尼西亚", "印尼", "Singapore", "新加坡", "Malaysia", "马来西亚", "Thailand", "泰国", "Vietnam", "越南", "Philippines", "菲律宾", "Cambodia", "柬埔寨", "Myanmar", "缅甸"],
      sourceUrl: "https://www.uber.com/us/en/blog/uber-sale-to-grab/",
      checkedAt: "2026-10-09T00:00:00Z", expiresAt: "2027-01-07T00:00:00Z",
      reason: "Uber states that Southeast Asian ride requests transitioned to Grab."
    }],
    coverage: [
      coverage(["United States", "USA", "US", "美国"], ["Los Angeles", "洛杉矶", "New York City", "New York", "Chicago", "Boston", "Philadelphia", "Las Vegas", "San Francisco", "Houston", "Miami", "Washington"], "https://www.uber.com/global/en/r/united-states/cities/"),
      coverage(["New Zealand", "新西兰"], ["Auckland", "奥克兰", "Christchurch", "基督城", "Queenstown", "皇后镇", "Wellington", "惠灵顿", "Rotorua", "Dunedin"], "https://www.uber.com/global/en/r/new-zealand/cities/"),
      coverage(["Portugal", "葡萄牙"], ["Lisbon", "里斯本", "Porto", "波尔图"], "https://www.uber.com/global/en/r/portugal/cities/")
    ],
    instructions: "Open Uber and review pickup, destination, live fare, vehicle, and payment before requesting."
  },
  {
    id: "grab_bali",
    serviceName: "Grab",
    options: ["ride_hail_car", "ride_hail_motorbike"],
    handoff: "manual",
    countries: ["Indonesia", "印度尼西亚", "印尼"],
    coverage: [coverage(["Indonesia", "印度尼西亚", "印尼"], ["Bali", "巴厘岛", "Denpasar", "Ubud", "Canggu", "Seminyak", "Kuta", "Sanur"], "https://www.grab.com/id/en/locations/")],
    areas: ["bali", "denpasar", "ubud", "canggu", "seminyak", "kuta", "sanur"],
    url: "https://www.grab.com/id/en/download/",
    instructions: "Tap Open Grab, choose Car, enter the Pickup and Destination shown below, compare ETA and price, then request only after the driver, vehicle, and payment look right."
  },
  {
    id: "grab_cities",
    serviceName: "Grab",
    options: ["ride_hail_car"],
    handoff: "manual",
    countries: ["Indonesia", "Singapore", "Malaysia", "Thailand", "Vietnam", "Philippines", "Cambodia", "Myanmar", "新加坡", "马来西亚", "泰国", "越南", "菲律宾", "柬埔寨", "缅甸"],
    coverage: [
      coverage(["Indonesia"], ["Jakarta", "Surabaya", "Yogyakarta"], "https://www.grab.com/id/en/locations/"),
      coverage(["Singapore", "新加坡"], ["Singapore", "新加坡"], "https://www.grab.com/id/en/locations/"),
      coverage(["Malaysia", "马来西亚"], ["Kuala Lumpur", "吉隆坡", "Johor Bahru", "Langkawi"], "https://www.grab.com/id/en/locations/"),
      coverage(["Thailand", "泰国"], ["Bangkok", "曼谷", "Chiang Mai", "清迈", "Phuket", "普吉岛", "Krabi"], "https://www.grab.com/id/en/locations/"),
      coverage(["Vietnam", "越南"], ["Ha Noi", "Hanoi", "河内", "Ho Chi Minh City", "胡志明市", "Da Nang", "岘港"], "https://www.grab.com/id/en/locations/"),
      coverage(["Philippines", "菲律宾"], ["Manila", "马尼拉", "Cebu", "宿务"], "https://www.grab.com/id/en/locations/"),
      coverage(["Cambodia", "柬埔寨"], ["Phnom Penh", "金边", "Siem Reap", "暹粒"], "https://www.grab.com/id/en/locations/"),
      coverage(["Myanmar", "缅甸"], ["Yangon", "仰光", "Mandalay", "曼德勒"], "https://www.grab.com/id/en/locations/")
    ],
    url: "https://www.grab.com/download/",
    instructions: "Open Grab, select an available car or taxi service, enter the Pickup and Destination shown below, and review the live pickup point, availability and price."
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

export function resolveServiceCapabilities(input: { destination: DestinationExecutionContext; option: LocalTransportOption; catalog?: ServiceCatalogEntry[]; now?: Date }): ResolvedServiceCapability[] {
  const catalog = input.catalog ?? executionServiceCatalog;
  const now = input.now ?? new Date();
  const results: ResolvedServiceCapability[] = [];
  for (const entry of catalog) {
    if (!entry.options.includes(input.option) || !destinationMatches(entry, input.destination) || hasExclusion(entry, input.destination, now)) continue;
    const record = entry.coverage?.find(record => coverageMatches(record, input.destination, now));
    // Missing or expired positive evidence is not evidence of absence. Car apps remain usable entry points.
    if (entry.coverage && !record && input.option !== "ride_hail_car") continue;
    results.push({ serviceId: entry.id, serviceName: entry.serviceName, option: input.option, handoff: entry.handoff,
      ...(entry.coverage ? { coverageStatus: record ? "supported" as const : "check_in_app" as const, ...(record ? { evidenceUrl: record.sourceUrl } : {}) } : {}),
      ...(entry.url ? { url: entry.url } : {}), instructions: entry.instructions });
  }
  // Country lookup failures and uncatalogued countries must not remove all app actions.
  // These are app checks, never claims of operating coverage or live vehicles.
  if (!input.catalog && input.option === "ride_hail_car" && !results.some(service => service.serviceName === "Uber" || service.serviceName === "Grab")) {
    for (const id of ["uber", "grab_cities"]) {
      const entry = catalog.find(candidate => candidate.id === id)!;
      if (hasExclusion(entry, input.destination, now)) continue;
      results.push({ serviceId: entry.id, serviceName: entry.serviceName, option: input.option, handoff: entry.handoff, coverageStatus: "check_in_app", ...(entry.url ? { url: entry.url } : {}), instructions: entry.instructions });
    }
  }
  return results.filter((service, index) => results.findIndex(candidate => candidate.serviceName === service.serviceName) === index);
}

function hasExclusion(entry: ServiceCatalogEntry, context: DestinationExecutionContext, now: Date): boolean {
  return Boolean(entry.exclusions?.some(record => {
    // Only explicit, fresh first-party negative evidence may suppress a provider.
    let source: URL;
    try { source = new URL(record.sourceUrl); } catch { return false; }
    const official = entry.serviceName === "Uber" ? "uber.com" : entry.serviceName === "Grab" ? "grab.com" : "";
    return Boolean(official) && source.protocol === "https:" && (source.hostname === official || source.hostname.endsWith(`.${official}`)) && Boolean(record.reason.trim())
      && now.getTime() >= Date.parse(record.checkedAt) && now.getTime() < Date.parse(record.expiresAt)
      && record.countries.some(country => normalize(context.country) === normalize(country))
      && (!record.cities?.length || record.cities.some(city => normalize(context.city ?? "") === normalize(city)));
  }));
}

function destinationMatches(entry: ServiceCatalogEntry, destination: DestinationExecutionContext): boolean {
  const country = normalize(destination.country);
  const countryMatches = entry.countries.some((candidate) => candidate === "*" || containsPhrase(country, normalize(candidate)));
  if (!countryMatches) return false;
  if (!entry.areas?.length) return true;
  const destinationText = normalize([destination.country, destination.city, destination.area, destination.label].filter(Boolean).join(" "));
  return entry.areas.some((area) => containsPhrase(destinationText, normalize(area)));
}

function coverageMatches(record: ServiceCoverageRecord, destination: DestinationExecutionContext, now: Date): boolean {
  const time = now.getTime();
  if (!record.sourceUrl || !Number.isFinite(time) || !(time >= Date.parse(record.checkedAt) && time < Date.parse(record.expiresAt))) return false;
  if (!record.countries.some(country => containsPhrase(normalize(destination.country), normalize(country)))) return false;
  // Match this stop's city, never another city mentioned in the overall Plan.
  const city = normalize(destination.city ?? "");
  return Boolean(city) && record.cities.some(candidate => containsPhrase(city, normalize(candidate)));
}

function containsPhrase(text: string, phrase: string): boolean {
  return Boolean(phrase) && (` ${text} `).includes(` ${phrase} `);
}

function normalize(value: string): string {
  return value.toLocaleLowerCase("en-US").normalize("NFKD").replace(/[\u0300-\u036f]/g, "").replace(/[^\p{L}\p{N}]+/gu, " ").trim();
}
