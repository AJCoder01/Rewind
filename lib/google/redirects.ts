/**
 * The only Google OAuth callback used by the Rewind MVP.
 *
 * Keep this module free of provider calls and browser APIs.  It is intended to
 * be used at the server boundary (and in configuration checks) before an
 * authorization URL is built or a callback is accepted.
 */
export const GOOGLE_OAUTH_CALLBACK_PATH = "/api/v1/oauth/google/callback" as const;

type StringEnvironment = Readonly<Record<string, string | undefined>>;

export type GoogleRedirectConfig = Readonly<{
  appBaseUrl: string;
  redirectUri: string;
}>;

function requireValue(name: "APP_BASE_URL" | "GOOGLE_REDIRECT_URI", environment: StringEnvironment): string {
  const value = environment[name];
  if (value === undefined || value === "") throw new Error(`${name} is required; Google OAuth was not configured.`);
  return value;
}

function parseAppBaseUrl(value: string): URL {
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    throw new Error("APP_BASE_URL must be an absolute http(s) URL; Google OAuth was not configured.");
  }

  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new Error("APP_BASE_URL must use http or https; Google OAuth was not configured.");
  }
  if (parsed.username || parsed.password || parsed.search || parsed.hash || (parsed.pathname !== "" && parsed.pathname !== "/")) {
    throw new Error("APP_BASE_URL must contain only the public origin; Google OAuth was not configured.");
  }
  return parsed;
}

/**
 * Derive the exact callback registered with Google from the public app origin.
 * A trailing slash on APP_BASE_URL is harmless; the callback path itself is
 * deliberately not normalized so that the provider registration stays exact.
 */
export function buildGoogleRedirectUri(appBaseUrl: string): string {
  const origin = parseAppBaseUrl(appBaseUrl).origin;
  return `${origin}${GOOGLE_OAUTH_CALLBACK_PATH}`;
}

/** Alias that reads naturally at call sites doing configuration validation. */
export const expectedGoogleRedirectUri = buildGoogleRedirectUri;

/**
 * Validate a configured redirect against the callback derived from the same
 * deployment origin.  Equality is intentionally byte-for-byte: a trailing
 * slash, query string, alternate host, or alternate callback path is rejected.
 */
export function validateGoogleRedirectUri(appBaseUrl: string, redirectUri: string): GoogleRedirectConfig {
  const expected = buildGoogleRedirectUri(appBaseUrl);
  if (redirectUri !== expected) {
    throw new Error(`GOOGLE_REDIRECT_URI must exactly equal ${expected}; Google OAuth was not configured.`);
  }
  return { appBaseUrl: new URL(appBaseUrl).origin, redirectUri };
}

/**
 * Load and validate the two deployment values needed to construct a Google
 * authorization request.  This performs no network/provider work.
 */
export function requireGoogleRedirectConfig(environment: StringEnvironment = process.env): GoogleRedirectConfig {
  const appBaseUrl = requireValue("APP_BASE_URL", environment);
  const redirectUri = requireValue("GOOGLE_REDIRECT_URI", environment);
  return validateGoogleRedirectUri(appBaseUrl, redirectUri);
}

/** Explicitly named convenience alias for callers that prefer `load` wording. */
export const loadGoogleRedirectConfig = requireGoogleRedirectConfig;
