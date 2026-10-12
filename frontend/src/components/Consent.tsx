import { useEffect, useState } from "react";
import { api, ConsentInfo, ConsentPurpose } from "../lib/api.js";

// The consent journey. Shown once straight after sign-up (and once to
// existing accounts after this update), then always available in
// Settings → Privacy & consent. Every purpose is a separate, explicit
// opt-in — nothing is pre-ticked — and can be withdrawn later with the
// effect spelled out before it happens.

export function ConsentOnboarding({ onDone }: { onDone: () => void }) {
  const [info, setInfo] = useState<ConsentInfo | null>(null);
  const [choices, setChoices] = useState<Record<ConsentPurpose, boolean>>({
    PROFILE: false,
    BODY_DATA: false,
    BENCHMARKING: false,
    PRODUCT_ANALYTICS: false,
  });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api.getConsent().then(setInfo).catch((e) => setError(e.message));
  }, []);

  async function save() {
    setSaving(true);
    setError(null);
    try {
      await api.saveConsent(choices);
      onDone();
    } catch (e: any) {
      setError(typeof e.message === "string" ? e.message : "Couldn't save your choices");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div style={{ maxWidth: 480, margin: "0 auto", padding: "max(24px, env(safe-area-inset-top)) 16px 32px" }}>
      <h1 style={{ fontSize: 22, margin: "0 0 6px" }}>Your data, your choice</h1>
      <p className="text-dim" style={{ fontSize: 14, marginTop: 0 }}>
        Logging workouts needs only your account. Everything below is optional. Tick only what you want: each one is separate, and you can change any of them later in Settings.
      </p>
      {!info && !error && <p className="text-dim">Loading…</p>}
      {info?.purposes.map((p) => (
        <label key={p.purpose} className="card" style={{ display: "flex", gap: 12, alignItems: "flex-start", marginBottom: 10, cursor: "pointer" }}>
          <input
            type="checkbox"
            checked={choices[p.purpose]}
            onChange={(e) => setChoices((c) => ({ ...c, [p.purpose]: e.target.checked }))}
            style={{ width: 20, height: 20, marginTop: 2, flexShrink: 0 }}
          />
          <span>
            <strong style={{ color: "var(--navy)" }}>{p.title}</strong>
            <span className="text-dim" style={{ display: "block", fontSize: 13, marginTop: 2 }}>
              {p.description}
            </span>
          </span>
        </label>
      ))}
      <p className="text-dim" style={{ fontSize: 12 }}>
        Your data is never sold or shared with third parties. You can download all of it or delete your account at any time in Settings → Your data.
      </p>
      {error && <p style={{ color: "var(--danger)" }}>{error}</p>}
      <button className="button-primary" onClick={save} disabled={saving || !info} style={{ width: "100%" }}>
        {saving ? "Saving…" : "Save my choices"}
      </button>
    </div>
  );
}

export function ConsentSettings({ onChanged }: { onChanged?: () => void }) {
  const [info, setInfo] = useState<ConsentInfo | null>(null);
  const [confirming, setConfirming] = useState<ConsentPurpose | null>(null);
  const [error, setError] = useState<string | null>(null);

  function load() {
    api.getConsent().then(setInfo).catch((e) => setError(e.message));
  }
  useEffect(load, []);

  async function set(purpose: ConsentPurpose, granted: boolean) {
    setError(null);
    try {
      await api.saveConsent({ [purpose]: granted });
      setConfirming(null);
      load();
      onChanged?.();
    } catch (e: any) {
      setError(typeof e.message === "string" ? e.message : "Couldn't update consent");
    }
  }

  if (!info) return <p className="text-dim">{error ?? "Loading…"}</p>;

  return (
    <div>
      {info.purposes.map((p) => (
        <div key={p.purpose} style={{ padding: "10px 0", borderTop: "1px solid var(--border)" }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8 }}>
            <strong style={{ fontSize: 14 }}>{p.title}</strong>
            <span className={p.granted ? "chip" : "chip"} style={p.granted ? { background: "#e6f2ec", color: "var(--good)" } : undefined}>
              {p.granted ? "✓ On" : "Off"}
            </span>
          </div>
          <div className="text-dim" style={{ fontSize: 12, marginTop: 2 }}>
            {p.description}
          </div>
          {p.updatedAt && (
            <div className="text-dim" style={{ fontSize: 11, marginTop: 2 }}>
              Last changed {new Date(p.updatedAt).toLocaleDateString()}
            </div>
          )}
          {confirming === p.purpose ? (
            <div style={{ marginTop: 6, padding: 8, border: "1px solid var(--accent)", borderRadius: 8 }}>
              <div style={{ fontSize: 13, color: "var(--accent)" }}>{p.withdrawEffect}</div>
              <div style={{ display: "flex", gap: 6, marginTop: 6 }}>
                <button className="button-quiet" onClick={() => setConfirming(null)} style={{ flex: 1 }}>
                  Keep it on
                </button>
                <button className="button-primary" onClick={() => set(p.purpose, false)} style={{ flex: 1 }}>
                  Turn off
                </button>
              </div>
            </div>
          ) : (
            <button className="button-quiet" style={{ marginTop: 6 }} onClick={() => (p.granted ? setConfirming(p.purpose) : set(p.purpose, true))}>
              {p.granted ? "Turn off" : "Turn on"}
            </button>
          )}
        </div>
      ))}
      {error && <p style={{ color: "var(--danger)", fontSize: 13 }}>{error}</p>}
      <details style={{ marginTop: 8 }}>
        <summary className="text-dim" style={{ cursor: "pointer", fontSize: 12 }}>
          Consent history ({info.history.length})
        </summary>
        <ul style={{ fontSize: 12, paddingLeft: 18 }} className="text-dim">
          {info.history.map((h, i) => (
            <li key={i}>
              {new Date(h.at).toLocaleString()}: {info.purposes.find((p) => p.purpose === h.purpose)?.title} {h.granted ? "turned on" : "turned off"} (wording v{h.textVersion})
            </li>
          ))}
        </ul>
      </details>
    </div>
  );
}
