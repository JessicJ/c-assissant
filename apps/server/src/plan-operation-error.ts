import { DirectBlueprintHighImpactError, DirectBlueprintReplanRequirementError, WorkspaceMutationError, workspaceMutationMessages, type WorkspaceMutationErrorCode } from "@c-assistant/core";
import { PlanRouteRefreshError } from "./plan-route-refresh.js";
import type { FastifyReply, FastifyRequest } from "fastify";
import { connectorResponseStatus } from "./connector-bundle.js";

export const planOperationRouteOptions = {
  errorHandler(error: Error, _request: FastifyRequest, reply: FastifyReply) {
    const failure = planOperationError(error);
    return reply.code(failure.status).send(failure.body);
  }
};

export function planOperationRejection(code: WorkspaceMutationErrorCode) {
  return { code, error: workspaceMutationMessages[code] };
}

/** 异常文本仅作内部诊断；HTTP 产品合同由明确类型决定。 */
export function planOperationError(error: unknown): { status: number; body: Record<string, unknown> } {
  if (error instanceof DirectBlueprintHighImpactError) return { status: 409, body: { code: error.code, error: error.impact.bookingImpact.canConfirm ? "删除必访地点前，请审阅影响并确认。" : "部分预订与行程的关联尚未核对，请先审阅预订关联。", impact: error.impact } };
  if (error instanceof DirectBlueprintReplanRequirementError) return { status: 409, body: { code: error.code, error: "这次修改需要辅助重规划，请审阅影响后继续。", replanRequirement: error.replanRequirement } };
  if (error instanceof WorkspaceMutationError) return {
    status: ["invalid_edit", "empty_edits", "too_many_edits", "invalid_placement"].includes(error.code) ? 400 : error.code === "operation_not_found" ? 404 : 409,
    body: { code: error.code, error: workspaceMutationMessages[error.code] }
  };
  if (error instanceof PlanRouteRefreshError) return { status: error.connectorStatus ? connectorResponseStatus(error.connectorStatus) : error.code === "missing_segment" ? 404 : error.code === "unsupported_mode" ? 422 : 400, body: { code: error.code, error: "暂时无法更新所选路线，请检查路线后重试。" } };
  return { status: 500, body: { code: "internal_error", error: workspaceMutationMessages.internal_error } };
}
