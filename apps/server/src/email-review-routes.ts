import type { FastifyInstance } from "fastify";
import type { EmailReviewScope, SqliteWorkspaceStore } from "@c-assistant/storage";
import type { EmailReviewConfiguration } from "./email-review-capability.js";

export function sameEmailReview(a:EmailReviewScope,b:EmailReviewScope):boolean {
  return a.basePlanId===b.basePlanId && a.baseVersion===b.baseVersion && a.draftPlanId===b.draftPlanId && a.draftVersion===b.draftVersion && a.blueprintVersion===b.blueprintVersion && a.recipientRevision===b.recipientRevision;
}

export function registerEmailReviewRoutes(server:FastifyInstance,_dependencies:{store:SqliteWorkspaceStore;getConfiguration?:()=>EmailReviewConfiguration|undefined;getGeneratingPlan?:()=>boolean;startActivePlanMonitoring?:()=>void;now?:()=>Date}){
  const retired = async (_request: unknown, reply: import("fastify").FastifyReply) => reply.header("Cache-Control", "no-store").code(410).send({ code: "email_review_retired", error: "Open your Landi workspace to review and confirm itinerary changes." });
  server.get("/email-review", { logLevel: "silent" }, retired);
  server.post("/api/email-review/view", { logLevel: "silent" }, retired);
  server.post("/api/email-review/confirm", { logLevel: "silent" }, retired);
}
