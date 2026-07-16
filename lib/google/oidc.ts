import { createPublicKey, createVerify } from "node:crypto";
import { z } from "zod";
import {
  GoogleOidcClaimsSchema,
  GoogleOidcJwtHeaderSchema,
  type GoogleOidcClaims,
} from "@/lib/contracts/oauth";
import {
  constantTimeSecretEqual,
  GOOGLE_OAUTH_PROVIDER_TIMEOUT_MS,
  hashOAuthSecret,
} from "@/lib/google/oauth";

export const GOOGLE_OIDC_JWKS_URI = "https://www.googleapis.com/oauth2/v3/certs" as const;
export const GOOGLE_OIDC_CLOCK_SKEW_SECONDS = 300;

const GoogleJwkSchema = z
  .object({
    kty: z.literal("RSA"),
    kid: z.string().min(1).max(255),
    n: z.string().min(1).max(8192).regex(/^[A-Za-z0-9_-]+$/),
    e: z.string().min(1).max(32).regex(/^[A-Za-z0-9_-]+$/),
    alg: z.literal("RS256").optional(),
    use: z.literal("sig").optional(),
    key_ops: z.array(z.string().min(1).max(32)).max(4).optional(),
    x5t: z.string().min(1).max(255).optional(),
    x5c: z.array(z.string().min(1).max(8192)).max(4).optional(),
  })
  .strip();

const GoogleJwkSetSchema = z
  .object({ keys: z.array(GoogleJwkSchema).min(1).max(20) })
  .strip();

export type GoogleJwk = z.infer<typeof GoogleJwkSchema>;
export type GoogleJwkSet = z.infer<typeof GoogleJwkSetSchema>;

export class GoogleIdentityValidationError extends Error {
  constructor(message = "Google identity validation failed safely.") {
    super(message);
    this.name = "GoogleIdentityValidationError";
  }
}

export class GoogleIdentityProviderError extends Error {
  constructor(message = "Google identity keys were unavailable safely.") {
    super(message);
    this.name = "GoogleIdentityProviderError";
  }
}

export type GoogleIdentityValidationOptions = Readonly<{
  clientId: string;
  expectedEmail: string;
  expectedSub: string;
  nonceHash: string;
  now?: Date;
  jwks?: GoogleJwkSet;
  fetchImpl?: typeof fetch;
}>;

export type ValidatedGoogleOidcIdentity = Readonly<{
  googleSub: string;
  email: string;
}>;

function decodeBase64Url(value: string): Buffer {
  if (!value || !/^[A-Za-z0-9_-]+$/.test(value)) throw new GoogleIdentityValidationError();
  const decoded = Buffer.from(value, "base64url");
  if (decoded.length === 0) throw new GoogleIdentityValidationError();
  return decoded;
}

function decodeJson(value: string): unknown {
  try {
    return JSON.parse(decodeBase64Url(value).toString("utf8")) as unknown;
  } catch {
    throw new GoogleIdentityValidationError();
  }
}

export function parseGoogleJwks(value: unknown): GoogleJwkSet {
  const parsed = GoogleJwkSetSchema.safeParse(value);
  if (!parsed.success) throw new GoogleIdentityProviderError();
  return parsed.data;
}

export async function fetchGoogleJwks(fetchImpl: typeof fetch = fetch): Promise<GoogleJwkSet> {
  let response: Response;
  try {
    response = await fetchImpl(GOOGLE_OIDC_JWKS_URI, {
      method: "GET",
      headers: { accept: "application/json" },
      cache: "no-store",
      redirect: "error",
      signal: AbortSignal.timeout(GOOGLE_OAUTH_PROVIDER_TIMEOUT_MS),
    });
  } catch {
    throw new GoogleIdentityProviderError();
  }
  if (!response.ok) throw new GoogleIdentityProviderError();

  let decoded: unknown;
  try {
    decoded = await response.json();
  } catch {
    throw new GoogleIdentityProviderError();
  }
  return parseGoogleJwks(decoded);
}

function audiencesFromClaims(claims: GoogleOidcClaims): string[] {
  return Array.isArray(claims.aud) ? claims.aud : [claims.aud];
}

function validateClaims(claims: GoogleOidcClaims, options: GoogleIdentityValidationOptions): void {
  const now = options.now ?? new Date();
  const nowSeconds = Math.floor(now.getTime() / 1000);
  if (!Number.isFinite(nowSeconds)) throw new GoogleIdentityValidationError();

  const audiences = audiencesFromClaims(claims);
  if (!audiences.includes(options.clientId)) throw new GoogleIdentityValidationError();
  if (claims.azp && claims.azp !== options.clientId) throw new GoogleIdentityValidationError();
  if (audiences.length > 1 && claims.azp !== options.clientId) throw new GoogleIdentityValidationError();

  if (claims.exp <= nowSeconds - GOOGLE_OIDC_CLOCK_SKEW_SECONDS) throw new GoogleIdentityValidationError();
  if (claims.iat > nowSeconds + GOOGLE_OIDC_CLOCK_SKEW_SECONDS) throw new GoogleIdentityValidationError();
  if (claims.exp <= claims.iat) throw new GoogleIdentityValidationError();
  if (!claims.email_verified) throw new GoogleIdentityValidationError();

  if (!constantTimeSecretEqual(hashOAuthSecret(claims.nonce), options.nonceHash)) {
    throw new GoogleIdentityValidationError();
  }
  if (!constantTimeSecretEqual(claims.sub, options.expectedSub)) throw new GoogleIdentityValidationError();
  if (!constantTimeSecretEqual(claims.email.toLowerCase(), options.expectedEmail.toLowerCase())) {
    throw new GoogleIdentityValidationError();
  }
}

/**
 * Verify a Google ID token locally after fetching only Google's published
 * signing keys.  No token-info, Gmail profile, or mailbox endpoint is used.
 */
export async function verifyGoogleIdToken(
  idToken: string,
  options: GoogleIdentityValidationOptions,
): Promise<ValidatedGoogleOidcIdentity> {
  if (!idToken || idToken.length > 32_000) throw new GoogleIdentityValidationError();
  const parts = idToken.split(".");
  if (parts.length !== 3) throw new GoogleIdentityValidationError();

  const headerResult = GoogleOidcJwtHeaderSchema.safeParse(decodeJson(parts[0]));
  const claimsResult = GoogleOidcClaimsSchema.safeParse(decodeJson(parts[1]));
  if (!headerResult.success || !claimsResult.success) throw new GoogleIdentityValidationError();

  const jwks = options.jwks ?? (await fetchGoogleJwks(options.fetchImpl));
  const key = jwks.keys.find((candidate) => candidate.kid === headerResult.data.kid);
  if (!key) throw new GoogleIdentityValidationError();

  let verified = false;
  try {
    const publicKey = createPublicKey({
      key: { kty: key.kty, n: key.n, e: key.e },
      format: "jwk",
    });
    const verifier = createVerify("RSA-SHA256");
    verifier.update(`${parts[0]}.${parts[1]}`, "ascii");
    verifier.end();
    verified = verifier.verify(publicKey, decodeBase64Url(parts[2]));
  } catch {
    throw new GoogleIdentityValidationError();
  }
  if (!verified) throw new GoogleIdentityValidationError();

  validateClaims(claimsResult.data, options);
  return { googleSub: claimsResult.data.sub, email: claimsResult.data.email.toLowerCase() };
}
