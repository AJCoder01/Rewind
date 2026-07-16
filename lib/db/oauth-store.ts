import type { Pool, QueryResultRow } from "pg";
import { constantTimeSecretEqual } from "@/lib/google/oauth";

export type OAuthTransactionRecord = Readonly<{
  id: string;
  provider: "google";
  stateHash: string;
  sessionHash: string;
  nonceHash: string;
  codeVerifierCiphertext: string;
  redirectUri: string;
  clientId: string;
  createdAt: Date;
  expiresAt: Date;
  consumedAt: Date | null;
}>;

export type OAuthCredentialRecord = Readonly<{
  provider: "google";
  googleSub: string;
  email: string;
  refreshTokenCiphertext: string;
  scopes: readonly string[];
  createdAt: Date;
  updatedAt: Date;
}>;

export type OAuthCredentialWrite = Readonly<{
  provider: "google";
  googleSub: string;
  email: string;
  refreshTokenCiphertext: string;
  scopes: readonly string[];
}>;

export type OAuthTransactionConsumeInput = Readonly<{
  stateHash: string;
  sessionHash: string;
  redirectUri: string;
  clientId: string;
  consumedAt?: Date;
}>;

export interface OAuthStore {
  createTransaction(transaction: OAuthTransactionRecord): Promise<void>;
  consumeTransaction(input: OAuthTransactionConsumeInput): Promise<OAuthTransactionRecord | null>;
  saveCredential(credential: OAuthCredentialWrite): Promise<void>;
  getCredential(provider?: "google"): Promise<OAuthCredentialRecord | null>;
}

function copyTransaction(transaction: OAuthTransactionRecord): OAuthTransactionRecord {
  return {
    ...transaction,
    createdAt: new Date(transaction.createdAt.getTime()),
    expiresAt: new Date(transaction.expiresAt.getTime()),
    consumedAt: transaction.consumedAt ? new Date(transaction.consumedAt.getTime()) : null,
  };
}

function copyCredential(credential: OAuthCredentialRecord): OAuthCredentialRecord {
  return {
    ...credential,
    scopes: [...credential.scopes],
    createdAt: new Date(credential.createdAt.getTime()),
    updatedAt: new Date(credential.updatedAt.getTime()),
  };
}

/** Deterministic store used by unit tests and the explicitly non-production fixture mode. */
export class MemoryOAuthStore implements OAuthStore {
  private readonly transactions = new Map<string, OAuthTransactionRecord>();
  private readonly credentials = new Map<string, OAuthCredentialRecord>();

  async createTransaction(transaction: OAuthTransactionRecord): Promise<void> {
    if (this.transactions.has(transaction.id) || Array.from(this.transactions.values()).some((item) => item.stateHash === transaction.stateHash)) {
      throw new Error("OAuth transaction identifier collision.");
    }
    this.transactions.set(transaction.id, copyTransaction(transaction));
  }

  async consumeTransaction(input: OAuthTransactionConsumeInput): Promise<OAuthTransactionRecord | null> {
    const now = input.consumedAt ? new Date(input.consumedAt.getTime()) : new Date();
    const transaction = Array.from(this.transactions.values()).find((item) => item.stateHash === input.stateHash);
    if (
      !transaction ||
      transaction.consumedAt ||
      transaction.expiresAt.getTime() <= now.getTime() ||
      transaction.redirectUri !== input.redirectUri ||
      transaction.clientId !== input.clientId ||
      !constantTimeSecretEqual(transaction.sessionHash, input.sessionHash)
    ) {
      return null;
    }
    const consumed = { ...transaction, consumedAt: now };
    this.transactions.set(transaction.id, consumed);
    return copyTransaction(consumed);
  }

  async saveCredential(credential: OAuthCredentialWrite): Promise<void> {
    const now = new Date();
    const previous = this.credentials.get(credential.provider);
    this.credentials.set(
      credential.provider,
      copyCredential({
        ...credential,
        scopes: [...credential.scopes],
        createdAt: previous?.createdAt ?? now,
        updatedAt: now,
      }),
    );
  }

  async getCredential(provider: "google" = "google"): Promise<OAuthCredentialRecord | null> {
    const credential = this.credentials.get(provider);
    return credential ? copyCredential(credential) : null;
  }

  clear(): void {
    this.transactions.clear();
    this.credentials.clear();
  }
}

type OAuthTransactionRow = QueryResultRow & {
  id: string;
  provider: "google";
  state_hash: string;
  session_hash: string;
  nonce_hash: string;
  code_verifier_ciphertext: string;
  redirect_uri: string;
  client_id: string;
  created_at: Date;
  expires_at: Date;
  consumed_at: Date | null;
};

type OAuthCredentialRow = QueryResultRow & {
  provider: "google";
  google_sub: string;
  email: string;
  refresh_token_ciphertext: string;
  scopes: string[];
  created_at: Date;
  updated_at: Date;
};

function transactionFromRow(row: OAuthTransactionRow): OAuthTransactionRecord {
  return {
    id: row.id,
    provider: row.provider,
    stateHash: row.state_hash,
    sessionHash: row.session_hash,
    nonceHash: row.nonce_hash,
    codeVerifierCiphertext: row.code_verifier_ciphertext,
    redirectUri: row.redirect_uri,
    clientId: row.client_id,
    createdAt: new Date(row.created_at),
    expiresAt: new Date(row.expires_at),
    consumedAt: row.consumed_at ? new Date(row.consumed_at) : null,
  };
}

function credentialFromRow(row: OAuthCredentialRow): OAuthCredentialRecord {
  return {
    provider: row.provider,
    googleSub: row.google_sub,
    email: row.email,
    refreshTokenCiphertext: row.refresh_token_ciphertext,
    scopes: [...row.scopes],
    createdAt: new Date(row.created_at),
    updatedAt: new Date(row.updated_at),
  };
}

export class PostgresOAuthStore implements OAuthStore {
  constructor(private readonly pool: Pool) {}

  async createTransaction(transaction: OAuthTransactionRecord): Promise<void> {
    await this.pool.query(
      `INSERT INTO oauth_transactions
         (id, provider, state_hash, session_hash, nonce_hash, code_verifier_ciphertext,
          redirect_uri, client_id, created_at, expires_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
      [
        transaction.id,
        transaction.provider,
        transaction.stateHash,
        transaction.sessionHash,
        transaction.nonceHash,
        transaction.codeVerifierCiphertext,
        transaction.redirectUri,
        transaction.clientId,
        transaction.createdAt,
        transaction.expiresAt,
      ],
    );
  }

  async consumeTransaction(input: OAuthTransactionConsumeInput): Promise<OAuthTransactionRecord | null> {
    const consumedAt = input.consumedAt ? new Date(input.consumedAt.getTime()) : new Date();
    const result = await this.pool.query<OAuthTransactionRow>(
      `WITH consumed AS (
         UPDATE oauth_transactions
            SET consumed_at = $5
          WHERE provider = 'google'
            AND state_hash = $1
            AND session_hash = $2
            AND redirect_uri = $3
            AND client_id = $4
            AND consumed_at IS NULL
            AND expires_at > $5
          RETURNING id, provider, state_hash, session_hash, nonce_hash,
                    code_verifier_ciphertext, redirect_uri, client_id,
                    created_at, expires_at, consumed_at
       )
       SELECT id, provider, state_hash, session_hash, nonce_hash,
              code_verifier_ciphertext, redirect_uri, client_id,
              created_at, expires_at, consumed_at
         FROM consumed`,
      [input.stateHash, input.sessionHash, input.redirectUri, input.clientId, consumedAt],
    );
    return result.rows[0] ? transactionFromRow(result.rows[0]) : null;
  }

  async saveCredential(credential: OAuthCredentialWrite): Promise<void> {
    await this.pool.query(
      `INSERT INTO oauth_credentials
         (provider, google_sub, email, refresh_token_ciphertext, scopes)
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (provider) DO UPDATE SET
         google_sub = EXCLUDED.google_sub,
         email = EXCLUDED.email,
         refresh_token_ciphertext = EXCLUDED.refresh_token_ciphertext,
         scopes = EXCLUDED.scopes,
         updated_at = now()`,
      [credential.provider, credential.googleSub, credential.email, credential.refreshTokenCiphertext, [...credential.scopes]],
    );
  }

  async getCredential(provider: "google" = "google"): Promise<OAuthCredentialRecord | null> {
    const result = await this.pool.query<OAuthCredentialRow>(
      `SELECT provider, google_sub, email, refresh_token_ciphertext, scopes, created_at, updated_at
         FROM oauth_credentials
        WHERE provider = $1`,
      [provider],
    );
    return result.rows[0] ? credentialFromRow(result.rows[0]) : null;
  }
}
