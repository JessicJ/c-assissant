import assert from "node:assert/strict";
import test from "node:test";
import { RuntimeAdapterError } from "@c-assistant/agent-adapters";
import type { BlueprintGeneration } from "@c-assistant/core";
import {
  blueprintGenerationKey,
  errorDiagnostic,
  generationFailurePath,
  planGenerationFailureCode,
  type PlanGenerationJob,
  publicGenerationJob,
  publicPersistedGeneration,
  updateGenerationJob
} from "./planning-generation-state.js";

test("public generation job omits the abort controller", () => {
  const job = jobFixture();
  const snapshot = publicGenerationJob(job);

  assert.equal(snapshot.sessionId, "session-1");
  assert.equal("controller" in snapshot, false);
});

test("public persisted generation maps completed status and surfaces first failure issue", () => {
  const completed = publicPersistedGeneration(generationFixture({ status: "completed" }));
  assert.equal(completed.status, "succeeded");

  const failed = publicPersistedGeneration(generationFixture({
    status: "failed",
    failure: {
      code: "run_failed",
      stage: "research",
      issues: [{ path: "research.contract", code: "run_failed", message: "Skill output was invalid." }],
      resumable: true
    }
  }));
  assert.equal(failed.status, "failed");
  assert.equal(failed.failureCode, "run_failed");
  assert.equal(failed.message, "Skill output was invalid.");
});

test("planning generation key and failure diagnostics stay deterministic", () => {
  assert.equal(blueprintGenerationKey("session-1", 3), "session-1:3:interactive-trip-planner@0.2.0");
  assert.equal(planGenerationFailureCode(new RuntimeAdapterError("timed_out", "Timeout")), "timed_out");
  assert.equal(planGenerationFailureCode(new Error("Boom")), "generation_failed");
  assert.equal(generationFailurePath(new Error("Research contract failed"), "research"), "research.contract");
  assert.equal(generationFailurePath(new Error("Network failed"), "research"), "research");
  assert.equal(errorDiagnostic(new Error("Outer", { cause: new Error("Inner detail") })), "Inner detail");
});

test("updating a generation job mutates only public state fields and timestamp", () => {
  const job = jobFixture();
  const controller = job.controller;
  const previousUpdatedAt = job.updatedAt;

  updateGenerationJob(job, { stage: "research", status: "running", scopeLabel: "Kyoto", savedPlaceCount: 8, message: "Researching Kyoto." });

  assert.equal(job.controller, controller);
  assert.equal(job.stage, "research");
  assert.equal(job.scopeLabel, "Kyoto");
  assert.equal(job.savedPlaceCount, 8);
  assert.equal(job.message, "Researching Kyoto.");
  assert.notEqual(job.updatedAt, previousUpdatedAt);
});

function jobFixture(): PlanGenerationJob {
  return {
    runId: "run-1",
    sessionId: "session-1",
    generationKey: "generation-1",
    stage: "queued",
    status: "running",
    startedAt: "2026-08-27T00:00:00.000Z",
    updatedAt: "2026-08-27T00:00:00.000Z",
    controller: new AbortController()
  };
}

function generationFixture(overrides: Partial<BlueprintGeneration> = {}): BlueprintGeneration {
  return {
    generationKey: "generation-1",
    proposalRef: { sessionId: "session-1", proposalVersion: 2 },
    skillLineage: { skillId: "interactive-trip-planner", skillVersion: "0.2.0" },
    status: "running",
    stage: "queued",
    createdAt: "2026-08-27T00:00:00.000Z",
    updatedAt: "2026-08-27T00:00:00.000Z",
    ...overrides
  };
}
