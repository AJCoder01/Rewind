import {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes,
  timingSafeEqual,
} from "node:crypto";
import { z } from "zod";
import { createOpaqueId } from "@/lib/domain/ids";
import { buildGoogleRedirectUri, validateGoogleRedirectUri } from "@/lib/google/redirects";

export const GOOGLE_OAUTH_AUTHORIZATION_ENDPOINT = "https://accounts.google.com/o/oauth2/v2/auth" as const;
export const GOOGLE_OAUTH_TOKEN_ENDPOINT = "https://oauth2.googleapis.com/token" as const;
export const GOOGLE_OAUTH_TRANSACTION_TTL_MS = 10 * 60 * 1000;
export const GOOGLE_OAUTH_SCOPES = [
  "openid",
  "email",
  "https://www.googleapis.com/auth/calendar.events.owned",
  "https://www.googleapis.com/auth/gmail.send",
] as const;

export const GoogleOAuthTokenResponseSchema = z
  .object({
    access_token: z.string().min(1).max(8192),
    token_type: z.literal("Bearer"),
    expires_in: z.number().int().positive().max(86_400),
    refresh_token: z.string().min(1).max(8192).optional(),
    scope: z.string().min(1).max(2000).optional(),
    id_token: z.string().min(1).max(32_000).optional(),
  })
  .strict();

export type GoogleOAuthTokenResponse = z.infer<typeof GoogleOAuthTokenResponseSchema>;

export type GoogleOAuthConfiguration = Readonly<{
  appBaseUrl: string;
  redirectUri: string;
  clientId: string;
  clientSecret: string;
  tokenEncryptionKey: string;
  expectedEmail: string;
  expectedSub: string;
}>;

export class GoogleOAuthProviderError extends Error {
  constructor(message = "Google OAuth provider response was not usable safely.") {
    super(message);
    this.name = "GoogleOAuthProviderError";
  }
}

export type GoogleOAuthTransaction = Readonly<{
  id: string;
  state: string;
  nonce: string;
  codeVerifier: string;
  codeChallenge: string;
  redirectUri: string;
  clientId: string;
  createdAt: Date;
  expiresAt: Date;
}>;

export type StoredGoogleOAuthTransaction = Readonly<{
  id: string;
  provider: "google";
  stateHash: string;
  sessionHash: string;
  nonceHash: string;
  codeVerifierCiphertext: string;
  redirectUri: string;
  clientId: string;
  createdAt: Date;
  expiresAt: Date;
  consumedAt: Date | null;
}>;

export class OAuthSecretError extends Error {
  constructor(message = "OAuth secret could not be protected safely.") {
    super(message);
    this.name = "OAuthSecretError";
  }
}

function requireSecretKey(key: string): Buffer {
  if (!key || key.trim() !== key || key.length < 32 || /\s/.test(key)) {
    throw new OAuthSecretError("The OAuth encryption key is invalid.");
  }
  // The deployment contract accepts a high-entropy private string. Hashing it
  // into a fixed-size key keeps the at-rest envelope format independent of the
  // secret's transport encoding without exposing the secret itself.
  return createHash("sha256").update("rewind/oauth-secret/v1\0", "utf8").update(key, "utf8").digest();
}

function base64Url(value: Buffer): string {
  return value.toString("base64url");
}

function decodeBase64Url(value: string, expectedLength?: number): Buffer {
  if (!/^[A-Za-z0-9_-]+$/.test(value)) throw new OAuthSecretError();
  const decoded = Buffer.from(value, "base64url");
  if (decoded.length === 0 || (expectedLength !== undefined && decoded.length !== expectedLength)) {
    throw new OAuthSecretError();
  }
  return decoded;
}

/** Hash state, nonce, and browser-session bindings before they enter storage. */
export function hashOAuthSecret(value: string): string {
  if (!value) throw new OAuthSecretError("OAuth transaction secret is empty.");
  return `sha256:${createHash("sha256").update(value, "utf8").digest("hex")}`;
}

/** AES-256-GCM envelope used for PKCE verifiers and Google refresh tokens. */
export function encryptOAuthSecret(value: string, encryptionKey: string): string {
  if (!value || value.length > 32_000) throw new OAuthSecretError("OAuth secret has an invalid length.");
  const key = requireSecretKey(encryptionKey);
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const ciphertext = Buffer.concat([cipher.update(value, "utf8"), cipher.final()]);
  return `v1.${base64Url(iv)}.${base64Url(cipher.getAuthTag())}.${base64Url(ciphertext)}`;
}

export function decryptOAuthSecret(envelope: string, encryptionKey: string): string {
  const parts = envelope.split(".");
  if (parts.length !== 4 || parts[0] !== "v1") throw new OAuthSecretError();
  const iv = decodeBase64Url(parts[1], 12);
  const authTag = decodeBase64Url(parts[2], 16);
  const ciphertext = decodeBase64Url(parts[3]);
  const key = requireSecretKey(encryptionKey);
  try {
    const decipher = createDecipheriv("aes-256-gcm", key, iv);
    decipher.setAuthTag(authTag);
    const plaintext = Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString("utf8");
    if (!plaintext || plaintext.length > 32_000) throw new OAuthSecretError();
    return plaintext;
  } catch (error) {
    if (error instanceof OAuthSecretError) throw error;
    throw new OAuthSecretError();
  }
}

export function constantTimeSecretEqual(provided: string, expected: string): boolean {
  const providedDigest = createHash("sha256").update(provided, "utf8").digest();
  const expectedDigest = createHash("sha256").update(expected, "utf8").digest();
  return timingSafeEqual(providedDigest, expectedDigest);
}

function randomOAuthValue(): string {
  return base64Url(randomBytes(32));
}

export function codeChallengeS256(codeVerifier: string): string {
  if (!codeVerifier) throw new OAuthSecretError("PKCE code verifier is empty.");
  return base64Url(createHash("sha256").update(codeVerifier, "ascii").digest());
}

export function createGoogleOAuthTransaction(
  configuration: Pick<GoogleOAuthConfiguration, "redirectUri" | "clientId">,
  now = new Date(),
): GoogleOAuthTransaction {
  const state = randomOAuthValue();
  const nonce = randomOAuthValue();
  const codeVerifier = randomOAuthValue();
  const createdAt = new Date(now.getTime());
  const expiresAt = new Date(createdAt.getTime() + GOOGLE_OAUTH_TRANSACTION_TTL_MS);
  return {
    id: createOpaqueId("oauth_tx_"),
    state,
    nonce,
    codeVerifier,
    codeChallenge: codeChallengeS256(codeVerifier),
    redirectUri: configuration.redirectUri,
    clientId: configuration.clientId,
    createdAt,
    expiresAt,
  };
}

export function toStoredGoogleOAuthTransaction(
  transaction: GoogleOAuthTransaction,
  sessionHash: string,
  encryptionKey: string,
): StoredGoogleOAuthTransaction {
  if (!sessionHash) throw new OAuthSecretError("OAuth transaction is not bound to a browser session.");
  return {
    id: transaction.id,
    provider: "google",
    stateHash: hashOAuthSecret(transaction.state),
    sessionHash,
    nonceHash: hashOAuthSecret(transaction.nonce),
    codeVerifierCiphertext: encryptOAuthSecret(transaction.codeVerifier, encryptionKey),
    redirectUri: transaction.redirectUri,
    clientId: transaction.clientId,
    createdAt: new Date(transaction.createdAt.getTime()),
    expiresAt: new Date(transaction.expiresAt.getTime()),
    consumedAt: null,
  };
}

export function recoverCodeVerifier(
  transaction: Pick<StoredGoogleOAuthTransaction, "codeVerifierCiphertext">,
  encryptionKey: string,
): string {
  return decryptOAuthSecret(transaction.codeVerifierCiphertext, encryptionKey);
}

export function buildGoogleAuthorizationUrl(
  configuration: Pick<GoogleOAuthConfiguration, "appBaseUrl" | "redirectUri" | "clientId">,
  transaction: Pick<GoogleOAuthTransaction, "state" | "nonce" | "codeChallenge" | "redirectUri">,
): URL {
  validateGoogleRedirectUri(configuration.appBaseUrl, configuration.redirectUri);
  if (transaction.redirectUri !== configuration.redirectUri) {
    throw new Error("OAuth transaction redirect URI does not match the configured callback.");
  }
  const url = new URL(GOOGLE_OAUTH_AUTHORIZATION_ENDPOINT);
  url.searchParams.set("client_id", configuration.clientId);
  url.searchParams.set("redirect_uri", configuration.redirectUri);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("scope", GOOGLE_OAUTH_SCOPES.join(" "));
  url.searchParams.set("state", transaction.state);
  url.searchParams.set("nonce", transaction.nonce);
  url.searchParams.set("code_challenge", transaction.codeChallenge);
  url.searchParams.set("code_challenge_method", "S256");
  url.searchParams.set("access_type", "offline");
  url.searchParams.set("prompt", "consent");
  return url;
}

export function buildGoogleTokenExchangeBody(
  configuration: Pick<GoogleOAuthConfiguration, "clientId" | "clientSecret" | "redirectUri">,
  transaction: Pick<GoogleOAuthTransaction, "redirectUri" | "codeVerifier">,
  code: string,
): URLSearchParams {
  if (!code || transaction.redirectUri !== configuration.redirectUri) {
    throw new Error("OAuth token exchange inputs are invalid.");
  }
  const body = new URLSearchParams();
  body.set("client_id", configuration.clientId);
  body.set("client_secret", configuration.clientSecret);
  body.set("code", code);
  body.set("code_verifier", transaction.codeVerifier);
  body.set("grant_type", "authorization_code");
  body.set("redirect_uri", configuration.redirectUri);
  return body;
}

export function buildGoogleRefreshTokenBody(
  configuration: Pick<GoogleOAuthConfiguration, "clientId" | "clientSecret">,
  refreshToken: string,
): URLSearchParams {
  if (!refreshToken) throw new GoogleOAuthProviderError("Google refresh token is unavailable.");
  const body = new URLSearchParams();
  body.set("client_id", configuration.clientId);
  body.set("client_secret", configuration.clientSecret);
  body.set("grant_type", "refresh_token");
  body.set("refresh_token", refreshToken);
  return body;
}

export async function requestGoogleToken(
  body: URLSearchParams,
  fetchImpl: typeof fetch = fetch,
): Promise<GoogleOAuthTokenResponse> {
  let response: Response;
  try {
    response = await fetchImpl(GOOGLE_OAUTH_TOKEN_ENDPOINT, {
      method: "POST",
      headers: {
        accept: "application/json",
        "content-type": "application/x-www-form-urlencoded",
      },
      body: body.toString(),
      redirect: "error",
    });
  } catch {
    throw new GoogleOAuthProviderError();
  }

  if (!response.ok) throw new GoogleOAuthProviderError();

  let decoded: unknown;
  try {
    decoded = await response.json();
  } catch {
    throw new GoogleOAuthProviderError();
  }
  const parsed = GoogleOAuthTokenResponseSchema.safeParse(decoded);
  if (!parsed.success) throw new GoogleOAuthProviderError();
  return parsed.data;
}

export async function exchangeGoogleAuthorizationCode(
  configuration: Pick<GoogleOAuthConfiguration, "clientId" | "clientSecret" | "redirectUri">,
  transaction: Pick<GoogleOAuthTransaction, "redirectUri" | "codeVerifier">,
  code: string,
  fetchImpl: typeof fetch = fetch,
): Promise<GoogleOAuthTokenResponse & { id_token: string; refresh_token: string }> {
  const response = await requestGoogleToken(buildGoogleTokenExchangeBody(configuration, transaction, code), fetchImpl);
  if (!response.id_token || !response.refresh_token) {
    throw new GoogleOAuthProviderError("Google did not return the required identity and offline-access tokens.");
  }
  return response as GoogleOAuthTokenResponse & { id_token: string; refresh_token: string };
}

export function configuredGoogleOAuthRedirect(environment: Readonly<Record<string, string | undefined>> = process.env): string {
  const appBaseUrl = environment.APP_BASE_URL;
  const redirectUri = environment.GOOGLE_REDIRECT_URI;
  if (!appBaseUrl || !redirectUri) throw new Error("Google OAuth redirect configuration is incomplete.");
  validateGoogleRedirectUri(appBaseUrl, redirectUri);
  return buildGoogleRedirectUri(appBaseUrl);
}

export function requireGoogleOAuthConfiguration(
  environment: Readonly<Record<string, string | undefined>> = process.env,
): GoogleOAuthConfiguration {
  const appBaseUrl = environment.APP_BASE_URL;
  const redirectUri = environment.GOOGLE_REDIRECT_URI;
  const clientId = environment.GOOGLE_CLIENT_ID;
  const clientSecret = environment.GOOGLE_CLIENT_SECRET;
  const tokenEncryptionKey = environment.REWIND_TOKEN_ENCRYPTION_KEY;
  const expectedEmail = environment.REWIND_GOOGLE_EXPECTED_EMAIL;
  const expectedSub = environment.REWIND_GOOGLE_EXPECTED_SUB;
  if (!appBaseUrl || !redirectUri || !clientId || !clientSecret || !tokenEncryptionKey || !expectedEmail || !expectedSub) {
    throw new Error("Google OAuth private configuration is incomplete.");
  }
  if (!/^[A-Za-z0-9_-]+\.apps\.googleusercontent\.com$/.test(clientId)) {
    throw new Error("Google OAuth client ID is invalid.");
  }
  if (clientSecret.trim() !== clientSecret || /\s/.test(clientSecret) || clientSecret.length < 16) {
    throw new Error("Google OAuth client secret is invalid.");
  }
  const parsedExpectedEmail = z.string().email().safeParse(expectedEmail);
  if (!parsedExpectedEmail.success) throw new Error("Google OAuth expected email is invalid.");
  if (expectedSub.trim() !== expectedSub || /\s/.test(expectedSub) || expectedSub.length > 255) {
    throw new Error("Google OAuth expected subject is invalid.");
  }
  validateGoogleRedirectUri(appBaseUrl, redirectUri);
  return {
    appBaseUrl,
    redirectUri,
    clientId,
    clientSecret,
    tokenEncryptionKey,
    expectedEmail: parsedExpectedEmail.data.toLowerCase(),
    expectedSub,
  };
}
