import type { Pool, QueryResultRow } from "pg";
import {
  DemoEventStateSchema,
  DemoSeedAuditMetadataSchema,
  type DemoEventState,
  type DemoSeedAuditMetadata,
} from "@/lib/contracts/calendar-demo";

export type DemoSeedAuditInput = Readonly<{
  candidateId: DemoSeedAuditMetadata["candidateId"];
  runId: string;
  status: "started" | "failed";
  failureKind?: "provider" | "validation" | "persistence";
}>;

export interface DemoEventStateStore {
  readAll(): Promise<readonly DemoEventState[]>;
  recordSeedAudit(input: DemoSeedAuditInput): Promise<void>;
  saveSeededState(state: DemoEventState): Promise<void>;
}

function copyState(state: DemoEventState): DemoEventState {
  return DemoEventStateSchema.parse(JSON.parse(JSON.stringify(state)) as unknown);
}

/** Deterministic state store for unit tests; it never contacts PostgreSQL. */
export class MemoryDemoEventStateStore implements DemoEventStateStore {
  private readonly states = new Map<string, DemoEventState>();
  private readonly audits: DemoSeedAuditMetadata[] = [];

  async readAll(): Promise<readonly DemoEventState[]> {
    return Array.from(this.states.values()).sort((left, right) => left.candidateId.localeCompare(right.candidateId)).map(copyState);
  }

  async recordSeedAudit(input: DemoSeedAuditInput): Promise<void> {
    const parsed = DemoSeedAuditMetadataSchema.parse({ operation: "seed", ...input });
    this.audits.push(parsed);
  }

  async saveSeededState(state: DemoEventState): Promise<void> {
    const parsed = DemoEventStateSchema.parse(state);
    if (this.states.has(parsed.candidateId)) throw new Error("Demo event baseline is immutable and already exists.");
    this.states.set(parsed.candidateId, copyState(parsed));
  }

  getAuditsForTest(): readonly DemoSeedAuditMetadata[] {
    return this.audits.map((audit) => ({ ...audit }));
  }
}

type DemoEventStateRow = QueryResultRow & {
  candidate_id: string;
  semantic_baseline: unknown;
  expected_etag: string;
  expected_updated_at: Date | string | null;
  last_receipt: unknown;
};

/** Runtime store for the protected `demo_event_state` foundation table. */
export class PostgresDemoEventStateStore implements DemoEventStateStore {
  constructor(private readonly pool: Pool) {}

  async readAll(): Promise<readonly DemoEventState[]> {
    const result = await this.pool.query<DemoEventStateRow>(
      `SELECT candidate_id, semantic_baseline, expected_etag, expected_updated_at, last_receipt
         FROM demo_event_state
        ORDER BY candidate_id`,
    );
    return result.rows.map((row) =>
      DemoEventStateSchema.parse({
        candidateId: row.candidate_id,
        semanticBaseline: row.semantic_baseline,
        expectedEtag: row.expected_etag,
        expectedUpdatedAt: row.expected_updated_at ? new Date(row.expected_updated_at).toISOString() : null,
        lastReceipt: row.last_receipt,
      }),
    );
  }

  async recordSeedAudit(input: DemoSeedAuditInput): Promise<void> {
    const metadata = DemoSeedAuditMetadataSchema.parse({ operation: "seed", ...input });
    const eventType = metadata.status === "started" ? "demo.seed.started" : "demo.seed.failed";
    await this.pool.query(
      `INSERT INTO audit_events (task_id, event_type, metadata, occurred_at)
       VALUES (NULL, $1, $2::jsonb, now())`,
      [eventType, JSON.stringify(metadata)],
    );
  }

  async saveSeededState(state: DemoEventState): Promise<void> {
    const parsed = DemoEventStateSchema.parse(state);
    const result = await this.pool.query<{ candidate_id: string }>(
      `INSERT INTO demo_event_state
        (candidate_id, semantic_baseline, expected_etag, expected_updated_at, last_receipt, updated_at)
       VALUES ($1, $2::jsonb, $3, $4, $5::jsonb, now())
       ON CONFLICT (candidate_id) DO NOTHING
       RETURNING candidate_id`,
      [
        parsed.candidateId,
        JSON.stringify(parsed.semanticBaseline),
        parsed.expectedEtag,
        parsed.expectedUpdatedAt,
        JSON.stringify(parsed.lastReceipt),
      ],
    );
    if (result.rowCount !== 1) throw new Error("Demo event baseline is immutable and already exists.");
  }
}
