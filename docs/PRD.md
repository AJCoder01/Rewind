# Rewind product requirements document

| Field | Value |
|---|---|
| Status | Approved for MVP kickoff |
| Product | Rewind |
| Submission category | Work & Productivity |
| Product category | Dependency-aware recovery for agent-executed workplace workflows |
| Primary persona | Sales Ops / Customer Success operations coordinator |
| MVP scenario | Google Calendar + Gmail, Acme UK vs Acme US |
| Last updated | 2026-07-17 |

This document is canonical for what the MVP must do and why. `SAFETY.md` adds constraints that cannot be traded away. Technical implementation belongs in `ARCHITECTURE.md` and exact interfaces in `CONTRACTS.md`.

## 1. Executive summary

Rewind records the important assumptions behind an approved AI plan and which planned actions depend on each assumption. If relevant context arrives after those actions execute, Rewind uses the approved dependency lineage, action receipts, and adapter-specific recovery rules to propose the smallest valid repair. A human reviews the exact repair before any external recovery effect occurs.

**One-line pitch**

> Rewind records why approved AI actions were taken, then proposes a reviewed repair when later context invalidates an assumption.

**Tagline**

> Correct the cause, not every consequence.

**Positioning**

> Previews help catch issues before execution. Rewind helps repair the smallest valid set of recorded consequences when relevant context arrives afterward.

## 2. Product truth and claim boundary

The product insight is not chronological undo. A normal undo asks what happened last. Rewind asks which **recorded dependencies** became invalid when an approved assumption changed.

```text
User goal
  → approved assumption
    → recorded dependent actions
      → provider receipts and external consequences
```

For this MVP, “causal” means dependency lineage explicitly recorded in the approved plan. Rewind does not discover complete causality from arbitrary logs. It can recover only actions that:

1. were planned and executed through Rewind;
2. are represented in the approved dependency graph;
3. use an implemented Calendar, Gmail, or artifact recovery path; and
4. still satisfy deterministic safety preconditions at recovery time.

The MVP is a product-hypothesis demonstration, not a universal rollback platform or production safety certification.

## 3. Problem

Agent tools increasingly perform several connected workplace actions from one request. Pre-execution previews and approval help, but they cannot include information that the approver does not yet have. When later context invalidates a previously reasonable interpretation, the user must reconstruct which actions depended on it, distinguish reversible from irreversible effects, avoid undoing still-useful work, and perform a new intended workflow.

This manual repair is slow and error-prone because conventional logs are chronological, provider controls are per action, and cross-provider consequences are not grouped by the assumption that motivated them.

## 4. Primary user and job to be done

### Primary persona

A Sales Ops or Customer Success operations coordinator who executes teammate-originated requests, is authorized to update a controlled calendar and contact controlled recipients, and may reasonably lack context that an account owner supplies later.

Broader knowledge-worker personas are future hypotheses, not MVP targets.

### Job to be done

> When late context changes the meaning of an AI-completed task, help me see and safely repair only the recorded consequences that became invalid without discarding work that remains useful.

### Buyer hypothesis

RevOps or Customer Success Operations leaders responsible for reliable AI-assisted execution. This is a hypothesis only; the hackathon MVP does not validate pricing, procurement, or enterprise readiness.

## 5. Goals

- Demonstrate one complete real Calendar-and-Gmail workflow with human approval.
- Make one important interpretation and its evidence visible before execution.
- Record dependency lineage and exact external effects in an immutable plan.
- Show selective recovery across reversible state, irreversible communication, unaffected work, and intended new work.
- Fail safely on stale state, unknown entities/recipients, invalid model output, partial execution, and uncertain mail delivery.
- Turn one correction into one proposed, typed guardrail that requires separate activation.
- Let a viewer understand the corrected assumption and four outcomes in about five seconds.
- Complete the acceptance flow five times consecutively without manual data repair, server restart, duplicate actions, or hidden mocks.

## 6. Non-goals

The MVP will not build or imply:

- recovery for actions executed outside Rewind;
- generic MCP interception, transparent proxying, or universal rollback;
- CRM, Slack, Notion, ticketing, document-permission, or mailbox-reading integrations;
- multiple workflows, organizations, users, roles, billing, analytics, or mobile apps;
- recurring events, all-day events, shared calendars, uncontrolled attendees, or production customer data;
- arbitrary plan editing, automatic recovery, automatic rule activation, or organization-wide learning;
- a generic compensation interface/DSL, conflict rebasing, dynamic graph engine, or multi-agent orchestration;
- claims of atomicity or exactly-once delivery across Google and the database.

## 7. Refined demonstration scenario

### Controlled setup

- One team-owned Google account owns one dedicated demo calendar.
- Exactly two future, non-recurring, 30-minute events exist on `DEMO_DATE` in `America/New_York`:
  - **Acme UK renewal**, baseline 10:00–10:30 ET
  - **Acme US renewal**, baseline 11:00–11:30 ET
- Both carry controlled private demo metadata and distinct allowlisted attendee sets.
- Acme UK is deterministically ranked first because it is the nearest upcoming tagged match on the configured demo date. That provider-derived fact is shown as evidence; Acme US remains visible as an alternative. No unsupported “recently referenced” signal is claimed.
- A fixed **Acme parent-account risk source** contains company-wide notes only. It contains no event, attendee, time, UK, US, or region-specific input.
- There is initially no active “confirm region” rule.

### Initial request

> Move the Acme renewal meeting on `DEMO_DATE` to 3:00 PM ET, prepare a risk brief from the shared Acme parent-account notes, and email the attendees.

The explicit date/time zone prevents a second hidden ambiguity. The event duration remains unchanged.

### World PR

Rewind retrieves the two controlled candidates and proposes Acme UK. The World PR shows:

- the original request;
- Acme UK as the resolved entity and Acme US as an alternative;
- the assumption “Acme refers to Acme UK”;
- the deterministic evidence and confidence/ranking explanation;
- exact original and proposed event times, date, time zone, and retained duration;
- exact allowlisted recipients and exact notification content;
- the exact generated account-brief content, its content hash, and its region-independent source provenance;
- dependency edges: UK Calendar and UK mail depend on the entity assumption; the account brief does not;
- customer-visible/external-effect badges; and
- an immutable plan version/digest.

The coordinator approves based on the available context. Approval is reasonable because the ranking evidence supports UK and the account owner’s clarification has not arrived.

### Initial execution

The exact brief is generated and validated during planning, included in the immutable plan, and approved with the other effects. Rewind then:

1. persists the already-approved account brief blob without regenerating it;
2. snapshots and conditionally updates the UK event to 15:00–15:30 ET; and
3. sends the exact approved notification to the UK allowlist.

Each action receives a durable status and provider receipt. The timeline never reports a step complete before its persisted receipt exists.

### Late context

After execution, the coordinator manually pastes:

> Sales clarified after execution that the intended renewal was Acme US. Repair only the effects invalidated by that correction.

The UI must not imply Slack, email monitoring, or automatic teammate-message ingestion.

### Causal Revert

Rewind proposes, validates, and previews:

- **Restore:** return the UK event to its recorded baseline, but only if it still matches Rewind’s post-update version;
- **Correct:** send a correction to the exact approved UK recipient list; never claim the first email is unsent;
- **Preserve:** retain the parent-account brief because its recorded provenance is independent of region;
- **Apply:** move the US event to 15:00–15:30 ET and notify its exact allowlisted attendees.

The preview displays exact targets, times, recipients, message bodies, preconditions, and execution order. One recovery approval may authorize the complete bundle only because all four effects are shown and bound to one immutable recovery-plan digest.

### Prevent this next time

After successful recovery, Rewind proposes:

> For Acme renewal requests, if more than one region matches and a Calendar or email action is planned, require region confirmation first.

The user separately activates the rule. In the built-in **Try guardrail** proof panel, a later ambiguous Acme request is submitted through normal task intake. The active rule is evaluated before the effect-bearing scenario lock, so the request enters `clarification_required` before entity selection or plan generation and asks:

> I found Acme UK and Acme US. Which one did you mean?

The rule is scoped to the demo workspace and Acme renewal requests. The MVP does not claim autonomous or organization-wide learning.

The clarification record exposes the same review URL/read model as any intake, but contains no plan or action and owns no scenario lock. The demo does not resolve or approve this proof request. Successful reset archives it and intentionally removes the rule to restore the next rehearsal's baseline.

## 8. Product concepts

### World PR

A plain-language, semantic preview of an immutable plan. “World PR” is always paired with descriptive copy such as “Review proposed workspace changes”; do not assume nontechnical users understand pull-request terminology.

### Recorded assumption

An unstated premise that materially affects target selection or external effects, with an ID, resolved value, evidence, and dependency edges. The MVP highlights one entity assumption.

### Causal Revert

A reviewed recovery plan derived from the previously approved dependency lineage, completed-action ledger, corrected known entity, and adapter-specific outcome rules.

### Outcome taxonomy

| Label | Applies to | Meaning |
|---|---|---|
| Restore | Existing reversible action | Return only Rewind-changed state to the approved before-state when conflict checks pass. |
| Correct | Existing irreversible action | Add a compensating communication; the original effect remains part of history. |
| Preserve | Existing valid action | Keep work whose approved dependencies remain valid. |
| Apply | New action | Execute an allowlisted template against the corrected, approved target. |

Existing executed actions may be classified only as `restore`, `correct`, or `preserve`. `apply` labels new template actions and is never attached to an existing action ID.

### Prevent this next time

A proposed typed guardrail derived from the correction. Natural-language copy explains it, but only fixed structured fields are executable. Activation always requires a separate confirmation.

### Reset demo state

A controlled operation that conditionally returns both seeded Calendar events to their baselines, archives/releases the local scenario, removes the active demo rule and generated artifact for the next run, and creates a new run ID. Previously sent email remains in recipient inboxes and is never described as reset.

## 9. Functional requirements

### Intake and candidate resolution

- **FR-01:** A user can submit the same supported Acme Calendar/mail/account-brief request through the dashboard or the `create_world_pr` Codex MCP tool; both invoke the same authenticated backend application service. Requests outside the controlled scenario fail as unsupported rather than generating arbitrary actions.
- **FR-02:** A caller-generated idempotency key prevents duplicate task creation from network retry or double click.
- **FR-03:** Only one effect-bearing demo scenario may hold the scenario lock. Candidate lookup and an active-rule precheck run first; a matching request may safely enter `clarification_required` without a plan, action, or lock. A competing request that passes the precheck and tries to begin planning receives `409 scenario_busy`.
- **FR-04:** The candidate service returns exactly the two tagged, owned, timed, non-recurring Acme events from the configured demo calendar or fails safely.
- **FR-05:** An active prevention rule is evaluated after candidate retrieval but before entity selection. A match produces `clarification_required`.
- **FR-06:** Without the rule, UK ranking is deterministic and both the selected and alternative candidates are visible.

### World PR and approval

- **FR-07:** The World PR shows request, selected entity, alternative, assumption, evidence, exact action effects, external-effect labels, dependency edges, exact account-brief content/hash/provenance, and plan version/digest.
- **FR-08:** The preview shows exact date, local time, IANA time zone, duration, recipients, and mail content.
- **FR-09:** A user can approve, cancel, or return to the composer. Cancelling a locked preview archives the task and releases its scenario lock; cancelling a clarification-only intake archives it without touching the lock owned by another run. Arbitrary action editing is not required.
- **FR-10:** Approval records the authenticated actor, timestamp, plan ID, plan version, and plan digest. Approval may prepare the durable action ledger but performs no artifact or provider effect; execution is a separate explicit dashboard mutation.
- **FR-11:** Any change to target, recipients, content, dependency, template, or relevant provider version invalidates approval and requires a new provider-grounded preview. If every action remains pristine, Rewind may prepare that next immutable preview automatically but may not approve or execute it.

### Initial execution

- **FR-12:** Each action has a durable unique ledger row before execution and is never executed twice for the same plan/action key.
- **FR-13:** Immediately before Calendar mutation, Rewind refetches the event and validates the approved ETag, attendee set, ownership, type, and allowlist.
- **FR-14:** Rewind changes only event start/end, preserves duration and IANA time zone, uses a conditional write, and disables Calendar attendee email updates.
- **FR-15:** Rewind sends exactly the approved message to allowlisted attendees through Gmail after reversible Calendar work succeeds.
- **FR-16:** The artifact is generated during planning only from the approved parent-account source, validated against region/event/attendee/time leakage, shown in full, and bound to the plan by source and content hashes. Execution persists that exact blob and never regenerates it.
- **FR-17:** The timeline shows persisted timestamps, typed receipts, and honest partial, conflict, uncertain-delivery, and failed states.
- **FR-18:** Retry/resume skips succeeded actions and retries only actions whose status is known safe to retry.

### New context and recovery

- **FR-19:** The user can manually enter or paste new context for recovery only when initial execution is fully `completed`. Partial, conflict, or delivery-uncertain initial work must be resolved first.
- **FR-20:** The correction parser must identify an explicit known corrected target. “Wrong region” without an explicit target in accumulated context requires clarification. Before creating an approvable recovery plan, Rewind must fetch both UK and US events and reject already-drifted provider state.
- **FR-21:** The recovery planner returns strict structured output referencing only known executed-action IDs, corrected candidate IDs, allowed outcomes, and allowed new-action templates.
- **FR-22:** Deterministic validation accounts for every succeeded initial action exactly once, rejects incompatible classifications, and rejects omitted, duplicate, unknown, or injected entities/actions/recipients.
- **FR-23:** The Causal Revert screen shows the corrected assumption and fixed Restore/Correct/Preserve/Apply visualization in about five seconds.
- **FR-24:** The user can approve or cancel the recovery preview. To revise context, the user first cancels the unexecuted recovery attempt back to `completed`, then submits replacement context; the new plan supersedes the old version. Cancelling recovery leaves the completed initial effects unchanged.
- **FR-25:** Recovery approval binds the exact targets, times, recipients, messages, templates, preconditions, order, plan version, and digest.
- **FR-26:** All Calendar preflights pass before the first recovery side effect. Recovery executes UK restore, US update, UK correction mail, then US notification mail.
- **FR-27:** A provider conflict, invalid model plan, unknown delivery result, or partial failure produces an honest attention state; it never falls through to success.

### Prevention and reset

- **FR-28:** After complete recovery, Rewind generates at most one typed Acme prevention-rule proposal with human-readable rationale and provenance.
- **FR-29:** The rule is inactive until separately confirmed and can only enforce `ask_for_confirmation` for the fixed condition.
- **FR-30:** The Try guardrail panel submits through the normal `POST /world-prs` intake. Because the rule runs before lock acquisition, the real path visibly returns a persisted `clarification_required` intake with candidate choices but creates no plan/action and does not acquire a second scenario lock.
- **FR-31:** Reset first renders an immutable reset plan containing both semantic baselines, both current expected ETags, and the mail-retention warning. Exact digest approval is required. It preflights both events before its first write, conditionally restores both, records any partial result honestly, releases the active scenario only after complete success, archives the prior run and clarification proof, removes/deactivates the demo rule and artifact, and creates a new run ID.
- **FR-32:** Reset retains sent mail and audit evidence and communicates that limitation explicitly.

## 10. Safety requirements

- **SAFE-01:** Human approval is required before initial external execution and before recovery external execution. Rule activation requires a separate confirmation.
- **SAFE-02:** The exact correction and intended-recipient mail content/recipients must be visible in the recovery plan; one approval may authorize that exact bundle.
- **SAFE-03:** MCP can create and inspect status but cannot approve, recover, activate rules, or reset.
- **SAFE-04:** Dashboard and MCP endpoints require authentication; opaque IDs or URLs alone are not authorization.
- **SAFE-05:** Only the connected organizer-owned calendar and exact team-controlled recipient allowlist may be touched.
- **SAFE-06:** Calendar ETag/after-state mismatch blocks execution or restoration; no automatic overwrite or generic rebase is allowed.
- **SAFE-07:** Ambiguous Gmail delivery is `delivery_uncertain` and is not automatically resent.
- **SAFE-08:** Model output is never executable code or raw provider input. Deterministic code builds provider calls from approved templates.
- **SAFE-09:** OAuth tokens and secrets are encrypted/stored in deployment secret facilities and never logged or exposed to the browser.
- **SAFE-10:** Store and log only the minimum controlled demo data defined in `SAFETY.md`; never ingest mailbox history or production customer data.

## 11. UX requirements

### Screen 1 — Task composer

- Task input with the fixed example readily available
- Connected Calendar, Gmail sender, model, and demo-date preflight status
- Recent/archived runs and active-scenario status
- Create World PR as the single primary action

### Screen 2 — World PR: review proposed workspace changes

- Original request and selected/alternative entity
- One prominent assumption card with evidence
- Before/after Calendar card, exact mail card, and account-brief provenance card
- Dependency labels and external-effect badges
- Approve, cancel, and back controls

### Screen 3 — Execution timeline

- Persisted progress and provider receipts in one tab
- Completed, partial, conflict, uncertain, and failed states with plain-language explanations
- Manual “Add new context” input after execution

### Screen 4 — Causal Revert

- `Acme UK → Acme US`
- Fixed four/five-node visual with non-color labels
- Exact Restore, Correct, Preserve, and Apply cards
- Preconditions, order, recipient/message disclosure, and recovery explanation
- Approve recovery, revise context, and cancel controls

### Screen 5 — Prevent this next time

- Proposed typed rule, scope, trigger, rationale, and source task
- Separate “Activate guardrail” action
- A five-second proof in which a new ambiguous request asks UK vs US

### Interaction and accessibility

- One primary action per state; never require switching browser tabs during the demo.
- Never use color alone for status. All actions, connectors, and badges need text/icon labels.
- Support keyboard navigation, visible focus, semantic headings, and reduced-motion mode.
- The causal animation lasts approximately five to seven seconds and becomes an immediately understandable static layout when motion is reduced.
- No zoom, dragging, panning, dynamic layout, dense labels, or more than five visible nodes.

## 12. Non-functional requirements and success gates

- **NFR-01:** The full live flow succeeds five consecutive times without manual database edits, server restart, duplicate actions, hidden prompt retries, or unknown UI state.
- **NFR-02:** Double-click and replay tests create zero duplicate Calendar mutations or Gmail sends.
- **NFR-03:** Stale Calendar changes produce zero silent overwrites.
- **NFR-04:** Unknown entities, actions, templates, and recipients reaching an adapter: zero.
- **NFR-05:** At least 24 of 25 correction-paraphrase fixtures produce the exact safe recovery classification, with a stretch gate of 25/25 before recording. A separate negative/safety suite must pass 100% with zero unsafe adapter calls.
- **NFR-06:** Every approval and external action can be traced to a plan digest, actor, timestamp, action key, provider target, and typed receipt/error.
- **NFR-07:** A viewer can identify the corrected assumption, affected actions, preserved artifact, and intended new actions from the main recovery screen in approximately five seconds.
- **NFR-08:** The demo remains usable with animation disabled.
- **NFR-09:** Reset returns both Calendar events and local scenario state to their controlled baselines while honestly retaining sent mail.
- **NFR-10:** No secret, token, full mail body, attendee address, or production data appears in client bundles or application logs.

## 13. Acceptance flow

The MVP is accepted only when this exact sequence passes with real controlled integrations:

```text
Create through Codex MCP
→ open authenticated World PR
→ review selected UK and alternative US
→ approve immutable initial plan
→ generate parent-account brief
→ conditionally update UK event
→ send UK notification
→ paste explicit late US clarification
→ validate and preview recovery
→ approve immutable recovery plan
→ restore UK event
→ update US event
→ send UK correction
→ send US notification
→ preserve account brief
→ propose and separately activate rule
→ submit similar ambiguous request
→ clarification_required asks UK vs US
→ review and approve immutable reset plan
→ reset demo state
```

Acceptance additionally requires the test and safety gates in `TEST_PLAN.md` and `SAFETY.md`.

## 14. Assumptions and open product questions

Assumed for kickoff:

- A dedicated Google Workspace account and team-controlled recipients are available.
- The user can manually paste late context; no ingestion integration is needed.
- The demo can use a configurable future `DEMO_DATE` and `America/New_York` time zone.
- One grouped recovery approval is understandable when all exact effects are visible.
- A scenario-specific Acme rule is sufficient proof of “Prevent this next time.”

Open choices requiring owners are tracked in `DECISIONS.md#open-decisions`. If an assumption fails, update this PRD before expanding scope.

## 15. Post-MVP hypotheses

Only after the controlled Calendar/Gmail proof is reliable should the team investigate adapters for CRM, ticketing, project-management systems, document permissions, customer support, or financial workflows; broader team-scoped guardrails; and richer conflict/reconciliation support. These are narrative possibilities, not approved roadmap items, and none may enter the current MVP phases without replacing an equal-or-larger requirement through an explicit PRD decision.
