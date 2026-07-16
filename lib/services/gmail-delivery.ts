import { z } from "zod";
import {
  GmailDeliveryResultSchema,
  GmailDispatchIdentitySchema,
  type GmailActionKey,
  type GmailDeliveryResult,
  type GmailDispatchIdentity,
} from "@/lib/contracts/gmail-delivery";
import {
  GmailApprovedMessageSchema,
  GmailSendReceiptSchema,
  type GmailApprovedMessage,
  type GmailSendReceipt,
} from "@/lib/contracts/provider-ports";
import { RecipientAllowlistSchema, type RecipientAllowlist } from "@/lib/config/environment";
import { sha256Digest, sha256Text } from "@/lib/domain/digest";
import { assertRegisteredGmailTemplate, GmailTemplateValidationError } from "@/lib/domain/gmail-template";
import { GmailProviderError, type GmailPort } from "@/lib/adapters/gmail";
import type { GmailDispatchStore } from "@/lib/db/gmail-dispatch";

const GmailDeliveryRequestSchema = z
  .object({
    actionId: z.string().min(8).max(200),
    planId: z.string().min(8).max(200),
    actionKey: z.enum(["initial.mail.notify", "recovery.mail.correct_uk", "recovery.mail.notify_us"]),
    approvedPlanDigest: z.string().regex(/^sha256:[a-f0-9]{64}$/),
    currentPlanDigest: z.string().regex(/^sha256:[a-f0-9]{64}$/),
    expectedSenderGoogleSub: z.string().min(1).max(255).refine((value) => value === value.trim() && !/\s/.test(value)),
    message: GmailApprovedMessageSchema,
    allowlist: RecipientAllowlistSchema,
  })
  .strict();

export type GmailDeliveryRequest = z.infer<typeof GmailDeliveryRequestSchema>;

export type GmailDeliveryErrorCode = "plan_digest_mismatch" | "recipient_not_allowed" | "sender_not_allowed" | "unknown_template" | "dispatch_state_unavailable";

export class GmailDeliveryError extends Error {
  readonly code: GmailDeliveryErrorCode;

  constructor(code: GmailDeliveryErrorCode) {
    super("The approved Gmail dispatch failed a safety boundary before handoff.");
    this.name = "GmailDeliveryError";
    this.code = code;
  }
}

export class GmailDeliveryService {
  constructor(private readonly port: GmailPort, private readonly store: GmailDispatchStore, private readonly now: () => Date = () => new Date()) {}

  async send(input: GmailDeliveryRequest): Promise<GmailDeliveryResult> {
    const request = GmailDeliveryRequestSchema.parse(input);
    if (request.approvedPlanDigest !== request.currentPlanDigest) throw new GmailDeliveryError("plan_digest_mismatch");
    if (request.message.senderGoogleSub !== request.expectedSenderGoogleSub) throw new GmailDeliveryError("sender_not_allowed");

    let message: GmailApprovedMessage;
    try {
      message = assertRegisteredGmailTemplate(request.actionKey, request.message);
      this.assertRecipientAllowlist(message.to, request.allowlist);
      if (sha256Text(message.bodyText) !== message.bodyHash) throw new GmailDeliveryError("unknown_template");
    } catch (error) {
      if (error instanceof GmailDeliveryError) throw error;
      if (error instanceof GmailTemplateValidationError || error instanceof z.ZodError) throw new GmailDeliveryError("unknown_template");
      throw error;
    }

    const identity = this.identityFor(request, message);
    let existing: Awaited<ReturnType<GmailDispatchStore["read"]>>;
    try {
      existing = await this.store.read(identity.actionId);
    } catch {
      throw new GmailDeliveryError("dispatch_state_unavailable");
    }
    if (existing) {
      if (!sameIdentity(existing, identity)) throw new GmailDeliveryError("plan_digest_mismatch");
      if (existing.status === "in_progress" || existing.status === "succeeded" || existing.status === "permanently_failed" || existing.status === "delivery_uncertain") {
        return this.replayOrReconcile(existing);
      }
    }

    try {
      this.port.prepareApprovedMessage(message);
    } catch (error) {
      if (error instanceof GmailProviderError && error.kind === "local_failure") {
        const failed = await this.store.recordRetryableFailure(identity);
        return { status: "retryable_failed", reason: "local_preparation", replay: false, dispatchStartedAt: failed.dispatchStartedAt };
      }
      throw new GmailDeliveryError("unknown_template");
    }

    let claim: Awaited<ReturnType<GmailDispatchStore["claimForDispatch"]>>;
    try {
      claim = await this.store.claimForDispatch(identity, this.now().toISOString());
    } catch {
      throw new GmailDeliveryError("dispatch_state_unavailable");
    }
    if (!claim.claimed) return this.replayOrReconcile(claim.record);

    let receipt: GmailSendReceipt;
    try {
      receipt = GmailSendReceiptSchema.parse(await this.port.sendApprovedMessage(message));
    } catch (error) {
      // Once the marker is persisted, even a provider implementation that
      // throws before its own HTTP call cannot prove that no handoff occurred.
      // Treat every post-claim exception as uncertain.
      return this.persistUncertain(identity.actionId, error instanceof z.ZodError ? "malformed_success" : "transport_error", false, claim.record.dispatchStartedAt);
    }

    try {
      const recorded = await this.store.recordOutcome(identity.actionId, receipt);
      return resultForReceipt(receipt, false, recorded.dispatchStartedAt);
    } catch {
      return this.persistUncertain(identity.actionId, "persistence_failure", false, claim.record.dispatchStartedAt);
    }
  }

  private async replayOrReconcile(record: Awaited<ReturnType<GmailDispatchStore["claimForDispatch"]>>["record"]): Promise<GmailDeliveryResult> {
    if (record.status === "retryable_failed") {
      throw new GmailDeliveryError("plan_digest_mismatch");
    }
    if (record.status === "in_progress") {
      return resultForReceipt({ status: "delivery_uncertain", reason: "process_interrupted" }, true, record.dispatchStartedAt);
    }
    if (!record.receipt) return resultForReceipt({ status: "delivery_uncertain", reason: "process_interrupted" }, true, record.dispatchStartedAt);
    return resultForReceipt(record.receipt, true, record.dispatchStartedAt);
  }

  private async persistUncertain(actionId: string, reason: Extract<GmailSendReceipt, { status: "delivery_uncertain" }>['reason'], replay: boolean, dispatchStartedAt: string | null): Promise<GmailDeliveryResult> {
    const fallback = { status: "delivery_uncertain" as const, reason };
    try {
      const recorded = await this.store.recordOutcome(actionId, fallback);
      return resultForReceipt(recorded.receipt ?? fallback, replay, recorded.dispatchStartedAt);
    } catch {
      return resultForReceipt(fallback, replay, dispatchStartedAt);
    }
  }

  private identityFor(request: GmailDeliveryRequest, message: GmailApprovedMessage): GmailDispatchIdentity {
    const digests = gmailMessageIdentityDigests(message);
    return GmailDispatchIdentitySchema.parse({
      actionId: request.actionId,
      planId: request.planId,
      actionKey: request.actionKey,
      ...digests,
    });
  }

  private assertRecipientAllowlist(recipients: readonly string[], allowlist: RecipientAllowlist): void {
    const allowed = new Set([...allowlist.UK, ...allowlist.US].map((recipient) => recipient.toLowerCase()));
    if (recipients.some((recipient) => !allowed.has(recipient.toLowerCase()))) throw new GmailDeliveryError("recipient_not_allowed");
  }
}

export function gmailMessageIdentityDigests(message: GmailApprovedMessage): Readonly<{ messageHash: string; recipientDigest: string }> {
  const parsed = GmailApprovedMessageSchema.parse(message);
  return {
    messageHash: sha256Digest({ subject: parsed.subject, bodyHash: parsed.bodyHash, runId: parsed.runId }),
    recipientDigest: sha256Digest(parsed.to.map((recipient) => recipient.toLowerCase()).sort()),
  };
}

function resultForReceipt(receipt: GmailSendReceipt, replay: boolean, dispatchStartedAt: string | null): GmailDeliveryResult {
  const parsed = GmailSendReceiptSchema.parse(receipt);
  if (parsed.status === "sent") return GmailDeliveryResultSchema.parse({ status: "sent", receipt: parsed, replay, dispatchStartedAt });
  if (parsed.status === "permanent_failed") return GmailDeliveryResultSchema.parse({ status: "permanent_failed", receipt: parsed, replay, dispatchStartedAt });
  return GmailDeliveryResultSchema.parse({ status: "delivery_uncertain", receipt: parsed, replay, dispatchStartedAt });
}

function sameIdentity(left: { actionId: string; planId: string; actionKey: GmailActionKey; messageHash: string; recipientDigest: string }, right: GmailDispatchIdentity): boolean {
  return left.actionId === right.actionId && left.planId === right.planId && left.actionKey === right.actionKey && left.messageHash === right.messageHash && left.recipientDigest === right.recipientDigest;
}
