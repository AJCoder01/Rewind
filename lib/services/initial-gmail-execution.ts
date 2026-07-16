import { z } from "zod";
import {
  InitialGmailAfterStateSchema,
  InitialGmailBeforeStateSchema,
  InitialGmailExecutionResultSchema,
  type InitialGmailBeforeState,
  type InitialGmailExecutionResult,
} from "@/lib/contracts/initial-gmail-execution";
import { CalendarExecutionReceiptSchema, type ActionExecutionRecord, type ExecutionPlan } from "@/lib/contracts/execution-persistence";
import {
  GmailApprovedMessageSchema,
  GmailSendReceiptSchema,
  type GmailApprovedMessage,
  type GmailSendReceipt,
} from "@/lib/contracts/provider-ports";
import { RecipientAllowlistSchema, type RecipientAllowlist } from "@/lib/config/environment";
import { VerifiedInitialPlanPayloadSchema } from "@/lib/contracts/initial-plan-server";
import { OpaqueIdSchema, type InitialPlanPayload } from "@/lib/contracts/v1";
import { GmailProviderError, type GmailPort } from "@/lib/adapters/gmail";
import { ExecutionPersistenceError, type ExecutionPersistenceStore } from "@/lib/db/execution-store";
import { canonicalJson, sha256Text } from "@/lib/domain/digest";
import { assertRegisteredGmailTemplate, GmailTemplateValidationError } from "@/lib/domain/gmail-template";
import { gmailMessageIdentityDigests } from "@/lib/services/gmail-delivery";
import { claimApprovedInitialAction } from "@/lib/services/initial-execution";
import { ServiceError } from "@/lib/services/world-pr";

const InitialGmailExecutionRequestSchema = z
  .object({
    actorId: z.string().min(1).max(200),
    source: z.enum(["dashboard", "mcp"]),
    planId: OpaqueIdSchema,
    planDigest: z.string().regex(/^sha256:[a-f0-9]{64}$/),
    now: z.string().datetime({ offset: true }),
    leaseUntil: z.string().datetime({ offset: true }),
  })
  .strict();

export type InitialGmailExecutionInput = z.infer<typeof InitialGmailExecutionRequestSchema>;

export type InitialGmailExecutionDependencies = Readonly<{
  executionStore: ExecutionPersistenceStore;
  gmail: GmailPort;
  expectedSenderGoogleSub: string;
  allowlist: RecipientAllowlist;
}>;

type InitialMailAction = InitialPlanPayload["actions"][2];
type GmailTerminalStatus = "succeeded" | "retryable_failed" | "conflict" | "permanently_failed" | "delivery_uncertain";
type GmailTerminalReason =
  | "local_preparation"
  | "recipient_not_allowed"
  | "sender_not_allowed"
  | "unknown_template"
  | "invalid_message"
  | "provider_permanent_failure"
  | "delivery_uncertain";

class InitialGmailValidationError extends Error {
  readonly reason: Exclude<GmailTerminalReason, "local_preparation" | "provider_permanent_failure" | "delivery_uncertain">;

  constructor(reason: Exclude<GmailTerminalReason, "local_preparation" | "provider_permanent_failure" | "delivery_uncertain">) {
    super("The approved Gmail message failed a safety boundary before handoff.");
    this.name = "InitialGmailValidationError";
    this.reason = reason;
  }
}

export async function executeApprovedInitialGmail(
  input: InitialGmailExecutionInput,
  dependencies: InitialGmailExecutionDependencies,
): Promise<InitialGmailExecutionResult> {
  const request = InitialGmailExecutionRequestSchema.safeParse(input);
  if (!request.success) throw new ServiceError("invalid_request", "The initial Gmail execution request did not match the strict contract.");

  const plan = await loadVerifiedPlan(request.data.planId, request.data.planDigest, dependencies.executionStore);
  await assertApprovedInitialPlan(request.data, plan, dependencies.executionStore);
  const action = mailActionFromPlan(plan);
  const message = messageFromAction(action);
  const current = await readInitialMailAction(plan, action, request.data, dependencies.executionStore);

  if (current.decision === "skipped") return gmailResult("skipped", current.record, gmailReceiptFromRecord(current.record));
  if (current.decision === "busy") return gmailResult("busy", current.record, undefined, "active_lease");
  if (current.decision === "blocked") return gmailResult("blocked", current.record, gmailReceiptFromRecord(current.record), current.reason);

  let validatedMessage: GmailApprovedMessage;
  try {
    validatedMessage = validateApprovedMessage(message, dependencies.expectedSenderGoogleSub, dependencies.allowlist);
  } catch (error) {
    if (!(error instanceof InitialGmailValidationError)) throw toInitialGmailServiceError(error, "The approved Gmail message could not be validated safely.");
    return terminalGmailResult(
      dependencies.executionStore,
      current.record,
      "conflict",
      request.data.now,
      error.reason,
      { code: `gmail_${error.reason}`, retryable: false, safeMessage: "The approved Gmail sender, recipient, template, or content boundary failed before handoff." },
      undefined,
      undefined,
    );
  }

  try {
    dependencies.gmail.prepareApprovedMessage(validatedMessage);
  } catch (error) {
    if (error instanceof GmailProviderError && error.kind === "local_failure") {
      return terminalGmailResult(
        dependencies.executionStore,
        current.record,
        "retryable_failed",
        request.data.now,
        "local_preparation",
        { code: "gmail_local_preparation_failed", retryable: true, safeMessage: "Gmail preparation failed before a dispatch marker was persisted." },
      );
    }
    return terminalGmailResult(
      dependencies.executionStore,
      current.record,
      "retryable_failed",
      request.data.now,
      "local_preparation",
      { code: "gmail_preparation_unavailable", retryable: true, safeMessage: "Gmail preparation did not complete before handoff." },
    );
  }

  const claim = await claimApprovedInitialAction(
    {
      ...request.data,
      actionKey: "initial.mail.notify",
      dispatchStartedAt: request.data.now,
    },
    dependencies.executionStore,
  );
  if (claim.decision === "skipped") return gmailResult("skipped", claim.record, gmailReceiptFromRecord(claim.record));
  if (claim.decision === "busy") return gmailResult("busy", claim.record, undefined, "active_lease");
  if (claim.decision === "blocked") return gmailResult("blocked", claim.record, gmailReceiptFromRecord(claim.record), blockedReason(claim.reason));

  const beforeState = InitialGmailBeforeStateSchema.parse({
    ...gmailMessageIdentityDigests(validatedMessage),
    approvedPlanVersion: plan.version,
    approvedPlanDigest: plan.digest,
  });
  let prepared: ActionExecutionRecord;
  try {
    prepared = await dependencies.executionStore.recordActionState({
      actionExecutionId: claim.record.actionExecutionId,
      status: "in_progress",
      now: request.data.now,
      beforeState,
    });
  } catch (error) {
    throw toInitialGmailServiceError(error, "The Gmail before-state could not be persisted; no mail handoff was attempted.");
  }

  let receipt: GmailSendReceipt;
  try {
    receipt = GmailSendReceiptSchema.parse(await dependencies.gmail.sendApprovedMessage(validatedMessage));
  } catch (error) {
    const reason = error instanceof z.ZodError ? "malformed_success" : "transport_error";
    return persistGmailOutcome(
      dependencies.executionStore,
      prepared,
      request.data.now,
      { status: "delivery_uncertain", reason },
      beforeState,
    );
  }

  return persistGmailOutcome(dependencies.executionStore, prepared, request.data.now, receipt, beforeState);
}

async function readInitialMailAction(
  plan: ExecutionPlan,
  action: InitialMailAction,
  input: InitialGmailExecutionInput,
  store: ExecutionPersistenceStore,
): Promise<{ decision: "skipped" | "busy" | "blocked" | "ready"; record: ActionExecutionRecord; reason?: InitialGmailExecutionResult["reason"] }> {
  const actions = await store.listActions(plan.planId);
  const current = actions.find((candidate) => candidate.actionKey === "initial.mail.notify");
  if (!current) throw new ServiceError("invalid_task_state", "The approved plan has not been prepared with its complete action ledger.");
  if (canonicalJson(current.action) !== canonicalJson(action as unknown as Record<string, unknown>)) {
    throw new ServiceError("plan_digest_mismatch", "The durable Gmail action no longer matches the immutable approved payload.");
  }
  if (current.status === "succeeded") return { decision: "skipped", record: current };
  if (current.status === "delivery_uncertain" || current.status === "conflict" || current.status === "permanently_failed") {
    return { decision: "blocked", record: current, reason: blockedReasonForRecord(current.status) };
  }
  if (current.status === "in_progress") {
    if (current.leaseUntil && Date.parse(current.leaseUntil) > Date.parse(input.now)) return { decision: "busy", record: current, reason: "active_lease" };
    const reconciled = await claimApprovedInitialAction({ ...input, actionKey: "initial.mail.notify" }, store);
    if (reconciled.decision === "blocked") return { decision: "blocked", record: reconciled.record, reason: blockedReason(reconciled.reason) };
    if (reconciled.decision === "busy") return { decision: "busy", record: reconciled.record, reason: "active_lease" };
    if (reconciled.decision === "skipped") return { decision: "skipped", record: reconciled.record };
    throw new ServiceError("invalid_task_state", "The expired Gmail action could not be reconciled safely.");
  }
  const artifact = actions.find((candidate) => candidate.actionKey === "initial.artifact.account_brief");
  const calendar = actions.find((candidate) => candidate.actionKey === "initial.calendar.move");
  const calendarReceipt = calendar ? CalendarExecutionReceiptSchema.safeParse(calendar.receipt) : undefined;
  if (current.status !== "planned" && current.status !== "retryable_failed") throw new ServiceError("action_not_retryable", "The Gmail action is not in an explicitly safe state for execution.");
  if (!artifact || artifact.status !== "succeeded" || !calendar || calendar.status !== "succeeded" || !calendarReceipt?.success || calendarReceipt.data.operation !== "move") {
    throw new ServiceError("invalid_task_state", "The approved action order requires the artifact and reversible Calendar move to succeed first.");
  }
  return { decision: "ready", record: current };
}

function validateApprovedMessage(message: GmailApprovedMessage, expectedSenderGoogleSub: string, allowlist: RecipientAllowlist): GmailApprovedMessage {
  const parsedAllowlist = RecipientAllowlistSchema.safeParse(allowlist);
  if (!parsedAllowlist.success) throw new InitialGmailValidationError("invalid_message");
  let parsed: GmailApprovedMessage;
  try {
    parsed = GmailApprovedMessageSchema.parse(message);
    assertRegisteredGmailTemplate("initial.mail.notify", parsed);
  } catch (error) {
    if (error instanceof GmailTemplateValidationError || error instanceof z.ZodError) throw new InitialGmailValidationError("unknown_template");
    throw error;
  }
  if (parsed.senderGoogleSub !== expectedSenderGoogleSub) throw new InitialGmailValidationError("sender_not_allowed");
  if (sha256Text(parsed.bodyText) !== parsed.bodyHash) throw new InitialGmailValidationError("unknown_template");
  const allowed = new Set([...parsedAllowlist.data.UK, ...parsedAllowlist.data.US].map((recipient) => recipient.toLowerCase()));
  if (parsed.to.some((recipient) => !allowed.has(recipient.toLowerCase()))) throw new InitialGmailValidationError("recipient_not_allowed");
  return parsed;
}

function messageFromAction(action: InitialMailAction): GmailApprovedMessage {
  try {
    return GmailApprovedMessageSchema.parse(action.desired);
  } catch (error) {
    throw new ServiceError("plan_digest_mismatch", "The approved Gmail message could not be read from the immutable plan.", { cause: error });
  }
}

async function persistGmailOutcome(
  store: ExecutionPersistenceStore,
  current: ActionExecutionRecord,
  now: string,
  receipt: GmailSendReceipt,
  beforeState: InitialGmailBeforeState,
): Promise<InitialGmailExecutionResult> {
  const parsedReceipt = GmailSendReceiptSchema.parse(receipt);
  const status: GmailTerminalStatus = parsedReceipt.status === "sent" ? "succeeded" : parsedReceipt.status === "permanent_failed" ? "permanently_failed" : "delivery_uncertain";
  const error = parsedReceipt.status === "sent"
    ? undefined
    : parsedReceipt.status === "permanent_failed"
      ? { code: "gmail_permanent_failed", retryable: false, safeMessage: "Gmail permanently rejected the approved message after handoff." }
      : { code: "gmail_delivery_uncertain", retryable: false, safeMessage: "The Gmail delivery outcome is uncertain and must not be automatically retried." };
  try {
    const record = await store.recordActionState({
      actionExecutionId: current.actionExecutionId,
      status,
      now,
      beforeState,
      afterState: InitialGmailAfterStateSchema.parse({ receipt: parsedReceipt, recordedAt: now }),
      receipt: parsedReceipt,
      ...(error ? { error } : {}),
    });
    if (status === "succeeded") return gmailResult("succeeded", record, parsedReceipt);
    if (status === "permanently_failed") return gmailResult("permanently_failed", record, parsedReceipt, "provider_permanent_failure");
    return gmailResult("delivery_uncertain", record, parsedReceipt, "delivery_uncertain");
  } catch (error) {
    throw toInitialGmailServiceError(error, "The Gmail outcome could not be recorded safely; reconciliation is required.");
  }
}

async function terminalGmailResult(
  store: ExecutionPersistenceStore,
  current: ActionExecutionRecord,
  status: "retryable_failed" | "conflict",
  now: string,
  reason: "local_preparation" | "recipient_not_allowed" | "sender_not_allowed" | "unknown_template" | "invalid_message",
  error: { code: string; retryable: boolean; safeMessage: string },
  beforeState?: InitialGmailBeforeState,
  afterState?: never,
): Promise<InitialGmailExecutionResult> {
  try {
    const record = await store.recordActionState({
      actionExecutionId: current.actionExecutionId,
      status,
      now,
      ...(beforeState ? { beforeState } : {}),
      ...(afterState ? { afterState } : {}),
      error,
    });
    return status === "retryable_failed"
      ? gmailResult("retryable_failed", record, undefined, reason)
      : gmailResult("blocked", record, undefined, reason);
  } catch (persistenceError) {
    throw toInitialGmailServiceError(persistenceError, "The Gmail pre-handoff outcome could not be persisted safely; no send was attempted.");
  }
}

async function loadVerifiedPlan(planId: string, digest: string, store: ExecutionPersistenceStore): Promise<ExecutionPlan> {
  const plan = await store.getPlan(planId);
  if (!plan) throw new ServiceError("plan_not_found", "The requested immutable plan does not exist.");
  if (plan.digest !== digest) throw new ServiceError("plan_digest_mismatch", "The execution request is not bound to the approved plan digest.");
  return plan;
}

async function assertApprovedInitialPlan(input: InitialGmailExecutionInput, plan: ExecutionPlan, store: ExecutionPersistenceStore): Promise<void> {
  if (input.source !== "dashboard") throw new ServiceError("forbidden", "MCP may not approve or execute a World PR.");
  const approval = await store.getApproval(plan.planId);
  if (!approval) throw new ServiceError("approval_required", "The exact initial plan must be approved before execution.");
  if (approval.actorId !== input.actorId) throw new ServiceError("forbidden", "This plan was approved by a different authenticated operator.");
  if (approval.planVersion !== plan.version || approval.planDigest !== plan.digest) {
    throw new ServiceError("plan_digest_mismatch", "The approval is not bound to the immutable execution plan.");
  }
}

function mailActionFromPlan(plan: ExecutionPlan): InitialMailAction {
  try {
    const payload = VerifiedInitialPlanPayloadSchema.parse(plan.payload);
    if (plan.kind !== "initial" || payload.planId !== plan.planId || payload.taskId !== plan.taskId || payload.version !== plan.version || payload.digest !== plan.digest) throw new Error("execution plan identity mismatch");
    if (payload.actions[2].actionKey !== "initial.mail.notify") throw new Error("mail action key mismatch");
    return payload.actions[2];
  } catch (error) {
    throw new ServiceError("plan_digest_mismatch", "The approved Gmail action could not be read from the immutable plan.", { cause: error });
  }
}

function gmailReceiptFromRecord(record: ActionExecutionRecord): GmailSendReceipt | undefined {
  const parsed = GmailSendReceiptSchema.safeParse(record.receipt);
  return parsed.success ? parsed.data : undefined;
}

function gmailResult(
  decision: InitialGmailExecutionResult["decision"],
  record: ActionExecutionRecord,
  receipt?: GmailSendReceipt,
  reason?: InitialGmailExecutionResult["reason"],
): InitialGmailExecutionResult {
  return InitialGmailExecutionResultSchema.parse({
    contractVersion: "initial-gmail-execution.v1",
    decision,
    record,
    ...(receipt ? { receipt } : {}),
    ...(reason ? { reason } : {}),
  });
}

function blockedReason(reason: "dependency_not_satisfied" | "delivery_uncertain" | "conflict" | "permanently_failed" | "reconciliation_required" | undefined): InitialGmailExecutionResult["reason"] {
  if (reason === "delivery_uncertain") return "delivery_uncertain";
  if (reason === "reconciliation_required") return "reconciliation_required";
  if (reason === "permanently_failed") return "permanently_failed";
  return "conflict";
}

function blockedReasonForRecord(status: "delivery_uncertain" | "conflict" | "permanently_failed"): InitialGmailExecutionResult["reason"] {
  if (status === "delivery_uncertain") return "delivery_uncertain";
  if (status === "permanently_failed") return "permanently_failed";
  return "conflict";
}

function toInitialGmailServiceError(error: unknown, message: string): ServiceError {
  if (error instanceof ServiceError) return error;
  if (error instanceof ExecutionPersistenceError) {
    const code = error.code === "plan_not_found" ? "plan_not_found" : error.code === "persistence_failure" ? "provider_unavailable" : "invalid_task_state";
    return new ServiceError(code, message, { cause: error });
  }
  if (error instanceof z.ZodError) return new ServiceError("invalid_task_state", message, { cause: error });
  return new ServiceError("provider_unavailable", message, { cause: error });
}
