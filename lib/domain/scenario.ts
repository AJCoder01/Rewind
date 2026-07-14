export const SUPPORTED_SCENARIO_REQUEST =
  "Move the Acme renewal meeting on 2026-08-20 to 3:00 PM ET, prepare a risk brief from the shared Acme parent-account notes, and email the attendees.";

function normalizeRequest(value: string): string {
  return value.trim().replace(/\s+/g, " ").toLocaleLowerCase("en-US");
}

export function isSupportedScenarioRequest(request: string): boolean {
  return normalizeRequest(request) === normalizeRequest(SUPPORTED_SCENARIO_REQUEST);
}
