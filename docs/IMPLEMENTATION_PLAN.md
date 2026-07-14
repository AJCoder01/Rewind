# Rewind implementation plan

| Field | Value |
|---|---|
| Status | Ready for owner assignment and execution |
| Planning model | Dependency-gated phases, not calendar days |
| Team shape | Two asynchronous human owners plus bounded development subagents |
| Current phase | Phase 0 — alignment and engineering foundation |
| Last updated | 2026-07-14 |

This document owns implementation sequencing, ownership, handoffs, and phase gates. It does not override product behavior in `PRD.md`, safety rules in `SAFETY.md`, runtime design in `ARCHITECTURE.md`, or boundary shapes in `CONTRACTS.md`.

## 1. Two-person ownership

`OPEN-012` assigns **Kaustubh Upadhya** to Platform & Safety and **Ayush Jha** to Product, AI & Quality.

| Area | Kaustubh Upadhya — Platform & Safety | Ayush Jha — Product, AI & Quality |
|---|---|---|
| Mission | Make state and external effects correct, durable, authenticated, and recoverable | Make reasoning bounded, plans understandable, UX complete, and quality measurable |
| Root/toolchain | Sole writer for package manifest, lockfile, TypeScript/Next configuration, CI, environment contract | Requests dependency/config changes through Kaustubh Upadhya |
| Backend | HTTP routes, application services, domain state, PostgreSQL, migrations, auth, MCP | Consumes frozen API/read-model contracts |
| Provider effects | OAuth, Calendar, Gmail, artifact persistence, reset, seed/preflight/live scripts | Never calls provider adapters directly |
| Deterministic safety | Plan hashing, idempotency, leases, state transitions, semantic validation, exact plan expansion | Reviews output completeness and supplies adversarial fixtures |
| AI | Reviews every executable field and owns deterministic validation | Owns prompts, Responses client, model-only schemas, retry behavior, artifact generation, and evals |
| Frontend | Reviews API wiring and security boundaries | Owns pages, components, client API, visualization, accessibility, and animation |
| Tests | Domain, contract, database, integration, provider fakes, failure injection, live smoke | AI evals, component tests, Playwright, accessibility, comprehension, evidence |
| Canonical docs | `ARCHITECTURE.md`, `CONTRACTS.md`, `SAFETY.md`, implementation command truth | `PRD.md`, `TEST_PLAN.md`, `DEMO_RUNBOOK.md`, `PROGRESS.md`, evidence curation |

### Exclusive path ownership

Kaustubh Upadhya is the default writer for:

```text
app/api/**
lib/contracts/**
lib/domain/**
lib/services/**
lib/db/**
lib/auth/**
lib/adapters/**
mcp/**
scripts/seed-*
scripts/preflight-*
scripts/reset-*
db/migrations/**
tests/unit/domain/**
tests/contract/**
tests/integration/**
tests/providers/**
package.json and lock/config files
```

Ayush Jha is the default writer for:

```text
app/page.tsx
app/pr/**
app/(product)/**
app/layout.tsx
app/globals.css
components/**
lib/ai/**
evals/**
tests/e2e/**
tests/components/**
tests/fixtures/contracts/**
tests/fixtures/traceability/**
artifacts/test-runs/**
product-facing documentation
```

Kaustubh Upadhya creates the initial root app files during scaffold, then hands `app/page.tsx`, `app/pr/**`, `app/layout.tsx`, and `app/globals.css` to Ayush Jha in one recorded ownership change before UI work begins.

### Shared-document default writers

| File | Default writer | Required review |
|---|---|---|
| `DECISIONS.md`, `ARCHITECTURE.md`, `CONTRACTS.md`, `SAFETY.md` | Kaustubh Upadhya | Ayush Jha reviews product/rendering impact |
| `PRD.md`, `TEST_PLAN.md`, `DEMO_RUNBOOK.md`, `PROGRESS.md` | Ayush Jha | Kaustubh Upadhya reviews safety/runtime claims |
| `README.md`, `AGENTS.md` | Kaustubh Upadhya | Ayush Jha reviews product-facing wording |
| `IMPLEMENTATION_PLAN.md` | Ayush Jha as plan curator | Both owners approve sequencing/ownership changes |

High-conflict files have one writer at a time: package/lock files, migrations, contract barrel exports, `AGENTS.md`, `README.md`, and `PROGRESS.md`. A contract change is a dedicated handoff, not an opportunistic edit in a consumer branch.

## 2. Asynchronous operating protocol

Each phase follows the same event-driven workflow:

1. **Freeze the interface packet.** Merge schemas, migrations, state transitions, and golden success/error fixtures before producer and consumer work diverges.
2. **Work in isolated branches/worktrees.** Use short branches such as `phase-3/a-initial-execution` and `phase-3/b-world-pr-ui`.
3. **Build against fakes at boundaries.** Ayush Jha uses versioned golden HTTP/read-model fixtures while Kaustubh Upadhya builds services and provider adapters. Kaustubh Upadhya uses model-proposal fixtures while Ayush Jha builds the real AI client.
4. **Handoff through artifacts, not assumptions.** Every handoff includes requirement IDs, schema version, fixture paths, commands run, sanitized evidence, known risks, and explicit excluded behavior.
5. **Merge in dependency order.** Contracts/migrations → producers → consumers → wiring → E2E/live evidence.
6. **Run the phase gate.** A phase is complete only when its gate passes; “code finished” is not a completion state.

### Pull-request contract

Every implementation PR states:

- owner and reviewer;
- phase/task IDs;
- covered FR/SAFE/NFR IDs;
- owned paths and any shared-file exception;
- input/output contract version;
- external-effect risk;
- tests and commands run;
- sanitized evidence location;
- remaining blocker or follow-up.

The other person reviews every cross-boundary change. Kaustubh Upadhya has veto authority for external-effect safety; Ayush Jha has veto authority for user-visible claim accuracy and acceptance-evidence integrity. A disputed change remains unmerged until the canonical docs agree.

## 3. Critical path and parallel lanes

```text
Phase 0: foundation + contracts
        ↓
Phase 1: MCP → API → PostgreSQL → dashboard
        ↓
Phase 2: provider/model risk retirement
        ↓
Phase 3: approved initial World PR execution
        ↓
Phase 4: approved Causal Revert
        ↓
Phase 5: guardrail + approved reset
        ↓
Phase 6: hardening + five-run evidence
        ↓
Phase 7: submission + cleanup
```

External setup for PostgreSQL, deployment, Google OAuth, the controlled calendar/recipients, demo date, and OpenAI access starts in Phase 0 because those dependencies can block later gates. Preparatory work for a later phase may start against frozen fixtures, but live behavior and integration claims cannot bypass the preceding gate.

## 4. Phase 0 — Alignment and engineering foundation

### Kaustubh Upadhya tasks

- **P0-A1:** Close the stale Git decision and record the existing `main → origin/main` setup.
- **P0-A2:** Resolve Node, deployment, PostgreSQL, dashboard-auth, Google identity/OAuth, allowlist, demo-date, and evidence-location decisions with named owners.
- **P0-A3:** Scaffold one strict TypeScript/Next.js npm package and pin the runtime.
- **P0-A4:** Add PostgreSQL connectivity/migration runner, health/readiness, redacted logging, and `.env.example` with names only.
- **P0-A5:** Establish fast CI for lint, typecheck, unit tests, secret scanning, and migration validation.
- **P0-A6:** Own package/lock/config files and publish the initial directory/path contract.
- **P0-A7:** Implement and freeze the minimal `contracts.v1` lifecycle/error/create/read schemas before Ayush Jha creates golden fixtures.
- **P0-A8:** Add the minimum durable tables required before any live write: task/plan/idempotency/scenario-lock/audit, action-execution/receipt fields, and `demo_event_state` rolling versions. Later phases may extend but not replace these migrations.
- **P0-A9:** Hand the root product page/layout/global-style paths to Ayush Jha after scaffold and contract fixtures are ready.

### Ayush Jha tasks

- **P0-B1:** Resolve the synthetic account-note fixture, UI state inventory, demo copy, viewport, and evidence format.
- **P0-B2:** Convert FR-01–32, SAFE-01–10, and NFR-01–10 into a traceability fixture consumed by tests/evidence.
- **P0-B3:** After P0-A7 merges, define golden HTTP/read-model fixtures under `tests/fixtures/contracts/v1/**` for loading, clarification, preview, executing, completed, recovery, attention, and reset states.
- **P0-B4:** Store requirement traceability under `tests/fixtures/traceability/**`; never edit Kaustubh Upadhya's `lib/contracts/**` concurrently.
- **P0-B5:** Produce low-fidelity layouts and component boundaries without depending on live services.
- **P0-B6:** Review the scaffold for accessibility/testability and open explicit dependency requests rather than editing root config concurrently.

### Bounded subagent lanes

- **A-subagent:** Audit scaffold/config, migration conventions, and secret/logging defaults. Output a patch or report limited to Kaustubh Upadhya paths.
- **B-subagent:** Build the requirement traceability table and audit UI state coverage against PRD/Contracts. No canonical requirement edits.
- **Reviewer subagent:** Read-only cross-document check after the interface packet is proposed.

### Gate G0

- [x] `OPEN-012` assigns Kaustubh Upadhya and Ayush Jha as the two human owners.
- [ ] All foundation-blocking decisions have owners and evidence.
- [ ] Clean checkout installs, builds, migrates, lints, typechecks, and runs fast tests.
- [ ] No secret is committed or exposed to the client.
- [ ] Scaffold → minimal contracts/migrations → golden fixtures merge in that order before Phase 1 consumers branch.

## 5. Phase 1 — Non-effecting vertical slice

This phase proves the shared path without Calendar, Gmail, or live model calls. Test/development uses a **complete contract-valid fixture plan**; an incomplete placeholder must never be labeled `preview_ready`.

### Kaustubh Upadhya tasks

- **P1-A1:** Implement repositories, contract parsers, and read-model mappers against the frozen Phase 0 schemas/fixtures; any schema delta is a separate reviewed contract PR.
- **P1-A2:** Apply/test the frozen migrations and implement task, plan, idempotency, scenario-lock, and audit repositories.
- **P1-A3:** Implement authenticated dashboard create/read routes and session/CSRF boundary, including the fixture rule-precheck-before-lock path required by G1.
- **P1-A4:** Implement scoped MCP authentication plus `create_world_pr` and optional read status.
- **P1-A5:** Test identical replay, conflicting replay, unauthorized access, scenario busy, and failed-idempotency replay.
- **P1-A6:** Provide a deterministic fixture adapter that returns the complete controlled candidate/plan read model only in test/development.

### Ayush Jha tasks

- **P1-B1:** Build composer, review shell, timeline shell, loading, empty, and safe error states against golden fixtures.
- **P1-B2:** Implement strict API-v1 Zod parsing and reject malformed/unknown read models; top-level envelope versioning is provided by the `/api/v1` route while nested plan/model/rule payloads retain explicit schema versions.
- **P1-B3:** Build Playwright page objects and the compose → review URL → persisted page path.
- **P1-B4:** Test keyboard flow, duplicate click, expired session, unauthorized review URL, and reduced-motion baseline.
- **P1-B5:** Keep fake/provider state visibly labelled in development and impossible to confuse with live evidence.

### Bounded subagent lanes

- **A-subagent:** Generate idempotency/state-transition/database contract tests from the frozen schemas.
- **B-subagent:** Implement isolated loading/error/review components and component tests from fixed fixtures.
- **Reviewer subagent:** Read-only auth and requirement audit of the merged vertical slice.

### Handoff packet

```text
CreateWorldPrRequest
CreateWorldPrResponse
WorldPrView
TaskStatus / AttentionReason / ApiErrorResponse
golden create/read success and error JSON
```

### Gate G1

```text
MCP → authenticated API → PostgreSQL → authenticated dashboard
```

- [ ] Identical creation returns the same resource and conflicting reuse fails.
- [ ] Auth/session/MCP scope tests pass.
- [ ] Minimal browser E2E passes against a complete fixture-backed plan.
- [ ] No live provider/model adapter can run in this phase configuration.

## 6. Phase 2 — Provider and model risk retirement

This gate proves external feasibility before feature integration. It does not require the finished artifact approval flow or product reset UI; those belong to Phases 3 and 5.

### Kaustubh Upadhya tasks

- **P2-A1:** Complete OIDC state/nonce/PKCE, exact callback/claim/account validation, encrypted token storage, and refresh handling.
- **P2-A2:** Define typed Calendar, Gmail, artifact-store, and deterministic fake-adapter interfaces.
- **P2-A3:** Prove tagged Calendar lookup, conditional move/restore, rolling ETags, `sendUpdates=none`, and deliberate conflict while persisting every before/after/receipt/version in the Phase 0 durable tables.
- **P2-A4:** Prove one human-confirmed allowlisted live Gmail success and persist its `dispatch_started_at`/receipt/replay key. Prove explicit rejection and every uncertainty/error class with deterministic transport fakes rather than intentionally creating ambiguous live sends.
- **P2-A5:** Build TTY-gated seed, provider-spike, cleanup, and preflight utilities; refuse CI/production/live-unknown targets.
- **P2-A6:** Through a TTY-gated low-level Calendar spike only, prove two-event preflight, conditional writes, rolling versions, conflict, and injected partial receipts. Do not expose a reset route, archive a scenario, release a product lock, clean up a rule/artifact, or emit `reset_complete`; the full reset workflow belongs to Phase 5.

### Ayush Jha tasks

- **P2-B1:** Implement the Responses API client with `store: false`, strict schema parsing, model metadata, and one bounded retry.
- **P2-B2:** Define versioned initial, recovery, and rule proposal schemas in the model-only boundary.
- **P2-B3:** Test refusal, truncation, malformed output, unknown IDs, semantic rejection, and final safe failure.
- **P2-B4:** Build the 25-paraphrase evaluation harness and separate negative/safety harness with initial fixtures.
- **P2-B5:** Build honest connected/disconnected/preflight UI states without claiming the product workflow works.

### Bounded subagent lanes

- **A-subagent:** Implement deterministic Calendar/Gmail fake adapters and the failure-injection matrix; no live credentials.
- **B-subagent:** Expand adversarial model/eval fixtures and grade them against golden classifications.
- **Reviewer subagent:** Read-only OAuth, Gmail ambiguity, Calendar conflict, and log-redaction audit.

### Gate G2

- [ ] OAuth/account binding and token refresh work in the target environment.
- [ ] Calendar lookup/move/restore/conflict behavior is proven with controlled events.
- [ ] Gmail success and ambiguous-delivery policies are proven with an allowlisted test recipient.
- [ ] Strict model output and semantic rejection are proven live.
- [ ] Fake adapters are test/development-only and deployed live mode fails startup if any fake is selected.
- [ ] Any red OAuth, ETag, Gmail-uncertainty, or strict-output risk blocks Phase 3 integration.

## 7. Phase 3 — Initial World PR and approved execution

### Kaustubh Upadhya tasks

- **P3-A1:** Extend/finalize the Phase 0 plan/action/approval/artifact/demo-event-state tables with product fields and immutable digest behavior; do not replace the already-proven durable receipt/version foundation.
- **P3-A2:** Implement live candidate retrieval, invoke the pre-lock `RuleEvaluatorPort` established in Phase 1 (no active rule exists in the initial run), acquire the lock, validate deterministic UK ranking, and support stale-plan refresh. Persisted rule activation/proof arrives in Phase 5 through the same port.
- **P3-A3:** Validate Ayush Jha's initial reasoning proposal and expand exact safe actions/recipients/times/templates.
- **P3-A4:** Bind approval to the exact immutable plan and create durable action rows before execution.
- **P3-A5:** Execute approved artifact storage → Calendar move → Gmail notification with receipts, leases, reconciliation, cancel, and safe resume.
- **P3-A6:** Store the exact account-brief bytes/hash from the approved plan; the artifact adapter never regenerates content.

### Ayush Jha tasks

- **P3-B1:** Finalize the initial assumption/dependency/account-brief prompt and output schema.
- **P3-B2:** Generate a schema-valid brief during planning and hand exact content/source/content hashes to Kaustubh Upadhya. Kaustubh Upadhya owns deterministic provenance, forbidden-dimension/leakage validation, plan expansion, and byte-equality enforcement.
- **P3-B3:** Build World PR request/entity/alternative/assumption/evidence/dependency/action/brief cards.
- **P3-B4:** Build exact approval/cancel, timeline, receipt, stale-preview, conflict, partial, and uncertain UI states.
- **P3-B5:** Complete initial AI tests, component tests, and browser E2E against deterministic adapters.

### Handoff packet

```text
InitialReasoningProposalV1
→ Kaustubh Upadhya deterministic validator/expander
→ InitialPlanV1
→ WorldPrView
```

### Bounded subagent lanes

- **A-subagent:** Generate digest/idempotency/action-ledger/reconciliation tests from initial-plan fixtures.
- **B-subagent:** Build isolated World PR/timeline components and accessibility tests.
- **Reviewer subagent:** Independently trace FR-01–18 and SAFE requirements to tests/evidence.

### Gate G3

- [ ] FR-01–04 and FR-06–18 pass end to end; FR-05's pre-lock evaluator port remains fixture-covered until Phase 5 proves persisted active-rule behavior.
- [ ] No external action occurs before exact approval.
- [ ] Approval replay creates no duplicate artifact, Calendar mutation, or email.
- [ ] Exact approved brief bytes are persisted unchanged.
- [ ] One controlled live initial flow passes with receipts and no fake substitution.

## 8. Phase 4 — Recovery and Causal Revert

### Kaustubh Upadhya tasks

- **P4-A1:** Implement context/cancel/replan state transitions and explicit corrected-target validation.
- **P4-A2:** Read/validate both provider events before creating an approvable recovery plan.
- **P4-A3:** Validate Ayush Jha's recovery proposal: complete action coverage, compatible outcomes, known targets/templates, no recipient injection.
- **P4-A4:** Expand and hash the exact recovery plan, bind approval, and preflight both Calendar actions before the first recovery write.
- **P4-A5:** Execute UK restore → US move → UK correction → US notification with durable partial/resume/conflict/uncertain behavior.

### Ayush Jha tasks

- **P4-B1:** Finalize the recovery prompt, strict proposal schema, P01–P25 fixtures, and negative/safety suite.
- **P4-B2:** Build context entry, clarification, revision/cancel, exact recovery preview, and approval UX.
- **P4-B3:** Build the fixed Restore/Correct/Preserve/Apply visual, restrained animation, and reduced-motion static state.
- **P4-B4:** Build retryable, conflict, partial, validation-failure, and delivery-uncertain attention UX.
- **P4-B5:** Complete recovery Playwright and approximately five-second comprehension checks.

### Handoff packet

```text
RecoveryProposalV1
→ Kaustubh Upadhya deterministic semantic validator
→ RecoveryPlanV1
→ RecoveryPlanView
```

### Bounded subagent lanes

- **A-subagent:** Generate recovery state/failure/preflight/resume tests from golden plans.
- **B-subagent:** Expand paraphrases/adversarial fixtures and build isolated causal-visual tests.
- **Reviewer subagent:** Red-team unknown IDs, prompt injection, preservation claims, mail correction semantics, and partial recovery.

### Gate G4

- [ ] FR-19–27 pass.
- [ ] At least 24/25 paraphrases pass; recording target is 25/25.
- [ ] Negative/safety suite passes 100% with zero unsafe adapter calls.
- [ ] Complete deterministic recovery E2E and failure matrix pass.
- [ ] One controlled live recovery reaches `recovered` with exact receipts.

## 9. Phase 5 — Prevention guardrail and approved reset

### Kaustubh Upadhya tasks

- **P5-A1:** Implement typed rule proposal persistence, digest activation, and audit events.
- **P5-A2:** Evaluate active rules after candidate lookup but before selection/lock; persist clarification-only intake with no plan/action/lock.
- **P5-A3:** Implement clarification resolution against the recorded candidate set and acquire a free scenario lock only when planning begins.
- **P5-A4:** Implement immutable reset preparation/approval, two-event preflight, conditional writes, rolling ETags, partial-reset state, archive, cleanup, and lock release.

### Ayush Jha tasks

- **P5-B1:** Finalize the bounded rule prompt/schema and rule rationale display.
- **P5-B2:** Build rule proposal/activation, normal-intake Try guardrail, and candidate clarification UX.
- **P5-B3:** Build reset preview/digest, sent-mail acknowledgement, conflict, partial-reset, and completion UX.
- **P5-B4:** Verify copy never claims sent email was undone, deleted, or reset.
- **P5-B5:** Complete rule/reset Playwright, accessibility, and product-quality checks.

### Bounded subagent lanes

- **A-subagent:** Generate rule-precedence, lock-lifecycle, reset-race, and rolling-ETag tests.
- **B-subagent:** Build clarification/reset components and copy/accessibility tests.
- **Reviewer subagent:** Independently audit FR-28–32, reset approval, mail-retention truth, and lock release.

### Gate G5

- [ ] Normal intake returns a renderable clarification record with no plan/action/lock.
- [ ] Rule activation remains separate from recovery approval.
- [ ] Reset preflight conflict causes zero writes.
- [ ] Partial reset remains attention-required with the lock retained.
- [ ] Complete reset restores both semantic baselines, records new ETags, archives the run/proof, removes the rule/artifact, releases the lock, and retains sent mail.

## 10. Phase 6 — Hardening and release evidence

### Kaustubh Upadhya tasks

- **P6-A1:** Run full contract/database/integration/provider/failure/OAuth/auth/CSRF/secret/log-redaction suites.
- **P6-A2:** Verify crash/lease reconciliation, deployment limits, clean-checkout setup, live preflight, and provider receipts.
- **P6-A3:** Own live reliability fixes; safety/correctness blockers take precedence over polish.
- **P6-A4:** Run preflight/admin/provider monitoring and collect redacted provider receipts while Ayush Jha operates the five live product flows. Do not make live manual state edits.

### Ayush Jha tasks

- **P6-B1:** Run full Playwright, eval, component, accessibility, reduced-motion, viewport, and comprehension suites.
- **P6-B2:** Curate sanitized plan digests, receipts, screenshots, evaluation report, and five-run evidence.
- **P6-B3:** Reconcile executable schemas/commands with all canonical docs and update `PROGRESS.md`.
- **P6-B4:** Operate and record five consecutive controlled live product flows while Kaustubh Upadhya monitors provider/preflight state.
- **P6-B5:** Finalize demo runbook, narration, primary screenshot, limitations, and submission copy.

### Bounded subagent lanes

- **A-subagent:** Read-only security/failure audit plus test-gap report; implementation patches remain in exclusive worktrees.
- **B-subagent:** Accessibility, requirement-traceability, evidence-sanitization, and documentation-link audit.
- **Reviewer subagent:** Independent P0/P1 release audit after both workstreams merge.

### Gate G6

- [ ] All verified root commands pass on a clean checkout.
- [ ] P01–P25 and the negative/safety suite pass at the agreed gates.
- [ ] Five consecutive live runs pass without database edits, restart, duplicate effects, hidden fallback, mocks, uncontrolled recipients, or unresolved delivery.
- [ ] No P0/P1 safety or acceptance issue remains.
- [ ] Code, prompts, schemas, seed data, and demo copy are frozen.

## 11. Phase 7 — Submission and cleanup

### Kaustubh Upadhya tasks

- **P7-A1:** Run final clean-checkout/deployment/preflight verification.
- **P7-A2:** Monitor the recorded live run without manual state edits.
- **P7-A3:** Revoke temporary credentials/links and execute the documented retention cleanup after the submission window.

### Ayush Jha tasks

- **P7-B1:** Record and sanitize the under-three-minute video and screenshots.
- **P7-B2:** Publish the narrative, evaluation/five-run summary, limitations, and Codex collaboration note.
- **P7-B3:** Verify all public claims remain inside the controlled MVP boundary.

### Gate G7

- [ ] Kaustubh Upadhya and Ayush Jha jointly approve go/no-go.
- [ ] The recorded flow contains real controlled receipts and no hidden fallback.
- [ ] Public assets contain no tokens, addresses, secrets, or misleading claims.
- [ ] Cleanup/revocation has an owner and recorded completion date.

## 12. Subagent operating rules

Development subagents accelerate implementation; runtime multi-agent orchestration remains outside the Rewind product scope.

### Recommended concurrency

Use two human workstreams plus one bounded implementation/test subagent per person. Start reviewer subagents at a phase gate after writer work is stable. More concurrency is useful only when paths and contracts are isolated.

### Required subagent brief

Every subagent receives:

- `AGENTS.md` and the exact relevant canonical sections;
- one bounded objective and phase/task IDs;
- an exclusive file list and explicit files it must not edit;
- frozen input/output fixtures;
- acceptance commands;
- required evidence format;
- prohibition on secrets and live provider effects.

### Allowed subagent tasks

- generate contract/state-transition/failure tests;
- implement deterministic fake adapters and fixtures;
- expand eval/negative fixtures;
- build isolated UI components, page objects, and tests;
- audit accessibility, redaction, requirement coverage, and documentation consistency;
- independently review migrations, idempotency, Calendar conflicts, Gmail uncertainty, artifact equality, and reset races.

### Prohibited subagent actions

- editing the same schema, migration, lockfile, config, or canonical document concurrently;
- merging or pushing directly to `main`;
- receiving OAuth tokens, API keys, recipient addresses, or live credentials;
- running Calendar/Gmail/reset live commands;
- weakening requirements, safety behavior, tests, or evidence thresholds;
- inventing new product scope or dependencies without human approval.

Only a human runs TTY-gated live commands and approves external effects. Every subagent change has a named human owner and reviewer.

## 13. Additional acceleration mechanisms

- **Git worktrees:** isolate Kaustubh Upadhya, Ayush Jha, and subagent patches without shared working-tree collisions.
- **Contract-first fixtures:** unblock UI, AI, and service work before live integrations are ready.
- **Generated types/fixtures:** derive TypeScript/read-model helpers from canonical Zod schemas instead of duplicating shapes.
- **Deterministic fake adapters:** make failure and state tests fast and repeatable; keep them impossible in deployed live mode.
- **Risk-first spikes:** retire OAuth, Calendar ETag, Gmail ambiguity, and strict model output before feature integration.
- **Small ordered PRs:** contracts/migrations, producer, consumer, wiring, then evidence; avoid long-lived frontend/backend branches.
- **Parallel CI lanes:** run fast lint/type/unit/contract tests first, then integration, Playwright, eval, and explicitly gated live tests.
- **Fixture and prompt versioning:** make async handoffs reproducible and prevent silent consumer drift.
- **Single evidence index:** Ayush Jha curates sanitized outputs in one location; Kaustubh Upadhya supplies receipts without editing the index concurrently.
- **Stop-the-line gates:** any unsafe external-effect ambiguity or canonical-doc conflict pauses integration until reconciled.

## 14. Definition of implementation complete

- [ ] Every phase gate G0–G7 has evidence and both owners' approval.
- [ ] All PRD functional/safety/non-functional requirements are traced to code and tests.
- [ ] External effects are exact-approved, allowlisted, conditional, durable, and honestly reported.
- [ ] Model outputs remain inside closed schemas and deterministic semantic validation.
- [ ] The complete live flow passes five consecutive times.
- [ ] Final docs, commands, schemas, migrations, and deployment behavior agree.

Live status and evidence belong in [PROGRESS.md](PROGRESS.md); exact schemas belong in [CONTRACTS.md](CONTRACTS.md); test definitions belong in [TEST_PLAN.md](TEST_PLAN.md).
