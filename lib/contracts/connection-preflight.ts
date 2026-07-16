import { z } from "zod";

export const CONNECTION_PREFLIGHT_CONTRACT_VERSION = "connection-preflight.v1" as const;

const EnvironmentIssueSchema = z
  .object({
    field: z.string().min(1).max(100),
    code: z.string().min(1).max(100),
  })
  .strict();

const PreflightCheckSchema = z
  .object({
    id: z.enum(["configuration", "database", "google_identity", "calendar"]),
    status: z.enum(["passed", "failed", "not_run"]),
    detail: z.string().min(1).max(240),
  })
  .strict();

const PreflightChecksSchema = z
  .array(PreflightCheckSchema)
  .length(4)
  .superRefine((checks, context) => {
    const expected = ["configuration", "database", "google_identity", "calendar"];
    checks.forEach((check, index) => {
      if (check.id !== expected[index]) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: [index, "id"],
          message: "Preflight checks must use the canonical order.",
        });
      }
    });
  });

export const ConnectionPreflightSnapshotSchema = z
  .object({
    contractVersion: z.literal(CONNECTION_PREFLIGHT_CONTRACT_VERSION),
    overall: z.enum(["attention", "blocked"]),
    runtime: z
      .object({
        mode: z.enum(["fixture", "live_capable", "blocked"]),
        modelRuntime: z.enum(["openai_responses", "local_ollama", "not_configured"]),
        productExecution: z.literal("disabled"),
        productReset: z.literal("disabled"),
      })
      .strict(),
    configuration: z
      .object({
        status: z.enum(["complete", "incomplete"]),
        issues: z.array(EnvironmentIssueSchema).max(32),
      })
      .strict(),
    identity: z
      .object({
        status: z.enum(["connected", "not_connected", "mismatch", "unavailable"]),
        email: z.string().email().max(320).optional(),
      })
      .strict(),
    database: z
      .object({
        status: z.enum(["fixture", "ready", "not_ready", "unavailable"]),
        schemaVersion: z.string().min(1).max(100).optional(),
      })
      .strict(),
    calendar: z
      .object({
        status: z.enum(["configured", "not_configured", "unavailable"]),
      })
      .strict(),
    demoDate: z
      .object({
        status: z.enum(["configured", "not_configured"]),
      })
      .strict(),
    preflight: z
      .object({
        status: z.enum(["blocked", "not_run"]),
        checks: PreflightChecksSchema,
      })
      .strict(),
    workflow: z
      .object({
        status: z.literal("disabled"),
        message: z.literal("Product execution is disabled; this status does not approve or execute external actions."),
      })
      .strict(),
  })
  .strict();

export const ConnectionPreflightResponseSchema = ConnectionPreflightSnapshotSchema.extend({
  requestId: z.string().min(1).max(100),
});

export type ConnectionPreflightSnapshot = z.infer<typeof ConnectionPreflightSnapshotSchema>;
export type ConnectionPreflightResponse = z.infer<typeof ConnectionPreflightResponseSchema>;
