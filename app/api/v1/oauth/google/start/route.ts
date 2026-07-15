import { NextRequest, NextResponse } from "next/server";
import { apiError } from "@/lib/api/errors";
import { readDashboardActor, readDashboardSessionBinding } from "@/lib/auth/session";
import { getOAuthStore } from "@/lib/db/index";
import { createOpaqueId } from "@/lib/domain/ids";
import {
  buildGoogleAuthorizationUrl,
  createGoogleOAuthTransaction,
  requireGoogleOAuthConfiguration,
  toStoredGoogleOAuthTransaction,
} from "@/lib/google/oauth";

export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  const requestId = createOpaqueId("req_");
  const actor = readDashboardActor(request);
  const sessionBinding = readDashboardSessionBinding(request);
  if (!actor || actor.source !== "dashboard" || !sessionBinding) {
    return apiError("unauthorized", "An authenticated dashboard session is required to connect Google.", requestId, 401);
  }

  try {
    const configuration = requireGoogleOAuthConfiguration();
    const transaction = createGoogleOAuthTransaction(configuration);
    const stored = toStoredGoogleOAuthTransaction(
      transaction,
      sessionBinding,
      configuration.tokenEncryptionKey,
    );
    await getOAuthStore().createTransaction(stored);
    const authorizationUrl = buildGoogleAuthorizationUrl(configuration, transaction);
    const response = NextResponse.redirect(authorizationUrl);
    response.headers.set("cache-control", "no-store");
    response.headers.set("referrer-policy", "no-referrer");
    response.headers.set("x-content-type-options", "nosniff");
    return response;
  } catch {
    return apiError("provider_unavailable", "Google OAuth is not configured; no connection was started.", requestId, 503, true);
  }
}
