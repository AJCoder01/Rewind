CREATE TABLE tasks (
  id text,
  run_id text,
  request text NOT NULL,
  status text NOT NULL,
  attention_reason jsonb,
  planning_lease_until timestamptz,
  read_model jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT tasks_pkey PRIMARY KEY (id),
  CONSTRAINT tasks_status_check CHECK (status IN ('analyzing', 'clarification_required', 'preview_ready', 'executing', 'completed', 'correction_pending', 'recovery_ready', 'recovering', 'recovered', 'attention_required', 'cancelled', 'failed'))
);

CREATE TABLE scenario_locks (
  scenario_key text,
  task_id text NOT NULL,
  acquired_at timestamptz NOT NULL,
  lease_until timestamptz,
  execution_started_at timestamptz,
  CONSTRAINT scenario_locks_pkey PRIMARY KEY (scenario_key),
  CONSTRAINT scenario_locks_task_id_fkey FOREIGN KEY (task_id) REFERENCES tasks(id)
);

CREATE TABLE plans (
  id text,
  task_id text NOT NULL,
  kind text NOT NULL,
  version integer NOT NULL,
  schema_version text NOT NULL,
  prompt_version text,
  model text,
  payload jsonb NOT NULL,
  digest text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT plans_pkey PRIMARY KEY (id),
  CONSTRAINT plans_task_id_fkey FOREIGN KEY (task_id) REFERENCES tasks(id),
  CONSTRAINT plans_kind_check CHECK (kind IN ('initial', 'recovery', 'reset')),
  CONSTRAINT plans_task_kind_version_key UNIQUE (task_id, kind, version)
);

CREATE TABLE approvals (
  id text,
  plan_id text NOT NULL,
  plan_digest text NOT NULL,
  actor_id text NOT NULL,
  approved_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT approvals_pkey PRIMARY KEY (id),
  CONSTRAINT approvals_plan_id_fkey FOREIGN KEY (plan_id) REFERENCES plans(id)
);

CREATE TABLE action_executions (
  id text,
  plan_id text NOT NULL,
  action_key text NOT NULL,
  type text NOT NULL,
  target_ref text NOT NULL,
  status text NOT NULL,
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
  CONSTRAINT action_executions_pkey PRIMARY KEY (id),
  CONSTRAINT action_executions_plan_id_fkey FOREIGN KEY (plan_id) REFERENCES plans(id),
  CONSTRAINT action_executions_status_check CHECK (status IN ('planned', 'in_progress', 'succeeded', 'retryable_failed', 'delivery_uncertain', 'conflict', 'permanently_failed')),
  CONSTRAINT action_executions_plan_id_action_key_key UNIQUE (plan_id, action_key)
);

CREATE TABLE artifacts (
  id text,
  task_id text NOT NULL,
  kind text NOT NULL,
  content text NOT NULL,
  content_hash text NOT NULL,
  provenance jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT artifacts_pkey PRIMARY KEY (id),
  CONSTRAINT artifacts_task_id_fkey FOREIGN KEY (task_id) REFERENCES tasks(id)
);

CREATE TABLE prevention_rules (
  id text,
  source_task_id text NOT NULL,
  condition jsonb NOT NULL,
  display_copy text NOT NULL,
  status text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT prevention_rules_pkey PRIMARY KEY (id),
  CONSTRAINT prevention_rules_source_task_id_fkey FOREIGN KEY (source_task_id) REFERENCES tasks(id),
  CONSTRAINT prevention_rules_status_check CHECK (status IN ('proposed', 'active', 'removed'))
);

CREATE TABLE idempotency_records (
  actor_id text NOT NULL,
  endpoint text NOT NULL,
  key text NOT NULL,
  body_hash text NOT NULL,
  status text NOT NULL,
  resource_id text,
  response jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT idempotency_records_pkey PRIMARY KEY (actor_id, endpoint, key),
  CONSTRAINT idempotency_records_status_check CHECK (status IN ('in_progress', 'completed', 'failed'))
);

CREATE TABLE demo_event_state (
  candidate_id text,
  semantic_baseline jsonb NOT NULL,
  expected_etag text NOT NULL,
  expected_updated_at timestamptz,
  last_receipt jsonb,
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT demo_event_state_pkey PRIMARY KEY (candidate_id)
);

CREATE TABLE audit_events (
  id bigserial,
  task_id text,
  event_type text NOT NULL,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  occurred_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT audit_events_pkey PRIMARY KEY (id),
  CONSTRAINT audit_events_task_id_fkey FOREIGN KEY (task_id) REFERENCES tasks(id)
);

REVOKE ALL ON TABLE
  rewind_schema_migrations,
  tasks,
  scenario_locks,
  plans,
  approvals,
  action_executions,
  artifacts,
  prevention_rules,
  idempotency_records,
  demo_event_state,
  audit_events
FROM PUBLIC;

REVOKE ALL ON SEQUENCE audit_events_id_seq FROM PUBLIC;

DO $rewind_grants$
DECLARE
  api_role text;
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'rewind_app') THEN
    EXECUTE 'REVOKE ALL ON TABLE rewind_schema_migrations, tasks, scenario_locks, plans, approvals, action_executions, artifacts, prevention_rules, idempotency_records, demo_event_state, audit_events FROM rewind_app';
    EXECUTE 'REVOKE ALL ON SEQUENCE audit_events_id_seq FROM rewind_app';
    EXECUTE 'GRANT SELECT ON TABLE rewind_schema_migrations TO rewind_app';
    EXECUTE 'GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE tasks, scenario_locks, plans, approvals, action_executions, artifacts, prevention_rules, idempotency_records, demo_event_state, audit_events TO rewind_app';
    EXECUTE 'GRANT SELECT, USAGE ON SEQUENCE audit_events_id_seq TO rewind_app';
  END IF;

  FOREACH api_role IN ARRAY ARRAY['anon', 'authenticated', 'service_role'] LOOP
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = api_role) THEN
      EXECUTE format(
        'REVOKE ALL ON TABLE rewind_schema_migrations, tasks, scenario_locks, plans, approvals, action_executions, artifacts, prevention_rules, idempotency_records, demo_event_state, audit_events FROM %I',
        api_role
      );
      EXECUTE format('REVOKE ALL ON SEQUENCE audit_events_id_seq FROM %I', api_role);
    END IF;
  END LOOP;
END
$rewind_grants$;
