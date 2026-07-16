import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { buildG2ClosureReport } from "@/lib/services/g2-closure";

export function verifyG2Closure(root = process.cwd()) {
  return buildG2ClosureReport(root);
}

function main(): void {
  const report = verifyG2Closure();
  process.stdout.write(`${JSON.stringify(report)}\n`);
  if (report.status === "blocked") process.exitCode = 1;
}

const entrypoint = process.argv[1];
if (entrypoint && import.meta.url === pathToFileURL(resolve(entrypoint)).href) main();
