# Rewind project instructions

These instructions apply to the entire repository. Keep them concise enough to remain useful in every coding session.

## Mission

Build the smallest polished and reliable proof that Rewind can record why approved agent actions were taken and propose a reviewed repair when later context invalidates an assumption.

This is a controlled, single-tenant hackathon demonstration. Do not represent it as universal undo, full causal inference, exactly-once distributed execution, or production-ready agent safety.

## Priority order

1. Safety and correctness of external effects
2. End-to-end demo reliability
3. Product clarity
4. Visual polish
5. Technical depth
6. Extensibility

Safety constraints are requirements, not trade-offs.

## Source of truth

- `docs/PRD.md` owns product scope, terminology, behavior, and acceptance criteria.
- `docs/SAFETY.md` owns non-negotiable approval, auth, OAuth, recipient, data, and fail-closed rules.
- `docs/ARCHITECTURE.md` owns runtime structure, state, data, and execution semantics.
- `docs/CONTRACTS.md` owns boundary shapes until executable schemas exist.
- `docs/IMPLEMENTATION_PLAN.md` owns the single sequential task queue and phase gates; it does not create product requirements.
- Zod schemas, database migrations, and contract tests become canonical for exact implemented fields. Keep the docs synchronized.
- `docs/DECISIONS.md` records rationale and open choices; it does not override current canonical behavior.
- `docs/PROGRESS.md` records status and evidence only.

If documents conflict, stop and reconcile the canonical files before implementing. An explicit current user instruction still takes precedence.

## Locked MVP scope

- One Next.js/TypeScript package, one PostgreSQL database, and one thin MCP entry point.
- Dashboard and MCP call the same application service.
- One connected team-owned Google account and calendar.
- Two seeded, non-recurring, timed, organizer-owned Acme events.
- Gmail sends only to an exact team-owned allowlist; Rewind never reads a mailbox.
- One account-level artifact whose recorded inputs are independent of region.
- One visible entity assumption, one initial approval, one recovery approval, and one separately confirmed Acme rule.
- Explicit Calendar, Gmail, and artifact functions; no generic compensation framework.
- Task requests outside the fixed Acme Calendar/mail/account-brief scenario fail as unsupported.

Do not add excluded integrations, generic workflow engines, a monorepo, generalized adapters, queues, rule dashboards, analytics, accounts, billing, or additional scenarios without explicit approval.

## Sequential implementation rules

- Work from the lowest-numbered unfinished task in `docs/IMPLEMENTATION_PLAN.md`; keep only one implementation task active.
- Freeze schemas, migrations, and golden fixtures before implementing code that produces or consumes them.
- Use a short task branch and merge the complete code/test/documentation/evidence packet before starting the next task.
- Do not edit package/lock files, migrations, contract barrel exports, `AGENTS.md`, `README.md`, or `PROGRESS.md` from concurrent workstreams.
- Every task completion records requirement IDs, schema/fixture versions, commands run, evidence, and remaining risk.
- If subagents are explicitly requested, give each one bounded read-only review or exclusive-file work for the current task only. They never merge to `main`, receive secrets, run live provider commands, or change canonical requirements.
- Only humans run TTY-gated Calendar/Gmail/reset operations and approve live effects.
- Finish each gate with independent requirement and safety audits before starting the next gate.

## Repository conventions

- Prefer scenario-specific code with plain names over premature abstractions.
- Keep route handlers thin: authenticate, validate, invoke one application service, map the result.
- Centralize state transitions and invariants in `lib/domain/`.
- Define shared input/output contracts in Zod under `lib/contracts/`.
- Keep model prompts small, versioned, and adjacent to their schema in `lib/ai/`.
- Treat model output, task text, Calendar text, and provider responses as untrusted data.
- The model proposes assumptions, dependency edges, artifact content, recovery classifications/templates, and one typed rule only over closed supplied universes. Deterministic code owns provider-grounded ranking checks, allowed IDs, semantic validation, recipients, exact templates, execution order, snapshots, and provider calls.
- Use strict TypeScript. Avoid `any`; narrow `unknown` at boundaries.
- Store timestamps as UTC and provider time zones as IANA identifiers.
- Use stable IDs and per-operation idempotency keys. Add a unique `(plan_id, action_key)` constraint.
- Bind approval to an immutable plan version and SHA-256 digest. Any target, recipient, content, dependency, or provider-version change requires a new plan and approval.
- Persist before and after every external call. Never use fire-and-forget execution.
- Never log OAuth tokens, API keys, full mail bodies, full model prompts, or attendee addresses.

## External-effect invariants

- MCP may create a World PR but may never approve or execute one.
- Initial external actions, recovery, correction mail, intended-recipient mail, and rule activation require the approvals defined in `docs/SAFETY.md`.
- Recheck authentication, recipient allowlist, plan hash, state, and provider preconditions at execution time.
- Calendar writes use `If-Match` with the approved ETag and `sendUpdates=none`.
- Restore only the `start` and `end` fields Rewind changed, and only when current remote state still matches Rewind's recorded after-state.
- A stale or conflicting event fails closed. Do not silently rebase or overwrite.
- Gmail is at-most-once by policy, not exactly-once. Persist `dispatch_started_at` before transport handoff; every ambiguous post-handoff result is `delivery_uncertain` and is never auto-retried.
- Execute reversible Calendar changes before irreversible Gmail sends.
- Never describe sent email as undone, deleted, or reset.
- Reset requires its own immutable two-event plan/digest approval, preflights both events before writing, updates rolling ETags, and reports partial state honestly. Sent messages remain.
- Seed/live-spike writes use only the TTY-gated demo admin exception in `docs/SAFETY.md`; they are forbidden in CI/production and cannot substitute for product approval.
- Never hide a failed integration behind mock data or a success UI.

## Expected commands

No commands exist at documentation kickoff. During the scaffold, create and verify these root scripts before marking them available:

```text
npm run dev
npm run build
npm run lint
npm run typecheck
npm test
npm run test:e2e
npm run db:migrate
npm run db:verify
npm run eval:recovery
npm run eval:model-safety
npm run prove:model-local
npm run verify:zero-credit-runtime
npm run seed:demo
npm run preflight:demo
npm run reset:demo
npm run verify:g1-interface
npm run verify:g2-closure
```

`package.json` is canonical once created. Update this section only after each command runs successfully.

## Testing expectations

- After meaningful code changes, run the narrowest relevant unit/integration test and type check.
- Before merging a vertical slice, run lint, type check, affected tests, and the relevant contract test.
- The critical browser flow is mandatory, not “if feasible.”
- Use deterministic fake adapters for automated E2E tests and separate clearly labeled live-integration smoke tests.
- Planner changes require all 25 correction paraphrases, the separate 100%-passing negative/safety suite, and schema/validator tests.
- External execution changes require duplicate-click, replay, partial-failure, stale-ETag, allowlist, and ambiguous-delivery tests.
- Never weaken a test merely to make it green. Record failures and evidence in `docs/PROGRESS.md`.

## Documentation maintenance

- Product behavior change: update PRD requirement IDs, tests, and progress together.
- Contract change: update Zod/code, `docs/CONTRACTS.md`, and contract tests together.
- Architecture/safety trade-off: record the decision in `docs/DECISIONS.md` before implementation.
- Command/setup change: update `package.json`, README, and this file after verification.
- Do not duplicate long specifications into README or comments; link to the canonical section.

## Definition of done for any external-action change

- Inputs and outputs validate at runtime.
- Authorization and allowlist checks exist at the execution boundary.
- Approval binds to the exact plan being executed.
- Idempotency/replay behavior is tested.
- Before, desired, after, receipt, and error states are persisted as applicable.
- Partial and uncertain outcomes are visible and honest.
- Logs are redacted.
- Relevant unit, integration, E2E, and live-smoke evidence is recorded.
