"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { ApiErrorResponseSchema, CreateWorldPrResponseSchema } from "@/lib/contracts/v1";
import { SUPPORTED_SCENARIO_REQUEST } from "@/lib/domain/scenario";
import { newIdempotencyKey, readCsrfToken } from "@/lib/client/request";
import { ConnectionPreflightPanel } from "@/app/components/connection-preflight-panel";

export default function HomePage() {
  const router = useRouter();
  const [request, setRequest] = useState(SUPPORTED_SCENARIO_REQUEST);
  const [submitting, setSubmitting] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const inFlight = useRef(false);
  const idempotencyKey = useRef<string | null>(null);

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (inFlight.current) return;
    inFlight.current = true;
    setSubmitting(true);
    setMessage(null);
    idempotencyKey.current ??= newIdempotencyKey();
    const csrfToken = readCsrfToken();
    if (!csrfToken) {
      router.push("/login?next=%2F");
      inFlight.current = false;
      setSubmitting(false);
      return;
    }
    try {
      const response = await fetch("/api/v1/world-prs", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "idempotency-key": idempotencyKey.current,
          "x-rewind-csrf": csrfToken,
        },
        body: JSON.stringify({ request }),
      });
      const body: unknown = await response.json().catch(() => null);
      if (response.status === 401) {
        router.push("/login?next=%2F");
        return;
      }
      if (!response.ok) {
        const parsedError = ApiErrorResponseSchema.safeParse(body);
        setMessage(parsedError.success ? parsedError.data.error.message : "The service returned an unexpected error response.");
        return;
      }
      const result = CreateWorldPrResponseSchema.safeParse(body);
      if (!result.success) {
        setMessage("The service returned an invalid World PR response.");
        return;
      }
      router.push(`/pr/${result.data.worldPrId}`);
    } catch {
      setMessage("The backend could not be reached. No external action was attempted.");
    } finally {
      inFlight.current = false;
      setSubmitting(false);
    }
  }

  function updateRequest(value: string): void {
    idempotencyKey.current = null;
    setRequest(value);
  }

  return (
    <main className="shell" data-testid="composer-screen">
      <header className="topbar" role="banner">
        <div className="wordmark">rewind</div>
        <div className="topbar-note">Recorded assumptions <span aria-hidden="true">&middot;</span> reviewed repair</div>
      </header>
      <div className="content composer-content">
        <section className="intro" aria-labelledby="page-title">
          <p className="eyebrow">Controlled workspace proof</p>
          <h1 id="page-title">Make the reasoning behind an action visible.</h1>
          <p className="lede">Rewind records the assumption behind an approved task, then helps a human review the smallest valid repair when later context changes its meaning.</p>
        </section>
        <ConnectionPreflightPanel />
        <section className="composer-section" aria-labelledby="composer-title">
          <div className="section-heading">
            <div>
              <p className="eyebrow">One supported scenario</p>
              <h2 id="composer-title">Prepare a reviewable World PR</h2>
            </div>
            <span className="state-label">Planning only</span>
          </div>
          <form className="composer" onSubmit={submit} data-testid="composer-form">
            <div className="field">
              <label htmlFor="request">What should Rewind prepare?</label>
              <textarea
                data-testid="composer-request"
                id="request"
                value={request}
                onChange={(event) => updateRequest(event.target.value)}
                maxLength={2000}
                disabled={submitting}
                aria-describedby="request-help"
              />
              <p className="field-help" id="request-help">Only the controlled Acme Calendar, Gmail, and parent-account brief scenario is supported in this proof.</p>
            </div>
            <button className="primary-button" data-testid="create-world-pr" type="submit" disabled={submitting}>
              {submitting ? "Preparing..." : "Create World PR"}
            </button>
          </form>
        </section>
        {message ? <div className="notice" role="alert" data-testid="composer-error">{message}</div> : null}
        <section className="status-row" data-testid="fixture-status" aria-label="Current slice status">
          <span className="status-pill"><span className="status-mark" aria-hidden="true">1</span> Exact dashboard approval</span>
          <span className="status-pill"><span className="status-mark" aria-hidden="true">2</span> PostgreSQL persistence</span>
          <span className="status-pill"><span className="status-mark" aria-hidden="true">3</span> No effect before approval</span>
        </section>
      </div>
    </main>
  );
}
