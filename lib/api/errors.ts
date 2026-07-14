import { NextResponse } from "next/server";
import type { ErrorCode } from "@/lib/contracts/v1";

export function apiError(code: ErrorCode, message: string, requestId: string, status: number, retryable = false): NextResponse {
  return NextResponse.json({ error: { code, message, retryable }, requestId }, { status });
}

export function statusForCode(code: ErrorCode): number {
  if (code === "unauthorized") return 401;
  if (code === "forbidden") return 403;
  if (code === "invalid_request" || code === "unsupported_request") return 422;
  if (code === "idempotency_conflict" || code === "scenario_busy") return 409;
  if (code === "task_not_found") return 404;
  return 500;
}
