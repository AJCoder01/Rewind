import { sha256Text } from "@/lib/domain/digest";
import {
  GmailApprovedMessageSchema,
  GmailSendReceiptSchema,
  type GmailApprovedMessage,
  type GmailSendReceipt,
} from "@/lib/contracts/provider-ports";

export type GmailFailureKind = "local_failure" | "permanent_failure" | "delivery_uncertain";

export class GmailProviderError extends Error {
  readonly kind: "local_failure";

  constructor() {
    super("Gmail preparation failed before transport handoff.");
    this.name = "GmailProviderError";
    this.kind = "local_failure";
  }
}

export interface GmailPort {
  sendApprovedMessage(input: GmailApprovedMessage): Promise<GmailSendReceipt>;
}

export type FakeGmailFailure = Readonly<{ kind: GmailFailureKind }>;

export type FakeGmailOptions = Readonly<{
  failure?: FakeGmailFailure;
  messageIdPrefix?: string;
}>;

/** Deterministic single-attempt Gmail port; it never retries or reads a mailbox. */
export class FakeGmailPort implements GmailPort {
  private readonly failure?: FakeGmailFailure;
  private readonly messageIdPrefix: string;
  private attempts = 0;

  constructor(options: FakeGmailOptions = {}) {
    this.failure = options.failure;
    this.messageIdPrefix = options.messageIdPrefix ?? "fake-gmail-message";
  }

  async sendApprovedMessage(input: GmailApprovedMessage): Promise<GmailSendReceipt> {
    const message = GmailApprovedMessageSchema.parse(input);
    if (sha256Text(message.bodyText) !== message.bodyHash) throw new GmailProviderError();
    this.attempts += 1;
    if (this.failure?.kind === "local_failure") throw new GmailProviderError();
    if (this.failure?.kind === "permanent_failure") {
      return GmailSendReceiptSchema.parse({ status: "permanent_failed", providerCode: "fake_4xx" });
    }
    if (this.failure?.kind === "delivery_uncertain") {
      return GmailSendReceiptSchema.parse({ status: "delivery_uncertain", reason: "transport_timeout" });
    }
    return GmailSendReceiptSchema.parse({
      status: "sent",
      messageId: `${this.messageIdPrefix}-${this.attempts}`,
      threadId: `fake-gmail-thread-${this.attempts}`,
    });
  }

  getAttemptCount(): number {
    return this.attempts;
  }
}
