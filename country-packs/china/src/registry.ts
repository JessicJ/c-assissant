import { readFileSync } from "node:fs";

import { createSkillRegistry, parseSkillManifest, type SkillHandler, type SkillRegistration } from "@c-assistant/skill-runtime";
import { runArrivalPreparationSkill, runChinaArrivalPlanSkill, runDigitalLifeSetupSkill, runFoodNearbySkill, runHousingAreaRecommendationSkill, runLocalFoodGuideSkill, runPolicyApplicabilitySkill, runTransportPlannerSkill, runWeatherAndPackingSkill } from "./index.js";

function loadManifest(relativePath: string) {
  return parseSkillManifest(JSON.parse(readFileSync(new URL(relativePath, import.meta.url), "utf8")) as unknown);
}

function registration(relativePath: string, handler: SkillHandler): SkillRegistration {
  const manifest = loadManifest(relativePath);
  return { manifest, entrypoint: manifest.entrypoint, handler };
}

export const chinaSkillRegistry = createSkillRegistry([
  registration("../skills/arrival-preparation/skill.json", (input) => runArrivalPreparationSkill(input as Parameters<typeof runArrivalPreparationSkill>[0])),
  registration("../skills/china-arrival-plan/skill.json", (input) => runChinaArrivalPlanSkill(input as Parameters<typeof runChinaArrivalPlanSkill>[0])),
  registration("../skills/digital-life-setup/skill.json", (input) => runDigitalLifeSetupSkill(input as Parameters<typeof runDigitalLifeSetupSkill>[0])),
  registration("../skills/food-nearby/skill.json", (input) => runFoodNearbySkill(input as Parameters<typeof runFoodNearbySkill>[0])),
  registration("../skills/housing-area-recommendation/skill.json", (input) => runHousingAreaRecommendationSkill(input as Parameters<typeof runHousingAreaRecommendationSkill>[0])),
  registration("../skills/local-food-guide/skill.json", (input) => runLocalFoodGuideSkill(input as Parameters<typeof runLocalFoodGuideSkill>[0])),
  registration("../skills/policy-applicability/skill.json", (input) => runPolicyApplicabilitySkill(input as Parameters<typeof runPolicyApplicabilitySkill>[0])),
  registration("../skills/transport-planner/skill.json", (input) => runTransportPlannerSkill(input as Parameters<typeof runTransportPlannerSkill>[0])),
  registration("../skills/weather-and-packing/skill.json", (input) => runWeatherAndPackingSkill(input as Parameters<typeof runWeatherAndPackingSkill>[0]))
]);
