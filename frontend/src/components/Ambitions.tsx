import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { api, AmbitionsOverview, Sport, SportAmbitionInfo, SportProgress } from "../lib/api.js";
import { SPORT_LABELS, SPORT_TYPES } from "../lib/sports.js";
import Collapsible from "./Collapsible.js";

// Two parts, at the top of Progress → Goals:
// 1. "About you": a few sentences on who you are and what you want from sport.
//    Sports it mentions that aren't switched on yet are offered for switching on.
// 2. "Sport goals": a sentence or two per switched-on sport, shown beside your
//    progress in it over the last 90 days so you can review one against the other.

const TEXT_MAX = 600;
const STATEMENT_MAX = 300;
const REVIEW_AFTER_DAYS = 90;

export default function Ambitions() {
  const [data, setData] = useState<AmbitionsOverview | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => {
    api.getAmbitions().then(setData).catch((e) => setError(e.message));
  }, []);
  useEffect(load, [load]);

  if (error) return <p style={{ color: "var(--danger)", fontSize: 13 }}>{error}</p>;
  if (!data) return null;

  const activeSports = data.sports.filter((s) => s.active);

  return (
    <>
      <Collapsible title="About you and your ambitions" hint={data.ambitions ? "written" : "not yet"} rememberAs="progress-ambitions" defaultOpen={!data.ambitions}>
        <AboutYou data={data} onData={setData} />
      </Collapsible>

      <Collapsible
        title="Sport goals"
        hint={activeSports.length ? `${activeSports.filter((s) => s.statement).length} of ${activeSports.length} written` : undefined}
        rememberAs="progress-sport-goals"
        defaultOpen={activeSports.some((s) => !s.statement) || !!data.ambitions}
      >
        {activeSports.length === 0 ? (
          <div className="card" style={{ marginTop: 8 }}>
            <p style={{ margin: 0, fontSize: 14 }}>Switch a workout type on to write a goal for it.</p>
            <Link to="/settings#workout-types" className="button-secondary" style={{ display: "inline-block", marginTop: 8, textDecoration: "none" }}>
              Settings → Workout types
            </Link>
          </div>
        ) : (
          activeSports.map((s) => <SportGoal key={s.sport} info={s} onData={setData} />)
        )}
      </Collapsible>
    </>
  );
}

function AboutYou({ data, onData }: { data: AmbitionsOverview; onData: (d: AmbitionsOverview) => void }) {
  const [text, setText] = useState(data.ambitions ?? "");
  const [editing, setEditing] = useState(!data.ambitions);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [activating, setActivating] = useState<Sport | null>(null);

  async function save() {
    setBusy(true);
    setError(null);
    try {
      const next = await api.saveAmbitions(text);
      onData(next);
      setEditing(!next.ambitions);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }

  // Switches on every workout type of a sport, the same as ticking it under
  // Settings → Workout types.
  async function activate(sport: Sport) {
    setActivating(sport);
    setError(null);
    try {
      const { visibleSessionTypes } = await api.getPreferences();
      await api.updatePreferences([...new Set([...visibleSessionTypes, ...SPORT_TYPES[sport]])]);
      onData(await api.getAmbitions());
    } catch (e: any) {
      setError(e.message);
    } finally {
      setActivating(null);
    }
  }

  return (
    <div className="card" style={{ marginTop: 8 }}>
      {editing ? (
        <>
          <label style={{ fontSize: 13 }}>
            A few sentences about you and what you want from sport or exercise
            <textarea
              value={text}
              onChange={(e) => setText(e.target.value)}
              rows={5}
              maxLength={TEXT_MAX}
              placeholder="For example: I'm in my fifties, play golf most weekends and want to get my handicap down. I'd like to stay strong enough to keep playing for years, and build up to a half marathon."
              style={{ width: "100%", boxSizing: "border-box", padding: 10, marginTop: 4, lineHeight: 1.4 }}
            />
          </label>
          <div className="text-dim" style={{ fontSize: 12, marginTop: 4 }}>
            {text.length}/{TEXT_MAX}. Keep it to sport and training: this isn't the place for medical details. It stays in your account and isn't sent to the AI.
          </div>
          {error && <div style={{ color: "var(--danger)", fontSize: 13, marginTop: 6 }}>{error}</div>}
          <div style={{ display: "flex", gap: 8, marginTop: 8 }}>
            <button className="button-primary" onClick={save} disabled={busy || text.trim() === (data.ambitions ?? "")}>
              {busy ? "Saving…" : "Save"}
            </button>
            {data.ambitions && (
              <button
                className="button-quiet"
                onClick={() => {
                  setText(data.ambitions ?? "");
                  setEditing(false);
                }}
              >
                Cancel
              </button>
            )}
          </div>
        </>
      ) : (
        <>
          <p style={{ margin: 0, fontSize: 14, lineHeight: 1.5, whiteSpace: "pre-wrap" }}>{data.ambitions}</p>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginTop: 8 }}>
            <span className="text-dim" style={{ fontSize: 12 }}>
              {data.ambitionsUpdatedAt ? `Written ${new Date(data.ambitionsUpdatedAt).toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" })}` : ""}
            </span>
            <button className="button-quiet" onClick={() => setEditing(true)}>
              Edit
            </button>
          </div>
        </>
      )}

      {!editing && data.suggestions.length > 0 && (
        <div style={{ marginTop: 12, padding: 10, borderRadius: 10, background: "var(--surface-2)" }}>
          <div style={{ fontSize: 14, fontWeight: 600 }}>
            {data.suggestions.length === 1 ? "This sounds like it's about a workout type that's switched off" : "These sound like workout types that are switched off"}
          </div>
          <div className="text-dim" style={{ fontSize: 13, margin: "4px 0 8px" }}>
            Switch them on to plan and log them, and to write a goal for each.
          </div>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
            {data.suggestions.map((sport) => (
              <button key={sport} className="button-primary" style={{ padding: "8px 12px", fontSize: 13 }} onClick={() => activate(sport)} disabled={activating !== null}>
                {activating === sport ? "Switching on…" : `Switch on ${SPORT_LABELS[sport]}`}
              </button>
            ))}
          </div>
          <Link to="/settings#workout-types" style={{ display: "inline-block", marginTop: 8, fontSize: 13, color: "var(--accent)" }}>
            Or choose in Settings → Workout types
          </Link>
          {error && <div style={{ color: "var(--danger)", fontSize: 13, marginTop: 6 }}>{error}</div>}
        </div>
      )}
    </div>
  );
}

function hoursText(minutes: number): string {
  if (minutes < 60) return `${minutes} min`;
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return m ? `${h} h ${m} min` : `${h} h`;
}

function progressLines(sport: Sport, p: SportProgress): string[] {
  const noun = sport === "STRENGTH" ? "workout" : "session";
  const lines: string[] = [];
  const trend =
    p.sessions > p.previousSessions ? `up from ${p.previousSessions} in the 90 days before` : p.sessions < p.previousSessions ? `down from ${p.previousSessions} in the 90 days before` : p.previousSessions > 0 ? "the same as the 90 days before" : "";
  lines.push(
    p.sessions === 0
      ? `No ${noun}s ${sport === "STRENGTH" ? "logged" : "completed"} in the last ${p.days} days${p.previousSessions ? ` (${p.previousSessions} in the 90 days before)` : ""}.`
      : `${p.sessions} ${noun}${p.sessions === 1 ? "" : "s"} ${sport === "STRENGTH" ? "logged" : "completed"} in the last ${p.days} days, about ${p.perWeek} a week${trend ? `, ${trend}` : ""}.`,
  );
  if (p.minutes > 0) lines.push(`About ${hoursText(p.minutes)} of training.`);
  if (sport === "GOLF" && p.rounds !== undefined) {
    const bits = [`${p.rounds} round${p.rounds === 1 ? "" : "s"} played`];
    if (p.bestScore18 != null) bits.push(`best 18-hole score ${p.bestScore18}`);
    if (p.averageScore18 != null) bits.push(`average ${p.averageScore18}`);
    lines.push(`${bits.join(", ")}.`);
  }
  return lines;
}

function SportGoal({ info, onData }: { info: SportAmbitionInfo; onData: (d: AmbitionsOverview) => void }) {
  const [text, setText] = useState(info.statement ?? "");
  const [editing, setEditing] = useState(!info.statement);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function save() {
    setBusy(true);
    setError(null);
    try {
      const next = await api.saveSportStatement(info.sport, text);
      onData(next);
      setEditing(!text.trim());
    } catch (e: any) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }

  const ageDays = info.statementUpdatedAt ? Math.floor((Date.now() - new Date(info.statementUpdatedAt).getTime()) / 86400000) : 0;
  const dueForReview = !!info.statement && ageDays >= REVIEW_AFTER_DAYS;

  return (
    <div className="card" style={{ marginTop: 8 }}>
      <div style={{ fontWeight: 600, color: "var(--navy)", marginBottom: 6 }}>{SPORT_LABELS[info.sport]}</div>

      {editing ? (
        <>
          <label style={{ fontSize: 13 }}>
            What do you want from {SPORT_LABELS[info.sport].toLowerCase()}? A sentence or two.
            <textarea
              value={text}
              onChange={(e) => setText(e.target.value)}
              rows={3}
              maxLength={STATEMENT_MAX}
              placeholder={PLACEHOLDERS[info.sport]}
              style={{ width: "100%", boxSizing: "border-box", padding: 10, marginTop: 4, lineHeight: 1.4 }}
            />
          </label>
          <div className="text-dim" style={{ fontSize: 12, marginTop: 4 }}>
            {text.length}/{STATEMENT_MAX}
          </div>
          {error && <div style={{ color: "var(--danger)", fontSize: 13, marginTop: 6 }}>{error}</div>}
          <div style={{ display: "flex", gap: 8, marginTop: 8 }}>
            <button className="button-primary" onClick={save} disabled={busy || text.trim() === (info.statement ?? "")}>
              {busy ? "Saving…" : "Save"}
            </button>
            {info.statement && (
              <button
                className="button-quiet"
                onClick={() => {
                  setText(info.statement ?? "");
                  setEditing(false);
                }}
              >
                Cancel
              </button>
            )}
          </div>
        </>
      ) : (
        <>
          <p style={{ margin: 0, fontSize: 14, lineHeight: 1.5, whiteSpace: "pre-wrap" }}>“{info.statement}”</p>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginTop: 6 }}>
            <span className="text-dim" style={{ fontSize: 12 }}>
              Written {new Date(info.statementUpdatedAt!).toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" })}
            </span>
            <button className="button-quiet" onClick={() => setEditing(true)}>
              Edit
            </button>
          </div>
          {dueForReview && (
            <div className="chip chip-sun" style={{ marginTop: 8, display: "inline-block" }}>
              Written over 3 months ago. Still the goal?
            </div>
          )}
        </>
      )}

      {info.progress && (
        <div style={{ marginTop: 10, paddingTop: 10, borderTop: "1px solid var(--border)" }}>
          <div className="text-dim" style={{ fontSize: 12, marginBottom: 4 }}>How it's going</div>
          {progressLines(info.sport, info.progress).map((line) => (
            <div key={line} style={{ fontSize: 13, lineHeight: 1.5 }}>
              {line}
            </div>
          ))}
          {info.sport === "GOLF" && (
            <Link to="/log?view=GOLF" style={{ display: "inline-block", marginTop: 6, fontSize: 13, color: "var(--accent)" }}>
              Rounds and quarterly goal
            </Link>
          )}
        </div>
      )}
    </div>
  );
}

const PLACEHOLDERS: Record<Sport, string> = {
  STRENGTH: "For example: Get stronger on the big lifts without hurting my back, and train three times a week all year.",
  GOLF: "For example: Break 90 by next summer and play at least eight rounds a quarter.",
  RUN: "For example: Build up to a half marathon in the spring without injury.",
  WALK: "For example: Walk most days and manage a long hill walk every month.",
  CYCLING: "For example: Ride 50 miles comfortably by the summer.",
  CYCLING_TURBO: "For example: Keep a cycling base going through winter with two turbo sessions a week.",
  SWIM: "For example: Swim a steady kilometre without stopping.",
};
