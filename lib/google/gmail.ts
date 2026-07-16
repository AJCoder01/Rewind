import { z } from "zod";
import {
  GmailApprovedMessageSchema,
  GmailSendReceiptSchema,
  type GmailApprovedMessage,
  type GmailSendReceipt,
} from "@/lib/contracts/provider-ports";
import { GmailProviderError, type GmailPort } from "@/lib/adapters/gmail";

export const GOOGLE_GMAIL_SEND_ENDPOINT = "https://gmail.googleapis.com/gmail/v1/users/me/messages/send" as const;
export const GOOGLE_GMAIL_DEFAULT_TIMEOUT_MS = 10_000;
const GOOGLE_GMAIL_MAX_SUCCESS_BYTES = 64 * 1024;

const GoogleGmailSendResponseSchema = z
  .object({ id: z.string().min(1).max(512), threadId: z.string().min(1).max(512).optional() })
  .strip();

export type GoogleGmailPortOptions = Readonly<{
  accessToken: string;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
  signal?: AbortSignal;
}>;

/** Build the sole approved MIME representation; no caller-supplied headers cross this boundary. */
export function buildApprovedGmailMime(input: GmailApprovedMessage): string {
  const message = GmailApprovedMessageSchema.parse(input);
  if (message.subject.includes("\r") || message.subject.includes("\n")) throw new GmailProviderError();
  if (message.bodyText.includes("\u0000")) throw new GmailProviderError();
  const body = message.bodyText.replace(/\r\n|\r|\n/g, "\r\n");
  return [
    `To: ${message.to.join(", ")}`,
    `Subject: ${message.subject}`,
    "MIME-Version: 1.0",
    "Content-Type: text/plain; charset=UTF-8",
    "Content-Transfer-Encoding: 8bit",
    "",
    body,
    "",
  ].join("\r\n");
}

export function encodeGmailRawMime(mime: string): string {
  return Buffer.from(mime, "utf8").toString("base64url");
}

/** One direct `users.messages.send` attempt. It never reads or modifies a mailbox. */
export class GoogleGmailPort implements GmailPort {
  private readonly accessToken: string;
  private readonly fetchImpl: typeof fetch;
  private readonly timeoutMs: number;
  private readonly signal?: AbortSignal;

  constructor(options: GoogleGmailPortOptions) {
    if (!options.accessToken || options.accessToken.trim() !== options.accessToken || /\s/.test(options.accessToken)) {
      throw new Error("Google Gmail access token is invalid.");
    }
    if (options.timeoutMs !== undefined && (!Number.isInteger(options.timeoutMs) || options.timeoutMs < 1 || options.timeoutMs > 60_000)) {
      throw new Error("Google Gmail timeout is invalid.");
    }
    this.accessToken = options.accessToken;
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.timeoutMs = options.timeoutMs ?? GOOGLE_GMAIL_DEFAULT_TIMEOUT_MS;
    this.signal = options.signal;
  }

  prepareApprovedMessage(input: GmailApprovedMessage): void {
    buildApprovedGmailMime(GmailApprovedMessageSchema.parse(input));
  }

  async sendApprovedMessage(input: GmailApprovedMessage): Promise<GmailSendReceipt> {
    const message = GmailApprovedMessageSchema.parse(input);
    const raw = encodeGmailRawMime(buildApprovedGmailMime(message));
    const controller = new AbortController();
    let timedOut = false;
    let cancelled = this.signal?.aborted ?? false;
    const onAbort = (): void => {
      cancelled = true;
      controller.abort();
    };
    this.signal?.addEventListener("abort", onAbort, { once: true });
    const timeout = setTimeout(() => {
      timedOut = true;
      controller.abort();
    }, this.timeoutMs);

    let response: Response;
    try {
      if (cancelled) return { status: "delivery_uncertain", reason: "cancellation" };
      response = await this.fetchImpl(GOOGLE_GMAIL_SEND_ENDPOINT, {
        method: "POST",
        headers: {
          accept: "application/json",
          authorization: `Bearer ${this.accessToken}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({ raw }),
        redirect: "error",
        signal: controller.signal,
      });
    } catch {
      if (timedOut) return { status: "delivery_uncertain", reason: "transport_timeout" };
      if (cancelled) return { status: "delivery_uncertain", reason: "cancellation" };
      return { status: "delivery_uncertain", reason: "transport_error" };
    } finally {
      clearTimeout(timeout);
      this.signal?.removeEventListener("abort", onAbort);
    }

    if (response.status === 408) return { status: "delivery_uncertain", reason: "provider_408" };
    if (response.status === 429) return { status: "delivery_uncertain", reason: "provider_429" };
    if (response.status >= 500 && response.status <= 599) return { status: "delivery_uncertain", reason: "provider_5xx" };
    if (response.status >= 400 && response.status <= 499) return { status: "permanent_failed", providerCode: `http_${response.status}` };
    if (response.status < 200 || response.status > 299) return { status: "delivery_uncertain", reason: "malformed_success" };

    const body = await readBoundedText(response);
    if (body === null) return { status: "delivery_uncertain", reason: "malformed_success" };
    let decoded: unknown;
    try {
      decoded = JSON.parse(body) as unknown;
    } catch {
      return { status: "delivery_uncertain", reason: "malformed_success" };
    }
    const parsed = GoogleGmailSendResponseSchema.safeParse(decoded);
    if (!parsed.success) return { status: "delivery_uncertain", reason: "malformed_success" };
    return GmailSendReceiptSchema.parse({ status: "sent", messageId: parsed.data.id, ...(parsed.data.threadId ? { threadId: parsed.data.threadId } : {}) });
  }
}

async function readBoundedText(response: Response): Promise<string | null> {
  try {
    const text = await response.text();
    return text.length <= GOOGLE_GMAIL_MAX_SUCCESS_BYTES ? text : null;
  } catch {
    return null;
  }
}
