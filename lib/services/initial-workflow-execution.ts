import { z } from "zod";
import type { ArtifactPort } from "@/lib/adapters/artifact";
import { CalendarProviderError, type CalendarPort } from "@/lib/adapters/calendar";
import type { GmailPort } from "@/lib/adapters/gmail";
import type { ActionExecutionRecord } from "@/lib/contracts/execution-persistence";
import { VerifiedInitialPlanPayloadSchema } from "@/lib/contracts/initial-plan-server";
import { TaskMutationResponseSchema, WorldPrViewSchema, isInitialPlanView, type InitialPlanPayload, type TaskMutationResponse, type WorldPrView } from "@/lib/contracts/v1";
import { getExecutionPersistenceStore, getWorldPrStore } from "@/lib/db";
import type { ExecutionPersistenceStore } from "@/lib/db/execution-store";
import type { WorldPrStore } from "@/lib/db/store";
import { validateControlledCalendarEventMetadata, type CalendarDemoConfiguration } from "@/lib/domain/calendar-demo";
import { canonicalJson, sha256Digest, sha256Text } from "@/lib/domain/digest";
import { createOpaqueId } from "@/lib/domain/ids";
import { assertRegisteredGmailTemplate } from "@/lib/domain/gmail-template";
import { executeApprovedInitialArtifact } from "@/lib/services/initial-artifact-execution";
import { executeApprovedInitialCalendar } from "@/lib/services/initial-calendar-execution";
import { executeApprovedInitialGmail } from "@/lib/services/initial-gmail-execution";
import { initialPlanViewFromPayload } from "@/lib/services/initial-approval";
import { loadLiveInitialExecutionRuntime } from "@/lib/services/live-initial-runtime";
import { ServiceError } from "@/lib/services/world-pr";

const InitialWorkflowExecutionRequestSchema = z
  .object({
    planId: z.string().min(8).max(200),
    planVersion: z.number().int().min(1).max(1000),
    planDigest: z.string().regex(/^sha256:[a-f0-9]{64}$/),
  })
  .strict();

export type InitialWorkflowExecutionInput = Readonly<{
  actorId: string;
  source: "dashboard" | "mcp";
  idempotencyKey: string;
  requestId?: string;
  worldPrId: string;
  request: unknown;
}>;

export type InitialWorkflowRuntime = Readonly<{
  artifactPort: ArtifactPort;
  calendar: CalendarPort;
  gmail: GmailPort;
  calendarConfiguration: CalendarDemoConfiguration;
  expectedSenderGoogleSub: string;
  allowlist: { UK: string[]; US: string[] };
  buildReplacement?: (payload: InitialPlanPayload) => Promise<InitialPlanPayload>;
}>;

export type InitialWorkflowExecutionDependencies = Readonly<{
  worldStore?: WorldPrStore;
  executionStore?: ExecutionPersistenceStore;
  loadRuntime?: (taskId: string) => Promise<InitialWorkflowRuntime>;
  now?: () => Date;
}>;

const initialExecutionTails = new Map<string, Promise<void>>();

export async function executeApprovedInitialWorkflow(
  input: InitialWorkflowExecutionInput,
  dependencies: InitialWorkflowExecutionDependencies = {},
): Promise<{ response: TaskMutationResponse; view: WorldPrView; replay: boolean }> {
  return withInitialExecutionLock(input.worldPrId, () => executeApprovedInitialWorkflowUnlocked(input, dependencies));
}

async function executeApprovedInitialWorkflowUnlocked(
  input: InitialWorkflowExecutionInput,
  dependencies: InitialWorkflowExecutionDependencies,
): Promise<{ response: TaskMutationResponse; view: WorldPrView; replay: boolean }> {
  if (input.source !== "dashboard") throw new ServiceError("forbidden", "MCP may not approve or execute a World PR.");
  if (!input.idempotencyKey || input.idempotencyKey.length < 16 || input.idempotencyKey.length > 200) {
    throw new ServiceError("invalid_request", "Idempotency-Key is required and must be between 16 and 200 characters.");
  }
  const parsed = InitialWorkflowExecutionRequestSchema.safeParse(input.request);
  if (!parsed.success) throw new ServiceError("invalid_request", "Execution must identify the exact approved initial plan.");
  const requestId = input.requestId ?? createOpaqueId("req_");
  const worldStore = dependencies.worldStore ?? getWorldPrStore();
  const executionStore = dependencies.executionStore ?? getExecutionPersistenceStore();
  const now = dependencies.now ?? (() => new Date());
  const current = await requireExecutableView(worldStore, input.worldPrId, input.actorId, parsed.data);
  const mutation = {
    actorId: input.actorId,
    endpoint: `POST /api/v1/world-prs/${input.worldPrId}/execution`,
    idempotencyKey: input.idempotencyKey,
    bodyHash: sha256Digest({ worldPrId: input.worldPrId, request: parsed.data }),
    worldPrId: input.worldPrId,
    requestId,
    claimedAt: now().toISOString(),
  };
  const claim = await worldStore.claimMutation(mutation);
  if (claim.kind === "replay_failed") throw new ServiceError(claim.failure.code as ServiceError["code"], claim.failure.message);
  if (claim.kind === "replay_completed") {
    const view = await requireWorldView(worldStore, input.worldPrId, input.actorId);
    return { response: claim.response, view, replay: true };
  }
  if (claim.kind === "replay_pending") {
    return { response: mutationResponse(current, requestId, true), view: current, replay: true };
  }
  const lease = { ...mutation, claimToken: claim.claimToken };

  try {
    const plan = await executionStore.getPlan(parsed.data.planId);
    if (!plan || plan.taskId !== input.worldPrId || plan.version !== parsed.data.planVersion || plan.digest !== parsed.data.planDigest) {
      throw new ServiceError("plan_digest_mismatch", "Execution is not bound to the active immutable plan.");
    }
    const payload = VerifiedInitialPlanPayloadSchema.parse(plan.payload);
    const approval = await executionStore.getApproval(plan.planId);
    if (!approval) throw new ServiceError("approval_required", "The exact initial plan must be approved before execution.");
    if (
      approval.actorId !== input.actorId ||
      approval.planVersion !== plan.version ||
      approval.planDigest !== plan.digest
    ) {
      throw new ServiceError("plan_digest_mismatch", "The stored approval is not bound to this actor and immutable plan.");
    }

    const existingActions = await executionStore.listActions(plan.planId);
    if (existingActions.length !== 3) throw new ServiceError("invalid_task_state", "The approved plan is missing its complete action ledger.");
    if (existingActions.every((action) => action.status === "succeeded")) {
      const completed = await persistInitialTaskState(worldStore, current, "completed", now());
      const response = mutationResponse(completed, requestId);
      await worldStore.completeMutation(lease, response);
      return { response, view: completed, replay: true };
    }

    let runtime: InitialWorkflowRuntime;
    try {
      runtime = await (dependencies.loadRuntime ?? loadLiveInitialExecutionRuntime)(input.worldPrId);
    } catch (error) {
      throw new ServiceError("provider_unavailable", "The approved provider runtime is unavailable; no new external action was attempted.", { cause: error });
    }
    try {
      await preflightApprovedInitialWorkflow(payload, existingActions, runtime);
    } catch (error) {
      if (!(error instanceof ServiceError) || error.code !== "plan_stale" || !runtime.buildReplacement) throw error;
      if (!isPristineInitialActionSet(existingActions)) {
        throw new ServiceError("provider_conflict", "Provider drift occurred after execution state began; operator reconciliation is required.");
      }
      const replacement = await runtime.buildReplacement(payload).catch((cause) => {
        throw new ServiceError("provider_unavailable", "A fresh provider-grounded preview could not be prepared; no external action was attempted.", { cause });
      });
      const refreshed = await invalidateStaleInitialPlan(
        worldStore,
        executionStore,
        current,
        payload,
        existingActions,
        replacement,
        now(),
      );
      const response = mutationResponse(refreshed, requestId);
      await worldStore.completeMutation(lease, response);
      return { response, view: refreshed, replay: false };
    }
    let view = await persistInitialTaskState(worldStore, current, "executing", now());

    const executionInput = () => {
      const started = now();
      return {
        actorId: input.actorId,
        source: "dashboard" as const,
        planId: plan.planId,
        planDigest: plan.digest,
        now: started.toISOString(),
        leaseUntil: new Date(started.getTime() + 60_000).toISOString(),
      };
    };
    const artifact = await executeApprovedInitialArtifact(executionInput(), {
      executionStore,
      artifactPort: runtime.artifactPort,
    });
    if (artifact.decision === "succeeded" || artifact.decision === "skipped") {
      const calendar = await executeApprovedInitialCalendar(executionInput(), {
        executionStore,
        calendar: runtime.calendar,
        configuration: runtime.calendarConfiguration,
      });
      if (calendar.decision === "succeeded" || calendar.decision === "skipped") {
        await executeApprovedInitialGmail(executionInput(), {
          executionStore,
          gmail: runtime.gmail,
          expectedSenderGoogleSub: runtime.expectedSenderGoogleSub,
          allowlist: runtime.allowlist,
        });
      }
    }

    const finalActions = await executionStore.listActions(plan.planId);
    view = finalActions.every((action) => action.status === "succeeded")
      ? await persistInitialTaskState(worldStore, view, "completed", now())
      : await persistInitialTaskState(worldStore, view, "attention_required", now(), attentionFor(finalActions));
    const response = mutationResponse(view, requestId);
    await worldStore.completeMutation(lease, response);
    return { response, view, replay: false };
  } catch (error) {
    const serviceError = error instanceof ServiceError
      ? error
      : new ServiceError("internal_error", "Initial execution failed safely; durable state must be reviewed before retry.", { cause: error });
    try {
      await worldStore.failMutation(lease, {
        code: serviceError.code,
        message: serviceError.message,
        retryable: serviceError.code === "provider_unavailable",
        requestId,
      });
    } catch (persistenceError) {
      throw new ServiceError(
        "internal_error",
        "Initial execution stopped, but its request outcome could not be recorded durably; inspect the action ledger before retry.",
        { cause: persistenceError },
      );
    }
    throw serviceError;
  }
}

async function invalidateStaleInitialPlan(
  worldStore: WorldPrStore,
  executionStore: ExecutionPersistenceStore,
  current: WorldPrView,
  previousPayload: InitialPlanPayload,
  previousActions: readonly ActionExecutionRecord[],
  replacementValue: InitialPlanPayload,
  now: Date,
): Promise<WorldPrView> {
  if (
    current.status !== "executing" ||
    !isPristineInitialActionSet(previousActions)
  ) {
    throw new ServiceError("provider_conflict", "Provider drift occurred after execution state began; operator reconciliation is required.");
  }
  let replacement: InitialPlanPayload;
  try {
    replacement = VerifiedInitialPlanPayloadSchema.parse(replacementValue);
  } catch (error) {
    throw new ServiceError("plan_digest_mismatch", "The fresh provider-grounded preview failed its immutable digest check.", { cause: error });
  }
  if (
    replacement.taskId !== previousPayload.taskId ||
    replacement.request !== previousPayload.request ||
    replacement.version !== previousPayload.version + 1 ||
    replacement.planId === previousPayload.planId ||
    replacement.digest === previousPayload.digest
  ) {
    throw new ServiceError("plan_digest_mismatch", "The fresh provider-grounded preview is not the next immutable plan version.");
  }

  const occurredAt = now.toISOString();
  for (const action of previousActions) {
    await executionStore.recordActionState({
      actionExecutionId: action.actionExecutionId,
      status: "conflict",
      now: occurredAt,
      error: {
        code: "plan_stale",
        retryable: false,
        safeMessage: "The approved provider snapshot changed before any action began; this plan was invalidated.",
      },
    });
  }
  const nextView = WorldPrViewSchema.parse({
    ...current,
    status: "preview_ready",
    activePlan: initialPlanViewFromPayload(replacement),
    timeline: [
      ...current.timeline,
      {
        eventId: createOpaqueId("evt_"),
        type: "plan.invalidated_and_superseded",
        occurredAt,
        label: "Provider drift invalidated approval; a fresh immutable preview requires approval",
        status: "preview_ready",
      },
    ],
    updatedAt: occurredAt,
  });
  await worldStore.persistInitialPlanVersion(
    current.worldPrId,
    replacement,
    nextView,
    { planId: previousPayload.planId, version: previousPayload.version, digest: previousPayload.digest },
  );
  return nextView;
}

function isPristineInitialActionSet(actions: readonly ActionExecutionRecord[]): boolean {
  return actions.length === 3 && actions.every((action) =>
    action.status === "planned" &&
    action.attempts === 0 &&
    action.startedAt === null &&
    action.dispatchStartedAt === null &&
    action.receipt === undefined,
  );
}

async function withInitialExecutionLock<T>(worldPrId: string, operation: () => Promise<T>): Promise<T> {
  const previous = initialExecutionTails.get(worldPrId) ?? Promise.resolve();
  let release!: () => void;
  const gate = new Promise<void>((resolve) => { release = resolve; });
  const current = previous.catch(() => undefined).then(() => gate);
  initialExecutionTails.set(worldPrId, current);
  await previous.catch(() => undefined);
  try {
    return await operation();
  } finally {
    release();
    if (initialExecutionTails.get(worldPrId) === current) initialExecutionTails.delete(worldPrId);
  }
}

export async function preflightApprovedInitialWorkflow(
  payload: z.infer<typeof VerifiedInitialPlanPayloadSchema>,
  actionRows: readonly ActionExecutionRecord[],
  runtime: Pick<InitialWorkflowRuntime, "calendar" | "gmail" | "calendarConfiguration" | "expectedSenderGoogleSub" | "allowlist">,
): Promise<void> {
  const calendarAction = payload.actions[1];
  const mailAction = payload.actions[2];
  const calendarRow = actionRows.find((action) => action.actionKey === calendarAction.actionKey);
  const mailRow = actionRows.find((action) => action.actionKey === mailAction.actionKey);
  if (!calendarRow || !mailRow) throw new ServiceError("invalid_task_state", "The complete approved action ledger is required before preflight.");

  if (calendarRow.status !== "succeeded") {
    let current;
    try {
      current = await runtime.calendar.getControlledEvent(calendarAction.target);
    } catch (error) {
      if (error instanceof CalendarProviderError && error.kind === "not_found") {
        throw new ServiceError("plan_stale", "The approved Calendar target no longer exists; create and approve a fresh preview.");
      }
      throw new ServiceError("provider_unavailable", "Calendar preflight was unavailable; no new external action was attempted.", { cause: error });
    }
    try {
      validateControlledCalendarEventMetadata(current, runtime.calendarConfiguration, calendarAction.preconditions.privateTags.region);
    } catch (error) {
      throw new ServiceError("plan_stale", "The approved Calendar facts changed; create and approve a fresh preview.", { cause: error });
    }
    const expected = {
      calendarId: calendarAction.target.calendarId,
      providerEventId: calendarAction.target.providerEventId,
      start: calendarAction.preconditions.expectedStart,
      end: calendarAction.preconditions.expectedEnd,
      etag: calendarAction.preconditions.expectedEtag,
      organizerDigest: calendarAction.preconditions.organizerDigest,
      attendeeSetDigest: calendarAction.preconditions.attendeeSetDigest,
      eventType: calendarAction.preconditions.eventType,
      recurringEventId: calendarAction.preconditions.recurringEventId,
      ownedByConnectedAccount: calendarAction.preconditions.ownedByConnectedAccount,
      privateTags: calendarAction.preconditions.privateTags,
    };
    const actual = {
      calendarId: current.calendarId,
      providerEventId: current.providerEventId,
      start: current.start,
      end: current.end,
      etag: current.etag,
      organizerDigest: current.organizerDigest,
      attendeeSetDigest: current.attendeeSetDigest,
      eventType: current.eventType,
      recurringEventId: current.recurringEventId,
      ownedByConnectedAccount: current.ownedByConnectedAccount,
      privateTags: current.privateTags,
    };
    if (canonicalJson(actual) !== canonicalJson(expected)) {
      throw new ServiceError("plan_stale", "The approved Calendar facts changed; create and approve a fresh preview.");
    }
  }

  if (mailRow.status !== "succeeded") {
    const to = [...mailAction.desired.to].map((value) => value.toLowerCase()).sort();
    const uk = [...runtime.allowlist.UK].map((value) => value.toLowerCase()).sort();
    const us = new Set(runtime.allowlist.US.map((value) => value.toLowerCase()));
    if (
      mailAction.desired.senderGoogleSub !== runtime.expectedSenderGoogleSub ||
      canonicalJson(to) !== canonicalJson(uk) ||
      to.some((recipient) => us.has(recipient)) ||
      sha256Text(mailAction.desired.bodyText) !== mailAction.desired.bodyHash
    ) {
      throw new ServiceError("plan_stale", "The approved Gmail sender, recipient, or content binding changed; create and approve a fresh preview.");
    }
    try {
      assertRegisteredGmailTemplate(mailAction.actionKey, mailAction.desired);
      runtime.gmail.prepareApprovedMessage(mailAction.desired);
    } catch (error) {
      throw new ServiceError("plan_stale", "The approved Gmail payload no longer passes the closed template boundary; create and approve a fresh preview.", { cause: error });
    }
  }
}

async function requireExecutableView(
  store: WorldPrStore,
  worldPrId: string,
  actorId: string,
  pointer: z.infer<typeof InitialWorkflowExecutionRequestSchema>,
): Promise<WorldPrView> {
  const view = await requireWorldView(store, worldPrId, actorId);
  if (!view.activePlan || !isInitialPlanView(view.activePlan)) throw new ServiceError("plan_not_found", "That World PR has no active initial plan.");
  if (
    view.activePlan.pointer.planId !== pointer.planId ||
    view.activePlan.pointer.version !== pointer.planVersion ||
    view.activePlan.pointer.digest !== pointer.planDigest
  ) {
    throw new ServiceError("plan_digest_mismatch", "The execution request is not bound to the active immutable plan.");
  }
  if (!["executing", "attention_required", "completed"].includes(view.status)) {
    throw new ServiceError("invalid_task_state", "Only an approved initial plan may execute or resume.");
  }
  return view;
}

async function requireWorldView(store: WorldPrStore, worldPrId: string, actorId: string): Promise<WorldPrView> {
  const view = await store.get(worldPrId, actorId);
  if (!view) throw new ServiceError("task_not_found", "That World PR does not exist in the current controlled workspace.");
  return WorldPrViewSchema.parse(view);
}

function attentionFor(actions: readonly ActionExecutionRecord[]) {
  const failed = actions.find((action) => action.status !== "succeeded");
  const kind = failed?.status === "delivery_uncertain"
    ? "delivery_uncertain"
    : failed?.status === "conflict"
      ? "provider_conflict"
      : failed?.status === "permanently_failed"
        ? "permanent_failure"
        : "retryable_failure";
  return { stage: "initial" as const, kind, ...(failed ? { actionKey: failed.actionKey } : {}) };
}

async function persistInitialTaskState(
  store: WorldPrStore,
  current: WorldPrView,
  status: "executing" | "completed" | "attention_required",
  now: Date,
  attention?: ReturnType<typeof attentionFor>,
): Promise<WorldPrView> {
  if (current.status === status && canonicalJson(current.attention ?? null) === canonicalJson(attention ?? null)) return current;
  const occurredAt = now.toISOString();
  const labels = {
    executing: "Approved initial execution started or resumed",
    completed: "All approved initial actions completed with durable receipts",
    attention_required: "Initial execution stopped for operator attention",
  } as const;
  const next = WorldPrViewSchema.parse({
    ...current,
    status,
    ...(attention ? { attention } : {}),
    ...(!attention && current.attention ? { attention: undefined } : {}),
    timeline: [
      ...current.timeline,
      {
        eventId: createOpaqueId("evt_"),
        type: `execution.${status}`,
        occurredAt,
        label: labels[status],
        status,
      },
    ],
    updatedAt: occurredAt,
  });
  await store.updateView(current.worldPrId, next);
  return next;
}

function mutationResponse(view: WorldPrView, requestId: string, replayPending = false): TaskMutationResponse {
  return TaskMutationResponseSchema.parse({
    worldPrId: view.worldPrId,
    status: view.status,
    ...(view.activePlan ? { activePlan: view.activePlan.pointer } : {}),
    ...(view.attention ? { attention: view.attention } : {}),
    ...(replayPending ? { replayPending: true } : {}),
    requestId,
  });
}
