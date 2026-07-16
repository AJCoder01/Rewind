import { NextRequest, NextResponse } from "next/server";
import { apiError } from "@/lib/api/errors";
import { readDashboardActor, readDashboardSessionBinding } from "@/lib/auth/session";
import { GoogleOAuthCallbackQuerySchema } from "@/lib/contracts/oauth";
import { getOAuthStore } from "@/lib/db/index";
import { createOpaqueId } from "@/lib/domain/ids";
import {
  encryptedGoogleCredential,
  GoogleOAuthScopeValidationError,
  parseGrantedGoogleScopes,
} from "@/lib/google/credentials";
import {
  exchangeGoogleAuthorizationCode,
  GoogleOAuthProviderError,
  hashOAuthSecret,
  OAuthSecretError,
  recoverCodeVerifier,
  requireGoogleOAuthConfiguration,
} from "@/lib/google/oauth";
import {
  GoogleIdentityProviderError,
  GoogleIdentityValidationError,
  verifyGoogleIdToken,
} from "@/lib/google/oidc";

export const runtime = "nodejs";

const MAX_CALLBACK_PARAMETERS = 32;
const MAX_CALLBACK_PARAMETER_NAME_LENGTH = 128;
const MAX_CALLBACK_PARAMETER_VALUE_LENGTH = 8192;

function callbackQuery(request: NextRequest): Record<string, string> | null {
  const query: Record<string, string> = {};
  let count = 0;
  for (const [key, value] of request.nextUrl.searchParams.entries()) {
    count += 1;
    if (
      count > MAX_CALLBACK_PARAMETERS ||
      key.length === 0 ||
      key.length > MAX_CALLBACK_PARAMETER_NAME_LENGTH ||
      value.length > MAX_CALLBACK_PARAMETER_VALUE_LENGTH ||
      key in query
    ) {
      return null;
    }
    query[key] = value;
  }
  return query;
}

type GoogleOAuthCallbackStage =
  | "configuration"
  | "transaction_store"
  | "transaction_secret"
  | "callback_scope"
  | "token_exchange"
  | "identity_verification"
  | "token_scope"
  | "credential_encryption"
  | "credential_persistence";

type GoogleOAuthCallbackFailure = Readonly<{
  stage: GoogleOAuthCallbackStage;
  reason: string;
  retryable: boolean;
}>;

function callbackFailure(error: unknown, stage: GoogleOAuthCallbackStage): GoogleOAuthCallbackFailure {
  if (error instanceof GoogleOAuthProviderError) {
    return { stage, reason: error.reason, retryable: error.retryable };
  }
  if (error instanceof GoogleIdentityProviderError) {
    return { stage, reason: "identity_keys_unavailable", retryable: true };
  }
  if (error instanceof GoogleOAuthScopeValidationError) {
    return { stage, reason: error.reason, retryable: false };
  }
  if (error instanceof OAuthSecretError) {
    return { stage, reason: "oauth_secret_unavailable", retryable: false };
  }
  if (stage === "configuration") return { stage, reason: "configuration_invalid", retryable: false };
  if (stage === "transaction_store") return { stage, reason: "transaction_store_unavailable", retryable: true };
  if (stage === "credential_persistence") return { stage, reason: "credential_store_unavailable", retryable: true };
  if (stage === "credential_encryption") return { stage, reason: "credential_encryption_failed", retryable: false };
  return { stage, reason: "unexpected_boundary_failure", retryable: true };
}

function logCallbackFailure(requestId: string, failure: GoogleOAuthCallbackFailure): void {
  // Do not pass the caught error object: provider bodies, tokens, codes, and
  // private configuration are forbidden in logs. These fields are allowlisted.
  console.warn(JSON.stringify({ event: "oauth.google.callback_failed", requestId, ...failure }));
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

  let stage: GoogleOAuthCallbackStage = "configuration";
  try {
    const configuration = requireGoogleOAuthConfiguration();
    stage = "transaction_store";
    const transaction = await getOAuthStore().consumeTransaction({
      stateHash: hashOAuthSecret(parsedQuery.data.state),
      sessionHash: sessionBinding,
      redirectUri: configuration.redirectUri,
      clientId: configuration.clientId,
    });
    if (!transaction) {
      return apiError("invalid_request", "The Google OAuth transaction was invalid, expired, or already used; no credential was stored.", requestId, 422);
    }

    if (parsedQuery.data.error) {
      return apiError("invalid_request", "Google declined the connection; no credential was stored.", requestId, 422);
    }
    const authorizationCode = parsedQuery.data.code;
    if (!authorizationCode) {
      return apiError("invalid_request", "The Google OAuth callback was incomplete; no credential was stored.", requestId, 422);
    }

    stage = "callback_scope";
    if (parsedQuery.data.scope) parseGrantedGoogleScopes(parsedQuery.data.scope);

    stage = "transaction_secret";
    const codeVerifier = recoverCodeVerifier(transaction, configuration.tokenEncryptionKey);
    stage = "token_exchange";
    const tokenResponse = await exchangeGoogleAuthorizationCode(
      configuration,
      { redirectUri: transaction.redirectUri, codeVerifier },
      authorizationCode,
    );
    stage = "identity_verification";
    const identity = await verifyGoogleIdToken(tokenResponse.id_token, {
      clientId: configuration.clientId,
      expectedEmail: configuration.expectedEmail,
      expectedSub: configuration.expectedSub,
      nonceHash: transaction.nonceHash,
    });
    stage = "token_scope";
    const scopes = parseGrantedGoogleScopes(tokenResponse.scope);
    stage = "credential_encryption";
    const credential = encryptedGoogleCredential({ ...identity, scopes: [...scopes] }, tokenResponse, configuration.tokenEncryptionKey);
    stage = "credential_persistence";
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
      const failure = { stage, reason: "identity_not_authorized", retryable: false } as const;
      logCallbackFailure(requestId, failure);
      return apiError(
        "forbidden",
        "The Google account is not authorized for this demo; no credential was stored.",
        requestId,
        403,
        false,
        { failureStage: failure.stage, failureReason: failure.reason },
      );
    }
    const failure = callbackFailure(error, stage);
    logCallbackFailure(requestId, failure);
    if (error instanceof GoogleOAuthScopeValidationError) {
      return apiError(
        "forbidden",
        "The Google grant did not contain exactly the approved permissions; no credential was stored.",
        requestId,
        403,
        false,
        { failureStage: failure.stage, failureReason: failure.reason },
      );
    }
    return apiError(
      "provider_unavailable",
      "The Google OAuth transaction could not be completed safely; no credential was stored.",
      requestId,
      503,
      failure.retryable,
      { failureStage: failure.stage, failureReason: failure.reason },
    );
  }
}
