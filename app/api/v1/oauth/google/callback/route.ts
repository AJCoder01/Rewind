import { NextRequest, NextResponse } from "next/server";
import { apiError } from "@/lib/api/errors";
import { readDashboardActor, readDashboardSessionBinding } from "@/lib/auth/session";
import { GoogleOAuthCallbackQuerySchema } from "@/lib/contracts/oauth";
import { getOAuthStore } from "@/lib/db/index";
import { createOpaqueId } from "@/lib/domain/ids";
import { encryptedGoogleCredential, parseGrantedGoogleScopes } from "@/lib/google/credentials";
import {
  exchangeGoogleAuthorizationCode,
  hashOAuthSecret,
  recoverCodeVerifier,
  requireGoogleOAuthConfiguration,
} from "@/lib/google/oauth";
import { GoogleIdentityValidationError, verifyGoogleIdToken } from "@/lib/google/oidc";

export const runtime = "nodejs";

function callbackQuery(request: NextRequest): Record<string, string> | null {
  const query: Record<string, string> = {};
  for (const [key, value] of request.nextUrl.searchParams.entries()) {
    if (key in query) return null;
    query[key] = value;
  }
  return query;
}

export async function GET(request: NextRequest) {
  const requestId = createOpaqueId("req_");
  const actor = readDashboardActor(request);
  const sessionBinding = readDashboardSessionBinding(request);
  if (!actor || actor.source !== "dashboard" || !sessionBinding) {
    return apiError("unauthorized", "An authenticated dashboard session is required to complete Google OAuth.", requestId, 401);
  }

  const parsedQuery = GoogleOAuthCallbackQuerySchema.safeParse(callbackQuery(request));
  if (!parsedQuery.success) {
    return apiError("invalid_request", "The Google OAuth callback was incomplete; no credential was stored.", requestId, 422);
  }

  try {
    const configuration = requireGoogleOAuthConfiguration();
    const transaction = await getOAuthStore().consumeTransaction({
      stateHash: hashOAuthSecret(parsedQuery.data.state),
      sessionHash: sessionBinding,
      redirectUri: configuration.redirectUri,
      clientId: configuration.clientId,
    });
    if (!transaction) {
      return apiError("invalid_request", "The Google OAuth transaction was invalid, expired, or already used; no credential was stored.", requestId, 422);
    }

    const codeVerifier = recoverCodeVerifier(transaction, configuration.tokenEncryptionKey);
    if (parsedQuery.data.error) {
      return apiError("invalid_request", "Google declined the connection; no credential was stored.", requestId, 422);
    }
    const authorizationCode = parsedQuery.data.code;
    if (!authorizationCode) {
      return apiError("invalid_request", "The Google OAuth callback was incomplete; no credential was stored.", requestId, 422);
    }

    const tokenResponse = await exchangeGoogleAuthorizationCode(
      configuration,
      { redirectUri: transaction.redirectUri, codeVerifier },
      authorizationCode,
    );
    const identity = await verifyGoogleIdToken(tokenResponse.id_token, {
      clientId: configuration.clientId,
      expectedEmail: configuration.expectedEmail,
      expectedSub: configuration.expectedSub,
      nonceHash: transaction.nonceHash,
    });
    const scopes = parseGrantedGoogleScopes(tokenResponse.scope);
    const credential = encryptedGoogleCredential({ ...identity, scopes: [...scopes] }, tokenResponse, configuration.tokenEncryptionKey);
    await getOAuthStore().saveCredential(credential);

    const response = NextResponse.json(
      { status: "connected", provider: "google", requestId },
      { status: 200, headers: { "cache-control": "no-store", "referrer-policy": "no-referrer" } },
    );
    response.headers.set("x-content-type-options", "nosniff");
    return response;
  } catch (error) {
    // Keep account-substitution and signature/claim failures distinct from a
    // transient key/token-endpoint outage without exposing provider details.
    if (error instanceof GoogleIdentityValidationError) {
      return apiError("forbidden", "The Google account is not authorized for this demo; no credential was stored.", requestId, 403);
    }
    return apiError("provider_unavailable", "The Google OAuth transaction could not be completed safely; no credential was stored.", requestId, 503, true);
  }
}
