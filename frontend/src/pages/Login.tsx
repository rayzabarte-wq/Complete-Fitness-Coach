import { useState } from "react";
import { api, auth } from "../lib/api.js";

export default function Login({ onLoggedIn }: { onLoggedIn: () => void }) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [code, setCode] = useState("");
  const [needsCode, setNeedsCode] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Shown once, right after a fresh /auth/register, so the account isn't
  // left without 2FA enabled.
  const [setupQr, setSetupQr] = useState<string | null>(null);
  const [setupSecret, setSetupSecret] = useState<string | null>(null);

  async function handleLogin(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    try {
      const result = await api.login(email, password, needsCode ? code : undefined);
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
  async function handleRegister() {
    setError(null);
    try {
      const result = await api.register(email, password);
      auth.setToken(result.token);
      const setup = await api.setup2fa();
      setSetupQr(setup.qrDataUrl);
      setSetupSecret(setup.secret);
    } catch (err: any) {
      setError(err.message);
    }
  }

  async function handleConfirm2fa(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    try {
      await api.verify2fa(code);
      onLoggedIn();
    } catch (err: any) {
      setError(err.message);
    }
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
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                style={{ width: "100%", padding: 10, marginBottom: 8 }}
              />
              <input
                placeholder="Password"
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                style={{ width: "100%", padding: 10, marginBottom: 8 }}
              />
            </>
          )}
          {needsCode && (
            <input
              placeholder="6-digit code"
              value={code}
              onChange={(e) => setCode(e.target.value)}
              style={{ width: "100%", padding: 10, marginBottom: 8 }}
            />
          )}
          <button className="button-primary" style={{ width: "100%" }}>
            {needsCode ? "Verify" : "Log in"}
          </button>
        </form>

        {error && <p style={{ color: "var(--danger)" }}>{error}</p>}

        {!needsCode && (
          <p className="text-dim" style={{ fontSize: 13, marginTop: 12 }}>
            First time here?{" "}
            <button
              onClick={handleRegister}
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
