import type { ErrorCode } from "@/lib/contracts/v1";

export const G1_INTERFACE_PACKET_VERSION = "g1-interface.v1" as const;

export const G1_FROZEN_SCHEMA_VERSIONS = {
  api: "v1",
  initialPlan: "initial-plan.v1",
  goldenContracts: "golden-contracts.v1",
  traceability: "traceability.v1",
  fixtureInitial: "fixture-initial.v1",
  controlledContent: "controlled-content.v1",
  artifactIndependence: "artifact-independence.v1",
  preventionRule: "prevention-rule.v1",
  resetPlan: "reset-plan.v1",
} as const;

export const G1_FROZEN_TASK_STATUSES = [
  "analyzing",
  "clarification_required",
  "preview_ready",
  "executing",
  "completed",
  "correction_pending",
  "recovery_ready",
  "recovering",
  "recovered",
  "attention_required",
  "cancelled",
  "failed",
] as const;

export const G1_FROZEN_ACTION_STATUSES = [
  "planned",
  "in_progress",
  "succeeded",
  "retryable_failed",
  "delivery_uncertain",
  "conflict",
  "permanently_failed",
] as const;

export const G1_FROZEN_ERROR_MATRIX = [
  { code: "unauthorized", status: 401 },
  { code: "forbidden", status: 403 },
  { code: "invalid_request", status: 422 },
  { code: "unsupported_request", status: 422 },
  { code: "idempotency_conflict", status: 409 },
  { code: "scenario_busy", status: 409 },
  { code: "task_not_found", status: 404 },
  { code: "invalid_task_state", status: 409 },
  { code: "plan_not_found", status: 404 },
  { code: "plan_digest_mismatch", status: 409 },
  { code: "plan_stale", status: 409 },
  { code: "approval_required", status: 409 },
  { code: "clarification_required", status: 422 },
  { code: "candidate_set_invalid", status: 422 },
  { code: "model_output_invalid", status: 422 },
  { code: "unknown_entity", status: 422 },
  { code: "unknown_action", status: 422 },
  { code: "unknown_template", status: 422 },
  { code: "recipient_not_allowed", status: 422 },
  { code: "provider_conflict", status: 409 },
  { code: "provider_unavailable", status: 503 },
  { code: "delivery_uncertain", status: 503 },
  { code: "action_not_retryable", status: 409 },
  { code: "reset_conflict", status: 409 },
  { code: "internal_error", status: 500 },
] as const satisfies readonly { code: ErrorCode; status: number }[];

export const G1_FROZEN_FOUNDATION_TABLES = [
  "tasks",
  "scenario_locks",
  "plans",
  "approvals",
  "action_executions",
  "artifacts",
  "prevention_rules",
  "idempotency_records",
  "demo_event_state",
  "audit_events",
] as const;

export const G1_FROZEN_FOUNDATION_CONSTRAINTS = [
  "rewind_schema_migrations_pkey",
  "rewind_schema_migrations_checksum_check",
  "tasks_pkey",
  "tasks_status_check",
  "scenario_locks_pkey",
  "scenario_locks_task_id_fkey",
  "plans_pkey",
  "plans_task_id_fkey",
  "plans_kind_check",
  "plans_task_kind_version_key",
  "approvals_pkey",
  "approvals_plan_id_fkey",
  "action_executions_pkey",
  "action_executions_plan_id_fkey",
  "action_executions_status_check",
  "action_executions_plan_id_action_key_key",
  "artifacts_pkey",
  "artifacts_task_id_fkey",
  "prevention_rules_pkey",
  "prevention_rules_source_task_id_fkey",
  "prevention_rules_status_check",
  "idempotency_records_pkey",
  "idempotency_records_status_check",
  "demo_event_state_pkey",
  "audit_events_pkey",
  "audit_events_task_id_fkey",
] as const;

export const G1_FROZEN_EVIDENCE_PATHS = [
  "artifacts/test-runs/2026-07-15-s019-s027-g1.md",
  "artifacts/test-runs/2026-07-16-s028-deployed.md",
  "scripts/test-e2e.ts",
] as const;

export const G1_IMPLEMENTED_ENDPOINTS = [
  "POST /api/v1/auth/session",
  "POST /api/v1/world-prs",
  "GET /api/v1/world-prs/:worldPrId",
  "GET /api/v1/world-prs/:worldPrId/status",
  "POST /api/v1/world-prs/:worldPrId/cancel",
] as const;
