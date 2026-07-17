"use client";

import { useEffect, useState } from "react";
import {
  ConnectionPreflightResponseSchema,
  type ConnectionPreflightResponse,
} from "@/lib/contracts/connection-preflight";

type PanelState =
  | { kind: "loading" }
  | { kind: "signed_out" }
  | { kind: "error" }
  | { kind: "ready"; data: ConnectionPreflightResponse };

const checkLabels: Record<ConnectionPreflightResponse["preflight"]["checks"][number]["id"], string> = {
  configuration: "Configuration",
  database: "Database",
  google_identity: "Google identity",
  calendar: "Calendar",
};

const issueLabels: Record<string, string> = {
  APP_BASE_URL: "App URL",
  DATABASE_URL: "Database URL",
  REWIND_STORAGE_MODE: "Storage mode",
  REWIND_SESSION_SECRET: "Session secret",
  REWIND_DASHBOARD_PASSCODE: "Dashboard passcode",
  MCP_BACKEND_TOKEN: "MCP backend token",
  OPENAI_API_KEY: "OpenAI API key",
  OPENAI_MODEL: "OpenAI model",
  REWIND_MODEL_RUNTIME: "Model runtime",
  REWIND_LOCAL_MODEL: "Local Ollama model",
  GOOGLE_CLIENT_ID: "Google client ID",
  GOOGLE_CLIENT_SECRET: "Google client secret",
  GOOGLE_REDIRECT_URI: "Google redirect URI",
  REWIND_TOKEN_ENCRYPTION_KEY: "Token encryption key",
  REWIND_GOOGLE_EXPECTED_EMAIL: "Expected Google email",
  REWIND_GOOGLE_EXPECTED_SUB: "Expected Google subject",
  REWIND_GOOGLE_CALENDAR_ID: "Controlled Calendar target",
  REWIND_RECIPIENT_ALLOWLIST: "Recipient allowlist",
  REWIND_DEMO_DATE: "Demo date",
  environment: "Application configuration",
};

function readableCode(code: string): string {
  return code.replaceAll("_", " ");
}

function runtimeLabel(mode: ConnectionPreflightResponse["runtime"]["mode"]): string {
  if (mode === "fixture") return "Fixture mode";
  if (mode === "live_capable") return "Live-capable configuration";
  return "Blocked configuration";
}

function runtimeDetail(data: ConnectionPreflightResponse): string {
  if (data.runtime.mode === "fixture") return "World PRs use deterministic fixture data; no provider or model call is made.";
  if (data.runtime.mode === "live_capable" && data.runtime.productExecution === "enabled") return "Provider-grounded planning and exact approved execution are enabled; reset remains disabled.";
  if (data.runtime.mode === "live_capable") return "Provider configuration is present, but a required execution prerequisite is still blocked.";
  return "The application cannot safely claim a provider-ready state until the listed gaps are fixed.";
}

function identityLabel(status: ConnectionPreflightResponse["identity"]["status"]): string {
  if (status === "connected") return "Connected identity";
  if (status === "not_connected") return "Not connected";
  if (status === "mismatch") return "Identity mismatch";
  return "Identity unavailable";
}

function databaseLabel(status: ConnectionPreflightResponse["database"]["status"]): string {
  if (status === "fixture") return "Fixture storage";
  if (status === "ready") return "PostgreSQL ready";
  if (status === "not_ready") return "PostgreSQL not ready";
  return "Database unavailable";
}

function checkClass(status: "passed" | "failed" | "not_run"): string {
  if (status === "passed") return "status-pill";
  if (status === "failed") return "status-pill status-pill-amber";
  return "status-pill status-pill-neutral";
}

async function readStatus(): Promise<PanelState> {
  try {
    const response = await fetch("/api/v1/connection/status", { cache: "no-store" });
    if (response.status === 401) return { kind: "signed_out" };
    if (!response.ok) return { kind: "error" };
    const parsed = ConnectionPreflightResponseSchema.safeParse(await response.json());
    return parsed.success ? { kind: "ready", data: parsed.data } : { kind: "error" };
  } catch {
    return { kind: "error" };
  }
}

export function ConnectionPreflightPanel() {
  const [state, setState] = useState<PanelState>({ kind: "loading" });

  useEffect(() => {
    let active = true;
    void readStatus().then((next) => {
      if (active) setState(next);
    });
    return () => {
      active = false;
    };
  }, []);

  return (
    <section className="panel connection-panel" data-testid="connection-preflight" aria-labelledby="connection-preflight-title">
      <div className="panel-inner">
        <div className="section-heading connection-heading">
          <div>
            <p className="panel-kicker">Connection and preflight</p>
            <h2 id="connection-preflight-title">What is actually connected?</h2>
          </div>
          {state.kind === "ready" ? (
            <span className="status-pill status-pill-amber" data-testid="connection-status">
              {state.data.overall === "blocked" ? "Blocked" : "Attention needed"}
            </span>
          ) : null}
        </div>

        {state.kind === "loading" ? <p className="muted" role="status">Checking configuration status...</p> : null}
        {state.kind === "signed_out" ? (
          <p className="muted">Sign in to view the private connection and preflight status.</p>
        ) : null}
        {state.kind === "error" ? (
          <p className="notice connection-notice" role="alert">Connection status could not be loaded. No external action was attempted.</p>
        ) : null}
        {state.kind === "ready" ? <StatusDetails data={state.data} /> : null}
      </div>
    </section>
  );
}

function StatusDetails({ data }: { data: ConnectionPreflightResponse }) {
  const canConnectGoogle = data.runtime.mode === "live_capable" && data.identity.status === "not_connected";
  return (
    <>
      <p className="connection-lede">This panel reports prerequisites only. It is not approval, execution, or proof that the product workflow has passed.</p>
      <div className="connection-summary" data-testid="connection-summary">
        <div>
          <dt>Runtime boundary</dt>
          <dd><span className="status-pill status-pill-amber">{runtimeLabel(data.runtime.mode)}</span></dd>
          <p>{runtimeDetail(data)}</p>
        </div>
        <div>
          <dt>Google account</dt>
          <dd><span className={data.identity.status === "connected" ? "status-pill" : "status-pill status-pill-amber"}>{identityLabel(data.identity.status)}</span></dd>
          <p>{data.identity.email ?? "No approved account is available to display."}</p>
          {data.identity.status === "connected" ? <p>Calendar and Gmail access scopes validated.</p> : null}
          {canConnectGoogle ? <a className="secondary-button" href="/api/v1/oauth/google/start">Connect approved Google account</a> : null}
        </div>
        <div>
          <dt>Storage</dt>
          <dd><span className={data.database.status === "ready" ? "status-pill" : "status-pill status-pill-amber"}>{databaseLabel(data.database.status)}</span></dd>
          <p>{data.database.schemaVersion ? `Schema ${data.database.schemaVersion}` : "No live schema version is being claimed."}</p>
        </div>
        <div>
          <dt>Model evidence</dt>
          <dd><span className="status-pill status-pill-neutral">{data.runtime.modelRuntime === "not_configured" ? "Not selected" : data.runtime.modelRuntime === "local_ollama" ? "Local Ollama" : "OpenAI Responses"}</span></dd>
          <p>{data.runtime.productExecution === "enabled" ? "The selected strict model runtime is enabled for bounded planning." : "Model-backed product planning is not currently available."}</p>
        </div>
        <div>
          <dt>Demo date</dt>
          <dd><span className={data.demoDate.status === "configured" ? "status-pill" : "status-pill status-pill-amber"}>{data.demoDate.status === "configured" ? "Configured" : "Missing"}</span></dd>
          <p>The fixed controlled scenario date is required before provider work.</p>
        </div>
      </div>

      <div className="connection-preflight" data-testid="preflight-summary">
        <div className="connection-subheading">
          <div>
            <p className="panel-kicker">Preflight result</p>
            <h3>{data.preflight.status === "blocked" ? "Blocked before provider work" : "Not run"}</h3>
          </div>
          <span className="status-pill status-pill-amber">{data.calendar.status === "configured" ? "Calendar check pending" : "Calendar target missing"}</span>
        </div>
        <p className="muted">The dashboard does not run the human-gated Calendar preflight. Any failed prerequisite is shown below without hiding the reason or manufacturing a success state.</p>
        <div className="preflight-checks">
          {data.preflight.checks.map((check) => (
            <div className="preflight-check" key={check.id}>
              <div className="preflight-check-top">
                <strong>{checkLabels[check.id]}</strong>
                <span className={checkClass(check.status)}>{check.status === "not_run" ? "Not run" : check.status === "passed" ? "Passed" : "Failed"}</span>
              </div>
              <p>{check.detail}</p>
            </div>
          ))}
        </div>
      </div>

      {data.configuration.status === "incomplete" ? (
        <div className="connection-gaps" data-testid="configuration-gaps">
          <p className="panel-kicker">Configuration gaps</p>
          <ul>
            {data.configuration.issues.map((issue) => <li key={`${issue.field}:${issue.code}`}>{issueLabels[issue.field] ?? issue.field}: {readableCode(issue.code)}</li>)}
          </ul>
        </div>
      ) : null}

      <p className="connection-disabled" role="status">{data.workflow.message}</p>
    </>
  );
}
