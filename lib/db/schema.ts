export const FOUNDATION_MIGRATION_ID = "0001_phase0_foundation";

// Updated only when the immutable migration bytes change. The migration runner
// canonicalizes source line endings before hashing, so this is stable on
// Windows and Linux checkouts.
export const FOUNDATION_MIGRATION_CHECKSUM = "sha256:466833a9cb1c02b577672a2bbcc532655e288d2c2a895a6d9f38f79b3daaa99d";

// S008 may have recorded the Windows CRLF byte hash before checksum
// canonicalization. It is accepted only for this already-reviewed migration;
// no ledger value is rewritten and every unknown checksum still fails closed.
export const FOUNDATION_MIGRATION_LEGACY_CRLF_CHECKSUM = "sha256:f167612e48aa7f124e4bb23c564b3156bf2106e333c92e3c0c8e956c5363273a";

export function isKnownFoundationMigrationChecksum(checksum: string): boolean {
  return checksum === FOUNDATION_MIGRATION_CHECKSUM || checksum === FOUNDATION_MIGRATION_LEGACY_CRLF_CHECKSUM;
}

export const MIGRATION_LEDGER_TABLE = "rewind_schema_migrations";

export const OAUTH_MIGRATION_ID = "0002_oauth_transaction";
// Updated only when db/migrations/0002_oauth_transaction.sql changes.
export const OAUTH_MIGRATION_CHECKSUM = "sha256:ec6579a54aea6500f7fd84f04c1c4f2982783612be4c932eaab89073e456c38d";

export const OAUTH_TABLES = ["oauth_transactions", "oauth_credentials"] as const;

export const OAUTH_COLUMN_SIGNATURES: Readonly<Record<string, readonly string[]>> = {
  oauth_transactions: [
    "id:text:NO:none",
    "provider:text:NO:none",
    "state_hash:text:NO:none",
    "session_hash:text:NO:none",
    "nonce_hash:text:NO:none",
    "code_verifier_ciphertext:text:NO:none",
    "redirect_uri:text:NO:none",
    "client_id:text:NO:none",
    "created_at:timestamp with time zone:NO:now",
    "expires_at:timestamp with time zone:NO:none",
    "consumed_at:timestamp with time zone:YES:none",
  ],
  oauth_credentials: [
    "provider:text:NO:none",
    "google_sub:text:NO:none",
    "email:text:NO:none",
    "refresh_token_ciphertext:text:NO:none",
    "scopes:ARRAY:NO:none",
    "created_at:timestamp with time zone:NO:now",
    "updated_at:timestamp with time zone:NO:now",
  ],
} as const;

export const OAUTH_CONSTRAINTS = [
  "oauth_transactions_pkey",
  "oauth_transactions_provider_check",
  "oauth_transactions_state_hash_key",
  "oauth_transactions_state_hash_check",
  "oauth_transactions_session_hash_check",
  "oauth_transactions_nonce_hash_check",
  "oauth_transactions_ciphertext_check",
  "oauth_transactions_redirect_uri_check",
  "oauth_transactions_client_id_check",
  "oauth_transactions_expiry_check",
  "oauth_credentials_pkey",
  "oauth_credentials_provider_check",
  "oauth_credentials_google_sub_check",
  "oauth_credentials_email_check",
  "oauth_credentials_ciphertext_check",
  "oauth_credentials_scopes_check",
] as const;

export const FOUNDATION_TABLES = [
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

export const REWIND_DATABASE_TABLES = [MIGRATION_LEDGER_TABLE, ...FOUNDATION_TABLES] as const;

export const REWIND_COLUMN_SIGNATURES: Readonly<Record<string, readonly string[]>> = {
  rewind_schema_migrations: [
    "migration_id:text:NO:none",
    "checksum:text:NO:none",
    "applied_at:timestamp with time zone:NO:now",
  ],
  tasks: [
    "id:text:NO:none",
    "run_id:text:YES:none",
    "request:text:NO:none",
    "status:text:NO:none",
    "attention_reason:jsonb:YES:none",
    "planning_lease_until:timestamp with time zone:YES:none",
    "read_model:jsonb:NO:none",
    "created_at:timestamp with time zone:NO:now",
    "updated_at:timestamp with time zone:NO:now",
  ],
  scenario_locks: [
    "scenario_key:text:NO:none",
    "task_id:text:NO:none",
    "acquired_at:timestamp with time zone:NO:none",
    "lease_until:timestamp with time zone:YES:none",
    "execution_started_at:timestamp with time zone:YES:none",
  ],
  plans: [
    "id:text:NO:none",
    "task_id:text:NO:none",
    "kind:text:NO:none",
    "version:integer:NO:none",
    "schema_version:text:NO:none",
    "prompt_version:text:YES:none",
    "model:text:YES:none",
    "payload:jsonb:NO:none",
    "digest:text:NO:none",
    "created_at:timestamp with time zone:NO:now",
  ],
  approvals: [
    "id:text:NO:none",
    "plan_id:text:NO:none",
    "plan_digest:text:NO:none",
    "actor_id:text:NO:none",
    "approved_at:timestamp with time zone:NO:now",
  ],
  action_executions: [
    "id:text:NO:none",
    "plan_id:text:NO:none",
    "action_key:text:NO:none",
    "type:text:NO:none",
    "target_ref:text:NO:none",
    "status:text:NO:none",
    "action:jsonb:NO:none",
    "before_state:jsonb:YES:none",
    "after_state:jsonb:YES:none",
    "receipt:jsonb:YES:none",
    "attempts:integer:NO:zero",
    "lease_until:timestamp with time zone:YES:none",
    "dispatch_started_at:timestamp with time zone:YES:none",
    "error:jsonb:YES:none",
    "started_at:timestamp with time zone:YES:none",
    "finished_at:timestamp with time zone:YES:none",
  ],
  artifacts: [
    "id:text:NO:none",
    "task_id:text:NO:none",
    "kind:text:NO:none",
    "content:text:NO:none",
    "content_hash:text:NO:none",
    "provenance:jsonb:NO:none",
    "created_at:timestamp with time zone:NO:now",
  ],
  prevention_rules: [
    "id:text:NO:none",
    "source_task_id:text:NO:none",
    "condition:jsonb:NO:none",
    "display_copy:text:NO:none",
    "status:text:NO:none",
    "created_at:timestamp with time zone:NO:now",
    "updated_at:timestamp with time zone:NO:now",
  ],
  idempotency_records: [
    "actor_id:text:NO:none",
    "endpoint:text:NO:none",
    "key:text:NO:none",
    "body_hash:text:NO:none",
    "status:text:NO:none",
    "resource_id:text:YES:none",
    "response:jsonb:YES:none",
    "created_at:timestamp with time zone:NO:now",
    "updated_at:timestamp with time zone:NO:now",
  ],
  demo_event_state: [
    "candidate_id:text:NO:none",
    "semantic_baseline:jsonb:NO:none",
    "expected_etag:text:NO:none",
    "expected_updated_at:timestamp with time zone:YES:none",
    "last_receipt:jsonb:YES:none",
    "updated_at:timestamp with time zone:NO:now",
  ],
  audit_events: [
    "id:bigint:NO:sequence",
    "task_id:text:YES:none",
    "event_type:text:NO:none",
    "metadata:jsonb:NO:empty_json",
    "occurred_at:timestamp with time zone:NO:now",
  ],
} as const;

export const FOUNDATION_CONSTRAINTS = [
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

type DatabaseConstraintExpectation = {
  table: string;
  name: string;
  type: "PRIMARY KEY" | "FOREIGN KEY" | "UNIQUE" | "CHECK";
  definition: string;
  /** Retained for migration-source assertions; live catalog matching uses definition. */
  definitionIncludes: readonly string[];
};

export const REWIND_CONSTRAINTS: readonly DatabaseConstraintExpectation[] = [
  { table: MIGRATION_LEDGER_TABLE, name: "rewind_schema_migrations_pkey", type: "PRIMARY KEY", definition: "PRIMARY KEY (migration_id)", definitionIncludes: ["PRIMARY KEY (migration_id)"] },
  { table: MIGRATION_LEDGER_TABLE, name: "rewind_schema_migrations_checksum_check", type: "CHECK", definition: "CHECK (checksum ~ '^sha256:[a-f0-9]{64}$')", definitionIncludes: ["CHECK", "checksum", "sha256:"] },
  { table: "tasks", name: "tasks_pkey", type: "PRIMARY KEY", definition: "PRIMARY KEY (id)", definitionIncludes: ["PRIMARY KEY (id)"] },
  { table: "tasks", name: "tasks_status_check", type: "CHECK", definition: "CHECK (status IN ('analyzing', 'clarification_required', 'preview_ready', 'executing', 'completed', 'correction_pending', 'recovery_ready', 'recovering', 'recovered', 'attention_required', 'cancelled', 'failed'))", definitionIncludes: ["CHECK", "status", "analyzing", "clarification_required", "preview_ready", "executing", "completed", "correction_pending", "recovery_ready", "recovering", "recovered", "attention_required", "cancelled", "failed"] },
  { table: "scenario_locks", name: "scenario_locks_pkey", type: "PRIMARY KEY", definition: "PRIMARY KEY (scenario_key)", definitionIncludes: ["PRIMARY KEY (scenario_key)"] },
  { table: "scenario_locks", name: "scenario_locks_task_id_fkey", type: "FOREIGN KEY", definition: "FOREIGN KEY (task_id) REFERENCES tasks(id)", definitionIncludes: ["FOREIGN KEY (task_id)", "REFERENCES tasks(id)"] },
  { table: "plans", name: "plans_pkey", type: "PRIMARY KEY", definition: "PRIMARY KEY (id)", definitionIncludes: ["PRIMARY KEY (id)"] },
  { table: "plans", name: "plans_task_id_fkey", type: "FOREIGN KEY", definition: "FOREIGN KEY (task_id) REFERENCES tasks(id)", definitionIncludes: ["FOREIGN KEY (task_id)", "REFERENCES tasks(id)"] },
  { table: "plans", name: "plans_kind_check", type: "CHECK", definition: "CHECK (kind IN ('initial', 'recovery', 'reset'))", definitionIncludes: ["CHECK", "kind", "initial", "recovery", "reset"] },
  { table: "plans", name: "plans_task_kind_version_key", type: "UNIQUE", definition: "UNIQUE (task_id, kind, version)", definitionIncludes: ["UNIQUE (task_id, kind, version)"] },
  { table: "approvals", name: "approvals_pkey", type: "PRIMARY KEY", definition: "PRIMARY KEY (id)", definitionIncludes: ["PRIMARY KEY (id)"] },
  { table: "approvals", name: "approvals_plan_id_fkey", type: "FOREIGN KEY", definition: "FOREIGN KEY (plan_id) REFERENCES plans(id)", definitionIncludes: ["FOREIGN KEY (plan_id)", "REFERENCES plans(id)"] },
  { table: "action_executions", name: "action_executions_pkey", type: "PRIMARY KEY", definition: "PRIMARY KEY (id)", definitionIncludes: ["PRIMARY KEY (id)"] },
  { table: "action_executions", name: "action_executions_plan_id_fkey", type: "FOREIGN KEY", definition: "FOREIGN KEY (plan_id) REFERENCES plans(id)", definitionIncludes: ["FOREIGN KEY (plan_id)", "REFERENCES plans(id)"] },
  { table: "action_executions", name: "action_executions_status_check", type: "CHECK", definition: "CHECK (status IN ('planned', 'in_progress', 'succeeded', 'retryable_failed', 'delivery_uncertain', 'conflict', 'permanently_failed'))", definitionIncludes: ["CHECK", "status", "planned", "in_progress", "succeeded", "retryable_failed", "delivery_uncertain", "conflict", "permanently_failed"] },
  { table: "action_executions", name: "action_executions_plan_id_action_key_key", type: "UNIQUE", definition: "UNIQUE (plan_id, action_key)", definitionIncludes: ["UNIQUE (plan_id, action_key)"] },
  { table: "artifacts", name: "artifacts_pkey", type: "PRIMARY KEY", definition: "PRIMARY KEY (id)", definitionIncludes: ["PRIMARY KEY (id)"] },
  { table: "artifacts", name: "artifacts_task_id_fkey", type: "FOREIGN KEY", definition: "FOREIGN KEY (task_id) REFERENCES tasks(id)", definitionIncludes: ["FOREIGN KEY (task_id)", "REFERENCES tasks(id)"] },
  { table: "prevention_rules", name: "prevention_rules_pkey", type: "PRIMARY KEY", definition: "PRIMARY KEY (id)", definitionIncludes: ["PRIMARY KEY (id)"] },
  { table: "prevention_rules", name: "prevention_rules_source_task_id_fkey", type: "FOREIGN KEY", definition: "FOREIGN KEY (source_task_id) REFERENCES tasks(id)", definitionIncludes: ["FOREIGN KEY (source_task_id)", "REFERENCES tasks(id)"] },
  { table: "prevention_rules", name: "prevention_rules_status_check", type: "CHECK", definition: "CHECK (status IN ('proposed', 'active', 'removed'))", definitionIncludes: ["CHECK", "status", "proposed", "active", "removed"] },
  { table: "idempotency_records", name: "idempotency_records_pkey", type: "PRIMARY KEY", definition: "PRIMARY KEY (actor_id, endpoint, key)", definitionIncludes: ["PRIMARY KEY (actor_id, endpoint, key)"] },
  { table: "idempotency_records", name: "idempotency_records_status_check", type: "CHECK", definition: "CHECK (status IN ('in_progress', 'completed', 'failed'))", definitionIncludes: ["CHECK", "status", "in_progress", "completed", "failed"] },
  { table: "demo_event_state", name: "demo_event_state_pkey", type: "PRIMARY KEY", definition: "PRIMARY KEY (candidate_id)", definitionIncludes: ["PRIMARY KEY (candidate_id)"] },
  { table: "audit_events", name: "audit_events_pkey", type: "PRIMARY KEY", definition: "PRIMARY KEY (id)", definitionIncludes: ["PRIMARY KEY (id)"] },
  { table: "audit_events", name: "audit_events_task_id_fkey", type: "FOREIGN KEY", definition: "FOREIGN KEY (task_id) REFERENCES tasks(id)", definitionIncludes: ["FOREIGN KEY (task_id)", "REFERENCES tasks(id)"] },
] as const;
