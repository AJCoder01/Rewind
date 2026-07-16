import { existsSync, readFileSync } from "node:fs";
import { isAbsolute, relative, resolve, sep } from "node:path";
import { G2ClosureReportSchema, type G2ClosureReport } from "@/lib/contracts/g2-closure";

export const G2_RISK_IDS = [
  "oauth_account_binding",
  "calendar_etag",
  "gmail_uncertainty",
  "strict_model_output",
  "secret_redaction",
  "fake_provider_production",
] as const;

export type G2RiskId = (typeof G2_RISK_IDS)[number];

type EvidenceCheck = Readonly<{ path: string; marker: string }>;

export const G2_EVIDENCE_MANIFEST: Readonly<Record<G2RiskId, readonly EvidenceCheck[]>> = {
  oauth_account_binding: [
    { path: "artifacts/test-runs/2026-07-16-s032-google-identity.md", marker: "exact four approved OAuth scopes" },
    { path: "artifacts/test-runs/2026-07-16-s033-oauth-negative.md", marker: "negative-test evidence" },
    { path: "artifacts/test-runs/2026-07-16-s035-live-closure.md", marker: "status: connected" },
  ],
  calendar_etag: [
    { path: "artifacts/test-runs/2026-07-16-s035-live-closure.md", marker: "rolling provider versions" },
    { path: "artifacts/test-runs/2026-07-16-s036-calendar-primitives.md", marker: "expected_etag" },
    { path: "artifacts/test-runs/2026-07-16-s043-provider-model-spike-success.md", marker: "provider_conflict" },
  ],
  gmail_uncertainty: [
    { path: "artifacts/test-runs/2026-07-16-s037-gmail-at-most-once.md", marker: "delivery_uncertain" },
    { path: "artifacts/test-runs/2026-07-16-s037-gmail-at-most-once.md", marker: "never automatically resent" },
    { path: "artifacts/test-runs/2026-07-16-s038-gmail-live-proof.md", marker: "replayVerified: true" },
    { path: "artifacts/test-runs/2026-07-16-s038-gmail-live-proof.md", marker: "exactly one inbox message" },
  ],
  strict_model_output: [
    { path: "artifacts/test-runs/2026-07-16-s041-model-schemas.md", marker: "strict runtime and Responses JSON Schemas" },
    { path: "artifacts/test-runs/2026-07-16-s042-model-safety.md", marker: "deterministic semantic boundary" },
    { path: "artifacts/test-runs/2026-07-16-s043-local-model-runtime.md", marker: "evidenceClass: local_model" },
    { path: "artifacts/test-runs/2026-07-16-s043-provider-model-spike-success.md", marker: "outputs each passed the strict schema" },
  ],
  secret_redaction: [
    { path: "artifacts/test-runs/2026-07-16-s037-gmail-at-most-once.md", marker: "not placed in receipts or errors" },
    { path: "artifacts/test-runs/2026-07-16-s043-provider-model-spike-success.md", marker: "No credentials" },
    { path: "artifacts/test-runs/2026-07-16-s044-connection-preflight-ui.md", marker: "security:scan" },
  ],
  fake_provider_production: [
    { path: "artifacts/test-runs/2026-07-16-s043-local-model-runtime.md", marker: "production fake-provider guard passed" },
    { path: "artifacts/test-runs/2026-07-16-s044-connection-preflight-ui.md", marker: "verify:fake-production" },
  ],
};

const REDACTION_RULES = [
  { code: "private_key", pattern: /-----BEGIN (?:RSA |EC |OPENSSH |DSA )?PRIVATE KEY-----/ },
  { code: "aws_access_key", pattern: /\bAKIA[0-9A-Z]{16}\b/ },
  { code: "github_token", pattern: /\b(?:ghp|gho|ghs|ghr)_[A-Za-z0-9]{30,}\b/ },
  { code: "google_api_key", pattern: /\bAIza[0-9A-Za-z_-]{35}\b/ },
  { code: "google_client_secret", pattern: /\bGOCSPX-[A-Za-z0-9_-]{24,}\b/ },
  { code: "openai_project_key", pattern: /\bsk-(?:proj|live)-[A-Za-z0-9_-]{30,}\b/ },
  { code: "slack_token", pattern: /\bxox[baprs]-[0-9A-Za-z-]{20,}\b/ },
  { code: "database_url", pattern: /\b(?:postgres(?:ql)?|mysql|mongodb(?:\+srv)?):\/\/[^\s`]+/i },
  { code: "bearer_token", pattern: /\bBearer\s+[A-Za-z0-9._~-]{20,}/i },
  { code: "email_address", pattern: /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/i },
] as const;

export function redactionFindings(text: string): readonly string[] {
  return REDACTION_RULES.filter(({ pattern }) => pattern.test(text)).map(({ code }) => code);
}

function safeEvidencePath(root: string, evidencePath: string): string {
  const resolvedRoot = resolve(root);
  const resolvedPath = resolve(root, evidencePath);
  const relativePath = relative(resolvedRoot, resolvedPath);
  if (relativePath === "" || relativePath === ".." || relativePath.startsWith(`..${sep}`) || isAbsolute(relativePath)) {
    throw new Error("Evidence path escaped the repository");
  }
  return resolvedPath;
}

function uniquePaths(checks: readonly EvidenceCheck[]): readonly string[] {
  return [...new Set(checks.map((check) => check.path))];
}

function allEvidenceChecks(): readonly EvidenceCheck[] {
  return G2_RISK_IDS.flatMap((riskId) => G2_EVIDENCE_MANIFEST[riskId]);
}

function checkRisk(root: string, checks: readonly EvidenceCheck[]): { status: "green" | "red"; blockers: readonly string[] } {
  const blockers: string[] = [];
  for (const check of checks) {
    const path = safeEvidencePath(root, check.path);
    if (!existsSync(path)) {
      blockers.push(`missing_file:${check.path.split("/").at(-1) ?? "evidence"}`);
      continue;
    }
    const text = readFileSync(path, "utf8");
    if (!text.includes(check.marker)) blockers.push(`missing_marker:${check.path.split("/").at(-1) ?? "evidence"}`);
  }
  return { status: blockers.length === 0 ? "green" : "red", blockers };
}

function checkRedactions(root: string, checks: readonly EvidenceCheck[]): { status: "green" | "red"; blockers: readonly string[] } {
  const blockers = new Set<string>();
  for (const path of uniquePaths(checks)) {
    const resolvedPath = safeEvidencePath(root, path);
    if (!existsSync(resolvedPath)) {
      blockers.add(`missing_file:${path.split("/").at(-1) ?? "evidence"}`);
      continue;
    }
    for (const code of redactionFindings(readFileSync(resolvedPath, "utf8"))) blockers.add(`secret_redaction:${code}`);
  }
  return { status: blockers.size === 0 ? "green" : "red", blockers: [...blockers] };
}

export function buildG2ClosureReport(root = process.cwd()): G2ClosureReport {
  const checksByRisk = Object.fromEntries(G2_RISK_IDS.map((riskId) => {
    const result = riskId === "secret_redaction"
      ? checkRedactions(root, allEvidenceChecks())
      : checkRisk(root, G2_EVIDENCE_MANIFEST[riskId]);
    return [riskId, result];
  })) as Record<G2RiskId, { status: "green" | "red"; blockers: readonly string[] }>;
  const risks = Object.fromEntries(G2_RISK_IDS.map((riskId) => [riskId, {
    status: checksByRisk[riskId].status,
    evidenceRefs: uniquePaths(G2_EVIDENCE_MANIFEST[riskId]),
  }])) as G2ClosureReport["risks"];
  const blockers = G2_RISK_IDS.flatMap((riskId) => checksByRisk[riskId].blockers.map((blocker) => `${riskId}:${blocker}`));
  return G2ClosureReportSchema.parse({
    status: blockers.length === 0 ? "passed" : "blocked",
    operation: "g2_closure",
    contractVersion: "g2-closure.v1",
    selectedModel: {
      runtime: "local_ollama",
      provider: "ollama",
      evidenceClass: "local_model",
      model: "qwen2.5-coder:latest",
    },
    risks,
    g3Admission: blockers.length === 0 ? "unlocked" : "blocked",
    blockers,
  });
}

export class G2ClosureBlockedError extends Error {
  constructor(public readonly report: G2ClosureReport) {
    super("G2 closure is red; G3 remains blocked");
    this.name = "G2ClosureBlockedError";
  }
}

export function assertG3Admission(report: G2ClosureReport): void {
  const parsed = G2ClosureReportSchema.parse(report);
  if (parsed.status !== "passed" || parsed.g3Admission !== "unlocked") throw new G2ClosureBlockedError(parsed);
}
