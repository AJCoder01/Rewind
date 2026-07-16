import { Pool } from "pg";
import { createInterface } from "node:readline/promises";
import { pathToFileURL } from "node:url";
import { resolve } from "node:path";
import type { GmailPort } from "@/lib/adapters/gmail";
import type { GmailApprovedMessage, GmailSendReceipt } from "@/lib/contracts/provider-ports";
import type { GmailDeliveryResult } from "@/lib/contracts/gmail-delivery";
import type { RecipientAllowlist } from "@/lib/config/environment";
import type { GmailDeliveryRequest } from "@/lib/services/gmail-delivery";
import { createOpaqueId } from "@/lib/domain/ids";
import { sha256Text } from "@/lib/domain/digest";
import { loadPrivateLocalEnvironment, requireDatabaseUrl } from "@/lib/db/config";
import { PostgresGmailDispatchStore } from "@/lib/db/gmail-dispatch";
import { PostgresGmailLiveProofRepository } from "@/lib/db/gmail-live-proof";
import { PostgresOAuthStore } from "@/lib/db/oauth-store";
import { loadApplicationEnvironment } from "@/lib/config/environment";
import { refreshGoogleAccessToken } from "@/lib/google/credentials";
import { GoogleGmailPort } from "@/lib/google/gmail";
import { GmailDeliveryService } from "@/lib/services/gmail-delivery";
import {
  GmailLiveProofGuardError,
  assertGmailLiveProofRecordMatches,
  assertGmailLiveProofSucceeded,
  assertTtyGatedGmailLiveProofEnvironment,
  buildGmailLiveProofPlan,
  completedGmailLiveProofReadModel,
  gmailLiveProofConfigurationFromEnvironment,
  gmailLiveProofConfirmationPhrase,
  gmailLiveProofTargetFingerprint,
  safeGmailLiveProofFailureCode,
} from "@/lib/services/gmail-live-proof";

class CountingGmailPort implements GmailPort {
  private attempts = 0;

  constructor(private readonly delegate: GmailPort) {}

  prepareApprovedMessage(input: GmailApprovedMessage): void {
    this.delegate.prepareApprovedMessage(input);
  }

  async sendApprovedMessage(input: GmailApprovedMessage): Promise<GmailSendReceipt> {
    this.attempts += 1;
    return this.delegate.sendApprovedMessage(input);
  }

  getAttemptCount(): number {
    return this.attempts;
  }
}

class ReplayOnlyGmailPort implements GmailPort {
  prepareApprovedMessage(): void {
    throw new Error("A persisted Gmail proof must replay before provider preparation.");
  }

  async sendApprovedMessage(): Promise<GmailSendReceipt> {
    throw new Error("A persisted Gmail proof must never redispatch.");
  }
}

async function main(): Promise<void> {
  let pool: Pool | undefined;
  try {
    loadPrivateLocalEnvironment();
    assertTtyGatedGmailLiveProofEnvironment(process.env, {
      stdinIsTTY: process.stdin.isTTY,
      stdoutIsTTY: process.stdout.isTTY,
    });
    const environment = loadApplicationEnvironment();
    const configuration = gmailLiveProofConfigurationFromEnvironment(environment);
    const databaseUrl = requireDatabaseUrl("DATABASE_URL", { DATABASE_URL: environment.DATABASE_URL });
    pool = new Pool({ connectionString: databaseUrl, max: 1 });
    const proofRepository = new PostgresGmailLiveProofRepository(pool);
    const existing = await proofRepository.read();
    if (existing) {
      assertGmailLiveProofRecordMatches(existing, configuration);
      if (existing.readModel.status === "completed" && existing.readModel.replayVerified) {
        process.stdout.write(`${JSON.stringify({
          status: "already_complete",
          operation: "gmail_live_proof",
          runId: existing.plan.message.runId,
          replayVerified: true,
          attempts: existing.attempts,
          recipientFingerprint: existing.plan.recipientDigest.slice(0, 23),
        })}\n`);
        return;
      }
    }

    const plan = existing?.plan ?? buildGmailLiveProofPlan(configuration, createOpaqueId("run_s038_"));
    const targetFingerprint = gmailLiveProofTargetFingerprint(configuration.recipient, databaseUrl);
    const confirmation = gmailLiveProofConfirmationPhrase(plan.message.runId, configuration.recipient);
    const readline = createInterface({ input: process.stdin, output: process.stdout });
    const answer = await readline.question(
      `S038 will send exactly one controlled Gmail message to ${configuration.recipient} and replay the same action without redispatch (target fingerprint ${targetFingerprint}). Type "${confirmation}" to continue: `,
    );
    readline.close();
    if (answer.trim() !== confirmation) {
      process.stdout.write('{"status":"cancelled","operation":"gmail_live_proof"}\n');
      return;
    }

    const record = existing ?? await proofRepository.create(plan, new Date());
    const dispatchStore = new PostgresGmailDispatchStore(pool);
    let first: GmailDeliveryResult;
    let replay: GmailDeliveryResult | null = null;
    let livePort: CountingGmailPort | null = null;

    if (record.actionStatus === "succeeded" && record.receipt?.status === "sent") {
      first = {
        status: "sent",
        receipt: record.receipt,
        replay: false,
        dispatchStartedAt: record.dispatchStartedAt,
      };
      const replayService = new GmailDeliveryService(new ReplayOnlyGmailPort(), dispatchStore);
      replay = await replayService.send(deliveryRequest(plan, environment.REWIND_RECIPIENT_ALLOWLIST));
    } else {
      const oauthStore = new PostgresOAuthStore(pool);
      const credential = await oauthStore.getCredential();
      if (
        !credential ||
        credential.googleSub !== environment.REWIND_GOOGLE_EXPECTED_SUB ||
        credential.email !== environment.REWIND_GOOGLE_EXPECTED_EMAIL
      ) {
        throw new GmailLiveProofGuardError("credential_unavailable");
      }
      const accessToken = await refreshGoogleAccessToken(
        { clientId: environment.GOOGLE_CLIENT_ID, clientSecret: environment.GOOGLE_CLIENT_SECRET },
        credential,
        environment.REWIND_TOKEN_ENCRYPTION_KEY,
        oauthStore,
      );
      livePort = new CountingGmailPort(new GoogleGmailPort({ accessToken: accessToken.accessToken }));
      const delivery = new GmailDeliveryService(livePort, dispatchStore);
      first = await delivery.send(deliveryRequest(plan, environment.REWIND_RECIPIENT_ALLOWLIST));
      if (first.status === "sent") replay = await delivery.send(deliveryRequest(plan, environment.REWIND_RECIPIENT_ALLOWLIST));
    }

    const readModel = completedGmailLiveProofReadModel(plan, first, replay, new Date());
    await proofRepository.finish(readModel);
    const persisted = await proofRepository.read();
    if (!persisted) throw new GmailLiveProofGuardError("replay_not_verified");
    assertGmailLiveProofSucceeded(first, replay, persisted.attempts);
    if (livePort && livePort.getAttemptCount() !== 1) throw new GmailLiveProofGuardError("replay_not_verified");

    const messageId = first.status === "sent" ? first.receipt.messageId : "missing";
    process.stdout.write(`${JSON.stringify({
      status: "ok",
      operation: "gmail_live_proof",
      runId: plan.message.runId,
      firstStatus: first.status,
      replayStatus: replay?.status ?? "missing",
      replayVerified: persisted.readModel.replayVerified,
      attempts: persisted.attempts,
      recipientFingerprint: persisted.plan.recipientDigest.slice(0, 23),
      messageIdFingerprint: sha256Text(messageId).slice(0, 23),
    })}\n`);
  } catch (error) {
    process.stderr.write(`${JSON.stringify({ status: "failed", operation: "gmail_live_proof", code: safeGmailLiveProofFailureCode(error) })}\n`);
    process.exitCode = 1;
  } finally {
    await pool?.end();
  }
}

function deliveryRequest(plan: ReturnType<typeof buildGmailLiveProofPlan>, allowlist: RecipientAllowlist): GmailDeliveryRequest {
  return {
    actionId: plan.actionId,
    planId: plan.planId,
    actionKey: plan.actionKey,
    approvedPlanDigest: plan.digest,
    currentPlanDigest: plan.digest,
    expectedSenderGoogleSub: plan.message.senderGoogleSub,
    message: plan.message,
    allowlist: { UK: [...allowlist.UK], US: [...allowlist.US] },
  };
}

const entrypoint = process.argv[1];
if (entrypoint && import.meta.url === pathToFileURL(resolve(entrypoint)).href) {
  void main();
}
