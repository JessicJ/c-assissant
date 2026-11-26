import type { TripBlueprint } from "./trip-blueprint.js";

export interface BlueprintImpactProjectionEdit { kind: string; placeId?: string; dayId?: string }

/** 只投影真实编辑范围；关系判断、来源义务与确认仍由领域审阅拥有。 */
export function blueprintImpactProjection(blueprint: TripBlueprint, revisions: readonly BlueprintImpactProjectionEdit[]) {
  const edits = revisions.filter((revision) => revision.placeId !== undefined);
  const placeIds = [...new Set(edits.map((revision) => revision.placeId!))];
  const days = blueprint.days.filter((day) => edits.some((revision) => revision.dayId !== undefined
    ? revision.dayId === day.id
    : revision.kind === "update_place_priority" && (day.stops.some((stop) => stop.placeId === revision.placeId)
      || day.blocks?.some((block) => block.placeId === revision.placeId))));
  return { placeIds, dayIds: days.map((day) => day.id), dates: days.map((day) => day.date) };
}
