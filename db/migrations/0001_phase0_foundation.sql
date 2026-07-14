CREATE TABLE IF NOT EXISTS tasks (
  id text PRIMARY KEY,
  run_id text,
  request text NOT NULL,
  status text NOT NULL CHECK (status IN ('analyzing', 'clarification_required', 'preview_ready', 'executing', 'completed', 'correction_pending', 'recovery_ready', 'recovering', 'recovered', 'attention_required', 'cancelled', 'failed')),
  attention_reason jsonb,
  planning_lease_until timestamptz,
  read_model jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS scenario_locks (
  scenario_key text PRIMARY KEY,
  task_id text NOT NULL REFERENCES tasks(id),
  acquired_at timestamptz NOT NULL,
  lease_until timestamptz,
  execution_started_at timestamptz
);

CREATE TABLE IF NOT EXISTS plans (
  id text PRIMARY KEY,
  task_id text NOT NULL REFERENCES tasks(id),
  kind text NOT NULL CHECK (kind IN ('initial', 'recovery', 'reset')),
  version integer NOT NULL,
  schema_version text NOT NULL,
  prompt_version text,
  model text,
  payload jsonb NOT NULL,
  digest text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (task_id, kind, version)
);

CREATE TABLE IF NOT EXISTS approvals (
  id text PRIMARY KEY,
  plan_id text NOT NULL REFERENCES plans(id),
  plan_digest text NOT NULL,
  actor_id text NOT NULL,
  approved_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS action_executions (
  id text PRIMARY KEY,
  plan_id text NOT NULL REFERENCES plans(id),
  action_key text NOT NULL,
  type text NOT NULL,
  target_ref text NOT NULL,
  status text NOT NULL CHECK (status IN ('planned', 'in_progress', 'succeeded', 'retryable_failed', 'delivery_uncertain', 'conflict', 'permanently_failed')),
  action jsonb NOT NULL,
  before_state jsonb,
  after_state jsonb,
  receipt jsonb,
  attempts integer NOT NULL DEFAULT 0,
  lease_until timestamptz,
  dispatch_started_at timestamptz,
  error jsonb,
  started_at timestamptz,
  finished_at timestamptz,
  UNIQUE (plan_id, action_key)
);

CREATE TABLE IF NOT EXISTS artifacts (
  id text PRIMARY KEY,
  task_id text NOT NULL REFERENCES tasks(id),
  kind text NOT NULL,
  content text NOT NULL,
  content_hash text NOT NULL,
  provenance jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS prevention_rules (
  id text PRIMARY KEY,
  source_task_id text NOT NULL REFERENCES tasks(id),
  condition jsonb NOT NULL,
  display_copy text NOT NULL,
  status text NOT NULL CHECK (status IN ('proposed', 'active', 'removed')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS idempotency_records (
  actor_id text NOT NULL,
  endpoint text NOT NULL,
  key text NOT NULL,
  body_hash text NOT NULL,
  status text NOT NULL CHECK (status IN ('in_progress', 'completed', 'failed')),
  resource_id text,
  response jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (actor_id, endpoint, key)
);

CREATE TABLE IF NOT EXISTS demo_event_state (
  candidate_id text PRIMARY KEY,
  semantic_baseline jsonb NOT NULL,
  expected_etag text NOT NULL,
  expected_updated_at timestamptz,
  last_receipt jsonb,
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS audit_events (
  id bigserial PRIMARY KEY,
  task_id text REFERENCES tasks(id),
  event_type text NOT NULL,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  occurred_at timestamptz NOT NULL DEFAULT now()
);
