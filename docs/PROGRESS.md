# Rewind MVP progress

Current status: master-plan tasks `S001`–`S044` are complete. S035’s deployed OAuth connection and human Calendar preflight passed with exactly two candidates, two persisted baselines, and two rolling provider versions. S038’s human Gmail proof sent exactly one message and verified replay without redispatch. S039–S042 close the artifact, strict model transport/schema, and deterministic semantic boundaries. The unfunded OpenAI S043 path failed closed and remains recorded honestly. By explicit zero-spend user decision, Rewind now supports a loopback-only, cloud-model-rejecting Ollama runtime; the human combined S043 receipt records three validated strict local model operations, one deliberate Calendar conflict, one move/restore, and a passing final two-event preflight. The deployed non-effecting MCP → API → PostgreSQL → dashboard proof passed, the v1 interface packet is frozen, and G1 is closed. S044 now exposes honest connection/preflight state while keeping product execution/reset disabled; S045 is next and G2 remains open.

| Field | Value |
|---|---|
| Status | Live checklist |
| Current phase | G2 OAuth/provider/model risk retirement; S044 complete, S045 evidence closure next |
| Last updated | 2026-07-16 |
| Implementation update | S043 explicitly supports OpenAI or zero-cost local Ollama evidence; S044 adds `connection-preflight.v1` and a dashboard-only read model with explicit fixture/live-capable/blocked state, safe configuration gaps, preflight failures/not-run status, and no product execution/reset path. |

This file records status and evidence only. It does not create or change requirements.

## Status legend

- `[ ]` Not started
- `[~]` In progress
- `[x]` Complete with evidence
- `[!]` Blocked; explain the blocker and owner

## Repository baseline

- [x] Source brief read completely. Evidence: kickoff review on 2026-07-14.
- [x] Workspace inspected. Evidence: directory was empty and not a Git repository on 2026-07-14.
- [x] Product/technical loopholes pressure-tested and resolved in canonical docs. Evidence: `PRD.md` and `DECISIONS.md`.
- [x] Official current OpenAI, Google Calendar, Gmail, OAuth, Codex MCP, and AGENTS guidance checked. Evidence: external links in canonical docs.
- [x] Kickoff documentation set and dependency-gated implementation plan created.
- [x] Git repository initialized and remote configured. Evidence: `main` tracks `origin/main` at `https://github.com/AJCoder01/Rewind.git`; initial docs commit `5efe0b5`.
- [x] Application scaffold/package manifest exists. Evidence: one Next.js/TypeScript package, root scripts, strict TypeScript config, fixture mode, and Playwright config added on 2026-07-14.
- [x] Advertised fast and browser commands have run successfully. Evidence: build, lint, typecheck, unit tests, and critical Playwright flow passed on 2026-07-14.
- [x] Dashboard, MCP-to-backend HTTP, fixture store, and PostgreSQL repository paths exist. Calendar, Gmail, and OpenAI provider integrations remain disabled.

Do not infer implementation progress from completed documentation.

## MVP capability checklist

### Intake and World PR

- [x] `create_world_pr` exists as the sole required MCP tool. Evidence: `mcp/server.ts` exposes only this tool and never approves or executes.
- [x] Dashboard composer and MCP use the same authenticated backend application service. Evidence: MCP is a thin bearer-authenticated HTTP client for `POST /api/v1/world-prs`; the route invokes `lib/services/world-pr.ts`.
- [x] Identical, conflicting, in-progress, and failed idempotency replay; planning leases; rule-first clarification without a plan/action/lock; and effect-bearing scenario serialization are covered in the fixture/PostgreSQL repositories. Durable deployed proof and G1 closure are recorded in S028–S030.
- [x] Backend persists a versioned World PR and returns a non-secret review URL. Evidence: fixture create/read smoke returned 201/200 and an immutable plan digest.
- [x] Authenticated dashboard loads the World PR. Evidence: `npm run test:e2e` exercised login, creation, and review rendering in fixture mode and exited successfully.
- [x] Exactly two tagged Calendar candidates are fetched from the controlled calendar. The strict wire adapter, exact-two validator, deterministic fake proof, and human `preflight:demo` proof passed. Evidence: [S035 live closure](../artifacts/test-runs/2026-07-16-s035-live-closure.md).
- [ ] Acme UK is ranked by deterministic visible evidence; Acme US is shown as an alternative.
- [x] Fixture World PR displays the original request, one important assumption, and evidence.
- [x] Fixture World PR previews exact Calendar date/time/IANA time zone/duration.
- [x] Fixture World PR previews exact controlled Gmail recipients, subject, and body.
- [x] Fixture World PR previews exact account-brief content/hash/source provenance and the semantic validator version.
- [x] Fixture dependency edges and external-effect labels are visible.
- [x] Cancel/back controls work for unexecuted preview and clarification states; execution cancellation remains deferred with approval/execution work.

### Approval and initial execution

- [x] Fixture initial plan is immutable, versioned, canonicalized, SHA-256 hashed, persisted in full, and covered by a digest-reproduction test.
- [ ] Authenticated approval stores actor, timestamp, plan ID/version/digest.
- [ ] Provider/recipient drift invalidates approval.
- [ ] Durable unique action rows exist before dispatch.
- [ ] Account brief is generated/validated during planning and execution stores the exact approved bytes/hash without regeneration.
- [ ] UK event before-state and ETag are saved.
- [ ] UK event moves conditionally to 15:00 ET with duration retained and `sendUpdates=none`.
- [ ] UK event after-state/ETag is verified and persisted.
- [ ] Exact approved UK Gmail notification sends to the allowlist and stores a receipt.
- [ ] Timeline shows persisted receipts and honest partial/conflict/uncertain states.
- [ ] Double click/replay cannot duplicate any action.

### Causal Revert

- [ ] User can manually paste late context after initial execution.
- [ ] Explicit Acme US target is required; underspecified text asks for clarification.
- [ ] Recovery model call uses strict Structured Outputs and a versioned schema.
- [ ] Semantic validator accounts for every succeeded action exactly once.
- [ ] Unknown/duplicate/omitted/incompatible IDs/templates/recipients are rejected.
- [ ] Fixed causal visualization renders corrected assumption and four outcome groups.
- [ ] UK Calendar action is labeled Restore.
- [ ] UK Gmail action is labeled Correct, never “undone.”
- [ ] Account brief is labeled Preserve only with canonical independent provenance.
- [ ] US Calendar and mail templates are labeled Apply.
- [ ] Recovery preview shows exact targets, times, preconditions, recipients, messages, and order.
- [ ] User can approve, cancel, or revise supplied context.
- [ ] Recovery approval binds one exact immutable plan digest.

### Recovery execution

- [ ] UK and US Calendar preflights run before the first recovery side effect.
- [ ] UK event restores start/end only when it matches Rewind's after-state.
- [ ] US event moves to 15:00 ET only when it matches the approved preview ETag.
- [ ] UK correction sends only after Calendar actions succeed.
- [ ] US notification sends only after Calendar actions succeed.
- [ ] Account brief remains unchanged and visibly preserved.
- [ ] Per-action receipts and outcomes persist after every step.
- [ ] Resume skips succeeded actions and retries only known-safe work.
- [ ] Calendar conflict and Gmail delivery uncertainty stop safely.
- [ ] Task reaches `recovered` only when every approved recovery action succeeds.

### Prevent this next time

- [ ] One typed Acme ambiguity rule is proposed after complete recovery.
- [ ] Rule shows scope, trigger, action, rationale, source task, version, and digest.
- [ ] Separate authenticated confirmation activates the rule.
- [ ] Active rule runs after candidate retrieval and before entity selection.
- [ ] Try guardrail submits through normal `POST /world-prs`/MCP intake and enters a renderable persisted `clarification_required` state.
- [ ] Proof creates no plan/action and does not acquire the effect-bearing scenario lock.
- [ ] Clarification resolution accepts only a snapshotted known candidate and acquires a free lock; while the recovered demo run owns it, resolution returns `scenario_busy` without losing the clarification.

### Reset demo state

- [ ] Reset renders an immutable two-event plan and requires authenticated digest approval plus acknowledgement that sent mail remains.
- [ ] Reset rejects while execution is in progress.
- [ ] Both events preflight before the first write and conditionally return to immutable semantic baselines.
- [ ] Rolling expected ETags update after each verified write/reset; ETags are not semantic-baseline fields.
- [ ] Preflight drift produces zero-write `reset_conflict`; a later race/partial result remains attention-required with the lock retained.
- [ ] Task/action/audit evidence is archived for the retention window.
- [ ] Active artifact/rule is removed or deactivated for the next run.
- [ ] Scenario lock releases and a new run ID is created.
- [ ] Prior sent messages remain and are distinguishable by run ID.

## Implementation phase tracker

The single ordered task queue and gate criteria live in `IMPLEMENTATION_PLAN.md`. This file tracks evidence without duplicating task ownership.

| Gate | Sequential scope | Status | Evidence |
|---|---|---|---|
| G0 | `S001`–`S018`: foundation, credentials, migration, CI, contracts, fixtures, traceability | Complete | [S018 G0 report](../artifacts/test-runs/2026-07-15-s018-g0.md); hosted Node 24 CI and ephemeral migration replay passed |
| G1 | `S019`–`S030`: non-effecting MCP → API → PostgreSQL → dashboard | Complete | [S030 G1 closure report](../artifacts/test-runs/2026-07-16-s030-g1-close.md); S001–S030 complete in sequence |
| G2 | `S031`–`S045`: OAuth, Calendar/Gmail/artifact/model primitives and live spikes | In progress | S031–S044 are complete with sanitized evidence; S045 evidence closure remains |
| G3 | `S046`–`S059`: initial World PR, approval, execution, receipts | Not started | TBD |
| G4 | `S060`–`S074`: late context, Causal Revert, recovery execution/evals | Not started | TBD |
| G5 | `S075`–`S086`: prevention rule, clarification proof, approved reset | Not started | TBD |
| G6 | `S087`–`S096`: hardening, accessibility, five-run evidence, freeze | Not started | TBD |
| G7 | `S097`–`S103`: demo, submission, revocation, cleanup | Not started | TBD |

### Current phase actions

- [x] `S001`–`S006`: repository, decisions, scaffold, minimal contracts/migration, and local fixture slice.
- [x] `S007`: Supabase PostgreSQL provisioned and hardened in Mumbai; private transaction/session URLs and live TLS/role/ACL checks passed. Evidence: [sanitized S007 report](../artifacts/test-runs/2026-07-15-s007-supabase.md).
- [x] `S008`: real migration applied atomically and repeatably; exact live catalog, constraints, grants, TLS, rollback-only probes, and readiness passed. Evidence: [sanitized S008 report](../artifacts/test-runs/2026-07-15-s008-migration.md).
- [x] `S009`: Vercel production origin, Node 24, Fluid Compute/Mumbai, private Production environment, health/readiness, and secure-cookie checkpoint passed. Evidence: [sanitized S009 evidence](../artifacts/test-runs/2026-07-15-s009-vercel.md).
- [x] `S010`: Google Cloud project, APIs, External/Testing audience, one test user, exact scopes, exact redirects, and Web client were configured without a live grant/effect. Evidence: [sanitized S010 evidence](../artifacts/test-runs/2026-07-15-s010-google.md).
- [x] `S011`: OpenAI project/model access verified for `gpt-5.6-sol` with the sanitized read-only verifier; no product model call was enabled. Evidence: [sanitized S011 evidence](../artifacts/test-runs/2026-07-15-s011-openai.md).
- [x] `S012`: private environment shape, local application/MCP validation, Production configuration, redeployment, health/readiness, and secure-cookie checks passed. Evidence: [sanitized S012 evidence](../artifacts/test-runs/2026-07-15-s012-environment.md).
- [x] `S013`: CI workflow, reachable-history secret scan, dependency audit command, production fake-mode guard, fixed loopback ephemeral migration replay script, and canonical migration checksum correction. Evidence: [sanitized S013 evidence](../artifacts/test-runs/2026-07-15-s013-ci-security.md) and [independent correction pass](../artifacts/test-runs/2026-07-15-s013-s017-correction-pass.md).
- [x] `S014`: controlled content/UI inventory and `controlled-content.v1` source/output fixture frozen with closed artifact-independence leakage checks. Evidence: [sanitized S014 evidence](../artifacts/test-runs/2026-07-15-s014-content-ui.md) and [independent correction pass](../artifacts/test-runs/2026-07-15-s013-s017-correction-pass.md).
- [x] `S015`: executable `traceability.v1` catalog covers all 52 FR/SAFE/NFR IDs with strict repository-path, fixture-registry, and status validation. Evidence: [sanitized S015 evidence](../artifacts/test-runs/2026-07-15-s015-traceability.md) and [independent correction pass](../artifacts/test-runs/2026-07-15-s013-s017-correction-pass.md).
- [x] `S016`: `golden-contracts.v1` freezes lifecycle-aware task states, initial/recovery/clarification envelopes, canonical digests, and fixture-only rule/reset shapes. Evidence: [sanitized S016 evidence](../artifacts/test-runs/2026-07-15-s016-golden-contracts.md) and [independent correction pass](../artifacts/test-runs/2026-07-15-s013-s017-correction-pass.md).
- [x] `S017`: accessibility/testability selectors and executable keyboard, contrast-verified focus, reduced-motion, responsive, hermetic-fixture, and honest-label checks added. Evidence: [sanitized S017 evidence](../artifacts/test-runs/2026-07-15-s017-accessibility.md) and [independent correction pass](../artifacts/test-runs/2026-07-15-s013-s017-correction-pass.md).
- [x] `S018`: clean-checkout G0 evidence. Evidence: [sanitized S018 G0 report](../artifacts/test-runs/2026-07-15-s018-g0.md).
- [x] `S019`–`S027`: completed the strict G1 contracts, transactional PostgreSQL repository path, intake serialization and leases, auth/CSRF/resource boundaries, fixture isolation, thin create/read/status/cancel routes, scoped MCP create/status tools, non-effecting review UI, and automated regression/E2E coverage. Evidence: [sanitized S019–S027 G1 report](../artifacts/test-runs/2026-07-15-s019-s027-g1.md). Schema/fixture versions: `v1`, `initial-plan.v1`, `golden-contracts.v1`, `traceability.v1`, `fixture-initial.v1`, `prevention-rule.v1`, `reset-plan.v1`.

- [x] `S028` deployed proof: Production used `NODE_ENV=production` and `REWIND_STORAGE_MODE=postgres`; health/readiness passed; the operator authenticated, created and read the exact non-effecting contract review through MCP and the dashboard, and cancelled it without provider calls or external effects. Evidence: [sanitized deployed proof](../artifacts/test-runs/2026-07-16-s028-deployed.md) and the operator-supplied review/cancel screenshots.
- [x] `S029` interface freeze: `g1-interface.v1` freezes the v1 schemas, migration checksum/catalog, golden HTTP/read-model fixtures, complete error/status matrix, fixture versions, implemented routes, and local/deployed create/read evidence. Evidence: [S029 freeze report](../artifacts/test-runs/2026-07-16-s029-interface-freeze.md) and [G1 interface packet](G1_INTERFACE_PACKET.md). S030 subsequently closed G1.
- [x] `S030` G1 closure: audited replay/auth/browser evidence, deployed screenshots and readiness, fake-mode proof, command outputs, known risks, and requirement links. Evidence: [S030 closure report](../artifacts/test-runs/2026-07-16-s030-g1-close.md). G1 is closed; S031 subsequently completed the OAuth transaction boundary.
- [x] `S031` OAuth transaction flow: exact Google authorization redirect, state/nonce/PKCE construction, browser-session binding, one-use callback consumption, AES-256-GCM verifier/refresh-token persistence primitives, authenticated routes, and reviewed `0002_oauth_transaction` migration. Evidence: [S031 OAuth transaction report](../artifacts/test-runs/2026-07-16-s031-oauth-transaction.md). No Google consent, token exchange, mailbox/profile read, Calendar call, Gmail call, or external effect was run; S032 subsequently added the identity gate.
- [x] `S032` connected identity claims: strict signed Google ID-token verification with published JWKS, issuer/audience/azp/time/nonce/email/sub/account checks, exact approved scopes, encrypted refresh-token rotation, provider-failure mapping, and a Postgres consume-parameter regression fix. Evidence: [S032 Google identity report](../artifacts/test-runs/2026-07-16-s032-google-identity.md). Requirement links: SAFE-04, SAFE-05, SAFE-09, SAFE-10, NFR-10. Contract versions: `GoogleOidcClaimsSchema`, `GoogleOidcJwtHeaderSchema`, `GoogleOAuthTokenResponseSchema`, existing OAuth transaction `v1`; no migration changed. No live consent, token exchange, mailbox/profile read, Calendar call, Gmail call, or external effect was run; S033 negative tests are next.
- [x] `S033` OAuth negative tests: deterministic route and boundary coverage for replay, missing/mismatched state/nonce/PKCE, redirect drift, wrong audience/issuer/subject/account, expiry, unverified email, malformed ID tokens, provider rejection, and no-credential outcomes. Evidence: [S033 OAuth negative-test report](../artifacts/test-runs/2026-07-16-s033-oauth-negative.md). Requirement links: SAFE-04, SAFE-05, SAFE-09, SAFE-10, NFR-10. No live provider call or external effect was run; S034 provider ports/fakes are next.
- [x] `S034` explicit provider ports and deterministic fakes: strict Calendar/Gmail/artifact/model input/output contracts, scenario-specific interfaces, conditional Calendar versioning, exact artifact persistence, single-attempt Gmail outcomes, raw-untrusted model results, and failure injection tests. Evidence: [S034 provider-port report](../artifacts/test-runs/2026-07-16-s034-provider-ports.md). Requirement links: SAFE-05, SAFE-07, SAFE-08, SAFE-10, NFR-04, NFR-10. No live provider call or external effect was run; S035 controlled Calendar discovery/seeding is next and requires human TTY confirmation.
- [x] `S035` controlled Calendar discovery and seeding: strict `calendar-demo.v1` seed/state contracts, Google Calendar wire mapping, DST-aware two-event construction, immutable semantic-baseline and rolling-version persistence, exact-two validation, partial/provider failure auditing, and TTY/CI/production/explicit-target guards are implemented and covered by deterministic tests. Evidence: [S035 Calendar setup report](../artifacts/test-runs/2026-07-16-s035-calendar-setup.md), [OAuth callback correction](../artifacts/test-runs/2026-07-16-s035-oauth-callback-fix.md), and [S035 live closure](../artifacts/test-runs/2026-07-16-s035-live-closure.md). Requirement links: FR-04, SAFE-05, SAFE-10, NFR-04, NFR-10. Production deployment `4541706` readiness passed; the intended controlled account connected; the human preflight returned `status: ok`, `candidateCount: 2`, `baselineCount: 2`, and `expectedVersionCount: 2`. The initial invalid configuration failed closed before the corrected preflight. No live provider command was run by Codex.
- [x] `S036` Calendar move/restore primitives: strict operation desired/receipt schemas, pre-write `started` persistence, static safety and rolling-version preconditions, conditional start/end-only writes, verified after-state persistence, restore against recorded move after-state, and durable conflict/uncertain outcomes. Evidence: [S036 Calendar primitives report](../artifacts/test-runs/2026-07-16-s036-calendar-primitives.md). Requirement links: FR-13, FR-14, FR-17, SAFE-05, SAFE-10, NFR-02, NFR-04, NFR-10. Contract versions: `calendar-demo.v1`, `provider-ports.v1`; no migration changed. Automated and browser/security/fake-production verification passed; no live Calendar move or restore was run.
- [x] `S037` Gmail at-most-once delivery: strict registered templates, structured allowlist and sender/digest checks, deterministic MIME and Google wire classification, marker-before-handoff PostgreSQL bridge, local retryable/permanent/uncertain outcomes, redacted receipts, and no-redispatch replay/concurrency tests. Evidence: [S037 Gmail at-most-once report](../artifacts/test-runs/2026-07-16-s037-gmail-at-most-once.md). Contract versions: `provider-ports.v1`, `gmail-delivery.v1`; no migration changed; no live Gmail effect was run.
- [x] `S038` human-gated Gmail success and replay proof: the strict `gmail-live-proof.v1` plan/action contract, TTY/live-flag/CI/production/recipient guards, fixed durable proof ledger, token-before-claim ordering, one-send/replay command, safe output, and deterministic tests are implemented. Human live output returned `firstStatus: sent`, `replayStatus: sent`, `replayVerified: true`, and `attempts: 1`; exactly one inbox message with the run ID was confirmed. Evidence: [S038 live-proof report](../artifacts/test-runs/2026-07-16-s038-gmail-live-proof.md).
- [x] `S039` artifact boundary: `generateAccountBriefForPlanning` accepts only the versioned parent-account source, derives the exact independent brief, binds source/content/version hashes, rejects all closed leakage dimensions, and `persistApprovedAccountBrief` stores the exact approved bytes without regeneration. Evidence: [S039 artifact-boundary report](../artifacts/test-runs/2026-07-16-s039-artifact-boundary.md).
- [x] `S040` OpenAI Responses client: server-only configured-model transport, `store: false`, strict Structured Outputs, refusal/truncation/malformed/provider mapping, response metadata, one bounded retry, redacted errors, and deterministic HTTP tests. Evidence: [S040 OpenAI Responses report](../artifacts/test-runs/2026-07-16-s040-openai-responses.md). No live model call was run; S043 owns the provider spike.
- [x] `S041` model-only schemas: strict `initial-reasoning.v1`, `recovery-proposal.v1`, and `prevention-rule-proposal.v1` runtime/Responses schemas close supplied IDs, outcomes, and templates; reject executable provider fields and unknown properties; and keep deterministic expansion outside the model. Evidence: [S041 model-schema report](../artifacts/test-runs/2026-07-16-s041-model-schemas.md) and [S041 CI correction](../artifacts/test-runs/2026-07-16-s041-ci-fix.md). No model inference, provider mutation, or external effect was run.
- [x] `S042` model safety/evaluation: cross-field validators require deterministic initial ranking/dependencies, an explicit trusted correction target, exact succeeded-action coverage, compatible restore/correct/preserve outcomes, fixed new templates, independent artifact content, source-bound rule proposals, and server-owned allowlisted recipients. The validation runner retries at most once, rejects fallback metadata, and never converts invalid output into success. Evidence: [S042 model-safety report](../artifacts/test-runs/2026-07-16-s042-model-safety.md). No live model inference, provider mutation, or external effect was run.
- [x] `S043` controlled provider/model spikes: added `provider-spike.v2`, `local-model-spike.v1`, the TTY/live-flagged Calendar harness, strict OpenAI and Ollama adapters, sanitized failures, one two-attempt ceiling, and model-before-Calendar ordering. The unfunded OpenAI attempts failed closed and remain recorded. Explicit `local_ollama` mode is fixed to loopback, rejects cloud models, and labels evidence `local_model`. The human combined receipt proves the three strict local model operations, deliberate stale conflict, controlled Calendar move/restore, and final two-event preflight. Existing S035 OAuth/lookup and S038 Gmail/replay evidence are not duplicated; product execution/reset remained disabled. Evidence: [S043 combined success receipt](../artifacts/test-runs/2026-07-16-s043-provider-model-spike-success.md).
- [x] `S044` honest connection/preflight UI: added the authenticated, read-only `connection-preflight.v1` endpoint/panel with safe configuration gaps, exact account-bound identity display, database/runtime state, Calendar preflight failed/not-run checks, model evidence label, and disabled product execution/reset. Evidence: [S044 connection/preflight UI report](../artifacts/test-runs/2026-07-16-s044-connection-preflight-ui.md).

- [x] G1 adversarial review correction pass: repaired MCP/dashboard controlled-workspace access, PostgreSQL lease/replay and cancellation honesty, production auth/error mapping, strict lifecycle metadata, UI-state honesty, and documentation drift. Evidence: [sanitized adversarial review](../artifacts/test-runs/2026-07-15-g1-adversarial-review.md). Requirement links: FR-01, FR-02, FR-03, FR-07, FR-09, SAFE-03, SAFE-04, SAFE-08, NFR-02, NFR-06, NFR-07, NFR-08, NFR-10. Versions: `v1`, `initial-plan.v1`, `golden-contracts.v1`, `traceability.v1`, `fixture-initial.v1`, `prevention-rule.v1`, `reset-plan.v1`. Local verification passed; deployed proof, fresh disposable migration replay, and recovery evaluation remain unverified for the recorded reasons.

## Current blockers

| Blocker | Impact | Next action | Status |
|---|---|---|---|
| S043 combined local-model/Calendar receipt | Closed S043 provider/model risk; G2 still has separate UI/evidence closure work | Human returned the sanitized `provider-spike.v2` receipt | Resolved |
| Playwright root-command cleanup on Windows | Critical browser test needed an explicit server/browser lifecycle | Direct smoke runner tears down cleanly; retain conventional spec for CI migration | Resolved |

Supabase is provisioned, the frozen foundation schema is applied, and S009 Vercel health/readiness and cookie checks pass. Google Cloud and OpenAI access prerequisites are configured without live product effects. S012 private environment validation and S013–S018 local and hosted verification passed, including the disposable PostgreSQL migration replay. S019–S044 pass in their documented scopes; the S041 CI correction also passed hosted CI; G1 is closed and the OAuth transaction, local identity, negative-test, provider-port, controlled Calendar setup, Calendar primitive, Gmail at-most-once, human Gmail success/replay, independent artifact, strict Responses transport, closed model-only schema, S042 semantic/evaluation, S043 combined provider/model, and S044 connection/preflight UI boundaries are complete. S045 G2 closure remains.

## Verification evidence log

Add entries only after work is actually complete:

| Date | Item | Evidence | Result | Owner |
|---|---|---|---|---|
| 2026-07-14 | Repository inspection | Empty directory; `git status` reported not a repository | Confirmed | Codex |
| 2026-07-14 | Kickoff documentation | README, AGENTS, PRD, Architecture, Contracts, Safety, Test Plan, Demo Runbook, Decisions, Progress, Implementation Plan | Complete | Codex |
| 2026-07-14 | Git remote | `main` pushed to `origin/main`; initial commit `5efe0b5` | Complete | Repository evidence |
| 2026-07-14 | Master implementation plan | One sequential `S001`–`S103` queue with ordered G0–G7 gates | Complete | Codex |
| 2026-07-14 | Foundation decisions | OPEN-002–009 and OPEN-012–013 resolved with evidence paths | Complete; live provider proof deferred to explicit gates | Codex |
| 2026-07-14 | Scaffold and fast checks | `npm run build`, `npm run lint`, `npm run typecheck`, `npm test` | Passed; full dependency audit clean after Vitest 3.2.7 upgrade | Codex |
| 2026-07-14 | Fixture API smoke | Authenticated fixture POST returned 201; authenticated World PR GET returned 200 with 3 actions and 2 timeline entries | Passed | Codex |
| 2026-07-14 | Critical Playwright flow | `npm run test:e2e` reported the unauthenticated redirect, login, create, and review assertions as passed | Passed | Codex |
| 2026-07-14 | Review and safety regression pass | 12 unit/contract tests cover strict action shape, plan digest reproduction, PostgreSQL insert order/idempotency claim and replay, auth origin/secret checks, and fixture service behavior | Passed | Codex |
| 2026-07-15 | Full foundation audit and repair | [Sanitized audit evidence](../artifacts/test-runs/2026-07-15-foundation-audit.md): Node 24 install/lint/typecheck/28 tests/build/E2E/dependency/secret checks; auth, contracts, storage, provenance, and setup defects repaired | Passed for the local non-effecting fixture slice; live PostgreSQL remains S007/S008 | Codex |
| 2026-07-15 | S007 Supabase provisioning | [Sanitized S007 evidence](../artifacts/test-runs/2026-07-15-s007-supabase.md): private file hygiene, transaction/session TLS authentication, restricted role flags, future-object ACLs, and plaintext rejection | Passed; migration deliberately not run | User + Codex |
| 2026-07-15 | S008 real migration and readiness | [Sanitized S008 evidence](../artifacts/test-runs/2026-07-15-s008-migration.md): atomic/repeat migration, exact live catalog/columns/constraints/privileges/TLS/default ACLs, rolled-back constraint probes, sanitized health/readiness HTTP smoke, 61 tests, build, and browser regression | Passed; S009 is next | Codex |
| 2026-07-15 | S009 Vercel provisioning and readiness | [Sanitized S009 evidence](../artifacts/test-runs/2026-07-15-s009-vercel.md): Production origin, Node 24, Fluid Compute/Mumbai, private variable names, health/readiness, dashboard sign-in, and secure-cookie flags | Passed; S010 is next | User + Codex |
| 2026-07-15 | S010 Google Cloud prerequisites | [Sanitized S010 evidence](../artifacts/test-runs/2026-07-15-s010-google.md): APIs, External/Testing audience, one test user, exact scopes/redirects, Web client, private credential storage, and no live effect | Passed; S011 is next | User + Codex |
| 2026-07-15 | S011 OpenAI project access | [Sanitized S011 evidence](../artifacts/test-runs/2026-07-15-s011-openai.md): private project/key, configured model, read-only access check, and no product call | Passed; S012 is next | User + Codex |
| 2026-07-15 | S012 private environment and startup validation | [Sanitized S012 evidence](../artifacts/test-runs/2026-07-15-s012-environment.md): local config check, Production configuration/redeploy, health/readiness, login, and secure-cookie flags | Passed; S013 is next | User + Codex |
| 2026-07-15 | S013 CI and repository security checks | [Sanitized S013 evidence](../artifacts/test-runs/2026-07-15-s013-ci-security.md): clean install, lint, typecheck, 95 tests, build, 0-vulnerability audit, tracked secret scan, fake-production guard, fixture E2E, and CI-only ephemeral migration job | Passed locally; hosted ephemeral migration remains pending | Codex |
| 2026-07-15 | S014 controlled content and UI inventory | [Sanitized S014 evidence](../artifacts/test-runs/2026-07-15-s014-content-ui.md): `controlled-content.v1` source/output fixture, copy/state inventory, viewports, reduced-motion baseline, selectors, and evidence policy | Passed; S015 is next | Codex |
| 2026-07-15 | S015 executable requirement traceability | [Sanitized S015 evidence](../artifacts/test-runs/2026-07-15-s015-traceability.md): strict `traceability.v1` catalog, all 52 IDs, path validation, and honest 3/15/34 coverage counts | Passed; S016 is next | Codex |
| 2026-07-15 | S016 golden contract fixtures | [Sanitized S016 evidence](../artifacts/test-runs/2026-07-15-s016-golden-contracts.md): `golden-contracts.v1` task states, success/error envelopes, strict rule/reset fixtures, and no external effects | Passed; S017 is next | Codex |
| 2026-07-15 | S017 accessibility and testability validation | [Sanitized S017 evidence](../artifacts/test-runs/2026-07-15-s017-accessibility.md): stable selectors, semantic labels, keyboard focus, reduced-motion emulation, responsive viewport, and honest fixture notice | Passed; S018 is next | Codex |
| 2026-07-15 | S018 clean-checkout G0 gate | [Sanitized S018 evidence](../artifacts/test-runs/2026-07-15-s018-g0.md): Node 24 local suite, private migration/readiness verification, hosted Rewind CI run #15, disposable PostgreSQL apply/replay, secret scan, and fixture browser smoke | Passed; S019 is next | Codex + GitHub Actions |
| 2026-07-15 | Full codebase cleanup and regression audit | [Sanitized audit evidence](../artifacts/test-runs/2026-07-15-codebase-cleanup-audit.md): complete file-purpose inventory, clean install, lint, strict/unused type checks, 28 tests, production build, browser and actual MCP smokes, dependency/secret/link/client-bundle checks, and read-only S007 regression | Passed at the time; no redundant tracked file found and S008 was next then | Codex |
| 2026-07-15 | S019–S027 G1 implementation packet | [Sanitized S019–S027 report](../artifacts/test-runs/2026-07-15-s019-s027-g1.md): strict contracts, repository/intake/auth/route/MCP/UI implementation, 27 test files/142 tests, production build, browser flow, audit, security scan, fake-production guard, and traceability validation | Passed locally in fixture mode; S028 deployed proof is next | Codex |
| 2026-07-15 | G1 adversarial review and correction | [Sanitized adversarial review](../artifacts/test-runs/2026-07-15-g1-adversarial-review.md): repaired MCP/dashboard scope, lease/replay/cancel races, auth/error/contract/UI honesty; clean install, 27 files/150 tests, build, browser, audit, security/traceability/fake-production checks | Passed locally in fixture mode; fresh disposable migration and recovery evaluation remain unverified for documented scope reasons | Codex |
| 2026-07-16 | S028 production boundary and local preflight | [Sanitized S028 preparation report](../artifacts/test-runs/2026-07-16-s028-preparation.md): production PostgreSQL repository boundary, non-effecting UI label, Node 24 clean install, 152 unit tests, build, browser smoke, lint/typecheck, security, fake-production, and traceability checks | Local packet passed; deployed MCP/session proof remains human-only and unperformed; no external effect occurred | Codex |
| 2026-07-16 | S028 deployed non-effecting proof | [Sanitized S028 deployed report](../artifacts/test-runs/2026-07-16-s028-deployed.md): Production health/readiness, operator environment confirmation, authenticated MCP create, PostgreSQL-backed dashboard read, non-effecting review, and cancellation | Passed; no Calendar/Gmail/OpenAI calls or external effects; S029 is next | User + Codex |
| 2026-07-16 | S029 G1 interface freeze | [S029 freeze report](../artifacts/test-runs/2026-07-16-s029-interface-freeze.md): executable `g1-interface.v1` manifest, 25-code error matrix, lifecycle/action statuses, migration/catalog, fixture versions, evidence paths, and all regression/build/browser/security checks | Passed; S030 G1 closure is next; no provider or external-effect work started | Codex |
| 2026-07-16 | S030 G1 closure | [S030 closure report](../artifacts/test-runs/2026-07-16-s030-g1-close.md): acceptance audit, command/evidence index, deployed proof, replay/auth results, fake-mode proof, known risks, and requirement links | Passed; G1 closed; S031 subsequently completed the OAuth transaction boundary; no provider or external-effect work started | Codex |
| 2026-07-16 | S031 OAuth transaction flow | [S031 OAuth transaction report](../artifacts/test-runs/2026-07-16-s031-oauth-transaction.md): state/nonce/PKCE/redirect/session/replay tests, encrypted secret tests, route tests, exact migration/catalog runner, clean install, full unit/build/browser/security/config/interface/traceability checks | Passed locally; `0002_oauth_transaction` has not been applied to Production and Google consent/token exchange remain human/provider-gated; S032 is next | Codex |
| 2026-07-16 | S032 connected identity claims | [S032 Google identity report](../artifacts/test-runs/2026-07-16-s032-google-identity.md): strict JWT/JWKS claim checks, account-substitution rejection, exact-scope and encrypted-refresh tests, OAuth callback fake-provider tests, Postgres consume-parameter regression, typecheck, lint, and focused 39-test run | Passed locally with deterministic fakes; no live consent/token exchange, mailbox/profile read, Calendar call, Gmail call, or external effect; S033 is next | Codex |
| 2026-07-16 | S033 OAuth negative tests | [S033 OAuth negative-test report](../artifacts/test-runs/2026-07-16-s033-oauth-negative.md): route and boundary regressions for state/nonce/PKCE/redirect/claim/account/provider failures, focused 38-test run, full suite, typecheck, lint, build, security, fake-production, traceability, and diff checks | Passed locally with deterministic fakes; all negative paths fail closed and no live provider call or external effect occurred; S034 is next | Codex |
| 2026-07-16 | S034 explicit provider ports and deterministic fakes | [S034 provider-port report](../artifacts/test-runs/2026-07-16-s034-provider-ports.md): strict provider-port contracts, Calendar/Gmail/artifact/model fakes, failure injection, provider-port tests, full suite, typecheck, lint, build, security, fake-production, traceability, and diff checks | Passed locally with deterministic fakes; no live provider call or external effect occurred; S035 is next and requires human TTY confirmation | Codex |
| 2026-07-16 | S035 safe Calendar setup boundary | [S035 Calendar setup report](../artifacts/test-runs/2026-07-16-s035-calendar-setup.md) and [S035 live closure](../artifacts/test-runs/2026-07-16-s035-live-closure.md): `calendar-demo.v1`, strict Google wire mapping, deterministic exact-two seed/preflight tests, immutable baseline/rolling-version store, failure audit, TTY/CI/production/target refusal, and safe command output | Passed: deployed OAuth connected, corrected seed configuration failed closed before retry, and human preflight returned `status: ok` with 2 candidates, 2 baselines, and 2 expected provider versions; no live provider command was run by Codex | User + Codex |
| 2026-07-16 | S035 OAuth callback/provider compatibility correction | [S035 OAuth callback correction](../artifacts/test-runs/2026-07-16-s035-oauth-callback-fix.md): bounded provider projections, time-limited refresh-token metadata, exact front/back-channel scopes, safe diagnostics, focused/full tests, typecheck, lint, build, browser, security, traceability, fake-production, Vercel deployment, and Production readiness checks | Deployed at `4541706`; the intended human OAuth connection subsequently returned `status: connected`; no credential or live provider command was run by Codex | Codex + human owner |
| 2026-07-16 | Provider-boundary adversarial review correction | [Sanitized review report](../artifacts/test-runs/2026-07-16-provider-boundary-adversarial-review.md): repaired the Google Calendar Event/list response projections and bound private TTY confirmation to the exact configured Calendar ID plus unique run ID; focused and full deterministic verification passed | Passed with non-blocking risks; S035 human-only setup subsequently closed by the owner’s connected OAuth and sanitized preflight evidence; no credential or live provider command was run by Codex | Codex + human owner |
| 2026-07-16 | S036 Calendar primitives | [S036 Calendar primitives report](../artifacts/test-runs/2026-07-16-s036-calendar-primitives.md): typed operation receipts, pre-write persistence, conditional move/restore, verification, rolling versions, conflict/uncertain handling, full deterministic/browser/security/fake-production/traceability verification | Passed; no live Calendar move or restore was run; S037 is next | Codex |
| 2026-07-16 | S037 Gmail at-most-once delivery | [S037 Gmail at-most-once report](../artifacts/test-runs/2026-07-16-s037-gmail-at-most-once.md): strict allowlist/templates, deterministic MIME/Google wire port, marker-before-handoff PostgreSQL bridge, local retry/permanent/uncertain matrix, redacted receipts, terminal replay/no-redispatch, 41-file/270-test suite, typecheck, lint, and traceability | Passed; no live Gmail send was run; S038 human success/replay proof is next | Codex |
| 2026-07-16 | S038 Gmail live success/replay | [S038 live-proof report](../artifacts/test-runs/2026-07-16-s038-gmail-live-proof.md): human TTY command returned `sent`/`sent`, replay verified, exactly one persisted attempt, and the operator confirmed exactly one inbox message | Passed; S039 artifact boundary is next | User + Codex |
| 2026-07-16 | S039 account-brief artifact boundary | [S039 artifact-boundary report](../artifacts/test-runs/2026-07-16-s039-artifact-boundary.md): planning-only versioned source, exact source/content hashes, leakage rejection, approved-byte persistence, 44-file/283-test suite, typecheck, lint, build, and traceability | Passed; S040 OpenAI Responses client is next | Codex |
| 2026-07-16 | S040 OpenAI Responses client | [S040 OpenAI Responses report](../artifacts/test-runs/2026-07-16-s040-openai-responses.md): strict request transport, `store: false`, safe refusal/truncation/provider handling, bounded retry, metadata/redaction tests, and deterministic verification | Passed; no live model call; S041 model-only schemas are next | Codex |
| 2026-07-16 | S041 versioned model-only schemas | [S041 model-schema report](../artifacts/test-runs/2026-07-16-s041-model-schemas.md): three strict runtime/Responses schemas, closed supplied universes, provider-field exclusion, 46-file/295-test suite, build/browser/config/database/security verification | Passed; no model inference, provider mutation, or external effect; feature work paused before S042 | Codex |
| 2026-07-16 | S041 CI correction | [S041 CI correction report](../artifacts/test-runs/2026-07-16-s041-ci-fix.md): replaced a non-deterministic base64url signature mutation with a separately keyed forged token; local checks and GitHub Actions run #77 passed | Passed; verifier code unchanged, no provider or external effect; S042 not started | Codex |
| 2026-07-16 | Post-S041 regression audit | [Regression audit](../artifacts/test-runs/2026-07-16-post-s041-regression-audit.md): full tests/build/browser, config/G1/fake/traceability, security/audit, read-only database/OpenAI access, and deployed health/readiness | Passed after correcting one stale traceability count; no unresolved regression in implemented S001–S041 scope | Codex |
| 2026-07-16 | S042 model safety and evaluation harnesses | [S042 model-safety report](../artifacts/test-runs/2026-07-16-s042-model-safety.md): strict initial/recovery/rule semantic validators, representative malformed/unknown/recipient/prompt-injection/unsafe-preserve cases, refusal/truncation retry handling, fallback rejection, sanitized evaluation output, and full deterministic verification | Passed; 47 unit files / 307 tests, typecheck, lint, build, browser, security, traceability, fake-production, dependency audit, and hosted GitHub Actions run #81; no live model inference, provider mutation, database mutation, or external effect | Codex |
| 2026-07-16 | S043 model transport/spike-order correction | [S043 correction report](../artifacts/test-runs/2026-07-16-s043-model-transport-correction.md): human preflight and fail-closed codes, safe HTTP/timeout/output classification, single two-attempt ceiling, 90-second timeout, model-before-Calendar ordering, and focused/full regression evidence | Code correction passed; its remaining live checkpoint was superseded by the final combined local-model/Calendar receipt | User + Codex |
| 2026-07-16 | S043 corrected OpenAI model attempt | [S043 OpenAI rate-limit blocker](../artifacts/test-runs/2026-07-16-s043-openai-rate-limit-blocker.md): corrected TTY run safely isolated HTTP 429 during the initial model operation before Calendar opened | Failed closed with no Calendar/Gmail/product effect; superseded for the zero-spend demo by the explicit, honestly labeled local runtime decision | User + Codex |
| 2026-07-16 | S043 zero-cost local model runtime | [S043 local runtime report](../artifacts/test-runs/2026-07-16-s043-local-model-runtime.md): loopback-only Ollama transport, cloud-model rejection, strict schema projection, unchanged Zod/semantic validators, and no-effect real-model proof | `qwen2.5-coder:latest` passed all three operations in one attempt each with `externalEffects: false`; this was the no-effect checkpoint before the final combined receipt | Codex |
| 2026-07-16 | S043 combined provider/model spike | [S043 combined success receipt](../artifacts/test-runs/2026-07-16-s043-provider-model-spike-success.md): sanitized human receipt for two-event preflight before/after, deliberate stale conflict, controlled move/restore, and three strict local Ollama operations | Passed; Calendar returned to its recorded baseline, product execution/reset remained disabled, and S044 is next | User + Codex |
| 2026-07-16 | S044 connection/preflight UI | [S044 connection/preflight UI report](../artifacts/test-runs/2026-07-16-s044-connection-preflight-ui.md): strict status contract, authenticated read-only route, safe configuration/identity/database/runtime projections, failed/not-run preflight states, focused tests, build, lint, typecheck, and browser smoke | Passed; no provider/model command or external effect; S045 is next | Codex |

## MVP definition of done

All of the following must be true:

- Every functional/safety item above required by the PRD is complete with evidence.
- Provider/model risk gate, critical Playwright flow, 25-paraphrase plus negative/safety evaluation, failure matrix, and five consecutive live runs pass.
- No uncontrolled recipient, stale overwrite, duplicate external action, hidden fallback, unknown adapter input, or unresolved delivery outcome appears in a passing run.
- Reset restores Calendar/local state and explicitly retains sent mail.
- Final docs/commands match the code and work on a clean checkout.
- The recorded demo and submission claims stay inside the controlled boundary.
