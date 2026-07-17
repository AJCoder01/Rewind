import { PostgresArtifactPort } from "@/lib/adapters/artifact";
import { loadApplicationEnvironment } from "@/lib/config/environment";
import { getOAuthStore, getPostgresPool } from "@/lib/db";
import { GoogleCalendarPort } from "@/lib/google/calendar";
import { refreshGoogleAccessToken } from "@/lib/google/credentials";
import { GoogleGmailPort } from "@/lib/google/gmail";
import { GOOGLE_OAUTH_SCOPES } from "@/lib/google/oauth";
import { createOpaqueId } from "@/lib/domain/ids";
import { createProviderGroundedInitialPlanner } from "@/lib/services/provider-grounded-initial-planner";

export async function loadLiveInitialExecutionRuntime(taskId: string) {
  const environment = loadApplicationEnvironment();
  if (environment.REWIND_STORAGE_MODE !== "postgres" || !environment.REWIND_GOOGLE_CALENDAR_ID) {
    throw new Error("Live initial execution requires PostgreSQL and the controlled Calendar target.");
  }
  const oauthStore = getOAuthStore();
  const credential = await oauthStore.getCredential();
  if (
    !credential ||
    credential.email !== environment.REWIND_GOOGLE_EXPECTED_EMAIL ||
    credential.googleSub !== environment.REWIND_GOOGLE_EXPECTED_SUB
  ) {
    throw new Error("The connected Google identity does not match the configured account.");
  }
  const expectedScopes = [...GOOGLE_OAUTH_SCOPES].sort();
  const actualScopes = [...credential.scopes].sort();
  if (expectedScopes.length !== actualScopes.length || expectedScopes.some((scope, index) => scope !== actualScopes[index])) {
    throw new Error("The connected Google credential does not have the exact approved scopes.");
  }
  const token = await refreshGoogleAccessToken(
    { clientId: environment.GOOGLE_CLIENT_ID, clientSecret: environment.GOOGLE_CLIENT_SECRET },
    credential,
    environment.REWIND_TOKEN_ENCRYPTION_KEY,
    oauthStore,
  );
  const calendar = new GoogleCalendarPort({
    accessToken: token.accessToken,
    calendarId: environment.REWIND_GOOGLE_CALENDAR_ID,
    expectedEmail: environment.REWIND_GOOGLE_EXPECTED_EMAIL,
  });
  return {
    artifactPort: new PostgresArtifactPort(getPostgresPool(), { taskId }),
    calendar,
    gmail: new GoogleGmailPort({ accessToken: token.accessToken }),
    calendarConfiguration: {
      calendarId: environment.REWIND_GOOGLE_CALENDAR_ID,
      demoDate: environment.REWIND_DEMO_DATE,
      expectedEmail: environment.REWIND_GOOGLE_EXPECTED_EMAIL,
      recipients: {
        UK: [environment.REWIND_RECIPIENT_ALLOWLIST.UK[0]] as readonly [string],
        US: [environment.REWIND_RECIPIENT_ALLOWLIST.US[0]] as readonly [string],
      },
    },
    expectedSenderGoogleSub: environment.REWIND_GOOGLE_EXPECTED_SUB,
    allowlist: {
      UK: [environment.REWIND_RECIPIENT_ALLOWLIST.UK[0]],
      US: [environment.REWIND_RECIPIENT_ALLOWLIST.US[0]],
    },
    async buildReplacement(payload: import("@/lib/contracts/v1").InitialPlanPayload) {
      const planner = createProviderGroundedInitialPlanner({ oauthStore, environment: process.env, calendar });
      const plannedAt = new Date();
      const resolution = await planner.resolveCandidates({ request: payload.request, now: plannedAt });
      const expanded = await planner.expandPlan({
        request: payload.request,
        taskId: payload.taskId,
        planId: createOpaqueId("plan_"),
        runId: payload.actions[2].desired.runId,
        version: payload.version + 1,
        resolution,
        now: plannedAt,
      });
      return expanded.planPayload;
    },
  };
}
