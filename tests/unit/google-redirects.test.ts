import { describe, expect, it } from "vitest";
import {
  GOOGLE_OAUTH_CALLBACK_PATH,
  buildGoogleRedirectUri,
  requireGoogleRedirectConfig,
  validateGoogleRedirectUri,
} from "@/lib/google/redirects";

describe("Google OAuth redirect configuration", () => {
  it("freezes the canonical callback path", () => {
    expect(GOOGLE_OAUTH_CALLBACK_PATH).toBe("/api/v1/oauth/google/callback");
    expect(buildGoogleRedirectUri("http://localhost:3000")).toBe("http://localhost:3000/api/v1/oauth/google/callback");
  });

  it("derives the same exact callback for local and deployed origins", () => {
    expect(buildGoogleRedirectUri("http://localhost:3000/")).toBe("http://localhost:3000/api/v1/oauth/google/callback");
    expect(buildGoogleRedirectUri("https://rewind-eta-jet.vercel.app")).toBe(
      "https://rewind-eta-jet.vercel.app/api/v1/oauth/google/callback",
    );
  });

  it("accepts a configured redirect only when it exactly matches the derived callback", () => {
    expect(
      requireGoogleRedirectConfig({
        APP_BASE_URL: "https://rewind-eta-jet.vercel.app",
        GOOGLE_REDIRECT_URI: "https://rewind-eta-jet.vercel.app/api/v1/oauth/google/callback",
      }),
    ).toEqual({
      appBaseUrl: "https://rewind-eta-jet.vercel.app",
      redirectUri: "https://rewind-eta-jet.vercel.app/api/v1/oauth/google/callback",
    });
  });

  it.each([
    "https://rewind-eta-jet.vercel.app/api/v1/oauth/google/callback/",
    "https://rewind-eta-jet.vercel.app/api/v1/oauth/google/callback?next=/",
    "https://rewind-eta-jet.vercel.app/oauth/google/callback",
    "https://other.example.test/api/v1/oauth/google/callback",
  ])("rejects a non-exact redirect: %s", (redirectUri) => {
    expect(() => validateGoogleRedirectUri("https://rewind-eta-jet.vercel.app", redirectUri)).toThrow(
      "GOOGLE_REDIRECT_URI must exactly equal",
    );
  });

  it("rejects missing values before any provider work", () => {
    expect(() => requireGoogleRedirectConfig({ GOOGLE_REDIRECT_URI: "https://example.test/callback" })).toThrow(
      "APP_BASE_URL is required",
    );
    expect(() => requireGoogleRedirectConfig({ APP_BASE_URL: "https://example.test" })).toThrow(
      "GOOGLE_REDIRECT_URI is required",
    );
    expect(() => requireGoogleRedirectConfig({
      APP_BASE_URL: "https://example.test",
      GOOGLE_REDIRECT_URI: " https://example.test/api/v1/oauth/google/callback",
    })).toThrow("GOOGLE_REDIRECT_URI must exactly equal");
  });

  it.each(["not-a-url", "javascript:alert(1)", "https://user:pass@example.test"]) (
    "rejects an unsafe app base URL: %s",
    (appBaseUrl) => {
      expect(() => buildGoogleRedirectUri(appBaseUrl)).toThrow("APP_BASE_URL");
    },
  );

  it("rejects base URLs that contain a path, query, or fragment", () => {
    for (const appBaseUrl of ["https://example.test/rewind", "https://example.test?x=1", "https://example.test#x"]) {
      expect(() => buildGoogleRedirectUri(appBaseUrl)).toThrow("public origin");
    }
  });
});
