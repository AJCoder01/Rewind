import { describe, expect, it } from "vitest";
import { G2ClosureReportSchema } from "@/lib/contracts/g2-closure";
import {
  assertG3Admission,
  buildG2ClosureReport,
  G2ClosureBlockedError,
  redactionFindings,
} from "@/lib/services/g2-closure";

describe("S045 G2 closure gate", () => {
  it("passes the committed evidence packet and unlocks G3", () => {
    const report = buildG2ClosureReport();

    expect(report.status).toBe("passed");
    expect(report.g3Admission).toBe("unlocked");
    expect(report.blockers).toEqual([]);
    expect(report.selectedModel).toEqual({
      runtime: "local_ollama",
      provider: "ollama",
      evidenceClass: "local_model",
      model: "qwen2.5-coder:latest",
    });
    expect(Object.values(report.risks).every((risk) => risk.status === "green")).toBe(true);
    expect(G2ClosureReportSchema.parse(report)).toEqual(report);
    expect(() => assertG3Admission(report)).not.toThrow();
    expect(JSON.stringify(report)).not.toMatch(/@|sk-|postgres(?:ql)?:\/\//i);
  });

  it("rejects a runtime/evidence-class substitution", () => {
    const report = buildG2ClosureReport();
    expect(G2ClosureReportSchema.safeParse({
      ...report,
      selectedModel: { ...report.selectedModel, evidenceClass: "external_openai" },
    }).success).toBe(false);
  });

  it("blocks G3 when a risk is red", () => {
    const report = buildG2ClosureReport();
    const blocked = G2ClosureReportSchema.parse({
      ...report,
      status: "blocked",
      g3Admission: "blocked",
      blockers: ["strict_model_output:missing_marker:evidence"],
      risks: {
        ...report.risks,
        strict_model_output: { ...report.risks.strict_model_output, status: "red" },
      },
    });

    expect(() => assertG3Admission(blocked)).toThrowError(G2ClosureBlockedError);
  });

  it("returns only redaction rule codes, never matched values", () => {
    const findings = redactionFindings("contact person@example.com with Bearer abcdefghijklmnopqrstuvwxyz");
    expect(findings).toEqual(["bearer_token", "email_address"]);
    expect(JSON.stringify(findings)).not.toContain("person@example.com");
    expect(JSON.stringify(findings)).not.toContain("abcdefghijklmnopqrstuvwxyz");
  });
});
