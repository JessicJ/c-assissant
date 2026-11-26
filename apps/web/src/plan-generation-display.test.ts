import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { PlanGenerationState } from "./api-client.js";
import { generationFailureMessage, generationProgressMessage, generationStageMessage } from "./plan-generation-display.js";

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

  it("shows the live operation instead of a stale generic stage", () => {
    const generation: PlanGenerationState = {
      runId: "run-2",
      sessionId: "session-2",
      stage: "research",
      status: "running",
      scopeLabel: "Central Rotorua",
      savedPlaceCount: 36,
      message: "Finding optional local choices near Central Rotorua…",
      startedAt: "2026-10-05T00:00:00.000Z",
      updatedAt: "2026-10-05T00:30:00.000Z"
    };
    assert.equal(generationProgressMessage(generation), "Finding optional local choices near Central Rotorua… 36 places saved.");
  });

  it("preserves current photo, optional-guide and route-check operation messages", () => {
    const base: PlanGenerationState = {
      runId: "current", sessionId: "current", stage: "research", status: "running", savedPlaceCount: 6,
      startedAt: "2026-10-05T00:00:00.000Z", updatedAt: "2026-10-05T00:00:01.000Z"
    };
    for (const message of ["Preparing itinerary cards…", "Finding optional local choices for the guide…",
      "Checking flight departure airports before final review.", "Researching completion candidates for 2026-12-12.",
      "Saved 6 researched places."]) {
      assert.equal(generationProgressMessage({ ...base, message }, new Date(base.updatedAt)), `${message} 6 places saved.`);
    }
    assert.equal(generationProgressMessage({ ...base, scopeLabel: "京都", message: "Researching 京都." }, new Date(base.updatedAt)),
      "Researching 京都. 6 places saved.");
  });

  it("rejects altered operation templates and unverified counters", () => {
    const base: PlanGenerationState = {
      runId: "unsafe", sessionId: "unsafe", stage: "research", status: "running", savedPlaceCount: 6,
      startedAt: "2026-10-05T00:00:00.000Z", updatedAt: "2026-10-05T00:00:01.000Z"
    };
    for (const message of ["Preparing itinerary cards… /private/secret", "Saved 99 researched places.",
      "Researching completion candidates for 2026-12-12. Error: internal failure", "Preparing itinerary cards…正在准备"]) {
      assert.equal(generationProgressMessage({ ...base, message }, new Date(base.updatedAt)),
        "Researching places by geographic area and saving each batch… 6 places saved.");
    }
  });

  it("uses English stage copy for historical and unknown service messages", () => {
    for (const message of ["正在研究地点，请稍候", "Error: /private/task/internal.json could not be read"]) {
      const generation: PlanGenerationState = {
        runId: "legacy", sessionId: "legacy", stage: "research", status: "running", message,
        scopeLabel: "京都", savedPlaceCount: 3,
        startedAt: "2026-10-05T00:00:00.000Z", updatedAt: "2026-10-05T00:00:01.000Z"
      };
      assert.equal(generationProgressMessage(generation, new Date(generation.updatedAt)),
        "Researching places by geographic area and saving each batch… Current area: 京都. 3 places saved.");
    }
  });

  it("shows truthful elapsed time while the first research batch is still running", () => {
    const generation: PlanGenerationState = {
      runId: "run-slow", sessionId: "session-slow", stage: "research", status: "running",
      savedPlaceCount: 0, startedAt: "2026-10-05T00:00:00.000Z", updatedAt: "2026-10-05T00:04:00.000Z"
    };
    assert.match(generationProgressMessage(generation, new Date("2026-10-05T00:04:30.000Z")), /nothing saved yet\. Running for 4 min\./);
  });

  it("keeps internal place IDs and integrity errors out of the traveler dialog", () => {
    const generation: PlanGenerationState = {
      runId: "run-3", sessionId: "session-3", stage: "import", status: "failed",
      message: "Itinerary repair removed scheduled places from 2026-11-11: place-scope-1-place-waiheke-ferry-1e1ylvj",
      failureCode: "generation_failed", startedAt: "2026-10-05T00:00:00.000Z", updatedAt: "2026-10-05T00:01:00.000Z"
    };
    assert.match(generationFailureMessage(generation), /couldn't finish checking the daily route/);
    assert.doesNotMatch(generationFailureMessage(generation), /place-scope|integrity|2026-11-11/);
  });

  it("names under-planned dates without exposing the internal final-review error", () => {
    const generation: PlanGenerationState = {
      runId: "run-4", sessionId: "session-4", stage: "import", status: "failed",
      message: "Trip Blueprint final review failed: 2026-11-08 still has substantial unused daytime capacity after targeted research.; 2026-11-10 still has substantial unused daytime capacity after targeted research.",
      failureCode: "generation_failed", startedAt: "2026-10-05T00:00:00.000Z", updatedAt: "2026-10-05T00:01:00.000Z"
    };
    assert.equal(generationFailureMessage(generation), "The itinerary still needs a better daytime route on 2026-11-08, 2026-11-10. Your trip details and completed research are saved.");
  });

  it("在生成时提供 MAH 配置引导且说明检查点已保留", () => {
    const base: PlanGenerationState = {
      runId: "run-mah", sessionId: "session-mah", stage: "failed", status: "failed",
      startedAt: "2026-10-13T00:00:00.000Z", updatedAt: "2026-10-13T00:00:01.000Z"
    };
    assert.match(generationFailureMessage({ ...base, failureCode: "mah_not_configured" }), /Plan generation still needs verification after setup/);
    assert.match(generationFailureMessage({ ...base, failureCode: "mah_slot_unavailable" }), /no available interactive capacity/);
    assert.match(generationFailureMessage({ ...base, failureCode: "mah_scheduler_unavailable" }), /original request and completed progress/);
    assert.match(generationFailureMessage({ ...base, failureCode: "mah_execution_carriers_schema_unsupported" }), /version is incompatible/);
    assert.match(generationFailureMessage({ ...base, failureCode: "mah_provider_route_unverified" }), /Check MAH before trying again/);
    assert.match(generationFailureMessage({ ...base, failureCode: "mah_artifact_version_unsupported" }), /did not pass Landi verification/);
  });
});
