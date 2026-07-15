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

const forbiddenDimensions = [
  "acme uk",
  "acme us",
  "calendar",
  "attendee",
  "america/new_york",
  "2026-08-20",
  "10:00",
  "11:00",
  "15:00",
] as const;

export function assertAccountBriefIndependent(content: string): void {
  const normalized = content.toLocaleLowerCase("en-US");
  const leakedDimension = forbiddenDimensions.find((value) => normalized.includes(value));
  if (leakedDimension) throw new Error(`Account brief contains forbidden scenario dimension: ${leakedDimension}`);
}
