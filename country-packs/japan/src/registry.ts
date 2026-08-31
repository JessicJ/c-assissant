import { readFileSync } from "node:fs";
import { createSkillRegistry, parseSkillManifest, type SkillHandler, type SkillRegistration } from "@c-assistant/skill-runtime";
import {
  runJapanArrivalPlanSkill,
  runJapanArrivalPreparationSkill,
  runJapanDigitalLifeSetupSkill,
  runJapanHousingAreaRecommendationSkill,
  runJapanLocalFoodGuideSkill,
  runJapanPolicyApplicabilitySkill,
  runJapanTransportPlannerSkill,
  runJapanWeatherAndPackingSkill
} from "./index.js";

function registration(path: string, handler: SkillHandler): SkillRegistration {
  const manifest = parseSkillManifest(JSON.parse(readFileSync(new URL(path, import.meta.url), "utf8")) as unknown);
  return { manifest, entrypoint: manifest.entrypoint, handler };
}

export const japanSkillRegistrations: SkillRegistration[] = [
  registration("../skills/japan-arrival-plan/skill.json", (value) => runJapanArrivalPlanSkill(value as Parameters<typeof runJapanArrivalPlanSkill>[0])),
  registration("../skills/japan-policy-applicability/skill.json", (value) => runJapanPolicyApplicabilitySkill(value as Parameters<typeof runJapanPolicyApplicabilitySkill>[0])),
  registration("../skills/japan-weather-and-packing/skill.json", (value) => runJapanWeatherAndPackingSkill(value as Parameters<typeof runJapanWeatherAndPackingSkill>[0])),
  registration("../skills/japan-housing-area-recommendation/skill.json", (value) => runJapanHousingAreaRecommendationSkill(value as Parameters<typeof runJapanHousingAreaRecommendationSkill>[0])),
  registration("../skills/japan-transport-planner/skill.json", (value) => runJapanTransportPlannerSkill(value as Parameters<typeof runJapanTransportPlannerSkill>[0])),
  registration("../skills/japan-local-food-guide/skill.json", (value) => runJapanLocalFoodGuideSkill(value as Parameters<typeof runJapanLocalFoodGuideSkill>[0])),
  registration("../skills/japan-digital-life-setup/skill.json", (value) => runJapanDigitalLifeSetupSkill(value as Parameters<typeof runJapanDigitalLifeSetupSkill>[0])),
  registration("../skills/japan-arrival-preparation/skill.json", (value) => runJapanArrivalPreparationSkill(value as Parameters<typeof runJapanArrivalPreparationSkill>[0]))
];

export const japanSkillRegistry = createSkillRegistry(japanSkillRegistrations);
