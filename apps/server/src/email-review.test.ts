import assert from "node:assert/strict";
import test from "node:test";
import Fastify from "fastify";
import { registerEmailReviewRoutes } from "./email-review-routes.js";
import { issueReviewCapability } from "./email-review-capability.js";

// Superseded positive-capability scenarios are preserved verbatim in
// scripts/historical/email-review.test.ts.txt. Confirmation belongs to the Web workspace.
test("retired review routes are inert for absent, malformed and formerly valid capabilities", async () => {
  const server = Fastify();
  let accesses = 0;
  const forbidden = new Proxy({}, { get() { accesses++; throw new Error("Retired route touched business state"); } });
  registerEmailReviewRoutes(server, { store: forbidden as Parameters<typeof registerEmailReviewRoutes>[1]["store"],
    getConfiguration: () => { accesses++; throw new Error("No configuration read"); },
    startActivePlanMonitoring: () => { accesses++; throw new Error("No monitoring activation"); } });
  const token = issueReviewCapability({ basePlanId: "fictional-base", baseVersion: 1, draftPlanId: "fictional-draft", draftVersion: 2, recipientRevision: 1 },
    { baseUrl: "https://review.example.test", signingKey: "0".repeat(64) }, Date.now() + 60_000);
  try {
    for (const capability of [undefined, "malformed", token]) {
      for (const [method, url] of [["GET", "/email-review"], ["POST", "/api/email-review/view"], ["POST", "/api/email-review/confirm"]] as const) {
        const response = await server.inject({ method, url, ...(capability ? { headers: { authorization: `Bearer ${capability}` } } : {}),
          ...(method === "POST" ? { payload: { confirmed: true, expectedVersion: 2 } } : {}) });
        assert.equal(response.statusCode, 410);
        assert.equal(response.headers["cache-control"], "no-store");
        assert.deepEqual(response.json(), { code: "email_review_retired", error: "Open your Landi workspace to review and confirm itinerary changes." });
        assert.ok(!response.body.includes(token));
      }
    }
    assert.equal(accesses, 0);
  } finally { await server.close(); }
});
