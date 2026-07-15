export const ACCOUNT_BRIEF_VALIDATOR_VERSION = "artifact-independence.v1";

export const PARENT_ACCOUNT_NOTES_FIXTURE = [
  "Acme parent-account notes",
  "Adoption is healthy.",
  "Executive sponsorship should be reconfirmed.",
  "Procurement timing is the main schedule risk.",
  "Confirm decision owners and renewal milestones.",
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
