import { AccountBriefArtifactInputSchema, ArtifactReceiptSchema, type AccountBriefArtifactInput, type ArtifactReceipt } from "@/lib/contracts/provider-ports";
import { sha256Text } from "@/lib/domain/digest";

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
