import { existsSync } from "node:fs";
import { isAbsolute, relative, resolve, sep } from "node:path";
import { pathToFileURL } from "node:url";
import { ParsedRequirementTraceability, TRACEABILITY_CATALOG_VERSION } from "@/tests/fixtures/traceability/catalog";
import { TRACEABILITY_FIXTURE_REGISTRY } from "@/tests/fixtures/traceability/fixture-registry";
import { RequirementTraceSchema } from "@/tests/fixtures/traceability/schema";

function resolveRepositoryPath(root: string, path: string): string {
  const resolved = resolve(root, path);
  const relativePath = relative(root, resolved);
  if (relativePath === "" || relativePath === ".." || relativePath.startsWith(`..${sep}`) || isAbsolute(relativePath)) {
    throw new Error(`Trace path escapes the repository: ${path}`);
  }
  return resolved;
}

export function verifyTraceability(
  catalog = ParsedRequirementTraceability,
  root = process.cwd(),
): { total: number; covered: number; partial: number; planned: number } {
  const entries = catalog.map((entry) => RequirementTraceSchema.parse(entry));
  const ids = new Set<string>();
  for (const entry of entries) {
    if (ids.has(entry.id)) throw new Error(`Duplicate requirement trace: ${entry.id}`);
    ids.add(entry.id);
    for (const path of [...entry.codePaths, ...entry.testPaths, ...entry.evidencePaths]) {
      if (!existsSync(resolveRepositoryPath(root, path))) throw new Error(`Missing trace path for ${entry.id}: ${path}`);
    }
    for (const fixtureId of entry.fixtureIds) {
      const fixture = TRACEABILITY_FIXTURE_REGISTRY[fixtureId];
      if (!fixture) throw new Error(`Unknown trace fixture for ${entry.id}: ${fixtureId}`);
      for (const path of fixture.sourcePaths) {
        if (!existsSync(resolveRepositoryPath(root, path))) throw new Error(`Missing fixture source for ${entry.id}: ${fixtureId}`);
      }
    }
  }
  const expected = [
    ...Array.from({ length: 32 }, (_, index) => `FR-${String(index + 1).padStart(2, "0")}`),
    ...Array.from({ length: 10 }, (_, index) => `SAFE-${String(index + 1).padStart(2, "0")}`),
    ...Array.from({ length: 10 }, (_, index) => `NFR-${String(index + 1).padStart(2, "0")}`),
  ];
  if (entries.length !== expected.length || expected.some((id) => !ids.has(id))) throw new Error("Requirement traceability IDs are incomplete.");
  return {
    total: entries.length,
    covered: entries.filter((entry) => entry.status === "covered").length,
    partial: entries.filter((entry) => entry.status === "partial").length,
    planned: entries.filter((entry) => entry.status === "planned").length,
  };
}

function main(): void {
  try {
    process.stdout.write(`${JSON.stringify({ status: "ok", version: TRACEABILITY_CATALOG_VERSION, ...verifyTraceability() })}\n`);
  } catch {
    process.stdout.write('{"status":"failed","error":"requirement traceability is invalid"}\n');
    process.exitCode = 1;
  }
}

const entrypoint = process.argv[1];
if (entrypoint && import.meta.url === pathToFileURL(resolve(entrypoint)).href) main();
