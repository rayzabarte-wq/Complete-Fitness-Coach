import { useEffect, useState } from "react";
import { api, Availability } from "../lib/api.js";

// Average weekly time for training, in Settings. Used later to propose the next
// 7 days of workouts, alongside the sport ambitions on Progress → Goals.

const DAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
// Show Monday first; storage stays Sunday-first (index 0 = Sunday).
const ORDER = [1, 2, 3, 4, 5, 6, 0];
const STEP = 15;
const MAX = 720;

export function formatMinutes(m: number): string {
  if (m <= 0) return "none";
  const h = Math.floor(m / 60);
  const r = m % 60;
  return h ? (r ? `${h}h ${r}m` : `${h}h`) : `${r}m`;
}

export default function WeeklyAvailability({ onLoaded }: { onLoaded?: (a: Availability) => void }) {
  const [saved, setSaved] = useState<Availability | null>(null);
  const [mins, setMins] = useState<number[]>([0, 0, 0, 0, 0, 0, 0]);
  const [notes, setNotes] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api
      .getAvailability()
      .then((a) => {
        setSaved(a);
        setMins(a.minutesByDay);
        setNotes(a.notes ?? "");
        onLoaded?.(a);
      })
      .catch((e) => setError(e.message));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const total = mins.reduce((a, b) => a + b, 0);
  const dirty = !saved || mins.some((m, i) => m !== saved.minutesByDay[i]) || notes.trim() !== (saved.notes ?? "");

  function set(day: number, value: number) {
    setMsg(null);
    setMins((cur) => cur.map((m, i) => (i === day ? Math.max(0, Math.min(MAX, value)) : m)));
  }

  async function save() {
    setBusy(true);
    setError(null);
    setMsg(null);
    try {
      const a = await api.saveAvailability({ minutesByDay: mins, notes: notes.trim() || null });
      setSaved(a);
      setMins(a.minutesByDay);
      onLoaded?.(a);
      setMsg("Saved.");
    } catch (e: any) {
      setError(e.message ?? "Couldn't save");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div>
      <p className="text-dim" style={{ fontSize: 13, marginTop: 0 }}>
        On an average week, how long could you train each day? Proposed workouts for the next 7 days will fit inside this and use your sport goals.
      </p>
      {ORDER.map((d) => (
        <div key={d} style={{ display: "flex", alignItems: "center", gap: 8, padding: "6px 0" }}>
          <span style={{ width: 92 }}>{DAYS[d]}</span>
          <button type="button" className="button-quiet" aria-label={`Less time on ${DAYS[d]}`} disabled={mins[d] <= 0} onClick={() => set(d, mins[d] - STEP)}>
            −
          </button>
          <span style={{ width: 64, textAlign: "center" }}>{formatMinutes(mins[d])}</span>
          <button type="button" className="button-quiet" aria-label={`More time on ${DAYS[d]}`} disabled={mins[d] >= MAX} onClick={() => set(d, mins[d] + STEP)}>
            +
          </button>
        </div>
      ))}
      <p style={{ fontSize: 14, margin: "8px 0" }}>
        <strong>{formatMinutes(total)}</strong> a week across {mins.filter((m) => m > 0).length} days
      </p>
      <label className="text-dim" style={{ fontSize: 13 }} htmlFor="avail-notes">
        Anything else? (optional)
      </label>
      <textarea
        id="avail-notes"
        rows={2}
        maxLength={300}
        value={notes}
        onChange={(e) => {
          setNotes(e.target.value);
          setMsg(null);
        }}
        placeholder="e.g. Tuesdays are only before 7am; longer weekends when the kids are away"
        style={{ width: "100%", boxSizing: "border-box" }}
      />
      {error && <p style={{ color: "var(--danger)", fontSize: 13 }}>{error}</p>}
      <div style={{ display: "flex", alignItems: "center", gap: 10, marginTop: 8 }}>
        <button type="button" className="button-primary" disabled={busy || !dirty} onClick={save}>
          {busy ? "Saving…" : "Save"}
        </button>
        {msg && <span className="text-dim" style={{ fontSize: 13 }}>{msg}</span>}
      </div>
    </div>
  );
}
