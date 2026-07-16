import { z } from "zod";

export const G2_CLOSURE_CONTRACT_VERSION = "g2-closure.v1" as const;

const EvidencePathSchema = z
  .string()
  .regex(/^artifacts\/test-runs\/2026-07-16-s\d{3}-[a-z0-9-]+\.md$/, "Evidence references must be sanitized test-run paths");

const RiskEvidenceSchema = z
  .object({
    status: z.enum(["green", "red"]),
    evidenceRefs: z.array(EvidencePathSchema).min(1).max(8),
  })
  .strict();

export const G2SelectedModelSchema = z
  .object({
    runtime: z.enum(["openai_responses", "local_ollama"]),
    provider: z.enum(["openai", "ollama"]),
    evidenceClass: z.enum(["external_openai", "local_model"]),
    model: z.string().min(1).max(200),
  })
  .strict()
  .superRefine((model, context) => {
    const expected = model.runtime === "openai_responses"
      ? { provider: "openai", evidenceClass: "external_openai" }
      : { provider: "ollama", evidenceClass: "local_model" };
    if (model.provider !== expected.provider) {
      context.addIssue({ code: z.ZodIssueCode.custom, path: ["provider"], message: "Provider must match selected runtime" });
    }
    if (model.evidenceClass !== expected.evidenceClass) {
      context.addIssue({ code: z.ZodIssueCode.custom, path: ["evidenceClass"], message: "Evidence class must match selected runtime" });
    }
  });

export const G2ClosureReportSchema = z
  .object({
    status: z.enum(["passed", "blocked"]),
    operation: z.literal("g2_closure"),
    contractVersion: z.literal(G2_CLOSURE_CONTRACT_VERSION),
    selectedModel: G2SelectedModelSchema,
    risks: z
      .object({
        oauth_account_binding: RiskEvidenceSchema,
        calendar_etag: RiskEvidenceSchema,
        gmail_uncertainty: RiskEvidenceSchema,
        strict_model_output: RiskEvidenceSchema,
        secret_redaction: RiskEvidenceSchema,
        fake_provider_production: RiskEvidenceSchema,
      })
      .strict(),
    g3Admission: z.enum(["unlocked", "blocked"]),
    blockers: z.array(z.string().regex(/^[a-z0-9_.:-]+$/).max(160)).max(20),
  })
  .strict()
  .superRefine((report, context) => {
    const riskValues = Object.values(report.risks);
    const hasRedRisk = riskValues.some((risk) => risk.status === "red");
    const shouldPass = report.status === "passed" && !hasRedRisk;
    if (report.status === "passed" && hasRedRisk) {
      context.addIssue({ code: z.ZodIssueCode.custom, path: ["status"], message: "A passed closure cannot contain a red risk" });
    }
    if (report.status === "blocked" && !hasRedRisk) {
      context.addIssue({ code: z.ZodIssueCode.custom, path: ["risks"], message: "A blocked closure must contain a red risk" });
    }
    if (shouldPass && (report.g3Admission !== "unlocked" || report.blockers.length > 0)) {
      context.addIssue({ code: z.ZodIssueCode.custom, path: ["g3Admission"], message: "A passed closure must unlock G3 without blockers" });
    }
    if (!shouldPass && (report.status !== "blocked" || report.g3Admission !== "blocked" || report.blockers.length === 0)) {
      context.addIssue({ code: z.ZodIssueCode.custom, path: ["blockers"], message: "A red closure must block G3 with at least one blocker" });
    }
  });

export type G2ClosureReport = z.infer<typeof G2ClosureReportSchema>;
