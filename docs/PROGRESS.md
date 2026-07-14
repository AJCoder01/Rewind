# Rewind MVP progress

| Field | Value |
|---|---|
| Status | Live checklist |
| Current phase | Documentation kickoff complete; implementation not started |
| Last updated | 2026-07-14 |

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
- [x] Kickoff documentation set created.
- [ ] Git repository initialized and remote configured.
- [ ] Application scaffold/package manifest exists.
- [ ] Any command in README/AGENTS has been run successfully.
- [ ] Any Calendar, Gmail, OpenAI, PostgreSQL, dashboard, or MCP integration exists.

Do not infer implementation progress from completed documentation.

## MVP capability checklist

### Intake and World PR

- [ ] `create_world_pr` exists as the sole required MCP tool.
- [ ] Dashboard composer and MCP call the same authenticated `createWorldPr` service.
- [ ] In-progress/completed idempotency and the one effect-bearing-scenario lock are enforced; rule-matched clarification can precede the lock.
- [ ] Backend persists a versioned World PR and returns a non-secret review URL.
- [ ] Authenticated dashboard loads the World PR.
- [ ] Exactly two tagged Calendar candidates are fetched from the controlled calendar.
- [ ] Acme UK is ranked by deterministic visible evidence; Acme US is shown as an alternative.
- [ ] World PR displays the original request, one important assumption, and evidence.
- [ ] World PR previews exact Calendar date/time/time zone/duration.
- [ ] World PR previews exact Gmail recipients and body.
- [ ] World PR previews the exact account-brief content/hash/source provenance and passes output-independence validation.
- [ ] Dependency edges and external-effect labels are visible.
- [ ] Cancel/back controls work.

### Approval and initial execution

- [ ] Initial plan is immutable, versioned, canonicalized, and SHA-256 hashed.
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

## Day 1 — Foundations and risk retirement

Do these in order. Stop feature work if any mandatory live risk remains red.

### Decisions and scaffold

- [ ] Resolve OPEN-012 team role assignments before any implementation work.
- [ ] Resolve OPEN-001 through OPEN-010 and OPEN-013 owners/providers/accounts/evidence location in `DECISIONS.md`.
- [ ] Initialize Git and add remote/branch protection as applicable.
- [ ] Scaffold one strict TypeScript Next.js package using npm.
- [ ] Add/pin Node version and create verified root scripts.
- [ ] Add `.env.example` containing names only; no values/secrets.
- [ ] Provision PostgreSQL and migrations.
- [ ] Implement health/readiness checks and structured redacted logging.
- [ ] Implement minimal authenticated dashboard session/CSRF and MCP bearer auth.

### First vertical slice — mandatory before integrations

- [ ] Thin stdio MCP server exposes `create_world_pr`.
- [ ] MCP calls `POST /api/v1/world-prs` with auth and idempotency.
- [ ] Backend atomically claims idempotency, retrieves candidates/evaluates an active rule, then acquires a leased scenario lock only for effect-bearing planning.
- [ ] Backend returns World PR ID/status/review URL.
- [ ] Authenticated dashboard loads the persisted World PR.
- [ ] Identical create replay returns the same record/response.
- [ ] Unauthorized and concurrent-scenario calls fail correctly.
- [ ] Unit, contract, integration, and minimal browser tests pass.
- [ ] Evidence attached: command outputs, database row screenshot/query, MCP result, dashboard screenshot.

### Live risk spikes — mandatory before feature build

- [ ] Google OAuth/OIDC state/nonce/PKCE/callback, exact claim/account validation, replay rejection, and token refresh work in the target environment.
- [ ] OIDC identity/calendar match the configured test account without Gmail read/profile scope.
- [ ] Exactly two tagged owned events are seeded/fetched.
- [ ] Conditional Calendar move/verify/restore succeeds without intended Calendar mail.
- [ ] Deliberate Calendar drift produces conflict.
- [ ] One allowlisted Gmail send returns a receipt.
- [ ] Gmail double-click/replay dispatches once.
- [ ] Gmail dispatch marker/error matrix proves only local pre-handoff retry; all post-handoff ambiguous classes become `delivery_uncertain` without retry.
- [ ] Live configured OpenAI model returns strict structured output.
- [ ] Semantic invalid output is rejected.
- [ ] Approved reset plan restores semantic baselines, rolls ETags, handles injected partial state honestly, and retains sent mail.
- [ ] Admin seed/spike commands enforce TTY/demo-tag/allowlist/receipt and CI/production refusal.
- [ ] Day 1 stop/go review recorded.

## Day 2 — Deterministic workflow

- [ ] Implement canonical plan/action/rule/audit schemas and migrations.
- [ ] Implement task/action state transitions and invariants.
- [ ] Implement plan canonicalization/digest and approval records.
- [ ] Implement idempotency lifecycle, pre-rule scenario lock/planning lease reconciliation, and action lease/unique key.
- [ ] Implement explicit Calendar snapshot/move/restore/verify operations.
- [ ] Implement deterministic Gmail templates/send/receipt/uncertain policy.
- [ ] Implement account-brief planning generation, output-leakage validator, exact hash preview, and byte-identical storage.
- [ ] Implement immutable reset plan/approval and semantic-baseline/rolling-ETag records.
- [ ] Implement seed, preflight, and reset scripts.
- [ ] Implement basic World PR and timeline UI.
- [ ] Pass deterministic initial-flow E2E and live smoke.

## Day 3 — AI planning

- [ ] Version initial/recovery prompts and strict schemas.
- [ ] Implement Responses API client, refusal/truncation/error handling, one retry.
- [ ] Implement model-proposed closed candidate assumption and dependency mapping with deterministic semantic validation.
- [ ] Implement recovery correction parser and explicit-target requirement.
- [ ] Implement recovery proposal expansion into exact immutable plan.
- [ ] Create 25 correction-paraphrase fixtures plus the separate negative/safety suite and grading report.
- [ ] Achieve at least 24/25 paraphrases (target 25/25), 100% negative safety outcomes, and zero fallback use.

## Day 4 — Causal Revert

- [ ] Implement context submission and recovery state transitions.
- [ ] Implement exact recovery preview/approval.
- [ ] Implement UK/US preflight gate and fixed recovery order.
- [ ] Implement partial/resume/conflict/uncertain UI and services.
- [ ] Complete full deterministic-adapter flow before animation.
- [ ] Pass recovery contract/integration/E2E/failure tests.
- [ ] Pass one full live recovery and reset.

## Day 5 — Product polish

- [ ] Build fixed four/five-node causal visual without graph library.
- [ ] Add five-to-seven-second restrained animation and reduced-motion static state.
- [ ] Finish World PR, timeline, recovery, prevention, clarification, and error UX.
- [ ] Implement model-proposed/validated typed rule, separate activation, and normal-intake clarification proof.
- [ ] Verify one-tab demo, keyboard flow, focus, contrast, and non-color status.
- [ ] Capture primary screenshot candidate.
- [ ] Run fresh-viewer five-second comprehension review.

## Day 6 — Hardening and freeze

- [ ] Run full lint/typecheck/unit/integration/Playwright suites.
- [ ] Run 25-paraphrase evaluation and separate negative/safety suite after final prompt/schema freeze.
- [ ] Run replay/double-click, partial failure, stale ETag, uncertain Gmail, invalid model, OAuth, auth/CSRF, secret/log redaction, and reset tests.
- [ ] Reauthorize Google if required and pass deployed preflight.
- [ ] Complete five consecutive live demo runs with sanitized evidence.
- [ ] Resolve every P0/P1 bug affecting acceptance/safety.
- [ ] Freeze features, prompt, schema, seed data, and demo copy.

## Day 7 — Submission

- [ ] Rerun final preflight and one clean live flow.
- [ ] Record under-three-minute demo with honest uninterrupted provider receipts.
- [ ] Capture final primary recovery screenshot and optional clarification screenshot.
- [ ] Sanitize video/screenshots/logs; ensure no address/token/secret exposure.
- [ ] Update README with real setup and commands verified on a clean checkout.
- [ ] Update architecture/contracts/decisions to match final code.
- [ ] Publish sanitized evaluation and five-run summaries.
- [ ] Complete submission narrative, Codex collaboration note, limitations, and future vision.
- [ ] Revoke temporary links/credentials and schedule seven-day data/token cleanup.

## Current blockers and owners

| Blocker | Impact | Owner | Next action | Status |
|---|---|---|---|---|
| Git repository/remote not initialized | No versioned implementation workflow | TBD | Resolve OPEN-001 | Open |
| Team roles unassigned | No accountable Day 1 execution | Team lead | Resolve OPEN-012 | Open |
| Deployment/PostgreSQL providers unselected | Cannot prove callback/persistence | Backend owner | Resolve OPEN-003/004 | Open |
| Google identity/OAuth audience/allowlist unknown | Calendar/Gmail risk cannot be retired | OAuth/demo owner | Resolve OPEN-006/007/008 | Open |
| Demo date not selected | Cannot seed stable events | Demo owner | Resolve OPEN-009 | Open |
| OpenAI project/model access unverified | Planner feasibility unknown | AI owner | Resolve OPEN-010 and live schema smoke | Open |

These are setup decisions, not reasons to begin UI polish. The first next action is owner assignment, then Git/scaffold, then the minimal vertical slice.

## Verification evidence log

Add entries only after work is actually complete:

| Date | Item | Evidence | Result | Owner |
|---|---|---|---|---|
| 2026-07-14 | Repository inspection | Empty directory; `git status` reported not a repository | Confirmed | Codex |
| 2026-07-14 | Kickoff documentation | README, AGENTS, PRD, Architecture, Contracts, Safety, Test Plan, Demo Runbook, Decisions, Progress | Complete | Codex |

## MVP definition of done

All of the following must be true:

- Every functional/safety item above required by the PRD is complete with evidence.
- Day 1 risks, critical Playwright flow, 25-paraphrase plus negative/safety evaluation, failure matrix, and five consecutive live runs pass.
- No uncontrolled recipient, stale overwrite, duplicate external action, hidden fallback, unknown adapter input, or unresolved delivery outcome appears in a passing run.
- Reset restores Calendar/local state and explicitly retains sent mail.
- Final docs/commands match the code and work on a clean checkout.
- The recorded demo and submission claims stay inside the controlled boundary.
