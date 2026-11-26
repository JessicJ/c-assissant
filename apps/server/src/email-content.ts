import { transferTiming } from "./email-transfer-timing.js";
import { parseEmailResearch, type EmailResearchRequest, type EmailResearchResult } from "@c-assistant/agent-adapters";
import { bookingRelationshipReviewContext, bookingRelationshipDigest, blueprintBookingConstraintsFromTravelBookings, type Plan, type PlanPlace, type TripBlueprint } from "@c-assistant/core";
import type { EmailJob, SqliteWorkspaceStore } from "@c-assistant/storage";
import type { NearbyPlaceFact } from "@c-assistant/connectors";
import type { ConnectorBundle } from "./connector-bundle.js";
import { executionToken, compileExecutionItinerary } from "./execution-itinerary.js";
import { renderMorningEmail, renderTransferEmail, renderDiningEmail } from "./email-templates/index.js";
import type { EmailContext, EmailImage, EmailLink, RenderedEmail, DiningEmailData } from "./email-templates/types.js";
import { createEmailRideBuilder } from "./email-ride.js";
import { probeEmailPhoto } from "./email-photo.js";
import { restaurantMenu } from "./restaurant-menu.js";

const brief = (value: string | undefined, fallback = "", limit = 180): string => {
  if (!value || /\p{Script=Han}/u.test(value)) return fallback;
  const sentence = value.replace(/\s+/g, " ").trim().split(/(?<=[.!?])\s+/)[0] ?? fallback;
  return sentence.length <= limit ? sentence : sentence.slice(0, limit - 1).replace(/\s+\S*$/, "") + "…";
};
const placeLabel = (value: string | undefined, fallback = "Destination") => value?.replace(/\s+/g, " ").trim() || fallback;
const safeHttps = (value?: string): string | undefined => { try { const url = new URL(value ?? ""); return url.protocol === "https:" && url.hostname.includes(".") && !url.hostname.endsWith(".local") && !/^(?:\d+\.){3}\d+$/.test(url.hostname) && !url.hostname.startsWith("[") && !url.username && !url.password && !url.searchParams.has("key") && !url.searchParams.has("api_key") ? url.href : undefined; } catch { return; } };
const placeImage = (place?: PlanPlace): EmailImage | undefined => {
  const candidate = place?.images?.find(image => safeHttps(image.url) && image.status !== "stale");
  return candidate ? { url: candidate.url, alt: placeLabel(candidate.alt || place!.name, "Destination photograph") } : undefined;
};
const mapLink = (destination: string, origin?: string, mode = "walking"): string => {
  const values = new URLSearchParams({ api: "1", destination, travelmode: mode }); if (origin) values.set("origin", origin);
  return `https://www.google.com/maps/dir/?${values}`;
};
const modeFor = (plan: Plan): "driving" | "walking" | "transit" => plan.configuration.transport.preference === "driving" || plan.configuration.transport.preference === "taxi" ? "driving" : plan.configuration.transport.preference === "public_transit" ? "transit" : "walking";
const modeLabel = { driving: "Driving", walking: "Walking", transit: "Public transport" };
const context = (subject: string, label: string): EmailContext => ({ subject, preheader: subject, brandLabel: label, footer: "Landi · Your travel companion", disclosure: "Based on your itinerary; your actual location is not tracked.", sample: false });

export function createEmailContentBuilder(dependencies: { store: SqliteWorkspaceStore; getConnectors: () => Pick<ConnectorBundle, "maps" | "googleWeather">; now?: () => Date; timeZoneForCity?: (city:string) => string | undefined; rideClientId?: () => string | undefined; probeImage?: (url: string, signal?: AbortSignal) => Promise<boolean | undefined>; research?: (input: EmailResearchRequest) => Promise<EmailResearchResult> }) {
  return async (plan: Plan, job: EmailJob, signal?: AbortSignal): Promise<RenderedEmail> => {
    const activities = compileExecutionItinerary(plan).activities;
    const day = plan.presentation?.days.find(day => day.date === job.date);
    if (!day) throw new Error("Email day is not in this Plan.");
    const forDay = activities.filter(activity => activity.dayId === day.id);
    const places = new Map(plan.presentation?.places.map(place => [place.id, place]));
    const activity = forDay.find(activity => activity.id === job.activityId);
    const index = activity ? forDay.indexOf(activity) : -1;
    const prior = (index > 0 ? forDay.slice(0, index) : []).reverse().find(activity => activity.placeId);
    const origin = places.get(prior?.placeId ?? day.startContext?.placeId ?? "");
    const destination = places.get(activity?.placeId ?? "");
    const mode = modeFor(plan);
    const city = day.city ?? destination?.city ?? plan.location;
    const displayCity = placeLabel(city, "Your destination");
    const connectors = dependencies.getConnectors();
    const rideFor=createEmailRideBuilder({maps:connectors.maps,clientId:dependencies.rideClientId?.() ?? process.env.UBER_CLIENT_ID,now:dependencies.now?.() ?? new Date(),...(signal?{signal}:{})});
    const publicLinks = (place?: PlanPlace): EmailLink[] => {
      const url = safeHttps(place?.officialUrl);
      return url ? [{ label: placeLabel(place?.name, "Official website"), url }] : [];
    };
    const researchFor = async (targets: EmailResearchRequest["places"]): Promise<EmailResearchResult | undefined> => {
      if (!dependencies.research || (!targets.length && job.kind !== "morning") || signal?.aborted) return;
      const request: EmailResearchRequest = { schedule: (job.kind === "morning" ? forDay : activity ? [activity] : []).map(item => ({title:item.title,time:item.time ?? "",kind:item.timeStatus === "confirmed" ? "confirmed" : item.time ? "planned" : "flexible", detail:item.preparation.join(" ")})), kind: job.kind, date: job.date, city, ...(origin ? { plannedOrigin: origin.name } : {}), places: targets, constraints: ["Preserve all planned times and confirmed booking facts", "Do not claim actual position or completion", ...(job.kind === "transfer" ? ["Write introduction as a destination-specific travel phrase under 90 characters using sourced facts; omit generic openings and route repetition."] : []), ...(job.kind === "dining" ? ["Keep the introduction under 80 characters and each restaurant note under 90 characters: one distinct, sourced dining feature; omit repeated location, map, opening-hour and booking boilerplate."] : [])], language: "en", now: (dependencies.now?.() ?? new Date()).toISOString(), ...(signal ? { signal } : {}) };
      try { return parseEmailResearch(JSON.stringify(await dependencies.research(request)), request); } catch { return; }
    };
    const sourceLinks = (research?: EmailResearchResult): EmailLink[] => research?.sources.map(source => ({ label: brief(source.title, new URL(source.url).hostname, 45), url: source.url })) ?? [];
    const target = (place: PlanPlace): EmailResearchRequest["places"][number] => ({ id: place.id, name: place.name, city: place.city ?? city, savedDescription: place.whyWorthIt, ...(safeHttps(place.officialUrl) ? { officialUrl: place.officialUrl } : {}) });
    const finish = (rendered: RenderedEmail, research?: EmailResearchResult): RenderedEmail => ({...rendered, research: {status: research?.sources.length ? "generated" : "saved_facts", sources: research?.sources ?? [], notes: research?.notes ?? [], ...(research?.images?.length ? {images:research.images} : {})}});
    const described = (place: PlanPlace, research?: EmailResearchResult) => brief(research?.notes.find(note => note.targetId === place.id)?.text || place.whyWorthIt, "Check the official visitor information before you go.");
    if (job.kind === "morning") {
      const scheduledPlaces = [...new Set(forDay.flatMap(activity => activity.placeId ? [activity.placeId] : []))].map(id => places.get(id)).filter((place): place is PlanPlace => Boolean(place));
      const research = await researchFor(scheduledPlaces.map(target));
      const daysAway = (Date.parse(job.date + "T12:00:00Z") - (dependencies.now?.() ?? new Date()).getTime()) / 86_400_000;
      let forecast = daysAway > 10 ? "Check the local forecast closer to your travel date." : "The forecast could not be verified; check the local weather service.";
      if (research?.weather?.status === "forecast" || research?.weather?.status === "outside_forecast_window") forecast = brief(research.weather.summary, forecast);
      let forecastUrl = `https://www.google.com/search?q=${encodeURIComponent(`${city} weather`)}`;
      const anchor = scheduledPlaces.find(place => place.coordinates);
      if (anchor?.coordinates && daysAway <= 3 && daysAway >= -1) {
        try {
          const result = await connectors.googleWeather.weather({ coordinates: `${anchor.coordinates[1]},${anchor.coordinates[0]}`, locationName: city });
          const daily = result.data?.daily.find(daily => daily.date === job.date);
          const age = (dependencies.now?.() ?? new Date()).getTime() - Date.parse(result.observedAt);
          if (result.status === "available" && daily && Number.isFinite(age) && age >= -300000 && age <= 90*60000) forecast = `${brief(daily.conditionDay, "Weather")} · ${daily.lowC}–${daily.highC}°C.`;
          forecastUrl = safeHttps(result.data?.attributionUrl) ?? forecastUrl;
        } catch { /* Missing forecast does not invent weather or block a handbook. */ }
      }
      const approvedBookings = dependencies.store.listApprovedBookingConstraintsForPlan(plan.id);
      const currentBookingSources = dependencies.store.listCurrentTravelBookingSourcesForPlan(plan.id);
      const units = (bookingConstraints: typeof approvedBookings) => bookingRelationshipReviewContext({bookingConstraints,places:[],days:[],movements:[]} as unknown as TripBlueprint).units;
      const sourcesChanged = bookingRelationshipDigest(units(approvedBookings)) !== bookingRelationshipDigest(units(blueprintBookingConstraintsFromTravelBookings(currentBookingSources)));
      const bookings = approvedBookings.filter(booking => booking.status === "confirmed" && booking.constraintStrength !== "ignored" && booking.segments.some(segment => segment.status !== "cancelled" && segment.constraintStrength !== "ignored" && segment.startAtLocal?.startsWith(job.date)));
      forecastUrl = research?.weather?.sourceUrls[0] ?? forecastUrl;
      const hero = placeImage(scheduledPlaces[0]);
      const dayModes = [...new Set((plan.presentation?.routeSegments ?? []).filter(route => route.dayId === day.id).map(route => route.mode))];
      const travelSummary = dayModes.length > 1 ? "Mixed transport" : dayModes[0] === "driving" ? "Driving" : dayModes[0] === "transit" ? "Public transport" : dayModes[0] === "walking" ? "Walking" : modeLabel[mode];
      const rides=new Map<string, Awaited<ReturnType<typeof rideFor>>>();
      await Promise.all(scheduledPlaces.map(async place=>{
        const at=forDay.findIndex(item=>item.placeId===place.id);
        const previous=forDay.slice(0,at).reverse().find(item=>item.placeId);
        const pickup=places.get(previous?.placeId ?? day.startContext?.placeId ?? "");
        if(pickup?.id!==place.id)rides.set(place.id,await rideFor(pickup,{name:placeLabel(place.name),address:placeLabel(place.locationLabel,displayCity),city:place.city??city}));
      }));
      const rendered = renderMorningEmail({ ...context(`${displayCity} · ${job.date} travel handbook`, "YOUR PERSONAL\nTRAVEL COMPANION"), ...(hero ? { hero } : {}), date: new Intl.DateTimeFormat("en-GB", { weekday: "long", day: "numeric", month: "short", year: "numeric", timeZone: "UTC" }).format(new Date(job.date + "T12:00:00Z")), day: displayCity,
        title: brief(day.title, `Your day in ${displayCity}`, 70), introduction: brief(research?.introduction || day.summary || plan.presentation?.summary, "Your itinerary for the day is ready."),
        ...(research?.poeticLine ? { poeticLine: research.poeticLine } : {}),
        summary: [{ value: `${forDay.length} stops`, label: "Your day" }, { value: travelSummary, label: "Travel mode" }, { value: "Your pace", label: "No check-ins" }],
        weather: { title: "Weather for your day", text: forecast, link: { label: "Local forecast", url: forecastUrl } },
        itinerary: forDay.map((item, index) => ({ iconKind: item.isTransfer ? (travelSummary === "Driving" ? "car" : "pin") : day.blocks?.some(block => executionToken(`${day.id}:${block.id}`) === item.id && block.kind === "meal") ? "utensils" : /forest|canopy|nature|park|garden|woodland/i.test(places.get(item.placeId ?? "")?.category ?? "") ? "forest" : /hotel|lodging/i.test(places.get(item.placeId ?? "")?.category ?? "") ? "hotel" : "camera", time: { label: item.time ?? "", kind: item.timeStatus === "confirmed" ? "confirmed" : item.time ? "planned" : "flexible" }, title: placeLabel(item.title, research?.activities?.find(copy => copy.index === index)?.title || "Scheduled activity"), detail: brief(research?.activities?.find(copy => copy.index === index)?.detail || item.preparation.join(" ")), reminder: brief(research?.activities?.find(copy => copy.index === index)?.reminder || (item.timeStatus === "confirmed" ? item.preparation.join(" ") : "")) })),
        places: scheduledPlaces.map((place, index) => { const image = placeImage(place); return { ...(image ? { image } : {}), kicker: `${String(index + 1).padStart(2, "0")} / ${placeLabel(place.city, displayCity)}`, name: placeLabel(place.name), description: described(place, research), ...(rides.get(place.id)?{ride:rides.get(place.id)!}:{}), ...(publicLinks(place)[0] ? {link:publicLinks(place)[0]} : {}) }; }),
        routes: (plan.presentation?.routeSegments ?? []).filter(route => route.dayId === day.id).map(route => ({ title: `${placeLabel(places.get(route.originPlaceId)?.name, "Starting point")} → ${placeLabel(places.get(route.destinationPlaceId)?.name)}`, description: route.verification === "verified" && route.durationMinutes ? `Allow approximately ${route.durationMinutes} minutes; check traffic before leaving.` : "Check the map for the current route and travel time.", link: { label: "Route map", url: mapLink(places.get(route.destinationPlaceId)?.name ?? city, places.get(route.originPlaceId)?.name, route.mode === "transit" ? "transit" : route.mode === "driving" ? "driving" : "walking") } })),
        preparation: brief(forDay.flatMap(item => item.preparation).join(" "), "Check your route, opening hours and reservation details before leaving."),
        booking: sourcesChanged ? "Verify the change with your booking provider before reviewing your itinerary." : bookings.length ? "Confirmed bookings are recorded; check your reservation documents." : "No confirmed booking is recorded for this day.",
        links: [{ label: "Today’s map", url: `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(city)}` }, ...scheduledPlaces.flatMap(publicLinks), ...sourceLinks(research).filter(link => !scheduledPlaces.some(place => safeHttps(place.officialUrl) === link.url))].filter((link, index, links) => links.findIndex(candidate => new URL(candidate.url).hostname === new URL(link.url).hostname) === index)
      });
      return finish(rendered, research);
    }
    if (!activity) throw new Error("Email activity is no longer in the Plan.");
    if (job.kind === "transfer") {
      const research = await researchFor(destination ? [target(destination)] : []);
      const route = plan.presentation?.routeSegments.find(route => route.dayId === day.id && route.destinationPlaceId === activity.placeId && (!origin || route.originPlaceId === origin.id));
      const routeMode = route?.mode;
      const transferMode = routeMode === "driving" || routeMode === "walking" || routeMode === "transit" ? routeMode : mode;
      const resolveEndpoint = async (place: PlanPlace | undefined): Promise<PlanPlace | undefined> => {
        if (!place || place.coordinates || signal?.aborted || typeof connectors.maps.geocodeAddress !== "function") return place;
        try {
          const result = await connectors.maps.geocodeAddress({address: [place.name, place.locationLabel].filter(Boolean).join(", "), city: place.city ?? city});
          const age = (dependencies.now?.() ?? new Date()).getTime() - Date.parse(result.observedAt);
          const coords = result.data?.location.split(",").map(Number);
          if (signal?.aborted || result.status !== "available" || !Number.isFinite(age) || age < -300_000 || age > 15*60_000 || !coords || coords.length !== 2 || !coords.every(Number.isFinite) || Math.abs(coords[0]!) > 180 || Math.abs(coords[1]!) > 90) return place;
          return {...place, coordinates: [coords[1]!, coords[0]!]};
        } catch { return place; }
      };
      const [routeOrigin, routeDestination] = await Promise.all([resolveEndpoint(origin),resolveEndpoint(destination)]);
      let distance = route?.verification === "verified" ? route.distanceMeters : undefined;
      let minutes = route?.verification === "verified" ? route.durationMinutes : undefined;
      const query = transferMode === "driving" ? "drivingRoute" : transferMode === "transit" ? "transitRoute" : "walkingRoute";
      if (routeOrigin?.coordinates && routeDestination?.coordinates && typeof connectors.maps[query] === "function") {
        try {
          const input = {origin:[...routeOrigin.coordinates].reverse().join(","),destination:[...routeDestination.coordinates].reverse().join(",")};
          const result = await connectors.maps[query](input);
          const age = (dependencies.now?.() ?? new Date()).getTime()-Date.parse(result.observedAt);
          if (result.status === "available" && result.data && Number.isFinite(age) && age >= -300_000 && age <= 15*60_000 && result.data.origin === input.origin && result.data.destination === input.destination && result.data.mode === transferMode && typeof result.data.durationSeconds === "number" && Number.isFinite(result.data.durationSeconds) && result.data.durationSeconds > 0 && Number.isFinite(result.data.distanceMeters) && result.data.distanceMeters >= 0) {
            distance=result.data.distanceMeters;minutes=Math.ceil(result.data.durationSeconds/60);
          }
        } catch { /* Saved estimates remain explicitly provisional. */ }
      }
      const hero = placeImage(destination);
      const ride=destination?await rideFor(routeOrigin,{name:placeLabel(destination.name),address:placeLabel(destination.locationLabel,displayCity),city:destination.city??city}):undefined;
      const nextStop=forDay.slice(index+1).find(item=>!item.isTransfer);
      const scheduledArrival=activity.isTransfer ? (nextStop && nextStop.placeId===activity.placeId?nextStop.time:undefined) : activity.time;
      const timing=transferTiming({date:job.date,...(activity.isTransfer&&activity.time?{departure:activity.time}:{}),...(minutes?{durationMinutes:minutes}:{}),...(scheduledArrival?{scheduledStart:scheduledArrival}:{}),departureZone:dependencies.timeZoneForCity?.(origin?.city??city),destinationZone:dependencies.timeZoneForCity?.(destination?.city??city)});
      const routeOptions=new URL(mapLink(destination?.name ?? activity.title,origin?.name));routeOptions.searchParams.delete("travelmode");
      const supportLinks={...(destination&&safeHttps(destination.officialUrl)?{about:{label:`About ${placeLabel(destination.name)}`,url:destination.officialUrl!}}:{}),weather:{label:"Weather",url:safeHttps(research?.weather?.sourceUrls[0])??`https://www.google.com/search?q=${encodeURIComponent(`${city} weather`)}`},transport:{label:"Other ways to go",url:routeOptions.href}};
      const rendered = renderTransferEmail({ ...context(`Next stop · ${placeLabel(activity.title)}`, `ON THE WAY\n${displayCity}`), ...(hero ? { hero } : {}), plannedTime: activity.isTransfer ? activity.time ?? "Time to be confirmed" : "Not scheduled", title: `Next: ${placeLabel(destination?.name ?? activity.title)}`, introduction: brief(research?.introduction || (destination ? described(destination, research) : ""), "Open the map from your actual starting point."),
        origin: placeLabel(origin?.name, "Choose your starting point on the map"), destination: placeLabel(destination?.name ?? activity.title), mode: modeLabel[transferMode], ...timing, ...(scheduledArrival?{scheduledArrival}:{}), estimatedDistance: distance ? `About ${(distance / 1000).toFixed(1)} km` : "See map", estimatedDuration: minutes ? `About ${minutes} min` : "Check the map",
        supportLinks, ...(ride?{ride}:{}), routeLink: { label: "Open route map", url: mapLink(destination?.name ?? activity.title, origin?.name, transferMode) }, estimateNote: "Route estimates use your itinerary, not your actual location.", nearby: brief((destination ? research?.notes.find(note => note.targetId === destination.id)?.text : "") || destination?.tip, "Check entry requirements before visiting."), reminder: brief(activity.preparation.join(" "), "No arrival check-in is needed."), links: [...publicLinks(destination), ...sourceLinks(research)]
      });
      return finish(rendered, research);
    }
    if (job.kind === "dining") {
      const restaurants: DiningEmailData["restaurants"] = [];
      if (destination) {
        const image = placeImage(destination);
        restaurants.push({ ...(image ? { image } : {}), name: placeLabel(destination.name), cuisine: placeLabel(destination.category, "Restaurant"), price: "See menu", description: brief(destination.whyWorthIt), dishes: "Check the current menu.", priceNote: "Check current prices and opening hours.", transport: `Directions from ${placeLabel(origin?.name, displayCity)}; adjust your starting point on the map.`, links: [{ label: "Map", url: mapLink(destination.name, origin?.name, mode) }, ...publicLinks(destination)] });
      } else if (origin?.coordinates) {
        let candidates: NearbyPlaceFact[] = [];
        try { const result = await connectors.maps.nearbyRestaurants({ location: `${origin.coordinates[1]},${origin.coordinates[0]}`, limit: 8 }); if (result.status === "available") candidates = (result.data ?? []).filter(place => Number.isFinite(place.distanceMeters) && place.distanceMeters >= 0 && !["temporarily_closed", "permanently_closed"].includes(place.businessStatus ?? "")).sort((a, b) => a.distanceMeters - b.distanceMeters).slice(0, 3); } catch { /* A search link remains available. */ }
        for (const place of candidates) {
          const menu = await restaurantMenu(place, activity.title);
          const official = safeHttps(place.dining?.websiteUrl);
          restaurants.push({ name: placeLabel(place.name), cuisine: placeLabel(place.dining?.category ?? place.type, "Restaurant"), price: place.dining?.priceLevel ? "See menu" : "Price unverified", description: brief(place.dining?.summary, "A restaurant near your planned dining area."), dishes: menu?.dishes.map(dish => dish.name).join(", ") || "Check the official menu.", priceNote: "No table reservation has been confirmed.", distanceMeters:place.distanceMeters, transport: `About ${Math.round(place.distanceMeters)} m from ${placeLabel(origin.name)}; check the walking route.`, links: [{ label: "Map", url: mapLink(place.name, origin.name, mode) }, ...(menu && safeHttps(menu.sourceUrl) ? [{ label: "Menu", url: menu.sourceUrl }] : []), ...(official ? [{ label: "Website", url: official }] : [])] });
        }
      }
      const research = await researchFor(restaurants.map((restaurant,index) => ({id:`restaurant-${index}`,name:restaurant.name,city,savedDescription:restaurant.description, ...(restaurant.links.find(link=>link.label==="Website") ? {officialUrl:restaurant.links.find(link=>link.label==="Website")!.url} : {})})));
      const acceptedImages: NonNullable<EmailResearchResult["images"]> = [];
      await Promise.all(restaurants.map(async (restaurant,index) => {
        if (restaurant.image || signal?.aborted) return;
        const candidate = research?.images?.find(image => image.targetId === `restaurant-${index}`);
        if (!candidate) return;
        try {
          const valid = await (dependencies.probeImage ? dependencies.probeImage(candidate.url, signal) : probeEmailPhoto(candidate.url, signal));
          if (valid !== false && !signal?.aborted) { restaurant.image = {url:candidate.url,alt:candidate.alt}; acceptedImages.push({...candidate,status:valid===true?"available":"recheck"}); }
        } catch { /* An unverified photograph never replaces restaurant information. */ }
      }));
      if (research) research.images = acceptedImages.sort((a,b)=>a.targetId.localeCompare(b.targetId));
      for (const [index, restaurant] of restaurants.entries()) {
        const notes = research?.notes.filter(note => note.targetId === `restaurant-${index}`);
        if (notes?.length) restaurant.description = brief(notes[0]?.text);
        restaurant.links.push(...sourceLinks(research).filter(link => notes?.some(note => note.sourceUrls.includes(link.url))));
      }
      await Promise.all(restaurants.map(async restaurant=>{const ride=await rideFor(origin,{name:restaurant.name,city:displayCity});if(ride)restaurant.ride=ride;}));
      const rendered = renderDiningEmail({ ...context(`Dining · ${displayCity}`, `A TABLE FOR TODAY\n${displayCity}`), title: destination ? placeLabel(destination.name) : `Dining in ${displayCity}`, introduction: research?.introduction || (destination ? "Check your restaurant reservation before visiting." : restaurants.length ? "A few options near your planned dining area." : "Explore nearby restaurants on the map."), plannedTime: activity.time ?? "At your own pace", plannedOrigin: placeLabel(origin?.name, displayCity), restaurants, ...(!restaurants.length ? { fallbackLinks: [{label:"Nearby restaurants",url:`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(`restaurants near ${origin?.name ?? city}`)}`}] } : {}), reminder: "Check opening hours, prices and dietary options before visiting." });
      return finish(rendered, research);
    }
    throw new Error("Change content must be built from a sourced attention.");
  };
}
