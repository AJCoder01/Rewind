"use client";

import { use, useEffect, useState } from "react";
import Link from "next/link";
import { WorldPrViewSchema, type InitialPlanView, type WorldPrView } from "@/lib/contracts/v1";

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

function ActionDetails({ action }: { action: PlannedAction }) {
  const dependency = action.dependsOnAssumptionIds.length
    ? "Depends on assumption_acme_region"
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
        <p>Move the selected event from {formatTime(action.preconditions.expectedStart.instant, action.preconditions.expectedStart.timeZone)} to {formatTime(action.desired.start.instant, action.desired.start.timeZone)} for {action.desired.durationMinutes} minutes.</p>
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

export default function ReviewPage({ params }: { params: Promise<{ worldPrId: string }> }) {
  const { worldPrId } = use(params);
  const [view, setView] = useState<WorldPrView | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [loginRequired, setLoginRequired] = useState(false);

  useEffect(() => {
    const controller = new AbortController();
    async function load(): Promise<void> {
      try {
        const response = await fetch(`/api/v1/world-prs/${worldPrId}`, { signal: controller.signal });
        if (response.status === 401) {
          setLoginRequired(true);
          setMessage("Your review session has expired. Sign in again.");
          return;
        }
        if (!response.ok) {
          setMessage("This World PR could not be loaded safely.");
          return;
        }
        const body: unknown = await response.json();
        const parsed = WorldPrViewSchema.safeParse(body);
        if (!parsed.success) {
          setMessage("The backend returned an invalid World PR record.");
          return;
        }
        setView(parsed.data);
      } catch (error) {
        if (!(error instanceof DOMException && error.name === "AbortError")) {
          setMessage("The backend could not be reached. No external action was attempted.");
        }
      }
    }
    void load();
    return () => controller.abort();
  }, [worldPrId]);

  if (message) return <main className="shell"><div className="content"><div className="notice" role="alert">{message}{loginRequired ? <> <Link href="/login">Sign in</Link></> : null}</div></div></main>;
  if (!view || !view.activePlan) return <main className="shell"><div className="content"><p className="muted" aria-live="polite">Loading the immutable review record…</p></div></main>;
  const plan = view.activePlan;
  const assumption = plan.assumptions[0];

  return (
    <main className="shell">
      <header className="topbar">
        <Link href="/" className="wordmark">rewind</Link>
        <div className="topbar-note">World PR · {view.status}</div>
      </header>
      <div className="content">
        <div className="review-header">
          <div>
            <p className="eyebrow">Review proposed workspace changes</p>
            <h1>{plan.selectedCandidate.label}</h1>
            <p className="lede">The controlled fixture selects the nearest upcoming Acme candidate and keeps the other candidate visible as an alternative.</p>
          </div>
          <span className="status-pill">Preview ready</span>
        </div>
        <div className="review-grid">
          <section className="panel panel-wide"><div className="panel-inner"><h2>Request</h2><p>{view.request}</p></div></section>
          <section className="panel">
            <div className="panel-inner">
              <h2>Candidate resolution</h2>
              <div className="candidate-row"><div><div className="candidate-label">{plan.selectedCandidate.label}</div><div className="candidate-meta">Nearest upcoming tagged candidate on the configured demo date.</div></div><span className="tag">Selected</span></div>
              <div className="candidate-row"><div><div className="candidate-label">{plan.alternatives[0].label}</div><div className="candidate-meta">Visible later alternative; not selected by the fixture rank.</div></div><span className="tag alt">Alternative</span></div>
            </div>
          </section>
          <section className="panel">
            <div className="panel-inner">
              <h2>Recorded assumption</h2>
              <div className="assumption"><strong>{assumption.statement}</strong><p>This is the decision the later recovery flow will be able to revisit.</p></div>
              <ul className="evidence">{assumption.evidence.map((item) => <li key={item}>{item}</li>)}</ul>
            </div>
          </section>
          <section className="panel panel-wide">
            <div className="panel-inner">
              <h2>Planned actions</h2>
              <div className="action-list">
                {plan.actions.map((action) => (
                  <article className="action" key={action.actionKey}>
                    <div className="action-top"><span className="action-name">{action.actionKey}</span><span className="action-type">{action.externalEffect ? "External effect" : "Recorded artifact"}</span></div>
                    <ActionDetails action={action} />
                  </article>
                ))}
              </div>
            </div>
          </section>
          <section className="panel"><div className="panel-inner"><h2>Plan identity</h2><p className="muted">Immutable version {plan.pointer.version}</p><p className="digest">{plan.pointer.digest}</p></div></section>
          <section className="panel"><div className="panel-inner"><h2>Timeline</h2><div className="timeline">{view.timeline.map((item) => <div className="timeline-item" key={item.eventId}><span className="timeline-dot" aria-hidden="true" /><div><div className="timeline-label">{item.label}</div><div className="timeline-time">{formatTime(item.occurredAt)}</div></div></div>)}</div></div></section>
        </div>
        <div className="notice">This first slice is fixture-backed and does not approve or execute Calendar, Gmail, or artifact effects. External integrations remain disabled until their safety gates pass.</div>
      </div>
    </main>
  );
}
