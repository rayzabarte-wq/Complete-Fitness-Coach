import { useEffect, useState } from "react";
import { api, GolfBagOverview, GolfClubType } from "../lib/api.js";

// Settings → Golf: handicap (kept as a history), whether you can shape the
// ball, and the clubs in your bag. The golf coach uses these to pitch practice
// at your level, to skip shot-shaping drills if you can't shape shots, and to
// name the exact club in each drill and cover the whole bag over time.

export const CLUB_TYPE_LABEL: Record<GolfClubType, string> = {
  DRIVER: "Driver",
  WOOD: "Fairway wood",
  HYBRID: "Hybrid",
  IRON: "Iron",
  WEDGE: "Wedge",
  SAND_WEDGE: "Sand wedge",
  PUTTER: "Putter",
};
const TYPES = Object.keys(CLUB_TYPE_LABEL) as GolfClubType[];

export default function GolfSettings() {
  const [bag, setBag] = useState<GolfBagOverview | null>(null);
  const [handicap, setHandicap] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [name, setName] = useState("");
  const [type, setType] = useState<GolfClubType>("IRON");

  function apply(b: GolfBagOverview) {
    setBag(b);
    setHandicap(b.handicap === null ? "" : String(b.handicap));
  }
  useEffect(() => {
    api.getGolfBag().then(apply).catch((e) => setError(e.message));
  }, []);

  async function run(fn: () => Promise<GolfBagOverview>, done?: string) {
    setBusy(true);
    setError(null);
    setMsg(null);
    try {
      apply(await fn());
      if (done) setMsg(done);
    } catch (e: any) {
      setError(e.message ?? "Couldn't save");
    } finally {
      setBusy(false);
    }
  }

  if (!bag) return error ? <p style={{ color: "var(--danger)", fontSize: 13 }}>{error}</p> : null;

  const hcpNum = handicap.trim() === "" ? null : Number(handicap);
  const hcpValid = hcpNum === null || (Number.isFinite(hcpNum) && hcpNum >= -10 && hcpNum <= 54);
  const hcpDirty = hcpNum !== bag.handicap;

  return (
    <div>
      <p className="text-dim" style={{ fontSize: 13, marginTop: 0 }}>
        The golf coach uses this to pitch practice at your level and to name the exact club in each drill.
      </p>

      <label htmlFor="golf-handicap" style={{ fontSize: 14 }}>Current handicap</label>
      <div style={{ display: "flex", gap: 8, alignItems: "center", marginTop: 4 }}>
        <input
          id="golf-handicap"
          type="number"
          inputMode="decimal"
          step="0.1"
          min={-10}
          max={54}
          value={handicap}
          onChange={(e) => {
            setHandicap(e.target.value);
            setMsg(null);
          }}
          placeholder="e.g. 18.4"
          style={{ width: 100, padding: 8 }}
        />
        <button
          type="button"
          className="button-secondary"
          disabled={busy || !hcpDirty || !hcpValid}
          onClick={() => run(() => api.saveGolfProfile({ handicap: hcpNum }), "Handicap saved.")}
        >
          Save
        </button>
      </div>
      {!hcpValid && <p style={{ color: "var(--danger)", fontSize: 12, margin: "4px 0 0" }}>Enter a handicap between -10 and 54.</p>}
      {bag.handicapHistory.length > 1 && (
        <p className="text-dim" style={{ fontSize: 12, margin: "6px 0 0" }}>
          History: {bag.handicapHistory.slice(0, 6).map((h) => `${h.handicap} (${new Date(h.date).toLocaleDateString(undefined, { day: "numeric", month: "short" })})`).join(" · ")}
        </p>
      )}

      <div style={{ marginTop: 14, fontSize: 14 }}>Can you shape the ball on purpose (draw and fade)?</div>
      <div style={{ display: "flex", gap: 8, marginTop: 6 }} role="radiogroup" aria-label="Can you shape shots">
        {([
          [true, "Yes"],
          [false, "No"],
        ] as const).map(([value, label]) => (
          <button
            key={label}
            type="button"
            role="radio"
            aria-checked={bag.canShapeShots === value}
            disabled={busy}
            className={bag.canShapeShots === value ? "button-primary" : "button-secondary"}
            onClick={() => run(() => api.saveGolfProfile({ canShapeShots: value }))}
          >
            {label}
          </button>
        ))}
      </div>
      <p className="text-dim" style={{ fontSize: 12, margin: "4px 0 0" }}>
        {bag.canShapeShots === null
          ? "Not answered yet. Until you answer, no shot-shaping drills are offered."
          : bag.canShapeShots
          ? "Drills may include shaping shots when your notes call for it."
          : "No shot-shaping drills. Practice builds consistency instead."}
      </p>

      <div style={{ marginTop: 16, fontSize: 14 }}>
        <strong>Your clubs</strong>
      </div>
      {bag.clubs.length === 0 ? (
        <div style={{ marginTop: 6 }}>
          <p className="text-dim" style={{ fontSize: 13, margin: "0 0 8px" }}>
            No clubs yet. Start from a typical 14-club set and change it, or add your own below.
          </p>
          <button type="button" className="button-secondary" disabled={busy} onClick={() => run(() => api.addStandardGolfBag(), "Added a standard set.")}>
            Add a standard set
          </button>
        </div>
      ) : (
        <div style={{ marginTop: 6 }}>
          {bag.clubs.map((c) => (
            <div key={c.id} style={{ display: "flex", alignItems: "center", gap: 8, padding: "6px 0", borderBottom: "1px solid var(--border)" }}>
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: 14 }}>{c.name}</div>
                <div className="text-dim" style={{ fontSize: 12 }}>
                  {CLUB_TYPE_LABEL[c.type]} · {c.sessions ? `practised in ${c.sessions} session${c.sessions === 1 ? "" : "s"}, last ${c.lastPracticed}` : "not practised yet"}
                </div>
              </div>
              <button type="button" className="button-quiet" disabled={busy} aria-label={`Remove ${c.name}`} onClick={() => run(() => api.deleteGolfClub(c.id))}>
                Remove
              </button>
            </div>
          ))}
        </div>
      )}

      <div style={{ display: "flex", gap: 8, marginTop: 10 }}>
        <input
          placeholder="Add a club, e.g. 4 iron"
          aria-label="Club name"
          value={name}
          maxLength={40}
          onChange={(e) => setName(e.target.value)}
          style={{ flex: 1, padding: 8, minWidth: 0 }}
        />
        <select value={type} onChange={(e) => setType(e.target.value as GolfClubType)} aria-label="Club type" style={{ padding: 8 }}>
          {TYPES.map((t) => (
            <option key={t} value={t}>
              {CLUB_TYPE_LABEL[t]}
            </option>
          ))}
        </select>
        <button
          type="button"
          className="button-secondary"
          disabled={busy || !name.trim()}
          onClick={() => run(() => api.addGolfClub({ name: name.trim(), type }).then((b) => (setName(""), b)))}
        >
          Add
        </button>
      </div>
      {error && <p style={{ color: "var(--danger)", fontSize: 13 }}>{error}</p>}
      {msg && <p className="text-dim" style={{ fontSize: 13 }}>{msg}</p>}
    </div>
  );
}
