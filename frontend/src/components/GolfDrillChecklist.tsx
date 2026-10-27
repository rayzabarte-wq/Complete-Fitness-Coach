import { useEffect, useState } from "react";
import { api, PlannedDrill, PlannedSession } from "../lib/api.js";

// The drills of a golf practice session, laid out like a strength log: tap the
// circle to tick a drill off, and add a comment on how it went. Every change
// is saved straight away. Ticking the last drill marks the session done.

export default function GolfDrillChecklist({ session, onUpdated, commentPlaceholder }: { session: PlannedSession; onUpdated: () => void; commentPlaceholder?: string }) {
  const [drills, setDrills] = useState<PlannedDrill[]>(session.drills ?? []);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Pick up changes made elsewhere (another device, or a reload of the list).
  useEffect(() => setDrills(session.drills ?? []), [session.drills]);

  const doneCount = drills.filter((d) => d.done).length;

  async function save(next: PlannedDrill[], completeSession: boolean) {
    setDrills(next);
    setSaving(true);
    setError(null);
    try {
      await api.updatePlannedSession(session.id, { drills: next, ...(completeSession ? { completed: true } : {}) });
      onUpdated();
    } catch (e: any) {
      setError(e.message ?? "Couldn't save");
      setDrills(session.drills ?? []);
    } finally {
      setSaving(false);
    }
  }

  function toggle(i: number) {
    const next = drills.map((d, n) => (n === i ? { ...d, done: !d.done } : d));
    save(next, !session.completed && next.every((d) => d.done));
  }

  function setComment(i: number, comment: string) {
    setDrills((cur) => cur.map((d, n) => (n === i ? { ...d, comment } : d)));
  }

  function commitComment(i: number) {
    const saved = session.drills?.[i]?.comment ?? "";
    if (drills[i].comment.trim() === saved) return;
    save(drills.map((d, n) => (n === i ? { ...d, comment: d.comment.trim() } : d)), false);
  }

  if (drills.length === 0) return null;

  return (
    <div style={{ marginTop: 8 }}>
      <div className="text-dim" style={{ fontSize: 12, paddingBottom: 6, borderBottom: "1px solid var(--border)" }}>
        {doneCount} of {drills.length} done{saving ? " · saving…" : ""}
      </div>
      {drills.map((d, i) => (
        <div key={i} style={{ padding: "8px 0", borderBottom: i < drills.length - 1 ? "1px solid var(--border)" : undefined }}>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 36px", gap: 8, alignItems: "start" }}>
            <div>
              <div style={{ fontSize: 14, fontWeight: 600, textDecoration: d.done ? "line-through" : undefined, opacity: d.done ? 0.7 : 1 }}>
                {d.club ? `${d.club}: ` : ""}{d.name}
                {d.minutes > 0 && <span className="text-dim" style={{ fontWeight: 400 }}> · {d.minutes} min</span>}
              </div>
              {d.detail && (
                <div className="text-dim" style={{ fontSize: 12, marginTop: 2 }}>
                  {d.detail}
                </div>
              )}
            </div>
            <button
              type="button"
              onClick={() => toggle(i)}
              disabled={saving}
              aria-label={d.done ? `Mark ${d.name} not done` : `Mark ${d.name} done`}
              aria-pressed={d.done}
              style={{
                background: d.done ? "var(--accent)" : "var(--border)",
                color: d.done ? "var(--on-accent)" : "var(--text-dim)",
                border: "none",
                borderRadius: 6,
                height: 32,
                cursor: "pointer",
                fontWeight: 700,
              }}
            >
              {d.done ? "✓" : "○"}
            </button>
          </div>
          <input
            placeholder={commentPlaceholder ?? "How did it go? (e.g. pulled the 7-iron left, 6/10 inside 10 ft)"}
            aria-label={`Comment on ${d.name}`}
            value={d.comment}
            maxLength={500}
            onChange={(e) => setComment(i, e.target.value)}
            onBlur={() => commitComment(i)}
            style={{ width: "100%", boxSizing: "border-box", padding: 6, marginTop: 6, fontSize: 13 }}
          />
        </div>
      ))}
      {error && <p style={{ color: "var(--danger)", fontSize: 12, margin: "6px 0 0" }}>{error}</p>}
    </div>
  );
}
