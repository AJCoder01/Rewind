import type { CalendarPort } from "@/lib/adapters/calendar";
import type { ModelProposalPort } from "@/lib/ai/model";
import { createProductModel } from "@/lib/ai/product-model";
import { parseApplicationEnvironment, type Environment } from "@/lib/config/environment";
import type { CandidateResolutionSnapshot } from "@/lib/contracts/candidate-resolution";
import type { OAuthStore } from "@/lib/db/oauth-store";
import type { ProviderGroundedInitialPlanner } from "@/lib/db/postgres-store";
import { GoogleCalendarPort } from "@/lib/google/calendar";
import { refreshGoogleAccessToken } from "@/lib/google/credentials";
import { GOOGLE_OAUTH_SCOPES } from "@/lib/google/oauth";
import { resolveControlledCandidates } from "@/lib/services/candidate-resolution";
import { expandInitialPlan } from "@/lib/services/initial-plan-expansion";
import { reasonInitialRequest } from "@/lib/services/initial-reasoning";

export type ProviderGroundedInitialPlannerDependencies = Readonly<{
  oauthStore: OAuthStore;
  environment?: Environment;
  calendar?: CalendarPort;
  model?: ModelProposalPort;
}>;

/**
 * Production planner for the locked Acme scenario. Calendar facts and model
 * proposals are read before an immutable plan is persisted; provider IDs,
 * recipients, times, templates, and action order remain deterministic.
 */
export function createProviderGroundedInitialPlanner(
  dependencies: ProviderGroundedInitialPlannerDependencies,
): ProviderGroundedInitialPlanner {
  const rawEnvironment = dependencies.environment ?? process.env;

  async function calendarForRead(): Promise<CalendarPort> {
    if (dependencies.calendar) return dependencies.calendar;
    const environment = parseApplicationEnvironment(rawEnvironment);
    const credential = await dependencies.oauthStore.getCredential();
    assertConnectedCredential(credential, environment);
    const token = await refreshGoogleAccessToken(
      { clientId: environment.GOOGLE_CLIENT_ID, clientSecret: environment.GOOGLE_CLIENT_SECRET },
      credential,
      environment.REWIND_TOKEN_ENCRYPTION_KEY,
      dependencies.oauthStore,
    );
    if (!environment.REWIND_GOOGLE_CALENDAR_ID) throw new Error("The controlled Calendar target is not configured.");
    return new GoogleCalendarPort({
      accessToken: token.accessToken,
      calendarId: environment.REWIND_GOOGLE_CALENDAR_ID,
      expectedEmail: environment.REWIND_GOOGLE_EXPECTED_EMAIL,
    });
  }

  return {
    async resolveCandidates(input): Promise<CandidateResolutionSnapshot> {
      const environment = parseApplicationEnvironment(rawEnvironment);
      if (!environment.REWIND_GOOGLE_CALENDAR_ID) throw new Error("The controlled Calendar target is not configured.");
      return resolveControlledCandidates({
        calendar: await calendarForRead(),
        configuration: {
          calendarId: environment.REWIND_GOOGLE_CALENDAR_ID,
          demoDate: environment.REWIND_DEMO_DATE,
          expectedEmail: environment.REWIND_GOOGLE_EXPECTED_EMAIL,
          recipients: {
            UK: [environment.REWIND_RECIPIENT_ALLOWLIST.UK[0]],
            US: [environment.REWIND_RECIPIENT_ALLOWLIST.US[0]],
          },
        },
        now: input.now,
      });
    },

    async expandPlan(input) {
      const environment = parseApplicationEnvironment(rawEnvironment);
      if (!environment.REWIND_GOOGLE_CALENDAR_ID) throw new Error("The controlled Calendar target is not configured.");
      const model = dependencies.model ?? createProductModel(environment);
      const reasoning = await reasonInitialRequest({
        request: input.request,
        resolution: input.resolution,
        model,
        now: input.now,
      });
      return expandInitialPlan({
        request: input.request,
        taskId: input.taskId,
        planId: input.planId,
        runId: input.runId,
        version: input.version,
        resolution: input.resolution,
        reasoning,
        configuration: {
          calendarId: environment.REWIND_GOOGLE_CALENDAR_ID,
          expectedEmail: environment.REWIND_GOOGLE_EXPECTED_EMAIL,
          senderGoogleSub: environment.REWIND_GOOGLE_EXPECTED_SUB,
          recipients: environment.REWIND_RECIPIENT_ALLOWLIST,
        },
        now: input.now,
      });
    },
  };
}

function assertConnectedCredential(
  credential: Awaited<ReturnType<OAuthStore["getCredential"]>>,
  environment: ReturnType<typeof parseApplicationEnvironment>,
): asserts credential is NonNullable<typeof credential> {
  if (
    !credential ||
    credential.email !== environment.REWIND_GOOGLE_EXPECTED_EMAIL ||
    credential.googleSub !== environment.REWIND_GOOGLE_EXPECTED_SUB
  ) {
    throw new Error("The connected Google identity does not match the configured account.");
  }
  const expected = [...GOOGLE_OAUTH_SCOPES].sort();
  const actual = [...credential.scopes].sort();
  if (expected.length !== actual.length || expected.some((scope, index) => scope !== actual[index])) {
    throw new Error("The connected Google credential does not have the exact approved scopes.");
  }
}
