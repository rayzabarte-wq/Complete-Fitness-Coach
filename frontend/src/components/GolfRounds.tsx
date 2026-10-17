import { FormEvent, useCallback, useEffect, useState } from "react";
import { api, GolfRound, GolfRoundsResponse } from "../lib/api.js";
import { formatLocalDateKey } from "../lib/location.js";

// Golf rounds played, logged by hand, with a goal for how many to play in a
// quarter. Every round counts as one, whether 9 or 18 holes. Lives at the top
// of Log → Golf.

const MONTHS = ["Jan–Mar", "Apr–Jun", "Jul–Sep", "Oct–Dec"];

function quarterLabel(q: string): string {
  const [year, n] = q.split("-Q");
  return `Q${n} ${year} (${MONTHS[Number(n) - 1]})`;
}

// Next quarter, this one, and the three before it.
function quarterOptions(): string[] {
  const now = new Date();
  let y = now.getFullYear();
  let q = Math.floor(now.getMonth() / 3) + 1;
  const current = `${y}-Q${q}`;
  const out = [q === 4 ? `${y + 1}-Q1` : `${y}-Q${q + 1}`];
  for (let i = 0; i < 4; i++) {
    out.push(`${y}-Q${q}`);
    q--;
    if (q === 0) {
      q = 4;
      y--;
    }
  }
  return out.includes(current) ? out : [current, ...out];
}

function currentQuarter(): string {
  const now = new Date();
  return `${now.getFullYear()}-Q${Math.floor(now.getMonth() / 3) + 1}`;
}

const STATUS_TEXT: Record<NonNullable<GolfRoundsResponse["status"]>, string> = {
  done: "Goal reached. Well played.",
  missed: "The quarter has ended short of the goal.",
  on_track: "On track",
  behind: "A little behind",
};

export default function GolfRounds() {
  const [quarter, setQuarter] = useState(currentQuarter);
  const [data, setData] = useState<GolfRoundsResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  // "new", a round id being edited, or null.
  const [editing, setEditing] = useState<string | "new" | null>(null);
  const [goalOpen, setGoalOpen] = useState(false);
  const [syncing, setSyncing] = useState(false);

  const load = useCallback(() => {
    api.getGolfRounds(quarter).then(setData).catch((e) => setError(e.message));
  }, [quarter]);
  useEffect(load, [load]);

  async function sync() {
    setSyncing(true);
    setError(null);
    try {
      setData(await api.syncGolfRounds(quarter));
    } catch (e: any) {
      setError(e.message);
    } finally {
      setSyncing(false);
    }
  }

  async function remove(r: GolfRound) {
    if (!window.confirm(`Delete the round at ${r.course} on ${r.date}?`)) return;
    try {
      await api.deleteGolfRound(r.id);
      load();
    } catch (e: any) {
      setError(e.message);
    }
  }

  const pct = data && data.target ? Math.min(100, Math.round((data.count / data.target) * 100)) : 0;

  return (
    <div style={{ marginBottom: 16 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8, marginBottom: 8 }}>
        <h3 style={{ margin: 0, fontSize: 16 }}>Rounds</h3>
        <select value={quarter} onChange={(e) => setQuarter(e.target.value)} aria-label="Quarter" style={{ padding: "6px 8px" }}>
          {quarterOptions().map((q) => (
            <option key={q} value={q}>
              {quarterLabel(q)}
            </option>
          ))}
        </select>
      </div>

      {error && <p style={{ color: "var(--danger)", fontSize: 13 }}>{error}</p>}
      {!data && !error && <p className="text-dim">Loading…</p>}

      {data && (
        <>
          <div className="card" style={{ marginBottom: 10 }}>
            {data.target === null ? (
              <div>
                <div style={{ fontSize: 14 }}>
                  <b>{data.count}</b> round{data.count === 1 ? "" : "s"} this quarter. No goal set yet.
                </div>
              </div>
            ) : (
              <div>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
                  <div style={{ fontFamily: '"Poppins", sans-serif', fontWeight: 600, fontSize: 22, color: "var(--navy)" }}>
                    {data.count} <span className="text-dim" style={{ fontSize: 14, fontWeight: 400 }}>of {data.target} rounds</span>
                  </div>
                  {data.status && (
                    <span className={data.status === "behind" ? "chip chip-sun" : "chip chip-accent"}>{STATUS_TEXT[data.status]}</span>
                  )}
                </div>
                <div style={{ height: 8, background: "var(--surface-2)", borderRadius: 4, margin: "8px 0" }} role="img" aria-label={`${data.count} of ${data.target} rounds`}>
                  <div style={{ height: 8, width: `${pct}%`, background: "var(--accent)", borderRadius: 4 }} />
                </div>
                <div className="text-dim" style={{ fontSize: 12 }}>
                  {data.remaining === 0
                    ? "You've reached your goal for this quarter."
                    : data.daysLeft === 0
                      ? `${data.remaining} short.`
                      : `${data.remaining} to go with ${data.daysLeft} day${data.daysLeft === 1 ? "" : "s"} left${data.neededPerWeek ? ` (about ${data.neededPerWeek} a week)` : ""}.`}
                </div>
              </div>
            )}
            {(data.averageScore18 !== null || data.bestScore18 !== null) && (
              <div className="text-dim" style={{ fontSize: 12, marginTop: 6 }}>
                18-hole scores: average {data.averageScore18}, best {data.bestScore18}
              </div>
            )}
            {goalOpen ? (
              <GoalForm
                quarter={quarter}
                current={data.target}
                onDone={() => {
                  setGoalOpen(false);
                  load();
                }}
              />
            ) : (
              <button className="button-quiet" style={{ marginTop: 8 }} onClick={() => setGoalOpen(true)}>
                {data.target === null ? "Set a goal" : "Change goal"}
              </button>
            )}
          </div>

          {editing === "new" ? (
            <RoundForm
              courses={data.courses}
              onCancel={() => setEditing(null)}
              onSaved={() => {
                setEditing(null);
                load();
              }}
            />
          ) : (
            <button className="button-primary" style={{ width: "100%", marginBottom: 10 }} onClick={() => setEditing("new")}>
              Log a round
            </button>
          )}

          {data.stravaConnected && (
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8, marginBottom: 8 }}>
              <span className="text-dim" style={{ fontSize: 12 }}>
                {data.syncError ?? "Golf rounds recorded on Strava are added here automatically. Tap Edit on one to add the score."}
              </span>
              <button className="button-quiet" onClick={sync} disabled={syncing} style={{ whiteSpace: "nowrap" }}>
                {syncing ? "Checking…" : "Sync now"}
              </button>
            </div>
          )}
          {data.rounds.length === 0 && <p className="text-dim" style={{ fontSize: 13 }}>No rounds logged in this quarter.</p>}
          {data.rounds.map((r) =>
            editing === r.id ? (
              <RoundForm
                key={r.id}
                round={r}
                courses={data.courses}
                onCancel={() => setEditing(null)}
                onSaved={() => {
                  setEditing(null);
                  load();
                }}
              />
            ) : (
              <div key={r.id} className="card" style={{ marginBottom: 6, padding: "10px 12px" }}>
                <div style={{ display: "flex", justifyContent: "space-between", gap: 8, fontSize: 14 }}>
                  <span style={{ fontWeight: 600 }}>
                    {r.course}
                    {r.source === "strava" && (
                      <span className="chip" style={{ marginLeft: 6, fontSize: 10, fontWeight: 500 }}>
                        Strava
                      </span>
                    )}
                  </span>
                  <span className="text-dim" style={{ whiteSpace: "nowrap" }}>
                    {new Date(`${r.date}T12:00`).toLocaleDateString(undefined, { weekday: "short", day: "numeric", month: "short" })}
                  </span>
                </div>
                <div className="text-dim" style={{ fontSize: 12, marginTop: 2 }}>
                  {r.holes} holes{r.score !== null ? ` · score ${r.score}` : ""}
                </div>
                {r.notes && <div style={{ fontSize: 13, marginTop: 4, whiteSpace: "pre-wrap" }}>{r.notes}</div>}
                <div style={{ display: "flex", gap: 6, marginTop: 6 }}>
                  <button className="button-quiet" onClick={() => setEditing(r.id)}>
                    Edit
                  </button>
                  <button className="button-quiet" onClick={() => remove(r)}>
                    Delete
                  </button>
                </div>
              </div>
            )
          )}
        </>
      )}
    </div>
  );
}

function GoalForm({ quarter, current, onDone }: { quarter: string; current: number | null; onDone: () => void }) {
  const [value, setValue] = useState(current !== null ? String(current) : "");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function save(e: FormEvent) {
    e.preventDefault();
    const n = Number(value);
    if (!Number.isInteger(n) || n < 1 || n > 90) {
      setError("Enter a whole number of rounds from 1 to 90.");
      return;
    }
    setBusy(true);
    try {
      await api.setGolfRoundGoal(quarter, n);
      onDone();
    } catch (err: any) {
      setError(err.message);
      setBusy(false);
    }
  }

  async function clear() {
    setBusy(true);
    try {
      await api.clearGolfRoundGoal(quarter);
      onDone();
    } catch (err: any) {
      setError(err.message);
      setBusy(false);
    }
  }

  return (
    <form onSubmit={save} style={{ marginTop: 10, display: "grid", gap: 8 }}>
      <label style={{ fontSize: 13 }}>
        Rounds to play in {quarterLabel(quarter)}
        <input inputMode="numeric" value={value} onChange={(e) => setValue(e.target.value)} placeholder="e.g. 8" style={{ width: "100%", boxSizing: "border-box", padding: 10, marginTop: 4 }} />
      </label>
      {error && <div style={{ color: "var(--danger)", fontSize: 13 }}>{error}</div>}
      <div style={{ display: "flex", gap: 8 }}>
        <button type="submit" className="button-primary" disabled={busy || !value.trim()}>
          Save goal
        </button>
        {current !== null && (
          <button type="button" className="button-secondary" onClick={clear} disabled={busy}>
            Remove goal
          </button>
        )}
        <button type="button" className="button-quiet" onClick={onDone}>
          Cancel
        </button>
      </div>
    </form>
  );
}

function RoundForm({ round, courses, onCancel, onSaved }: { round?: GolfRound; courses: string[]; onCancel: () => void; onSaved: () => void }) {
  const [date, setDate] = useState(round?.date ?? formatLocalDateKey(new Date()));
  const [course, setCourse] = useState(round?.course ?? courses[0] ?? "");
  const [holes, setHoles] = useState<9 | 18>(round?.holes ?? 18);
  const [score, setScore] = useState(round?.score != null ? String(round.score) : "");
  const [notes, setNotes] = useState(round?.notes ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function save(e: FormEvent) {
    e.preventDefault();
    const trimmed = score.trim();
    const scoreNum = trimmed ? Number(trimmed) : null;
    if (scoreNum !== null && (!Number.isInteger(scoreNum) || scoreNum < 10 || scoreNum > 250)) {
      setError("Score should be a whole number between 10 and 250, or left blank.");
      return;
    }
    setBusy(true);
    setError(null);
    const data = { date, course: course.trim(), holes, score: scoreNum, notes: notes.trim() || null };
    try {
      if (round) await api.updateGolfRound(round.id, data);
      else await api.addGolfRound(data);
      onSaved();
    } catch (err: any) {
      setError(err.message);
      setBusy(false);
    }
  }

  return (
    <form onSubmit={save} className="card" style={{ marginBottom: 10, display: "grid", gap: 8 }}>
      <label style={{ fontSize: 13 }}>
        Date
        <input type="date" value={date} max={formatLocalDateKey(new Date())} onChange={(e) => setDate(e.target.value)} style={{ width: "100%", boxSizing: "border-box", padding: 10, marginTop: 4 }} />
      </label>
      <label style={{ fontSize: 13 }}>
        Course
        <input list="golf-courses" value={course} onChange={(e) => setCourse(e.target.value)} maxLength={80} style={{ width: "100%", boxSizing: "border-box", padding: 10, marginTop: 4 }} />
        <datalist id="golf-courses">
          {courses.map((c) => (
            <option key={c} value={c} />
          ))}
        </datalist>
      </label>
      <div className="subtabs" role="radiogroup" aria-label="Holes played">
        {([18, 9] as const).map((h) => (
          <button key={h} type="button" role="radio" aria-checked={holes === h} aria-selected={holes === h} onClick={() => setHoles(h)}>
            {h} holes
          </button>
        ))}
      </div>
      <label style={{ fontSize: 13 }}>
        Score (optional)
        <input inputMode="numeric" value={score} onChange={(e) => setScore(e.target.value)} placeholder="Total strokes" style={{ width: "100%", boxSizing: "border-box", padding: 10, marginTop: 4 }} />
      </label>
      <label style={{ fontSize: 13 }}>
        Notes (optional)
        <textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={2} maxLength={500} style={{ width: "100%", boxSizing: "border-box", padding: 10, marginTop: 4 }} />
      </label>
      {error && <div style={{ color: "var(--danger)", fontSize: 13 }}>{error}</div>}
      <div style={{ display: "flex", gap: 8 }}>
        <button type="submit" className="button-primary" disabled={busy || !course.trim() || !date}>
          {busy ? "Saving…" : round ? "Save changes" : "Save round"}
        </button>
        <button type="button" className="button-quiet" onClick={onCancel}>
          Cancel
        </button>
      </div>
    </form>
  );
}
