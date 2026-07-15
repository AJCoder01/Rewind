# Rewind MVP contracts

| Field | Value |
|---|---|
| Status | Implemented v1 boundary contract; Zod schemas and contract tests are canonical for exact fields |
| API version | `v1` |
| Scope | Controlled Acme Calendar + Gmail scenario |
| Last updated | 2026-07-15 |

This document owns boundary intent. Once implemented, versioned Zod schemas, migrations, and contract tests are canonical for exact field shapes. Keep this file synchronized.

## 1. Conventions

- JSON request/response bodies use camelCase.
- Database field naming may use snake_case behind a mapper.
- IDs are opaque, unguessable strings with at least 128 bits of entropy and prefixes for readability (`wpr_`, `plan_`, `act_`, `rule_`).
- Timestamps are RFC 3339 UTC strings.
- Event-local times also include an IANA time-zone identifier.
- All mutating HTTP requests require `Idempotency-Key`.
- MCP authentication uses a server-side bearer secret. Dashboard mutations use an authenticated session plus CSRF protection.
- Dashboard mutation requests must carry the `rewind_session` cookie, matching `rewind_csrf` cookie and `x-rewind-csrf` header, and an allowed same-origin `Origin` (or `Referer` only when `Origin` is absent); the CSRF token is not an authorization credential. A supplied `Origin` always takes precedence over `Referer`.
- Unknown object properties are rejected at security-sensitive boundaries.
- Every response includes or is associated with a `requestId` for support logs.

## 2. Error envelope

```typescript
interface ApiErrorResponse {
  error: {
    code: ErrorCode;
    message: string;
    retryable: boolean;
    details?: Record<string, string | number | boolean>;
  };
  requestId: string;
}

type ErrorCode =
  | "unauthorized"
  | "forbidden"
  | "invalid_request"
  | "unsupported_request"
  | "idempotency_conflict"
  | "scenario_busy"
  | "task_not_found"
  | "invalid_task_state"
  | "plan_not_found"
  | "plan_digest_mismatch"
  | "plan_stale"
  | "approval_required"
  | "clarification_required"
  | "candidate_set_invalid"
  | "model_output_invalid"
  | "unknown_entity"
  | "unknown_action"
  | "unknown_template"
  | "recipient_not_allowed"
  | "provider_conflict"
  | "provider_unavailable"
  | "delivery_uncertain"
  | "action_not_retryable"
  | "reset_conflict"
  | "internal_error";
```

Messages are safe for users and must not expose provider response bodies, tokens, email addresses, or stack traces.

Canonical lifecycle types used by every boundary:

```typescript
type TaskStatus =
  | "analyzing" | "clarification_required" | "preview_ready"
  | "executing" | "completed" | "correction_pending"
  | "recovery_ready" | "recovering" | "recovered"
  | "attention_required" | "cancelled" | "failed";

type ActionStatus =
  | "planned" | "in_progress" | "succeeded" | "retryable_failed"
  | "delivery_uncertain" | "conflict" | "permanently_failed";

interface AttentionReason {
  stage: "initial" | "recovery" | "reset";
  kind: "retryable_failure" | "delivery_uncertain" | "provider_conflict"
    | "validation_failure" | "permanent_failure" | "partial_reset";
  actionKey?: string;
}

interface PlanPointer {
  planId: string;
  kind: "initial" | "recovery" | "reset";
  version: number;
  digest: string;
}

interface TaskMutationResponse {
  worldPrId: string;
  status: TaskStatus;
  activePlan?: PlanPointer;
  attention?: AttentionReason;
  replayPending?: true;
  requestId: string;
}
```

## 3. HTTP API

### 3.1 Liveness and database readiness

`GET /api/health` is a process-liveness check. It does not contact PostgreSQL and returns HTTP `200` while the Next.js process can serve requests.

```json
{
  "status": "ok",
  "service": "rewind",
  "requestId": "req_..."
}
```

`GET /api/ready` is a dependency-readiness check. It opens the restricted runtime PostgreSQL connection and requires TLS, the expected database and runtime identity, the exact recorded foundation-migration checksum, and the complete expected table/constraint catalog. It returns HTTP `200` only when those checks pass.

```json
{
  "status": "ready",
  "service": "rewind",
  "schemaVersion": "0001_phase0_foundation",
  "requestId": "req_..."
}
```

Readiness failure returns the canonical error envelope with HTTP `503`, `code: "provider_unavailable"`, `retryable: true`, and the generic message `Rewind is not ready.` Neither endpoint exposes connection strings, roles, provider diagnostics, SQL, or stack traces. Both endpoints set `Cache-Control: no-store`.

### 3.2 Create World PR

`POST /api/v1/world-prs`

Headers:

```text
Authorization: Bearer <mcp-token>       # MCP only
Idempotency-Key: <caller-generated-key>
Content-Type: application/json
```

Dashboard uses its session rather than the bearer header.

Request:

```json
{
  "request": "Move the Acme renewal meeting on 2026-08-20 to 3:00 PM ET, prepare a risk brief from the shared Acme parent-account notes, and email the attendees."
}
```

Schema:

```typescript
interface CreateWorldPrRequest {
  request: string; // trimmed, 1..2000 characters
}

type CreateWorldPrResponse = {
  worldPrId: string;
  reviewUrl: string;
  requestId: string;
  replayPending?: true;
} & (
  | { status: "analyzing"; clarification?: never }
  | { status: "preview_ready"; clarification?: never }
  | { status: "clarification_required"; clarification: ClarificationView }
);
```

The server derives `source` from authentication context; clients cannot claim another source.

Response `201` (or identical replay response `200`):

The request performs controlled candidate lookup and active-rule evaluation **before** attempting the effect-bearing scenario lock. If no rule matches, it atomically acquires the lock with a planning lease, runs model-backed proposal generation/validation, and creates the immutable plan synchronously. Reads may observe `analyzing`; a successful response is reviewable.

```json
{
  "worldPrId": "wpr_01...",
  "status": "preview_ready",
  "reviewUrl": "https://rewind.example/pr/wpr_01...",
  "requestId": "req_01..."
}
```

The review URL contains no bearer/capability secret. A browser session is still required.

If an active rule matches during normal task creation, return `201` with the normal resource plus the renderable clarification payload:

```json
{
  "worldPrId": "wpr_01...",
  "status": "clarification_required",
  "reviewUrl": "https://rewind.example/pr/wpr_01...",
  "clarification": {
    "question": "I found Acme UK and Acme US. Which one did you mean?",
    "candidates": [
      { "candidateId": "cal_event_acme_uk", "label": "Acme UK" },
      { "candidateId": "cal_event_acme_us", "label": "Acme US" }
    ]
  },
  "requestId": "req_01..."
}
```

Persist this clarification-only intake and candidate snapshot, but no initial plan/action/lock. This is a normal product state, not an API error. A competing request returns `scenario_busy` only after it passes rule precheck and attempts effect-bearing planning.

Relevant errors: `invalid_request`, `unsupported_request`, `idempotency_conflict`, `scenario_busy`, `unauthorized`.

If an identical request arrives while the first planning claim is still active, the server returns the same resource ID with `status: "analyzing"` and `replayPending: true`. It does not wait inside the request or start a second planning saga. A safely failed claim replays its redacted terminal error; a conflicting body still returns `idempotency_conflict`.

### 3.3 Read World PR

`GET /api/v1/world-prs/:worldPrId`

Response:

```typescript
interface WorldPrView {
  worldPrId: string;
  runId?: string; // assigned only after this intake acquires the effect-bearing scenario lock
  request: string;
  status: TaskStatus;
  activePlan?: InitialPlanView | RecoveryPlanView;
  clarification?: ClarificationView;
  timeline: TimelineItem[];
  attention?: AttentionReason;
  ruleProposal?: PreventionRuleView;
  createdAt: string;
  updatedAt: string;
}

interface ClarificationView {
  question: string;
  candidates: Array<{ candidateId: string; label: string }>;
}

interface InitialPlanView {
  pointer: PlanPointer;
  selectedCandidate: { candidateId: string; label: string };
  alternatives: [{ candidateId: string; label: string }];
  assumptions: [Assumption];
  actions: [
    AccountBriefAction,
    CalendarMoveAction,
    MailNotificationAction
  ];
}

interface RecoveryPlanView {
  pointer: PlanPointer;
  correctedAssumption: RecoveryProposalV1["correctedAssumption"];
  decisions: RecoveryDecisionView[];
  actions: RecoveryPlannedAction[];
}

interface RecoveryDecisionView {
  executedActionId: string;
  outcome: "restore" | "correct" | "preserve";
  explanation: string;
}

interface TimelineItem {
  eventId: string;
  type: string;
  occurredAt: string;
  label: string;
  status?: TaskStatus | ActionStatus;
}

type PreventionRuleView = Omit<PreventionRuleV1, "rationale"> & {
  rationale: string;
};
```

This read model redacts raw OAuth/provider/model payloads and displays recipient aliases or controlled addresses only to the authenticated operator.

The scoped MCP token and the single authenticated demo operator belong to the same controlled workspace for this MVP. Therefore a World PR created through `create_world_pr` is readable by the authenticated dashboard operator at its review URL. Any other actor scope is rejected; the review URL remains non-authorizing.

### 3.4 Safe World PR status

`GET /api/v1/world-prs/:worldPrId/status`

This scoped read endpoint is used by MCP and other non-dashboard callers that need progress without plan details. It returns `McpWorldPrStatus`: the opaque World PR ID, lifecycle status, non-secret review URL, and only safe clarification/attention metadata. It never returns active plans, recipients, provider IDs, snapshots, prompts, or complete message bodies. Dashboard reads may use the full section 3.3 view after session authorization.

### 3.5 Approve initial plan

`POST /api/v1/world-prs/:worldPrId/approvals/initial`

Request:

```json
{
  "planId": "plan_01...",
  "planDigest": "sha256:..."
}
```

The approval request runs the short, persisted saga synchronously. It does not return `202` and continue work in an unobserved background task. While the request is active, reads may show `executing`.

Success `200` after all approved initial actions succeed:

```json
{
  "worldPrId": "wpr_01...",
  "status": "completed",
  "planId": "plan_01...",
  "requestId": "req_01..."
}
```

The handler transaction verifies session, CSRF, task state, current plan ID/digest, provider preview version, and absence of an existing different approval. It stores approval and claims/creates action ledger rows before dispatch. A partial/conflict/uncertain outcome returns the durable `attention_required` read model rather than a success claim; the action ledger remains resumable where safe.

If provider state differs before any action row starts, return `409 plan_stale`, mark the plan superseded, execute nothing, and direct the user to section 3.11.1. Never mutate an approved plan in place.

### 3.6 Resume known-safe work

`POST /api/v1/world-prs/:worldPrId/resume`

Request:

```json
{
  "planId": "plan_01...",
  "planDigest": "sha256:..."
}
```

Resume never approves a plan and never retries `delivery_uncertain`, `conflict`, or `permanently_failed` actions. It only continues an already approved plan's `planned` or explicitly `retryable_failed` actions.

Success and attention responses use `TaskMutationResponse`. Relevant errors: `invalid_task_state`, `plan_digest_mismatch`, `action_not_retryable`, `provider_conflict`.

### 3.7 Submit late context

`POST /api/v1/world-prs/:worldPrId/context`

Allowed only when the task is `completed`. Initial partial, conflict, or delivery-uncertain states return `409 invalid_task_state`; Rewind cannot safely determine the recovery action universe until those outcomes are resolved.

Request:

```json
{
  "text": "Sales clarified after execution that the intended renewal was Acme US. Repair only the effects invalidated by that correction."
}
```

Schema:

```typescript
interface SubmitContextRequest {
  text: string; // trimmed, 1..2000 characters
}
```

The request performs recovery planning synchronously; reads may observe `correction_pending` while it is active. Success `200` returns `recovery_ready` with the immutable recovery-plan ID/digest. A model/validator technical failure returns the durable attention state. If the submitted context does not identify one explicit known target, return `422 clarification_required`, keep the task `completed`, and provide safe inline guidance; do not infer US from “wrong region.”

To revise context, cancel the unexecuted recovery attempt through section 3.14, then submit a new request with a new idempotency key. The replacement plan gets a higher version and the prior plan remains immutable/superseded.

### 3.8 Approve recovery plan

`POST /api/v1/world-prs/:worldPrId/approvals/recovery`

Request and response use the same plan ID/digest pattern as initial approval. The approved payload includes every exact Calendar target/time/precondition and every exact mail recipient/body. The request runs the persisted recovery saga synchronously and returns `recovered` only after every approved action succeeds; otherwise it returns the durable `attention_required` read model. No fire-and-forget work continues after the response.

If either Calendar version drifts before the first recovery action, return `409 plan_stale`, supersede the plan, execute nothing, and use section 3.11.2. After an action starts, never replan over the partial ledger.

### 3.9 Activate prevention rule

`POST /api/v1/world-prs/:worldPrId/rules/:ruleId/activate`

Request:

```json
{
  "ruleVersion": 1,
  "ruleDigest": "sha256:..."
}
```

This is separate from recovery approval. It can transition only the fixed rule from `proposed` to `active`.

Success `200` returns `TaskMutationResponse` plus `rule: PreventionRuleView`. Relevant errors: `invalid_task_state`, `plan_digest_mismatch`, `forbidden`.

### 3.10 Resolve clarification

`POST /api/v1/world-prs/:worldPrId/clarification`

Request:

```json
{
  "candidateId": "cal_event_acme_us"
}
```

Only IDs from the task's current candidate set are accepted. The server then creates a new immutable initial plan; it does not mutate a prior plan.

Resolution first tries to acquire the effect-bearing scenario lock. If another run still owns it, return `409 scenario_busy` and keep the clarification record intact. Success `200` returns `preview_ready` with `activePlan`; unknown/stale IDs return `422 unknown_entity`/`candidate_set_invalid` and create no plan.

### 3.11 Refresh or supersede an unexecuted plan

#### 3.11.1 Refresh initial preview

`POST /api/v1/world-prs/:worldPrId/plans/initial/refresh`

Allowed only when no initial action has started. It refetches candidates/provider versions, reruns initial planning and artifact validation, stores `version + 1`, marks the old plan superseded, and returns `preview_ready` with a new `PlanPointer`. Any old approval is invalid. If an action row/approval has begun execution, return `409 invalid_task_state`.

#### 3.11.2 Refresh recovery preview

`POST /api/v1/world-prs/:worldPrId/plans/recovery/refresh`

Allowed only from an unexecuted `recovery_ready`/validation-attention state. It rereads the latest submitted context and provider snapshots, reruns validated recovery planning, and stores a higher version. To change the context text itself, cancel recovery and resubmit it. If any recovery action has started, return `409 invalid_task_state`.

Both endpoints return `TaskMutationResponse`; relevant errors are `invalid_task_state`, `provider_conflict`, `model_output_invalid`, and `candidate_set_invalid`.

### 3.12 Prepare and approve reset

#### Prepare

`POST /api/v1/demo/reset-plans`

Request: `{ "runId": "run_01..." }`

Success `201` returns an immutable `ResetPlanV1`/digest for review. Preparation performs no provider write.

#### Approve and execute

`POST /api/v1/demo/reset-plans/:resetPlanId/approve`

```json
{
  "resetPlanId": "rplan_01...",
  "resetPlanDigest": "sha256:...",
  "acknowledgeSentMailRemains": true
}
```

Before its first write the handler refetches **both** events and compares their approved current ETags plus all boundary fields. A mismatch returns `409 reset_conflict` with zero writes and keeps the scenario lock. Each successful conditional restore is immediately recorded with its new ETag. If a race causes a later write to fail after an earlier restore succeeded, return `attention_required.partial_reset`, retain the lock and per-event receipts, and require a newly prepared/approved reset plan; never claim atomicity.

Complete success `200`:

```json
{
  "status": "reset_complete",
  "resetPlanId": "rplan_01...",
  "archivedWorldPrId": "wpr_01...",
  "nextRunId": "run_01...",
  "calendarRestored": true,
  "sentMailDeleted": false,
  "requestId": "req_01..."
}
```

### 3.13 Cancel before initial execution

`POST /api/v1/world-prs/:worldPrId/cancel`

Allowed only from `preview_ready` or `clarification_required`. It marks the intake `cancelled` and archives any unexecuted plan. It releases the scenario lock only when that task owns it; a clarification-only intake owns none. It never runs an adapter. Success uses `TaskMutationResponse`.

### 3.14 Cancel or dismiss recovery

`POST /api/v1/world-prs/:worldPrId/recovery/cancel`

Allowed from `correction_pending`, `recovery_ready`, or `attention_required.validation_failure` only when no recovery action row has started. It archives/supersedes the unapproved recovery/context attempt and returns the task to `completed`; all initial external effects remain. It does not release the scenario lock because reset is still required. Success uses `TaskMutationResponse`.

### 3.15 Try an active guardrail

There is no proof-only rule endpoint. The dashboard panel and MCP both use normal section 3.2 intake. A match returns the standard persisted `clarification_required` resource/read model and candidate payload before lock acquisition. The demo leaves that intake unresolved; it therefore has no plan, action, approval, or external effect.

### 3.16 Mutation response and error matrix

Every success/attention response includes `requestId`; task mutations use `TaskMutationResponse` unless a richer shape is shown above. A durable attention outcome is HTTP `200` because the request was recorded and needs operator action; request/precondition conflicts use `409`; validation/clarification uses `422`; auth uses `401/403`.

| Endpoint | Success state | Principal typed errors |
|---|---|---|
| Create | `201 preview_ready` or `clarification_required`; replay `200` | `unsupported_request`, `idempotency_conflict`, `scenario_busy`, `candidate_set_invalid` |
| Initial approval | `200 completed` or durable attention | `plan_digest_mismatch`, `plan_stale`, `invalid_task_state`, `provider_conflict` |
| Resume | current completed/recovered/attention state | `action_not_retryable`, `plan_digest_mismatch`, `invalid_task_state` |
| Submit context | `200 recovery_ready` | `clarification_required`, `provider_conflict`, `model_output_invalid`, `invalid_task_state` |
| Recovery approval | `200 recovered` or durable attention | `plan_digest_mismatch`, `plan_stale`, `provider_conflict`, `invalid_task_state` |
| Rule activation | `200 recovered` plus active rule | `plan_digest_mismatch`, `invalid_task_state`, `forbidden` |
| Clarification resolution | `200 preview_ready` | `scenario_busy`, `unknown_entity`, `candidate_set_invalid` |
| Initial/recovery refresh | `200 preview_ready`/`recovery_ready` | `invalid_task_state`, `provider_conflict`, `model_output_invalid` |
| Reset prepare | `201 reset_preview_ready` | `invalid_task_state`, `provider_conflict` |
| Reset approval | `200 reset_complete` or durable reset attention | `plan_digest_mismatch`, `reset_conflict`, `invalid_task_state` |
| Initial/recovery cancel | `200 cancelled`/`completed` | `invalid_task_state` |

## 4. MCP interface

The local stdio MCP server exposes one required tool and one optional read-only tool.

### `create_world_pr`

Input:

```json
{
  "request": "Move the Acme renewal meeting on 2026-08-20 to 3:00 PM ET, prepare a risk brief from the shared Acme parent-account notes, and email the attendees."
}
```

Output:

```json
{
  "worldPrId": "wpr_01...",
  "status": "preview_ready",
  "reviewUrl": "https://rewind.example/pr/wpr_01..."
}
```

`status` is `preview_ready` for the first controlled demo run and may be `clarification_required` when an active rule stops normal future task creation.

When clarification is required, output also includes the same `clarification.question` and `{candidateId,label}` list as HTTP section 3.2. The review URL renders it. The tool still cannot resolve the choice or approve a plan.

The MCP server generates one idempotency key per tool invocation and reuses it for HTTP-level retries. It must not expose an approval or execution option.

### `get_world_pr_status` (optional)

Input:

```json
{
  "worldPrId": "wpr_01..."
}
```

Output:

```json
{
  "worldPrId": "wpr_01...",
  "status": "preview_ready",
  "reviewUrl": "https://rewind.example/pr/wpr_01..."
}
```

This tool is read-only and returns no recipient, provider, snapshot, prompt, or secret data.

## 5. Initial reasoning and plan contract

The server supplies a closed candidate/action/assumption universe plus provider-grounded ranking facts. The model proposes the selected known candidate, assumption, dependency edges, and account brief. Deterministic validation requires the nearest-upcoming UK candidate for the seeded first run, requires an exact dependency mapping, validates the brief against the approved parent-account facts and forbidden region/event/attendee/time dimensions, and rejects any unknown ID. The server alone expands accepted reasoning into provider-safe exact actions and a digest.

```typescript
interface InitialReasoningProposalV1 {
  schemaVersion: "initial-reasoning.v1";
  selectedCandidateId: string;
  assumption: Assumption;
  dependencyEdges: Array<{
    actionKey:
      | "initial.calendar.move"
      | "initial.mail.notify"
      | "initial.artifact.account_brief";
    assumptionIds: Array<"assumption_acme_region">;
  }>;
  accountBrief: {
    title: string;
    content: string;
    sourceId: "acme_parent_account_notes";
  };
}
```

```typescript
interface InitialPlanV1 {
  schemaVersion: "initial-plan.v1";
  taskId: string;
  planId: string;
  version: number;
  request: string;
  candidateSet: [CalendarCandidate, CalendarCandidate];
  selectedCandidateId: string;
  alternativeCandidateIds: [string];
  assumptions: [Assumption];
  actions: [
    AccountBriefAction,
    CalendarMoveAction,
    MailNotificationAction
  ];
  accountBriefContentHash: string;
  executionOrder: [
    "initial.artifact.account_brief",
    "initial.calendar.move",
    "initial.mail.notify"
  ];
  modelMetadata: ModelMetadata | FixtureModelMetadata;
  digest: string;
}

interface CalendarCandidate {
  candidateId: string;       // internal stable ID
  providerEventId: string;   // server-only in public view if desired
  title: string;
  company: "Acme";
  region: "UK" | "US";
  start: ZonedDateTime;
  end: ZonedDateTime;
  etag: string;
  attendeeSetDigest: string;
  rankingEvidence: string[];
}

interface ZonedDateTime {
  instant: string;   // RFC 3339
  timeZone: string;  // America/New_York for demo
}

interface Assumption {
  assumptionId: "assumption_acme_region";
  statement: string;
  resolvedCandidateId: string;
  evidence: string[];
  confidence: number; // 0..1, display only; never bypasses approval
}

type InitialPlannedAction =
  | (CalendarMoveAction & { actionKey: "initial.calendar.move" })
  | (MailNotificationAction & { actionKey: "initial.mail.notify" })
  | AccountBriefAction;
```

Canonical dependencies:

| Action key | Depends on `assumption_acme_region` | External effect |
|---|---:|---:|
| `initial.calendar.move` | Yes | Yes |
| `initial.mail.notify` | Yes | Yes |
| `initial.artifact.account_brief` | No | No |

The model meaningfully proposes the assumption and dependency graph but only over supplied IDs. The validator requires all three actions exactly once, requires the two entity-specific dependencies and the artifact's empty dependency list, and requires the seeded selection to equal the deterministic provider-grounded rank. Model output can never create an entity, recipient, action, or provider payload.

## 6. Approval contract

```typescript
interface Approval {
  approvalId: string;
  planId: string;
  planDigest: string;
  actorId: string;
  approvedAt: string;
}
```

Persist the complete `InitialPlanV1` payload in `plans.payload`; the dashboard's `InitialPlanView` is only a projection. Every digest field uses lowercase `sha256:` followed by exactly 64 hexadecimal characters. Recompute the plan digest from every field above except `digest` itself; storing only the read-model projection is invalid because it cannot reproduce the approved payload.

Approval is valid only when:

- the plan exists and is immutable;
- the supplied/recomputed digest equals the stored digest;
- task state accepts that plan kind;
- the actor/session is authorized;
- the relevant provider preview versions and recipient set still match;
- every exact external effect is visible in the plan; and
- no superseding plan exists.

Any plan-relevant change creates `version + 1` and invalidates the older approval.

## 7. Action ledger and receipts

```typescript
interface ActionBase {
  actionKey: string;
  dependsOnAssumptionIds: Array<"assumption_acme_region">;
  externalEffect: boolean;
}

interface CalendarTarget {
  calendarId: string;
  providerEventId: string;
}

interface DemoEventPrivateTags {
  rewind_demo: "acme-renewal";
  region: "UK" | "US";
}

interface CalendarPreconditions {
  expectedEtag: string;
  expectedStart: ZonedDateTime;
  expectedEnd: ZonedDateTime;
  organizerDigest: string;
  attendeeSetDigest: string;
  eventType: "default";
  recurringEventId: null;
  ownedByConnectedAccount: true;
  privateTags: DemoEventPrivateTags;
}

interface CalendarMoveAction extends ActionBase {
  actionKey: "initial.calendar.move" | "recovery.calendar.move_us";
  type: "calendar.move";
  target: CalendarTarget;
  preconditions: CalendarPreconditions;
  desired: {
    start: ZonedDateTime;
    end: ZonedDateTime;
    durationMinutes: 30;
    sendUpdates: "none";
  };
  externalEffect: true;
}

interface CalendarRestoreAction extends ActionBase {
  actionKey: "recovery.calendar.restore_uk";
  type: "calendar.restore";
  target: CalendarTarget;
  preconditions: CalendarPreconditions; // recorded Rewind after-state
  desired: {
    start: ZonedDateTime; // immutable semantic baseline
    end: ZonedDateTime;
    durationMinutes: 30;
    sendUpdates: "none";
  };
  externalEffect: true;
}

interface ApprovedMail {
  senderGoogleSub: string;
  to: string[]; // normalized exact allowlisted addresses; non-empty and unique
  subject: string;
  bodyText: string;
  bodyHash: string;
  runId: string;
}

interface MailNotificationAction extends ActionBase {
  actionKey: "initial.mail.notify" | "recovery.mail.notify_us";
  type: "mail.notify";
  desired: ApprovedMail;
  requiresSucceededActionKey:
    | "initial.calendar.move"
    | "recovery.calendar.move_us";
  externalEffect: true;
}

interface MailCorrectionAction extends ActionBase {
  actionKey: "recovery.mail.correct_uk";
  type: "mail.correct";
  desired: ApprovedMail;
  correctsActionExecutionId: string;
  requiresSucceededActionKey: "recovery.calendar.restore_uk";
  externalEffect: true;
}

interface AccountBriefAction extends ActionBase {
  actionKey: "initial.artifact.account_brief";
  type: "artifact.account_brief";
  desired: {
    title: string;
    content: string;
    contentHash: string;
    provenance: ArtifactProvenance;
  };
  dependsOnAssumptionIds: [];
  externalEffect: false;
}

type RecoveryPlannedAction =
  | CalendarRestoreAction
  | (CalendarMoveAction & { actionKey: "recovery.calendar.move_us" })
  | MailCorrectionAction
  | (MailNotificationAction & { actionKey: "recovery.mail.notify_us" });

type PlannedAction = InitialPlannedAction | RecoveryPlannedAction;

interface ActionExecutionBase<TAction extends PlannedAction> {
  actionExecutionId: string;
  planId: string;
  action: TAction;
  actionKey: TAction["actionKey"];
  type: TAction["type"];
  targetRef: string;
  status: ActionStatus;
  operationKey: string;
  beforeState?: CalendarSnapshot | ArtifactProvenance;
  afterState?: CalendarSnapshot | ArtifactRecord;
  receipt?: CalendarReceipt | GmailReceipt | ArtifactReceipt;
  attempts: number;
  leaseUntil?: string;
  dispatchStartedAt?: string; // mandatory before Gmail transport handoff
  error?: RedactedActionError;
  startedAt?: string;
  finishedAt?: string;
}

type ActionExecution =
  | ActionExecutionBase<CalendarMoveAction>
  | ActionExecutionBase<CalendarRestoreAction>
  | ActionExecutionBase<MailNotificationAction>
  | ActionExecutionBase<MailCorrectionAction>
  | ActionExecutionBase<AccountBriefAction>;

type ActionType = PlannedAction["type"];

interface CalendarSnapshot {
  providerEventId: string;
  etag: string;
  updatedAt: string;
  start: ZonedDateTime;
  end: ZonedDateTime;
  durationMinutes: 30;
  organizerDigest: string;
  attendeeSetDigest: string;
  recurringEventId: null;
}

interface CalendarReceipt {
  provider: "google_calendar";
  providerEventId: string;
  resultingEtag: string;
  verified: boolean;
}

interface GmailReceipt {
  provider: "gmail";
  messageId: string;
  threadId?: string;
}

interface ArtifactRecord {
  artifactId: string;
  contentHash: string;
  storedBytesEqualApprovedPlan: true;
}

interface ArtifactReceipt {
  artifactId: string;
  contentHash: string;
}

interface RedactedActionError {
  code: string;
  retryable: boolean;
  safeMessage: string;
}

interface ArtifactProvenance {
  sourceId: "acme_parent_account_notes";
  sourceDigest: string;
  excludedDimensions: ["calendar_event", "region", "attendees", "meeting_time"];
  validatorVersion: string;
}
```

The Zod implementation mirrors this discriminated union, rejects unknown properties, and separately derives an MCP-safe read view that omits provider IDs, addresses, bodies, and snapshots. The authenticated approval view intentionally shows exact controlled recipients and content.

## 8. Recovery model-output contract

Use strict Structured Outputs and reject additional properties.

```typescript
interface RecoveryProposalV1 {
  schemaVersion: "recovery-proposal.v1";
  correctedAssumption: {
    assumptionId: "assumption_acme_region";
    fromCandidateId: string;
    toCandidateId: string;
  };
  decisions: Array<{
    executedActionId: string;
    outcome: "restore" | "correct" | "preserve";
    reasonCode:
      | "entity_dependency_invalidated"
      | "irreversible_effect_requires_correction"
      | "recorded_dependency_unchanged";
    explanation: string;
  }>;
  newActions: Array<{
    template:
      | "calendar.apply_to_correct_entity"
      | "mail.notify_correct_attendees";
    targetCandidateId: string;
    explanation: string;
  }>;
}
```

The model returns no recipients, raw provider arguments, time values, message content, headers, API calls, or code. Deterministic code expands templates using the corrected candidate and approved request semantics.

### Required semantic validation

Reject unless all checks pass:

1. Schema version is supported and no extra property exists.
2. The corrected assumption ID exists in the approved initial plan.
3. `fromCandidateId` equals the approved selected candidate.
4. `toCandidateId` is one different known candidate explicitly supported by accumulated context.
5. Every referenced executed-action ID exists and has `succeeded` status.
6. Every succeeded initial action appears exactly once; no duplicate or omitted decision exists.
7. Calendar move depending on corrected entity is `restore`.
8. Sent notification depending on corrected entity is `correct`.
9. Account brief with canonical independent provenance is `preserve`.
10. No `preserve` action depends on the corrected assumption.
11. No `restore` is proposed for irreversible mail.
12. Exactly the two allowed new templates appear once each against the corrected candidate.
13. No unknown entity/action/template/recipient can be introduced during template expansion.
14. The current provider candidates still meet the controlled scenario boundary.
15. The expanded plan can render a complete dry-run with exact effects and preconditions.

Retry the model once with machine-readable validation errors. A second failure stores `attention_required.validation_failure` and executes nothing.

## 9. Recovery plan contract

After validation, deterministic code expands the proposal into an immutable plan:

```typescript
interface RecoveryPlanV1 {
  schemaVersion: "recovery-plan.v1";
  taskId: string;
  planId: string;
  version: number;
  correctedAssumption: RecoveryProposalV1["correctedAssumption"];
  decisions: RecoveryDecisionView[];
  actions: [
    CalendarRestoreAction,
    CalendarMoveAction,
    MailCorrectionAction,
    MailNotificationAction
  ];
  preservedActionIds: [string];
  executionOrder: [
    "recovery.calendar.restore_uk",
    "recovery.calendar.move_us",
    "recovery.mail.correct_uk",
    "recovery.mail.notify_us"
  ];
  preconditions: RecoveryPreconditions;
  modelMetadata: ModelMetadata;
  digest: string;
}

interface RecoveryPreconditions {
  ukCurrentMustEqualInitialAfterState: CalendarPreconditions;
  usCurrentMustEqualRecoveryPreview: CalendarPreconditions;
  originalUkMailReceiptId: string;
  exactOriginalUkRecipientSetDigest: string;
  exactUsRecipientSetDigest: string;
  allCalendarPreflightsBeforeFirstWrite: true;
}
```

The UI label `Apply` covers the US Calendar and mail actions. It is not an outcome attached to an existing action ID.

### 9.1 Reset plan contract

```typescript
interface CalendarSemanticBaseline {
  calendarId: string;
  providerEventId: string;
  start: ZonedDateTime;
  end: ZonedDateTime;
  durationMinutes: 30;
  organizerDigest: string;
  attendeeSetDigest: string;
  eventType: "default";
  recurringEventId: null;
  privateTags: DemoEventPrivateTags;
  // Deliberately no ETag/updated timestamp.
}

interface ResetTargetV1 {
  candidateId: "cal_event_acme_uk" | "cal_event_acme_us";
  semanticBaseline: CalendarSemanticBaseline;
  approvedCurrentEtag: string;
  approvedCurrentStart: ZonedDateTime;
  approvedCurrentEnd: ZonedDateTime;
  sendUpdates: "none";
}

interface ResetPlanV1 {
  schemaVersion: "reset-plan.v1";
  resetPlanId: string;
  runId: string;
  worldPrId: string;
  version: number;
  targets: [ResetTargetV1, ResetTargetV1];
  executionOrder: ["reset.calendar.uk", "reset.calendar.us"];
  sentMailRemains: true;
  digest: string;
}
```

ETags are rolling expected provider versions, not semantic-baseline fields. Every successful reset write persists its returned ETag immediately. `reset_complete` requires both targets verified at their semantic baselines and the rolling versions replaced with those returned by this reset.
Semantic validation requires `targets` to contain UK and US exactly once, requires each current state/ETag to equal the preview snapshot, and hashes every field above including `sentMailRemains`.

## 10. Allowed action templates

| Template | Inputs chosen by model | Inputs supplied deterministically | Preconditions |
|---|---|---|---|
| `calendar.apply_to_correct_entity` | Known corrected candidate ID | Provider ID, target date/time, duration, time zone, ETag, `sendUpdates=none` | Owned, timed, non-recurring, unchanged, tagged candidate |
| `mail.notify_correct_attendees` | Known corrected candidate ID | Exact allowlisted attendee snapshot, subject/body template, run ID | Calendar action succeeded; recipients equal approved list |
| UK restore (derived) | None | Initial before-state and after-ETag | Current event equals Rewind after-state |
| UK correction (derived) | None | Exact original recipient snapshot and deterministic correction template | Restore succeeded; recipients equal approved list |

The registry is a closed discriminated union. Unknown templates are rejected before plan rendering.

## 11. Prevention rule contract

```typescript
interface PreventionRuleV1 {
  schemaVersion: "prevention-rule.v1";
  ruleId: string;
  version: 1;
  type: "calendar_company_region_ambiguity";
  company: "Acme";
  minimumMatches: 2;
  disambiguationField: "region";
  protectedActions: ["calendar.move", "mail.notify"];
  requiredAction: "ask_for_confirmation";
  scope: "demo_workspace";
  sourceTaskId: string;
  status: "proposed" | "active" | "removed";
  displayText: string;
  rationale: string;
  digest: string;
}
```

The model proposes this one closed rule shape as the fourth reasoning task. Validation requires every executable field above exactly, binds `sourceTaskId`, and rejects extra/unknown predicates or actions; deterministic code then hashes and stores the proposal. `displayText` and `rationale` are non-executable and length-limited. These protected-action identifiers intentionally match the canonical planned-action `type` values.

## 12. Model metadata

```typescript
interface ModelMetadata {
  provider: "openai";
  model: string;
  promptVersion: string;
  schemaVersion: string;
  reasoningEffort: string;
  responseId?: string;
  source: "model" | "fallback";
}

interface FixtureModelMetadata {
  provider: "fixture";
  model: string;
  promptVersion: string;
  schemaVersion: string;
  reasoningEffort: "none";
  responseId?: string;
  source: "fixture";
}
```

`OPENAI_MODEL` supplies the model. The provider/model risk phase initially tests `gpt-5.6-sol` if the project can access it and strict-schema evaluation passes. Store the actual returned model metadata. `FixtureModelMetadata` is permitted only for the explicitly labeled deterministic test/development slice and is forbidden in deployed live mode. A fallback source must be visibly logged and is forbidden during the recorded demo unless explicitly disclosed.

## 13. Plan hashing and idempotency

- Canonicalize the complete versioned plan payload using one tested serializer.
- Exclude the `digest` field itself and volatile view-only fields.
- Hash with SHA-256 and render with a `sha256:` prefix.
- Atomically insert an idempotency record keyed by `(actorId, endpoint, key)` with body hash and `status: in_progress` before any saga work; store the first resource/request ID in that transaction.
- On completion, set `status: completed` and store the canonical response. A safe pre-effect terminal failure may store `failed` plus its canonical error.
- A concurrent identical request reads the existing resource's current durable state and returns it with `replayPending: true`; it does not wait by holding a database transaction and does not enter the saga.
- Reusing a key with a different request returns `409 idempotency_conflict`.
- Reusing a completed key with the identical request returns the stored result and dispatches no action. The dashboard creates one key per logical submission and reuses it for double-click/network retries; MCP reuses one key for the full tool invocation.
- Reusing a safely failed key with the identical request returns the stored redacted error and dispatches no work. A deliberate resubmission after correcting input/configuration uses a new key.
- Provider operation keys are stable per `(planId, actionKey)` and never recycled across plan versions.

## 14. Compatibility and versioning

- All plan/model/rule schemas carry explicit versions.
- An incompatible schema is rejected, not coerced.
- Additive display fields may be optional; safety-sensitive fields are required.
- A contract change updates Zod, this file, fixtures, migrations if applicable, and contract tests in the same change.
- Historical immutable plans remain readable through their original schema decoder until the demo retention window expires.
