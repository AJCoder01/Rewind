import { z } from "zod";
import {
  InitialArtifactAfterStateSchema,
  InitialArtifactBeforeStateSchema,
  InitialArtifactExecutionResultSchema,
  type InitialArtifactExecutionResult,
} from "@/lib/contracts/initial-artifact-execution";
import { type ActionExecutionRecord } from "@/lib/contracts/execution-persistence";
import { AccountBriefArtifactInputSchema, ArtifactReceiptSchema, type AccountBriefArtifactInput, type ArtifactReceipt } from "@/lib/contracts/provider-ports";
import { VerifiedInitialPlanPayloadSchema } from "@/lib/contracts/initial-plan-server";
import { OpaqueIdSchema } from "@/lib/contracts/v1";
import { ArtifactProviderError, type ArtifactPort } from "@/lib/adapters/artifact";
import { ExecutionPersistenceError, type ExecutionPersistenceStore } from "@/lib/db/execution-store";
import { AccountBriefBoundaryError, persistApprovedAccountBrief } from "@/lib/services/account-brief";
import { claimApprovedInitialAction } from "@/lib/services/initial-execution";
import { ServiceError } from "@/lib/services/world-pr";

const InitialArtifactExecutionRequestSchema = z
  .object({
    actorId: z.string().min(1).max(200),
    source: z.enum(["dashboard", "mcp"]),
    planId: OpaqueIdSchema,
    planDigest: z.string().regex(/^sha256:[a-f0-9]{64}$/),
    now: z.string().datetime({ offset: true }),
    leaseUntil: z.string().datetime({ offset: true }),
  })
  .strict();

export type InitialArtifactExecutionInput = z.infer<typeof InitialArtifactExecutionRequestSchema>;

export type InitialArtifactExecutionDependencies = Readonly<{
  executionStore: ExecutionPersistenceStore;
  artifactPort: ArtifactPort;
}>;

export async function executeApprovedInitialArtifact(
  input: InitialArtifactExecutionInput,
  dependencies: InitialArtifactExecutionDependencies,
): Promise<InitialArtifactExecutionResult> {
  const request = InitialArtifactExecutionRequestSchema.safeParse(input);
  if (!request.success) throw new ServiceError("invalid_request", "The initial artifact execution request did not match the strict contract.");

  const plan = await loadVerifiedPlan(request.data.planId, request.data.planDigest, dependencies.executionStore);
  const artifact = artifactFromPlan(plan.payload);
  const claim = await claimApprovedInitialAction(
    {
      ...request.data,
      actionKey: "initial.artifact.account_brief",
    },
    dependencies.executionStore,
  );

  if (claim.decision === "skipped") return artifactResult("skipped", claim.record, artifactReceiptFromRecord(claim.record));
  if (claim.decision === "busy") return artifactResult("busy", claim.record, undefined, "active_lease");
  if (claim.decision === "blocked") return artifactResult("blocked", claim.record, undefined, claim.reason === "reconciliation_required" ? "reconciliation_required" : claim.reason === "permanently_failed" ? "permanently_failed" : "conflict");

  let prepared: ActionExecutionRecord;
  const beforeState = InitialArtifactBeforeStateSchema.parse({
    contentHash: artifact.contentHash,
    sourceId: artifact.provenance.sourceId,
    sourceVersion: artifact.provenance.sourceVersion,
    sourceDigest: artifact.provenance.sourceDigest,
    validatorVersion: artifact.provenance.validatorVersion,
  });
  try {
    prepared = await dependencies.executionStore.recordActionState({
      actionExecutionId: claim.record.actionExecutionId,
      status: "in_progress",
      now: request.data.now,
      claimFence: claimFenceFor(claim.record),
      beforeState,
    });
  } catch (error) {
    throw toInitialArtifactServiceError(error, "The approved artifact could not be marked in progress; no artifact write was attempted.");
  }

  let receipt: ArtifactReceipt;
  try {
    receipt = ArtifactReceiptSchema.parse(await persistApprovedAccountBrief(dependencies.artifactPort, artifact));
  } catch (error) {
    if (error instanceof ArtifactProviderError && error.kind === "unavailable") {
      return terminalArtifactResult(
        dependencies.executionStore,
        prepared,
        "retryable_failed",
        request.data.now,
        { code: "artifact_unavailable", retryable: true, safeMessage: "The approved artifact store was unavailable before persistence completed." },
      );
    }
    if (error instanceof ArtifactProviderError && error.kind === "validation_failure") {
      return terminalArtifactResult(
        dependencies.executionStore,
        prepared,
        "permanently_failed",
        request.data.now,
        { code: "artifact_invalid", retryable: false, safeMessage: "The artifact store rejected the approved bytes or content hash." },
      );
    }
    if (error instanceof AccountBriefBoundaryError || error instanceof z.ZodError) {
      return terminalArtifactResult(
        dependencies.executionStore,
        prepared,
        "permanently_failed",
        request.data.now,
        { code: "artifact_invalid", retryable: false, safeMessage: "The immutable approved artifact failed its execution validation." },
      );
    }
    return terminalArtifactResult(
      dependencies.executionStore,
      prepared,
      "conflict",
      request.data.now,
      { code: "artifact_persistence_uncertain", retryable: false, safeMessage: "Artifact persistence returned an ambiguous result and requires reconciliation." },
    );
  }

  if (receipt.contentHash !== artifact.contentHash) {
    return terminalArtifactResult(
      dependencies.executionStore,
      prepared,
      "conflict",
      request.data.now,
      { code: "artifact_receipt_mismatch", retryable: false, safeMessage: "The artifact store receipt did not match the approved content hash." },
    );
  }

  const afterState = InitialArtifactAfterStateSchema.parse(receipt);
  let succeeded: ActionExecutionRecord;
  try {
    succeeded = await dependencies.executionStore.recordActionState({
      actionExecutionId: prepared.actionExecutionId,
      status: "succeeded",
      now: request.data.now,
      claimFence: claimFenceFor(prepared),
      beforeState,
      afterState,
      receipt,
    });
  } catch (error) {
    throw toInitialArtifactServiceError(error, "The artifact was persisted but its durable receipt could not be recorded; reconciliation is required.");
  }
  return artifactResultFromRecord(succeeded);
}

async function terminalArtifactResult(
  store: ExecutionPersistenceStore,
  current: ActionExecutionRecord,
  status: "retryable_failed" | "permanently_failed" | "conflict",
  now: string,
  error: { code: string; retryable: boolean; safeMessage: string },
): Promise<InitialArtifactExecutionResult> {
  try {
    const record = await store.recordActionState({
      actionExecutionId: current.actionExecutionId,
      status,
      now,
      claimFence: claimFenceFor(current),
      beforeState: current.beforeState,
      error,
    });
    const reason = status === "retryable_failed" ? "artifact_unavailable" : status === "permanently_failed" ? "artifact_invalid" : "artifact_persistence_uncertain";
    return artifactResultFromRecord(record, reason);
  } catch (persistenceError) {
    throw toInitialArtifactServiceError(persistenceError, "The artifact outcome could not be persisted safely; no automatic retry is allowed.");
  }
}

async function loadVerifiedPlan(planId: string, digest: string, store: ExecutionPersistenceStore) {
  const plan = await store.getPlan(planId);
  if (!plan) throw new ServiceError("plan_not_found", "The requested immutable plan does not exist.");
  if (plan.digest !== digest) throw new ServiceError("plan_digest_mismatch", "The execution request is not bound to the approved plan digest.");
  return plan;
}

function artifactFromPlan(payload: unknown): AccountBriefArtifactInput {
  try {
    const parsed = VerifiedInitialPlanPayloadSchema.parse(payload);
    if (parsed.actions[0].actionKey !== "initial.artifact.account_brief") throw new Error("artifact action key mismatch");
    return AccountBriefArtifactInputSchema.parse(parsed.actions[0].desired);
  } catch (error) {
    throw new ServiceError("plan_digest_mismatch", "The approved artifact could not be read from the immutable plan.", { cause: error });
  }
}

function artifactReceiptFromRecord(record: ActionExecutionRecord): ArtifactReceipt | undefined {
  const parsed = ArtifactReceiptSchema.safeParse(record.receipt);
  return parsed.success ? parsed.data : undefined;
}

function claimFenceFor(record: ActionExecutionRecord): { attempts: number; leaseUntil: string } {
  if (record.status !== "in_progress" || !record.leaseUntil) {
    throw new ServiceError("invalid_task_state", "The artifact action no longer holds a durable execution claim.");
  }
  return { attempts: record.attempts, leaseUntil: record.leaseUntil };
}

function artifactResultFromRecord(
  record: ActionExecutionRecord,
  preferredReason?: InitialArtifactExecutionResult["reason"],
): InitialArtifactExecutionResult {
  if (record.status === "succeeded") {
    const receipt = artifactReceiptFromRecord(record);
    if (!receipt) throw new ServiceError("invalid_task_state", "The durable artifact success record is missing its matching typed receipt.");
    return artifactResult("succeeded", record, receipt);
  }
  if (record.status === "retryable_failed") return artifactResult("retryable_failed", record, undefined, preferredReason ?? "artifact_unavailable");
  if (record.status === "permanently_failed") return artifactResult("permanently_failed", record, undefined, preferredReason ?? "permanently_failed");
  if (record.status === "conflict") return artifactResult("conflict", record, undefined, preferredReason ?? "conflict");
  if (record.status === "delivery_uncertain") return artifactResult("blocked", record, undefined, "reconciliation_required");
  if (record.status === "in_progress") return artifactResult("busy", record, undefined, "active_lease");
  throw new ServiceError("invalid_task_state", "The artifact action did not persist a terminal state.");
}

function artifactResult(
  decision: InitialArtifactExecutionResult["decision"],
  record: ActionExecutionRecord,
  receipt?: ArtifactReceipt,
  reason?: InitialArtifactExecutionResult["reason"],
): InitialArtifactExecutionResult {
  return InitialArtifactExecutionResultSchema.parse({
    contractVersion: "initial-artifact-execution.v1",
    decision,
    record,
    ...(receipt ? { receipt } : {}),
    ...(reason ? { reason } : {}),
  });
}

function toInitialArtifactServiceError(error: unknown, message: string): ServiceError {
  if (error instanceof ServiceError) return error;
  if (error instanceof ExecutionPersistenceError) {
    const code = error.code === "persistence_failure" ? "provider_unavailable" : error.code === "plan_not_found" ? "plan_not_found" : "invalid_task_state";
    return new ServiceError(code, message, { cause: error });
  }
  return new ServiceError("provider_unavailable", message, { cause: error });
}
