import { z } from "zod";
import type { OAuthCredentialRecord, OAuthCredentialWrite, OAuthStore } from "@/lib/db/oauth-store";
import {
  buildGoogleRefreshTokenBody,
  decryptOAuthSecret,
  encryptOAuthSecret,
  GOOGLE_OAUTH_SCOPES,
  GoogleOAuthTokenResponseSchema,
  requestGoogleToken,
  type GoogleOAuthTokenResponse,
} from "@/lib/google/oauth";
import type { GoogleOAuthConfiguration } from "@/lib/google/oauth";

export const ValidatedGoogleIdentitySchema = z
  .object({
    googleSub: z.string().min(1).max(255).refine((value) => value === value.trim() && !/\s/.test(value)),
    email: z.string().email().max(320).transform((value) => value.toLowerCase()),
    scopes: z.array(z.enum(GOOGLE_OAUTH_SCOPES)).min(1).max(GOOGLE_OAUTH_SCOPES.length).refine((values) => new Set(values).size === values.length),
  })
  .strict();

export type ValidatedGoogleIdentity = z.infer<typeof ValidatedGoogleIdentitySchema>;

export type GoogleOAuthScope = (typeof GOOGLE_OAUTH_SCOPES)[number];

/** The authorization grant must contain exactly the four approved scopes. */
export function parseGrantedGoogleScopes(scope: string | undefined): readonly GoogleOAuthScope[] {
  if (!scope || scope.trim() !== scope) throw new Error("Google OAuth scopes were not returned safely.");
  const values = scope.split(/\s+/);
  if (
    values.length !== GOOGLE_OAUTH_SCOPES.length ||
    new Set(values).size !== values.length ||
    values.some((value) => !GOOGLE_OAUTH_SCOPES.includes(value as GoogleOAuthScope)) ||
    GOOGLE_OAUTH_SCOPES.some((value) => !values.includes(value))
  ) {
    throw new Error("Google OAuth scopes were outside the approved set.");
  }
  return [...GOOGLE_OAUTH_SCOPES];
}

/**
 * The callback may call this only after S032 has validated the signed OIDC
 * identity. It accepts a token response as untrusted provider data and emits
 * only the encrypted refresh-token form understood by the persistence layer.
 */
export function encryptedGoogleCredential(
  identity: ValidatedGoogleIdentity,
  tokenResponse: GoogleOAuthTokenResponse,
  encryptionKey: string,
): OAuthCredentialWrite {
  const parsedIdentity = ValidatedGoogleIdentitySchema.parse(identity);
  const parsedToken = GoogleOAuthTokenResponseSchema.parse(tokenResponse);
  if (!parsedToken.refresh_token) throw new Error("Google did not return a refresh token; no credential was stored.");
  const approvedScopes = parseGrantedGoogleScopes(parsedIdentity.scopes.join(" "));
  return {
    provider: "google",
    googleSub: parsedIdentity.googleSub,
    email: parsedIdentity.email,
    refreshTokenCiphertext: encryptOAuthSecret(parsedToken.refresh_token, encryptionKey),
    scopes: [...approvedScopes],
  };
}

export type RefreshedGoogleAccessToken = Readonly<{
  accessToken: string;
  tokenType: "Bearer";
  expiresAt: Date;
}>;

/**
 * Refresh an access token using only the encrypted, account-bound refresh
 * token.  A rotated refresh token is encrypted before replacing the stored
 * credential; the short-lived access token is returned to the server caller
 * and is never persisted or exposed to the browser.
 */
export async function refreshGoogleAccessToken(
  configuration: Pick<GoogleOAuthConfiguration, "clientId" | "clientSecret">,
  credential: OAuthCredentialRecord,
  encryptionKey: string,
  store: Pick<OAuthStore, "saveCredential">,
  fetchImpl: typeof fetch = fetch,
  now = new Date(),
): Promise<RefreshedGoogleAccessToken> {
  const parsedIdentity = ValidatedGoogleIdentitySchema.parse({
    googleSub: credential.googleSub,
    email: credential.email,
    scopes: credential.scopes,
  });
  const approvedScopes = parseGrantedGoogleScopes(parsedIdentity.scopes.join(" "));
  const refreshToken = decryptOAuthSecret(credential.refreshTokenCiphertext, encryptionKey);
  const response = await requestGoogleToken(buildGoogleRefreshTokenBody(configuration, refreshToken), fetchImpl);
  if (response.scope) {
    const refreshedScopes = parseGrantedGoogleScopes(response.scope);
    if (refreshedScopes.join(" ") !== approvedScopes.join(" ")) {
      throw new Error("Google refresh response changed the approved scopes.");
    }
  }

  if (response.refresh_token) {
    await store.saveCredential({
      provider: "google",
      googleSub: parsedIdentity.googleSub,
      email: parsedIdentity.email,
      refreshTokenCiphertext: encryptOAuthSecret(response.refresh_token, encryptionKey),
      scopes: [...approvedScopes],
    });
  }

  return {
    accessToken: response.access_token,
    tokenType: response.token_type,
    expiresAt: new Date(now.getTime() + response.expires_in * 1000),
  };
}
