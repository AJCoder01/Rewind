import { describe, expect, it } from "vitest";
import { sha256Text } from "@/lib/domain/digest";
import {
  ACCOUNT_BRIEF_CONTENT_FIXTURE,
  ACCOUNT_BRIEF_SOURCE_ID,
  ACCOUNT_BRIEF_TITLE,
  ACCOUNT_BRIEF_VALIDATOR_VERSION,
  CONTROLLED_CONTENT_VERSION,
  PARENT_ACCOUNT_NOTES_FIXTURE,
  assertAccountBriefIndependent,
} from "@/lib/domain/account-brief";
import { buildFixtureWorldPrRecord } from "@/lib/domain/fixture-world-pr";
import { SUPPORTED_SCENARIO_REQUEST } from "@/lib/domain/scenario";

describe("controlled content inventory", () => {
  it("freezes the source/output/version tuple and independence boundary", () => {
    expect(CONTROLLED_CONTENT_VERSION).toBe("controlled-content.v1");
    expect(ACCOUNT_BRIEF_SOURCE_ID).toBe("acme_parent_account_notes");
    expect(ACCOUNT_BRIEF_TITLE).toBe("Acme parent-account renewal risk brief");
    expect(ACCOUNT_BRIEF_CONTENT_FIXTURE).toContain("Procurement timing is the main schedule risk.");
    expect(() => assertAccountBriefIndependent(PARENT_ACCOUNT_NOTES_FIXTURE)).not.toThrow();
    expect(() => assertAccountBriefIndependent(ACCOUNT_BRIEF_CONTENT_FIXTURE)).not.toThrow();
  });

  it("uses the frozen bytes and provenance in the complete fixture plan", () => {
    const { planPayload } = buildFixtureWorldPrRecord(SUPPORTED_SCENARIO_REQUEST, new Date("2026-07-15T00:00:00.000Z"));
    const brief = planPayload.actions[0].desired;
    expect(brief.title).toBe(ACCOUNT_BRIEF_TITLE);
    expect(brief.content).toBe(ACCOUNT_BRIEF_CONTENT_FIXTURE);
    expect(brief.contentHash).toBe(sha256Text(ACCOUNT_BRIEF_CONTENT_FIXTURE));
    expect(brief.provenance.sourceId).toBe(ACCOUNT_BRIEF_SOURCE_ID);
    expect(brief.provenance.sourceVersion).toBe(CONTROLLED_CONTENT_VERSION);
    expect(brief.provenance.sourceDigest).toBe(sha256Text(PARENT_ACCOUNT_NOTES_FIXTURE));
    expect(brief.provenance.validatorVersion).toBe(ACCOUNT_BRIEF_VALIDATOR_VERSION);
  });

  it("rejects every closed selected-event, region, attendee, date/time, and provider leakage dimension", () => {
    const leaks = [
      ["candidate ID", "Selected cal_event_acme_uk."],
      ["candidate title", "Selected Acme US renewal."],
      ["provider event ID", "Source fixture-event-uk."],
      ["attendee alias", "Send to uk-ops@example.test."],
      ["region", "The UK account."],
      ["meeting date", "Meeting date: August 20, 2026."],
      ["meeting time", "Meeting time: 15:00 ET."],
      ["provider detail", "Calendar zone: America/New_York."],
    ] as const;
    for (const [dimension, content] of leaks) {
      expect(() => assertAccountBriefIndependent(content)).toThrow(`forbidden scenario dimension: ${dimension}`);
    }
  });
});
