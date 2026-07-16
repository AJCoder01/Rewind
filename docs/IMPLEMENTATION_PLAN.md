# Rewind master implementation plan

| Field | Value |
|---|---|
| Status | Active canonical execution queue |
| Execution model | One sequential task at a time |
| Current gate | G2 — OAuth, provider, and model risk retirement |
| Current restart point | `S046` — finalize execution persistence after the G2 closure gate |
| Last updated | 2026-07-16 |

This is the single implementation plan for Rewind. It owns task order and phase gates. It does not divide work by person. Product behavior remains canonical in `PRD.md`, non-negotiable safety rules in `SAFETY.md`, runtime design in `ARCHITECTURE.md`, boundary shapes in `CONTRACTS.md`, and verification details in `TEST_PLAN.md`.

## 1. How to execute this plan

- Work from the lowest-numbered unfinished task. Do not start a later gate while the current gate is red.
- Keep only one implementation task active. A task may contain code, tests, documentation, and evidence that must land together.
- Use a short branch for the active task. Merge contracts/migrations before code that produces or consumes them.
- A task is complete only when its acceptance checks pass and sanitized evidence is linked from `PROGRESS.md`.
- Update Zod schemas, migrations, contract tests, and canonical documentation together whenever a boundary changes.
- Use deterministic adapters in automated tests. Never present fixture or mock output as live-provider evidence.
- Only a human may run TTY-gated Google Calendar, Gmail, provider-spike, reset, or other live external-effect commands.
- Any auth, approval, allowlist, digest, ETag, uncertain-delivery, or persistence ambiguity fails closed and stops the current gate.

### Status legend

- `[x]` Complete with evidence
- `[~]` Partially implemented; acceptance evidence is incomplete
- `[ ]` Not started
- `[!]` Blocked by a named external prerequisite recorded in `PROGRESS.md`

## 2. Sequential task queue

### G0 — Foundation, credentials, contracts, and evidence

- [x] **S001 — Establish the repository.** Initialize Git, configure `main → origin/main`, publish the documentation baseline, and record the remote/commit evidence.
- [x] **S002 — Resolve foundation decisions.** Select Node, deployment, PostgreSQL, dashboard auth, Google identity/OAuth audience, controlled recipient structure, demo date, evidence location, and the single sequential execution model.
- [x] **S003 — Scaffold the application.** Create one strict TypeScript/Next.js npm package, pin Node 24, define root commands, add `.env.example` names only, and keep secrets out of Git.
- [x] **S004 — Establish the minimal executable contract packet.** Add strict API-v1 lifecycle/error/create/read schemas, opaque IDs, canonical SHA-256 plan hashing, and contract/digest tests.
- [x] **S005 — Establish durable storage foundations.** Add the initial PostgreSQL migration for tasks, plans, approvals, action executions, artifacts, rules, idempotency, scenario locks, demo event versions, and audit events; add a fail-closed migration runner.
- [x] **S006 — Prove the local fixture slice.** Implement signed dashboard sessions, same-origin mutation checks, scoped MCP authentication, `create_world_pr`, create/read routes, a complete fixture-backed plan, a review page, unit tests, production build, and the critical fixture browser smoke.
- [x] **S007 — Provision Supabase PostgreSQL.** Follow [the manual S007 guide](S007_SUPABASE_GUIDE.md): create the selected Mumbai (`ap-south-1`) project, enable account MFA and PostgreSQL SSL enforcement, disable the unused Data API, create a non-admin `rewind_app` runtime role, store its transaction-pool URL and a separate `postgres` direct/session migration URL outside Git, and record only redacted evidence. Evidence: [sanitized S007 report](../artifacts/test-runs/2026-07-15-s007-supabase.md).
- [x] **S008 — Apply and verify the real migration.** Run `npm run db:migrate`, prove repeatability, inspect every table/check/foreign-key/unique constraint, test `(plan_id, action_key)` and idempotency uniqueness, verify runtime grants/API-role exclusion/TLS connection behavior, and add a database readiness check. Evidence: [sanitized S008 report](../artifacts/test-runs/2026-07-15-s008-migration.md).
- [x] **S009 — Provision and verify Vercel.** Follow [the manual S009 guide](S009_VERCEL_GUIDE.md): connect the GitHub repository, use Node 24 and Fluid Compute in Mumbai (`bom1`), configure the minimum private Production environment, deploy over TLS, and prove health/readiness, secure cookies, and the frozen base URL. Evidence: [sanitized S009 report](../artifacts/test-runs/2026-07-15-s009-vercel.md). The deployed create/review saga remains deferred to S023/S028 while the PostgreSQL store is fixture-backed.
- [x] **S010 — Prepare Google Cloud access without live effects.** Follow the [manual S010 guide](S010_GOOGLE_GUIDE.md): create the project, enable Calendar/Gmail APIs, configure External/Testing audience and the exact test identity, register exact local/deployed redirects, request only OIDC + `calendar.events.owned` + `gmail.send`, and store no credential in Git. Evidence: [sanitized S010 report](../artifacts/test-runs/2026-07-15-s010-google.md). No live OAuth grant or provider effect was performed in S010.
- [x] **S011 — Prepare OpenAI project access.** Create/confirm the API project, keep the key in local/deployment secrets, verify the configured model is available, and defer product model calls until G2 strict-schema tests exist. Evidence: [sanitized S011 report](../artifacts/test-runs/2026-07-15-s011-openai.md).
- [x] **S012 — Finalize the private environment contract.** Follow the [manual S012 guide](S012_PRIVATE_ENVIRONMENT_GUIDE.md): generate strong secrets, configure the private Google/OpenAI/database fields and structured allowlist, run sanitized startup validation, and never log literal values. Evidence: [sanitized S012 report](../artifacts/test-runs/2026-07-15-s012-environment.md).
- [x] **S013 — Add fast CI and repository security checks.** Run install, lint, typecheck, unit/contract tests, production build, dependency audit, reachable-history secret scan, migration validation against ephemeral PostgreSQL, and fake-in-production checks on every change. Evidence: [sanitized S013 report](../artifacts/test-runs/2026-07-15-s013-ci-security.md); hosted verification is recorded in the [S018 G0 report](../artifacts/test-runs/2026-07-15-s018-g0.md).
- [x] **S014 — Freeze the controlled content and UI inventory.** Finalize the synthetic parent-account note fixture, demo copy, required UI states, component boundaries, viewport, reduced-motion behavior, and sanitized evidence format. Evidence: [sanitized S014 report](../artifacts/test-runs/2026-07-15-s014-content-ui.md) and [controlled content/UI inventory](CONTROLLED_CONTENT_UI_INVENTORY.md).
- [x] **S015 — Build executable requirement traceability.** Map FR-01–32, SAFE-01–10, and NFR-01–10 to code paths, tests, fixture IDs, and evidence under `tests/fixtures/traceability/**`. Evidence: [sanitized S015 report](../artifacts/test-runs/2026-07-15-s015-traceability.md), [traceability catalog guide](TRACEABILITY.md), and `npm run traceability:check`.
- [x] **S016 — Create the complete golden contract fixture set.** Add strict success/error/read-model fixtures for analyzing, clarification, preview, executing, completed, correction, recovery, attention, recovered, rule, reset, cancelled, and failed states. Evidence: [sanitized S016 report](../artifacts/test-runs/2026-07-15-s016-golden-contracts.md) and [golden fixture guide](GOLDEN_CONTRACT_FIXTURES.md).
- [x] **S017 — Validate the scaffold for accessibility and testability.** Confirm semantic structure, keyboard reachability, focus order, non-color state labels, reduced-motion baseline, stable test selectors, and honest fixture labeling. Evidence: [sanitized S017 report](../artifacts/test-runs/2026-07-15-s017-accessibility.md), [accessibility/testability guide](ACCESSIBILITY_TESTABILITY.md), and the fixture E2E smoke.
- [x] **S018 — Close G0 on a clean checkout.** Install with Node 24, apply migrations, build, lint, typecheck, run fast tests and secret scanning, verify no secret/client leak, update all command truth, and store sanitized G0 evidence. Evidence: [sanitized S018 G0 report](../artifacts/test-runs/2026-07-15-s018-g0.md).

#### Gate G0 acceptance

- [x] Supabase and Vercel are provisioned and the real migration/readiness checks pass.
- [x] Google/OpenAI access prerequisites exist without enabling unapproved product effects.
- [x] Contracts, migrations, golden fixtures, and traceability are frozen in dependency order.
- [x] Clean-checkout build/lint/typecheck/test/security checks pass with no committed secret.

### G1 — Non-effecting MCP → API → PostgreSQL → dashboard slice

- [x] **S019 — Complete lifecycle and error contracts.** Implement every G1 task/error state as strict Zod schemas and reject extra/unknown fields at every boundary. Evidence: [S019–S027 G1 report](../artifacts/test-runs/2026-07-15-s019-s027-g1.md).
- [x] **S020 — Complete PostgreSQL repositories.** Persist and read tasks, plans, read models, idempotency records, locks, and audit events transactionally; parse all stored JSON back through canonical schemas. Evidence: [S019–S027 G1 report](../artifacts/test-runs/2026-07-15-s019-s027-g1.md).
- [x] **S021 — Complete intake serialization.** Evaluate the fixture rule before lock acquisition, support clarification without plan/action/lock, implement planning leases, return `scenario_busy` correctly, and handle identical/conflicting/in-progress/failed idempotency replay without a second saga. Evidence: [S019–S027 G1 report](../artifacts/test-runs/2026-07-15-s019-s027-g1.md).
- [x] **S022 — Complete trust boundaries.** Enforce dashboard session expiry, CSRF/origin checks, resource scope, MCP bearer scope, redacted errors, and production refusal when required auth configuration is missing. Evidence: [S019–S027 G1 report](../artifacts/test-runs/2026-07-15-s019-s027-g1.md).
- [x] **S023 — Complete deterministic fixture isolation.** Keep fake Calendar/Gmail/model adapters limited to test/development; supply exactly two candidates and one complete contract-valid plan through the explicitly non-effecting repository slice; reject unsupported tasks and make deployed live startup fail if a fake provider/model adapter is selected. Evidence: [S019–S027 G1 report](../artifacts/test-runs/2026-07-15-s019-s027-g1.md).
- [x] **S024 — Complete thin application routes.** Keep handlers to authenticate, validate, call one service, and map results for create/read/cancel/status without duplicating domain rules. Evidence: [S019–S027 G1 report](../artifacts/test-runs/2026-07-15-s019-s027-g1.md).
- [x] **S025 — Complete the MCP entry point.** Expose only `create_world_pr` and optional status, return a non-secret review URL, and prohibit approval, recovery, rule activation, reset, or provider credentials. Evidence: [S019–S027 G1 report](../artifacts/test-runs/2026-07-15-s019-s027-g1.md).
- [x] **S026 — Complete the non-effecting product UI.** Build composer, loading, empty, review, assumption/evidence, exact actions, dependency labels, timeline shell, safe errors, cancel/back, expired-session, and fake-mode labels using strict client parsing. Evidence: [S019–S027 G1 report](../artifacts/test-runs/2026-07-15-s019-s027-g1.md).
- [x] **S027 — Complete G1 automated tests.** Cover identical/conflicting/concurrent/failed replay, rule clarification without lock, scenario busy, unsupported request, unauthorized create/read, expired session, CSRF, malformed read models, duplicate click, refresh, keyboard flow, and reduced motion. Evidence: [S019–S027 G1 report](../artifacts/test-runs/2026-07-15-s019-s027-g1.md).
- [x] **S028 — Prove the deployed non-effecting slice.** Run MCP → authenticated API → Supabase → authenticated dashboard on the deployed environment using the real PostgreSQL repository, with Calendar/Gmail/model providers visibly disabled from live claims. Evidence: [sanitized deployed proof](../artifacts/test-runs/2026-07-16-s028-deployed.md).
- [x] **S029 — Freeze the G1 interface packet.** Freeze schemas, migrations, golden HTTP/read-model fixtures, error matrix, fixture versions, and the create/read browser evidence before provider work. Evidence: [S029 interface freeze report](../artifacts/test-runs/2026-07-16-s029-interface-freeze.md) and [G1 interface packet](G1_INTERFACE_PACKET.md).
- [x] **S030 — Close G1.** Record all G1 command outputs, deployed screenshots, replay/auth results, fake-mode proof, known risks, and requirement links. Evidence: [S030 G1 closure report](../artifacts/test-runs/2026-07-16-s030-g1-close.md).

#### Gate G1 acceptance

- [x] Identical create returns the same resource; conflicting reuse fails; concurrent create never starts a second saga. Evidence: S019–S027 tests and S030 closure audit.
- [x] Clarification can exist without a plan/action/lock; effect-bearing competition returns `scenario_busy`. Evidence: S019–S027 tests and S030 closure audit.
- [x] Authenticated MCP and dashboard share one service and durable PostgreSQL state. Evidence: S028 deployed proof and S030 closure audit.
- [x] Mandatory browser E2E passes with a complete plan and no live provider/model call. Evidence: S029 verification and S030 closure audit.

### G2 — OAuth, provider, and model risk retirement

- [x] **S031 — Implement the OAuth transaction flow.** Added state, OIDC nonce, PKCE S256, exact redirect validation, short-lived session-bound transaction storage, atomic one-use consumption, encrypted verifier/refresh-token persistence primitives, authenticated start/callback routes, and the reviewed `0002_oauth_transaction` migration. Evidence: [S031 OAuth transaction report](../artifacts/test-runs/2026-07-16-s031-oauth-transaction.md). The callback remains fail-closed until S032 validates signed OIDC claims; no live provider effect was run.
- [x] **S032 — Enforce connected identity claims.** Added strict Google/OIDC claim and JWT-header schemas, local RS256 verification against Google's published JWKS, issuer/audience/azp/time/nonce/email-verification checks, configured subject/email binding, exact approved-scope enforcement, encrypted refresh-token persistence/rotation, and safe token/provider failures without Gmail mailbox/profile reads. Evidence: [S032 Google identity report](../artifacts/test-runs/2026-07-16-s032-google-identity.md). No live consent, token exchange, mailbox/profile read, Calendar call, Gmail call, or external effect was run.
- [x] **S033 — Add OAuth negative tests.** Added deterministic callback and boundary regressions for replay, missing/mismatched state/nonce/PKCE, redirect drift, wrong audience/issuer/subject/account, expired tokens, unverified email, malformed ID tokens, provider failure, and no-credential outcomes. Evidence: [S033 OAuth negative-test report](../artifacts/test-runs/2026-07-16-s033-oauth-negative.md). No live provider call or external effect was run.
- [x] **S034 — Define explicit provider ports and deterministic fakes.** Added strict scenario-specific Calendar, Gmail, artifact, and model port contracts, deterministic fake implementations, explicit failure injection, typed Gmail sent/permanent/uncertain outcomes, conditional Calendar version updates, exact artifact persistence, and raw-untrusted model proposal results. Evidence: [S034 provider-port report](../artifacts/test-runs/2026-07-16-s034-provider-ports.md). No live provider call or external effect was run; no generic compensation framework was added.
- [x] **S035 — Implement controlled Calendar discovery and seeding.** Safe code, strict contracts, deterministic tests, persistence, redacted command output, and TTY/CI/production/unknown-target guards are implemented and verified. The deployed OAuth connection and human TTY-gated controlled Calendar preflight prove exactly two candidates, two persisted baselines, and two rolling provider versions. Evidence: [S035 Calendar setup report](../artifacts/test-runs/2026-07-16-s035-calendar-setup.md) and [S035 live closure](../artifacts/test-runs/2026-07-16-s035-live-closure.md).
- [x] **S036 — Implement and prove Calendar primitives.** Added typed before/desired/after/receipt persistence in the protected demo state boundary; persisted `started` before writes; verified `If-Match`, `sendUpdates=none`, start/end-only writes, duration/time-zone retention, rolling ETags, restore, attendee/owner/type checks, and deliberate stale/provider conflict and uncertainty handling. Evidence: [S036 Calendar primitives report](../artifacts/test-runs/2026-07-16-s036-calendar-primitives.md).
- [x] **S037 — Implement Gmail at-most-once delivery.** Added the strict registered-template and structured allowlist gate, deterministic MIME/Google `users.messages.send` wire port, PostgreSQL bridge over the foundation action row, marker-before-handoff claim, local retryable preparation outcome, permanent 4xx classification, complete uncertain-delivery matrix, redacted receipts, and replay/no-redispatch tests. Evidence: [S037 Gmail at-most-once report](../artifacts/test-runs/2026-07-16-s037-gmail-at-most-once.md). No live Gmail send was run; S046 will connect the bridge to the complete action ledger and S038 is the human-gated success/replay proof.
- [x] **S038 — Prove one controlled Gmail success.** The strict `gmail-live-proof.v1` plan/action contract, non-production/CI/TTY/live-flag and exact-recipient guards, fixed durable proof ledger, one-send/replay command, redacted output, and deterministic tests are implemented. Human evidence recorded: run `run_s038_jvZVdxeNdGbCzRv8-60LRg` returned `firstStatus: sent`, `replayStatus: sent`, `replayVerified: true`, and `attempts: 1`; the operator confirmed exactly one inbox message arrived. Evidence: [S038 Gmail live-proof report](../artifacts/test-runs/2026-07-16-s038-gmail-live-proof.md).
- [x] **S039 — Implement the artifact boundary.** Added the planning-only versioned parent-account source boundary, exact source/content/version hash binding, region/event/attendee/meeting-time/provider-detail leakage rejection, and approved-byte persistence without regeneration. Evidence: [S039 artifact-boundary report](../artifacts/test-runs/2026-07-16-s039-artifact-boundary.md).
- [x] **S040 — Implement the OpenAI Responses client.** Added the server-only Responses boundary with configured-model requests, `store: false`, strict Structured Outputs, refusal/truncation/malformed/provider handling, response metadata capture, one bounded retry, redacted errors, and deterministic HTTP tests. Evidence: [S040 OpenAI Responses report](../artifacts/test-runs/2026-07-16-s040-openai-responses.md). No live model call was run; S043 owns the provider spike.
- [x] **S041 — Define versioned model-only schemas.** Added strict runtime and Responses JSON Schemas for `initial-reasoning.v1`, `recovery-proposal.v1`, and `prevention-rule-proposal.v1`; each closes dynamic IDs/templates over its validated supplied universe and excludes executable provider fields. Evidence: [S041 model-schema report](../artifacts/test-runs/2026-07-16-s041-model-schemas.md). No model inference, provider mutation, or external effect was run.
- [x] **S042 — Build model safety and evaluation harnesses.** Added strict cross-field validators for initial/recovery/prevention proposals, trusted explicit-target/action-ledger context, server-owned recipient expansion, bounded two-attempt validation with no fallback, adversarial fixtures/tests, and the sanitized `eval:model-safety` command. Evidence: [S042 model-safety report](../artifacts/test-runs/2026-07-16-s042-model-safety.md). No live model inference, provider mutation, or external effect was run.
- [x] **S043 — Run the controlled provider/model spikes.** Added redacted `provider-spike.v2` and `local-model-spike.v1` reports, the TTY/live-flagged Calendar move/restore/conflict harness, strict OpenAI and loopback-only Ollama model adapters, one shared two-attempt ceiling, model-before-Calendar ordering, deterministic tests, and the [human S043 guide](S043_PROVIDER_MODEL_SPIKE_GUIDE.md). The unfunded OpenAI path failed closed and remains honestly recorded. The selected zero-spend `qwen2.5-coder:latest` Ollama path passed all three strict schema/semantic operations in one attempt each, and the human combined receipt then proved the stale Calendar conflict, controlled move/restore, and final two-event preflight. Evidence: [transport correction](../artifacts/test-runs/2026-07-16-s043-model-transport-correction.md), [rate-limit blocker](../artifacts/test-runs/2026-07-16-s043-openai-rate-limit-blocker.md), [local runtime](../artifacts/test-runs/2026-07-16-s043-local-model-runtime.md), and [combined success receipt](../artifacts/test-runs/2026-07-16-s043-provider-model-spike-success.md).
- [x] **S044 — Build honest connection/preflight UI.** Added the authenticated, read-only `connection-preflight.v1` status boundary and dashboard panel. It reports safe configuration gaps, approved connected-identity state, fixture/live-capable/blocked runtime state, database status, Calendar target/preflight failures or not-run state, selected model evidence runtime, and explicit disabled product execution/reset. It never runs a provider/model operation or claims that the product workflow passed. Evidence: [S044 connection/preflight UI report](../artifacts/test-runs/2026-07-16-s044-connection-preflight-ui.md).
- [x] **S045 — Close G2.** Added the strict `g2-closure.v1` report, fixed sanitized evidence manifest, secret-redaction scan, and `verify:g2-closure` gate. All six OAuth/account-binding, Calendar ETag, Gmail uncertainty, strict-model-output, secret-redaction, and fake-provider-production risks are green in the selected `local_ollama`/`local_model` evidence class; a red risk produces a blocker and keeps G3 admission blocked. Evidence: [S045 G2 closure report](../artifacts/test-runs/2026-07-16-s045-g2-closure.md).

#### Gate G2 acceptance

- [x] OAuth/account binding and refresh work in the deployed environment; all substitution/replay cases fail. Evidence: S032/S033 negative and refresh-boundary tests plus S035 connected-account/preflight proof.
- [x] Calendar lookup/move/restore/conflict and rolling versions are proven on controlled events. Evidence: S035/S036 and the S043 human conflict/move/restore receipt.
- [x] Gmail success and the complete ambiguous-delivery policy are proven without unsafe live ambiguity tests. Evidence: S037 deterministic uncertainty matrix and S038 one-send/replay proof.
- [x] Strict model schemas and deterministic semantic rejection are proven with the explicitly selected real model runtime and honestly labeled evidence class. Evidence: S041/S042 and S043 `local_ollama`/`local_model` proof.
- [x] Production cannot start with fake providers. Evidence: S043/S044 fake-production checks and the S045 executable closure gate.

G3 admission is now an executable invariant: `npm run verify:g2-closure` must return a passed `g2-closure.v1` report with `g3Admission: unlocked`. Any missing evidence marker or redaction finding returns a blocker and keeps G3 closed.

### G3 — Initial World PR, approval, and execution

- [x] **S046 — Finalize execution persistence.** Added the strict `execution-persistence.v1` plan/approval/action/lease/receipt/error boundary and deterministic memory/PostgreSQL ledger over the existing foundation tables. Immutable plan versions, approval binding, idempotent action-row creation, short claims, terminal outcomes, Gmail lease uncertainty, and Calendar reconciliation stops are covered by [the S046 report](../artifacts/test-runs/2026-07-16-s046-execution-persistence.md). S047 is next.
- [x] **S047 — Implement live candidate resolution.** Added the strict `candidate-resolution.v1` boundary and Calendar-backed resolver: exactly two tagged/owned/non-recurring Acme candidates are validated, UK is deterministically ranked ahead of US, the pre-lock rule result is returned before a planning lease is claimed, and refresh/version drift is represented as an explicit stale snapshot and superseding resolution. Evidence: [S047 candidate-resolution report](../artifacts/test-runs/2026-07-16-s047-candidate-resolution.md). S048 is next.
- [x] **S048 — Implement initial reasoning.** Added the strict `initial-reasoning-record.v1` service: it supplies only ranked labels/evidence and the closed candidate/action universe, validates one assumption and all dependency edges through the existing bounded model runner, captures provider metadata/attempt count, and keeps provider/recipient/time/artifact expansion deterministic. Evidence: [S048 initial-reasoning report](../artifacts/test-runs/2026-07-16-s048-initial-reasoning.md). S049 is next.
- [x] **S049 — Deterministically expand the initial plan.** Added deterministic plan expansion over the validated resolution/reasoning records: canonical brief provenance/bytes, UK-only allowlisted recipient expansion, DST-safe 15:00 ET conversion, registered Gmail template validation, strict dependencies/order/effect labels, and a full verified SHA-256 payload plus view. Evidence: [S049 initial-plan-expansion report](../artifacts/test-runs/2026-07-16-s049-initial-plan-expansion.md). S050 is next.
- [x] **S050 — Persist and render the exact World PR.** Extended the strict World PR view with server-owned candidate evidence/times and verified that the persisted plan/view carry the same actions, provenance, dependencies, effect labels, version, and digest; the review screen renders the selected and alternative evidence plus exact timing. Evidence: [S050 World PR report](../artifacts/test-runs/2026-07-16-s050-world-pr.md). S051 is next.
- [x] **S051 — Implement initial approval/cancel/replan.** Added the strict initial approval mutation contract, dashboard-only approval and immutable preview-supersession routes, exact actor/time/plan-version/digest persistence, replay-safe approval timeline repair, approved-plan cancellation refusal, and immutable successor-plan persistence. Exact plan-pointer/content drift fails closed; provider-state drift remains an execution preflight boundary for S054. Evidence: [S051 approval/cancel/replan report](../artifacts/test-runs/2026-07-16-s051-approval-cancel-replan.md). S052 is next.
- [x] **S052 — Prepare the durable action ledger.** Added `initial-execution.v1` preparation and claim coordination: approval materializes exactly three immutable planned rows before dispatch, stable operation keys are preserved, active leases are reported as busy, succeeded actions are skipped, retryable failures are the only retry path, expired Gmail leases become durable uncertainty, and expired Calendar leases stop for reconciliation. Evidence: [S052 durable action-ledger report](../artifacts/test-runs/2026-07-16-s052-action-ledger.md). S053 is next.
- [x] **S053 — Execute the exact approved artifact.** Added the exact approved-artifact executor: durable in-progress/before-state persistence precedes the artifact write, the planned bytes are passed without regeneration, typed receipts are verified and persisted, and unavailable, invalid, ambiguous, and replay outcomes remain honest. The task-scoped PostgreSQL artifact adapter is immutable and idempotent. Evidence: [S053 artifact-execution report](../artifacts/test-runs/2026-07-16-s053-artifact-execution.md). S054 is next.
- [x] **S054 — Execute the exact approved Calendar move.** Added `initial-calendar-execution.v1` and the dashboard-only action-ledger executor: it refetches and validates the exact approved target/version, controlled ownership/type/recurrence/tags/allowlist, persists a redacted before-state before the conditional start/end-only `sendUpdates=none` update, verifies the desired 30-minute move and new ETag, and records honest retryable/conflict/permanent outcomes. Evidence: [S054 Calendar-execution report](../artifacts/test-runs/2026-07-16-s054-calendar-execution.md). S055 is next.
- [ ] **S055 — Execute the exact approved Gmail notification.** Send only after reversible work succeeds, use only approved content/recipients, and persist receipt or honest permanent/uncertain outcome.
- [ ] **S056 — Build execution/timeline UX.** Show durable timestamps, receipts, in-progress, partial, conflict, retryable, permanent, uncertain, cancelled, failed, and completed states without false success.
- [ ] **S057 — Complete initial-workflow verification.** Test approval replay, duplicate click, process death/reconciliation, stale plan/ETag, allowlist drift, artifact equality/leakage, action order, resume, and all FR-01–18/SAFE proofs with deterministic adapters.
- [ ] **S058 — Run one controlled live initial flow.** Complete artifact → Calendar → Gmail with exact approval and redacted receipts, then verify no duplicate effect or fixture substitution.
- [ ] **S059 — Close G3.** Link the live proof, deterministic E2E, failure tests, plan digest, receipt trail, and requirement traceability.

#### Gate G3 acceptance

- [ ] No effect occurs before exact authenticated approval and no approval replay duplicates an action.
- [ ] Exact approved brief bytes, Calendar mutation, and Gmail content/recipients match the plan.
- [ ] Partial, stale, conflict, permanent, and uncertain outcomes remain honest and durable.
- [ ] One controlled live initial flow completes without a fake.

### G4 — Late context and Causal Revert

- [ ] **S060 — Add late-context intake.** Accept context only from fully `completed` initial execution; require an explicit known corrected target; clarify underspecified/contradictory text; support cancel-and-resubmit supersession.
- [ ] **S061 — Ground recovery in current provider state.** Fetch and validate both UK and US events before an approvable plan; reject drift, unknown target, invalid initial state, or unresolved delivery.
- [ ] **S062 — Implement the recovery proposal call.** Use the strict recovery schema over known executed-action IDs, corrected candidate IDs, allowed outcomes, and allowed new-action templates.
- [ ] **S063 — Deterministically validate recovery.** Account for every succeeded initial action exactly once; reject omissions, duplicates, unknown/incompatible outcomes, recipient injection, unsafe preserve, and unknown templates/targets.
- [ ] **S064 — Expand and persist the exact recovery plan.** Build Restore UK Calendar, Correct UK mail, Preserve the independent brief, Apply US Calendar, and Apply US mail with exact targets, times, messages, preconditions, order, version, and digest.
- [ ] **S065 — Build the Causal Revert UX.** Render the corrected assumption and fixed Restore/Correct/Preserve/Apply graph in about five seconds, with exact preview, cancel/revise flow, accessible labels, restrained animation, and reduced-motion static state.
- [ ] **S066 — Implement recovery approval.** Bind the authenticated approval to the exact immutable recovery plan; any relevant change requires a new version and approval.
- [ ] **S067 — Preflight all recovery Calendar actions.** Validate both events before the first recovery side effect; any conflict produces zero recovery mail and an honest attention state.
- [ ] **S068 — Execute recovery in the fixed order.** Restore UK Calendar start/end, move US Calendar to 15:00 ET, send UK correction, then send US notification; verify/persist after every step and leave the brief unchanged.
- [ ] **S069 — Implement recovery resume and attention behavior.** Skip succeeded work, reconcile Calendar ambiguity, never retry uncertain Gmail, retain honest partial/conflict/validation/final-failure states, and reach `recovered` only when every approved action succeeds.
- [ ] **S070 — Complete the 25-paraphrase evaluation.** Require exact safe classification/templates for at least 24/25 and target 25/25 before recording; record schema, retry, classification, and adapter-call metrics.
- [ ] **S071 — Complete the negative/safety suite.** Require 100% clarify/reject behavior and zero unsafe adapter calls for unknown/ambiguous targets, injected recipients/templates, prompt injection, unsafe preserve, drift, and partial/uncertain initial state.
- [ ] **S072 — Complete recovery E2E and failure injection.** Cover all FR-19–27, crash/lease, preflight conflict, invalid model twice, partial Calendar/mail outcomes, keyboard/reduced motion, and five-second comprehension.
- [ ] **S073 — Run one controlled live recovery.** Reach `recovered` with exact UK restore, US move, UK correction, US notification, preserved artifact, and redacted receipts.
- [ ] **S074 — Close G4.** Link evaluation, safety, deterministic E2E, live recovery, visual comprehension, and traceability evidence.

#### Gate G4 acceptance

- [ ] FR-19–27 pass with deterministic adapters and one controlled live recovery.
- [ ] Paraphrase gate is at least 24/25 and recording target is 25/25.
- [ ] Negative/safety suite is 100% with zero unsafe adapter calls.
- [ ] Recovery never falls through from conflict, partial, invalid, or uncertain state to success.

### G5 — Prevention rule, clarification proof, and approved reset

- [ ] **S075 — Generate one bounded prevention-rule proposal.** After complete recovery, produce at most one Acme-scoped `ask_for_confirmation` rule with rationale, provenance, version, and digest.
- [ ] **S076 — Persist and separately activate the rule.** Keep it inactive until a distinct authenticated confirmation; audit activation and prohibit arbitrary conditions/actions.
- [ ] **S077 — Enforce the active rule before selection/lock.** After candidate retrieval, persist `clarification_required` with recorded choices and create no plan, action, or effect-bearing lock.
- [ ] **S078 — Resolve clarification safely.** Accept only a snapshotted known candidate, acquire a free lock only when planning begins, and return `scenario_busy` without losing the clarification when another run owns the lock.
- [ ] **S079 — Build and prove the guardrail UX.** Show rule scope/rationale/status, activate separately, submit Try guardrail through normal intake, and visibly prove the no-plan/no-action/no-lock state.
- [ ] **S080 — Prepare an immutable reset plan.** Include both semantic baselines, both current expected ETags, exact fields to restore, cleanup effects, new run behavior, and the explicit warning that sent mail remains.
- [ ] **S081 — Approve reset separately.** Require authenticated digest approval plus mail-retention acknowledgement; reject reset during execution/recovery or when preconditions are stale.
- [ ] **S082 — Execute reset safely.** Preflight both events before writing, conditionally restore only start/end, update each rolling ETag after verification, archive proof, remove/deactivate rule and artifact, release the lock only after complete success, and create a new run ID.
- [ ] **S083 — Handle reset conflict/partial outcomes honestly.** Preflight drift causes zero writes; a second-write race stores the first new ETag, retains the lock, and enters `attention_required.partial_reset`; never blind-retry or claim atomic success.
- [ ] **S084 — Build reset UX and copy.** Show plan/digest, mail acknowledgement, progress, conflict, partial state, completion, and retained-mail truth; never say sent email was undone, deleted, or reset.
- [ ] **S085 — Complete rule/reset tests and live proof.** Cover precedence, activation replay, clarification locks, candidate validation, reset digest, in-progress rejection, success, zero-write conflict, second-write race, rolling ETags, archive/cleanup/lock semantics, accessibility, E2E, and one controlled live reset.
- [ ] **S086 — Close G5.** Link normal-intake clarification proof, reset receipts/baselines/ETags, retained-mail assertion, and FR-28–32/NFR-09 evidence.

#### Gate G5 acceptance

- [ ] Rule activation is separate from recovery and creates only the fixed confirmation behavior.
- [ ] Try guardrail proves persisted clarification with no plan/action/lock.
- [ ] Reset conflict writes nothing; partial reset remains attention-required with the lock retained.
- [ ] Complete reset restores both baselines, updates ETags, archives proof, cleans local demo state, releases the lock, creates a new run, and retains sent mail.

### G6 — Hardening, accessibility, and five-run release evidence

- [ ] **S087 — Complete unit and contract coverage.** Cover every allowed/forbidden state transition, success derivation, retry matrix, lock/lease behavior, strict schema, digest mutation, unknown IDs/templates/recipients, explicit target, provenance, time conversion, allowlist, and honest copy.
- [ ] **S088 — Complete integration/failure coverage.** Run transactional repository, route/auth/CSRF, model retry, provider fake, action order, persistence checkpoints, resume/reconciliation, recovery, rule, and reset matrices from `TEST_PLAN.md`.
- [ ] **S089 — Complete security/privacy verification.** Test OAuth substitution, auth/session/MCP scope, CSRF, secret storage, log redaction, client bundle, data minimization, unsupported requests, fake-in-live startup, incident handling, and zero mailbox reads.
- [ ] **S090 — Complete browser/product-quality verification.** Run the full compose → initial approval/execution → correction → recovery → rule → clarification → reset flow plus cancel/revise, replay/refresh, all error states, keyboard, focus, non-color status, reduced motion, demo viewport, and no-tab-switch main flow.
- [ ] **S091 — Finalize planner evaluation evidence.** Produce the P01–P25 report, 100% negative/safety report, retry/error metrics, deterministic expansion equality, and zero fallback/unsafe-adapter evidence.
- [ ] **S092 — Verify clean checkout and deployed limits.** Run the complete command suite, database migration, deployment/preflight, crash/lease behavior, route durations, provider receipts, startup guards, and documentation/command agreement.
- [ ] **S093 — Run five consecutive complete live flows.** For each new run ID, record preflight, plan digests, Calendar baseline/version transitions, three Gmail receipts, artifact preservation, rule proof, approved reset, final baselines/ETags, duplicate/conflict/uncertain counts, and pass/fail.
- [ ] **S094 — Fix every release-blocking issue.** Repeat the affected narrow tests and then the full gate; no database edit, restart, manual Calendar repair, hidden retry, mock substitution, uncontrolled recipient, or unresolved provider outcome may appear in a passing run.
- [ ] **S095 — Freeze the release candidate.** Freeze code, prompts, schemas, migrations, fixtures, seed data, copy, commands, and sanitized evidence; reconcile PRD/Safety/Architecture/Contracts/Test Plan/Runbook/Progress.
- [ ] **S096 — Close G6.** Require zero P0/P1 safety/acceptance issues and complete evidence for FR-01–32, SAFE-01–10, and NFR-01–10.

#### Gate G6 acceptance

- [ ] Every automated, evaluation, accessibility, security, and explicitly gated live suite passes on a clean checkout.
- [ ] Five consecutive live runs pass without manual repair, duplicate effects, hidden fallback, mocks, uncontrolled recipients, or unresolved delivery.
- [ ] Code, executable schemas, commands, runbook, and evidence agree and are frozen.

### G7 — Demo, submission, and cleanup

- [ ] **S097 — Finalize the under-three-minute runbook.** Lock narration, operator steps, error behavior, reset preparation, limitations, and the causal visualization payoff.
- [ ] **S098 — Produce sanitized submission assets.** Record the live video and primary screenshots, show real controlled receipts without addresses/secrets, and keep claims inside the recorded-lineage MVP boundary.
- [ ] **S099 — Run final go/no-go.** Re-run clean-checkout build, deployed preflight, connected identity, provider baselines, allowlist, model configuration, rule/reset state, and evidence links immediately before recording/submission.
- [ ] **S100 — Record and submit the controlled live demo.** Use no manual database edits, server restart, provider-console repair, mock substitution, or hidden retry; stop honestly on any failed safety gate.
- [ ] **S101 — Verify public materials.** Confirm no token, address, private provider ID, mail body, prompt, production data, misleading undo claim, or unsupported production-safety claim is published.
- [ ] **S102 — Revoke and clean up.** Revoke temporary OAuth grants/tokens and MCP links, remove temporary secrets/access, retain/delete controlled evidence according to the documented window, and record completion without deleting required audit proof early.
- [ ] **S103 — Close G7 and the MVP.** Archive final evidence, record limitations and cleanup status, and mark implementation complete only when every preceding gate is green.

#### Gate G7 acceptance

- [ ] The recorded flow contains real controlled receipts and no hidden fallback.
- [ ] Public assets are sanitized and all claims remain inside the controlled MVP boundary.
- [ ] Credential revocation and retention cleanup are recorded.

## 3. Required command suite

Commands become completion evidence only after they run successfully in the intended environment:

```text
npm install
npm run dev
npm run build
npm run lint
npm run typecheck
npm test
npm run test:e2e
npm run test:integration:live
npm run eval:recovery
npm run db:migrate
npm run seed:demo
npm run preflight:demo
npm run reset:demo
```

Live commands require explicit environment gating, TTY confirmation, controlled accounts, allowlists, and human operation. Ordinary CI must be unable to send Gmail or mutate Calendar.

## 4. Requirement coverage index

| Requirement group | Plan tasks that implement and prove it |
|---|---|
| FR-01–06 — intake, idempotency, scenario lock, candidates, rule precheck, ranking | `S019`–`S030`, `S035`, `S047`, `S057` |
| FR-07–11 — World PR, exact preview, cancel, approval, stale invalidation | `S048`–`S051`, `S056`–`S059` |
| FR-12–18 — action ledger, Calendar, Gmail, artifact, timeline, resume | `S046`, `S052`–`S059` |
| FR-19–27 — late context, recovery planning/approval/execution/attention | `S060`–`S074` |
| FR-28–32 — prevention rule, clarification proof, approved reset, retained mail | `S075`–`S086` |
| SAFE-01–10 — approvals, MCP/auth, account/allowlist, ETag, Gmail uncertainty, deterministic AI boundary, secret/data minimization | `S010`–`S013`, `S022`, `S031`–`S045`, `S050`–`S059`, `S063`–`S069`, `S076`–`S085`, `S089` |
| NFR-01 — five consecutive live runs | `S093`–`S096` |
| NFR-02–04 — replay, stale overwrite, unknown adapter input | `S021`, `S027`, `S036`–`S043`, `S052`–`S057`, `S063`, `S067`–`S072`, `S083`, `S088` |
| NFR-05 — 25 paraphrases plus 100% negative/safety suite | `S070`–`S072`, `S091` |
| NFR-06 — digest/actor/action/target/receipt traceability | `S046`, `S049`–`S059`, `S064`–`S069`, `S087`–`S096` |
| NFR-07–08 — five-second comprehension, accessibility, reduced motion | `S017`, `S026`, `S065`, `S072`, `S084`, `S090` |
| NFR-09 — complete reset with retained mail | `S080`–`S086`, `S093` |
| NFR-10 — no secret/address/body/production-data leakage | `S012`–`S013`, `S037`, `S089`, `S098`–`S102` |

## 5. Completion definition

- [ ] Every task `S001`–`S103` is complete with evidence or is explicitly superseded by an approved canonical decision.
- [ ] Gates G0–G7 are green in order.
- [ ] FR-01–32, SAFE-01–10, and NFR-01–10 trace to executable code, tests, and evidence.
- [ ] External effects are authenticated, exact-approved, allowlisted, conditional, durable, idempotent, and honestly reported.
- [ ] Model output remains inside strict closed schemas and deterministic semantic validation.
- [ ] The complete live flow passes five consecutive times and the final recorded run contains no fake substitution.
- [ ] Final code, schemas, migrations, commands, docs, demo assets, cleanup, and public claims agree.

Live status and evidence belong in [PROGRESS.md](PROGRESS.md); exact implemented schemas belong in [CONTRACTS.md](CONTRACTS.md); test definitions belong in [TEST_PLAN.md](TEST_PLAN.md).
