import { NextRequest } from "next/server";
import { apiError } from "@/lib/api/errors";
import { readDashboardActor, readDashboardSessionBinding } from "@/lib/auth/session";
import { GoogleOAuthCallbackQuerySchema } from "@/lib/contracts/oauth";
import { getOAuthStore } from "@/lib/db/index";
import { createOpaqueId } from "@/lib/domain/ids";
import {
  hashOAuthSecret,
  recoverCodeVerifier,
  requireGoogleOAuthConfiguration,
} from "@/lib/google/oauth";

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

    // S032 adds signed OIDC claim validation and the provider token exchange.
    // Decrypting the verifier here proves that the one-use transaction retains
    // the PKCE secret without returning it to the browser. No token is stored
    // until the identity gate is present.
    recoverCodeVerifier(transaction, configuration.tokenEncryptionKey);
    if (parsedQuery.data.error) {
      return apiError("invalid_request", "Google declined the connection; no credential was stored.", requestId, 422);
    }
    return apiError("provider_unavailable", "Google identity validation is not enabled yet; no credential was stored.", requestId, 503, false);
  } catch {
    return apiError("provider_unavailable", "The Google OAuth transaction could not be completed safely; no credential was stored.", requestId, 503, true);
  }
}
