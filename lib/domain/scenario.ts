export const SUPPORTED_SCENARIO_REQUEST =
  "Move the Acme renewal meeting on 2026-08-20 to 3:00 PM ET, prepare a risk brief from the shared Acme parent-account notes, and email the attendees.";

// Closed, synthetic values used only to validate that an account brief remains
// independent from selected event and provider-derived details.
export const CONTROLLED_CANDIDATE_IDS = ["cal_event_acme_uk", "cal_event_acme_us"] as const;
export const CONTROLLED_CANDIDATE_TITLES = ["Acme UK renewal", "Acme US renewal"] as const;
export const CONTROLLED_PROVIDER_EVENT_IDS = ["fixture-event-uk", "fixture-event-us"] as const;
export const CONTROLLED_ATTENDEE_ALIASES = ["uk-ops@example.test", "us-ops@example.test"] as const;
export const CONTROLLED_REGIONS = ["UK", "US"] as const;
export const CONTROLLED_MEETING_DATE_REPRESENTATIONS = [
  "2026-08-20",
  "August 20, 2026",
  "20 August 2026",
  "08/20/2026",
] as const;
export const CONTROLLED_MEETING_TIME_REPRESENTATIONS = [
  "10:00 AM",
  "11:00 AM",
  "3:00 PM",
  "15:00 ET",
] as const;

function normalizeRequest(value: string): string {
  return value.trim().replace(/\s+/g, " ").toLocaleLowerCase("en-US");
}

export function isSupportedScenarioRequest(request: string): boolean {
  return normalizeRequest(request) === normalizeRequest(SUPPORTED_SCENARIO_REQUEST);
}
