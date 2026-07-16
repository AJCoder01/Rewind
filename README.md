# Rewind

> Record why an approved AI action was taken, then repair only the recorded consequences invalidated by later context.

**Tagline:** Correct the cause, not every consequence.

Rewind is a hackathon MVP for dependency-aware recovery of workplace actions executed by an AI agent. It previews the assumptions and external effects of a task, records the approved dependency lineage, and later proposes a human-reviewed repair when new context invalidates an assumption.

The first demonstration is deliberately narrow: one team-owned Google Calendar, one team-owned Gmail sender, two seeded Acme renewal events, and one parent-account risk brief.

## Status

| Field | Value |
|---|---|
| Phase | G2 — OAuth, provider, and model risk retirement |
| Implementation | G1 S019–S030 closed; S031–S034 OAuth/provider boundaries complete; S035 is next |
| Repository at kickoff | Documentation-only kickoff; now superseded by the scaffold below |
| Repository now | `main` tracks `origin/main` at `https://github.com/AJCoder01/Rewind.git` |
| Last updated | 2026-07-16 |

The initial executable slice now exists. It supports fixture-backed local development, signed dashboard sessions, one authenticated backend application service, the thin `create_world_pr` MCP client, a reviewable World PR, and a verified PostgreSQL foundation. S031 adds the fail-closed Google OAuth transaction boundary and the numbered `0002_oauth_transaction` migration; S032 adds local signed-identity, exact-scope, account-binding, and encrypted-refresh validation; S033 closes the OAuth negative suite; and S034 freezes explicit provider ports with deterministic fakes. Live consent, provider token exchange/refresh, and all Calendar/Gmail/model effects remain gated behind later G2 tasks. S013 adds locked CI coverage, reachable-history secret scanning, dependency auditing, production fake-mode rejection, and an isolated ephemeral-migration replay job; S014–S017 freeze controlled content, executable traceability, golden contracts, and current-surface accessibility/testability. Verified locally with Node 24: `npm run build`, `npm run lint`, `npm run typecheck`, `npm test`, `npm run test:e2e`, `npm audit --audit-level=moderate`, `npm run security:scan`, `npm run traceability:check`, and `npm run verify:fake-production`.

S019–S027 extend this slice with session expiry, CSRF/origin and resource scope checks, transactional idempotency and planning leases, rule-first clarification, thin status/cancel routes, a read-only MCP status tool, safe loading/error/empty UI states, and a tested cancel/back flow. The fixture path remains visibly non-effecting and production rejects fake-provider mode.

The implemented first slice is:

```text
Codex MCP create_world_pr call
→ authenticated backend request
→ persisted World PR record
→ authenticated dashboard review page
```

Calendar, Gmail, recovery, rules, and animation remain deferred until their provider/model risk gates are closed.

## Product in one minute

1. A Sales Ops coordinator asks Rewind to move an Acme renewal meeting, create an Acme parent-account risk brief, and notify attendees.
2. Rewind finds Acme UK and Acme US. It ranks Acme UK as the nearest upcoming tagged match and shows Acme US as an alternative.
3. GPT proposes the bounded assumption/dependency reasoning and account brief; validation expands it into an immutable World PR containing the exact event, time, recipients, brief content/hash/provenance, and dependencies.
4. After approval, Rewind persists that exact brief, updates the UK event, and then emails its allowlisted attendees.
5. After execution, the coordinator manually pastes a late Sales clarification that Acme US was intended.
6. Rewind proposes a Causal Revert: restore the UK event, correct the UK email, preserve the region-independent brief, and apply the approved change to the US event and attendees.
7. The coordinator approves the exact recovery plan.
8. Rewind proposes a scoped guardrail. Once separately confirmed, the next ambiguous request goes through normal intake and returns a clarification record before any plan, action, or effect-bearing lock.

## What is actually novel

Rewind is not chronological undo. It uses dependency lineage recorded before execution to answer:

> Which recorded consequences became invalid when this approved assumption changed?

It distinguishes reversible state (`restore`), irreversible communication requiring compensation (`correct`), still-valid work (`preserve`), and new approved work against the corrected target (`apply`).

This MVP does **not** discover complete real-world causality and cannot recover arbitrary actions performed outside Rewind.

## Safety and reliability priorities

1. Safety and correctness of external effects
2. End-to-end demo reliability
3. Product clarity
4. Visual polish
5. Technical depth
6. Extensibility

No demo shortcut may weaken recipient allowlisting, human approval, stale-state detection, idempotency guards, or honest failure reporting.

## MVP boundary

Included:

- Dashboard and Codex MCP task creation through the same backend service
- Exactly two seeded, non-recurring, organizer-owned Calendar events
- One visible entity assumption and its recorded action dependencies
- One immutable initial approval and one immutable recovery approval
- Real Calendar updates and real Gmail sends to team-controlled recipients
- Per-action snapshots, receipts, conflict detection, and resumable execution
- A fixed four/five-node causal visualization
- One typed, Acme-scoped prevention rule
- An honest, separately planned/approved demo-state reset; sent mail remains

Excluded:

- Generic tool interception or universal rollback
- Actions that did not run through Rewind
- CRM, Slack, Notion, ticketing, or mailbox-reading integrations
- Recurring/all-day events, shared calendars, arbitrary recipients, or production data
- Automatic recovery, automatic rule activation, plan editing, multi-user accounts, billing, analytics, or mobile apps
- Generic conflict rebasing, compensation DSLs, dynamic graph layout, or multi-agent orchestration

## Intended repository shape

```text
Rewind/
├── app/                    # Next.js pages and route handlers
├── components/             # World PR, timeline, recovery, rule UI
├── lib/
│   ├── contracts/          # Zod schemas and action-template registry
│   ├── domain/             # State machine and invariants
│   ├── services/           # Application use cases
│   ├── ai/                 # Versioned prompts and Responses API calls
│   ├── adapters/           # Explicit Calendar, Gmail, artifact operations
│   ├── db/                 # PostgreSQL access and migrations
│   └── auth/               # Dashboard session and MCP authentication
├── mcp/                    # Thin create_world_pr MCP server
├── scripts/                # Seed, preflight, and reset commands
├── evals/                  # 25 correction paraphrases, safety fixtures, grading
├── tests/                  # Unit, integration, and E2E tests
└── docs/                   # Project source of truth
```

Keep this as one package until a real deployment constraint proves otherwise.

## Documentation map

Read these in order:

1. [Product requirements](docs/PRD.md) — canonical product scope, flows, requirements, and acceptance criteria.
2. [Safety and privacy](docs/SAFETY.md) — non-negotiable approval, OAuth, data, and external-effect constraints.
3. [Architecture](docs/ARCHITECTURE.md) — runtime design, data model, state, and failure semantics.
4. [Contracts](docs/CONTRACTS.md) — MCP, HTTP, model, action, and error interfaces.
5. [Test plan](docs/TEST_PLAN.md) — how every critical claim is proved.
6. [Demo runbook](docs/DEMO_RUNBOOK.md) — seed data, preflight, narration, and reset.
7. [Decisions](docs/DECISIONS.md) — accepted trade-offs, rejected options, and open decisions.
8. [Implementation plan](docs/IMPLEMENTATION_PLAN.md) — the single sequential `S001`–`S103` execution queue and gates.
9. [S007 Supabase guide](docs/S007_SUPABASE_GUIDE.md) — the manual, credential-safe database provisioning procedure.
10. [S009 Vercel guide](docs/S009_VERCEL_GUIDE.md) — the manual, credential-safe deployment checkpoint.
11. [S010 Google guide](docs/S010_GOOGLE_GUIDE.md) — the manual, no-live-effect Google Cloud prerequisite checkpoint.
12. [S011 OpenAI guide](docs/S011_OPENAI_GUIDE.md) — the manual, sanitized model-access checkpoint.
13. [S012 private environment guide](docs/S012_PRIVATE_ENVIRONMENT_GUIDE.md) — the manual, secret-safe environment and startup-validation checkpoint.
14. [Progress](docs/PROGRESS.md) — live phase-gate checklist and evidence links.
15. [Agent instructions](AGENTS.md) — durable implementation rules for Codex and contributors.
16. [S028 deployed G1 guide](docs/S028_DEPLOYED_G1_GUIDE.md) — the credential-safe human checkpoint for the deployed non-effecting slice.
17. [G1 interface packet](docs/G1_INTERFACE_PACKET.md) — the frozen schemas, migration/catalog, error matrix, fixtures, routes, and evidence boundary.

Source-of-truth rule: the PRD owns **what**, Safety owns constraints that cannot be traded away, Architecture owns **how**, Contracts own boundary shapes, and the Implementation Plan owns the exact implementation sequence and gates. Executable schemas/tests become canonical for exact fields once implemented. Progress and the runbook never create new requirements.

## Planned stack

- Next.js, React, TypeScript, Tailwind CSS, and restrained Framer Motion
- Next.js route handlers and PostgreSQL from the foundation phase
- Zod as the shared validation layer
- OpenAI Responses API with strict Structured Outputs and a model selected through `OPENAI_MODEL`
- `gpt-5.6-sol` as the initial model candidate, subject to the provider/model risk-gate access and schema smoke test
- Google Calendar API with `calendar.events.owned`
- Gmail API with `gmail.send`; no mailbox reading
- Official TypeScript MCP SDK with one primary tool: `create_world_pr`
- Vitest, React Testing Library where useful, and mandatory Playwright coverage of the critical flow

Current OpenAI documentation lists GPT-5.6 Sol as supporting the Responses API and Structured Outputs. The model name remains configuration, not a hard-coded product invariant. See [OpenAI models](https://developers.openai.com/api/docs/models), [Structured Outputs](https://developers.openai.com/api/docs/guides/structured-outputs), and [text generation guidance](https://developers.openai.com/api/docs/guides/text?api-mode=responses).

## PostgreSQL foundation

After configuring the two private database URLs described in the [S007 Supabase guide](docs/S007_SUPABASE_GUIDE.md), run:

```text
npm run db:migrate
npm run db:verify
```

The migration command applies `0001_phase0_foundation.sql` and then `0002_oauth_transaction.sql` atomically/repeatably; each reviewed checksum and catalog must match. The database verification command performs read-only catalog/privilege checks plus constraint probes inside a transaction that always rolls back. `GET /api/health` is process liveness; `GET /api/ready` returns a sanitized `200` only when the restricted TLS runtime connection and exact foundation/OAuth schemas are ready. Google OAuth start/callback routes remain fail-closed unless configuration, transaction, signed-identity, exact-scope, and provider response checks pass.

## First contributor actions

1. Start at `S035` in the [master implementation plan](docs/IMPLEMENTATION_PLAN.md): implement controlled Calendar discovery and seeding under the G2 safety gate.
2. Continue in numeric order; do not skip a red gate.
3. Record command output and sanitized evidence in `PROGRESS.md` as each task closes.

Do not begin Calendar, Gmail, Causal Revert, or animation work until the vertical-slice gate is green.
