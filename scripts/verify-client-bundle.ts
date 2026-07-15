import { readFile, readdir } from "node:fs/promises";
import { relative, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { scanText, type SecurityFinding } from "@/scripts/security-scan";

const privateEnvironmentPatterns: readonly RegExp[] = [
  /\bDATABASE_URL\b/,
  /\bDATABASE_MIGRATION_URL\b/,
  /\bMCP_BACKEND_TOKEN\b/,
  /\bREWIND_SESSION_SECRET\b/,
  /\bREWIND_TOKEN_ENCRYPTION_KEY\b/,
  /\bGOOGLE_CLIENT_SECRET\b/,
  /\bGOOGLE_REFRESH_TOKEN_CIPHERTEXT\b/,
  /\bOPENAI_API_KEY\b/,
];

export function scanClientText(file: string, text: string): readonly SecurityFinding[] {
  const findings = [...scanText(file, text)];
  if (privateEnvironmentPatterns.some((pattern) => pattern.test(text))) {
    findings.push({ file: file.replaceAll("\\", "/"), rule: "client-private-environment-name" });
  }
  return Array.from(new Map(findings.map((finding) => [`${finding.file}:${finding.rule}`, finding])).values());
}

async function listFiles(directory: string): Promise<string[]> {
  const entries = await readdir(directory, { withFileTypes: true });
  const files: string[] = [];
  for (const entry of entries) {
    const path = resolve(directory, entry.name);
    if (entry.isDirectory()) files.push(...(await listFiles(path)));
    else files.push(path);
  }
  return files;
}

export async function scanClientBundle(root = process.cwd()): Promise<{ status: "ok" | "failed"; scannedFiles: number; findings: readonly SecurityFinding[] }> {
  const staticRoot = resolve(root, ".next", "static");
  try {
    const files = await listFiles(staticRoot);
    const findings: SecurityFinding[] = [];
    for (const file of files) {
      const text = await readFile(file, "utf8");
      if (text.includes("\u0000")) continue;
      findings.push(...scanClientText(relative(root, file), text));
    }
    const uniqueFindings = Array.from(new Map(findings.map((finding) => [`${finding.file}:${finding.rule}`, finding])).values());
    return { status: uniqueFindings.length === 0 ? "ok" : "failed", scannedFiles: files.length, findings: uniqueFindings };
  } catch {
    return { status: "failed", scannedFiles: 0, findings: [] };
  }
}

async function main(): Promise<void> {
  const report = await scanClientBundle();
  process.stdout.write(`${JSON.stringify(report)}\n`);
  if (report.status === "failed") process.exitCode = 1;
}

const entrypoint = process.argv[1];
if (entrypoint && import.meta.url === pathToFileURL(resolve(entrypoint)).href) void main();
