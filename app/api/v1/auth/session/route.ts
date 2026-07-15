import { NextRequest, NextResponse } from "next/server";
import { apiError } from "@/lib/api/errors";
import { createCsrfToken, createSessionValue, isSameOrigin, safeSecretEqual, setSessionCookies } from "@/lib/auth/session";
import { createOpaqueId } from "@/lib/domain/ids";
import { DashboardSessionRequestSchema } from "@/lib/contracts/v1";

export const runtime = "nodejs";

export async function POST(request: NextRequest) {
  const requestId = createOpaqueId("req_");
  if (!isSameOrigin(request)) return apiError("forbidden", "Sign-in requests must come from this Rewind workspace.", requestId, 403);
  const body: unknown = await request.json().catch(() => null);
  const parsedBody = DashboardSessionRequestSchema.safeParse(body);
  if (!parsedBody.success) {
    return apiError("invalid_request", "A dashboard passcode is required.", requestId, 422);
  }
  const configured = process.env.REWIND_DASHBOARD_PASSCODE;
  if (!configured || !safeSecretEqual(parsedBody.data.passcode, configured)) {
    return apiError("unauthorized", "The dashboard passcode was not accepted.", requestId, 401);
  }
  let sessionValue: string;
  try {
    sessionValue = createSessionValue("demo-operator");
  } catch {
    return apiError("provider_unavailable", "Dashboard authentication is not configured; no session was created.", requestId, 503, true);
  }
  const response = NextResponse.json({ status: "authenticated" }, { headers: { "cache-control": "no-store" } });
  setSessionCookies(response, sessionValue, createCsrfToken());
  return response;
}
