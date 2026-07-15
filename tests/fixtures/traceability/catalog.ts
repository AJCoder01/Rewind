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
const oauthEvidence = [...g1Evidence, "artifacts/test-runs/2026-07-16-s031-oauth-transaction.md"];
const initialFixtures: TraceabilityFixtureId[] = ["fixture-initial.v1", "controlled-content.v1", "artifact-independence.v1"];
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
  planned("FR-04", "FR", "Exactly two controlled Calendar candidates", ["S035", "S047"], "Provider candidate retrieval is not implemented in the non-effecting slice."),
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
  planned("FR-11", "FR", "Approval invalidation on drift", ["S051", "S054"], "Provider/version drift checks are future provider-boundary work."),
  planned("FR-12", "FR", "Durable unique action ledger", ["S046", "S052"], "The foundation migration reserves the table; execution rows are not yet created by the service."),
  planned("FR-13", "FR", "Calendar pre-mutation validation", ["S036", "S054"], "Calendar adapter and ETag checks are not enabled."),
  planned("FR-14", "FR", "Conditional narrow Calendar write", ["S036", "S054"], "Calendar provider execution is not enabled."),
  planned("FR-15", "FR", "Allowlisted Gmail notification", ["S037", "S055"], "Gmail provider execution is not enabled."),
  current({
    id: "FR-16", kind: "FR", title: "Independent brief provenance and exact bytes", planTasks: ["S006", "S014", "S039", "S053"],
    codePaths: ["lib/domain/account-brief.ts", "lib/domain/fixture-world-pr.ts"], testPaths: ["tests/unit/world-pr.test.ts", "tests/unit/controlled-content.test.ts"],
    fixtureIds: ["controlled-content.v1", "artifact-independence.v1"], evidencePaths: fixtureEvidence, status: "partial",
    note: "Source/output independence and exact fixture hashes are covered; live generation/storage remains planned.",
  }),
  planned("FR-17", "FR", "Durable timeline receipts and honest outcomes", ["S052", "S056"], "The fixture timeline is a preview shell; action receipts are future work."),
  planned("FR-18", "FR", "Safe retry and resume", ["S021", "S052", "S057"], "Resume semantics require the action ledger and provider adapters."),
  planned("FR-19", "FR", "Late context only after completed execution", ["S060"], "Initial execution and late-context intake are not implemented."),
  planned("FR-20", "FR", "Explicit corrected target and provider grounding", ["S060", "S061"], "Recovery planning is not implemented."),
  planned("FR-21", "FR", "Strict recovery proposal universe", ["S062", "S063"], "Recovery model schemas are future work."),
  planned("FR-22", "FR", "Complete recovery decision validation", ["S063"], "Recovery semantic validation is future work."),
  planned("FR-23", "FR", "Fixed Causal Revert visualization", ["S065"], "The current UI has no recovery graph."),
  planned("FR-24", "FR", "Recovery cancel/revise", ["S065", "S072"], "Recovery mutation routes are future work."),
  planned("FR-25", "FR", "Recovery approval digest binding", ["S064", "S066"], "Recovery approval is future work."),
  planned("FR-26", "FR", "Recovery preflight and fixed order", ["S067", "S068"], "Recovery provider execution is future work."),
  planned("FR-27", "FR", "Honest recovery attention states", ["S069", "S072"], "Recovery attention handling is future work."),
  planned("FR-28", "FR", "Typed prevention-rule proposal", ["S075"], "Prevention rules are future work."),
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
  planned("SAFE-05", "SAFE", "Controlled account/calendar/recipient boundary", ["S010", "S032", "S035", "S037"], "Live identity, event ownership, and allowlist enforcement are provider-gate work."),
  planned("SAFE-06", "SAFE", "Calendar ETag conflict protection", ["S036", "S054", "S067"], "Calendar conditional execution is future work."),
  planned("SAFE-07", "SAFE", "Ambiguous Gmail delivery is not retried", ["S037", "S055", "S069"], "Gmail delivery semantics are future work."),
  current({
    id: "SAFE-08", kind: "SAFE", title: "Closed strict model/action boundary", planTasks: ["S004", "S006", "S041"],
    codePaths: ["lib/contracts/v1.ts", "lib/contracts/initial-plan-server.ts", "lib/domain/fixture-world-pr.ts"], testPaths: ["tests/unit/contracts-v1.test.ts", "tests/unit/g1-contracts.test.ts", "tests/unit/world-pr.test.ts"], fixtureIds: initialFixtures, evidencePaths: g1Evidence, status: "partial",
    note: "Strict fixture lifecycle, plan/action, prevention-rule, and reset-plan contracts reject unknown fields; live model schemas and semantic validators are planned.",
  }),
  current({
    id: "SAFE-09", kind: "SAFE", title: "Server-only private environment boundary", planTasks: ["S003", "S012", "S013", "S031"],
    codePaths: ["lib/config/environment.ts", "lib/db/config.ts", "lib/google/oauth.ts", "lib/google/credentials.ts", "lib/db/oauth-store.ts", "db/migrations/0002_oauth_transaction.sql", "scripts/security-scan.ts"], testPaths: ["tests/unit/environment-config.test.ts", "tests/unit/db-config.test.ts", "tests/unit/oauth-transaction.test.ts", "tests/unit/oauth-migration.test.ts", "tests/unit/oauth-routes.test.ts", "tests/unit/security-scan.test.ts"], fixtureIds: ["traceability.v1"], evidencePaths: [...oauthEvidence, "artifacts/test-runs/2026-07-15-s013-ci-security.md"], status: "partial",
    note: "Configuration validation, exact redirect/session binding, encrypted verifier/refresh-token storage, migration grants, and tracked-file scanning are covered; signed identity validation and live provider refresh remain S032/S043 work.",
  }),
  current({
    id: "SAFE-10", kind: "SAFE", title: "Controlled data minimization and redaction", planTasks: ["S003", "S012", "S013", "S089"],
    codePaths: ["lib/config/environment.ts", "lib/db/migration-output.ts", "scripts/security-scan.ts"], testPaths: ["tests/unit/environment-config.test.ts", "tests/unit/migration-output.test.ts", "tests/unit/security-scan.test.ts"], fixtureIds: ["controlled-content.v1", "traceability.v1"], evidencePaths: [...fixtureEvidence, "artifacts/test-runs/2026-07-15-s013-ci-security.md"], status: "partial",
    note: "Synthetic fixture boundaries and safe environment/migration errors are covered; complete provider/log redaction remains planned.",
  }),

  planned("NFR-01", "NFR", "Five consecutive live runs", ["S093", "S096"], "Live rehearsal is a final release gate."),
  current({
    id: "NFR-02", kind: "NFR", title: "Replay cannot duplicate work", planTasks: ["S006", "S021", "S027"],
    codePaths: ["lib/db/store.ts", "lib/db/memory-store.ts", "lib/db/postgres-store.ts"], testPaths: ["tests/unit/world-pr.test.ts", "tests/unit/g1-memory-store.test.ts", "tests/unit/postgres-store.test.ts"], fixtureIds: ["fixture-initial.v1"], evidencePaths: g1Evidence, status: "partial",
    note: "Identical, conflicting, concurrent, and safely failed create replay is covered without a second planning saga; external action replay remains planned with the action ledger.",
  }),
  planned("NFR-03", "NFR", "Stale Calendar changes never overwrite", ["S036", "S054", "S067"], "Provider stale-state proof is future work."),
  current({
    id: "NFR-04", kind: "NFR", title: "Unknown inputs never reach adapters", planTasks: ["S004", "S006", "S023", "S042"],
    codePaths: ["lib/contracts/v1.ts", "lib/contracts/initial-plan-server.ts", "lib/services/world-pr.ts", "lib/db/memory-store.ts"], testPaths: ["tests/unit/contracts-v1.test.ts", "tests/unit/g1-contracts.test.ts", "tests/unit/world-pr.test.ts", "tests/unit/g1-memory-store.test.ts"], fixtureIds: initialFixtures, evidencePaths: g1Evidence, status: "partial",
    note: "Closed fixture contracts and unsupported-request validation reject unknown request/action fields before an adapter boundary; complete provider adapter-boundary coverage is planned.",
  }),
  planned("NFR-05", "NFR", "Recovery paraphrase and negative safety gates", ["S070", "S071", "S091"], "Recovery evaluation fixtures are future work."),
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
    id: "NFR-10", kind: "NFR", title: "No secret or production-data leakage", planTasks: ["S003", "S012", "S013", "S089"],
    codePaths: ["lib/config/environment.ts", "lib/auth/session.ts", "lib/api/errors.ts", "scripts/security-scan.ts", "docs/CONTROLLED_CONTENT_UI_INVENTORY.md"], testPaths: ["tests/unit/environment-config.test.ts", "tests/unit/security-scan.test.ts", "tests/unit/g1-contracts.test.ts", "tests/unit/g1-mcp.test.ts"], fixtureIds: ["controlled-content.v1", "traceability.v1"], evidencePaths: [...g1Evidence, "artifacts/test-runs/2026-07-15-s013-ci-security.md"], status: "partial",
    note: "Tracked secret scanning, synthetic-content rules, redacted error/status projections, and production fake-mode refusal are covered; complete provider/log/client leakage checks remain planned.",
  }),
] as const;

export const ParsedRequirementTraceability = REQUIREMENT_TRACEABILITY.map((entry) => RequirementTraceSchema.parse(entry));
