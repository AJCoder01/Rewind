import { RequirementTraceSchema, type RequirementTrace } from "./schema";
import type { TraceabilityFixtureId } from "./fixture-registry";

export const TRACEABILITY_CATALOG_VERSION = "traceability.v1";

const foundationEvidence = [
  "artifacts/test-runs/2026-07-15-foundation-audit.md",
  "artifacts/test-runs/2026-07-15-codebase-cleanup-audit.md",
];
const fixtureEvidence = [...foundationEvidence, "artifacts/test-runs/2026-07-15-s014-content-ui.md"];
const g1Evidence = [
  ...fixtureEvidence,
  "artifacts/test-runs/2026-07-15-s019-s027-g1.md",
  "artifacts/test-runs/2026-07-16-s028-deployed.md",
  "artifacts/test-runs/2026-07-16-s029-interface-freeze.md",
  "artifacts/test-runs/2026-07-16-s030-g1-close.md",
];
const oauthEvidence = [
  ...g1Evidence,
  "artifacts/test-runs/2026-07-16-s031-oauth-transaction.md",
  "artifacts/test-runs/2026-07-16-s032-google-identity.md",
  "artifacts/test-runs/2026-07-16-s033-oauth-negative.md",
];
const providerEvidence = [...oauthEvidence, "artifacts/test-runs/2026-07-16-s034-provider-ports.md"];
const calendarSetupEvidence = [...providerEvidence, "artifacts/test-runs/2026-07-16-s035-calendar-setup.md", "artifacts/test-runs/2026-07-16-s035-live-closure.md"];
const calendarPrimitiveEvidence = [...calendarSetupEvidence, "artifacts/test-runs/2026-07-16-s036-calendar-primitives.md"];
const calendarExecutionEvidence = [...calendarPrimitiveEvidence, "artifacts/test-runs/2026-07-16-s054-calendar-execution.md"];
const artifactEvidence = [...calendarPrimitiveEvidence, "artifacts/test-runs/2026-07-16-s038-gmail-live-proof.md", "artifacts/test-runs/2026-07-16-s039-artifact-boundary.md", "artifacts/test-runs/2026-07-16-s053-artifact-execution.md"];
const modelEvidence = [
  ...artifactEvidence,
  "artifacts/test-runs/2026-07-16-s040-openai-responses.md",
  "artifacts/test-runs/2026-07-16-s041-model-schemas.md",
  "artifacts/test-runs/2026-07-16-s042-model-safety.md",
  "artifacts/test-runs/2026-07-16-s043-model-transport-correction.md",
  "artifacts/test-runs/2026-07-16-s043-openai-rate-limit-blocker.md",
  "artifacts/test-runs/2026-07-16-s043-local-model-runtime.md",
  "artifacts/test-runs/2026-07-16-s043-provider-model-spike-success.md",
];
const initialFixtures: TraceabilityFixtureId[] = ["fixture-initial.v1", "controlled-content.v1", "artifact-independence.v1"];
const modelSafetyFixtures: TraceabilityFixtureId[] = ["traceability.v1", "model-safety.v1"];
const intakeCode = ["app/page.tsx", "app/api/v1/world-prs/route.ts", "lib/services/world-pr.ts", "mcp/server.ts"];
const intakeTests = ["tests/unit/world-pr.test.ts", "tests/unit/g1-routes-auth.test.ts", "tests/unit/g1-mcp.test.ts", "scripts/test-e2e.ts"];

function current(
  entry: Omit<RequirementTrace, "status" | "note"> & { status?: "covered" | "partial"; note: string },
): RequirementTrace {
  return RequirementTraceSchema.parse({ ...entry, status: entry.status ?? "covered" });
}

function planned(id: string, kind: RequirementTrace["kind"], title: string, planTasks: readonly string[], note: string): RequirementTrace {
  return RequirementTraceSchema.parse({
    id,
    kind,
    title,
    status: "planned",
    planTasks,
    codePaths: [],
    testPaths: [],
    fixtureIds: [],
    evidencePaths: [],
    note,
  });
}

export const REQUIREMENT_TRACEABILITY: readonly RequirementTrace[] = [
  current({
    id: "FR-01", kind: "FR", title: "Supported dashboard and MCP intake", planTasks: ["S006", "S019", "S024", "S025"],
    codePaths: intakeCode, testPaths: intakeTests, fixtureIds: initialFixtures, evidencePaths: fixtureEvidence,
    status: "partial", note: "The local fixture slice proves the shared service and unsupported-request boundary; live candidate retrieval remains planned.",
  }),
  current({
    id: "FR-02", kind: "FR", title: "Create idempotency", planTasks: ["S006", "S021"],
    codePaths: ["lib/db/store.ts", "lib/db/memory-store.ts", "lib/db/postgres-store.ts", "lib/services/world-pr.ts"], testPaths: ["tests/unit/world-pr.test.ts", "tests/unit/g1-memory-store.test.ts", "tests/unit/postgres-store.test.ts"],
    fixtureIds: ["fixture-initial.v1"], evidencePaths: g1Evidence, status: "partial",
    note: "Identical, conflicting, in-progress, and safely failed fixture/database claims are covered; deployed durable proof remains S028–S030 and external action replay remains future work.",
  }),
  current({
    id: "FR-03", kind: "FR", title: "Scenario lock and clarification ordering", planTasks: ["S006", "S021", "S077"],
    codePaths: ["lib/db/memory-store.ts", "lib/db/postgres-store.ts", "lib/domain/fixture-world-pr.ts"], testPaths: ["tests/unit/world-pr.test.ts", "tests/unit/g1-memory-store.test.ts", "tests/unit/postgres-store.test.ts"],
    fixtureIds: ["acme-demo", "fixture-initial.v1"], evidencePaths: g1Evidence, status: "partial",
    note: "The fixture effect-bearing lock, planning lease, and active-rule clarification-before-lock ordering are covered; deployed durable proof remains S028–S030.",
  }),
  current({
    id: "FR-04", kind: "FR", title: "Exactly two controlled Calendar candidates", planTasks: ["S035", "S047"],
    codePaths: ["lib/google/calendar.ts", "lib/domain/calendar-demo.ts", "lib/services/calendar-demo.ts"],
    testPaths: ["tests/unit/google-calendar.test.ts", "tests/unit/calendar-demo.test.ts"],
    fixtureIds: ["traceability.v1"], evidencePaths: calendarSetupEvidence, status: "partial",
    note: "S035 implements exact tagged discovery, strict two-candidate validation, and deterministic seed/preflight proof; live connected-calendar discovery and ranking remain gated by the human provider step and S047.",
  }),
  current({
    id: "FR-05", kind: "FR", title: "Pre-lock active-rule evaluation", planTasks: ["S021", "S023", "S077", "S078"],
    codePaths: ["lib/contracts/v1.ts", "lib/domain/fixture-world-pr.ts", "lib/db/memory-store.ts", "lib/db/postgres-store.ts"], testPaths: ["tests/unit/g1-contracts.test.ts", "tests/unit/g1-memory-store.test.ts"],
    fixtureIds: ["fixture-initial.v1"], evidencePaths: g1Evidence, status: "partial",
    note: "The typed fixture rule is evaluated before the effect-bearing lock and produces a clarification-only read model; live provider rule retrieval and activation remain future work.",
  }),
  current({
    id: "FR-06", kind: "FR", title: "Deterministic UK ranking with US alternative", planTasks: ["S006", "S023", "S047"],
    codePaths: ["lib/domain/fixture-world-pr.ts", "app/pr/[worldPrId]/page.tsx"], testPaths: ["tests/unit/contracts-v1.test.ts", "scripts/test-e2e.ts"],
    fixtureIds: initialFixtures, evidencePaths: g1Evidence, status: "partial",
    note: "The complete fixture ranking is visible; provider-grounded ranking remains planned.",
  }),
  current({
    id: "FR-07", kind: "FR", title: "World PR assumption and action preview", planTasks: ["S006", "S050"],
    codePaths: ["lib/domain/fixture-world-pr.ts", "app/pr/[worldPrId]/page.tsx"], testPaths: ["tests/unit/contracts-v1.test.ts", "scripts/test-e2e.ts"],
    fixtureIds: initialFixtures, evidencePaths: g1Evidence, note: "The non-effecting preview contains the request, assumption, evidence, actions, dependencies, and digest.",
  }),
  current({
    id: "FR-08", kind: "FR", title: "Exact time, recipient, and content preview", planTasks: ["S006", "S050"],
    codePaths: ["lib/domain/fixture-world-pr.ts", "app/pr/[worldPrId]/page.tsx"], testPaths: ["tests/unit/controlled-content.test.ts", "scripts/test-e2e.ts"],
    fixtureIds: initialFixtures, evidencePaths: g1Evidence, note: "Fixture exact times, zone, duration, synthetic recipient, mail, and brief provenance are rendered.",
  }),
  current({
    id: "FR-09", kind: "FR", title: "Cancel and return controls", planTasks: ["S026", "S051"],
    codePaths: ["app/api/v1/world-prs/[worldPrId]/cancel/route.ts", "lib/services/world-pr.ts", "lib/db/memory-store.ts", "app/pr/[worldPrId]/page.tsx"], testPaths: ["tests/unit/g1-routes-auth.test.ts", "tests/unit/g1-memory-store.test.ts", "scripts/test-e2e.ts"],
    fixtureIds: ["fixture-initial.v1"], evidencePaths: g1Evidence, status: "partial",
    note: "Preview and clarification cancellation release only the owned fixture lock and return to the composer; approval/execution cancellation remains future work.",
  }),
  planned("FR-10", "FR", "Immutable initial approval record", ["S046", "S051"], "Approval persistence is intentionally deferred until execution work."),
  current({
    id: "FR-11", kind: "FR", title: "Approval invalidation on drift", planTasks: ["S051", "S054"],
    codePaths: ["lib/services/initial-execution.ts", "lib/services/initial-calendar-execution.ts", "lib/contracts/initial-calendar-execution.ts"],
    testPaths: ["tests/unit/initial-execution.test.ts", "tests/unit/initial-calendar-execution.test.ts"], fixtureIds: ["initial-plan.v1"], evidencePaths: calendarExecutionEvidence,
    status: "partial", note: "The approved Calendar action fails closed on ETag, target, ownership/type/recurrence/tag, organizer, attendee/allowlist, or time drift; Gmail and full workflow invalidation remain S055/S057.",
  }),
  current({
    id: "FR-12", kind: "FR", title: "Durable unique action ledger", planTasks: ["S046", "S052"],
    codePaths: ["lib/db/execution-store.ts", "lib/services/initial-execution.ts"], testPaths: ["tests/unit/execution-persistence.test.ts", "tests/unit/initial-execution.test.ts"], fixtureIds: ["initial-plan.v1"], evidencePaths: calendarExecutionEvidence,
    status: "partial", note: "The memory/PostgreSQL ledgers persist immutable plans, approvals, unique action rows, leases, before/after state, typed receipts, and terminal outcomes; full workflow/UI verification remains S055–S057.",
  }),
  current({
    id: "FR-13", kind: "FR", title: "Calendar pre-mutation validation", planTasks: ["S036", "S054"],
    codePaths: ["lib/domain/calendar-demo.ts", "lib/services/calendar-primitives.ts", "lib/services/initial-calendar-execution.ts", "lib/contracts/initial-calendar-execution.ts", "lib/google/calendar.ts"],
    testPaths: ["tests/unit/calendar-primitives.test.ts", "tests/unit/google-calendar.test.ts", "tests/unit/initial-calendar-execution.test.ts"], fixtureIds: ["traceability.v1", "initial-plan.v1"], evidencePaths: calendarExecutionEvidence,
    status: "partial", note: "S036 verifies the primitive boundary and S054 rechecks the approved target/version, controlled ownership/type/recurrence/tag, organizer/attendee allowlist, and exact plan times before the action-ledger write; live product proof remains S058.",
  }),
  current({
    id: "FR-14", kind: "FR", title: "Conditional narrow Calendar write", planTasks: ["S036", "S054"],
    codePaths: ["lib/google/calendar.ts", "lib/services/calendar-primitives.ts", "lib/services/initial-calendar-execution.ts", "lib/contracts/initial-calendar-execution.ts", "lib/db/demo-event-state.ts"],
    testPaths: ["tests/unit/calendar-primitives.test.ts", "tests/unit/google-calendar.test.ts", "tests/unit/initial-calendar-execution.test.ts"], fixtureIds: ["traceability.v1", "initial-plan.v1"], evidencePaths: calendarExecutionEvidence,
    status: "partial", note: "S036 proves start/end-only, If-Match, sendUpdates=none, verified rolling versions, restore, and conflict/uncertain outcomes; S054 adds approved action-ledger ordering, before/after snapshots, new-ETag verification, and replay safety with deterministic fakes.",
  }),
  current({
    id: "FR-15", kind: "FR", title: "Allowlisted Gmail notification", planTasks: ["S037", "S038", "S055"],
    codePaths: ["lib/config/environment.ts", "lib/contracts/provider-ports.ts", "lib/contracts/gmail-delivery.ts", "lib/contracts/gmail-live-proof.ts", "lib/contracts/initial-gmail-execution.ts", "lib/domain/gmail-template.ts", "lib/adapters/gmail.ts", "lib/google/gmail.ts", "lib/db/gmail-dispatch.ts", "lib/db/gmail-live-proof.ts", "lib/services/gmail-delivery.ts", "lib/services/gmail-live-proof.ts", "lib/services/initial-gmail-execution.ts", "scripts/prove-gmail.ts"],
    testPaths: ["tests/unit/gmail-delivery.test.ts", "tests/unit/gmail-dispatch-store.test.ts", "tests/unit/gmail-live-proof.test.ts", "tests/unit/gmail-live-proof-store.test.ts", "tests/unit/google-gmail.test.ts", "tests/unit/provider-ports.test.ts", "tests/unit/initial-gmail-execution.test.ts"],
    fixtureIds: ["traceability.v1", "initial-plan.v1"], evidencePaths: [...calendarPrimitiveEvidence, "artifacts/test-runs/2026-07-16-s037-gmail-at-most-once.md", "artifacts/test-runs/2026-07-16-s055-gmail-execution.md"], status: "partial",
    note: "S037 proves the deterministic allowlist/template/MIME boundary, marker-before-handoff persistence hook, typed provider outcomes, and no-redispatch replay; S055 integrates the exact approved action after the artifact/Calendar dependencies and records sent/permanent/uncertain/conflict outcomes; one human-confirmed live success/replay remains S038/S058.",
  }),
  current({
    id: "FR-16", kind: "FR", title: "Independent brief provenance and exact bytes", planTasks: ["S006", "S014", "S039", "S053"],
    codePaths: ["lib/domain/account-brief.ts", "lib/domain/fixture-world-pr.ts", "lib/contracts/provider-ports.ts", "lib/contracts/v1.ts", "lib/services/account-brief.ts", "lib/adapters/artifact.ts"], testPaths: ["tests/unit/world-pr.test.ts", "tests/unit/controlled-content.test.ts", "tests/unit/account-brief.test.ts", "tests/unit/provider-ports.test.ts"],
    fixtureIds: ["controlled-content.v1", "artifact-independence.v1"], evidencePaths: artifactEvidence, status: "partial",
    note: "S039 now generates only from the versioned source, rejects closed leakage dimensions, binds source/content hashes, and persists exact approved bytes without regeneration; product action-ledger integration remains S053.",
  }),
  planned("FR-17", "FR", "Durable timeline receipts and honest outcomes", ["S052", "S056"], "The fixture timeline is a preview shell; action receipts are future work."),
  planned("FR-18", "FR", "Safe retry and resume", ["S021", "S052", "S057"], "Resume semantics require the action ledger and provider adapters."),
  planned("FR-19", "FR", "Late context only after completed execution", ["S060"], "Initial execution and late-context intake are not implemented."),
  planned("FR-20", "FR", "Explicit corrected target and provider grounding", ["S060", "S061"], "Recovery planning is not implemented."),
  current({
    id: "FR-21", kind: "FR", title: "Strict recovery proposal universe", planTasks: ["S041", "S042", "S062", "S063"],
    codePaths: ["lib/contracts/provider-ports.ts", "lib/ai/model-schemas.ts", "lib/ai/model-safety.ts"], testPaths: ["tests/unit/model-schemas.test.ts", "tests/unit/model-safety.test.ts", "tests/unit/provider-ports.test.ts"],
    fixtureIds: modelSafetyFixtures, evidencePaths: modelEvidence, status: "partial",
    note: "S041 closes the recovery shape and S042 validates explicit targets, succeeded-action coverage, compatible outcomes, safe preserve, fixed templates, and allowlisted deterministic recipient expansion; complete recovery planning remains S062–S063.",
  }),
  current({
    id: "FR-22", kind: "FR", title: "Complete recovery decision validation", planTasks: ["S042", "S063"],
    codePaths: ["lib/ai/model-safety.ts"], testPaths: ["tests/unit/model-safety.test.ts"], fixtureIds: modelSafetyFixtures, evidencePaths: modelEvidence, status: "partial",
    note: "S042 proves deterministic cross-field validation and bounded retry/failure behavior for the model proposal; provider-grounded recovery expansion and product integration remain S063.",
  }),
  planned("FR-23", "FR", "Fixed Causal Revert visualization", ["S065"], "The current UI has no recovery graph."),
  planned("FR-24", "FR", "Recovery cancel/revise", ["S065", "S072"], "Recovery mutation routes are future work."),
  planned("FR-25", "FR", "Recovery approval digest binding", ["S064", "S066"], "Recovery approval is future work."),
  planned("FR-26", "FR", "Recovery preflight and fixed order", ["S067", "S068"], "Recovery provider execution is future work."),
  planned("FR-27", "FR", "Honest recovery attention states", ["S069", "S072"], "Recovery attention handling is future work."),
  current({
    id: "FR-28", kind: "FR", title: "Typed prevention-rule proposal", planTasks: ["S041", "S042", "S075"],
    codePaths: ["lib/ai/model-schemas.ts", "lib/ai/model-safety.ts", "lib/contracts/v1.ts"], testPaths: ["tests/unit/model-schemas.test.ts", "tests/unit/model-safety.test.ts", "tests/unit/g1-contracts.test.ts"],
    fixtureIds: modelSafetyFixtures, evidencePaths: modelEvidence, status: "partial",
    note: "S041 closes the one typed Acme rule shape and S042 binds its source task while rejecting extra executable fields; generation, persistence, and separate activation remain S075–S076.",
  }),
  planned("FR-29", "FR", "Separate rule activation", ["S076"], "Rule activation is future work."),
  current({
    id: "FR-30", kind: "FR", title: "Clarification-only guardrail proof", planTasks: ["S021", "S023", "S077", "S079"],
    codePaths: ["lib/contracts/v1.ts", "lib/domain/fixture-world-pr.ts", "lib/db/memory-store.ts", "app/pr/[worldPrId]/page.tsx"], testPaths: ["tests/unit/g1-contracts.test.ts", "tests/unit/g1-memory-store.test.ts", "tests/unit/g1-routes-auth.test.ts"],
    fixtureIds: ["fixture-initial.v1"], evidencePaths: g1Evidence, status: "partial",
    note: "The fixture active-rule path persists a clarification with exactly two candidates and no plan/action/lock; separate rule activation and clarification resolution remain future work.",
  }),
  planned("FR-31", "FR", "Approved conditional reset", ["S080", "S081", "S082", "S083"], "Reset planning and execution are future work."),
  planned("FR-32", "FR", "Retained sent mail and audit evidence", ["S084", "S085"], "Reset UX and retention proof are future work."),

  planned("SAFE-01", "SAFE", "Human approval before external effects", ["S050", "S051", "S058"], "No external-effect product path exists yet."),
  planned("SAFE-02", "SAFE", "Exact recovery correction/intended mail disclosure", ["S064", "S066"], "Recovery mail preview is future work."),
  current({
    id: "SAFE-03", kind: "SAFE", title: "MCP cannot approve or execute", planTasks: ["S006", "S025"],
    codePaths: ["mcp/server.ts", "app/api/v1/world-prs/route.ts", "app/api/v1/world-prs/[worldPrId]/status/route.ts"], testPaths: ["tests/unit/g1-mcp.test.ts", "tests/unit/g1-routes-auth.test.ts", "scripts/test-e2e.ts"], fixtureIds: ["fixture-initial.v1"], evidencePaths: g1Evidence, status: "partial",
    note: "MCP exposes only create and safe status; it cannot approve, recover, activate a rule, reset, or receive provider credentials. Deployed proof remains S028–S030.",
  }),
  current({
    id: "SAFE-04", kind: "SAFE", title: "Authenticated dashboard and MCP boundaries", planTasks: ["S006", "S022"],
    codePaths: ["lib/auth/session.ts", "app/api/v1/auth/session/route.ts", "app/api/v1/world-prs/route.ts", "app/api/v1/world-prs/[worldPrId]/route.ts"], testPaths: ["tests/unit/auth.test.ts", "tests/unit/g1-routes-auth.test.ts", "scripts/test-e2e.ts"], fixtureIds: ["fixture-initial.v1"], evidencePaths: g1Evidence,
    note: "Dashboard sessions, origin checks, and scoped bearer authentication are covered for the fixture slice.",
  }),
  current({
    id: "SAFE-05", kind: "SAFE", title: "Controlled account/calendar/recipient boundary", planTasks: ["S010", "S032", "S033", "S034", "S035", "S037"],
    codePaths: ["lib/config/environment.ts", "lib/contracts/oauth.ts", "lib/contracts/provider-ports.ts", "lib/google/oauth.ts", "lib/google/oidc.ts", "lib/google/credentials.ts", "lib/db/oauth-store.ts", "lib/adapters/calendar.ts", "lib/adapters/gmail.ts", "lib/google/calendar.ts", "lib/domain/calendar-demo.ts", "lib/services/calendar-demo-command.ts"],
    testPaths: ["tests/unit/environment-config.test.ts", "tests/unit/google-identity.test.ts", "tests/unit/oauth-routes.test.ts", "tests/unit/oauth-transaction.test.ts", "tests/unit/oauth-store.test.ts", "tests/unit/provider-ports.test.ts", "tests/unit/google-calendar.test.ts", "tests/unit/calendar-demo.test.ts", "tests/unit/calendar-demo-command.test.ts"],
    fixtureIds: ["traceability.v1"], evidencePaths: calendarSetupEvidence, status: "partial",
    note: "S032 verifies the signed configured Google subject/email and exact identity scope boundary, S034 freezes typed Calendar/Gmail boundaries, and S035 adds explicit calendar targeting, exact-two ownership/type/tag validation, and deterministic setup failure outcomes; live ownership/seed proof and recipient allowlist enforcement remain S035/S037 provider-gate work.",
  }),
  current({
    id: "SAFE-06", kind: "SAFE", title: "Calendar ETag conflict protection", planTasks: ["S036", "S054", "S067"],
    codePaths: ["lib/adapters/calendar.ts", "lib/google/calendar.ts", "lib/services/calendar-primitives.ts", "lib/services/initial-calendar-execution.ts"], testPaths: ["tests/unit/calendar-primitives.test.ts", "tests/unit/google-calendar.test.ts", "tests/unit/initial-calendar-execution.test.ts"], fixtureIds: ["traceability.v1"], evidencePaths: calendarExecutionEvidence,
    status: "partial", note: "S036 and S054 fail closed on stale ETags and never rebase; recovery ETag protection remains S067.",
  }),
  current({
    id: "SAFE-07", kind: "SAFE", title: "Ambiguous Gmail delivery is not retried", planTasks: ["S034", "S037", "S055", "S069"],
    codePaths: ["lib/contracts/provider-ports.ts", "lib/contracts/gmail-delivery.ts", "lib/contracts/gmail-live-proof.ts", "lib/contracts/initial-gmail-execution.ts", "lib/google/gmail.ts", "lib/db/gmail-dispatch.ts", "lib/db/gmail-live-proof.ts", "lib/services/gmail-delivery.ts", "lib/services/gmail-live-proof.ts", "lib/services/initial-gmail-execution.ts", "scripts/prove-gmail.ts"],
    testPaths: ["tests/unit/gmail-delivery.test.ts", "tests/unit/gmail-dispatch-store.test.ts", "tests/unit/gmail-live-proof.test.ts", "tests/unit/gmail-live-proof-store.test.ts", "tests/unit/google-gmail.test.ts", "tests/unit/provider-ports.test.ts", "tests/unit/initial-gmail-execution.test.ts"],
    fixtureIds: ["traceability.v1", "initial-plan.v1"], evidencePaths: [...calendarPrimitiveEvidence, "artifacts/test-runs/2026-07-16-s037-gmail-at-most-once.md", "artifacts/test-runs/2026-07-16-s055-gmail-execution.md"], status: "partial",
    note: "S037 classifies permanent 4xx and every post-marker ambiguous class, persists the stopping receipt, and replays it without a second dispatch; S055 applies the same no-redispatch rule through the approved action ledger with leases and dependency ordering; live Gmail proof and recovery remain S038/S058/S069.",
  }),
  current({
    id: "SAFE-08", kind: "SAFE", title: "Closed strict model/action boundary", planTasks: ["S004", "S006", "S034", "S040", "S041", "S042", "S043"],
    codePaths: ["lib/contracts/v1.ts", "lib/contracts/initial-plan-server.ts", "lib/contracts/provider-ports.ts", "lib/contracts/provider-spike.ts", "lib/domain/fixture-world-pr.ts", "lib/ai/model.ts", "lib/ai/model-trusted-facts.ts", "lib/ai/openai-responses.ts", "lib/ai/openai-model.ts", "lib/ai/ollama-chat.ts", "lib/ai/ollama-model.ts", "lib/ai/model-schemas.ts", "lib/ai/model-safety.ts", "lib/services/provider-spike.ts"], testPaths: ["tests/unit/contracts-v1.test.ts", "tests/unit/g1-contracts.test.ts", "tests/unit/provider-ports.test.ts", "tests/unit/world-pr.test.ts", "tests/unit/openai-responses.test.ts", "tests/unit/openai-model.test.ts", "tests/unit/ollama-chat.test.ts", "tests/unit/ollama-model.test.ts", "tests/unit/model-schemas.test.ts", "tests/unit/model-safety.test.ts", "tests/unit/provider-spike.test.ts"], fixtureIds: [...initialFixtures, "model-safety.v1"], evidencePaths: modelEvidence, status: "partial",
    note: "Strict lifecycle/plan/provider contracts, OpenAI and loopback-only Ollama transports, closed proposal schemas, cross-field validators, and the shared two-attempt budget reject unknown fields/IDs/templates, unsafe dependencies, recipient injection, ambiguous targets, fallback success, cloud-local substitution, and retry amplification; the combined S043 receipt proves the selected local runtime, while product action integration remains future work.",
  }),
  current({
    id: "SAFE-09", kind: "SAFE", title: "Server-only private environment boundary", planTasks: ["S003", "S012", "S013", "S031", "S032", "S033"],
    codePaths: ["lib/config/environment.ts", "lib/db/config.ts", "lib/google/oauth.ts", "lib/google/oidc.ts", "lib/google/credentials.ts", "lib/db/oauth-store.ts", "db/migrations/0002_oauth_transaction.sql", "scripts/security-scan.ts"], testPaths: ["tests/unit/environment-config.test.ts", "tests/unit/db-config.test.ts", "tests/unit/google-identity.test.ts", "tests/unit/oauth-transaction.test.ts", "tests/unit/oauth-migration.test.ts", "tests/unit/oauth-routes.test.ts", "tests/unit/oauth-store.test.ts", "tests/unit/security-scan.test.ts"], fixtureIds: ["traceability.v1"], evidencePaths: [...oauthEvidence, "artifacts/test-runs/2026-07-15-s013-ci-security.md"], status: "partial",
    note: "Configuration validation, exact redirect/session binding, local signed identity checks, encrypted verifier/refresh-token storage, migration grants, tracked-file scanning, and the human S035/S043 provider refresh path are covered; the connection/preflight UI remains S044 work.",
  }),
  current({
    id: "SAFE-10", kind: "SAFE", title: "Controlled data minimization and redaction", planTasks: ["S003", "S012", "S013", "S032", "S033", "S035", "S089"],
    codePaths: ["lib/config/environment.ts", "lib/google/oidc.ts", "lib/google/credentials.ts", "lib/google/calendar.ts", "lib/services/calendar-demo-command.ts", "lib/db/migration-output.ts", "scripts/seed-demo.ts", "scripts/preflight-demo.ts", "scripts/security-scan.ts"], testPaths: ["tests/unit/environment-config.test.ts", "tests/unit/google-identity.test.ts", "tests/unit/oauth-routes.test.ts", "tests/unit/oauth-transaction.test.ts", "tests/unit/google-calendar.test.ts", "tests/unit/calendar-demo-command.test.ts", "tests/unit/migration-output.test.ts", "tests/unit/security-scan.test.ts"], fixtureIds: ["controlled-content.v1", "traceability.v1"], evidencePaths: [...calendarSetupEvidence, "artifacts/test-runs/2026-07-15-s013-ci-security.md"], status: "partial",
    note: "Synthetic fixture boundaries, no-mailbox identity validation, encrypted secret handling, safe environment/migration/provider errors, and S035 redacted command output/target fingerprints are covered; complete provider receipt/log redaction remains planned.",
  }),

  planned("NFR-01", "NFR", "Five consecutive live runs", ["S093", "S096"], "Live rehearsal is a final release gate."),
  current({
    id: "NFR-02", kind: "NFR", title: "Replay cannot duplicate work", planTasks: ["S006", "S021", "S027", "S037", "S052", "S053", "S054", "S055"],
    codePaths: ["lib/db/store.ts", "lib/db/memory-store.ts", "lib/db/postgres-store.ts", "lib/db/execution-store.ts", "lib/db/gmail-dispatch.ts", "lib/db/gmail-live-proof.ts", "lib/contracts/execution-persistence.ts", "lib/contracts/initial-artifact-execution.ts", "lib/contracts/initial-calendar-execution.ts", "lib/contracts/initial-gmail-execution.ts", "lib/services/gmail-delivery.ts", "lib/services/gmail-live-proof.ts", "lib/services/initial-execution.ts", "lib/services/initial-artifact-execution.ts", "lib/services/initial-calendar-execution.ts", "lib/services/initial-gmail-execution.ts"], testPaths: ["tests/unit/world-pr.test.ts", "tests/unit/g1-memory-store.test.ts", "tests/unit/postgres-store.test.ts", "tests/unit/gmail-delivery.test.ts", "tests/unit/gmail-dispatch-store.test.ts", "tests/unit/gmail-live-proof.test.ts", "tests/unit/gmail-live-proof-store.test.ts", "tests/unit/execution-persistence.test.ts", "tests/unit/initial-execution.test.ts", "tests/unit/initial-artifact-execution.test.ts", "tests/unit/initial-calendar-execution.test.ts", "tests/unit/initial-gmail-execution.test.ts"], fixtureIds: ["fixture-initial.v1", "initial-plan.v1", "traceability.v1"], evidencePaths: [...g1Evidence, "artifacts/test-runs/2026-07-16-s037-gmail-at-most-once.md", "artifacts/test-runs/2026-07-16-s053-artifact-execution.md", "artifacts/test-runs/2026-07-16-s054-calendar-execution.md", "artifacts/test-runs/2026-07-16-s055-gmail-execution.md"], status: "partial",
    note: "Create replay plus the S037 Gmail terminal/retryable/uncertain rules are covered without a second send; S052–S055 add durable action-ledger replay, dependency ordering, exact artifact/Calendar/Gmail execution receipts, and lease/busy protection; recovery replay remains future work.",
  }),
  current({
    id: "NFR-03", kind: "NFR", title: "Stale Calendar changes never overwrite", planTasks: ["S036", "S054", "S067"],
    codePaths: ["lib/services/calendar-primitives.ts", "lib/services/initial-calendar-execution.ts", "lib/adapters/calendar.ts", "lib/google/calendar.ts"], testPaths: ["tests/unit/calendar-primitives.test.ts", "tests/unit/google-calendar.test.ts", "tests/unit/initial-calendar-execution.test.ts"], fixtureIds: ["traceability.v1"], evidencePaths: calendarExecutionEvidence,
    status: "partial", note: "S036 and S054 prove stale preflight/conditional-write refusal with zero approved action writes; recovery remains S067.",
  }),
  current({
    id: "NFR-04", kind: "NFR", title: "Unknown inputs never reach adapters", planTasks: ["S004", "S006", "S023", "S034", "S035", "S037", "S039", "S040", "S041", "S042", "S043"],
    codePaths: ["lib/contracts/v1.ts", "lib/contracts/initial-plan-server.ts", "lib/contracts/provider-ports.ts", "lib/contracts/provider-spike.ts", "lib/contracts/gmail-delivery.ts", "lib/contracts/calendar-demo.ts", "lib/services/world-pr.ts", "lib/services/calendar-demo.ts", "lib/services/gmail-delivery.ts", "lib/services/account-brief.ts", "lib/services/provider-spike.ts", "lib/ai/openai-responses.ts", "lib/ai/openai-model.ts", "lib/ai/ollama-chat.ts", "lib/ai/ollama-model.ts", "lib/ai/model-schemas.ts", "lib/ai/model-safety.ts", "lib/db/memory-store.ts", "lib/db/demo-event-state.ts", "lib/db/gmail-dispatch.ts", "lib/adapters/calendar.ts", "lib/google/calendar.ts", "lib/adapters/gmail.ts", "lib/google/gmail.ts", "lib/adapters/artifact.ts", "lib/ai/model.ts"], testPaths: ["tests/unit/contracts-v1.test.ts", "tests/unit/g1-contracts.test.ts", "tests/unit/provider-ports.test.ts", "tests/unit/calendar-demo.test.ts", "tests/unit/google-calendar.test.ts", "tests/unit/gmail-delivery.test.ts", "tests/unit/gmail-dispatch-store.test.ts", "tests/unit/google-gmail.test.ts", "tests/unit/world-pr.test.ts", "tests/unit/account-brief.test.ts", "tests/unit/openai-responses.test.ts", "tests/unit/openai-model.test.ts", "tests/unit/ollama-chat.test.ts", "tests/unit/ollama-model.test.ts", "tests/unit/model-schemas.test.ts", "tests/unit/model-safety.test.ts", "tests/unit/provider-spike.test.ts", "tests/unit/g1-memory-store.test.ts"], fixtureIds: [...initialFixtures, "model-safety.v1"], evidencePaths: modelEvidence, status: "partial",
    note: "Closed fixture, Calendar, Gmail, artifact, Responses, S041 proposal, and S042 semantic contracts reject unknown IDs/templates/fields, unsafe preserve, ambiguous targets, and non-allowlisted recipients before any provider adapter; live product-service integration remains planned.",
  }),
  current({
    id: "NFR-05", kind: "NFR", title: "Recovery paraphrase and negative safety gates", planTasks: ["S042", "S070", "S071", "S091"],
    codePaths: ["lib/ai/model-safety.ts", "scripts/eval-model-safety.ts"], testPaths: ["tests/unit/model-safety.test.ts"], fixtureIds: modelSafetyFixtures, evidencePaths: modelEvidence, status: "partial",
    note: "S042 records representative valid/schema/semantic/injection/refusal/fallback checks with zero unsafe adapter calls; the complete 25-paraphrase and 100%-negative release gates remain S070/S071/S091.",
  }),
  current({
    id: "NFR-06", kind: "NFR", title: "Digest/actor/action traceability", planTasks: ["S004", "S005", "S006", "S015", "S046"],
    codePaths: ["lib/domain/digest.ts", "lib/db/migrate.ts", "lib/db/postgres-store.ts", "lib/db/store.ts"], testPaths: ["tests/unit/contracts-v1.test.ts", "tests/unit/migration-contract.test.ts", "tests/unit/postgres-store.test.ts", "tests/unit/g1-memory-store.test.ts"], fixtureIds: ["initial-plan.v1", "traceability.v1"], evidencePaths: [...g1Evidence, "artifacts/test-runs/2026-07-15-s015-traceability.md"], status: "partial",
    note: "Plan digest, idempotency actor/endpoint keys, transactional persistence, and this executable catalog are covered; approval/action receipts are future work.",
  }),
  current({
    id: "NFR-07", kind: "NFR", title: "Five-second recovery comprehension", planTasks: ["S065", "S072", "S090"],
    codePaths: ["app/page.tsx", "app/login/page.tsx", "app/pr/[worldPrId]/page.tsx", "docs/CONTROLLED_CONTENT_UI_INVENTORY.md"], testPaths: ["tests/unit/accessibility-contract.test.ts", "scripts/test-e2e.ts"], fixtureIds: ["controlled-content.v1"], evidencePaths: [...g1Evidence, "artifacts/test-runs/2026-07-15-s014-content-ui.md"], status: "partial",
    note: "The current composer/review states expose the important assumption, exact actions, dependencies, status labels, and safe failure states; the recovery screen and timed recovery review are not implemented.",
  }),
  current({
    id: "NFR-08", kind: "NFR", title: "Accessible reduced-motion demo", planTasks: ["S014", "S017", "S090"],
    codePaths: ["app/globals.css", "app/page.tsx", "app/login/page.tsx", "app/pr/[worldPrId]/page.tsx", "docs/CONTROLLED_CONTENT_UI_INVENTORY.md"], testPaths: ["tests/unit/accessibility-contract.test.ts", "scripts/test-e2e.ts"], fixtureIds: ["controlled-content.v1"], evidencePaths: [...g1Evidence, "artifacts/test-runs/2026-07-15-s014-content-ui.md", "artifacts/test-runs/2026-07-15-s017-accessibility.md"], status: "partial",
    note: "Stable selectors, semantic labels, focus, reduced-motion, responsive behavior, loading/empty/error/clarification/cancelled states, and honest fixture labeling cover the current screens; future surfaces remain planned.",
  }),
  planned("NFR-09", "NFR", "Reset returns baselines and retains mail", ["S080", "S082", "S085", "S093"], "Reset is future work."),
  current({
    id: "NFR-10", kind: "NFR", title: "No secret or production-data leakage", planTasks: ["S003", "S012", "S013", "S032", "S033", "S034", "S035", "S037", "S039", "S040", "S041", "S043", "S089"],
    codePaths: ["lib/config/environment.ts", "lib/auth/session.ts", "lib/api/errors.ts", "lib/contracts/provider-ports.ts", "lib/contracts/provider-spike.ts", "lib/contracts/gmail-delivery.ts", "lib/contracts/calendar-demo.ts", "lib/google/oidc.ts", "lib/google/credentials.ts", "lib/google/calendar.ts", "lib/google/gmail.ts", "lib/adapters/gmail.ts", "lib/adapters/artifact.ts", "lib/ai/model.ts", "lib/ai/openai-responses.ts", "lib/ai/ollama-chat.ts", "lib/ai/ollama-model.ts", "lib/ai/model-schemas.ts", "lib/services/gmail-delivery.ts", "lib/services/account-brief.ts", "lib/services/calendar-demo-command.ts", "lib/services/provider-spike.ts", "scripts/seed-demo.ts", "scripts/preflight-demo.ts", "scripts/prove-local-model.ts", "scripts/security-scan.ts", "docs/CONTROLLED_CONTENT_UI_INVENTORY.md"], testPaths: ["tests/unit/environment-config.test.ts", "tests/unit/google-identity.test.ts", "tests/unit/oauth-routes.test.ts", "tests/unit/oauth-transaction.test.ts", "tests/unit/provider-ports.test.ts", "tests/unit/account-brief.test.ts", "tests/unit/openai-responses.test.ts", "tests/unit/ollama-chat.test.ts", "tests/unit/ollama-model.test.ts", "tests/unit/model-schemas.test.ts", "tests/unit/google-calendar.test.ts", "tests/unit/google-gmail.test.ts", "tests/unit/gmail-delivery.test.ts", "tests/unit/gmail-dispatch-store.test.ts", "tests/unit/calendar-demo.test.ts", "tests/unit/calendar-demo-command.test.ts", "tests/unit/provider-spike.test.ts", "tests/unit/security-scan.test.ts", "tests/unit/g1-contracts.test.ts", "tests/unit/g1-mcp.test.ts"], fixtureIds: ["controlled-content.v1", "traceability.v1"], evidencePaths: [...modelEvidence, "artifacts/test-runs/2026-07-15-s013-ci-security.md"], status: "partial",
    note: "Tracked secret scanning, synthetic-content rules, S039 independent-artifact leakage rejection, S040 server-only API-key/header/redacted-error handling, S041 exclusion of executable provider and recipient/message fields, redacted command/status projections, server-only configuration, no-mailbox identity validation, encrypted secret handling, explicit Calendar target/TTY guards, Gmail redaction, and deterministic fakes are covered; complete application log/client leakage checks remain planned.",
  }),
] as const;

export const ParsedRequirementTraceability = REQUIREMENT_TRACEABILITY.map((entry) => RequirementTraceSchema.parse(entry));
