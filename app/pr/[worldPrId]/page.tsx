"use client";

import { use, useEffect, useRef, useState } from "react";
import Link from "next/link";
import {
  ApiErrorResponseSchema,
  isInitialPlanView,
  TaskMutationResponseSchema,
  WorldPrViewSchema,
  type InitialPlanView,
  type WorldPrView,
} from "@/lib/contracts/v1";
import { newIdempotencyKey, readCsrfToken } from "@/lib/client/request";

type PlannedAction = InitialPlanView["actions"][number];

function formatTime(instant: string, timeZone = "America/New_York"): string {
  try {
    return new Intl.DateTimeFormat("en-US", {
      year: "numeric",
      month: "short",
      day: "numeric",
      hour: "numeric",
      minute: "2-digit",
      timeZone,
      timeZoneName: "short",
    }).format(new Date(instant));
  } catch {
    return new Date(instant).toISOString();
  }
}

function actionLabel(action: PlannedAction): string {
  if (action.type === "artifact.account_brief") return "Record parent-account brief";
  if (action.type === "calendar.move") return "Move Calendar event";
  return "Notify allowlisted attendees";
}

function lifecycleLabel(status: WorldPrView["status"]): string {
  return status.replaceAll("_", " ");
}

function ActionDetails({ action }: { action: PlannedAction }) {
  const dependency = action.dependsOnAssumptionIds.length
    ? "Depends on recorded assumption: Acme region"
    : "Independent of calendar event, region, attendees, and meeting time";

  if (action.type === "artifact.account_brief") {
    return (
      <>
        <p><strong>{action.desired.title}</strong><br />{action.desired.content}</p>
        <dl className="action-details">
          <div><dt>Dependency</dt><dd>{dependency}</dd></div>
          <div><dt>Content digest</dt><dd className="digest">{action.desired.contentHash}</dd></div>
          <div><dt>Source</dt><dd>{action.desired.provenance.sourceId}</dd></div>
          <div><dt>Source digest</dt><dd className="digest">{action.desired.provenance.sourceDigest}</dd></div>
          <div><dt>Semantic validator</dt><dd>{action.desired.provenance.validatorVersion}</dd></div>
        </dl>
      </>
    );
  }

  if (action.type === "calendar.move") {
    return (
      <>
        <p>Move the selected event from {formatTime(action.preconditions.expectedStart.instant, action.preconditions.expectedStart.timeZone)}&ndash;{formatTime(action.preconditions.expectedEnd.instant, action.preconditions.expectedEnd.timeZone)} to {formatTime(action.desired.start.instant, action.desired.start.timeZone)}&ndash;{formatTime(action.desired.end.instant, action.desired.end.timeZone)} for {action.desired.durationMinutes} minutes.</p>
        <dl className="action-details">
          <div><dt>Dependency</dt><dd>{dependency}</dd></div>
          <div><dt>IANA time zone</dt><dd>{action.desired.start.timeZone}</dd></div>
          <div><dt>Provider event</dt><dd>{action.target.providerEventId}</dd></div>
          <div><dt>Approved ETag</dt><dd>{action.preconditions.expectedEtag}</dd></div>
          <div><dt>Attendee updates</dt><dd>{action.desired.sendUpdates}</dd></div>
        </dl>
      </>
    );
  }

  return (
    <>
      <p><strong>To:</strong> {action.desired.to.join(", ")}<br /><strong>Subject:</strong> {action.desired.subject}<br /><span className="mail-body">{action.desired.bodyText}</span></p>
      <dl className="action-details">
        <div><dt>Dependency</dt><dd>{dependency}</dd></div>
        <div><dt>Execution gate</dt><dd>Requires {action.requiresSucceededActionKey} to succeed</dd></div>
        <div><dt>Body digest</dt><dd className="digest">{action.desired.bodyHash}</dd></div>
      </dl>
    </>
  );
}

function Timeline({ view }: { view: WorldPrView }) {
  return (
    <section className="panel" aria-labelledby="timeline-title">
      <div className="panel-inner">
        <div className="panel-kicker">Durable history</div>
        <h2 id="timeline-title">Timeline</h2>
        <ol className="timeline" data-testid="review-timeline">
          {view.timeline.map((item) => (
            <li className="timeline-item" key={item.eventId}>
              <span className="timeline-dot" aria-hidden="true" />
              <div><div className="timeline-label">{item.label}</div><div className="timeline-time">{formatTime(item.occurredAt)}</div></div>
            </li>
          ))}
        </ol>
      </div>
    </section>
  );
}

function FixtureNotice() {
  return <div className="notice fixture-notice" data-testid="fixture-mode-notice" role="status"><strong>G1 non-effecting mode:</strong> this review is persisted in PostgreSQL, but it does not approve or execute Calendar, Gmail, artifact, or model effects. This contract fixture is not live-provider evidence.</div>;
}

export default function ReviewPage({ params }: { params: Promise<{ worldPrId: string }> }) {
  const { worldPrId } = use(params);
  const [view, setView] = useState<WorldPrView | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [loginRequired, setLoginRequired] = useState(false);
  const [canceling, setCanceling] = useState(false);
  const [cancelled, setCancelled] = useState(false);
  const cancelKey = useRef<string | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    async function load(): Promise<void> {
      try {
        const response = await fetch(`/api/v1/world-prs/${encodeURIComponent(worldPrId)}`, { signal: controller.signal, cache: "no-store" });
        if (response.status === 401) {
          setLoginRequired(true);
          setMessage("Your review session has expired. Sign in again.");
          return;
        }
        const body: unknown = await response.json().catch(() => null);
        if (!response.ok) {
          const parsedError = ApiErrorResponseSchema.safeParse(body);
          setMessage(parsedError.success ? parsedError.data.error.message : "This World PR could not be loaded safely.");
          return;
        }
        const parsed = WorldPrViewSchema.safeParse(body);
        if (!parsed.success) {
          setMessage("The backend returned an invalid World PR record.");
          return;
        }
        setView(parsed.data);
      } catch (error) {
        if (!(error instanceof DOMException && error.name === "AbortError")) setMessage("The backend could not be reached. No external action was attempted.");
      }
    }
    void load();
    return () => controller.abort();
  }, [worldPrId]);

  async function cancel(): Promise<void> {
    if (canceling) return;
    const csrfToken = readCsrfToken();
    if (!csrfToken) {
      setMessage("Your review session needs to be renewed before this plan can be cancelled.");
      return;
    }
    setCanceling(true);
    setMessage(null);
    cancelKey.current ??= newIdempotencyKey();
    try {
      const response = await fetch(`/api/v1/world-prs/${encodeURIComponent(worldPrId)}/cancel`, {
        method: "POST",
        headers: { "content-type": "application/json", "idempotency-key": cancelKey.current, "x-rewind-csrf": csrfToken },
        body: "{}",
      });
      const body: unknown = await response.json().catch(() => null);
      if (response.status === 401) {
        setLoginRequired(true);
        setMessage("Your review session has expired. Sign in again.");
        return;
      }
      if (!response.ok) {
        const parsedError = ApiErrorResponseSchema.safeParse(body);
        setMessage(parsedError.success ? parsedError.data.error.message : "The plan could not be cancelled safely.");
        return;
      }
      const result = TaskMutationResponseSchema.safeParse(body);
      if (!result.success) {
        setMessage("The service returned an invalid cancellation response.");
        return;
      }
      if (result.data.worldPrId !== worldPrId) {
        setMessage("The service returned a cancellation result for a different World PR.");
        return;
      }
      if (result.data.status !== "cancelled") {
        setMessage(result.data.replayPending
          ? "Cancellation is still being recorded. Refresh this review to see its durable state."
          : "Cancellation was not completed. Refresh this review to see its durable state.");
        return;
      }
      setCancelled(true);
    } catch {
      setMessage("The cancellation service could not be reached. No external action was attempted.");
    } finally {
      setCanceling(false);
    }
  }

  if (message && !view) {
    return <main className="shell" data-testid="review-screen"><div className="content"><div className="notice" role="alert">{message}{loginRequired ? <> <Link href={`/login?next=${encodeURIComponent(`/pr/${worldPrId}`)}`}>Sign in</Link></> : null}</div></div></main>;
  }
  if (!view) return <main className="shell" data-testid="review-screen"><div className="content loading-state"><p className="eyebrow">Loading review</p><p className="loading-copy" aria-live="polite">Loading the immutable review record...</p></div></main>;

  if (cancelled || view.status === "cancelled") {
    return <main className="shell" data-testid="review-screen"><div className="content empty-state"><p className="eyebrow">Review closed</p><h1>This World PR was cancelled.</h1><p className="lede">No Calendar, Gmail, or artifact effect was approved or executed.</p><Link href="/" className="primary-button button-link">Back to composer</Link></div></main>;
  }

  if (view.status === "failed") {
    return <main className="shell" data-testid="review-screen"><div className="content empty-state"><p className="eyebrow">Planning stopped</p><h1>This review could not be prepared.</h1><p className="lede">Planning stopped before approval or any external action. No reviewable plan is available and this screen will not retry automatically.</p><Link href="/" className="primary-button button-link">Back to composer</Link><FixtureNotice /></div></main>;
  }

  if (view.status === "attention_required") {
    return <main className="shell" data-testid="review-screen"><div className="content empty-state"><p className="eyebrow">Operator attention</p><h1>This World PR needs attention.</h1><p className="lede">The recorded state is visible, but this G1 screen will not retry or approve it automatically.</p><div className="notice" role="alert">Attention reason: {view.attention?.kind ?? "recorded failure"}.</div><Link href="/" className="secondary-button button-link">Back to composer</Link><FixtureNotice /></div></main>;
  }

  if (view.status === "clarification_required") {
    return (
      <main className="shell" data-testid="review-screen">
        <header className="topbar" role="banner"><Link href="/" className="wordmark">rewind</Link><div className="topbar-note">World PR <span aria-hidden="true">&middot;</span> clarification required</div></header>
        <div className="content">
          <div className="review-header"><div><p className="eyebrow">Clarification before planning</p><h1>Which Acme region did you mean?</h1><p className="lede">The active fixture guardrail stopped before plan generation, action creation, and scenario locking.</p></div><span className="status-pill status-pill-amber">Clarification required</span></div>
          <div className="review-grid">
            <section className="panel panel-wide" data-testid="clarification-panel"><div className="panel-inner"><h2>{view.clarification?.question}</h2><div className="candidate-grid">{view.clarification?.candidates.map((candidate) => <div className="candidate-choice" key={candidate.candidateId}><strong>{candidate.label}</strong><span>Known controlled candidate</span></div>)}</div><p className="muted">This proof record owns no plan, action ledger, or effect-bearing scenario lock.</p></div></section>
            <Timeline view={view} />
          </div>
          <div className="review-actions"><button className="secondary-button" type="button" onClick={() => void cancel()} disabled={canceling}>{canceling ? "Cancelling..." : "Cancel intake"}</button><Link href="/" className="secondary-button">Back to composer</Link></div>
          {message ? <div className="notice" role="alert">{message}</div> : null}
          <FixtureNotice />
        </div>
      </main>
    );
  }

  if (view.status === "analyzing" || !view.activePlan) {
    return <main className="shell" data-testid="review-screen"><div className="content empty-state"><p className="eyebrow">World PR status</p><h1>Rewind is still preparing this review.</h1><p className="lede">The planning lease is active. Refresh to read the durable state; no external action has been attempted.</p><button className="secondary-button" type="button" onClick={() => window.location.reload()}>Refresh review</button><FixtureNotice /></div></main>;
  }

  const activePlan = view.activePlan;
  if (!isInitialPlanView(activePlan)) return <main className="shell" data-testid="review-screen"><div className="content"><div className="notice" role="status">This future recovery review is not enabled in the G1 slice. No external action was attempted.</div></div></main>;
  const plan = activePlan;
  const assumption = plan.assumptions[0];
  const canCancel = view.status === "preview_ready";

  return (
    <main className="shell" data-testid="review-screen">
      <header className="topbar" role="banner"><Link href="/" className="wordmark">rewind</Link><div className="topbar-note">World PR <span aria-hidden="true">&middot;</span> {view.status}</div></header>
      <div className="content">
        <div className="review-header">
          <div><p className="eyebrow">Review proposed workspace changes</p><h1>{plan.selectedCandidate.label}</h1><p className="lede">The controlled fixture selects the nearest upcoming Acme candidate and keeps the other candidate visible as an alternative.</p></div>
          <span className="status-pill">{lifecycleLabel(view.status)}</span>
        </div>
        <div className="review-grid">
          <section className="panel panel-wide"><div className="panel-inner"><div className="panel-kicker">Request</div><h2>Original request</h2><p>{view.request}</p></div></section>
          <section className="panel" data-testid="candidate-panel"><div className="panel-inner"><div className="panel-kicker">Target resolution</div><h2>Candidate resolution</h2><div className="candidate-row"><div><div className="candidate-label">{plan.selectedCandidate.label}</div><div className="candidate-meta">Nearest upcoming tagged candidate on the configured demo date.</div></div><span className="tag">Selected</span></div><div className="candidate-row"><div><div className="candidate-label">{plan.alternatives[0].label}</div><div className="candidate-meta">Visible later alternative; not selected by the fixture rank.</div></div><span className="tag alt">Alternative</span></div></div></section>
          <section className="panel" data-testid="assumption-panel"><div className="panel-inner"><div className="panel-kicker">Dependency lineage</div><h2>Recorded assumption</h2><div className="assumption"><strong>{assumption.statement}</strong><p>This is the decision a later recovery flow can revisit. Recorded confidence: {Math.round(assumption.confidence * 100)}%.</p></div><ul className="evidence">{assumption.evidence.map((item) => <li key={item}>{item}</li>)}</ul></div></section>
          <section className="panel panel-wide" data-testid="planned-actions"><div className="panel-inner"><div className="panel-kicker">Exact approved payload</div><h2>Planned actions</h2><div className="action-list">{plan.actions.map((action) => <article className="action" key={action.actionKey}><div className="action-top"><span className="action-name">{actionLabel(action)}</span><span className="action-type">{action.externalEffect ? "External effect" : "Recorded artifact"}</span></div><div className="action-key">{action.actionKey}</div><ActionDetails action={action} /></article>)}</div></div></section>
          <section className="panel"><div className="panel-inner"><div className="panel-kicker">Immutable identity</div><h2>Plan identity</h2><p className="muted">Version {plan.pointer.version}</p><p className="digest">{plan.pointer.digest}</p></div></section>
          <Timeline view={view} />
        </div>
        <div className="review-actions">
          {canCancel ? <button className="secondary-button" type="button" onClick={() => void cancel()} disabled={canceling}>{canceling ? "Cancelling..." : "Cancel review"}</button> : null}
          <Link href="/" className="secondary-button">Back to composer</Link>
        </div>
        {!canCancel ? <div className="notice" role="status">Current durable state: {lifecycleLabel(view.status)}. This G1 screen will not approve, execute, or cancel a plan from this state.</div> : null}
        {message ? <div className="notice" role="alert">{message}</div> : null}
        <FixtureNotice />
      </div>
    </main>
  );
}
