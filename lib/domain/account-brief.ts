import {
  CONTROLLED_ATTENDEE_ALIASES,
  CONTROLLED_CANDIDATE_IDS,
  CONTROLLED_CANDIDATE_TITLES,
  CONTROLLED_MEETING_DATE_REPRESENTATIONS,
  CONTROLLED_MEETING_TIME_REPRESENTATIONS,
  CONTROLLED_PROVIDER_EVENT_IDS,
  CONTROLLED_REGIONS,
} from "@/lib/domain/scenario";

export const CONTROLLED_CONTENT_VERSION = "controlled-content.v1";
export const ACCOUNT_BRIEF_VALIDATOR_VERSION = "artifact-independence.v1";
export const ACCOUNT_BRIEF_SOURCE_ID = "acme_parent_account_notes";
export const ACCOUNT_BRIEF_TITLE = "Acme parent-account renewal risk brief";

export const PARENT_ACCOUNT_NOTES_FIXTURE = [
  "Acme parent-account notes",
  "Adoption is healthy.",
  "Executive sponsorship should be reconfirmed.",
  "Procurement timing is the main schedule risk.",
  "Confirm decision owners and renewal milestones.",
].join("\n");

export const ACCOUNT_BRIEF_CONTENT_FIXTURE = [
  ACCOUNT_BRIEF_TITLE,
  "",
  "- Adoption is healthy, but executive sponsorship should be reconfirmed.",
  "- Procurement timing is the main schedule risk.",
  "- Next step: confirm decision owners and renewal milestones.",
].join("\n");

type ForbiddenArtifactDimension = Readonly<{ name: string; pattern: RegExp }>;

function escaped(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function exactValues(name: string, values: readonly string[]): ForbiddenArtifactDimension {
  const alternatives = values.map((value) => escaped(value.toLocaleLowerCase("en-US"))).join("|");
  return { name, pattern: new RegExp(`(?:^|\\b)(?:${alternatives})(?=\\b|$)`, "i") };
}

const forbiddenArtifactDimensions: readonly ForbiddenArtifactDimension[] = [
  exactValues("candidate ID", CONTROLLED_CANDIDATE_IDS),
  exactValues("candidate title", CONTROLLED_CANDIDATE_TITLES),
  exactValues("provider event ID", CONTROLLED_PROVIDER_EVENT_IDS),
  exactValues("attendee alias", CONTROLLED_ATTENDEE_ALIASES),
  exactValues("region", CONTROLLED_REGIONS),
  exactValues("meeting date", CONTROLLED_MEETING_DATE_REPRESENTATIONS),
  exactValues("meeting time", CONTROLLED_MEETING_TIME_REPRESENTATIONS),
  { name: "meeting time", pattern: /\b(?:10|11):00\s*(?:am|a\.m\.|et|eastern time)\b|\b(?:3:00\s*(?:pm|p\.m\.|et|eastern time)|15:00(?:\s*(?:et|eastern time))?)\b/i },
  { name: "provider detail", pattern: /\b(?:america\/new_york|fixture-(?:uk|us)-(?:etag|after)-v1|fixture-demo-calendar|google calendar|gmail)\b/i },
];

export function assertAccountBriefIndependent(content: string): void {
  const normalized = content.replace(/\s+/g, " ").trim();
  const leakedDimension = forbiddenArtifactDimensions.find(({ pattern }) => {
    pattern.lastIndex = 0;
    return pattern.test(normalized);
  });
  if (leakedDimension) throw new Error(`Account brief contains forbidden scenario dimension: ${leakedDimension.name}`);
}
