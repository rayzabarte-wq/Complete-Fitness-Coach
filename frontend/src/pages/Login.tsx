import { useState } from "react";
import { api, auth } from "../lib/api.js";
import { ForgotPassword, ResetPassword } from "./PasswordReset.js";
import { getTwoFactorTrust, setTwoFactorTrust } from "../lib/twoFactorTrust.js";

// A password reset email links to /?reset=<token>.
function resetTokenFromUrl(): string | null {
  return new URLSearchParams(window.location.search).get("reset");
}

function clearResetTokenFromUrl() {
  const url = new URL(window.location.href);
  url.searchParams.delete("reset");
  window.history.replaceState(null, "", url.pathname + url.search + url.hash);
}

export default function Login({ onLoggedIn }: { onLoggedIn: () => void }) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [code, setCode] = useState("");
  const [needsCode, setNeedsCode] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [mode, setMode] = useState<"login" | "register" | "forgot" | "reset">(() => (resetTokenFromUrl() ? "reset" : "login"));
  const [resetToken] = useState(resetTokenFromUrl);

  // Shown once, right after a fresh /auth/register, so the account isn't
  // left without 2FA enabled.
  const [setupQr, setSetupQr] = useState<string | null>(null);
  const [setupSecret, setSetupSecret] = useState<string | null>(null);

  async function handleLogin(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    try {
      // Within 24 hours of a 2FA code on this device, the trust cookie lets
      // the server skip asking for one.
      const result = await api.login(email, password, needsCode ? code : undefined, getTwoFactorTrust());
      if (result.trustToken) setTwoFactorTrust(result.trustToken, result.trustHours ?? 24);
      auth.setToken(result.token);
      onLoggedIn();
    } catch (err: any) {
      if (err.requires2fa) {
        setNeedsCode(true);
      } else {
        setError(err.message);
      }
    }
  }

  // Only succeeds once — see backend /auth/register, which refuses after
  // the first account exists.
  const [creating, setCreating] = useState(false);
  async function handleRegister(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    const cleanEmail = email.trim().toLowerCase();
    if (!cleanEmail.includes("@")) return setError("Enter your email address.");
    if (password.length < 10) return setError("Use at least 10 characters for the password.");
    if (password !== password2) return setError("The two passwords don't match.");
    setCreating(true);
    try {
      const result = await api.register(cleanEmail, password);
      auth.setToken(result.token);
      setEmail(cleanEmail);
      try {
        const setup = await api.setup2fa();
        setSetupQr(setup.qrDataUrl);
        setSetupSecret(setup.secret);
      } catch {
        // The account exists; only the 2FA step failed. Log in and set 2FA up in Settings.
        auth.clearToken();
        setMode("login");
        setError("Your account was created, but the 2FA step didn't load. Log in below, then turn on 2FA in Settings.");
      }
    } catch (err: any) {
      setError(err.message);
    } finally {
      setCreating(false);
    }
  }
  const [password2, setPassword2] = useState("");

  async function handleConfirm2fa(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    try {
      const result = await api.verify2fa(code);
      if (result.trustToken) setTwoFactorTrust(result.trustToken, result.trustHours ?? 24);
      onLoggedIn();
    } catch (err: any) {
      setError(err.message);
    }
  }

  function backToLogin() {
    clearResetTokenFromUrl();
    setError(null);
    setNeedsCode(false);
    setCode("");
    setPassword("");
    setMode("login");
  }

  const title = <h1 style={{ fontSize: 22, textAlign: "center", marginBottom: 16 }}>Complete Fitness Coach</h1>;

  if (mode === "reset" && resetToken) {
    return (
      <div>
        {title}
        <ResetPassword
          token={resetToken}
          onPasswordChanged={clearResetTokenFromUrl}
          onDone={backToLogin}
          onRequestNewLink={() => {
            clearResetTokenFromUrl();
            setMode("forgot");
          }}
        />
      </div>
    );
  }

  if (mode === "register") {
    return (
      <div>
        {title}
        <div className="card">
          <h2>Create your account</h2>
          <form onSubmit={handleRegister}>
            <input
              placeholder="Email"
              type="email"
              inputMode="email"
              autoComplete="email"
              autoCapitalize="none"
              autoCorrect="off"
              spellCheck={false}
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              style={{ width: "100%", padding: 10, marginBottom: 8, boxSizing: "border-box" }}
            />
            <input
              placeholder="Password (at least 10 characters)"
              type="password"
              autoComplete="new-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              style={{ width: "100%", padding: 10, marginBottom: 8, boxSizing: "border-box" }}
            />
            <input
              placeholder="Repeat the password"
              type="password"
              autoComplete="new-password"
              value={password2}
              onChange={(e) => setPassword2(e.target.value)}
              style={{ width: "100%", padding: 10, marginBottom: 8, boxSizing: "border-box" }}
            />
            <button className="button-primary" disabled={creating} style={{ width: "100%" }}>
              {creating ? "Creating…" : "Create account"}
            </button>
          </form>
          {error && <p style={{ color: "var(--danger)" }}>{error}</p>}
          <p className="text-dim" style={{ fontSize: 13, marginTop: 12, marginBottom: 0 }}>
            Next you'll set up 2FA with an authenticator app (Google Authenticator, Authy or 1Password), so keep your phone handy.{" "}
            <button
              type="button"
              onClick={() => {
                setError(null);
                setMode("login");
              }}
              style={{ background: "none", border: "none", color: "var(--accent)", cursor: "pointer", padding: 0 }}
            >
              I already have an account
            </button>
          </p>
        </div>
      </div>
    );
  }

  if (mode === "forgot") {
    return (
      <div>
        {title}
        <ForgotPassword initialEmail={email} onBack={backToLogin} />
      </div>
    );
  }

  if (setupQr) {
    return (
      <div>
        <h1 style={{ fontSize: 22, textAlign: "center", marginBottom: 16 }}>Complete Fitness Coach</h1>
        <div className="card">
          <h2>Set up 2FA</h2>
          <p className="text-dim">Scan this in Google Authenticator, Authy, or 1Password, then enter the 6-digit code.</p>
          <img src={setupQr} alt="2FA QR code" style={{ width: "100%", maxWidth: 240 }} />
          <p className="text-dim" style={{ fontSize: 12 }}>
            Can't scan? Enter manually: <code>{setupSecret}</code>
          </p>
          <form onSubmit={handleConfirm2fa}>
            <input
              placeholder="6-digit code"
              inputMode="numeric"
              autoComplete="one-time-code"
              maxLength={7}
              value={code}
              onChange={(e) => setCode(e.target.value)}
              style={{ width: "100%", padding: 10, marginTop: 8 }}
            />
            <button className="button-primary" style={{ width: "100%", marginTop: 8 }}>
              Confirm & finish setup
            </button>
          </form>
          {error && <p style={{ color: "var(--danger)" }}>{error}</p>}
        </div>
      </div>
    );
  }

  return (
    <div>
      <h1 style={{ fontSize: 22, textAlign: "center", marginBottom: 16 }}>Complete Fitness Coach</h1>
      <div className="card">
        <h2>{needsCode ? "Enter your 2FA code" : "Log in"}</h2>
        <form onSubmit={handleLogin}>
          {!needsCode && (
            <>
              <input
                placeholder="Email"
                type="email"
                inputMode="email"
                autoComplete="email"
                autoCapitalize="none"
                autoCorrect="off"
                spellCheck={false}
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                style={{ width: "100%", padding: 10, marginBottom: 8 }}
              />
              <input
                placeholder="Password (at least 10 characters)"
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                style={{ width: "100%", padding: 10, marginBottom: 8 }}
              />
            </>
          )}
          {needsCode && (
            <>
              <input
                placeholder="6-digit code"
                inputMode="numeric"
                autoComplete="one-time-code"
                maxLength={7}
                value={code}
                onChange={(e) => setCode(e.target.value)}
                style={{ width: "100%", padding: 10, marginBottom: 4 }}
              />
              <p className="text-dim" style={{ fontSize: 12, margin: "0 0 8px" }}>
                You won't be asked for a code again on this device for 24 hours.
              </p>
            </>
          )}
          <button className="button-primary" style={{ width: "100%" }}>
            {needsCode ? "Verify" : "Log in"}
          </button>
        </form>

        {error && <p style={{ color: "var(--danger)" }}>{error}</p>}

        {!needsCode && (
          <p style={{ fontSize: 13, marginTop: 12, marginBottom: 0 }}>
            <button
              onClick={() => {
                setError(null);
                setMode("forgot");
              }}
              style={{ background: "none", border: "none", color: "var(--accent)", cursor: "pointer", padding: 0 }}
            >
              Forgot password?
            </button>
          </p>
        )}

        {!needsCode && (
          <p className="text-dim" style={{ fontSize: 13, marginTop: 12 }}>
            First time here?{" "}
            <button
              type="button"
              onClick={() => {
                setError(null);
                setMode("register");
              }}
              style={{ background: "none", border: "none", color: "var(--accent)", cursor: "pointer", padding: 0 }}
            >
              Create an account
            </button>
          </p>
        )}
      </div>
    </div>
  );
}
