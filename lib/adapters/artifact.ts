import type { Pool, QueryResultRow } from "pg";
import { AccountBriefArtifactInputSchema, ArtifactReceiptSchema, type AccountBriefArtifactInput, type ArtifactReceipt } from "@/lib/contracts/provider-ports";
import { sha256Text } from "@/lib/domain/digest";
import { canonicalJson } from "@/lib/domain/digest";
import { OpaqueIdSchema } from "@/lib/contracts/v1";

export type ArtifactProviderErrorKind = "unavailable" | "validation_failure";

export class ArtifactProviderError extends Error {
  readonly kind: ArtifactProviderErrorKind;

  constructor(kind: ArtifactProviderErrorKind) {
    super("Artifact persistence failed safely.");
    this.name = "ArtifactProviderError";
    this.kind = kind;
  }
}

export interface ArtifactPort {
  persistApprovedAccountBrief(input: AccountBriefArtifactInput): Promise<ArtifactReceipt>;
}

export type FakeArtifactOptions = Readonly<{
  failure?: ArtifactProviderErrorKind;
  artifactId?: string;
  storedAt?: string;
}>;

/** Deterministic artifact store; it persists supplied bytes and never generates them. */
export class FakeArtifactPort implements ArtifactPort {
  private readonly failure?: ArtifactProviderErrorKind;
  private readonly artifactId: string;
  private readonly storedAt: string;
  private saved: AccountBriefArtifactInput | null = null;

  constructor(options: FakeArtifactOptions = {}) {
    this.failure = options.failure;
    this.artifactId = options.artifactId ?? "fake-artifact-account-brief-v1";
    this.storedAt = options.storedAt ?? "2026-01-01T00:00:00.000Z";
  }

  async persistApprovedAccountBrief(input: AccountBriefArtifactInput): Promise<ArtifactReceipt> {
    const artifact = AccountBriefArtifactInputSchema.parse(input);
    if (this.failure) throw new ArtifactProviderError(this.failure);
    if (sha256Text(artifact.content) !== artifact.contentHash) {
      throw new ArtifactProviderError("validation_failure");
    }
    this.saved = {
      ...artifact,
      provenance: { ...artifact.provenance, excludedDimensions: [...artifact.provenance.excludedDimensions] },
    };
    return ArtifactReceiptSchema.parse({ artifactId: this.artifactId, contentHash: artifact.contentHash, storedAt: this.storedAt });
  }

  getSavedForTest(): AccountBriefArtifactInput | null {
    return this.saved
      ? {
          ...this.saved,
          provenance: { ...this.saved.provenance, excludedDimensions: [...this.saved.provenance.excludedDimensions] },
        }
      : null;
  }
}

type ArtifactRow = QueryResultRow & {
  id: string;
  task_id: string;
  kind: string;
  content: string;
  content_hash: string;
  provenance: unknown;
  created_at: Date | string;
};

export type PostgresArtifactOptions = Readonly<{
  taskId: string;
  artifactId?: string;
}>;

/** PostgreSQL artifact boundary; the task-scoped ID makes identical retries immutable and replay-safe. */
export class PostgresArtifactPort implements ArtifactPort {
  private readonly taskId: string;
  private readonly artifactId: string;

  constructor(private readonly pool: Pool, options: PostgresArtifactOptions) {
    this.taskId = OpaqueIdSchema.parse(options.taskId);
    this.artifactId = options.artifactId ?? `artifact_${this.taskId}`;
  }

  async persistApprovedAccountBrief(input: AccountBriefArtifactInput): Promise<ArtifactReceipt> {
    const artifact = AccountBriefArtifactInputSchema.parse(input);
    if (sha256Text(artifact.content) !== artifact.contentHash) throw new ArtifactProviderError("validation_failure");
    try {
      const inserted = await this.pool.query<ArtifactRow>(
        `INSERT INTO artifacts (id, task_id, kind, content, content_hash, provenance)
         VALUES ($1, $2, 'account_brief', $3, $4, $5::jsonb)
         ON CONFLICT (id) DO NOTHING
         RETURNING id, task_id, kind, content, content_hash, provenance, created_at`,
        [this.artifactId, this.taskId, artifact.content, artifact.contentHash, JSON.stringify(artifact.provenance)],
      );
      if (inserted.rowCount === 1) return receiptFromRow(inserted.rows[0]);

      const existing = await this.pool.query<ArtifactRow>(
        `SELECT id, task_id, kind, content, content_hash, provenance, created_at
           FROM artifacts
          WHERE id = $1`,
        [this.artifactId],
      );
      if (existing.rowCount !== 1 || !sameArtifact(existing.rows[0], this.taskId, artifact)) throw new ArtifactProviderError("validation_failure");
      return receiptFromRow(existing.rows[0]);
    } catch (error) {
      if (error instanceof ArtifactProviderError) throw error;
      throw new ArtifactProviderError("unavailable");
    }
  }
}

function sameArtifact(row: ArtifactRow, taskId: string, artifact: AccountBriefArtifactInput): boolean {
  return row.task_id === taskId && row.kind === "account_brief" && row.content === artifact.content && row.content_hash === artifact.contentHash && canonicalJson(row.provenance) === canonicalJson(artifact.provenance);
}

function receiptFromRow(row: ArtifactRow): ArtifactReceipt {
  return ArtifactReceiptSchema.parse({ artifactId: row.id, contentHash: row.content_hash, storedAt: new Date(row.created_at).toISOString() });
}
