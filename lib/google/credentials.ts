import { z } from "zod";
import type { OAuthCredentialWrite } from "@/lib/db/oauth-store";
import {
  encryptOAuthSecret,
  GOOGLE_OAUTH_SCOPES,
  GoogleOAuthTokenResponseSchema,
  type GoogleOAuthTokenResponse,
} from "@/lib/google/oauth";

export const ValidatedGoogleIdentitySchema = z
  .object({
    googleSub: z.string().min(1).max(255).refine((value) => value === value.trim() && !/\s/.test(value)),
    email: z.string().email().max(320).transform((value) => value.toLowerCase()),
    scopes: z.array(z.enum(GOOGLE_OAUTH_SCOPES)).min(1).max(GOOGLE_OAUTH_SCOPES.length).refine((values) => new Set(values).size === values.length),
  })
  .strict();

export type ValidatedGoogleIdentity = z.infer<typeof ValidatedGoogleIdentitySchema>;

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
  return {
    provider: "google",
    googleSub: parsedIdentity.googleSub,
    email: parsedIdentity.email,
    refreshTokenCiphertext: encryptOAuthSecret(parsedToken.refresh_token, encryptionKey),
    scopes: [...parsedIdentity.scopes],
  };
}
