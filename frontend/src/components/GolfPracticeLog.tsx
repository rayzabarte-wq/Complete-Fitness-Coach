import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { api, GolfSessionType, PlannedDrill, PlannedSession } from "../lib/api.js";
import { ACTIVITY_COLORS, activityForSessionType } from "../lib/activity.js";
import { fullLabelFor } from "../lib/sessionTypes.js";
import { formatLocalDateKey } from "../lib/location.js";

// Log → Golf: the practice session in progress, laid out like the strength
// log. A header card, then one card per drill with a numbered row: a comment,
// and the ✓ button to tick it off, plus a 1–10 "feel" row like RPE. Every
// change is saved straight away; "Finish practice" marks the session done.

const PRACTICE_TYPES = ["GOLF_RANGE", "GOLF_SHORT_GAME", "GOLF_PUTTING"];
const DAY_MS = 86400_000;

/** Sessions made before drills were stored hold the plan as text in the notes:
 * "1. Name (10 min) — detail". Turns those lines back into drills. */
export function drillsFromNotes(notes: string | null): PlannedDrill[] {
  const out: PlannedDrill[] = [];
  for (const line of (notes ?? "").split("\n")) {
    const m = line.match(/^\s*\d+\.\s*(.+?)\s*\((\d+)\s*min\)\s*[—–-]\s*(.*)$/);
    if (m) out.push({ name: m[1].slice(0, 80), minutes: Number(m[2]), detail: m[3].slice(0, 400), done: false, comment: "" });
  }
  return out.slice(0, 10);
}

function dayLabel(iso: string): string {
  return new Date(iso).toLocaleDateString(undefined, { weekday: "short", day: "numeric", month: "short", timeZone: "UTC" });
}

export default function GolfPracticeLog({ onChanged }: { onChanged?: () => void }) {
  const [sessions, setSessions] = useState<PlannedSession[] | null>(null);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [drills, setDrills] = useState<PlannedDrill[]>([]);
  const [sync, setSync] = useState<"saved" | "saving" | "error">("saved");
  const [savedAt, setSavedAt] = useState<Date | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [finishing, setFinishing] = useState(false);

  const load = useCallback(() => {
    const from = new Date(Date.now() - 3 * DAY_MS).toISOString();
    const to = new Date(Date.now() + 8 * DAY_MS).toISOString();
    api
      .getPlannedSessions(from, to)
      .then((all) => {
        const open = all.filter((s) => PRACTICE_TYPES.includes(s.type) && !s.completed);
        setSessions(open);
        setActiveId((cur) => (cur && open.some((s) => s.id === cur) ? cur : open[0]?.id ?? null));
      })
      .catch(() => setSessions([]));
  }, []);
  useEffect(load, [load]);

  const active = sessions?.find((s) => s.id === activeId) ?? null;
  // Switch drills only when a different session is chosen, not on every reload.
  useEffect(() => {
    const stored = active?.drills ?? [];
    const fromText = stored.length === 0 && active ? drillsFromNotes(active.notes) : [];
    setDrills(stored.length ? stored : fromText);
    setSync("saved");
    setSavedAt(null);
    // An older text plan becomes a checklist the first time it is opened.
    if (active && fromText.length) api.updatePlannedSession(active.id, { drills: fromText }).then(load).catch(() => undefined);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeId]);

  async function persist(next: PlannedDrill[]) {
    if (!active) return;
    setDrills(next);
    setSync("saving");
    try {
      await api.updatePlannedSession(active.id, { drills: next });
      setSync("saved");
      setSavedAt(new Date());
    } catch {
      setSync("error");
    }
  }

  const [building, setBuilding] = useState(false);
  const [buildError, setBuildError] = useState<string | null>(null);
  const [newName, setNewName] = useState("");

  async function buildWithAi() {
    if (!active) return;
    setBuilding(true);
    setBuildError(null);
    try {
      const plan = await api.generateGolfPlan(active.type as GolfSessionType, active.estimatedMinutes ?? undefined);
      const built = plan.drills.map((d) => ({ name: d.name, detail: d.detail, minutes: d.minutes, done: false, comment: "" }));
      await api.updatePlannedSession(active.id, {
        drills: built,
        ...(active.notes ? {} : { notes: `Focus: ${plan.focusSummary}\nWhy: ${plan.reasoning}` }),
      });
      setDrills(built);
      load();
    } catch (e: any) {
      setBuildError(e.message ?? "Couldn't build the drills");
    } finally {
      setBuilding(false);
    }
  }

  function addDrill() {
    const name = newName.trim();
    if (!name || drills.length >= 10) return;
    setNewName("");
    persist([...drills, { name: name.slice(0, 80), detail: "", minutes: 0, done: false, comment: "" }]).then(load);
  }

  const patch = (i: number, p: Partial<PlannedDrill>) => persist(drills.map((d, n) => (n === i ? { ...d, ...p } : d)));

  async function finish() {
    if (!active) return;
    setFinishing(true);
    try {
      await api.updatePlannedSession(active.id, { drills, completed: true });
      setNotice(`${fullLabelFor(active.type)} saved. ${drills.filter((d) => d.done).length} of ${drills.length} drills done.`);
      onChanged?.();
      load();
    } catch {
      setSync("error");
    } finally {
      setFinishing(false);
    }
  }

  if (sessions === null) return null;

  if (!active) {
    return (
      <>
        {notice && (
          <div className="card" style={{ marginBottom: 12, borderLeft: "4px solid var(--good)" }}>
            <p style={{ margin: 0, fontSize: 13 }}>✓ {notice}</p>
          </div>
        )}
        <div className="card" style={{ marginBottom: 12 }}>
          <strong style={{ color: "var(--navy)" }}>Golf practice</strong>
          <p className="text-dim" style={{ fontSize: 13, margin: "4px 0 0" }}>
            Nothing to log right now. Plan a week of practice from the <Link to="/">Calendar</Link> ("Plan it") and it will appear here to tick off.
          </p>
        </div>
      </>
    );
  }

  const color = ACTIVITY_COLORS[activityForSessionType(active.type)];
  const planned = active.notes?.split("\n").filter(Boolean) ?? [];
  const minutes = drills.reduce((s, d) => s + d.minutes, 0) || active.estimatedMinutes;
  const doneCount = drills.filter((d) => d.done).length;

  return (
    <div style={{ marginBottom: 16 }}>
      {sessions.length > 1 && (
        <div className="subtabs" role="tablist" aria-label="Practice sessions" style={{ marginBottom: 8 }}>
          {sessions.map((s) => (
            <button key={s.id} role="tab" aria-selected={s.id === activeId} onClick={() => setActiveId(s.id)}>
              {dayLabel(s.date)}
            </button>
          ))}
        </div>
      )}

      <div className="card" style={{ marginBottom: 12, borderLeft: `4px solid ${color}` }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
          <strong style={{ color: "var(--navy)", fontSize: 16 }}>{fullLabelFor(active.type)} practice</strong>
          <span className="text-dim" style={{ fontSize: 13 }}>{minutes ? `~${minutes} min` : ""}</span>
        </div>
        <div className="text-dim" style={{ fontSize: 12, marginTop: 2 }}>
          {dayLabel(active.date)} · {doneCount} of {drills.length} drills done
        </div>
        <div style={{ fontSize: 12, fontWeight: 600, marginTop: 4, color: sync === "error" ? "var(--danger)" : "var(--good)" }}>
          {sync === "saving"
            ? "Saving to your account…"
            : sync === "error"
            ? "Not saved to your account yet. Check your connection."
            : `✓ Saved to your account${savedAt ? ` · ${savedAt.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}` : ""}`}
        </div>
        {planned.map((line) => (
          <div key={line} className="text-dim" style={{ fontSize: 12, marginTop: 4 }}>
            {line}
          </div>
        ))}
      </div>

      {drills.length === 0 && (
        <div className="card" style={{ marginBottom: 12 }}>
          <strong>No drills yet</strong>
          <p className="text-dim" style={{ fontSize: 13, margin: "4px 0 8px" }}>
            This session was added without a plan. Have one built from your round notes and recent practice, or add your own drills below.
          </p>
          <button className="button-secondary" onClick={buildWithAi} disabled={building} style={{ width: "100%" }}>
            {building ? "Building drills…" : "Build drills (AI)"}
          </button>
          {buildError && <p style={{ color: "var(--danger)", fontSize: 12, margin: "6px 0 0" }}>{buildError}</p>}
        </div>
      )}

      {drills.map((d, i) => (
        <DrillCard key={i} index={i} drill={d} onPatch={(p) => patch(i, p)} />
      ))}

      <div className="card" style={{ marginBottom: 12, display: "flex", gap: 8 }}>
        <input
          placeholder="Add a drill (e.g. 50 yd wedges to a target)"
          aria-label="Add a drill"
          value={newName}
          maxLength={80}
          onChange={(e) => setNewName(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && addDrill()}
          style={{ flex: 1, padding: 6 }}
        />
        <button className="button-quiet" onClick={addDrill} disabled={!newName.trim() || drills.length >= 10}>
          Add
        </button>
      </div>

      <button className="button-primary" onClick={finish} disabled={finishing || doneCount === 0} style={{ width: "100%", marginTop: 8 }}>
        {finishing ? "Saving..." : "Finish practice"}
      </button>
      {doneCount === 0 && (
        <p className="text-dim" style={{ fontSize: 12, marginTop: 6 }}>
          Tick at least one drill (tap the circle) before finishing.
        </p>
      )}
    </div>
  );
}

function DrillCard({ index, drill, onPatch }: { index: number; drill: PlannedDrill; onPatch: (p: Partial<PlannedDrill>) => void }) {
  // Typed comment is held locally and saved when the box loses focus.
  const [comment, setComment] = useState(drill.comment);
  useEffect(() => setComment(drill.comment), [drill.comment]);

  return (
    <div className="card" style={{ marginBottom: 12 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
        <strong>{drill.name}</strong>
        <span className="text-dim" style={{ fontSize: 12 }}>{drill.minutes > 0 ? `${drill.minutes} min` : ""}</span>
      </div>
      {drill.detail && (
        <div className="text-dim" style={{ fontSize: 12, marginTop: 4, paddingBottom: 8, borderBottom: "1px solid var(--border)" }}>
          Plan: {drill.detail}
        </div>
      )}

      <div style={{ marginTop: 6 }}>
        <div className="text-dim" style={{ display: "grid", gridTemplateColumns: "24px 1fr 32px", gap: 8, fontSize: 11, padding: "4px 0" }}>
          <span />
          <span>How it went</span>
          <span />
        </div>
        <div style={{ padding: "6px 0" }}>
          <div style={{ display: "grid", gridTemplateColumns: "24px 1fr 32px", gap: 8, alignItems: "center" }}>
            <span className="text-dim" style={{ fontSize: 13 }}>{index + 1}</span>
            <input
              placeholder="e.g. 7-iron pulled left, 6/10 inside 10 ft"
              aria-label={`Comment on ${drill.name}`}
              value={comment}
              maxLength={500}
              onChange={(e) => setComment(e.target.value)}
              onBlur={() => comment.trim() !== drill.comment && onPatch({ comment: comment.trim() })}
              style={{ padding: 6, width: "100%", boxSizing: "border-box" }}
            />
            <button
              onClick={() => onPatch({ done: !drill.done })}
              aria-label={drill.done ? `Mark ${drill.name} not done` : `Mark ${drill.name} done`}
              aria-pressed={drill.done}
              style={{
                background: drill.done ? "var(--accent)" : "var(--border)",
                color: drill.done ? "var(--on-accent)" : "var(--text-dim)",
                border: "none",
                borderRadius: 6,
                height: 32,
                cursor: "pointer",
                fontWeight: 700,
              }}
            >
              {drill.done ? "✓" : "○"}
            </button>
          </div>

          <div style={{ display: "flex", alignItems: "center", gap: 4, marginTop: 4, marginLeft: 32 }}>
            <span className="text-dim" style={{ fontSize: 10, marginRight: 2 }}>Feel</span>
            {Array.from({ length: 10 }, (_, n) => n + 1).map((n) => (
              <button
                key={n}
                onClick={() => onPatch({ rating: drill.rating === n ? null : n })}
                aria-label={`Rate ${n} out of 10`}
                style={{
                  width: 20,
                  height: 20,
                  fontSize: 10,
                  padding: 0,
                  borderRadius: 4,
                  border: "none",
                  cursor: "pointer",
                  background: drill.rating === n ? "var(--accent)" : "var(--border)",
                  color: drill.rating === n ? "var(--on-accent)" : "var(--text-dim)",
                }}
              >
                {n}
              </button>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
