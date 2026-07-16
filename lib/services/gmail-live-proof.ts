import { EnvironmentConfigError, type ApplicationEnvironment } from "@/lib/config/environment";
import {
  GMAIL_LIVE_PROOF_ACTION_ID,
  GMAIL_LIVE_PROOF_ACTION_KEY,
  GMAIL_LIVE_PROOF_CONTRACT_VERSION,
  GMAIL_LIVE_PROOF_PLAN_ID,
  GMAIL_LIVE_PROOF_TASK_ID,
  GmailLiveProofPlanSchema,
  GmailLiveProofReadModelSchema,
  type GmailLiveProofPlan,
  type GmailLiveProofReadModel,
  type GmailLiveProofStoredRecord,
} from "@/lib/contracts/gmail-live-proof";
import type { GmailDeliveryResult } from "@/lib/contracts/gmail-delivery";
import { sha256Digest, sha256Text } from "@/lib/domain/digest";
import { GmailDeliveryError, gmailMessageIdentityDigests } from "@/lib/services/gmail-delivery";
import { DemoCommandGuardError, assertTtyGatedDemoEnvironment } from "@/lib/services/calendar-demo-command";
import { assertRegisteredGmailTemplate } from "@/lib/domain/gmail-template";
import { GoogleOAuthProviderError } from "@/lib/google/oauth";

export type GmailLiveProofGuardKind =
  | "live_flag_required"
  | "recipient_not_allowed"
  | "existing_proof_conflict"
  | "proof_not_retryable"
  | "proof_not_sent"
  | "replay_not_verified"
  | "credential_unavailable";

export class GmailLiveProofGuardError extends Error {
  readonly kind: GmailLiveProofGuardKind;

  constructor(kind: GmailLiveProofGuardKind) {
    super("The controlled Gmail live proof cannot proceed safely.");
    this.name = "GmailLiveProofGuardError";
    this.kind = kind;
  }
}

export type GmailLiveProofConfiguration = Readonly<{
  senderGoogleSub: string;
  senderEmail: string;
  recipient: string;
  demoDate: string;
}>;

export function assertTtyGatedGmailLiveProofEnvironment(
  environment: Readonly<Record<string, string | undefined>>,
  io: Readonly<{ stdinIsTTY: boolean | undefined; stdoutIsTTY: boolean | undefined }>,
): void {
  assertTtyGatedDemoEnvironment(environment, io);
  if (environment.LIVE_INTEGRATION_TESTS !== "1") throw new GmailLiveProofGuardError("live_flag_required");
}

export function gmailLiveProofConfigurationFromEnvironment(environment: ApplicationEnvironment): GmailLiveProofConfiguration {
  const recipient = environment.REWIND_RECIPIENT_ALLOWLIST.UK[0];
  if (!recipient || recipient.toLowerCase() === environment.REWIND_GOOGLE_EXPECTED_EMAIL.toLowerCase()) {
    throw new GmailLiveProofGuardError("recipient_not_allowed");
  }
  return {
    senderGoogleSub: environment.REWIND_GOOGLE_EXPECTED_SUB,
    senderEmail: environment.REWIND_GOOGLE_EXPECTED_EMAIL,
    recipient,
    demoDate: environment.REWIND_DEMO_DATE,
  };
}

export function buildGmailLiveProofPlan(configuration: GmailLiveProofConfiguration, runId: string): GmailLiveProofPlan {
  const bodyText = `The Acme UK renewal is now scheduled for ${configuration.demoDate} at 15:00 ET.`;
  const message = {
    senderGoogleSub: configuration.senderGoogleSub,
    to: [configuration.recipient],
    subject: `[Rewind ${runId}] Acme UK renewal moved`,
    bodyText,
    bodyHash: sha256Text(bodyText),
    runId,
  };
  const { messageHash, recipientDigest } = gmailMessageIdentityDigests(message);
  const replayKey = sha256Digest({ planId: GMAIL_LIVE_PROOF_PLAN_ID, actionKey: GMAIL_LIVE_PROOF_ACTION_KEY });
  const core = {
    schemaVersion: GMAIL_LIVE_PROOF_CONTRACT_VERSION,
    taskId: GMAIL_LIVE_PROOF_TASK_ID,
    planId: GMAIL_LIVE_PROOF_PLAN_ID,
    actionId: GMAIL_LIVE_PROOF_ACTION_ID,
    actionKey: GMAIL_LIVE_PROOF_ACTION_KEY,
    message,
    messageHash,
    recipientDigest,
    replayKey,
  } as const;
  return GmailLiveProofPlanSchema.parse({ ...core, digest: sha256Digest(core) });
}

export function assertGmailLiveProofRecordMatches(record: GmailLiveProofStoredRecord, configuration: GmailLiveProofConfiguration): void {
  const message = record.plan.message;
  try {
    assertRegisteredGmailTemplate(GMAIL_LIVE_PROOF_ACTION_KEY, message);
  } catch {
    throw new GmailLiveProofGuardError("existing_proof_conflict");
  }
  if (
    message.senderGoogleSub !== configuration.senderGoogleSub ||
    message.to.length !== 1 ||
    message.to[0].toLowerCase() !== configuration.recipient.toLowerCase() ||
    !message.bodyText.includes(configuration.demoDate)
  ) {
    throw new GmailLiveProofGuardError("existing_proof_conflict");
  }
  if (record.readModel.status === "completed" && record.readModel.replayVerified) {
    if (record.actionStatus !== "succeeded" || record.receipt?.status !== "sent" || record.attempts !== 1 || !record.dispatchStartedAt) {
      throw new GmailLiveProofGuardError("existing_proof_conflict");
    }
    return;
  }
  if (record.actionStatus === "in_progress" || record.actionStatus === "delivery_uncertain" || record.actionStatus === "permanently_failed") {
    throw new GmailLiveProofGuardError("proof_not_retryable");
  }
}

export function gmailLiveProofConfirmationPhrase(runId: string, recipient: string): string {
  if (!runId || !recipient || /[\r\n]/.test(runId) || /[\r\n]/.test(recipient)) {
    throw new GmailLiveProofGuardError("recipient_not_allowed");
  }
  return `CONFIRM GMAIL SEND ${runId} TO ${recipient}`;
}

export function gmailLiveProofTargetFingerprint(recipient: string, databaseUrl: string): string {
  return sha256Text(`gmail\0${recipient.toLowerCase()}\0database\0${databaseUrl}`).slice(0, 23);
}

export function initialGmailLiveProofReadModel(plan: GmailLiveProofPlan, now: Date): GmailLiveProofReadModel {
  return GmailLiveProofReadModelSchema.parse({
    schemaVersion: GMAIL_LIVE_PROOF_CONTRACT_VERSION,
    operation: "gmail_live_proof",
    status: "planned",
    runId: plan.message.runId,
    actionId: plan.actionId,
    recipientDigest: plan.recipientDigest,
    replayKey: plan.replayKey,
    replayVerified: false,
    firstStatus: "pending",
    replayStatus: "pending",
    updatedAt: now.toISOString(),
  });
}

export function completedGmailLiveProofReadModel(
  plan: GmailLiveProofPlan,
  first: GmailDeliveryResult,
  replay: GmailDeliveryResult | null,
  now: Date,
): GmailLiveProofReadModel {
  const firstStatus = first.status;
  const replayVerified = first.status === "sent" && replay?.status === "sent" && replay.replay === true && replay.receipt.messageId === first.receipt.messageId;
  return GmailLiveProofReadModelSchema.parse({
    schemaVersion: GMAIL_LIVE_PROOF_CONTRACT_VERSION,
    operation: "gmail_live_proof",
    status: replayVerified ? "completed" : "attention_required",
    runId: plan.message.runId,
    actionId: plan.actionId,
    recipientDigest: plan.recipientDigest,
    replayKey: plan.replayKey,
    replayVerified,
    firstStatus,
    replayStatus: replay?.status === "sent" ? "sent" : "pending",
    updatedAt: now.toISOString(),
  });
}

export function assertGmailLiveProofSucceeded(first: GmailDeliveryResult, replay: GmailDeliveryResult | null, transportAttempts: number): void {
  if (first.status !== "sent") throw new GmailLiveProofGuardError("proof_not_sent");
  if (
    !replay ||
    replay.status !== "sent" ||
    replay.replay !== true ||
    replay.receipt.messageId !== first.receipt.messageId ||
    transportAttempts !== 1
  ) {
    throw new GmailLiveProofGuardError("replay_not_verified");
  }
}

export function safeGmailLiveProofFailureCode(error: unknown): string {
  if (error instanceof GmailLiveProofGuardError) return error.kind;
  if (error instanceof DemoCommandGuardError) return error.kind;
  if (error instanceof GmailDeliveryError) return error.code;
  if (error instanceof EnvironmentConfigError) return "invalid_environment";
  if (error instanceof GoogleOAuthProviderError) return "provider_unavailable";
  return "failed_safely";
}
