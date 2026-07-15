"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { ApiErrorResponseSchema } from "@/lib/contracts/v1";
import { safeReturnPath } from "@/lib/auth/return-path";

export default function LoginPage() {
  const router = useRouter();
  const [passcode, setPasscode] = useState("");
  const [message, setMessage] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setMessage(null);
    setSubmitting(true);
    try {
      const response = await fetch("/api/v1/auth/session", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ passcode }),
      });
      const body: unknown = await response.json().catch(() => null);
      if (response.ok) {
        const destination = safeReturnPath(new URLSearchParams(window.location.search).get("next"));
        router.push(destination);
        return;
      }
      const parsedError = ApiErrorResponseSchema.safeParse(body);
      setMessage(parsedError.success ? parsedError.data.error.message : "Sign-in failed. The dashboard session was not created.");
    } catch {
      setMessage("The sign-in service could not be reached.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <main className="shell" data-testid="login-screen">
      <div className="login-card">
        <p className="eyebrow">Authenticated operator</p>
        <h1>Sign in to review.</h1>
        <p className="muted">The review URL is not a capability. A session and a CSRF token are required before a plan can be read or changed.</p>
        <form onSubmit={submit} data-testid="login-form">
          <div className="field">
            <label htmlFor="passcode">Demo passcode</label>
            <input data-testid="dashboard-passcode" id="passcode" type="password" value={passcode} onChange={(event) => setPasscode(event.target.value)} autoComplete="current-password" disabled={submitting} required aria-describedby="passcode-help" />
            <p className="field-help" id="passcode-help">The passcode stays in the private deployment environment.</p>
          </div>
          <button className="primary-button" data-testid="login-submit" type="submit" disabled={submitting}>{submitting ? "Signing in..." : "Continue"}</button>
        </form>
        {message ? <div className="notice" role="alert" data-testid="login-error">{message}</div> : null}
      </div>
    </main>
  );
}
