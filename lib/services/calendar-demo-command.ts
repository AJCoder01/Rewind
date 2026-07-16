import {
  EnvironmentConfigError,
  type ApplicationEnvironment,
} from "@/lib/config/environment";
import { sha256Text } from "@/lib/domain/digest";
import { CalendarDemoSetupError } from "@/lib/services/calendar-demo";
import { CalendarDemoValidationError, type CalendarDemoConfiguration } from "@/lib/domain/calendar-demo";
import { CalendarProviderError } from "@/lib/adapters/calendar";

export type DemoCommandGuardKind =
  | "tty_required"
  | "production_refused"
  | "ci_refused"
  | "fixture_storage_refused"
  | "calendar_target_missing";

export class DemoCommandGuardError extends Error {
  readonly kind: DemoCommandGuardKind;

  constructor(kind: DemoCommandGuardKind) {
    super("The controlled demo command is not permitted in this environment.");
    this.name = "DemoCommandGuardError";
    this.kind = kind;
  }
}

export function assertTtyGatedDemoEnvironment(
  environment: Readonly<Record<string, string | undefined>>,
  io: Readonly<{ stdinIsTTY: boolean | undefined; stdoutIsTTY: boolean | undefined }>,
): void {
  if (environment.NODE_ENV === "production") throw new DemoCommandGuardError("production_refused");
  if (/^(1|true|yes)$/i.test((environment.CI ?? "").trim())) throw new DemoCommandGuardError("ci_refused");
  if (environment.REWIND_STORAGE_MODE !== "postgres") throw new DemoCommandGuardError("fixture_storage_refused");
  if (io.stdinIsTTY !== true || io.stdoutIsTTY !== true) throw new DemoCommandGuardError("tty_required");
}

export function calendarDemoConfigurationFromEnvironment(environment: ApplicationEnvironment): CalendarDemoConfiguration {
  const calendarId = environment.REWIND_GOOGLE_CALENDAR_ID;
  if (!calendarId || calendarId === "primary" || calendarId.trim() !== calendarId) {
    throw new DemoCommandGuardError("calendar_target_missing");
  }
  return {
    calendarId,
    demoDate: environment.REWIND_DEMO_DATE,
    expectedEmail: environment.REWIND_GOOGLE_EXPECTED_EMAIL,
    recipients: {
      UK: [environment.REWIND_RECIPIENT_ALLOWLIST.UK[0]],
      US: [environment.REWIND_RECIPIENT_ALLOWLIST.US[0]],
    },
  };
}

export function targetFingerprint(calendarId: string, databaseUrl: string): string {
  return sha256Text(`calendar\0${calendarId}\0database\0${databaseUrl}`).slice(0, 23);
}

/**
 * The interactive phrase deliberately repeats the exact configured Calendar
 * target. A fingerprint alone cannot let an operator confirm what a command
 * is about to read or write. This string is used only in a private TTY prompt;
 * command results and committed evidence remain redacted.
 */
export function confirmationPhrase(operation: "seed" | "preflight", runId: string, calendarId: string): string {
  if (!calendarId || calendarId.trim() !== calendarId || /[\r\n]/.test(calendarId)) {
    throw new DemoCommandGuardError("calendar_target_missing");
  }
  return `CONFIRM ${operation.toUpperCase()} ${runId} CALENDAR ${calendarId}`;
}

export function safeDemoCommandFailureCode(error: unknown): string {
  if (error instanceof DemoCommandGuardError) return error.kind;
  if (error instanceof CalendarDemoSetupError) return error.kind;
  if (error instanceof CalendarDemoValidationError) return error.kind;
  if (error instanceof CalendarProviderError) return "provider_unavailable";
  if (error instanceof EnvironmentConfigError) return "invalid_environment";
  return "failed_safely";
}
