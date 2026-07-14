# Rewind decision log

| Field | Value |
|---|---|
| Status | Active |
| Format | Lightweight ADRs |
| Last updated | 2026-07-14 |

This file records why a decision was made and which choices remain open. Accepted behavior must also appear in the canonical PRD, Safety, Architecture, or Contracts document; this log alone does not define runtime behavior.

## Status vocabulary

- **Accepted:** current MVP decision; implementation should follow it.
- **Proposed:** recommended but awaiting a named owner or required phase-gate proof.
- **Superseded:** retained for history; replacement is named.
- **Rejected:** considered and not selected.

## Index

| ID | Decision | Status |
|---|---|---|
| ADR-001 | Frame the trigger as late-arriving context | Accepted |
| ADR-002 | Define “causal” as approved recorded lineage | Accepted |
| ADR-003 | Put safety/correctness above visual polish | Accepted |
| ADR-004 | Lock one single-tenant controlled effect-bearing scenario | Accepted |
| ADR-005 | Make the artifact genuinely region-independent | Accepted |
| ADR-006 | Allow ranked UK selection before a rule, with visible alternative/evidence | Accepted |
| ADR-007 | Use one package: Next.js app plus thin MCP process | Accepted |
| ADR-008 | Use PostgreSQL from the foundation phase | Accepted |
| ADR-009 | Bind approval to immutable versioned plan digests | Accepted |
| ADR-010 | Use a durable per-action saga/ledger | Accepted |
| ADR-011 | Use Calendar ETag conflict checks and narrow start/end writes | Accepted |
| ADR-012 | Use direct Gmail send with at-most-once/uncertain semantics | Accepted |
| ADR-013 | Keep AI proposals inside deterministic closed-world validation | Accepted |
| ADR-014 | Separate existing recovery outcomes from new Apply actions | Accepted |
| ADR-015 | Use one typed Acme rule and `clarification_required` | Accepted |
| ADR-016 | Rename and constrain reset to “Reset demo state” | Accepted |
| ADR-017 | Make date/time zone/duration explicit | Accepted |
| ADR-018 | Require authenticated dashboard/MCP trust boundaries | Accepted |
| ADR-019 | Configure and record the model; do not hard-code product behavior to a name | Accepted |
| ADR-020 | Keep deterministic fallback off during recorded proof | Accepted |
| ADR-021 | Make Playwright/live/eval gates mandatory | Accepted |
| ADR-022 | Use npm scripts in the single root package | Accepted |

## Accepted decisions

### ADR-001 — Frame the trigger as late-arriving context

**Decision:** Replace “the world changed” as the literal demo explanation with “relevant context arrived after execution” or “late information invalidated a reasonable assumption.” The user manually pastes the Sales clarification.

**Why:** “I meant Acme US” is a delayed clarification of intent, not necessarily an external-world change. Precise wording removes an easy credibility objection and avoids implying Slack/mail monitoring.

**Consequence:** The broad vision may still cover changed external facts later, but this demo proves post-execution context correction only.

### ADR-002 — Define “causal” as approved recorded lineage

**Decision:** Rewind records dependency edges in the approved World PR and uses them during recovery. It does not claim to infer full causality from arbitrary logs.

**Why:** The recovery quality depends on the plan's dependency truth. This boundary makes the technical claim testable and honest.

**Consequence:** Only actions routed through Rewind and represented in the approved plan are recoverable.

### ADR-003 — Put safety/correctness above visual polish

**Decision:** Trade-off order is safety/correctness, demo reliability, clarity, polish, depth, extensibility.

**Why:** A product that changes calendars and emails people cannot rank visual polish above the correctness of external effects.

**Consequence:** A conflict or uncertainty may stop the demo; it may never be styled as success.

### ADR-004 — Lock one single-tenant controlled effect-bearing scenario

**Decision:** One Google identity, one owned calendar, exactly two tagged one-off events, one operator, one active effect-bearing scenario, and allowlisted team recipients. Active-rule evaluation happens before lock acquisition, so a clarification-only intake may coexist without a plan/action/lock.

**Why:** It is the smallest surface that can prove the interaction with real providers in the compressed MVP cycle.

**Consequence:** Recurring/all-day/shared events, arbitrary recipients, multiple tenants, and production data are rejected, not “best effort.”

### ADR-005 — Make the artifact genuinely region-independent

**Decision:** Rename the generic “renewal risk summary” to an Acme parent-account risk brief generated during planning only from one versioned company-wide synthetic source. Validate output against regional/event/attendee/time leakage, show exact content, bind source/content hashes into the plan, and persist those approved bytes without regeneration.

**Why:** A normal renewal summary likely depends on region, making `preserve` contrived or unsafe. Recorded independent inputs make preservation causally credible.

**Consequence:** If event/region/attendee/time enters artifact input or output, or stored bytes differ from the approved content hash, recovery validation must reject `preserve`.

### ADR-006 — Allow ranked UK selection before a rule, with visible alternative/evidence

**Decision:** Initially, no “always confirm region” rule exists. Rewind ranks UK because it is the nearest upcoming tagged match on the configured demo date, displays both UK and US, and requires World PR approval. The later active rule changes policy to clarification-first. No “recently referenced” signal is used because the approved integrations do not supply one.

**Why:** Without visible evidence, a safety product should ask immediately and the demo's initial error looks negligent. The decision preserves the post-execution story while showing why the original approval was reasonable.

**Consequence:** The World PR must make the alternative and absence of the rule visible. This is a controlled product policy, not a general confidence algorithm.

### ADR-007 — Use one package: Next.js app plus thin MCP process

**Decision:** Keep pages, route handlers, domain/services/adapters, tests, and a thin stdio MCP entry in one TypeScript package.

**Why:** Shared schemas and application services matter more than monorepo isolation for this compressed MVP build.

**Consequence:** No workspace/package split unless deployment proves it necessary.

### ADR-008 — Use PostgreSQL from the foundation phase

**Decision:** Use PostgreSQL for local/deployed state; do not plan a later SQLite-to-Postgres migration.

**Why:** Immutable plans, unique action keys, scenario locks, leases, and deployed persistence are core reliability mechanisms.

**Consequence:** Selecting/provisioning the provider is a Phase 0 open decision, but the database type is not.

### ADR-009 — Bind approval to immutable versioned plan digests

**Decision:** Store plans as immutable versioned payloads and bind approval to a SHA-256 canonical digest, actor, and timestamp.

**Why:** Task-level “approved” status cannot prove which recipients, content, targets, or provider versions the user authorized.

**Consequence:** Any relevant change creates a new plan version and approval. `approved` is an event/record, not a long-lived task state.

### ADR-010 — Use a durable per-action saga/ledger

**Decision:** Persist one unique row for every approved action with before/desired/after state, status, attempts, lease, receipt, and redacted error. Persist before and after each external call.

**Why:** Calendar, Gmail, OpenAI, and PostgreSQL cannot form one atomic transaction. Task-level status alone cannot prevent duplicate or hidden partial execution.

**Consequence:** The UI includes partial, retryable, uncertain, conflict, and permanent states. Resume skips succeeded actions and only retries known-safe work. An expired in-progress Calendar action is reconciled against remote state; an expired in-progress Gmail send becomes delivery-uncertain.

### ADR-011 — Use Calendar ETag conflict checks and narrow start/end writes

**Decision:** Save preview/before/after ETags; refetch before execution/recovery; use `If-Match`; change/restore only start/end; disable Calendar attendee email with `sendUpdates=none`.

**Why:** Blind snapshot replay could erase a legitimate later edit or send duplicate provider notifications.

**Consequence:** Any drift fails closed. Generic rebasing is explicitly excluded.

### ADR-012 — Use direct Gmail send with at-most-once/uncertain semantics

**Decision:** Request only `gmail.send`, send deterministic approved MIME once, prevent application replay, persist `dispatch_started_at` before transport handoff, and mark every ambiguous post-handoff failure `delivery_uncertain` with no automatic retry. Only local failures proven before the marker are retryable; explicit non-timeout 4xx rejection is permanent.

**Why:** `gmail.compose` would enable draft-based reconciliation but is a broader restricted scope. Least privilege wins for the controlled demo.

**Consequence:** Rewind cannot always determine whether a timed-out send arrived. It must stop honestly rather than claim exactly-once delivery.

### ADR-013 — Keep AI proposals inside deterministic closed-world validation

**Decision:** The model performs the four promised reasoning jobs inside closed universes: propose the initial assumption and dependency edges, classify recovery, and propose the one typed guardrail; it also drafts the account brief from fixed source facts. Deterministic code supplies/ranks candidate facts, requires the seeded UK winner and complete valid dependency map, owns IDs/recipients/time/templates/provider calls, validates artifact output and every proposal, then expands exact actions.

**Why:** Strict schema alone cannot prove an entity, recipient, dependency, or action is valid.

**Consequence:** The model contribution is meaningful but bounded. Unknown/duplicate/omitted/incompatible output is rejected. Retry once, then show a safe failure.

### ADR-014 — Separate existing recovery outcomes from new Apply actions

**Decision:** Existing succeeded actions receive only `restore | correct | preserve`. `apply` is a UI grouping for new allowlisted US actions and is never attached to an existing action ID.

**Why:** The original recovery schema mixed classifications of past effects with creation of future actions.

**Consequence:** Model and API schemas use `executedActionId` for decisions and a separate `newActions` array.

### ADR-015 — Use one typed Acme rule and `clarification_required`

**Decision:** Support one executable predicate for Acme company/region ambiguity. It is proposed after recovery, separately activated, and evaluated in normal intake after candidate lookup but before selection, plan generation, or effect-bearing lock acquisition.

**Why:** A free-form string cannot safely drive a rule engine, and applying the rule after selection would not prevent the same failure.

**Consequence:** The task state includes a renderable persisted `clarification_required` payload with candidates but no plan/action/lock. The proof uses normal `POST /world-prs`, not a test-only rule endpoint; no generic rules dashboard or cross-company learning claim.

### ADR-016 — Rename and constrain reset to “Reset demo state”

**Decision:** Reset has its own immutable two-event plan/digest and separate approval. Semantic baselines exclude ETags; rolling expected ETags update after every write. Reset preflights both events before writing, conditionally restores, reports a race/partial result honestly, and only after full verification archives/releases local scenario state, removes/deactivates the rule/artifact, and creates a new run ID. It retains sent mail and audit evidence.

**Why:** Sent email cannot be undone or erased from recipient inboxes by the application.

**Consequence:** UI/API require exact reset-plan approval and acknowledgement that sent mail remains. A partial reset retains the lock and needs a new plan. Unique run IDs distinguish repeated messages.

### ADR-017 — Make date/time zone/duration explicit

**Decision:** Use one configurable future `DEMO_DATE`, explicit “3:00 PM ET,” `America/New_York`, and a fixed preserved 30-minute duration.

**Why:** “3 PM” creates a second ambiguity involving date, time zone, and duration.

**Consequence:** All-day/recurring/missing-time-zone input is outside the demo boundary.

### ADR-018 — Require authenticated dashboard/MCP trust boundaries

**Decision:** Dashboard approval requires a secure authenticated session and CSRF protection; MCP uses a scoped create/read bearer token; IDs/URLs are not authorization.

**Why:** An enumerable/forwarded review link cannot be allowed to trigger calendar/mail effects.

**Consequence:** A minimal demo gate is required even though user accounts/RBAC are excluded.

### ADR-019 — Configure and record the model

**Decision:** Use `OPENAI_MODEL`, initially target `gpt-5.6-sol`, and record actual model/prompt/schema/reasoning metadata per plan. The provider/model risk gate verifies project access and strict output.

**Why:** Model availability and aliases change; product contracts should depend on validated schemas, not a marketing name hard-coded throughout code.

**Consequence:** A model/config change reruns all eval gates and creates new plan metadata.

### ADR-020 — Keep deterministic fallback off during recorded proof

**Decision:** An isolated scenario fallback may exist only behind a disabled development flag for validator/failure testing. It cannot silently run or be represented as model reasoning in the recorded demo.

**Why:** Hidden fallback would undermine the claimed model contribution and violate honest-failure rules.

**Consequence:** Two invalid model attempts produce a visible safe failure during the live flow.

### ADR-021 — Make Playwright/live/eval gates mandatory

**Decision:** Keep the source brief's minimum of 24/25 correct correction paraphrases, adopt 25/25 as the team's explicit recording target, require a separate 100%-passing negative/safety suite with zero unsafe adapter calls, plus the critical Playwright flow, provider/model risk spikes, and five consecutive live rehearsals.

**Why:** “If feasible” test coverage conflicts with a demo whose central claim is reliable external recovery.

**Consequence:** Feature freeze and recording are blocked until these gates are evidenced.

### ADR-022 — Use npm scripts in the single root package

**Decision:** Use npm and one root `package.json` for setup, dev, lint, typecheck, unit, E2E, eval, seed, preflight, and reset commands.

**Why:** npm is universally available with Node and avoids adding package-manager/workspace decisions to a one-package hackathon build.

**Consequence:** README/AGENTS commands remain planned until the package is scaffolded and each script has been run successfully.

## Rejected alternatives

| Alternative | Status | Reason |
|---|---|---|
| “The world changed” as the literal Acme story | Rejected | Demo shows delayed clarification; broader wording overclaims |
| Hide the alternative US event | Rejected | Makes UK selection look arbitrary and weakens approval credibility |
| Ask for region on the first run without any learned-policy contrast | Rejected for this demo | Eliminates the failure/recovery proof; future active rule does require it |
| Region-specific risk summary preserved by user instruction | Rejected | User preference cannot prove causal independence |
| Generic `RewindableAction`/compensation interface | Rejected | Obscures irreversible mail vs reversible Calendar semantics and expands scope |
| SQLite first, migrate later | Rejected | Midweek persistence/concurrency migration risks the demo |
| Full Calendar snapshot overwrite on restore | Rejected | Can destroy legitimate changes and unsupported fields |
| Gmail drafts with `gmail.compose` | Rejected for MVP | Better limited reconciliation, but broader restricted mailbox scope |
| Automatic retry of timed-out Gmail send | Rejected | Can duplicate irreversible communication |
| Free-form executable prevention-rule condition | Rejected | Unsafe and unnecessary for one scenario |
| Automatic rule activation | Rejected | One correction is insufficient authority to change future behavior |
| Task status `rule_created` | Rejected | Rule lifecycle should not overwrite recovered task state |
| Dynamic graph library | Rejected | Fixed four/five-node visual is clearer and more reliable |
| Hidden deterministic recovery fallback | Rejected | Misrepresents model use and masks failure |

## Open decisions

Resolve these by the gate shown. Record the answer, date, and evidence here; update canonical docs if behavior changes.

| ID | Decision | Due | Status/evidence |
|---|---|---|---|
| OPEN-001 | `main` tracks `origin/main` at `https://github.com/AJCoder01/Rewind.git` | Complete | Resolved 2026-07-14; initial commit `5efe0b5` pushed |
| OPEN-002 | Node.js 24 LTS, locally pinned to `24.18.0`; deployments use the latest supported `24.x` patch | Complete | Resolved 2026-07-14; `.nvmrc`, package engines, and Node 24 verification |
| OPEN-003 | Vercel Functions with Fluid Compute in Mumbai (`bom1`); synchronous routes must finish within the configured limit or fail closed | Complete | Resolved 2026-07-14; `vercel.json` and Vercel limits/region documentation |
| OPEN-004 | Supabase Postgres in Mumbai (`ap-south-1`); pooled runtime URL plus separate migration URL | Complete | Resolved 2026-07-14; environment contract and Supabase connection/region documentation |
| OPEN-005 | Single-operator passcode gate, HMAC-signed `HttpOnly` session cookie, same-origin mutation checks, secure production cookie | Complete | Resolved 2026-07-14; auth implementation and unit/E2E tests |
| OPEN-006 | One dedicated team-controlled demo Google identity owns the connected calendar and sender; expected email and OIDC `sub` stay in deployment secrets | Complete | Resolved 2026-07-14; live identity/calendar proof remains a G2 preflight |
| OPEN-007 | External/Testing OAuth audience with only the selected demo identity as test user; reauthorize within 24 hours of final recording | Complete | Resolved 2026-07-14; conservative path for the selected identity |
| OPEN-008 | One team-controlled UK inbox and one team-controlled US inbox; literal addresses stay only in the structured deployment secret and are reconfirmed before live send | Complete | Resolved 2026-07-14; live inbox-control proof remains a G2 preflight |
| OPEN-009 | `DEMO_DATE=2026-08-20`; UK 10:00–10:30 ET, US 11:00–11:30 ET, target 15:00–15:30 ET | Complete | Resolved 2026-07-14; fixture and runbook use the same date/baselines |
| OPEN-010 | Verify configured OpenAI model access and strict output; choose the lowest reasoning effort that passes evaluation | G2 | Open; scheduled by `S011` and `S040`–`S045` |
| OPEN-011 | Freeze the exact short company-wide synthetic account-note fixture with no regional input | G0 | Open; scheduled by `S014` |
| OPEN-012 | Use one canonical sequential implementation queue with no person-specific task lanes | Complete | Superseded 2026-07-14; `IMPLEMENTATION_PLAN.md` now owns `S001`–`S103` in order |
| OPEN-013 | Sanitized Markdown in `artifacts/test-runs/`; raw logs/screenshots ignored; private provider receipts remain outside Git | Complete | Resolved 2026-07-14; tracked evidence index and `.gitignore` policy |

### Phase 0 resolution notes

- **Runtime and deployment:** Node.js `24.18.0` is the clean-checkout development pin. Vercel uses its latest supported `24.x` patch, Fluid Compute, and one Mumbai function region. Hobby's current five-minute maximum is sufficient for the short persisted MVP sagas; effect routes must declare and test a bounded `maxDuration` before G3. See [Vercel Function limits](https://vercel.com/docs/functions/limitations), [regions](https://vercel.com/docs/regions), and [supported Node.js versions](https://vercel.com/docs/functions/runtimes/node-js/node-js-versions).
- **Database:** Supabase Mumbai is co-located with the application. `DATABASE_URL` is the TLS Supavisor transaction-pool URL for serverless traffic; `DATABASE_MIGRATION_URL` is the direct or session-pool URL used only by the migration command. See [Supabase regions](https://supabase.com/docs/guides/platform/regions) and [database connections](https://supabase.com/docs/guides/database/connecting-to-postgres).
- **Google and recipients:** literal email addresses, the expected Google `sub`, OAuth secrets, refresh-token ciphertext, token-encryption key, Calendar ID, and the structured `{UK,US}` recipient mapping never enter Git. G2 must prove account/calendar ownership and inbox control before any live write or send.
- **Evidence:** committed Markdown contains commands, counts, redacted identifiers, and risks only. Full provider receipts remain access-controlled outside Git; the repository stores only redacted references or hashes.

### Resolution template

When closing an open item, add a dated note:

```text
OPEN-NNN — Resolved YYYY-MM-DD
Decision:
Evidence:
Canonical docs/code updated:
```
