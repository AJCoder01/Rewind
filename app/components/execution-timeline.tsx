"use client";

import { useEffect, useState } from "react";
import { ExecutionTimelineViewSchema, type ExecutionActionView, type ExecutionTimelineView } from "@/lib/contracts/execution-timeline";

type TimelineState =
  | { kind: "loading" }
  | { kind: "error"; message: string }
  | { kind: "ready"; data: ExecutionTimelineView };

function formatTime(instant: string): string {
  try {
    return new Intl.DateTimeFormat("en-US", {
      year: "numeric",
      month: "short",
      day: "numeric",
      hour: "numeric",
      minute: "2-digit",
      timeZoneName: "short",
    }).format(new Date(instant));
  } catch {
    return new Date(instant).toISOString();
  }
}

function overallLabel(status: ExecutionTimelineView["overallStatus"]): string {
  const labels: Record<ExecutionTimelineView["overallStatus"], string> = {
    awaiting_approval: "Awaiting approval",
    not_started: "Not started",
    in_progress: "In progress",
    completed: "Completed",
    partial: "Partial execution",
    attention_required: "Attention required",
    cancelled: "Cancelled",
    failed: "Failed",
  };
  return labels[status];
}

function overallClass(status: ExecutionTimelineView["overallStatus"]): string {
  if (status === "completed") return "status-pill";
  if (status === "in_progress") return "status-pill status-pill-blue";
  if (status === "cancelled" || status === "failed" || status === "attention_required" || status === "partial") return "status-pill status-pill-amber";
  return "status-pill status-pill-neutral";
}

function actionLabel(status: ExecutionActionView["status"]): string {
  const labels: Record<ExecutionActionView["status"], string> = {
    planned: "Not started",
    in_progress: "In progress",
    succeeded: "Completed",
    retryable_failed: "Retryable failure",
    delivery_uncertain: "Delivery uncertain",
    conflict: "Conflict",
    permanently_failed: "Permanent failure",
  };
  return labels[status];
}

function actionClass(status: ExecutionActionView["status"]): string {
  if (status === "succeeded") return "status-pill";
  if (status === "in_progress") return "status-pill status-pill-blue";
  if (status === "planned") return "status-pill status-pill-neutral";
  return "status-pill status-pill-amber";
}

function overallMessage(data: ExecutionTimelineView): string {
  if (data.message) return data.message;
  const messages: Record<ExecutionTimelineView["overallStatus"], string> = {
    awaiting_approval: "The exact plan is ready. Approval is required before an action row can be claimed.",
    not_started: "The approved action ledger is ready, but no provider action has started.",
    in_progress: "At least one action is leased. Every row remains visible until its durable outcome is recorded.",
    completed: "Every action has a verified terminal success receipt.",
    partial: "Some actions completed, while another action stopped or remains safe to retry.",
    attention_required: "Execution stopped safely and requires operator or provider reconciliation. No automatic retry is claimed.",
    cancelled: "This World PR was cancelled. No external success is claimed from this view.",
    failed: "Planning failed before approval or external execution. No external success is claimed.",
  };
  return messages[data.overallStatus];
}

function receiptEntries(receipt: ExecutionActionView["receipt"]): ReadonlyArray<Readonly<{ label: string; value: string }>> {
  if (!receipt) return [];
  if ("provider" in receipt) {
    return [
      { label: "Receipt", value: `Verified Google Calendar ${receipt.operation}` },
      { label: "Provider event", value: receipt.providerEventId },
      { label: "Resulting version", value: receipt.resultingEtag },
    ];
  }
  if ("artifactId" in receipt) {
    return [
      { label: "Receipt", value: "Account brief stored" },
      { label: "Artifact", value: receipt.artifactId },
      { label: "Content digest", value: receipt.contentHash },
      { label: "Stored at", value: formatTime(receipt.storedAt) },
    ];
  }
  if (receipt.status === "sent") {
    return [
      { label: "Receipt", value: "Gmail accepted the approved message" },
      { label: "Message", value: receipt.messageId },
      ...(receipt.threadId ? [{ label: "Thread", value: receipt.threadId }] : []),
    ];
  }
  if (receipt.status === "permanent_failed") return [{ label: "Provider result", value: `Permanent rejection (${receipt.providerCode})` }];
  return [{ label: "Provider result", value: `Delivery uncertain (${receipt.reason.replaceAll("_", " ")})` }];
}

function actionTimes(action: ExecutionActionView): ReadonlyArray<Readonly<{ label: string; value: string }>> {
  return [
    { label: "Started", value: action.startedAt ? formatTime(action.startedAt) : "Not started" },
    { label: "Dispatch marker", value: action.dispatchStartedAt ? formatTime(action.dispatchStartedAt) : "Not persisted" },
    { label: "Finished", value: action.finishedAt ? formatTime(action.finishedAt) : "Pending" },
    { label: "Attempts", value: String(action.attempts) },
  ];
}

function ActionRow({ action }: { action: ExecutionActionView }) {
  const receipt = receiptEntries(action.receipt);
  return (
    <li className="execution-action" data-testid={`execution-action-${action.actionKey}`}>
      <div className="execution-action-top">
        <div>
          <div className="execution-action-title">{action.label}</div>
          <div className="action-key">{action.actionKey}</div>
        </div>
        <div className="execution-action-badges">
          <span className={action.effect === "external_effect" ? "tag" : "tag alt"}>{action.effect === "external_effect" ? "External effect" : "Recorded artifact"}</span>
          <span className={actionClass(action.status)}>{actionLabel(action.status)}</span>
        </div>
      </div>
      <dl className="execution-times">
        {actionTimes(action).map((item) => <div key={item.label}><dt>{item.label}</dt><dd>{item.value}</dd></div>)}
      </dl>
      {receipt.length > 0 ? (
        <dl className="execution-receipt">
          {receipt.map((item) => <div key={item.label}><dt>{item.label}</dt><dd className={item.value.startsWith("sha256:") ? "digest" : undefined}>{item.value}</dd></div>)}
        </dl>
      ) : null}
      {action.error ? (
        <div className="execution-error" role={action.error.retryable ? "status" : "alert"}>
          <strong>{action.error.retryable ? "Safe retry boundary" : "Stopped safely"}</strong>
          <p>{action.error.safeMessage}</p>
          <span className="execution-error-code">{action.error.code} · {action.error.retryable ? "retry is bounded to this known-safe state" : "automatic retry is disabled"}</span>
        </div>
      ) : null}
    </li>
  );
}

async function readExecutionTimeline(worldPrId: string): Promise<TimelineState> {
  try {
    const response = await fetch(`/api/v1/world-prs/${encodeURIComponent(worldPrId)}/execution`, { cache: "no-store" });
    if (response.status === 401) return { kind: "error", message: "Your review session has expired. Sign in again to view execution receipts." };
    const body: unknown = await response.json().catch(() => null);
    if (!response.ok) return { kind: "error", message: "Execution state could not be loaded safely. No success is claimed." };
    const parsed = ExecutionTimelineViewSchema.safeParse(body);
    return parsed.success ? { kind: "ready", data: parsed.data } : { kind: "error", message: "The backend returned an invalid execution timeline. No success is claimed." };
  } catch {
    return { kind: "error", message: "Execution state could not be reached. No success is claimed." };
  }
}

export function ExecutionTimeline({ worldPrId }: { worldPrId: string }) {
  const [state, setState] = useState<TimelineState>({ kind: "loading" });

  useEffect(() => {
    let active = true;
    void readExecutionTimeline(worldPrId).then((next) => {
      if (active) setState(next);
    });
    return () => {
      active = false;
    };
  }, [worldPrId]);

  return (
    <section className="panel panel-wide execution-panel" aria-labelledby="execution-timeline-title" data-testid="execution-timeline">
      <div className="panel-inner">
        <div className="section-heading execution-heading">
          <div>
            <div className="panel-kicker">Durable action ledger</div>
            <h2 id="execution-timeline-title">Execution timeline</h2>
          </div>
          {state.kind === "ready" ? <span className={overallClass(state.data.overallStatus)} data-testid="execution-summary">{overallLabel(state.data.overallStatus)}</span> : null}
        </div>
        {state.kind === "loading" ? <p className="muted" role="status" aria-live="polite">Loading durable execution state...</p> : null}
        {state.kind === "error" ? <div className="notice" role="alert">{state.message}</div> : null}
        {state.kind === "ready" ? (
          <>
            <p className="execution-summary-copy" role="status">{overallMessage(state.data)}</p>
            {state.data.actions.length > 0 ? (
              <ol className="execution-ledger" data-testid="execution-action-list">
                {state.data.actions.map((action) => <ActionRow key={action.actionExecutionId} action={action} />)}
              </ol>
            ) : <p className="execution-empty">No external action row is available yet. This state does not claim that an action ran.</p>}
            {state.data.planDigest ? <p className="execution-plan-digest">Bound plan digest <span className="digest">{state.data.planDigest}</span></p> : null}
            <p className="execution-updated">Ledger read at {formatTime(state.data.updatedAt)}.</p>
          </>
        ) : null}
      </div>
    </section>
  );
}
