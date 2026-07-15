# Rewind MVP progress

Current status: master-plan tasks `S001`–`S027` are complete; the first unfinished task is `S028` (prove the deployed non-effecting slice), and Gate G0 is closed while Gate G1 remains in progress.

| Field | Value |
|---|---|
| Status | Live checklist |
| Current phase | G1 non-effecting vertical slice; restart at `S028` |
| Last updated | 2026-07-15 |
| Implementation update | One sequential `S001`–`S103` plan replaces the prior person-specific workstreams; no live provider integration is enabled. |

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
- [x] Identical, conflicting, in-progress, and failed idempotency replay; planning leases; rule-first clarification without a plan/action/lock; and effect-bearing scenario serialization are covered in the fixture/PostgreSQL repositories. Durable deployed proof remains S028–S030.
- [x] Backend persists a versioned World PR and returns a non-secret review URL. Evidence: fixture create/read smoke returned 201/200 and an immutable plan digest.
- [x] Authenticated dashboard loads the World PR. Evidence: `npm run test:e2e` exercised login, creation, and review rendering in fixture mode and exited successfully.
- [ ] Exactly two tagged Calendar candidates are fetched from the controlled calendar.
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
| G1 | `S019`–`S030`: non-effecting MCP → API → PostgreSQL → dashboard | In progress | S019–S027 complete with [sanitized G1 evidence](../artifacts/test-runs/2026-07-15-s019-s027-g1.md); deployed proof starts at S028 |
| G2 | `S031`–`S045`: OAuth, Calendar/Gmail/artifact/model primitives and live spikes | Not started | TBD |
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

## Current blockers

| Blocker | Impact | Next action | Status |
|---|---|---|---|
| Deployed G1 proof still requires the configured Vercel/Supabase environment and an operator session | Local fixture evidence cannot prove deployed MCP → API → PostgreSQL → dashboard behavior | Run the human-only S028 guide without enabling providers or external effects | Open |
| OAuth token and live provider ownership are not configured | Calendar/Gmail risk cannot be retired | Complete S031–S043 in G2 | Open |
| Playwright root-command cleanup on Windows | Critical browser test needed an explicit server/browser lifecycle | Direct smoke runner tears down cleanly; retain conventional spec for CI migration | Resolved |

Supabase is provisioned, the frozen schema is applied, and S009 Vercel health/readiness and cookie checks pass. Google Cloud and OpenAI access prerequisites are configured without live product effects. S012 private environment validation and S013–S018 local and hosted verification passed, including the disposable PostgreSQL migration replay. S019–S027 pass locally in deterministic fixture mode; next is S028 deployed proof. Provider work remains gated behind G1 and G2.

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

## MVP definition of done

All of the following must be true:

- Every functional/safety item above required by the PRD is complete with evidence.
- Provider/model risk gate, critical Playwright flow, 25-paraphrase plus negative/safety evaluation, failure matrix, and five consecutive live runs pass.
- No uncontrolled recipient, stale overwrite, duplicate external action, hidden fallback, unknown adapter input, or unresolved delivery outcome appears in a passing run.
- Reset restores Calendar/local state and explicitly retains sent mail.
- Final docs/commands match the code and work on a clean checkout.
- The recorded demo and submission claims stay inside the controlled boundary.
