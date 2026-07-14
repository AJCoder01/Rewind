# Rewind demo runbook

| Field | Value |
|---|---|
| Status | Draft until live integrations pass |
| Target length | Under 3 minutes |
| Scenario | Acme UK → Acme US |
| Time zone | `America/New_York` |
| Last updated | 2026-07-14 |

This runbook operates the approved PRD. It cannot introduce product behavior. Never substitute a fake provider result for a failed live integration during the recorded demo.

## 1. Roles

Select operational roles during the T-30 preflight; these are live-demo safety roles, not implementation task assignments.

| Role | Rule |
|---|---|
| Demo operator | One authenticated human runs the product flow, narration, and recording |
| Safety observer | A second human, when available, watches preflight/provider state and makes no manual live edits |
| Final go/no-go | The present team confirms every required gate is green before recording |
| Safety veto | Any present human may stop the run |

No role may override a failed gate, edit provider state manually during recording, or substitute a mock result for a failed live integration.

## 2. Controlled seed data

Use `DEMO_DATE=2026-08-20`. The UI and example prompt must read the configured value so a stale hard-coded date cannot reach the demo.

### Calendar

| Field | Acme UK renewal | Acme US renewal |
|---|---|---|
| Owner/calendar | Configured team test account/calendar | Same |
| Baseline | `DEMO_DATE` 10:00–10:30 ET | `DEMO_DATE` 11:00–11:30 ET |
| Target | Restore to baseline after correction | `DEMO_DATE` 15:00–15:30 ET |
| Type | Timed, one-off, non-recurring | Timed, one-off, non-recurring |
| Private tag | `rewind_demo=acme-renewal`, `region=UK` | `rewind_demo=acme-renewal`, `region=US` |
| Attendees | Exact UK allowlist subset | Exact US allowlist subset |
| Ranking evidence | Nearest upcoming tagged match on the configured date | Visible later alternative |

The seeder stores provider IDs and immutable **semantic** baseline snapshots in protected configuration/database state. Baselines include stable IDs/times/time zone/duration/ownership/type/attendee/tag digests, not ETags. A separate rolling expected-version record is updated after every verified provider write/reset. Never rely on public search, title-only coincidence, or an undocumented “recent reference” signal.

### Gmail

Only addresses in `REWIND_RECIPIENT_ALLOWLIST` may receive mail. The secret is a structured `{UK,US}` mapping with one team-controlled address in each subset; literal addresses never enter Git or logs. Subjects include the run ID:

```text
[Rewind <runId>] Acme UK renewal moved
[Rewind <runId>] Correction: Acme UK renewal
[Rewind <runId>] Acme US renewal moved
```

Calendar API updates use `sendUpdates=none`; Gmail is the sole intended email channel. Sent messages are not deleted by reset.

### Account brief

The input is one versioned synthetic fixture, `acme_parent_account_notes`, containing company-wide renewal risks only. It must contain no UK/US, event, time, or attendee data. Generate the brief during planning, reject output that mentions those forbidden dimensions or unsupported facts, and store/display the exact content plus source/content hashes. Execution must persist the approved bytes without regeneration.

Suggested short output:

```text
Acme parent-account renewal risk brief

- Adoption is healthy, but executive sponsorship should be reconfirmed.
- Procurement timing is the main schedule risk.
- Next step: confirm decision owners and renewal milestones.
```

## 3. Environment prerequisites

- Protected deployed/local application and PostgreSQL are healthy.
- Demo operator session and CSRF flow work.
- Local Codex MCP server points to the same backend and has create/read-only auth.
- OpenAI project can access the configured model and strict schema call passes.
- Google OAuth grant belongs to the configured test identity.
- Calendar and Gmail APIs are enabled with only approved scopes.
- Exactly two tagged events exist and both attendee sets are allowlisted.
- `DEMO_DATE` is future and matches the prompt/UI.
- Scenario lock is free and previous run is archived/reset.
- Screen recording, viewport, zoom, notifications, and do-not-disturb are configured.

If Google OAuth is External/Testing, reauthorize within 24 hours of recording because current test authorizations may expire after seven days.

## 4. T-30 minute preflight

Run the future `npm run preflight:demo` and require all checks green:

1. application/database health;
2. authenticated dashboard session;
3. MCP create/read-only capability and backend identity;
4. OpenAI strict-schema smoke and configured model metadata;
5. Google token refresh and connected identity verified from the signed OIDC ID token, plus configured calendar identity;
6. exact configured Calendar ID;
7. exactly two tagged, owned, timed, non-recurring events;
8. both events match immutable semantic baselines and the separate rolling expected ETags;
9. all attendee addresses are allowlisted and organizer excluded;
10. Calendar notification behavior verified/configured as `sendUpdates=none`;
11. scenario lock free, active demo rule absent, fresh run ID ready;
12. one dry dashboard page load and no client/server errors.

Do not send a preflight email immediately before the demo unless its unique run ID and audit residue are expected.

Go/no-go rule: any red integration, unexpected event/recipient, stale date, active lock, model schema failure, or provider conflict is a no-go. Fix and rerun preflight; do not continue with a mock.

## 5. Three-minute script

### 0:00–0:20 — Problem

Say:

> AI agents can change calendars and contact people in seconds. But relevant context can arrive after a reasonable plan has already been approved and executed. Reconstructing every affected consequence still falls on a human.

Open on the Rewind composer with Calendar, Gmail, and model preflight green.

### 0:20–0:45 — Create the World PR through Codex

Submit:

> Move the Acme renewal meeting on `DEMO_DATE` to 3:00 PM ET, prepare a risk brief from the shared Acme parent-account notes, and email the attendees.

Codex calls `create_world_pr` and returns the authenticated review URL. Open it in the already signed-in dashboard.

Say:

> Codex delegates one high-level request. Rewind owns the plan, approval, execution, snapshots, and recovery.

### 0:45–1:10 — World PR

Show:

- Acme UK selected and Acme US visible as an alternative;
- UK ranking evidence;
- exact 15:00 ET event change and recipients/message;
- exact parent-account brief content, source/content hashes, and independence validation;
- entity-dependency labels and plan digest.

Say:

> Rewind records the important assumption and which approved actions depend on it. The account brief uses shared company-level notes, so it is visibly independent of region.

Add, if model behavior is not already obvious on screen:

> GPT turns the supplied candidates, actions, and free-form context into typed assumptions, dependency mappings, recovery classifications, and a guardrail proposal. Deterministic validation controls every exact target, template, recipient, and provider effect.

Approve once.

### 1:10–1:30 — Execution

Keep the same tab. Show persisted receipts:

- exact approved account brief persisted;
- UK Calendar updated;
- UK notification sent.

Say:

> These are real controlled effects, and every one has a durable receipt.

### 1:30–1:45 — Late context

Paste:

> Sales clarified after execution that the intended renewal was Acme US. Repair only the effects invalidated by that correction.

Say:

> The approver did not have this context earlier. It arrived after execution.

### 1:45–2:15 — Causal Revert

Show `Acme UK → Acme US` and the five-to-seven-second fixed animation:

- UK event → Restore
- UK email → Correct
- account brief → Preserve
- US event + US email → Apply

Say:

> Rewind follows the dependency lineage recorded in the approved plan. It restores reversible state, compensates for irreversible communication, preserves work whose inputs remain valid, and applies the intended workflow to the corrected target.

Briefly reveal exact recipients/messages and preconditions, then approve recovery.

### 2:15–2:35 — Recovery receipts

Show:

- UK event restored;
- US event updated;
- UK correction sent;
- US attendees notified;
- account brief still present.

Say:

> Sent email is not magically undone; Rewind sends an explicit correction. Calendar writes are restored only when the remote event has not drifted.

### 2:35–2:55 — Prevent this next time

Show the proposed Acme-scoped guardrail and activate it separately. In the **Try guardrail** panel, submit a similar ambiguous request through the same normal intake used at the start. Show the persisted clarification state:

> I found Acme UK and Acme US. Which one did you mean?

Say:

> The correction becomes a proposed guardrail. Once confirmed, normal intake now stops before effect-bearing planning. This clarification record has no plan, action, or second scenario lock.

### 2:55–3:00 — Close

Final screen:

> **Correct the cause, not every consequence.**

Say:

> Previews help before execution. Rewind helps when relevant context arrives afterward.

## 6. Operator behavior during errors

- Do not click approval twice while a request is in progress.
- If the UI shows `retryable_failed`, use only the provided safe resume control.
- If it shows `delivery_uncertain`, `provider_conflict`, or `permanently_failed`, stop the run. Do not resend or edit the database.
- If MCP fails before task creation, the dashboard path may demonstrate the same backend only if the failure is disclosed; the recorded primary flow still requires a successful MCP run.
- If OpenAI output is invalid twice, show the safe failure during testing; do not enable or hide a deterministic fallback for recording.
- If any real integration is down, postpone recording. A mocked receipt is not an acceptable fallback.

## 7. Reset demo state

After each rehearsal/run:

1. Prepare the reset preview; this performs no write.
2. Verify its immutable plan/digest names both semantic baselines, both current expected ETags, execution order, partial-risk warning, and states that sent mail remains.
3. Approve that exact reset digest only when no action is executing.
4. The reset flow preflights both events before its first write, then conditionally restores start/end.
5. Verify provider values and the **new rolling expected ETags** returned by reset; never expect the original seed ETags to return.
6. If any partial/race state appears, stop: the scenario lock remains and a new exact reset plan is required. Do not edit around it.
7. Archive the run/action/audit and guardrail-proof clarification records for evidence.
8. Remove/deactivate the generated artifact and Acme rule.
9. Release the scenario lock and create the next run ID only after both baseline verifications pass.
10. Confirm prior Gmail messages still exist and their run IDs distinguish them.

If either event has drifted, reset must stop with `reset_conflict`; resolve the test-account state deliberately and rerun the entire preflight. Never call a manual Calendar edit an automated reset pass.

## 8. Five-run rehearsal log

Complete this in `PROGRESS.md` or sanitized test evidence:

| Run | Run ID | Initial plan | Recovery plan | Calendar verified | Mail receipts | Rule proof | Reset | Manual intervention | Result |
|---:|---|---|---|---|---|---|---|---|---|
| 1 | TBD | TBD | TBD | TBD | TBD | TBD | TBD | None required | TBD |
| 2 | TBD | TBD | TBD | TBD | TBD | TBD | TBD | None required | TBD |
| 3 | TBD | TBD | TBD | TBD | TBD | TBD | TBD | None required | TBD |
| 4 | TBD | TBD | TBD | TBD | TBD | TBD | TBD | None required | TBD |
| 5 | TBD | TBD | TBD | TBD | TBD | TBD | TBD | None required | TBD |

Five passes must be consecutive. A failure resets the count after the defect is fixed and the relevant tests pass.

## 9. Recording checklist

- Use team-controlled accounts and hide browser/profile bars that expose addresses.
- Clear unrelated tabs, notifications, console panes, and secret-bearing terminals.
- Use a clean viewport with readable zoom and large cursor.
- Record one continuous successful flow where practical; edits must not misrepresent provider execution.
- Verify exact copy and avoid “autonomous learning,” “atomic rollback,” “unsend,” “universal,” or “automatic recovery.”
- Capture the recovery screen as the primary screenshot: corrected assumption, Restore/Correct/Preserve, and US Apply actions.
- Capture a second image of the clarification rule proof if submission space permits.
- Revoke temporary sharing links and sanitize exported logs/screenshots afterward.

## 10. Submission narrative

Lead with the recovery problem and product behavior, not infrastructure:

1. one-line pitch and tagline;
2. why late context is costly after execution;
3. the reasonable Acme UK interpretation and later Acme US clarification;
4. World PR → Causal Revert → Prevent this next time;
5. meaningful constrained-model reasoning and deterministic safety boundary;
6. architecture, real provider receipts, and conflict/idempotency controls;
7. primary recovery screenshot;
8. Codex/MCP collaboration and shared backend path;
9. post-MVP adapter hypotheses and explicit limitations;
10. closing positioning.

Do not lead with MCP, infrastructure, approval dashboards, generic agent safety, semantic transactions, or universal tool interception. Do not claim autonomous learning, complete causality, atomic rollback, or production readiness.

## 11. Submission assets

- Under-three-minute demo video
- Primary Causal Revert screenshot
- README and architecture diagram
- PRD, safety model, and test/eval summary
- Sanitized five-run evidence
- Codex/MCP collaboration note
- Setup and test commands verified against the final repository
- Honest limitations and future-adapter paragraph
