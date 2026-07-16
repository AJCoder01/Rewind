import { describe, expect, it } from "vitest";
import { FakeArtifactPort } from "@/lib/adapters/artifact";
import {
  ACCOUNT_BRIEF_CONTENT_FIXTURE,
  ACCOUNT_BRIEF_SOURCE_ID,
  ACCOUNT_BRIEF_VALIDATOR_VERSION,
  CONTROLLED_CONTENT_VERSION,
  PARENT_ACCOUNT_NOTES_FIXTURE,
} from "@/lib/domain/account-brief";
import { sha256Text } from "@/lib/domain/digest";
import {
  AccountBriefBoundaryError,
  CONTROLLED_ACCOUNT_BRIEF_PLANNING_INPUT,
  generateAccountBriefForPlanning,
  isCanonicalGeneratedAccountBrief,
  persistApprovedAccountBrief,
} from "@/lib/services/account-brief";

describe("S039 account brief boundary", () => {
  it("generates the exact brief from the versioned parent-account source during planning", () => {
    const artifact = generateAccountBriefForPlanning(CONTROLLED_ACCOUNT_BRIEF_PLANNING_INPUT);

    expect(artifact.content).toBe(ACCOUNT_BRIEF_CONTENT_FIXTURE);
    expect(artifact.contentHash).toBe(sha256Text(artifact.content));
    expect(artifact.provenance).toEqual({
      sourceId: ACCOUNT_BRIEF_SOURCE_ID,
      sourceVersion: CONTROLLED_CONTENT_VERSION,
      sourceDigest: sha256Text(PARENT_ACCOUNT_NOTES_FIXTURE),
      excludedDimensions: ["calendar_event", "region", "attendees", "meeting_time"],
      validatorVersion: ACCOUNT_BRIEF_VALIDATOR_VERSION,
    });
    expect(isCanonicalGeneratedAccountBrief(artifact)).toBe(true);
  });

  it("rejects non-planning generation and source drift", () => {
    expect(() => generateAccountBriefForPlanning({ ...CONTROLLED_ACCOUNT_BRIEF_PLANNING_INPUT, phase: "execution" } as never)).toThrowError(
      expect.objectContaining({ code: "planning_input_invalid" }),
    );
    expect(() =>
      generateAccountBriefForPlanning({
        ...CONTROLLED_ACCOUNT_BRIEF_PLANNING_INPUT,
        source: { ...CONTROLLED_ACCOUNT_BRIEF_PLANNING_INPUT.source, content: `${PARENT_ACCOUNT_NOTES_FIXTURE}\nUK` },
      }),
    ).toThrowError(expect.objectContaining({ code: "source_not_authorized" }));
  });

  it("rejects artifact leakage and any source/content hash drift before persistence", async () => {
    const artifact = generateAccountBriefForPlanning(CONTROLLED_ACCOUNT_BRIEF_PLANNING_INPUT);
    const store = new FakeArtifactPort();

    await expect(
      persistApprovedAccountBrief(store, { ...artifact, content: "Prepare the Acme UK meeting for attendees at 15:00 ET." }),
    ).rejects.toThrowError(expect.objectContaining({ code: "artifact_invalid" }));
    await expect(
      persistApprovedAccountBrief(store, { ...artifact, contentHash: sha256Text("wrong content") }),
    ).rejects.toThrowError(expect.objectContaining({ code: "artifact_invalid" }));
    await expect(
      persistApprovedAccountBrief(store, {
        ...artifact,
        provenance: { ...artifact.provenance, sourceDigest: sha256Text("different source") },
      }),
    ).rejects.toThrowError(expect.objectContaining({ code: "artifact_invalid" }));
    expect(store.getSavedForTest()).toBeNull();
  });

  it("persists the exact approved bytes without regenerating them", async () => {
    const approved = generateAccountBriefForPlanning(CONTROLLED_ACCOUNT_BRIEF_PLANNING_INPUT);
    const store = new FakeArtifactPort({ artifactId: "artifact_s039_exact" });
    const receipt = await persistApprovedAccountBrief(store, approved);

    expect(receipt.contentHash).toBe(approved.contentHash);
    expect(store.getSavedForTest()).toEqual(approved);
  });

  it("uses safe typed errors at the planning boundary", () => {
    try {
      generateAccountBriefForPlanning({ phase: "planning", source: { sourceId: "wrong", sourceVersion: CONTROLLED_CONTENT_VERSION, content: "source" } } as never);
      throw new Error("expected boundary error");
    } catch (error) {
      expect(error).toBeInstanceOf(AccountBriefBoundaryError);
      expect((error as AccountBriefBoundaryError).code).toBe("planning_input_invalid");
    }
  });
});
