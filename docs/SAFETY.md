# Rewind safety, security, and privacy

| Field | Value |
|---|---|
| Status | Non-negotiable MVP constraints |
| Data class | Synthetic, team-controlled demo data only |
| Production approved | No |
| Default local retention | 7 days after the final demo/submission |
| Last updated | 2026-07-14 |

This file constrains every architecture, UI, and demo decision. A faster or prettier implementation may not weaken these rules.

## 1. Safety invariants

1. No product-path external action runs without an authenticated human approving the exact immutable plan that contains it. The narrowly scoped setup/live-spike exception in section 2.1 is never a product path.
2. MCP can create a plan and read status; it cannot approve, execute, recover, activate a rule, or reset.
3. Only one dedicated, connected Google account, its configured owned calendar, two tagged events, and exact team-controlled recipients are in scope.
4. The recipient allowlist, event ownership/type, plan digest, and provider version are rechecked at the final execution boundary.
5. Calendar drift blocks mutation. Rewind never silently overwrites or generically rebases a changed event.
6. Gmail delivery is treated as irreversible and at-most-once. Ambiguous delivery is never automatically retried.
7. The model never supplies executable code, raw provider payloads, recipients, headers, arbitrary IDs, or unregistered templates.
8. Unknown, omitted, duplicate, stale, underspecified, or invalid data fails closed before external execution.
9. Partial and uncertain outcomes remain visible. A success state requires a persisted successful outcome for every approved action.
10. Reset never claims to delete, unsend, or restore recipient inboxes.
11. No production customer data, public mailbox content, uncontrolled recipient, or changing third-party data enters the demo.
12. No failed live integration is covered by a mock success state.

## 2. Approval policy

| Operation | Required authorization | What the approval must show |
|---|---|---|
| Create World PR | Authenticated dashboard session or scoped MCP token | Request only; no external effect |
| Initial execution | Authenticated dashboard approval of initial plan digest | Exact event/date/time/time zone, exact recipients/body, artifact source/provenance, dependencies, order |
| Submit new context | Authenticated dashboard session | User-entered text; no external effect |
| Recovery execution | Authenticated dashboard approval of recovery plan digest | Exact Restore/Correct/Preserve/Apply effects, all targets, preconditions, recipients/bodies, order |
| Correction and US mail | Covered only by the exact recovery-plan approval | Both exact messages and lists must be visible; any change invalidates approval |
| Activate prevention rule | Separate authenticated confirmation of rule digest | Typed scope, trigger, required action, source task |
| Reset demo state | Authenticated approval of an immutable reset-plan digest plus mail-retention acknowledgement | Both semantic baselines, both approved current ETags, order, partial-risk statement, and statement that sent mail remains |

One grouped recovery approval is acceptable because every action in the bundle is fixed and visible. It is not blanket permission for later-generated content.

Approval records are immutable and contain actor, timestamp, plan ID/version, and SHA-256 plan digest. Provider drift or any plan-relevant content change requires a new plan and approval.

### 2.1 Setup and live-spike exception

Seed and Day 1 integration-spike utilities may perform controlled writes before the product approval UI exists only under all of these constraints:

- they are explicit admin/test commands unavailable from HTTP, MCP, browser, and CI;
- an authenticated operator interactively confirms the exact configured calendar/event or allowlisted mail target and unique run ID;
- Calendar writes are conditional, change only start/end, use `sendUpdates=none`, and persist before/after receipts;
- mail is a single clearly labelled test message to one team-controlled allowlisted recipient, with the same dispatch/uncertainty policy as product mail;
- commands refuse non-demo tags, non-owned calendars, unallowlisted recipients, missing TTY confirmation, or production environment; and
- every use is logged in the rehearsal evidence and followed by baseline verification.

This exception cannot execute a product task, recovery, rule, or reset and cannot be used to make a failed demo appear successful.

## 3. Controlled environment boundary

Supported:

- one team-owned Google Workspace or dedicated Google account;
- one configured calendar owned by that account;
- two one-off, timed, 30-minute events carrying the exact demo tag;
- `America/New_York` and one configured future demo date;
- exact allowlisted attendee addresses controlled by the team;
- synthetic Acme parent-account notes;
- one active effect-bearing scenario and one authenticated demo operator; clarification-only guardrail intake may coexist because it has no plan/action/lock.

Rejected at validation:

- recurring or all-day events;
- events the connected identity does not own;
- shared/secondary calendars outside the configured ID;
- attendees not in the allowlist, aliases whose final destination is uncontrolled, or newly introduced recipients;
- changed attendees, organizer, time zone, event type, or ETag after preview;
- unknown regions/accounts or ambiguous correction text;
- production or real customer information.

## 4. Authentication and authorization

### Dashboard

- Require a real authenticated demo-operator session; an unguessable URL is not authorization.
- Session cookies are `HttpOnly`, `Secure` in deployed environments, and `SameSite=Lax` or stricter.
- Mutating requests require CSRF protection and origin checks.
- IDs contain at least 128 bits of entropy and are checked for task ownership/scope.
- A minimal single-user demo gate is acceptable; multi-user accounts and RBAC are non-goals.

### MCP

- The MCP process reads a scoped backend token from its environment.
- The token authorizes create and status only.
- Do not pass Google/OpenAI credentials through MCP tool inputs or outputs.
- Do not place bearer tokens in review URLs, logs, or Codex-visible text.
- Rotate/revoke the token after the event or on suspected exposure.

### Server and database

- Store secrets in the deployment secret manager/environment, not the repository or client bundle.
- Encrypt Google refresh tokens with a server-held key or provider-managed secret facility.
- Use TLS for deployed backend, database, OpenAI, and Google calls.
- Database roles receive only the privileges the application needs.
- Never expose direct database/provider credentials to the browser.

## 5. Google OAuth scopes and lifecycle

Use the narrowest practical identity and Workspace scopes:

```text
openid
email
https://www.googleapis.com/auth/calendar.events.owned
https://www.googleapis.com/auth/gmail.send
```

Validate the connected identity from the signed OpenID Connect ID token's subject/email claims; do not call Gmail `users.getProfile`, which is not authorized by `gmail.send`. `calendar.events.owned` permits viewing/changing events on calendars the user owns. `gmail.send` sends mail without mailbox read/modify access. Google currently classifies `gmail.send` as sensitive, while `gmail.compose` is broader and restricted. The MVP therefore uses direct sends and accepts an honest `delivery_uncertain` state rather than requesting mailbox/draft access. See [Google OpenID Connect](https://developers.google.com/identity/openid-connect/openid-connect), [Calendar scopes](https://developers.google.com/workspace/calendar/api/auth), and [Gmail scopes](https://developers.google.com/workspace/gmail/api/auth/scopes).

The authorization-code callback requires high-entropy single-use `state`, OIDC `nonce`, PKCE S256, an exact allowlisted redirect URI, and short-lived transaction storage bound to the initiating browser session. Validate signature, `iss`, `aud`, `exp`, `iat`, `nonce`, `email_verified`, and the expected stable `sub`; reject replay, mismatch, expiry, or a different configured account. Consume `state`/`nonce` atomically before storing tokens.

OAuth is a Day 1 risk:

- Prefer an Internal/Trusted Google Workspace app when the team environment supports it.
- If an External app remains in Testing, authorize only named test users and plan around the current seven-day authorization/refresh-token expiry.
- Reauthorize within 24 hours of the final recording and run the live preflight immediately afterward.
- Never wait until submission day to discover an expired grant.
- Revoke the grant and delete stored refresh tokens after the retention window.

Google documents the seven-day Testing authorization lifetime and test-user limits in [Manage App Audience](https://support.google.com/cloud/answer/15549945).

## 6. Calendar safety

Before preview, capture a typed snapshot containing:

- configured calendar and provider event IDs;
- ETag and provider `updated` timestamp;
- start/end instants, IANA time zone, and duration;
- organizer and attendee-set digests;
- event type and absence of `recurringEventId`;
- only the other minimum fields needed to validate the controlled boundary.

Treat the seeded semantic baseline and provider version separately. The immutable baseline contains stable IDs, baseline start/end/time zone/duration, organizer/attendee/tag/type facts, but **not** ETag or provider `updated`. A rolling expected-version record contains the latest verified ETag/updated value and is replaced after every successful move/restore/reset write.

Immediately before mutation:

1. refetch;
2. compare the approved ETag and all safety-relevant fields;
3. recheck ownership, type, calendar ID, candidate tag, and allowlist;
4. use `If-Match` for the conditional update;
5. change only `start` and `end`;
6. set `sendUpdates=none` so Gmail is the sole intended email channel;
7. persist the resulting ETag and verify desired start/end.

Restore is allowed only when the current event still equals Rewind's recorded after-state. A mismatch or `412 Precondition Failed` becomes `conflict`; do not retry with a fresh ETag or overwrite.

Reset requires its own immutable approved plan. Preflight both events against that plan before the first write. Because two provider calls cannot be atomic, persist each resulting ETag immediately; a race/partial reset remains `attention_required`, retains the scenario lock, and requires a new exact reset plan. Only two verified baseline states may produce `reset_complete`.

Google recommends ETags and `If-Match` to prevent lost modifications: [Get specific versions of resources](https://developers.google.com/workspace/calendar/api/guides/version-resources).

## 7. Gmail safety

- Build subject, body, recipients, and headers deterministically from an allowlisted template.
- Put a unique run ID in the subject, for example `[Rewind run_abc123]`.
- Display exact content and recipients in the plan; hash the same values into the plan digest.
- Exclude the connected organizer, declined attendees, and every address not on the explicit allowlist.
- Recheck the allowlist immediately before send.
- Create and claim the action ledger row before dispatch.
- Complete schema/MIME/allowlist/token preparation while `dispatch_started_at` is null. Those local failures alone may be retried through controlled resume.
- Persist `dispatch_started_at` before transport handoff, then attempt the approved send once and store returned message/thread IDs.
- A valid 2xx/message ID is success. An explicit non-timeout 4xx rejection is permanent failure and is not automatically retried.
- Any 408/429/5xx, malformed success, cancellation, timeout, connection/transport exception, or process failure after handoff becomes `delivery_uncertain` and blocks automatic resend.
- A Gmail action whose `in_progress` lease expires without a receipt also becomes `delivery_uncertain`; absence of a local receipt is not evidence that no message was sent.
- Never say “undo email.” Use “send correction,” and preserve the original receipt.
- Reset does not search, delete, or modify sent messages.

The application does not have read/compose/modify scopes and therefore cannot positively reconcile all ambiguous send outcomes. That limitation is preferable to broader mailbox access for this MVP and must remain visible.

## 8. AI safety boundary

- Use the OpenAI Responses API with strict Structured Outputs and `store: false`.
- Supply synthetic aliases/digests instead of raw attendee addresses and avoid unnecessary mail bodies/provider metadata in prompts.
- Separate trusted instructions from untrusted task, correction, and provider strings.
- Candidate titles/descriptions are data, never instructions. The controlled seeder must avoid adversarial content; evals still include prompt-injection-like fixtures.
- The model proposes assumptions, dependency edges, recovery outcomes/templates, account-brief content, and one typed rule only from supplied candidate/action/template/rule universes.
- Deterministic code checks the provider-grounded initial rank, complete dependency graph, artifact source/output independence, every recovery decision, typed rule bounds, and all exact effects.
- A refusal, truncation, absent parsed output, schema error, unknown ID, or semantic incompatibility is a failed planning attempt.
- Retry once with structured validation errors; after that, fail visibly and execute nothing.
- Record model, prompt version, schema version, reasoning configuration, and response ID where available.
- Never store chain-of-thought or request it in product logs.

`store: false` avoids optional Responses application-state storage, but it does not promise zero provider retention; default API abuse-monitoring logs may be retained under OpenAI's current data controls. Use synthetic demo data and review [OpenAI API data controls](https://platform.openai.com/docs/models/default-usage-policies-by-endpoint).

## 9. Data inventory and minimization

| Data | Why needed | Storage | Default deletion |
|---|---|---|---|
| Task request/correction | Render plans and reproduce evaluation | PostgreSQL | 7 days after final demo |
| Candidate event ID/title/region/time/ETag | Target, preview, concurrency check | PostgreSQL | 7 days |
| Attendee addresses | Exact approval and allowlist execution | Encrypted-at-rest database plan/action data | 7 days |
| Before/desired/after Calendar fields | Restore, verify, audit | Typed JSONB | 7 days |
| Mail subject/body and recipient list | Exact approval and deterministic send | Encrypted-at-rest plan/action data | 7 days |
| Gmail message/thread IDs | Receipt and timeline | PostgreSQL | 7 days |
| Account brief and source hash | Demonstrate preserve/provenance | PostgreSQL | Reset removes active artifact; archive deleted by day 7 |
| Plan/model metadata and audit events | Approval integrity, debugging, evidence | PostgreSQL, redacted logs | 7 days |
| OAuth refresh token | Live provider access | Encrypted secret/token store | Revoke/delete after final demo or incident |
| Sent messages | External consequence | Controlled Gmail sender/recipient accounts | Not changed by reset; account owners clean up separately |

Do not store full Calendar histories, mailbox histories, unrelated events, unrelated messages, provider access tokens in logs, or raw model reasoning.

## 10. Logging and observability

Allowed log fields:

- request/task/run/plan/action IDs;
- operation type, status, duration, retry number;
- redacted provider receipt suffix/hash;
- validation/error code and HTTP status class;
- model/prompt/schema version and token counts if available.

Forbidden log fields:

- API keys, bearer/CSRF/session/OAuth tokens;
- complete event descriptions or account notes;
- attendee addresses and recipient lists;
- complete mail bodies/subjects;
- raw model prompts/responses containing user data;
- database URLs or encryption material.

The product timeline comes from explicitly redacted audit events, not copied server logs.

## 11. Threat and failure model

| Threat/failure | Primary control | Safe result |
|---|---|---|
| Public/enumerated review URL | Authenticated session and ownership check | `unauthorized`/`forbidden` |
| MCP attempts approval | Scoped create/read token; no approval tool | Request rejected |
| Double click or HTTP replay | Idempotency record plus unique action key | Original response; no redispatch |
| Two active scenarios | Database scenario lock | `409 scenario_busy` |
| Plan changes after approval | Immutable plan and digest check | New preview/approval required |
| Human edits Calendar after preview/action | ETag and after-state checks | `provider_conflict`; no overwrite |
| Calendar sends duplicate native mail | `sendUpdates=none`; live smoke test | Gmail remains sole intended mail channel |
| Unknown recipient injection | Closed candidate set and final allowlist check | Plan rejected before adapter |
| Prompt injection in task/event text | Treat as data; closed IDs/templates; semantic validator | Plan rejected or ignored text |
| Invalid/omitted model decision | Exact completed-action coverage validation | One retry, then safe failure |
| Gmail timeout after possible send | `delivery_uncertain`; no auto-retry | Operator sees unresolved effect |
| OAuth callback replay/account substitution | Single-use state/nonce, PKCE, claim validation, stable-sub binding | Callback rejected; no token stored |
| Process dies mid-plan | Durable ledger and lease-expiry reconciliation by action type | Calendar reconciles; stale Gmail becomes uncertain; resume only proven-safe work |
| Reset overwrites external edit | Approved reset plan, two-event preflight, conditional restore | `reset_conflict`; zero writes/lock retained |
| Reset races after preflight | Per-write receipt/rolling ETag and honest partial state | No reset claim; lock retained/new plan required |
| Seed/spike utility misused | TTY-only admin policy, demo tags/allowlists, CI/prod refusal | Command rejects before dispatch |
| OAuth token expires | Day 1 test, preflight, T-24h reauth | Integration unavailable; no fake success |
| Secret appears in logs/client | Redaction tests and server-only secret access | Build/test fails; rotate if exposed |

## 12. Incident response for the demo

If a recipient, event, token, or action may be wrong:

1. Stop execution and disable the relevant endpoint/credential.
2. Preserve the action ledger and redacted receipts; do not clear evidence.
3. Revoke Google/MCP/OpenAI credentials if exposure is suspected.
4. Inspect controlled Calendar and sender accounts manually without claiming automated recovery.
5. Notify every controlled recipient affected by an erroneous message.
6. Record the incident and corrective decision in `DECISIONS.md`/`PROGRESS.md`.
7. Rerun the relevant failure and five-run gates before recording.

## 13. Explicit production gaps

Before any real-user pilot, Rewind would need security/privacy/legal review, verified OAuth consent as applicable, robust user/workspace authorization, key management and rotation, configurable retention/deletion, audit export, rate limiting, abuse handling, data-subject workflows, incident operations, provider reconciliation strategy, comprehensive prompt-injection testing, and support for real concurrency/conflicts. None is implied by the hackathon MVP.
