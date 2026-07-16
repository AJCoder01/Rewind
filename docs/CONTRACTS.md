# Rewind MVP contracts

| Field | Value |
|---|---|
| Status | Implemented v1 boundary contract; Zod schemas and contract tests are canonical for exact fields |
| API version | `v1` |
| Scope | Controlled Acme Calendar + Gmail scenario |
| Last updated | 2026-07-16 |

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

`GET /api/ready` is a dependency-readiness check. It opens the restricted runtime PostgreSQL connection and requires TLS, the expected database and runtime identity, the exact recorded `0001_phase0_foundation` and `0002_oauth_transaction` checksums, and the complete expected foundation/OAuth table and constraint catalogs. It returns HTTP `200` only when those checks pass.

```json
{
  "status": "ready",
  "service": "rewind",
  "schemaVersion": "0002_oauth_transaction",
  "requestId": "req_..."
}
```

Readiness failure returns the canonical error envelope with HTTP `503`, `code: "provider_unavailable"`, `retryable: true`, and the generic message `Rewind is not ready.` Neither endpoint exposes connection strings, roles, provider diagnostics, SQL, or stack traces. Both endpoints set `Cache-Control: no-store`.

`GET /api/v1/connection/status` is an authenticated dashboard-only, read-only projection of connection prerequisites. It accepts neither MCP bearer authentication nor a browser mutation. It may inspect validated private configuration, restricted database readiness, and the stored OAuth credential metadata; it never refreshes a token, calls Calendar/Gmail/model providers, changes state, or runs the human-gated Calendar preflight. The exact response is the strict `connection-preflight.v1` contract in `lib/contracts/connection-preflight.ts`:

```json
{
  "contractVersion": "connection-preflight.v1",
  "overall": "attention | blocked",
  "runtime": {
    "mode": "fixture | live_capable | blocked",
    "modelRuntime": "openai_responses | local_ollama | not_configured",
    "productExecution": "disabled",
    "productReset": "disabled"
  },
  "configuration": { "status": "complete | incomplete", "issues": [{ "field": "...", "code": "..." }] },
  "identity": { "status": "connected | not_connected | mismatch | unavailable", "email": "..." },
  "database": { "status": "fixture | ready | not_ready | unavailable", "schemaVersion": "..." },
  "calendar": { "status": "configured | not_configured | unavailable" },
  "demoDate": { "status": "configured | not_configured" },
  "preflight": {
    "status": "blocked | not_run",
    "checks": [{ "id": "configuration | database | google_identity | calendar", "status": "passed | failed | not_run", "detail": "..." }]
  },
  "workflow": { "status": "disabled", "message": "..." },
  "requestId": "req_..."
}
```

Configuration issues contain only safe field names and validation codes. A connected email is returned only when the stored Google subject and normalized email match the configured account; mismatches never return the stored email. Fixture mode, pending preflight, and disabled execution/reset are always visible and cannot be represented as a passed product workflow. Unauthorized requests return the standard `401` error envelope; unexpected status failures return a sanitized `503` and `Cache-Control: no-store`.

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

`candidate-resolution.v1` is the server-owned candidate lookup boundary used before that lock claim. It contains exactly the two tagged Acme snapshots, fixed candidate IDs derived from the validated region, provider event IDs/ETags/start/end/attendee digests, deterministic ranking evidence, the UK selection, the US alternative, a provider-snapshot digest, and a resolution version. The resolver rejects duplicate/missing/wrong-date/unowned/recurring/malformed candidates and provider failures without creating a plan. A rule match returns the snapshotted choices with no lock; only a no-match result may proceed to the planning lease. Refreshes use a higher resolution/plan version and never mutate an approved snapshot; a changed provider digest is stale and must be superseded.

`initial-reasoning-record.v1` records the one bounded initial model proposal against the candidate-resolution digest. Its model input contains the request, two server-written ranking evidence strings, the two fixed candidate IDs, and the three fixed initial action keys. The model may return only the one Acme-region assumption, the fixed dependency map, and a parent-account brief reference. The shared validator owns the two-attempt ceiling, rejects unknown IDs/actions, selection drift, dependency drift, and artifact leakage, and records only validated output, metadata, and attempt count. Provider event IDs, ETags, recipients, exact message content, times, and action payloads are not model-controlled fields.

`initial-plan-expansion.v1` is deterministic and server-owned. It binds the reasoning record to the candidate-resolution digest, generates the canonical parent-account brief during planning, expands only the selected UK event and configured UK allowlist recipient, converts the fixed 15:00 America/New_York target with DST-safe conversion, validates the registered Gmail template/body hash, and emits the fixed artifact → Calendar → Gmail action tuple. `InitialPlanPayloadSchema` rejects action-order/effect-label drift; `VerifiedInitialPlanPayloadSchema` rejects full-payload, artifact-byte, or mail-body hash drift. The resulting digest covers every field that approval will later name.

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
  candidateEvidence: [{ candidateId: string; label: string; region: "UK" | "US"; start: ZonedDateTime; end: ZonedDateTime; rankingEvidence: string[] }, { ... }];
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
  "planVersion": 1,
  "planDigest": "sha256:..."
}
```

The approval mutation is dashboard-only and runs its durable approval write and action-ledger preparation synchronously. MCP may create and read safe status, but may never approve or replan. The endpoint records the exact actor/time/plan-version/digest, materializes exactly three immutable `planned` action rows before any dispatch, and calls no provider. S053–S055 extend this same approved-plan boundary with exact artifact, Calendar, and Gmail execution. It does not return `202` and continue an unobserved background task.

Success `200` at S052:

```json
{
  "worldPrId": "wpr_01...",
  "status": "preview_ready",
  "activePlan": { "planId": "plan_01...", "kind": "initial", "version": 1, "digest": "sha256:..." },
  "requestId": "req_01..."
}
```

The handler verifies session, CSRF, task state, the exact current plan ID/version/digest, and absence of an existing different approval. An identical approval replays without a second approval or timeline entry; another actor or any changed pointer/content fails closed. The approved plan cannot be cancelled or replanned, and the scenario lock is not released. Provider/recipient/template/version drift is rejected by the execution preflight before any action row claim or provider dispatch.

If provider state differs before any action row starts, return `409 plan_stale`, mark the plan superseded, execute nothing, and direct the user to section 3.11.1. Never mutate an approved plan in place.

### 3.5.1 Supersede an unapproved initial preview

`POST /api/v1/world-prs/:worldPrId/plans/initial/refresh`

The request body is the same strict `{ planId, planVersion, planDigest }` pointer. It is dashboard-only, requires `Idempotency-Key`, and is allowed only for the current `preview_ready` plan before approval or durable action state. The S051 fixture-safe boundary persists a server-owned successor with a new plan ID, version, digest, and pointer while retaining the old payload unchanged; a later provider-backed implementation must supply a freshly resolved successor before claiming provider drift is repaired. The HTTP caller cannot supply provider IDs, recipients, content, dependencies, or action payloads. A stale pointer, approved plan, or existing action row returns `409` and no plan is mutated.

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

Allowed only when no initial action has started. S051 establishes the authenticated, fixture-safe supersession boundary and rejects caller-supplied replacement effects; the provider-backed path must refetch candidates/provider versions, rerun initial planning and artifact validation, store `version + 1`, mark the old plan superseded, and return `preview_ready` with a new `PlanPointer`. Any old approval is invalid. If an action row/approval has begun execution, return `409 invalid_task_state`.

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

### 3.16 Google OAuth transaction boundary

`GET /api/v1/oauth/google/start` requires the authenticated dashboard session. It creates a short-lived, single-use transaction bound to a non-reversible hash of that browser's signed session cookie, then returns a `307` redirect to Google's authorization endpoint. The redirect contains only the fixed scopes `openid`, `email`, `calendar.events.owned`, and `gmail.send`, plus high-entropy `state`, OIDC `nonce`, and PKCE `code_challenge`/`S256` parameters. The callback URI is exactly `/api/v1/oauth/google/callback` on the configured public origin; trailing slashes, query strings, alternate hosts, and alternate paths are rejected.

`GET /api/v1/oauth/google/callback` accepts a bounded query containing `state` and exactly one of `code` or a provider `error`, plus Google's bounded informational response metadata (`iss`, `scope`, numeric `authuser`, optional hosted-domain `hd`, and `prompt`). Duplicate parameters, excessive parameter counts, oversized names/values, and malformed required fields are rejected. In accordance with OAuth 2.0, unrecognized bounded response parameters are ignored and projected out rather than becoming application input. A returned front-channel `scope` is validated against the exact approved set before token exchange. The transaction is atomically consumed only when the state hash, browser-session binding, expiry, and configured client/redirect values match. The stored PKCE verifier is encrypted at rest and never returned to the browser. After consumption, S032 exchanges the code with the exact redirect URI and PKCE verifier, requires a bearer response containing an ID token and refresh token, verifies the RS256 signature using the Google JWKS `kid`, and validates the accepted issuer, configured audience/`azp`, expiry, issued-at, nonce, `email_verified`, configured stable subject, and configured email. It accepts the four approved scopes plus Google's redundant `userinfo.email` spelling as the same canonical OIDC email permission; unrelated scopes remain rejected. It stores no credential until all checks pass. A replay, mismatch, expiry, malformed query, provider denial, token failure, signature/claim failure, account substitution, or scope drift stores no credential; failures are sanitized as `422`, `403`, or `503` according to their boundary.

Google token, ID-token-claim, JWT-header, and JWKS responses are bounded projections: all fields Rewind consumes are validated explicitly, while unrecognized provider fields are discarded as required by OAuth forward-compatibility rules. The token projection recognizes Google's optional `refresh_token_expires_in` time-limited-grant metadata without persisting or exposing it. Provider calls have bounded response sizes and timeouts. Callback failures return and log only allowlisted `failureStage`/`failureReason` diagnostics with the opaque request ID; provider descriptions, authorization codes, tokens, response bodies, and private configuration remain forbidden.

Refresh decrypts the stored refresh token only on the server, posts the fixed `refresh_token` grant to Google's token endpoint, validates the response schema and any returned scope against the same exact approved set, and encrypts a rotated refresh token before replacing the credential. Short-lived access tokens are returned only to server-side provider callers. No Gmail profile or mailbox read is used to establish or refresh identity.

The `0002_oauth_transaction` migration stores hashed transaction secrets, encrypted verifier material, and one encrypted Google refresh-token record. Raw OAuth tokens, client secrets, provider error descriptions, and browser-session cookies are never logged, returned, or sent to client bundles. `oauth_credentials` can be written only through the validated-identity persistence boundary; it requires a stable Google subject, normalized email, fixed provider, non-empty scopes, and a `v1` AES-256-GCM ciphertext envelope.

### 3.17 Explicit provider ports and deterministic fakes

`lib/contracts/provider-ports.ts` is the runtime contract for the provider-risk boundary. `CalendarPort` accepts only the controlled calendar ID/tag query, creates only the exact Acme seed shape, returns typed Acme event snapshots containing ownership/type/recurrence/tag/time/ETag/version facts, and exposes separate get and conditional start/end update operations with `sendUpdates: "none"`. `GmailPort` first exposes synchronous `prepareApprovedMessage` for schema/MIME/token work while the dispatch marker is still null, then accepts only an approved sender/recipient/subject/body/hash/run shape and returns a discriminated `sent`, `permanent_failed`, or `delivery_uncertain` receipt. `ArtifactPort` accepts the exact account-brief bytes/hash/provenance and returns a typed persistence receipt. `ModelProposalPort` has separate initial, recovery, and prevention-rule methods; its raw proposal remains `unknown` until the later versioned model schemas validate it.

`FakeCalendarPort`, `FakeGmailPort`, `FakeArtifactPort`, and `FakeModelPort` implement those interfaces only for deterministic tests and non-production fixture use. Each fake has explicit operation-specific failure injection. The fakes do not retry, read mailboxes, generate artifact content, or turn model output into executable provider fields. No generic `RewindableAction`, compensation, or provider orchestration interface is introduced.

### 3.18 Gmail delivery and dispatch state boundary

`gmail-delivery.v1` binds one mail action to its opaque action/plan IDs, action key, approved-message digest, and normalized recipient digest. Registered templates are limited to the initial UK notification and the two fixed recovery mail templates. The delivery service rechecks equal approved/current plan digests, the configured Google subject, exact template rendering, the account subject, and the structured `{UK, US}` allowlist before calling the provider.

`MemoryGmailDispatchStore` proves deterministic behavior; `PostgresGmailDispatchStore` updates the existing `action_executions` row and does not add a migration. A new or known-safe retryable row is claimed with `status = in_progress` and `dispatch_started_at` in one database update before the provider handoff. A local preparation error stores `retryable_failed` with a null marker. A sent, permanent, or uncertain provider receipt is stored immediately after the single call. Replaying a terminal row returns its stored outcome and never calls Gmail. An in-progress row with a marker is treated as uncertain rather than redispatched. Provider receipt reasons are bounded to transport timeout/error, 408, 429, 5xx, malformed success, cancellation, process interruption, and persistence failure; provider bodies and message content never enter error output.

`gmail-live-proof.v1` is the S038 admin-spike contract. It reserves one fixed proof task, plan, and action ID, one `initial.mail.notify` action key, one digest-bound registered message, one recipient digest, and one replay-key digest. `PostgresGmailLiveProofRepository` creates those rows and a redacted audit event atomically. The TTY command sends only after exact recipient/run confirmation, persists the provider receipt through `PostgresGmailDispatchStore`, calls the delivery service again with the same identity, and records completion only when the second result is a replay of the same message ID and the action row has exactly one attempt. It has no HTTP/MCP entry point and cannot satisfy product approval requirements.

### 3.19 Controlled Calendar seed and preflight boundary

`calendar-demo.v1` is the setup-only contract for S035. `CalendarEventCreate` contains one configured calendar ID, the exact Acme UK or Acme US title/region, a timed start/end in `America/New_York`, exactly one allowlisted attendee, the exact private tags `{rewind_demo: "acme-renewal", region}`, and `sendUpdates: "none"`. Unknown properties, wrong duration, mismatched region/tag, duplicate recipients, all-day values, and end-before-start are rejected.

The command must discover the configured tag before any create and must refuse a non-empty tagged set, an existing persisted baseline, a missing/implicit `primary` calendar, fixture storage, production, CI, or a missing TTY. Each create has a redacted `demo.seed.started` audit record before the provider call. After the provider response, the service validates the owned, default, non-recurring, 30-minute event and persists `demo_event_state` with the immutable semantic baseline and the current rolling `expectedEtag`/`expectedUpdatedAt`. The baseline contains stable calendar/event IDs, times/time zone/duration, organizer and attendee-set digests, ownership/type, and tags; it never contains ETag or provider-updated values. A conflicting existing row cannot overwrite the baseline.

`seed:demo` and `preflight:demo` are interactive admin commands only. Their private TTY prompt repeats the exact configured Calendar ID and a unique run ID, which the operator must type in full; command results print only sanitized status/counts/fingerprints. They refresh the already stored account-bound Google credential and use that explicit calendar ID. A provider error, ambiguous create result, partial state, persistence failure, or baseline/version mismatch is an honest failure and is never hidden behind fake output or retried automatically. Automated tests use `FakeCalendarPort`; no live OAuth refresh, Calendar read, Calendar write, or external effect is implied by the command contract.

### 3.20 Calendar move/restore primitive boundary

S036 extends the protected `demo_event_state.last_receipt` contract with a typed Calendar operation record. Each `move` or `restore` record contains the operation/run ID, the complete typed `before` snapshot, the exact `desired` start/end/duration/time-zone/`sendUpdates: "none"` fields, and one of these outcomes:

- `started`: persisted before the conditional provider write;
- `succeeded`: persisted with the verified `after` snapshot and a `google_calendar` receipt containing the resulting ETag;
- `conflict`: persisted for stale local state, provider `412`, or missing target, with no automatic rebase; or
- `uncertain`: persisted for provider unavailability or failed post-write verification, with no automatic retry.

The service refetches the configured event, rechecks calendar/event identity, ownership, default type, non-recurring status, exact tag, organizer digest, attendee-set digest, time zone, and rolling ETag/`updated` version before writing. Restore is accepted only when the current event still equals the last verified move `after` state. The provider call is always an `If-Match` start/end-only update with `sendUpdates: "none"`; a successful verified response atomically replaces the rolling expected ETag/`updated` value in the state store. The immutable semantic baseline is never changed. Conflict and uncertainty are durable stopping points, not success or retry signals.

Automated proof uses `FakeCalendarPort` and verifies pre-write persistence, move/restore state transitions, duration/time-zone retention, static-field preservation, stale-state refusal, provider-conflict refusal, unavailable/uncertain handling, and no-rebase behavior. Product approval/action-ledger preparation and exact artifact execution are complete through S053; exact Calendar and Gmail execution remains S054–S055 work.

### 3.21 Controlled provider/model spike report

`provider-spike.v2` is an admin-only, redacted report contract for S043. The report records two exact Calendar preflight counts before and after the spike, one deliberate stale-provider conflict, one verified move, one verified restore, and the per-candidate partial receipt statuses. Its model evidence names `openai_responses | local_ollama`, binds that runtime to `external_openai | local_model`, and requires every operation provider to match. It records only validated operation names, schema versions, bounded attempt counts, model names, and SHA-256 receipt fingerprints; it never stores prompts, outputs, raw provider responses, credentials, Calendar IDs, recipients, event IDs, message IDs, or ETags. `local-model-spike.v1` reuses the same model evidence object for the no-effect `prove:model-local` command and requires `local_ollama`, `local_model`, and `externalEffects: false`.

`prove:provider-spikes` requires the same non-production PostgreSQL/TTY/live-flag guard as the setup commands and rejects explicit product execution/reset enablement. `REWIND_S043_MODEL_RUNTIME=local_ollama` explicitly selects the fixed-loopback, cloud-model-rejecting local path; omission preserves `openai_responses`. The confirmation phrase and target fingerprint bind the selected runtime and model. All three non-effecting model calls and validators complete before the Calendar phase can begin. The stale wrapper changes only the `If-Match` value sent for the deliberate conflict request; no retry or rebase is allowed. The command performs one reversible UK move and one restore, then requires the final two-event preflight to pass. S035's OAuth/lookup evidence and S038's allowlisted Gmail/replay evidence remain separate human checkpoints.

S045 adds the strict `g2-closure.v1` report and G3 admission boundary. The report contains only `passed | blocked`, the selected model runtime/provider/evidence class, six named risk statuses, sanitized relative evidence references, a bounded blocker-code list, and `unlocked | blocked` G3 admission. The selected zero-cost evidence is bound to `local_ollama`, provider `ollama`, evidence class `local_model`, and the verified local model name. The verifier reads only the fixed S032–S044 evidence manifest, checks exact sanitized markers, scans those files for credential/secret/connection-URL/email patterns, and never returns matched text. Missing files, missing markers, or redaction findings make the report blocked. `assertG3Admission` rejects every blocked report; no provider, database, OAuth, Calendar, Gmail, model, or product execution call occurs in this gate.

### 3.21 Mutation response and error matrix

Every success/attention response includes `requestId`; task mutations use `TaskMutationResponse` unless a richer shape is shown above. A durable attention outcome is HTTP `200` because the request was recorded and needs operator action; request/precondition conflicts use `409`; validation/clarification uses `422`; auth uses `401/403`.

The complete G1 v1 error-code-to-HTTP mapping, implemented route inventory, frozen fixture versions, migration/catalog identity, and create/read evidence are recorded in the [G1 interface packet](G1_INTERFACE_PACKET.md). Its executable manifest is authoritative for this pre-provider freeze.

| Endpoint | Success state | Principal typed errors |
|---|---|---|
| Create | `201 preview_ready` or `clarification_required`; replay `200` | `unsupported_request`, `idempotency_conflict`, `scenario_busy`, `candidate_set_invalid` |
| Initial approval | `200 preview_ready` with three planned action rows | `plan_digest_mismatch`, `plan_stale`, `invalid_task_state`, `provider_conflict` |
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
  sourceVersion: "controlled-content.v1";
  sourceDigest: string;
  excludedDimensions: ["calendar_event", "region", "attendees", "meeting_time"];
  validatorVersion: string;
}
```

The Zod implementation mirrors this discriminated union, rejects unknown properties, and separately derives an MCP-safe read view that omits provider IDs, addresses, bodies, and snapshots. The authenticated approval view intentionally shows exact controlled recipients and content.

S046 freezes the runtime persistence contract as `execution-persistence.v1`. `ExecutionPlan` stores the complete immutable payload and its `sha256:` digest; `ApprovalRecord` binds actor, timestamp, plan ID/version, and the same digest; and `ActionExecutionRecord` stores the closed action type, stable operation key, attempts, lease, Gmail dispatch marker, typed receipt, and redacted error. `MemoryExecutionPersistenceStore` and `PostgresExecutionPersistenceStore` share the same behavior: identical inserts replay, mutations fail closed, `(plan_id, action_key)` rows are created before dispatch, succeeded/uncertain/conflict/permanent rows are never claimed again, and an expired Gmail lease is durable uncertainty. An expired Calendar lease is not blindly retried and instead requires provider-state reconciliation. This extends the existing foundation tables; it does not replace or bypass them.

S052 adds `initial-execution.v1` preparation and claim coordination over the execution ledger. The approved initial payload is converted into exactly three fixed action rows with stable operation keys and redacted target references; preparation is idempotent and immutable. Claims require the authenticated approval and exact plan digest, enforce artifact → Calendar → Gmail ordering, return succeeded rows as `skipped`, report an active lease as `busy`, permit only `retryable_failed` retry, convert expired Gmail leases to `delivery_uncertain`, and stop expired Calendar leases for provider reconciliation. No provider call occurs in this boundary.

S053 adds `initial-artifact-execution.v1`. The artifact executor revalidates the approved action, records its source/content-hash before-state while the action is `in_progress`, passes the exact approved `title`, bytes, content hash, and provenance to `ArtifactPort`, verifies the typed receipt hash, and records the after-state before reporting success. It never regenerates the brief. Unavailable storage is `retryable_failed`, provider validation rejection is `permanently_failed`, and an ambiguous or mismatched receipt is `conflict`; succeeded replay is `skipped` without a second artifact write. `PostgresArtifactPort` persists the task-scoped immutable `account_brief` row with `ON CONFLICT DO NOTHING` and verifies identical content/provenance on replay.

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

The model-only proposal omits server-generated identity, lifecycle status, and digest fields:

```typescript
interface PreventionRuleProposalV1 {
  schemaVersion: "prevention-rule-proposal.v1";
  type: "calendar_company_region_ambiguity";
  company: "Acme";
  minimumMatches: 2;
  disambiguationField: "region";
  protectedActions: ["calendar.move", "mail.notify"];
  requiredAction: "ask_for_confirmation";
  scope: "demo_workspace";
  sourceTaskId: string; // exactly the supplied completed source task
  displayText: string;
  rationale: string;
}
```

Deterministic code validates this proposal, supplies `ruleId`, `version`, `status`, and `digest`, and never accepts a free-form predicate or action.

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

### S040 Responses client request/result boundary

```typescript
interface OpenAIResponsesRequestV1 {
  model: string;
  input: string | Array<{ role: "developer" | "system" | "user"; content: string }>;
  schemaName: string;
  jsonSchema: object; // root object, required keys, additionalProperties: false
  promptVersion: string;
  schemaVersion: string;
  reasoningEffort?: string;
  maxOutputTokens: number;
}

interface OpenAIResponsesMetadataV1 {
  provider: "openai";
  model: string;
  promptVersion: string;
  schemaVersion: string;
  reasoningEffort: string;
  responseId: string;
  attempts: number;
  usage?: { inputTokens?: number; outputTokens?: number; totalTokens?: number };
}
```

The client sends `store: false` and `text.format: { type: "json_schema", strict: true, ... }`. It returns parsed JSON only after finding an output-text item, and maps refusal, incomplete/truncated, malformed, and provider failures to a safe typed error. It retries once at most; no operation-specific model proposal is accepted until an S041 schema parses it and S042 semantic validation accepts it.

### S041 model-only output schemas

`createInitialReasoningSchemaContract`, `createRecoveryProposalSchemaContract`, and `createPreventionRuleProposalSchemaContract` each return a strict runtime Zod schema and the corresponding strict JSON Schema for the selected real model transport. Dynamic candidate, executed-action, and source-task IDs are enums populated only from the validated operation input. Action keys, recovery outcomes, new-action templates, assumption IDs, rule type, and rule action are closed literals. These proposal schemas contain no provider event/calendar IDs, recipients, mail bodies, headers, times, ETags, or raw provider arguments.

S042 adds the semantic validator immediately after these schemas. It requires deterministic initial selection/dependencies and independent brief content; a recovery proposal must name an explicit trusted corrected candidate, cover every supplied succeeded action exactly once, map Calendar/mail/artifact dependencies to `restore`/`correct`/`preserve`, and contain each fixed new-action template exactly once for the corrected candidate; the typed rule proposal must remain bound to its source task. Recovery recipient expansion accepts only server-supplied exact allowlist values. The optional model-port retry context contains only the second-attempt marker, a safe failure kind, and machine-readable issue codes/paths. `requestValidatedInitialProposal`, `requestValidatedRecoveryProposal`, and `requestValidatedPreventionRuleProposal` own the complete maximum of two provider calls: schema/semantic/refusal/truncation/invalid-output/transient failures may receive one safe retry, while invalid request, unauthorized, forbidden, not-found, and fallback failures stop after the first call. Safe transport kinds never include provider body text. They never generate a deterministic success result. The S042 harness uses synthetic inputs only; the full 25-paraphrase recovery evaluation remains S070/S091.

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

interface OllamaModelMetadata {
  provider: "ollama";
  model: string;
  promptVersion: string;
  schemaVersion: string;
  reasoningEffort: "none";
  responseId?: string;
  source: "model";
}
```

`OPENAI_MODEL` supplies the optional OpenAI model. Explicit local S043 mode uses `REWIND_LOCAL_MODEL`, defaulting to `qwen2.5-coder:latest`, through the fixed loopback Ollama endpoint. Store the actual returned model metadata and label local evidence `local_model`; it is a real local inference, not external OpenAI evidence. `FixtureModelMetadata` remains limited to deterministic tests and the visibly non-effecting deployed G1 contract proof. It cannot authorize or support an external effect. A fallback source remains forbidden during the recorded demo.

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
