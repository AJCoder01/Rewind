# Rewind MVP progress

| Field | Value |
|---|---|
| Status | Live checklist |
| Current phase | Phase 0 — alignment and engineering foundation; implementation not started |
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
- [x] Kickoff documentation set and phase-based async implementation plan created.
- [x] Git repository initialized and remote configured. Evidence: `main` tracks `origin/main` at `https://github.com/AJCoder01/Rewind.git`; initial docs commit `5efe0b5`.
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

## Implementation phase tracker

Detailed Person A/Person B tasks, async handoffs, subagent lanes, merge order, and exit criteria live in `IMPLEMENTATION_PLAN.md`. This file tracks status and evidence without duplicating that plan.

| Phase | Gate | Person A — Platform & Safety | Person B — Product, AI & Quality | Status | Evidence |
|---|---|---|---|---|---|
| 0. Alignment and foundation | G0 | Decisions, scaffold, runtime, PostgreSQL, CI | Traceability, fixtures, UI-state inventory | In progress | Git/remote complete; remaining evidence TBD |
| 1. Non-effecting vertical slice | G1 | Contracts, persistence, auth, API, MCP | Composer/review shell, client parsing, Playwright | Not started | TBD |
| 2. Provider/model risk retirement | G2 | OAuth, Calendar/Gmail primitives, live spikes | Responses client, strict schemas, eval harness | Not started | TBD |
| 3. Initial World PR | G3 | Exact plan/approval and artifact→Calendar→Gmail saga | Initial reasoning, World PR, approval/timeline UX | Not started | TBD |
| 4. Causal Revert | G4 | Recovery validation/approval/execution/resume | Recovery prompt/evals and causal UX | Not started | TBD |
| 5. Guardrail and reset | G5 | Rule engine, clarification lock, reset saga | Guardrail/clarification/reset UX | Not started | TBD |
| 6. Hardening and evidence | G6 | Security, provider failures, deployment, live runs | E2E, eval, accessibility, evidence/runbook | Not started | TBD |
| 7. Submission and cleanup | G7 | Final preflight, monitoring, revocation/retention | Video, screenshots, narrative, public-claim review | Not started | TBD |

### Current phase actions

- [ ] Resolve `OPEN-012` with the actual Person A and Person B names.
- [ ] Resolve remaining Phase 0 provider/runtime/account/evidence decisions.
- [ ] Scaffold the single package and verify fast root commands.
- [ ] Merge the minimal `contracts.v1` and durable migration packet.
- [ ] Merge golden/traceability fixtures after the contract packet.
- [ ] Create isolated worktrees using the path ownership in `IMPLEMENTATION_PLAN.md` before Phase 1 branches diverge.
- [ ] Record Gate G0 commands and sanitized evidence here.

## Current blockers and owners

| Blocker | Impact | Owner | Next action | Status |
|---|---|---|---|---|
| Team roles unassigned | No accountable two-person workstream ownership | Team lead | Resolve OPEN-012 | Open |
| Deployment/PostgreSQL providers unselected | Cannot prove callback/persistence | Person A | Resolve OPEN-003/004 | Open |
| Google identity/OAuth audience/allowlist unknown | Calendar/Gmail risk cannot be retired | Person A + team lead | Resolve OPEN-006/007/008 | Open |
| Demo date not selected | Cannot seed stable events | Person B + demo operator | Resolve OPEN-009 | Open |
| OpenAI project/model access unverified | Planner feasibility unknown | Person B + Person A review | Resolve OPEN-010 and live schema smoke | Open |

These are setup decisions, not reasons to begin UI polish. Git/remote setup is already complete. The next actions are owner assignment, scaffold, minimal contract/migration packet, golden fixtures, then the non-effecting vertical slice.

## Verification evidence log

Add entries only after work is actually complete:

| Date | Item | Evidence | Result | Owner |
|---|---|---|---|---|
| 2026-07-14 | Repository inspection | Empty directory; `git status` reported not a repository | Confirmed | Codex |
| 2026-07-14 | Kickoff documentation | README, AGENTS, PRD, Architecture, Contracts, Safety, Test Plan, Demo Runbook, Decisions, Progress, Implementation Plan | Complete | Codex |
| 2026-07-14 | Git remote | `main` pushed to `origin/main`; initial commit `5efe0b5` | Complete | Ayush Jha + Codex |
| 2026-07-14 | Async implementation planning | Phase-based Person A/Person B plan, subagent policy, handoffs, and gates | Complete | Codex |

## MVP definition of done

All of the following must be true:

- Every functional/safety item above required by the PRD is complete with evidence.
- Provider/model risk gate, critical Playwright flow, 25-paraphrase plus negative/safety evaluation, failure matrix, and five consecutive live runs pass.
- No uncontrolled recipient, stale overwrite, duplicate external action, hidden fallback, unknown adapter input, or unresolved delivery outcome appears in a passing run.
- Reset restores Calendar/local state and explicitly retains sent mail.
- Final docs/commands match the code and work on a clean checkout.
- The recorded demo and submission claims stay inside the controlled boundary.
