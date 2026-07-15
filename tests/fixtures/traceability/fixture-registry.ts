import { z } from "zod";

export const TRACEABILITY_FIXTURE_IDS = [
  "fixture-initial.v1",
  "acme-demo",
  "controlled-content.v1",
  "artifact-independence.v1",
  "initial-plan.v1",
  "traceability.v1",
  "golden-contracts.v1",
] as const;

export const TraceabilityFixtureIdSchema = z.enum(TRACEABILITY_FIXTURE_IDS);
export type TraceabilityFixtureId = z.infer<typeof TraceabilityFixtureIdSchema>;

export const TRACEABILITY_FIXTURE_REGISTRY: Readonly<Record<TraceabilityFixtureId, Readonly<{ sourcePaths: readonly string[] }>>> = {
  "fixture-initial.v1": { sourcePaths: ["lib/domain/fixture-world-pr.ts"] },
  "acme-demo": { sourcePaths: ["lib/domain/scenario.ts"] },
  "controlled-content.v1": { sourcePaths: ["lib/domain/account-brief.ts"] },
  "artifact-independence.v1": { sourcePaths: ["lib/domain/account-brief.ts"] },
  "initial-plan.v1": { sourcePaths: ["lib/contracts/v1.ts"] },
  "traceability.v1": { sourcePaths: ["tests/fixtures/traceability/catalog.ts"] },
  "golden-contracts.v1": { sourcePaths: ["tests/fixtures/contracts/golden.ts"] },
};
