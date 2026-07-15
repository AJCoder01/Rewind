import { NextRequest, NextResponse } from "next/server";
import { apiError } from "@/lib/api/errors";
import { createSessionValue, isSameOrigin, safeSecretEqual, sessionCookieName } from "@/lib/auth/session";
import { createOpaqueId } from "@/lib/domain/ids";

export const runtime = "nodejs";

export async function POST(request: NextRequest) {
  const requestId = createOpaqueId("req_");
  if (!isSameOrigin(request)) return apiError("forbidden", "Sign-in requests must come from this Rewind workspace.", requestId, 403);
  const body: unknown = await request.json().catch(() => null);
  if (typeof body !== "object" || body === null || !("passcode" in body) || typeof body.passcode !== "string") {
    return apiError("invalid_request", "A dashboard passcode is required.", requestId, 422);
  }
  const configured = process.env.REWIND_DASHBOARD_PASSCODE;
  if (!configured || !safeSecretEqual(body.passcode, configured)) {
    return apiError("unauthorized", "The dashboard passcode was not accepted.", requestId, 401);
  }
  let sessionValue: string;
  try {
    sessionValue = createSessionValue("demo-operator");
  } catch {
    return apiError("provider_unavailable", "Dashboard authentication is not configured; no session was created.", requestId, 503, true);
  }
  const response = NextResponse.json({ status: "authenticated" });
  response.cookies.set(sessionCookieName(), sessionValue, { httpOnly: true, sameSite: "lax", secure: process.env.NODE_ENV === "production", path: "/", maxAge: 60 * 60 * 8 });
  return response;
}
