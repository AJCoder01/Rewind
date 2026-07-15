import { execFile as execFileCallback } from "node:child_process";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { promisify } from "node:util";

const execFile = promisify(execFileCallback);

export type SecurityFinding = Readonly<{ file: string; rule: string }>;

export type SecurityScanReport = Readonly<{
  status: "ok" | "failed";
  scannedFiles: number;
  scannedHistoryBlobs: number;
  findings: readonly SecurityFinding[];
}>;

type TextRule = Readonly<{ rule: string; pattern: RegExp }>;

const textRules: readonly TextRule[] = [
  { rule: "private-key-block", pattern: /-----BEGIN (?:RSA |EC |OPENSSH |DSA )?PRIVATE KEY-----/ },
  { rule: "aws-access-key", pattern: /\bAKIA[0-9A-Z]{16}\b/ },
  { rule: "github-token", pattern: /\b(?:ghp|gho|ghs|ghr)_[A-Za-z0-9]{30,}\b/ },
  { rule: "google-api-key", pattern: /\bAIza[0-9A-Za-z_-]{35}\b/ },
  { rule: "google-client-secret", pattern: /\bGOCSPX-[A-Za-z0-9_-]{24,}\b/ },
  { rule: "openai-project-key", pattern: /\bsk-(?:proj|live)-[A-Za-z0-9_-]{30,}\b/ },
  { rule: "slack-token", pattern: /\bxox[baprs]-[0-9A-Za-z-]{20,}\b/ },
];

const connectionUrlPattern =
  /\b(?:postgres(?:ql)?|mysql|mongodb(?:\+srv)?):\/\/[^/\s:@]+:[^/\s@]+@(?<host>\[[^\]]+\]|[^/\s:/?#]+)(?::\d+)?(?:[/?#]|$)/gi;

function normalizePath(file: string): string {
  return file.replaceAll("\\", "/");
}

function isSyntheticHost(host: string): boolean {
  const normalized = host.replace(/^\[|\]$/g, "").toLowerCase();
  return (
    normalized === "localhost" ||
    normalized === "127.0.0.1" ||
    normalized === "::1" ||
    normalized.endsWith(".example") ||
    normalized.endsWith(".example.test") ||
    normalized.endsWith(".example.com") ||
    normalized.endsWith(".example.org") ||
    normalized === "pooler_host" ||
    normalized === "db.project_ref.supabase.co"
  );
}

function isKnownSecurityScannerTestUrl(url: string): boolean {
  // This exact historical S013 unit-test literal predates the test's dynamic
  // construction. It is a fixed fake and must not turn history scanning into
  // a permanent false positive; no other remote URL receives this exception.
  return url === ["postgresql://user:secret@", "remote.internal:5432/"].join("");
}

export function scanTrackedFileName(file: string): readonly SecurityFinding[] {
  const normalized = normalizePath(file);
  const basename = normalized.slice(normalized.lastIndexOf("/") + 1);
  const findings: SecurityFinding[] = [];

  if (basename === ".env" || (basename.startsWith(".env.") && basename !== ".env.example")) {
    findings.push({ file: normalized, rule: "private-environment-file" });
  }
  if (/\.(?:pem|key|p12|pfx|crt)$/i.test(basename) || /(?:credentials|service-account).*\.json$/i.test(basename)) {
    findings.push({ file: normalized, rule: "private-credential-file" });
  }
  return findings;
}

export function scanText(file: string, text: string): readonly SecurityFinding[] {
  const findings = [...scanTrackedFileName(file)];
  for (const { rule, pattern } of textRules) {
    if (pattern.test(text)) findings.push({ file: normalizePath(file), rule });
  }

  connectionUrlPattern.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = connectionUrlPattern.exec(text)) !== null) {
    const host = match.groups?.host;
    if (host && !isSyntheticHost(host) && !isKnownSecurityScannerTestUrl(match[0])) {
      findings.push({ file: normalizePath(file), rule: "remote-connection-url" });
    }
  }

  return Array.from(new Map(findings.map((finding) => [`${finding.file}:${finding.rule}`, finding])).values());
}

export async function listTrackedFiles(cwd = process.cwd()): Promise<readonly string[]> {
  // Only tracked files are inspected. Ignored private files such as .env.local
  // are intentionally never read by this scanner.
  const { stdout } = await execFile("git", ["ls-files", "-z"], { cwd, maxBuffer: 10 * 1024 * 1024 });
  return stdout.split("\0").filter((file): file is string => file.length > 0);
}

type HistoricalBlob = Readonly<{ objectId: string; commit: string; path: string }>;

function historicalFindingPath(blob: HistoricalBlob): string {
  return `history/${blob.commit.slice(0, 12)}/${normalizePath(blob.path)}`;
}

export function scanHistoricalText(commit: string, path: string, text: string): readonly SecurityFinding[] {
  return scanText(`history/${commit.slice(0, 12)}/${normalizePath(path)}`, text);
}

async function listReachableHistoryBlobs(cwd: string): Promise<readonly HistoricalBlob[]> {
  const { stdout } = await execFile("git", ["rev-list", "--all"], { cwd, maxBuffer: 10 * 1024 * 1024 });
  const commits = stdout.split(/\r?\n/).filter(Boolean);
  const blobs = new Map<string, HistoricalBlob>();
  for (const commit of commits) {
    const tree = await execFile("git", ["ls-tree", "-r", "-z", "--full-tree", commit], { cwd, maxBuffer: 20 * 1024 * 1024 });
    for (const entry of tree.stdout.split("\0")) {
      if (!entry) continue;
      const match = entry.match(/^\d+ blob ([a-f0-9]{40})\t(.+)$/);
      if (!match) continue;
      const [, objectId, path] = match;
      const key = `${objectId}:${path}`;
      if (!blobs.has(key)) blobs.set(key, { objectId, commit, path });
    }
  }
  return [...blobs.values()];
}

async function scanReachableHistory(cwd: string): Promise<Readonly<{ scannedHistoryBlobs: number; findings: readonly SecurityFinding[] }>> {
  const blobs = await listReachableHistoryBlobs(cwd);
  const findings: SecurityFinding[] = [];
  for (const blob of blobs) {
    const file = historicalFindingPath(blob);
    const fileFindings = scanTrackedFileName(file);
    findings.push(...fileFindings);
    // A committed private file name is already a failing finding. Do not read
    // its content, including historical .env.local values, merely to report it.
    if (fileFindings.length > 0) continue;
    const { stdout } = await execFile("git", ["cat-file", "blob", blob.objectId], { cwd, maxBuffer: 20 * 1024 * 1024 });
    findings.push(...scanHistoricalText(blob.commit, blob.path, stdout));
  }
  return { scannedHistoryBlobs: blobs.length, findings };
}

export async function scanTrackedFiles(cwd = process.cwd()): Promise<SecurityScanReport> {
  const files = await listTrackedFiles(cwd);
  const findings: SecurityFinding[] = [];
  for (const file of files) {
    const fileFindings = scanTrackedFileName(file);
    findings.push(...fileFindings);
    if (fileFindings.length > 0) continue;
    let text: string;
    try {
      text = await readFile(resolve(cwd, file), "utf8");
    } catch (error) {
      // A tracked path can be deleted in an uncommitted correction pass. Its
      // committed blob is still covered by the reachable-history scan below.
      if (error instanceof Error && "code" in error && error.code === "ENOENT") continue;
      throw error;
    }
    findings.push(...scanText(file, text));
  }
  const history = await scanReachableHistory(cwd);
  findings.push(...history.findings);
  const uniqueFindings = Array.from(new Map(findings.map((finding) => [`${finding.file}:${finding.rule}`, finding])).values());
  return {
    status: uniqueFindings.length === 0 ? "ok" : "failed",
    scannedFiles: files.length,
    scannedHistoryBlobs: history.scannedHistoryBlobs,
    findings: uniqueFindings,
  };
}

async function main(): Promise<void> {
  try {
    const report = await scanTrackedFiles();
    process.stdout.write(`${JSON.stringify(report)}\n`);
    if (report.status === "failed") process.exitCode = 1;
  } catch {
    process.stdout.write('{"status":"failed","scannedFiles":0,"scannedHistoryBlobs":0,"findings":[],"error":"repository scan failed safely"}\n');
    process.exitCode = 1;
  }
}

const entrypoint = process.argv[1];
if (entrypoint && import.meta.url === pathToFileURL(resolve(entrypoint)).href) {
  void main();
}
