import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import { ErrorCodeSchema, ActionStatusSchema, TaskStatusSchema } from "@/lib/contracts/v1";
import { statusForCode } from "@/lib/api/errors";
import { migrationChecksum } from "@/lib/db/migrate";
import {
  FOUNDATION_MIGRATION_CHECKSUM,
  FOUNDATION_TABLES,
  REWIND_CONSTRAINTS,
} from "@/lib/db/schema";
import {
  GOLDEN_CONTRACT_FIXTURE_VERSION,
  GOLDEN_ERROR_FIXTURES,
  GOLDEN_TASK_STATE_FIXTURES,
} from "@/tests/fixtures/contracts/golden";
import { TRACEABILITY_CATALOG_VERSION } from "@/tests/fixtures/traceability/catalog";
import {
  G1_FROZEN_ACTION_STATUSES,
  G1_FROZEN_ERROR_MATRIX,
  G1_FROZEN_EVIDENCE_PATHS,
  G1_FROZEN_FOUNDATION_CONSTRAINTS,
  G1_FROZEN_FOUNDATION_TABLES,
  G1_FROZEN_SCHEMA_VERSIONS,
  G1_FROZEN_TASK_STATUSES,
} from "@/tests/fixtures/g1-interface-packet";

describe("S029 frozen G1 interface packet", () => {
  it("locks lifecycle schemas and the complete error/status matrix", () => {
    expect(TaskStatusSchema.options).toEqual(G1_FROZEN_TASK_STATUSES);
    expect(ActionStatusSchema.options).toEqual(G1_FROZEN_ACTION_STATUSES);
    expect(G1_FROZEN_ERROR_MATRIX.map(({ code }) => code)).toEqual(ErrorCodeSchema.options);
    expect(G1_FROZEN_ERROR_MATRIX.map(({ code }) => statusForCode(code))).toEqual(G1_FROZEN_ERROR_MATRIX.map(({ status }) => status));
  });

  it("locks the reviewed migration catalog and checksum", async () => {
    const migration = await readFile(new URL("../../db/migrations/0001_phase0_foundation.sql", import.meta.url), "utf8");
    expect(migrationChecksum(migration)).toBe(FOUNDATION_MIGRATION_CHECKSUM);
    expect(FOUNDATION_TABLES).toEqual(G1_FROZEN_FOUNDATION_TABLES);
    expect([...REWIND_CONSTRAINTS.map(({ name }) => name)]).toEqual(G1_FROZEN_FOUNDATION_CONSTRAINTS);
  });

  it("locks every versioned fixture used by the G1 packet", () => {
    expect(G1_FROZEN_SCHEMA_VERSIONS).toEqual({
      api: "v1",
      initialPlan: "initial-plan.v1",
      goldenContracts: GOLDEN_CONTRACT_FIXTURE_VERSION,
      traceability: TRACEABILITY_CATALOG_VERSION,
      fixtureInitial: "fixture-initial.v1",
      controlledContent: "controlled-content.v1",
      artifactIndependence: "artifact-independence.v1",
      preventionRule: "prevention-rule.v1",
      resetPlan: "reset-plan.v1",
    });
    expect(GOLDEN_TASK_STATE_FIXTURES).toHaveLength(G1_FROZEN_TASK_STATUSES.length);
    expect(GOLDEN_ERROR_FIXTURES.map(({ error }) => error.code)).toEqual(ErrorCodeSchema.options);
  });

  it("requires local create/read browser evidence and deployed proof evidence", async () => {
    const contents = await Promise.all(G1_FROZEN_EVIDENCE_PATHS.map((path) => readFile(new URL(`../../${path}`, import.meta.url), "utf8")));
    expect(contents[0]).toContain("review UI");
    expect(contents[0]).toContain("MCP surface");
    expect(contents[1]).toContain("S028 deployed G1 proof");
    expect(contents[1]).toContain("External effects");
    expect(contents[2]).toContain("Review proposed workspace changes");
    expect(contents[2]).toContain("Cancel review");
  });
});
