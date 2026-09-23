import assert from "node:assert/strict";
import test from "node:test";
import type { PlanningSession } from "@c-assistant/core";
import { semanticFixedCommitmentsFromBookingConstraints } from "@c-assistant/agent-adapters";
import { authoritativeSemanticCommitmentConstraints } from "./semantic-draft-canary.js";

test("explicit confirmed user flight fact becomes a fixed commitment without a booking row", () => {
  const session: PlanningSession = {
    id: "session-user-flight",
    status: "proposal_confirmed",
    objectiveType: "travel",
    messages: [{ id: "message", role: "user", text: "2026年10月3日16:30从洛杉矶LAX出发，经新加坡转机，10月5日10:35抵达巴厘岛DPS。", createdAt: "2026-09-21T00:00:00.000Z" }],
    facts: [], unresolved: [], deferred: [], confirmedProposalVersion: 1,
    createdAt: "2026-09-21T00:00:00.000Z", updatedAt: "2026-09-21T00:00:00.000Z"
  };
  const constraints = authoritativeSemanticCommitmentConstraints(session, []);
  const commitments = semanticFixedCommitmentsFromBookingConstraints(constraints);
  assert.equal(commitments.length, 1);
  assert.equal(commitments[0]?.startAtLocal, "2026-10-03T16:30");
  assert.equal(commitments[0]?.startTimeZone, "America/Los_Angeles");
  assert.equal(commitments[0]?.origin, "Los Angeles International Airport (LAX)");
  assert.equal(commitments[0]?.destination, "新加坡");
  assert.equal(commitments[0]?.fixed, true);
});
