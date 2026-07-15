import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import type { NextRequest } from "next/server";

const sessionCookie = "rewind_session";
const sessionLifetimeSeconds = 60 * 60 * 8;

export type AuthenticatedActor = { actorId: string; source: "dashboard" | "mcp" };

function sessionSecret(): string | null {
  return process.env.REWIND_SESSION_SECRET || null;
}

function signature(payload: string, secret: string): string {
  return createHmac("sha256", secret).update(payload).digest("base64url");
}

export function createSessionValue(actorId: string, now = Math.floor(Date.now() / 1000)): string {
  const secret = sessionSecret();
  if (!secret) throw new Error("REWIND_SESSION_SECRET is required");
  const payload = `${actorId}.${now + sessionLifetimeSeconds}`;
  return `${payload}.${signature(payload, secret)}`;
}

export function readDashboardActor(request: NextRequest): AuthenticatedActor | null {
  const secret = sessionSecret();
  const value = request.cookies.get(sessionCookie)?.value;
  if (!secret || !value) return null;
  const segments = value.split(".");
  if (segments.length !== 3) return null;
  const [actorId, expiryText, providedSignature] = segments;
  if (!actorId || !expiryText || !providedSignature) return null;
  const payload = `${actorId}.${expiryText}`;
  const expected = signature(payload, secret);
  const expectedBytes = Buffer.from(expected);
  const providedBytes = Buffer.from(providedSignature);
  if (expectedBytes.length !== providedBytes.length || !timingSafeEqual(expectedBytes, providedBytes)) return null;
  if (!Number.isFinite(Number(expiryText)) || Number(expiryText) <= Math.floor(Date.now() / 1000)) return null;
  return { actorId, source: "dashboard" };
}

export function sessionCookieName(): string {
  return sessionCookie;
}

export function safeSecretEqual(provided: string, expected: string): boolean {
  const providedDigest = createHash("sha256").update(provided, "utf8").digest();
  const expectedDigest = createHash("sha256").update(expected, "utf8").digest();
  return timingSafeEqual(providedDigest, expectedDigest);
}

export function isSameOrigin(request: NextRequest): boolean {
  const origin = request.headers.get("origin");
  if (!origin) return false;
  try {
    const configuredBaseUrl = process.env.APP_BASE_URL;
    if (configuredBaseUrl) return new URL(origin).origin === new URL(configuredBaseUrl).origin;
    const requestUrl = new URL(request.url);
    const requestHost = request.headers.get("host");
    const forwardedProtocol = request.headers.get("x-forwarded-proto")?.split(",")[0]?.trim();
    const protocol = forwardedProtocol ? `${forwardedProtocol.replace(/:$/, "")}:` : requestUrl.protocol;
    const expectedOrigin = requestHost
      ? new URL(`${protocol}//${requestHost}`).origin
      : requestUrl.origin;
    return new URL(origin).origin === expectedOrigin;
  } catch {
    return false;
  }
}
