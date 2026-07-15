"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
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
      if (response.ok) {
        const destination = safeReturnPath(new URLSearchParams(window.location.search).get("next"));
        router.push(destination);
      }
      else setMessage("Sign-in failed. Configure the demo operator passcode for this environment.");
    } catch {
      setMessage("The sign-in service could not be reached.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <main className="shell">
      <div className="login-card">
        <p className="eyebrow">Authenticated operator</p>
        <h1>Sign in to review.</h1>
        <p className="muted">The review URL is not a capability. A session is required before the plan can be read.</p>
        <form onSubmit={submit}>
          <div className="field">
            <label htmlFor="passcode">Demo passcode</label>
            <input id="passcode" type="password" value={passcode} onChange={(event) => setPasscode(event.target.value)} autoComplete="current-password" disabled={submitting} required />
          </div>
          <button className="primary-button" type="submit" disabled={submitting}>{submitting ? "Signing in…" : "Continue"}</button>
        </form>
        {message ? <div className="notice" role="alert">{message}</div> : null}
      </div>
    </main>
  );
}
