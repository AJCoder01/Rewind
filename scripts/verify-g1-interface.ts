import { readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { ErrorCodeSchema, ActionStatusSchema, TaskStatusSchema } from "@/lib/contracts/v1";
import { statusForCode } from "@/lib/api/errors";
import { migrationChecksum } from "@/lib/db/migrate";
import { FOUNDATION_MIGRATION_CHECKSUM, FOUNDATION_TABLES, REWIND_CONSTRAINTS } from "@/lib/db/schema";
import { GOLDEN_CONTRACT_FIXTURE_VERSION, GOLDEN_ERROR_FIXTURES, GOLDEN_TASK_STATE_FIXTURES } from "@/tests/fixtures/contracts/golden";
import { TRACEABILITY_CATALOG_VERSION } from "@/tests/fixtures/traceability/catalog";
import {
  G1_FROZEN_ACTION_STATUSES,
  G1_FROZEN_ERROR_MATRIX,
  G1_FROZEN_EVIDENCE_PATHS,
  G1_FROZEN_FOUNDATION_CONSTRAINTS,
  G1_FROZEN_FOUNDATION_TABLES,
  G1_FROZEN_SCHEMA_VERSIONS,
  G1_FROZEN_TASK_STATUSES,
  G1_INTERFACE_PACKET_VERSION,
} from "@/tests/fixtures/g1-interface-packet";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

async function verify(): Promise<void> {
  assert(JSON.stringify(TaskStatusSchema.options) === JSON.stringify(G1_FROZEN_TASK_STATUSES), "task status schema drifted");
  assert(JSON.stringify(ActionStatusSchema.options) === JSON.stringify(G1_FROZEN_ACTION_STATUSES), "action status schema drifted");
  assert(JSON.stringify(G1_FROZEN_ERROR_MATRIX.map(({ code }) => code)) === JSON.stringify(ErrorCodeSchema.options), "error code schema drifted");
  assert(JSON.stringify(G1_FROZEN_ERROR_MATRIX.map(({ code }) => statusForCode(code))) === JSON.stringify(G1_FROZEN_ERROR_MATRIX.map(({ status }) => status)), "error HTTP status matrix drifted");
  assert(JSON.stringify(FOUNDATION_TABLES) === JSON.stringify(G1_FROZEN_FOUNDATION_TABLES), "foundation table catalog drifted");
  assert(JSON.stringify(REWIND_CONSTRAINTS.map(({ name }) => name)) === JSON.stringify(G1_FROZEN_FOUNDATION_CONSTRAINTS), "foundation constraint catalog drifted");
  assert(GOLDEN_CONTRACT_FIXTURE_VERSION === G1_FROZEN_SCHEMA_VERSIONS.goldenContracts, "golden fixture version drifted");
  assert(TRACEABILITY_CATALOG_VERSION === G1_FROZEN_SCHEMA_VERSIONS.traceability, "traceability version drifted");
  assert(GOLDEN_TASK_STATE_FIXTURES.length === G1_FROZEN_TASK_STATUSES.length, "golden lifecycle fixture coverage drifted");
  assert(JSON.stringify(GOLDEN_ERROR_FIXTURES.map(({ error }) => error.code)) === JSON.stringify(ErrorCodeSchema.options), "golden error fixture coverage drifted");

  const migrationPath = resolve("db/migrations/0001_phase0_foundation.sql");
  assert(migrationChecksum(await readFile(migrationPath, "utf8")) === FOUNDATION_MIGRATION_CHECKSUM, "foundation migration checksum drifted");
  for (const path of G1_FROZEN_EVIDENCE_PATHS) {
    assert(existsSync(resolve(path)), `missing frozen evidence path: ${path}`);
  }
  const deployedEvidence = await readFile(resolve("artifacts/test-runs/2026-07-16-s028-deployed.md"), "utf8");
  assert(deployedEvidence.includes("S028 deployed G1 proof"), "deployed evidence title missing");
  assert(deployedEvidence.includes("External effects"), "deployed evidence safety statement missing");
  process.stdout.write(`${JSON.stringify({ status: "ok", packetVersion: G1_INTERFACE_PACKET_VERSION, errorCodes: ErrorCodeSchema.options.length, taskStatuses: TaskStatusSchema.options.length, actionStatuses: ActionStatusSchema.options.length, evidenceFiles: G1_FROZEN_EVIDENCE_PATHS.length })}\n`);
}

const entrypoint = process.argv[1];
if (entrypoint && import.meta.url === pathToFileURL(resolve(entrypoint)).href) {
  verify().catch(() => {
    process.stdout.write('{"status":"failed","error":"G1 interface packet is not frozen"}\n');
    process.exitCode = 1;
  });
}
