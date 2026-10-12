import { useEffect, useState } from "react";
import { api } from "../lib/api.js";

// The "forgot password" journey: ForgotPassword asks for an email and
// sends a link; the link opens the app at /?reset=<token>, which shows
// ResetPassword. Links expire 3 minutes after they're sent (see
// backend/src/routes/auth.ts).

const inputStyle = { width: "100%", padding: 10, marginBottom: 8 };
const linkButtonStyle = { background: "none", border: "none", color: "var(--accent)", cursor: "pointer", padding: 0 };

export function ForgotPassword({ initialEmail, onBack }: { initialEmail: string; onBack: () => void }) {
  const [email, setEmail] = useState(initialEmail);
  const [sentMessage, setSentMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      const result = await api.forgotPassword(email.trim());
      setSentMessage(result.message);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't send the reset email");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="card">
      <h2>Forgot your password?</h2>
      {sentMessage ? (
        <>
          <p>{sentMessage}</p>
          <p className="text-dim" style={{ fontSize: 13 }}>
            Open the email on this device and tap the link straight away. If it has expired, come back and send a new one.
          </p>
          <button className="button-primary" style={{ width: "100%" }} onClick={() => setSentMessage(null)}>
            Send another link
          </button>
        </>
      ) : (
        <form onSubmit={handleSubmit}>
          <p className="text-dim" style={{ fontSize: 13, marginTop: 0 }}>
            Enter the email you signed up with. We'll send you a link to choose a new password. The link expires after 3 minutes.
          </p>
          <input placeholder="Email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} style={inputStyle} />
          <button className="button-primary" style={{ width: "100%" }} disabled={busy || !email.trim()}>
            {busy ? "Sending…" : "Email me a reset link"}
          </button>
        </form>
      )}
      {error && <p style={{ color: "var(--danger)" }}>{error}</p>}
      <p className="text-dim" style={{ fontSize: 13, marginTop: 12 }}>
        <button onClick={onBack} style={linkButtonStyle}>
          ‹ Back to log in
        </button>
      </p>
    </div>
  );
}

function formatCountdown(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${m}:${s.toString().padStart(2, "0")}`;
}

export function ResetPassword({
  token,
  onPasswordChanged,
  onDone,
  onRequestNewLink,
}: {
  token: string;
  onPasswordChanged: () => void;
  onDone: () => void;
  onRequestNewLink: () => void;
}) {
  // null while checking the link; then the seconds it has left (0 = expired).
  const [secondsLeft, setSecondsLeft] = useState<number | null>(null);
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [doneMessage, setDoneMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    api
      .checkResetToken(token)
      .then((r) => setSecondsLeft(r.valid ? r.secondsLeft : 0))
      .catch(() => setSecondsLeft(0));
  }, [token]);

  // Count down locally once the server has said how long is left.
  const ticking = secondsLeft !== null && secondsLeft > 0 && !doneMessage;
  useEffect(() => {
    if (!ticking) return;
    const id = setInterval(() => setSecondsLeft((s) => (s && s > 0 ? s - 1 : 0)), 1000);
    return () => clearInterval(id);
  }, [ticking]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (password.length < 10) {
      setError("Use at least 10 characters");
      return;
    }
    if (password !== confirm) {
      setError("The two passwords don't match");
      return;
    }
    setBusy(true);
    try {
      const result = await api.resetPassword(token, password);
      setDoneMessage(result.message);
      onPasswordChanged();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't change the password");
      // If the link ran out (or was used) meanwhile, switch to the
      // "expired" view so the next step is obvious.
      api
        .checkResetToken(token)
        .then((r) => !r.valid && setSecondsLeft(0))
        .catch(() => {});
    } finally {
      setBusy(false);
    }
  }

  if (doneMessage) {
    return (
      <div className="card">
        <h2>Password changed</h2>
        <p>{doneMessage}</p>
        <p className="text-dim" style={{ fontSize: 13 }}>
          For your security, any device that was still logged in has been signed out.
        </p>
        <button className="button-primary" style={{ width: "100%" }} onClick={onDone}>
          Go to log in
        </button>
      </div>
    );
  }

  if (secondsLeft === null) {
    return (
      <div className="card">
        <p className="text-dim">Checking your reset link…</p>
      </div>
    );
  }

  if (secondsLeft === 0) {
    return (
      <div className="card">
        <h2>This link has expired</h2>
        <p>Reset links only work for 3 minutes and can only be used once. Send yourself a new one and open it straight away.</p>
        <button className="button-primary" style={{ width: "100%" }} onClick={onRequestNewLink}>
          Send a new link
        </button>
        <p className="text-dim" style={{ fontSize: 13, marginTop: 12 }}>
          <button onClick={onDone} style={linkButtonStyle}>
            ‹ Back to log in
          </button>
        </p>
      </div>
    );
  }

  return (
    <div className="card">
      <h2>Choose a new password</h2>
      <p className="text-dim" style={{ fontSize: 13, marginTop: 0 }}>
        This link expires in <strong>{formatCountdown(secondsLeft)}</strong>.
      </p>
      <form onSubmit={handleSubmit}>
        <input
          placeholder="New password (at least 10 characters)"
          type="password"
          autoComplete="new-password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          style={inputStyle}
        />
        <input
          placeholder="Type it again"
          type="password"
          autoComplete="new-password"
          value={confirm}
          onChange={(e) => setConfirm(e.target.value)}
          style={inputStyle}
        />
        <button className="button-primary" style={{ width: "100%" }} disabled={busy}>
          {busy ? "Saving…" : "Save new password"}
        </button>
      </form>
      {error && <p style={{ color: "var(--danger)" }}>{error}</p>}
    </div>
  );
}
