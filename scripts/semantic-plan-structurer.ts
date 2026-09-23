import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";
import type { ResearchSet } from "../packages/core/src/index.ts";
import {
  markdownForArtifact,
  markdownForFidelity,
  structureSemanticTravelPlan,
  type SemanticTravelPlan
} from "../packages/agent-adapters/src/index.ts";

async function main(): Promise<void> {
  const semanticPath = resolve(process.env.SEMANTIC_PLAN_INPUT ?? "output/semantic-plan-v24.json");
  const outputBase = resolve(process.env.STRUCTURED_ITINERARY_OUTPUT ?? "output/structured-itinerary-v2");
  const fidelityBase = resolve(process.env.SEMANTIC_FIDELITY_OUTPUT ?? "output/semantic-fidelity-report-v2");
  const semanticContractOutput = resolve(process.env.SEMANTIC_CONTRACT_OUTPUT ?? "output/semantic-plan-v24-contract-v2.json");
  const databasePath = resolve(process.env.C_ASSISTANT_DATA_PATH ?? "data/c-assistant.sqlite");
  const semantic = JSON.parse(await readFile(semanticPath, "utf8")) as SemanticTravelPlan;
  const researchSetId = process.env.RESEARCH_SET_ID ?? "research-b8a19bb5-e669-4ae9-8c36-4d1eea9b61ac";
  const db = new DatabaseSync(databasePath, { readOnly: true });
  try {
    const researchRow = db.prepare("SELECT content_json FROM research_sets WHERE id = ?").get(researchSetId) as { content_json: string } | undefined;
    if (!researchRow) throw new Error(`ResearchSet not found: ${researchSetId}`);
    const research = JSON.parse(researchRow.content_json) as ResearchSet;
    const destinations = (process.env.SEMANTIC_PLAN_DESTINATIONS ?? "").split(",").map((value) => value.trim()).filter(Boolean);
    const diagnostic = structureSemanticTravelPlan(semantic, research, {
      importBlueprint: true,
      createdAt: new Date().toISOString(),
      ...(destinations.length ? { destinations } : {})
    });
    await mkdir(dirname(outputBase), { recursive: true });
    await mkdir(dirname(fidelityBase), { recursive: true });
    await mkdir(dirname(semanticContractOutput), { recursive: true });
    await writeFile(semanticContractOutput, `${JSON.stringify(diagnostic.semanticPlan, null, 2)}\n`, "utf8");
    await writeFile(`${outputBase}.json`, `${JSON.stringify(diagnostic.artifact, null, 2)}\n`, "utf8");
    await writeFile(`${outputBase}.md`, markdownForArtifact(diagnostic.artifact), "utf8");
    await writeFile(`${fidelityBase}.json`, `${JSON.stringify({ fidelity: diagnostic.fidelity, representationGaps: diagnostic.representationGaps }, null, 2)}\n`, "utf8");
    await writeFile(`${fidelityBase}.md`, markdownForFidelity(diagnostic.fidelity), "utf8");
    console.log(JSON.stringify({
      ok: true,
      semanticContractOutput,
      outputBase,
      fidelityBase,
      changed: diagnostic.fidelity.filter((item) => item.classification === "CHANGED").length,
      dropped: diagnostic.fidelity.filter((item) => item.classification === "DROPPED").length,
      notRepresentable: diagnostic.representationGaps.length
    }, null, 2));
  } finally {
    db.close();
  }
}

if (process.argv[1] && import.meta.url.endsWith(process.argv[1].replace(/\\/g, "/"))) {
  await main();
}
