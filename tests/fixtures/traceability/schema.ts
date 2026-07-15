import { z } from "zod";

export const RequirementIdSchema = z.string().regex(/^(?:FR|SAFE|NFR)-\d{2}$/);
export const RequirementKindSchema = z.enum(["FR", "SAFE", "NFR"]);
export const RequirementCoverageSchema = z.enum(["covered", "partial", "planned"]);
const PathSchema = z.string().min(1).refine((value) => !value.includes(".."), "trace paths must stay inside the repository");
const TaskSchema = z.string().regex(/^S\d{3}$/);

export const RequirementTraceSchema = z
  .object({
    id: RequirementIdSchema,
    kind: RequirementKindSchema,
    title: z.string().min(1).max(240),
    status: RequirementCoverageSchema,
    planTasks: z.array(TaskSchema).min(1),
    codePaths: z.array(PathSchema),
    testPaths: z.array(PathSchema),
    fixtureIds: z.array(z.string().min(1).max(120)),
    evidencePaths: z.array(PathSchema),
    note: z.string().min(1).max(500),
  })
  .strict()
  .superRefine((entry, context) => {
    if (entry.id.split("-")[0] !== entry.kind) {
      context.addIssue({ code: z.ZodIssueCode.custom, path: ["kind"], message: "kind must match the requirement ID prefix" });
    }
    if (entry.status === "planned") {
      if (entry.codePaths.length || entry.testPaths.length || entry.fixtureIds.length || entry.evidencePaths.length) {
        context.addIssue({ code: z.ZodIssueCode.custom, path: ["status"], message: "planned entries cannot claim implementation evidence" });
      }
    } else if (!entry.codePaths.length || !entry.testPaths.length || !entry.fixtureIds.length || !entry.evidencePaths.length) {
      context.addIssue({ code: z.ZodIssueCode.custom, path: ["status"], message: "covered/partial entries require code, tests, fixtures, and evidence" });
    }
  });

export type RequirementTrace = z.infer<typeof RequirementTraceSchema>;
