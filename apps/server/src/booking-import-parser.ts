import { randomUUID } from "node:crypto";
import type {
  BookingSegment,
  TravelBooking,
  TravelBookingStatus,
  TravelBookingType
} from "@c-assistant/core";

type BookingScope = { planningSessionId?: string; planId?: string };

export function createBookingFromImportedText(input: { content: string; sourceHash: string; sourceLabel: string; scope: BookingScope }): TravelBooking {
  const type = detectBookingType(input.content);
  const providerName = extractProviderName(input.content, input.sourceLabel);
  const segments = extractBookingSegments(input.content, type);
  const status: TravelBookingStatus = segments.some((segment) => segment.needsReviewReasons.length) ? "needs_review" : "confirmed";
  const now = new Date().toISOString();
  return {
    id: randomUUID(),
    ...input.scope,
    type,
    status,
    title: `${providerName ? `${providerName} ` : ""}${bookingTypeLabel(type)}`.trim(),
    ...(providerName ? { providerName } : {}),
    source: input.sourceLabel.toLocaleLowerCase().endsWith(".eml") || /mail|email/i.test(input.sourceLabel) ? "imported_email" : "imported_text",
    sourceHash: input.sourceHash,
    sourceLabel: input.sourceLabel,
    importedAt: now,
    updatedAt: now,
    constraintStrength: status === "confirmed" ? "hard" : "soft",
    segments,
    ...(extractConfirmationCode(input.content) ? { notes: "Confirmation code detected and kept out of generation context." } : {})
  };
}

function detectBookingType(content: string): TravelBookingType {
  const text = content.toLocaleLowerCase();
  if (/\b(rental car|car rental|pick-?up|pickup location|return location|vehicle)\b|租车|租車|レンタカー/.test(text)) return "rental_car";
  if (/\b(flight|airline|boarding|departure airport|arrival airport|gate|terminal)\b|航班|机票|機票|飛行機|航空券|フライト|便名/.test(text)) return "flight";
  if (/\b(train|rail|station|platform)\b|火车|火車|列车|列車|鉄道|電車|駅|ホーム/.test(text)) return "train";
  if (/\b(hotel|accommodation|check-?in|check-?out|property|room)\b|酒店|饭店|飯店|住宿|宾馆|賓館|ホテル|チェックイン|チェックアウト/.test(text)) return "accommodation";
  if (/\b(restaurant|table|dining)\b|餐厅|餐廳|餐馆|餐館|レストラン|食事/.test(text)) return "restaurant";
  if (/\b(tour|excursion)\b|行程|ツアー/.test(text)) return "tour";
  if (/\b(ticket|event|voucher)\b|门票|門票|票券|イベント|チケット/.test(text)) return "ticket";
  return "other";
}

function extractBookingSegments(content: string, type: TravelBookingType): BookingSegment[] {
  if (type === "flight" || type === "train") {
    const transportSegments = extractTransportBookingSegments(content, type);
    if (transportSegments.length > 1) return transportSegments;
  }
  const start = normalizeBookingDateValue(extractLabeledValue(content, ["departure", "depart", "check-in", "check in", "pickup", "pick-up", "start", "date", "出发", "出發", "出発", "入住", "チェックイン", "取车", "取車", "貸出"]));
  const end = normalizeBookingDateValue(extractLabeledValue(content, ["arrival", "arrive", "check-out", "check out", "return", "end", "到达", "到達", "到着", "退房", "チェックアウト", "还车", "還車", "返却"]));
  const origin = extractLabeledValue(content, ["departure airport", "pickup location", "pick-up location", "from", "origin", "出发机场", "出發機場", "出発空港", "取车地点", "取車地點", "貸出場所"]);
  const destination = extractLabeledValue(content, ["arrival airport", "return location", "to", "destination", "到达机场", "到達機場", "到着空港", "还车地点", "還車地點", "返却場所"]);
  const location = type === "accommodation"
    ? extractLabeledValue(content, ["property address", "address", "location", "venue", "地址", "住所", "所在地", "会場"]) ?? extractLabeledValue(content, ["property", "hotel", "酒店", "ホテル"])
    : extractLabeledValue(content, ["pickup location", "pick-up location", "return location", "address", "location", "venue", "地址", "住所", "所在地", "会場"]);
  const segmentType: BookingSegment["segmentType"] = type === "flight" ? "flight_leg" : type === "train" ? "train_leg" : type === "accommodation" ? "hotel_stay" : type === "rental_car" ? "rental_pickup" : type === "event" || type === "tour" || type === "ticket" || type === "restaurant" ? "event_window" : "other";
  const needsReviewReasons: string[] = [];
  if (!start) needsReviewReasons.push("Start date or time needs review.");
  if (!location && !origin && !destination) needsReviewReasons.push("Location needs review.");
  if ((type === "flight" || type === "train") && (!origin || !destination)) needsReviewReasons.push("Transport endpoints need review.");
  if (type === "accommodation" && !end) needsReviewReasons.push("Checkout date needs review.");
  const segment: BookingSegment = {
    id: randomUUID(),
    segmentType,
    title: bookingTypeLabel(type),
    status: needsReviewReasons.length ? "needs_review" : "confirmed",
    ...(start ? { startAtLocal: start } : {}),
    ...(end ? { endAtLocal: end } : {}),
    ...(origin ? { origin } : {}),
    ...(destination ? { destination } : {}),
    ...(location ? { location } : {}),
    constraintStrength: needsReviewReasons.length ? "soft" : "hard",
    fixedCommitment: needsReviewReasons.length === 0,
    needsReviewReasons
  };
  if (type !== "rental_car") return [segment];
  const returnNeedsReview = end ? segment.needsReviewReasons.filter((reason) => !reason.toLocaleLowerCase().includes("start")) : ["Return date or time needs review."];
  const returnLocation = destination ?? location;
  const returnSegment: BookingSegment = {
    id: randomUUID(),
    segmentType: "rental_return",
    title: "Rental car return",
    status: returnNeedsReview.length ? "needs_review" : "confirmed",
    ...(end ? { startAtLocal: end } : {}),
    ...(destination ? { origin: destination } : {}),
    ...(returnLocation ? { location: returnLocation } : {}),
    constraintStrength: returnNeedsReview.length ? "soft" : "hard",
    fixedCommitment: returnNeedsReview.length === 0,
    needsReviewReasons: returnNeedsReview
  };
  return [
    { ...segment, segmentType: "rental_pickup", title: "Rental car pickup" },
    returnSegment
  ];
}

function extractTransportBookingSegments(content: string, type: "flight" | "train"): BookingSegment[] {
  const blocks = content.split(/\n\s*\n/g).map((block) => block.trim()).filter(Boolean);
  const segmentType: BookingSegment["segmentType"] = type === "flight" ? "flight_leg" : "train_leg";
  const endpointLabels = type === "flight"
    ? { origin: ["departure airport", "from", "origin"], destination: ["arrival airport", "to", "destination"] }
    : { origin: ["departure station", "station from", "from", "origin"], destination: ["arrival station", "station to", "to", "destination"] };
  return blocks
    .map((block, index): BookingSegment | undefined => {
      const start = normalizeBookingDateValue(extractLabeledValue(block, ["departure", "depart", "出发", "出發", "出発"]));
      const end = normalizeBookingDateValue(extractLabeledValue(block, ["arrival", "arrive", "到达", "到達", "到着"]));
      const origin = extractLabeledValue(block, endpointLabels.origin);
      const destination = extractLabeledValue(block, endpointLabels.destination);
      if (!start && !end && !origin && !destination) return undefined;
      const needsReviewReasons: string[] = [];
      if (!start) needsReviewReasons.push("Start date or time needs review.");
      if (!origin || !destination) needsReviewReasons.push("Transport endpoints need review.");
      return {
        id: randomUUID(),
        segmentType,
        title: transportSegmentTitle(block, type, index),
        status: needsReviewReasons.length ? "needs_review" : "confirmed",
        ...(start ? { startAtLocal: start } : {}),
        ...(end ? { endAtLocal: end } : {}),
        ...(origin ? { origin } : {}),
        ...(destination ? { destination } : {}),
        constraintStrength: needsReviewReasons.length ? "soft" : "hard",
        fixedCommitment: needsReviewReasons.length === 0,
        needsReviewReasons
      };
    })
    .filter((segment): segment is BookingSegment => Boolean(segment));
}

function transportSegmentTitle(block: string, type: "flight" | "train", index: number): string {
  const service = extractLabeledValue(block, [type === "flight" ? "flight" : "train"]);
  const heading = block.split("\n").map((line) => line.trim()).find((line) => /outbound|return|flight|train/i.test(line) && !line.includes(":"));
  return [heading, service].filter(Boolean).join(" ") || `${bookingTypeLabel(type)} ${index + 1}`;
}

function extractLabeledValue(content: string, labels: string[]): string | undefined {
  for (const label of labels) {
    const escaped = label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const match = new RegExp(`(?:^|\\n)\\s*${escaped}\\s*(?:date|time|at)?\\s*[:\\-]\\s*([^\\n]{3,90})`, "i").exec(content);
    const value = match?.[1]?.replace(/\s{2,}/g, " ").trim();
    if (value && !/^(date|time|at|from|to)$/i.test(value)) return value.slice(0, 90);
  }
  return undefined;
}

function normalizeBookingDateValue(value: string | undefined): string | undefined {
  if (!value) return undefined;
  const normalized = value.trim();
  const match = /\b(20\d{2})[-/.年](\d{1,2})[-/.月](\d{1,2})日?(?:[ T　]+(\d{1,2}):(\d{2}))?/.exec(normalized)
    ?? /\b(\d{1,2})[-/.](\d{1,2})[-/.](20\d{2})(?:[ T　]+(\d{1,2}):(\d{2}))?/.exec(normalized);
  if (!match) return normalized;
  const year = match[1]!.length === 4 ? match[1] : match[3]!;
  const month = match[1]!.length === 4 ? match[2]! : match[1]!;
  const day = match[1]!.length === 4 ? match[3]! : match[2]!;
  const hour = match[4];
  const minute = match[5];
  const date = `${year}-${month.padStart(2, "0")}-${day.padStart(2, "0")}`;
  return hour && minute ? `${date}T${hour.padStart(2, "0")}:${minute}` : date;
}

function extractProviderName(content: string, sourceLabel: string): string | undefined {
  const fromSubject = /^subject:\s*(.+)$/im.exec(content)?.[1]?.replace(/booking|confirmation|reservation/ig, "").trim();
  if (fromSubject && fromSubject.length >= 2) return fromSubject.slice(0, 80);
  const firstLine = content.split("\n").map((line) => line.trim()).find((line) => line.length >= 3 && line.length <= 80);
  if (firstLine && !/^from:|^to:|^date:/i.test(firstLine)) return firstLine.slice(0, 80);
  const cleanLabel = sourceLabel.replace(/\.(eml|html|txt)$/i, "").trim();
  return cleanLabel && cleanLabel !== "Imported booking confirmation" ? cleanLabel.slice(0, 80) : undefined;
}

function extractConfirmationCode(content: string): string | undefined {
  return /\b(?:confirmation|booking|reservation)\s*(?:number|code|id|#)?\s*[:#-]?\s*([A-Z0-9][A-Z0-9-]{4,20})\b/i.exec(content)?.[1];
}

function bookingTypeLabel(type: TravelBookingType): string {
  return type === "accommodation" ? "Accommodation booking"
    : type === "flight" ? "Flight booking"
      : type === "train" ? "Train booking"
        : type === "rental_car" ? "Rental car booking"
          : type === "restaurant" ? "Restaurant booking"
            : type === "event" ? "Event booking"
              : type === "tour" ? "Tour booking"
                : type === "ticket" ? "Ticket booking" : "Booking";
}
