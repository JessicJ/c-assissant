import { bookingRelationshipDigest, bookingRelationshipSourceUnits, bookingTaskRequirementId } from "./booking-relationship.js";
import type { Plan, PlanBlueprintLineage, Stage, StagePresentationKind, Task } from "./index.js";
import { assertTripBlueprintIntegrity, type BlueprintActionRequirement, type BlueprintBookingConstraint, type BlueprintBookingSegment, type TripBlueprint } from "./trip-blueprint.js";

export const BLUEPRINT_PLAN_COMPILER_VERSION = "2.1.0";
const SUPPORTED_BLUEPRINT_PLAN_COMPILER_VERSIONS: readonly string[] = ["2.0.0", BLUEPRINT_PLAN_COMPILER_VERSION];

/** 仅证明已知编译版本的创建身份，不重编历史业务语义。 */
export function blueprintPlanCompilationIdentity(blueprintId:string, blueprintVersion:number, compilerVersion:string):{planId:string;compilationKey:string} {
  if(!blueprintId.trim()||!Number.isSafeInteger(blueprintVersion)||blueprintVersion<1||!SUPPORTED_BLUEPRINT_PLAN_COMPILER_VERSIONS.includes(compilerVersion)) throw new Error("蓝图编译创建身份不受支持。");
  const compilationKey=`${blueprintId}:${blueprintVersion}:${compilerVersion}`;
  return {planId:stableId("plan",compilationKey),compilationKey};
}

/** 从唯一规范版本目录核对出生身份，不使用可推进的当前 lineage。 */
export function resolveBlueprintPlanCompilationIdentity(blueprintId:string,blueprintVersion:number,planId:string):{planId:string;compilationKey:string;compilerVersion:string}|undefined {
  const matches=SUPPORTED_BLUEPRINT_PLAN_COMPILER_VERSIONS.map(compilerVersion=>({...blueprintPlanCompilationIdentity(blueprintId,blueprintVersion,compilerVersion),compilerVersion})).filter(identity=>identity.planId===planId);
  return matches.length===1?matches[0]:undefined;
}

export interface BlueprintPlanCompilerInput {
  createdAt: string;
  compilerVersion?: string;
  completedRequirementIds?: Iterable<string>;
  previousCompilation?: {blueprint:TripBlueprint;plan:Plan;lineage:PlanBlueprintLineage};
}

export interface BlueprintPlanCompilation {
  plan: Plan;
  lineage: PlanBlueprintLineage;
}

export function compileTripBlueprint(blueprint: TripBlueprint, input: BlueprintPlanCompilerInput): BlueprintPlanCompilation {
  assertTripBlueprintIntegrity(blueprint);
  if (!Number.isFinite(Date.parse(input.createdAt))) throw new Error("Plan compilation needs a valid creation time.");
  const compilerVersion = input.compilerVersion ?? BLUEPRINT_PLAN_COMPILER_VERSION;
  if (compilerVersion !== BLUEPRINT_PLAN_COMPILER_VERSION) throw new Error("只能使用当前编译器版本生成执行计划。");
  const { compilationKey, planId } = blueprintPlanCompilationIdentity(blueprint.id, blueprint.version, compilerVersion);
  const completed = new Set(input.completedRequirementIds ?? []);
  for(const identity of carriedLegacyBookingCompletionIds(blueprint,input.previousCompilation)) completed.add(identity);
  const bookingConstraints = blueprint.bookingConstraints ?? [];
  const stages = [...compileBookingStages(bookingConstraints, compilationKey, completed), ...compileStages(blueprint.actionRequirements, compilationKey, completed)];
  const recheckCount = countRechecks(blueprint);
  const bookingKnown = bookingConstraints.flatMap(bookingKnownInformation);
  const bookingAssumptions = bookingConstraints.flatMap(bookingAssumptionsForConstraint);
  const configuration = bookingConfiguration(bookingConstraints);
  const plan: Plan = {
    id: planId,
    version: 1,
    title: blueprint.title,
    location: blueprint.destinations.join(" / "),
    dates: `${blueprint.startDate} – ${blueprint.endDate}`,
    status: "draft",
    knownInformation: [
      `Destinations: ${blueprint.destinations.join(", ")}`,
      `Travel dates: ${blueprint.startDate} to ${blueprint.endDate}`,
      `${blueprint.days.length} days to explore, with ${blueprint.places.length} places to visit, eat or stay.`,
      ...bookingKnown
    ],
    assumptions: [
      ...(recheckCount ? ["Some opening hours and travel details need checking closer to your trip."] : []),
      ...bookingAssumptions
    ],
    nextAction: "Have a look through your itinerary and preparations. Confirm the plan when it feels right for your trip.",
    configuration,
    stages,
    sources: blueprint.sources.map((source) => ({ title: source.title, authority: source.authority, url: source.url, retrievedAt: source.retrievedAt })),
    createdAt: input.createdAt
  };
  return {
    plan,
    lineage: {
      planId,
      planVersion: plan.version,
      blueprintId: blueprint.id,
      blueprintVersion: blueprint.version,
      compilerVersion,
      compilationKey,
      createdAt: input.createdAt
    }
  };
}

function carriedLegacyBookingCompletionIds(blueprint:TripBlueprint,previous:BlueprintPlanCompilerInput["previousCompilation"]):string[] {
  if(!previous) return [];
  const {plan,lineage,blueprint:prior}=previous;
  const legacyKey=`${prior.id}:${prior.version}:2.0.0`;
  if(lineage.compilerVersion!=="2.0.0"||lineage.compilationKey!==legacyKey||lineage.planVersion!==1||plan.id!==stableId("plan",legacyKey)||plan.id!==lineage.planId||!Number.isInteger(plan.version)||plan.version<lineage.planVersion||plan.createdAt!==lineage.createdAt||prior.id!==lineage.blueprintId||prior.version!==lineage.blueprintVersion||blueprint.id!==prior.id) return [];
  try{assertTripBlueprintIntegrity(prior);}catch{return [];}
  const legacyTasks=previous.plan.stages.flatMap(stage=>stage.tasks);
  if(new Set(legacyTasks.map(task=>task.id)).size!==legacyTasks.length||new Set(legacyTasks.flatMap(task=>task.requirementId?[task.requirementId]:[])).size!==legacyTasks.filter(task=>task.requirementId).length) return [];
  const oldUnits=(previous.blueprint.bookingConstraints??[]).flatMap(constraint=>constraint.segments.map(segment=>({constraint,segment,identity:`booking:${constraint.id}:${segment.id}`})));
  const carried:string[]=[];
  for(const {constraint,segment,identity} of oldUnits) {
    if(oldUnits.filter(unit=>unit.identity===identity).length!==1) continue;
    const tasks=legacyTasks.filter(task=>task.requirementId===identity);
    if(tasks.length!==1||tasks[0]!.status!=="completed") continue;
    const task=tasks[0]!;
    const stage=plan.stages.find(stage=>stage.tasks.includes(task));
    if(!stage||stage.id!==stableId("stage",`${legacyKey}:booking-constraints`)||stage.presentationKind!=="reservations"||constraint.status==='cancelled'||segment.constraintStrength==='ignored') continue;
    // 2.0 的任务字段与现有纯任务投影相同，差异只有 requirementId；不冒充旧版完整编译。
    const expected={...compileBookingTask(constraint,segment,legacyKey,false),requirementId:identity};
    const stableTask=(item:Task)=>({...item,status:undefined,reminder:undefined});
    if(bookingRelationshipDigest(stableTask(task))!==bookingRelationshipDigest(stableTask(expected))) continue;
    if(task.reminder!==undefined&&bookingRelationshipDigest(task.reminder)!==bookingRelationshipDigest(expected.reminder??null)) continue;
    const next=(blueprint.bookingConstraints??[]).find(candidate=>candidate.id===constraint.id);
    const nextSegment=next?.segments.find(candidate=>candidate.id===segment.id);
    if(!next||!nextSegment||next.status==='cancelled'||next.constraintStrength==='ignored'||nextSegment.status==='cancelled'||nextSegment.constraintStrength==='ignored') continue;
    // 源身份全等（包括双方均缺失的旧记录）才比较相同任务协议下的完整完成语义。
    if(constraint.sourceBookingId!==next.sourceBookingId||segment.sourceSegmentId!==nextSegment.sourceSegmentId||constraint.segments.length!==next.segments.length||constraint.segments.some(old=>!next.segments.some(current=>current.id===old.id))) continue;
    if(bookingTaskRequirementId(constraint,segment.id)!==bookingTaskRequirementId(next,nextSegment.id)) continue;
    if(bookingRelationshipSourceUnits([constraint]).find(unit=>unit.segmentId===segment.id)?.sourceDigest!==bookingRelationshipSourceUnits([next]).find(unit=>unit.segmentId===nextSegment.id)?.sourceDigest) continue;
    if(bookingRelationshipDigest({status:constraint.status,strength:constraint.constraintStrength})!==bookingRelationshipDigest({status:next.status,strength:next.constraintStrength})) continue;
    carried.push(bookingTaskRequirementId(next,nextSegment.id));
  }
  return carried;
}

function compileBookingStages(constraints: BlueprintBookingConstraint[], compilationKey: string, completed: Set<string>): Stage[] {
  const tasks = constraints
    .filter((constraint) => constraint.status !== "cancelled" && constraint.constraintStrength !== "ignored")
    .flatMap((constraint) => constraint.segments
      .filter((segment) => segment.constraintStrength !== "ignored" && segment.status !== "cancelled")
      .map((segment) => compileBookingTask(constraint, segment, compilationKey, completed.has(bookingTaskRequirementId(constraint,segment.id)))));
  if (!tasks.length) return [];
  return [{
    id: stableId("stage", `${compilationKey}:booking-constraints`),
    title: "Imported booking constraints",
    description: "Confirmed or reviewed bookings that shape the trip. These records come from traveler-imported confirmations, not from Landi booking on your behalf.",
    presentationKind: "reservations",
    tasks
  }];
}

function compileBookingTask(constraint: BlueprintBookingConstraint, segment: BlueprintBookingSegment, compilationKey: string, isCompleted: boolean): Task {
  const hard = segment.constraintStrength === "hard";
  const timing = [segment.startAtLocal ? `Starts ${segment.startAtLocal}` : "", segment.endAtLocal ? `ends ${segment.endAtLocal}` : ""].filter(Boolean).join("; ");
  const location = [segment.origin ? `from ${segment.origin}` : "", segment.destination ? `to ${segment.destination}` : "", segment.location ? `at ${segment.location}` : ""].filter(Boolean).join("; ");
  const reminder = hard && !isCompleted ? bookingReminder(segment, constraint) : undefined;
  return {
    id: stableId("task", `${compilationKey}:booking:${constraint.id}:${segment.id}`),
    requirementId: bookingTaskRequirementId(constraint,segment.id),
    title: hard ? `Use confirmed ${bookingTypeLabel(constraint.type)}: ${segment.title}` : `Review imported ${bookingTypeLabel(constraint.type)}: ${segment.title}`,
    description: [constraint.title, timing, location, segment.needsReviewReasons.join(" ")].filter(Boolean).join(" · "),
    owner: hard ? "external" : "user",
    status: isCompleted ? "completed" : hard ? "scheduled" : "waiting_user",
    dueLabel: segment.startAtLocal ?? segment.endAtLocal ?? "Before this booking affects the itinerary",
    preparationCategory: "booking",
    ...(reminder ? { reminder } : {})
  };
}

function bookingReminder(segment: BlueprintBookingSegment, constraint: BlueprintBookingConstraint): Task["reminder"] | undefined {
  const at = segment.startAtLocal ?? segment.endAtLocal;
  const timeZone = segment.startTimeZone ?? segment.endTimeZone;
  if (!at || !timeZone) return undefined;
  const scheduledAtLocal = subtractHoursLocal(at, 24);
  if (!scheduledAtLocal) return undefined;
  return {
    scheduledAtLocal,
    timeZone,
    purpose: `Check ${constraint.title} before it affects the trip. Landi has not changed, booked, paid, or checked in for anything.`,
    refreshFacts: []
  };
}

function bookingKnownInformation(constraint: BlueprintBookingConstraint): string[] {
  if(constraint.status === "cancelled" || constraint.constraintStrength === "ignored") return [];
  return constraint.segments
    .filter((segment) => segment.constraintStrength === "hard" && segment.status !== "cancelled")
    .map((segment) => `Confirmed ${bookingTypeLabel(constraint.type)}: ${constraint.title}${segment.startAtLocal ? ` starts ${segment.startAtLocal}` : ""}${segment.endAtLocal ? ` ends ${segment.endAtLocal}` : ""}${segment.location ? ` at ${segment.location}` : ""}${segment.origin || segment.destination ? ` (${[segment.origin, segment.destination].filter(Boolean).join(" to ")})` : ""}`);
}

function bookingAssumptionsForConstraint(constraint: BlueprintBookingConstraint): string[] {
  if(constraint.status === "cancelled" || constraint.constraintStrength === "ignored") return [];
  return constraint.segments
    .filter((segment) => segment.constraintStrength === "soft" && segment.status !== "cancelled")
    .map((segment) => `Imported ${bookingTypeLabel(constraint.type)} '${constraint.title}' needs review before it can constrain the itinerary.${segment.needsReviewReasons.length ? ` ${segment.needsReviewReasons.join(" ")}` : ""}`);
}

function bookingConfiguration(constraints: BlueprintBookingConstraint[]): Plan["configuration"] {
  const configuration: Plan["configuration"] = { accommodation: { status: "not_set" }, arrival: {}, transport: { preference: "plan_recommended" }, travelContext: { luggage: "unknown" } };
  const hardSegments = constraints.flatMap((constraint) => constraint.segments.map((segment) => ({ constraint, segment }))).filter(({ constraint, segment }) => constraint.status !== "cancelled" && constraint.constraintStrength !== "ignored" && segment.status !== "cancelled" && segment.constraintStrength === "hard");
  const accommodation = hardSegments.find(({ segment }) => segment.segmentType === "hotel_stay" && (segment.location || segment.destination));
  if (accommodation) {
    configuration.accommodation = {
      status: "confirmed",
      name: accommodation.constraint.title,
      ...(accommodation.segment.location ? { address: accommodation.segment.location, location: accommodation.segment.location } : accommodation.segment.destination ? { location: accommodation.segment.destination } : {}),
      source: "user",
      updatedAt: accommodation.constraint.importedAt
    };
  }
  const arrival = hardSegments.find(({ segment }) => (segment.segmentType === "flight_leg" || segment.segmentType === "train_leg") && (segment.endAtLocal || segment.startAtLocal));
  if (arrival) {
    const expectedAtLocal = arrival.segment.endAtLocal ?? arrival.segment.startAtLocal;
    const timeZone = arrival.segment.endTimeZone ?? arrival.segment.startTimeZone;
    if (expectedAtLocal) configuration.arrival.expectedAtLocal = expectedAtLocal;
    if (timeZone) configuration.arrival.timeZone = timeZone;
  }
  if (hardSegments.some(({ segment }) => segment.segmentType === "rental_pickup" || segment.segmentType === "rental_return")) configuration.transport.preference = "plan_recommended";
  return configuration;
}

function subtractHoursLocal(value: string, hours: number): string | undefined {
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/.exec(value);
  if (!match) return undefined;
  const date = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]), Number(match[4]), Number(match[5])));
  date.setUTCHours(date.getUTCHours() - hours);
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}-${String(date.getUTCDate()).padStart(2, "0")}T${String(date.getUTCHours()).padStart(2, "0")}:${String(date.getUTCMinutes()).padStart(2, "0")}`;
}

function compileStages(requirements: BlueprintActionRequirement[], compilationKey: string, completed: Set<string>): Stage[] {
  const groups = new Map<string, BlueprintActionRequirement[]>();
  for (const requirement of requirements) groups.set(stageKey(requirement), [...(groups.get(stageKey(requirement)) ?? []), requirement]);
  return [...groups.entries()].map(([key, items]) => {
    const descriptor = stageDescriptor(key);
    return {
      id: stableId("stage", `${compilationKey}:${key}`),
      title: descriptor.title,
      description: descriptor.description,
      presentationKind: descriptor.presentationKind,
      tasks: items.map((requirement) => compileTask(requirement, compilationKey, completed.has(requirement.id)))
    };
  });
}

function compileTask(requirement: BlueprintActionRequirement, compilationKey: string, isCompleted: boolean): Task {
  return {
    id: stableId("task", `${compilationKey}:${requirement.id}`),
    requirementId: requirement.id,
    title: requirement.title,
    description: requirement.description,
    owner: requirement.accountableParty === "traveler" ? "user" : requirement.accountableParty,
    status: isCompleted ? "completed" : requirement.accountableParty === "traveler" ? "waiting_user" : "scheduled",
    dueLabel: requirement.relevantAt ?? "Before this requirement affects the trip",
    preparationCategory: preparationCategory(requirement)
  };
}

function stageKey(requirement: BlueprintActionRequirement): string {
  if (requirement.kind === "reservation") return "reservations";
  if (requirement.kind === "travel_authorization") return "travel-authorization";
  if (requirement.kind === "transport") return "transport";
  if (requirement.kind === "preparation") return "preparation";
  if (requirement.kind === "time_sensitive_recheck") return "rechecks";
  return "other";
}

function stageDescriptor(key: string): { title: string; description: string; presentationKind: StagePresentationKind } {
  if (key === "reservations") return { title: "Reservations", description: "Choose the rooms, tickets and tour times you’d like, then complete your bookings.", presentationKind: "reservations" };
  if (key === "travel-authorization") return { title: "Travel authorization", description: "Check what each traveler needs to enter your destination before leaving.", presentationKind: "details" };
  if (key === "transport") return { title: "Transport preparation", description: "Get your flights and journeys between towns ready before setting off.", presentationKind: "transport" };
  if (key === "preparation") return { title: "Before departure", description: "A few things to sort out before departure, so your trip runs more smoothly.", presentationKind: "details" };
  if (key === "rechecks") return { title: "Time-sensitive rechecks", description: "Check these details again closer to your visit, when current information is more useful.", presentationKind: "details" };
  return { title: "Other trip actions", description: "A few other arrangements for your trip.", presentationKind: "details" };
}

function preparationCategory(requirement: BlueprintActionRequirement): NonNullable<Task["preparationCategory"]> {
  if (requirement.kind === "reservation") return "booking";
  if (requirement.kind === "travel_authorization") return "documents";
  if (requirement.kind === "preparation") return "other_predeparture";
  return "not_applicable";
}

function bookingTypeLabel(type: BlueprintBookingConstraint["type"]): string {
  return type === "accommodation" ? "accommodation"
    : type === "flight" ? "flight"
      : type === "train" ? "train"
        : type === "rental_car" ? "rental car"
          : type === "restaurant" ? "restaurant"
            : type === "event" ? "event"
              : type === "tour" ? "tour"
                : type === "ticket" ? "ticket" : "booking";
}

function countRechecks(blueprint: TripBlueprint): number {
  return blueprint.places.filter((place) => !place.coordinates || place.evidence.some((evidence) => evidence.status !== "verified")).length
    + blueprint.events.filter((event) => event.evidence.some((evidence) => evidence.status !== "verified")).length
    + blueprint.movements.filter((movement) => movement.status !== "verified").length
    + blueprint.actionRequirements.filter((requirement) => requirement.evidence.some((evidence) => evidence.status !== "verified")).length;
}

function stableId(prefix: string, value: string): string {
  let hash = 0x811c9dc5;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return `${prefix}-${(hash >>> 0).toString(36)}`;
}
