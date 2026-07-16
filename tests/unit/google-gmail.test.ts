import { describe, expect, it, vi } from "vitest";
import { buildApprovedGmailMime, encodeGmailRawMime, GoogleGmailPort, GOOGLE_GMAIL_SEND_ENDPOINT } from "@/lib/google/gmail";
import { sha256Text } from "@/lib/domain/digest";
import type { GmailApprovedMessage } from "@/lib/contracts/provider-ports";

const body = "The Acme UK renewal is now scheduled for 2026-08-20 at 15:00 ET.";
const message: GmailApprovedMessage = {
  senderGoogleSub: "google-subject",
  to: ["uk-ops@example.test"],
  subject: "[Rewind run_s037_002] Acme UK renewal moved",
  bodyText: body,
  bodyHash: sha256Text(body),
  runId: "run_s037_002",
};

function response(status: number, payload: unknown): Response {
  return new Response(JSON.stringify(payload), { status, headers: { "content-type": "application/json" } });
}

describe("Google Gmail wire port", () => {
  it("builds deterministic MIME and sends one base64url raw request", async () => {
    const fetchImpl = vi.fn<typeof fetch>(async (input, init) => {
      expect(input).toBe(GOOGLE_GMAIL_SEND_ENDPOINT);
      expect(init?.method).toBe("POST");
      expect(new Headers(init?.headers).get("authorization")).toBe("Bearer access-token");
      const requestBody = JSON.parse(String(init?.body)) as { raw: string };
      expect(Buffer.from(requestBody.raw, "base64url").toString("utf8")).toBe(buildApprovedGmailMime(message));
      return response(200, { id: "gmail-message-1", threadId: "gmail-thread-1", labelIds: ["SENT"] });
    });
    const port = new GoogleGmailPort({ accessToken: "access-token", fetchImpl });
    port.prepareApprovedMessage(message);
    const receipt = await port.sendApprovedMessage(message);

    expect(receipt).toEqual({ status: "sent", messageId: "gmail-message-1", threadId: "gmail-thread-1" });
    expect(fetchImpl).toHaveBeenCalledOnce();
    expect(encodeGmailRawMime(buildApprovedGmailMime(message))).toMatch(/^[A-Za-z0-9_-]+$/);
  });

  it.each([
    [400, { status: "permanent_failed", providerCode: "http_400" }],
    [403, { status: "permanent_failed", providerCode: "http_403" }],
    [408, { status: "delivery_uncertain", reason: "provider_408" }],
    [429, { status: "delivery_uncertain", reason: "provider_429" }],
    [500, { status: "delivery_uncertain", reason: "provider_5xx" }],
    [503, { status: "delivery_uncertain", reason: "provider_5xx" }],
  ])("classifies HTTP %s without exposing the provider body", async (status, expected) => {
    const fetchImpl = vi.fn<typeof fetch>(async () => response(status, { error: { message: "private provider body" } }));
    const receipt = await new GoogleGmailPort({ accessToken: "access-token", fetchImpl }).sendApprovedMessage(message);
    expect(receipt).toEqual(expected);
    expect(JSON.stringify(receipt)).not.toContain("private provider body");
  });

  it("classifies transport loss, cancellation, timeout, and malformed 2xx as uncertainty", async () => {
    const transport = await new GoogleGmailPort({ accessToken: "access-token", fetchImpl: vi.fn<typeof fetch>(async () => { throw new Error("socket detail"); }) }).sendApprovedMessage(message);
    expect(transport).toEqual({ status: "delivery_uncertain", reason: "transport_error" });

    const controller = new AbortController();
    controller.abort();
    const cancelled = await new GoogleGmailPort({ accessToken: "access-token", signal: controller.signal, fetchImpl: vi.fn<typeof fetch>() }).sendApprovedMessage(message);
    expect(cancelled).toEqual({ status: "delivery_uncertain", reason: "cancellation" });

    const malformed = await new GoogleGmailPort({ accessToken: "access-token", fetchImpl: vi.fn<typeof fetch>(async () => response(200, { threadId: "missing-id" })) }).sendApprovedMessage(message);
    expect(malformed).toEqual({ status: "delivery_uncertain", reason: "malformed_success" });

    const timeout = await new GoogleGmailPort({
      accessToken: "access-token",
      timeoutMs: 1,
      fetchImpl: vi.fn<typeof fetch>(() => new Promise<Response>((_, reject) => {
        setTimeout(() => reject(new DOMException("aborted", "AbortError")), 20);
      })),
    }).sendApprovedMessage(message);
    expect(timeout).toEqual({ status: "delivery_uncertain", reason: "transport_timeout" });
  });

  it("rejects invalid access tokens and never allows caller-controlled header injection", () => {
    expect(() => new GoogleGmailPort({ accessToken: "bad token" })).toThrow();
    expect(() => buildApprovedGmailMime({ ...message, subject: "bad\r\nBcc: attacker@example.test" })).toThrow();
  });
});
