import {
  CandidateResolutionSnapshotSchema,
  PlanningLockLeaseSchema,
  RulePrecheckResultSchema,
  type CandidateResolutionSnapshot,
  type PlanningLockLease,
  type RulePrecheckResult,
} from "@/lib/contracts/candidate-resolution";
import {
  CalendarEventSnapshotSchema,
  type CalendarEventSnapshot,
} from "@/lib/contracts/provider-ports";
import { CalendarProviderError, type CalendarPort } from "@/lib/adapters/calendar";
import {
  buildControlledCalendarSeeds,
  validateControlledCalendarEventMetadata,
  type CalendarDemoConfiguration,
} from "@/lib/domain/calendar-demo";
import { canonicalJson, sha256Digest } from "@/lib/domain/digest";
import { ControlledCalendarCandidateIdSchema } from "@/lib/contracts/calendar-demo";
import { CandidateResolutionCandidateSchema } from "@/lib/contracts/candidate-resolution";
import { CandidateSchema } from "@/lib/contracts/v1";

export type CandidateResolutionErrorKind =
  | "provider_unavailable"
  | "candidate_count"
  | "candidate_invalid"
  | "stale_snapshot"
  | "lock_unavailable";

export class CandidateResolutionError extends Error {
  readonly kind: CandidateResolutionErrorKind;

  constructor(kind: CandidateResolutionErrorKind) {
    super("Controlled candidate resolution failed safely.");
    this.name = "CandidateResolutionError";
    this.kind = kind;
  }
}

export type PreLockRulePort = Readonly<{
  evaluate(input: Readonly<{
    request: string;
    resolution: CandidateResolutionSnapshot;
  }>): Promise<RulePrecheckResult>;
}>;

export type PlanningLockPort = Readonly<{
  acquire(input: Readonly<{ worldPrId: string; leaseUntil: Date }>): Promise<PlanningLockLease>;
}>;

export type ResolveCandidatesInput = Readonly<{
  calendar: CalendarPort;
  configuration: CalendarDemoConfiguration;
  now?: Date;
  resolutionVersion?: number;
  supersedesPlanId?: string;
}>;

export type BeforePlanningResult = Readonly<{
  resolution: CandidateResolutionSnapshot;
  rule: RulePrecheckResult;
  lock: PlanningLockLease | null;
}>;

function candidateIdForRegion(region: "UK" | "US") {
  return region === "UK" ? "cal_event_acme_uk" : "cal_event_acme_us";
}

function labelForRegion(region: "UK" | "US"): string {
  return `Acme ${region} renewal`;
}

function compareSnapshots(left: CalendarEventSnapshot, right: CalendarEventSnapshot): number {
  const startDifference = Date.parse(left.start.instant) - Date.parse(right.start.instant);
  if (startDifference !== 0) return startDifference;
  if (left.region === right.region) return left.providerEventId.localeCompare(right.providerEventId);
  return left.region === "UK" ? -1 : 1;
}

function validateSnapshotSet(
  rawSnapshots: readonly CalendarEventSnapshot[],
  configuration: CalendarDemoConfiguration,
): readonly CalendarEventSnapshot[] {
  if (rawSnapshots.length !== 2) throw new CandidateResolutionError("candidate_count");
  const seeds = new Map(buildControlledCalendarSeeds(configuration).map((seed) => [seed.region, seed]));
  const byRegion = new Map<"UK" | "US", CalendarEventSnapshot>();
  const providerIds = new Set<string>();
  for (const raw of rawSnapshots) {
    let snapshot: CalendarEventSnapshot;
    try {
      snapshot = CalendarEventSnapshotSchema.parse(raw);
    } catch {
      throw new CandidateResolutionError("candidate_invalid");
    }
    if (byRegion.has(snapshot.region) || providerIds.has(snapshot.providerEventId)) {
      throw new CandidateResolutionError("candidate_count");
    }
    const seed = seeds.get(snapshot.region);
    if (!seed) throw new CandidateResolutionError("candidate_invalid");
    try {
      validateControlledCalendarEventMetadata(snapshot, configuration, snapshot.region);
    } catch {
      throw new CandidateResolutionError("candidate_invalid");
    }
    if (
      snapshot.start.instant !== seed.start.instant ||
      snapshot.start.timeZone !== seed.start.timeZone ||
      snapshot.end.instant !== seed.end.instant ||
      snapshot.end.timeZone !== seed.end.timeZone
    ) {
      throw new CandidateResolutionError("candidate_invalid");
    }
    byRegion.set(snapshot.region, snapshot);
    providerIds.add(snapshot.providerEventId);
  }
  if (!byRegion.has("UK") || !byRegion.has("US")) throw new CandidateResolutionError("candidate_count");
  return [byRegion.get("UK")!, byRegion.get("US")!];
}

function toCandidate(snapshot: CalendarEventSnapshot, rank: number) {
  const region = snapshot.region;
  return CandidateResolutionCandidateSchema.parse({
    candidateId: candidateIdForRegion(region),
    label: labelForRegion(region),
    providerEventId: snapshot.providerEventId,
    region,
    start: snapshot.start,
    end: snapshot.end,
    etag: snapshot.etag,
    attendeeSetDigest: snapshot.attendeeSetDigest,
    rankingEvidence: [
      "Tagged Acme renewal on the configured demo date.",
      rank === 0 ? "Earliest controlled start; selected by deterministic ranking." : "Later controlled start; retained as the visible alternative.",
    ],
  });
}

export async function resolveControlledCandidates(input: ResolveCandidatesInput): Promise<CandidateResolutionSnapshot> {
  let rawSnapshots: readonly CalendarEventSnapshot[];
  try {
    rawSnapshots = await input.calendar.listControlledEvents({ calendarId: input.configuration.calendarId, tag: "acme-renewal" });
  } catch (error) {
    if (error instanceof CalendarProviderError) throw new CandidateResolutionError("provider_unavailable");
    throw new CandidateResolutionError("provider_unavailable");
  }

  const validated = validateSnapshotSet(rawSnapshots, input.configuration);
  const ranked = [...validated].sort(compareSnapshots);
  const candidates = ranked.map(toCandidate);
  const rankedCandidateIds = candidates.map((candidate) => candidate.candidateId) as ["cal_event_acme_uk", "cal_event_acme_us"] | ["cal_event_acme_us", "cal_event_acme_uk"];
  if (rankedCandidateIds[0] !== "cal_event_acme_uk") throw new CandidateResolutionError("candidate_invalid");
  const now = input.now ?? new Date();
  const snapshotCore = {
    contractVersion: "candidate-resolution.v1" as const,
    calendarId: input.configuration.calendarId,
    demoDate: input.configuration.demoDate,
    resolutionVersion: input.resolutionVersion ?? 1,
    ...(input.supersedesPlanId ? { supersedesPlanId: input.supersedesPlanId } : {}),
    candidates,
    rankedCandidateIds,
    selectedCandidateId: rankedCandidateIds[0],
    alternativeCandidateIds: [rankedCandidateIds[1]] as [typeof rankedCandidateIds[1]],
    resolvedAt: now.toISOString(),
  };
  const digestCore = {
    calendarId: snapshotCore.calendarId,
    demoDate: snapshotCore.demoDate,
    candidates: snapshotCore.candidates,
    rankedCandidateIds: snapshotCore.rankedCandidateIds,
    selectedCandidateId: snapshotCore.selectedCandidateId,
    alternativeCandidateIds: snapshotCore.alternativeCandidateIds,
  };
  return CandidateResolutionSnapshotSchema.parse({
    ...snapshotCore,
    snapshotDigest: sha256Digest(digestCore),
  });
}

export async function resolveBeforePlanning(input: Readonly<{
  request: string;
  worldPrId: string;
  calendar: CalendarPort;
  configuration: CalendarDemoConfiguration;
  rule: PreLockRulePort;
  lock: PlanningLockPort;
  now?: Date;
  leaseDurationMs?: number;
}>): Promise<BeforePlanningResult> {
  const resolution = await resolveControlledCandidates({
    calendar: input.calendar,
    configuration: input.configuration,
    now: input.now,
  });
  const rule = RulePrecheckResultSchema.parse(await input.rule.evaluate({ request: input.request, resolution }));
  if (rule.matched) return { resolution, rule, lock: null };
  const now = input.now ?? new Date();
  const leaseUntil = new Date(now.getTime() + (input.leaseDurationMs ?? 10 * 60_000));
  try {
    const lock = PlanningLockLeaseSchema.parse(await input.lock.acquire({ worldPrId: input.worldPrId, leaseUntil }));
    return { resolution, rule, lock };
  } catch (error) {
    if (error instanceof CandidateResolutionError) throw error;
    throw new CandidateResolutionError("lock_unavailable");
  }
}

export function assertCandidateResolutionFresh(
  approved: CandidateResolutionSnapshot,
  current: CandidateResolutionSnapshot,
): void {
  const approvedValue = CandidateResolutionSnapshotSchema.parse(approved);
  const currentValue = CandidateResolutionSnapshotSchema.parse(current);
  const comparable = (value: CandidateResolutionSnapshot) => ({
    calendarId: value.calendarId,
    demoDate: value.demoDate,
    candidates: value.candidates,
    rankedCandidateIds: value.rankedCandidateIds,
    selectedCandidateId: value.selectedCandidateId,
    alternativeCandidateIds: value.alternativeCandidateIds,
  });
  if (canonicalJson(comparable(approvedValue)) !== canonicalJson(comparable(currentValue))) {
    throw new CandidateResolutionError("stale_snapshot");
  }
}

export async function refreshCandidateResolution(input: Readonly<{
  previous: CandidateResolutionSnapshot;
  calendar: CalendarPort;
  configuration: CalendarDemoConfiguration;
  now?: Date;
  supersedesPlanId?: string;
}>): Promise<CandidateResolutionSnapshot> {
  const previous = CandidateResolutionSnapshotSchema.parse(input.previous);
  const refreshed = await resolveControlledCandidates({
    calendar: input.calendar,
    configuration: input.configuration,
    now: input.now,
    resolutionVersion: previous.resolutionVersion + 1,
    supersedesPlanId: input.supersedesPlanId ?? previous.supersedesPlanId,
  });
  if (refreshed.snapshotDigest === previous.snapshotDigest) {
    return CandidateResolutionSnapshotSchema.parse({ ...refreshed, resolutionVersion: previous.resolutionVersion + 1 });
  }
  return refreshed;
}

export class NoActiveRulePort implements PreLockRulePort {
  async evaluate(): Promise<RulePrecheckResult> {
    return { matched: false };
  }
}

export class FixturePreLockRulePort implements PreLockRulePort {
  private readonly active: boolean;

  constructor(active: boolean) {
    this.active = active;
  }

  async evaluate(input: Readonly<{ request: string; resolution: CandidateResolutionSnapshot }>): Promise<RulePrecheckResult> {
    void input.request;
    const resolution = CandidateResolutionSnapshotSchema.parse(input.resolution);
    if (!this.active) return { matched: false };
    return {
      matched: true,
      ruleId: "rule_acme_region_v1",
      question: "I found Acme UK and Acme US. Which one did you mean?",
      candidates: resolution.candidates.map((candidate) => CandidateSchema.parse({ candidateId: candidate.candidateId, label: candidate.label })),
    };
  }
}

export class MemoryPlanningLockPort implements PlanningLockPort {
  private heldBy: string | undefined;

  async acquire(input: Readonly<{ worldPrId: string; leaseUntil: Date }>): Promise<PlanningLockLease> {
    if (this.heldBy && this.heldBy !== input.worldPrId) throw new CandidateResolutionError("lock_unavailable");
    this.heldBy = input.worldPrId;
    return { acquired: true, worldPrId: input.worldPrId, leaseUntil: input.leaseUntil.toISOString() };
  }

  release(worldPrId: string): void {
    if (this.heldBy === worldPrId) this.heldBy = undefined;
  }

  hasLock(): boolean {
    return this.heldBy !== undefined;
  }
}

export function candidateResolutionDigest(resolution: CandidateResolutionSnapshot): string {
  const parsed = CandidateResolutionSnapshotSchema.parse(resolution);
  return sha256Digest({
    calendarId: parsed.calendarId,
    demoDate: parsed.demoDate,
    candidates: parsed.candidates,
    rankedCandidateIds: parsed.rankedCandidateIds,
  });
}

export const CANDIDATE_ID_SCHEMA = ControlledCalendarCandidateIdSchema;
