CREATE TABLE oauth_transactions (
  id text,
  provider text NOT NULL,
  state_hash text NOT NULL,
  session_hash text NOT NULL,
  nonce_hash text NOT NULL,
  code_verifier_ciphertext text NOT NULL,
  redirect_uri text NOT NULL,
  client_id text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL,
  consumed_at timestamptz,
  CONSTRAINT oauth_transactions_pkey PRIMARY KEY (id),
  CONSTRAINT oauth_transactions_provider_check CHECK (provider = 'google'),
  CONSTRAINT oauth_transactions_state_hash_key UNIQUE (state_hash),
  CONSTRAINT oauth_transactions_state_hash_check CHECK (state_hash ~ '^sha256:[a-f0-9]{64}$'),
  CONSTRAINT oauth_transactions_session_hash_check CHECK (session_hash ~ '^sha256:[a-f0-9]{64}$'),
  CONSTRAINT oauth_transactions_nonce_hash_check CHECK (nonce_hash ~ '^sha256:[a-f0-9]{64}$'),
  CONSTRAINT oauth_transactions_ciphertext_check CHECK (code_verifier_ciphertext ~ '^v1\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$'),
  CONSTRAINT oauth_transactions_redirect_uri_check CHECK (redirect_uri <> ''),
  CONSTRAINT oauth_transactions_client_id_check CHECK (client_id <> ''),
  CONSTRAINT oauth_transactions_expiry_check CHECK (expires_at > created_at)
);

CREATE INDEX oauth_transactions_expires_at_idx ON oauth_transactions (expires_at);

CREATE TABLE oauth_credentials (
  provider text,
  google_sub text NOT NULL,
  email text NOT NULL,
  refresh_token_ciphertext text NOT NULL,
  scopes text[] NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT oauth_credentials_pkey PRIMARY KEY (provider),
  CONSTRAINT oauth_credentials_provider_check CHECK (provider = 'google'),
  CONSTRAINT oauth_credentials_google_sub_check CHECK (google_sub <> '' AND google_sub = btrim(google_sub)),
  CONSTRAINT oauth_credentials_email_check CHECK (email <> '' AND email = lower(btrim(email))),
  CONSTRAINT oauth_credentials_ciphertext_check CHECK (refresh_token_ciphertext ~ '^v1\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$'),
  CONSTRAINT oauth_credentials_scopes_check CHECK (cardinality(scopes) > 0)
);

REVOKE ALL ON TABLE oauth_transactions, oauth_credentials FROM PUBLIC;

DO $rewind_oauth_grants$
DECLARE
  api_role text;
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'rewind_app') THEN
    EXECUTE 'REVOKE ALL ON TABLE oauth_transactions, oauth_credentials FROM rewind_app';
    EXECUTE 'GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE oauth_transactions, oauth_credentials TO rewind_app';
  END IF;

  FOREACH api_role IN ARRAY ARRAY['anon', 'authenticated', 'service_role'] LOOP
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = api_role) THEN
      EXECUTE format('REVOKE ALL ON TABLE oauth_transactions, oauth_credentials FROM %I', api_role);
    END IF;
  END LOOP;
END
$rewind_oauth_grants$;
