import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { PlanGenerationState } from "./api-client.js";
import { generationProgressMessage, generationStageMessage } from "./plan-generation-display.js";

describe("plan generation display", () => {
  it("maps stages to user-facing status copy", () => {
    assert.equal(generationStageMessage("queued"), "Starting plan generation…");
    assert.equal(generationStageMessage("ready"), "The complete Trip Blueprint and Plan are ready.");
    assert.equal(generationStageMessage("failed"), "Plan generation did not finish. Your trip details are saved.");
  });

  it("adds scope and saved-place progress when available", () => {
    const generation: PlanGenerationState = {
      runId: "run-1",
      sessionId: "session-1",
      stage: "research",
      status: "running",
      scopeLabel: "Kyoto",
      savedPlaceCount: 12,
      startedAt: "2026-10-05T00:00:00.000Z",
      updatedAt: "2026-10-05T00:01:00.000Z"
    };

    assert.equal(
      generationProgressMessage(generation),
      "Researching places by geographic area and saving each batch… Current area: Kyoto. 12 places saved."
    );
  });
});
