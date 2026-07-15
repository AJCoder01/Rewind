import { createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import type { NextRequest, NextResponse } from "next/server";

const sessionCookie = "rewind_session";
const csrfCookie = "rewind_csrf";
const sessionLifetimeSeconds = 60 * 60 * 8;

export type AuthenticatedActor = { actorId: string; source: "dashboard" | "mcp" };
export type AuthorizationFailure = "unauthorized" | "forbidden";
export type AuthorizationResult = { actor: AuthenticatedActor } | { error: AuthorizationFailure };

function sessionSecret(): string | null {
  return process.env.REWIND_SESSION_SECRET || null;
}

function signature(payload: string, secret: string): string {
  return createHmac("sha256", secret).update(payload).digest("base64url");
}

export function createSessionValue(actorId: string, now = Math.floor(Date.now() / 1000)): string {
  const secret = sessionSecret();
  if (!secret) throw new Error("REWIND_SESSION_SECRET is required");
  if (!actorId || actorId.includes(".")) throw new Error("Session actor ID is invalid");
  const payload = `${actorId}.${now + sessionLifetimeSeconds}`;
  return `${payload}.${signature(payload, secret)}`;
}

export function createCsrfToken(): string {
  return randomBytes(24).toString("base64url");
}

export function readDashboardActor(request: NextRequest): AuthenticatedActor | null {
  const secret = sessionSecret();
  const value = request.cookies.get(sessionCookie)?.value;
  if (!secret || !value) return null;
  const segments = value.split(".");
  if (segments.length !== 3) return null;
  const [actorId, expiryText, providedSignature] = segments;
  if (!actorId || !expiryText || !providedSignature || actorId.includes(".")) return null;
  const payload = `${actorId}.${expiryText}`;
  const expected = signature(payload, secret);
  const expectedBytes = Buffer.from(expected);
  const providedBytes = Buffer.from(providedSignature);
  if (expectedBytes.length !== providedBytes.length || !timingSafeEqual(expectedBytes, providedBytes)) return null;
  if (!Number.isFinite(Number(expiryText)) || Number(expiryText) <= Math.floor(Date.now() / 1000)) return null;
  return { actorId, source: "dashboard" };
}

/**
 * Return only a non-reversible binding for the signed browser session.  OAuth
 * transactions use this to prevent a callback from another browser from
 * consuming the initiating transaction; the raw cookie never enters storage
 * or a log.
 */
export function readDashboardSessionBinding(request: NextRequest): string | null {
  const value = request.cookies.get(sessionCookie)?.value;
  if (!value) return null;
  return `sha256:${createHash("sha256").update(value, "utf8").digest("hex")}`;
}

export function readMcpActor(request: NextRequest): AuthenticatedActor | null {
  const authorization = request.headers.get("authorization");
  const configuredMcpToken = process.env.MCP_BACKEND_TOKEN;
  if (!authorization || !configuredMcpToken || !authorization.startsWith("Bearer ")) return null;
  const provided = authorization.slice("Bearer ".length);
  if (!provided || !safeSecretEqual(provided, configuredMcpToken)) return null;
  return { actorId: "mcp:scoped-token", source: "mcp" };
}

export function authorizeApiRequest(request: NextRequest, options: { mutation: boolean; allowMcp?: boolean }): AuthorizationResult {
  const authorizationHeader = request.headers.get("authorization");
  if (authorizationHeader) {
    if (!options.allowMcp) return { error: "unauthorized" };
    const mcpActor = readMcpActor(request);
    return mcpActor ? { actor: mcpActor } : { error: "unauthorized" };
  }

  const actor = readDashboardActor(request);
  if (!actor) return { error: "unauthorized" };
  if (options.mutation && (!isSameOrigin(request) || !hasValidCsrf(request))) return { error: "forbidden" };
  return { actor };
}

export function hasValidCsrf(request: NextRequest): boolean {
  const cookieValue = request.cookies.get(csrfCookie)?.value;
  const headerValue = request.headers.get("x-rewind-csrf");
  return Boolean(cookieValue && headerValue && safeSecretEqual(cookieValue, headerValue));
}

export function setSessionCookies(response: NextResponse, sessionValue: string, csrfToken: string): void {
  const secure = process.env.NODE_ENV === "production";
  response.cookies.set(sessionCookie, sessionValue, {
    httpOnly: true,
    sameSite: "lax",
    secure,
    path: "/",
    maxAge: sessionLifetimeSeconds,
  });
  response.cookies.set(csrfCookie, csrfToken, {
    httpOnly: false,
    sameSite: "lax",
    secure,
    path: "/",
    maxAge: sessionLifetimeSeconds,
  });
}

export function sessionCookieName(): string {
  return sessionCookie;
}

export function csrfCookieName(): string {
  return csrfCookie;
}

export function safeSecretEqual(provided: string, expected: string): boolean {
  const providedDigest = createHash("sha256").update(provided, "utf8").digest();
  const expectedDigest = createHash("sha256").update(expected, "utf8").digest();
  return timingSafeEqual(providedDigest, expectedDigest);
}

export function isSameOrigin(request: NextRequest): boolean {
  // Browsers send Origin on fetch/XHR mutations. Referer is a conservative
  // fallback for compatible same-origin form/navigation cases; a supplied
  // Origin always takes precedence and cannot be bypassed by a good Referer.
  const origin = request.headers.get("origin") ?? request.headers.get("referer");
  if (!origin) return false;
  try {
    const configuredBaseUrl = process.env.APP_BASE_URL;
    if (configuredBaseUrl) return new URL(origin).origin === new URL(configuredBaseUrl).origin;
    const requestUrl = new URL(request.url);
    const requestHost = request.headers.get("host");
    const forwardedProtocol = request.headers.get("x-forwarded-proto")?.split(",")[0]?.trim();
    const protocol = forwardedProtocol ? `${forwardedProtocol.replace(/:$/, "")}:` : requestUrl.protocol;
    const expectedOrigin = requestHost ? new URL(`${protocol}//${requestHost}`).origin : requestUrl.origin;
    return new URL(origin).origin === expectedOrigin;
  } catch {
    return false;
  }
}

export function missingProductionAuthConfiguration(environment: Readonly<Record<string, string | undefined>> = process.env): string[] {
  if ((environment.NODE_ENV ?? "development") !== "production") return [];
  return ["APP_BASE_URL", "REWIND_SESSION_SECRET", "REWIND_DASHBOARD_PASSCODE", "MCP_BACKEND_TOKEN"].filter((key) => !environment[key]);
}
