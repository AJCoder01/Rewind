import { NextResponse } from "next/server";
import { ApiErrorResponseSchema, type ErrorCode } from "@/lib/contracts/v1";

export function apiError(
  code: ErrorCode,
  message: string,
  requestId: string,
  status: number,
  retryable = false,
  details?: Record<string, string | number | boolean>,
): NextResponse {
  const body = ApiErrorResponseSchema.parse({ error: { code, message, retryable, ...(details ? { details } : {}) }, requestId });
  return NextResponse.json(body, { status, headers: { "cache-control": "no-store" } });
}

export function statusForCode(code: ErrorCode): number {
  if (code === "unauthorized") return 401;
  if (code === "forbidden") return 403;
  if (code === "invalid_request" || code === "unsupported_request") return 422;
  if (code === "idempotency_conflict" || code === "scenario_busy") return 409;
  if (code === "task_not_found") return 404;
  if (code === "invalid_task_state" || code === "plan_digest_mismatch" || code === "plan_stale" || code === "provider_conflict" || code === "reset_conflict") return 409;
  if (code === "clarification_required" || code === "candidate_set_invalid" || code === "model_output_invalid" || code === "unknown_entity" || code === "unknown_action" || code === "unknown_template" || code === "recipient_not_allowed") return 422;
  if (code === "approval_required" || code === "action_not_retryable") return 409;
  if (code === "provider_unavailable" || code === "delivery_uncertain") return 503;
  return 500;
}
