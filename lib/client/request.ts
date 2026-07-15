"use client";

export function readCsrfToken(): string | null {
  const cookie = document.cookie
    .split(";")
    .map((part) => part.trim())
    .find((part) => part.startsWith("rewind_csrf="));
  if (!cookie) return null;
  try {
    return decodeURIComponent(cookie.slice("rewind_csrf=".length));
  } catch {
    return null;
  }
}

export function newIdempotencyKey(): string {
  return `${crypto.randomUUID()}${crypto.randomUUID()}`;
}
