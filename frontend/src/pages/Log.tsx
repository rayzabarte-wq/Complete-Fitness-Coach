import { useEffect, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { api, DailyWorkout, MovementPattern, PlannedSession, SessionType, StepsResponse, TodaySuggestion } from "../lib/api.js";
import { usePlan } from "../lib/planContext.js";
import { formatLocalDateKey } from "../lib/location.js";
import { ACTIVITY_COLORS, ACTIVITY_LABELS, ActivityKey, activityForSessionType, FOCUS_LABELS } from "../lib/activity.js";
import { fullLabelFor } from "../lib/sessionTypes.js";
import LogWorkout, { FeedbackPrompt } from "./LogWorkout.js";

// The Log tab. "Log" behaves differently per sport:
// - Strength is ACTIVE: build a session, then enter it live, set by set.
// - Steps, and the connector sports (run, cycling, walk, swim, golf rounds),
//   are PASSIVE: data arrives from Apple Health / Strava and is just shown.
// Only Strength and Steps show by default (strength-only first release);
// the others appear when switched on in Settings → Workout types.

type LogView = "STRENGTH" | "STEPS" | "RUN" | "CYCLING" | "WALK" | "SWIM" | "GOLF";

const PASSIVE_SPORTS: { key: Exclude<LogView, "STRENGTH" | "STEPS">; matches: (t: SessionType) => boolean }[] = [
  { key: "RUN", matches: (t) => t.startsWith("RUN_") },
  { key: "CYCLING", matches: (t) => t.startsWith("CYCLING") },
  { key: "WALK", matches: (t) => t.startsWith("WALK_") },
  { key: "SWIM", matches: (t) => t === "SWIM" },
  { key: "GOLF", matches: (t) => t.startsWith("GOLF_") },
];

export default function Log() {
  const [visibleTypes, setVisibleTypes] = useState<SessionType[]>(["STRENGTH"]);
  const [params] = useSearchParams();
  const [view, setView] = useState<LogView>((params.get("view") as LogView) || "STRENGTH");

  useEffect(() => {
    api
      .getPreferences()
      .then((p) => setVisibleTypes(p.visibleSessionTypes))
      .catch(() => setVisibleTypes(["STRENGTH"]));
  }, []);

  const views: LogView[] = ["STRENGTH", "STEPS", ...PASSIVE_SPORTS.filter((s) => visibleTypes.some(s.matches)).map((s) => s.key)];

  return (
    <div>
      {views.length > 1 && (
        <div className="subtabs" role="tablist" aria-label="What to log">
          {views.map((v) => (
            <button key={v} role="tab" aria-selected={view === v} onClick={() => setView(v)}>
              <span className="swatch" style={{ background: ACTIVITY_COLORS[v as ActivityKey], marginRight: 6, verticalAlign: "-1px" }} />
              {ACTIVITY_LABELS[v as ActivityKey]}
            </button>
          ))}
        </div>
      )}
      {view === "STRENGTH" && <StrengthLog />}
      {view === "STEPS" && <StepsLog />}
      {view !== "STRENGTH" && view !== "STEPS" && <PassiveSportLog sport={view} />}
    </div>
  );
}

// --- Strength (active) ------------------------------------------------------

const ALL_FOCUSES: MovementPattern[] = ["PUSH", "PULL", "LEGS", "UPPER", "LOWER", "FULL_BODY", "CORE"];

function StrengthLog() {
  const { today: todaysWorkout, plan, loaded, date, setBuilt, openWorkout } = usePlan();
  const [params, setParams] = useSearchParams();
  const [today, setToday] = useState<TodaySuggestion | null>(null);
  const [loading, setLoading] = useState<MovementPattern | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [showAll, setShowAll] = useState(false);
  // Set once a workout is saved, to ask how it went. Kept here rather than
  // in LogWorkout, which unmounts as soon as the workout ends.
  const [feedbackSessionId, setFeedbackSessionId] = useState<string | null>(null);
  // A focus waiting for the person to confirm replacing today's workout.
  const [confirmReplace, setConfirmReplace] = useState<{ focus: MovementPattern; plannedId: string | null } | null>(null);

  // Calls the AI. Only reached from an explicit Build/Regenerate tap (or a
  // calendar start when nothing's been built today) — never on page load.
  async function build(focus: MovementPattern, plannedId: string | null) {
    setConfirmReplace(null);
    setLoading(focus);
    setError(null);
    try {
      setBuilt(await api.generatePlan(focus, date, plannedId));
    } catch (err: any) {
      setError(err.message ?? "Failed to build the workout");
    } finally {
      setLoading(null);
    }
  }

  // Building when today's workout already exists replaces it — ask first.
  function requestBuild(focus: MovementPattern, plannedId: string | null = null) {
    if (todaysWorkout) setConfirmReplace({ focus, plannedId });
    else build(focus, plannedId);
  }

  // Started from a calendar entry: /log?focus=UPPER&planned=<id>. Waits for
  // today's workout to load: if one is already built for that focus it's
  // opened (no AI call); if a different one exists, the person chooses.
  useEffect(() => {
    if (!loaded) return;
    const focus = params.get("focus") as MovementPattern | null;
    if (!focus || !ALL_FOCUSES.includes(focus)) return;
    const planned = params.get("planned");
    setParams({}, { replace: true });
    if (!todaysWorkout) build(focus, planned);
    else if (todaysWorkout.movementPattern === focus && !todaysWorkout.savedSessionId) openWorkout();
    else setConfirmReplace({ focus, plannedId: planned });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loaded]);

  useEffect(() => {
    if (!plan) api.getToday().then(setToday).catch(() => setToday(null));
  }, [plan, todaysWorkout?.savedSessionId]);

  if (feedbackSessionId) {
    return <FeedbackPrompt sessionId={feedbackSessionId} onDone={() => setFeedbackSessionId(null)} />;
  }
  if (plan) return <LogWorkout onSaved={setFeedbackSessionId} />;
  if (!loaded && loading === null) return <p className="text-dim">Loading…</p>;

  const rotation = today ? [...new Set(today.split.rotation)] : [];
  const others = ALL_FOCUSES.filter((f) => !rotation.includes(f));

  return (
    <div>
      {todaysWorkout && (
        <TodaysWorkoutCard
          workout={todaysWorkout}
          busy={loading !== null}
          onOpen={openWorkout}
          onRegenerate={() => setConfirmReplace({ focus: todaysWorkout.movementPattern, plannedId: todaysWorkout.plannedSessionId })}
        />
      )}

      {confirmReplace && todaysWorkout && (
        <div className="card" style={{ borderLeft: "4px solid var(--accent)" }}>
          <strong style={{ color: "var(--navy)" }}>
            {confirmReplace.focus === todaysWorkout.movementPattern
              ? `Regenerate today's ${FOCUS_LABELS[confirmReplace.focus]} workout?`
              : `Replace today's ${FOCUS_LABELS[todaysWorkout.movementPattern]} workout with ${FOCUS_LABELS[confirmReplace.focus]}?`}
          </strong>
          <p className="text-dim" style={{ fontSize: 13, margin: "6px 0 10px" }}>
            The AI builds a new workout for today. It replaces the current one on all your devices
            {todaysWorkout.savedSessionId ? " (the session you already saved stays in your history)." : ", along with anything logged in it but not saved."}
          </p>
          <div style={{ display: "flex", gap: 8 }}>
            <button className="button-primary" style={{ flex: 1 }} onClick={() => build(confirmReplace.focus, confirmReplace.plannedId)}>
              Yes, build a new one
            </button>
            <button className="button-secondary" style={{ flex: 1 }} onClick={() => setConfirmReplace(null)}>
              Keep today's
            </button>
          </div>
        </div>
      )}

      {loading && (
        <div className="card">
          <p style={{ margin: 0 }}>Building your {FOCUS_LABELS[loading]} session…</p>
          <p className="text-dim" style={{ fontSize: 12, margin: "4px 0 0" }}>This usually takes 10-30 seconds.</p>
        </div>
      )}

      {!todaysWorkout && (
        <div className="card" style={{ borderLeft: `4px solid ${ACTIVITY_COLORS.STRENGTH}` }}>
          <div className="text-dim" style={{ fontSize: 12 }}>{today ? `Your split: ${today.split.label}` : "Loading your split…"}</div>
          {today && (
            <>
              <div style={{ fontSize: 20, fontWeight: 700, color: "var(--navy)", marginTop: 4 }}>
                {today.suggestedFocus ? `Today: ${FOCUS_LABELS[today.suggestedFocus]}` : "Today: rest"}
              </div>
              <p className="text-dim" style={{ fontSize: 13, margin: "4px 0 10px" }}>
                {today.reason}
              </p>
              {today.suggestedFocus && (
                <button className="button-primary" style={{ width: "100%" }} disabled={loading !== null} onClick={() => requestBuild(today.suggestedFocus!)}>
                  {`Build ${FOCUS_LABELS[today.suggestedFocus]} session`}
                </button>
              )}
            </>
          )}
        </div>
      )}

      <div className="section-title">{todaysWorkout ? "Or build a different session instead" : "Or choose a session"}</div>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
        {[...rotation, ...(showAll ? others : [])].map((f) => (
          <button key={f} className="button-secondary" disabled={loading !== null} onClick={() => requestBuild(f)} style={{ opacity: loading && loading !== f ? 0.6 : 1 }}>
            {loading === f ? "Building…" : FOCUS_LABELS[f]}
          </button>
        ))}
      </div>
      {!showAll && (
        <button className="button-quiet" style={{ marginTop: 8 }} onClick={() => setShowAll(true)}>
          Other session types
        </button>
      )}
      {error && <p style={{ color: "var(--danger)" }}>{error}</p>}

      <RecentStrength />
    </div>
  );
}

/** Today's already-built workout: open it (no AI call) or regenerate it. */
function TodaysWorkoutCard({
  workout,
  busy,
  onOpen,
  onRegenerate,
}: {
  workout: DailyWorkout;
  busy: boolean;
  onOpen: () => void;
  onRegenerate: () => void;
}) {
  const label = FOCUS_LABELS[workout.movementPattern] ?? workout.movementPattern;
  const built = new Date(workout.createdAt).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
  const setsLogged = workout.progress
    ? Object.values(workout.progress.rows).reduce((n, rows) => n + rows.filter((r) => r.logged).length, 0)
    : 0;
  const saved = !!workout.savedSessionId;

  return (
    <div className="card" style={{ borderLeft: `4px solid ${ACTIVITY_COLORS.STRENGTH}` }}>
      <div className="text-dim" style={{ fontSize: 12 }}>Today's workout · built at {built}</div>
      <div style={{ fontSize: 20, fontWeight: 700, color: "var(--navy)", marginTop: 4 }}>
        {label} day {saved && "✓"}
      </div>
      <p className="text-dim" style={{ fontSize: 13, margin: "4px 0 10px" }}>
        {workout.exercises.length} exercises · ~{workout.estimatedMinutes} min
        {saved ? " · saved to your history" : setsLogged > 0 ? ` · ${setsLogged} set${setsLogged === 1 ? "" : "s"} logged so far` : ""}
      </p>
      {!saved && (
        <button className="button-primary" style={{ width: "100%" }} disabled={busy} onClick={onOpen}>
          {setsLogged > 0 ? "Continue today's workout" : "Open today's workout"}
        </button>
      )}
      <button className="button-quiet" style={{ marginTop: 8 }} disabled={busy} onClick={onRegenerate}>
        Regenerate {label} workout
      </button>
    </div>
  );
}

interface SessionWithSets {
  id: string;
  date: string;
  focus: MovementPattern | null;
  sets: { id: string; weightLb: number; bandLevel: string | null; reps: number; targetReps: number; rpe: number | null; exercise: { name: string } }[];
}

function RecentStrength() {
  const [sessions, setSessions] = useState<SessionWithSets[] | null>(null);
  useEffect(() => {
    api.getRecentSessions(10).then((d) => setSessions(d as SessionWithSets[]));
  }, []);
  if (!sessions) return null;
  return (
    <>
      <div className="section-title">Recent sessions</div>
      {sessions.length === 0 && <p className="text-dim" style={{ fontSize: 13 }}>Nothing logged yet.</p>}
      {sessions.map((session) => {
        const byExercise = new Map<string, string[]>();
        for (const s of session.sets) {
          const load = s.bandLevel ? `${s.bandLevel} band` : s.weightLb > 0 ? `${s.weightLb}lb` : "BW";
          byExercise.set(s.exercise.name, [...(byExercise.get(s.exercise.name) ?? []), `${load}×${s.reps}`]);
        }
        return (
          <details key={session.id} className="card" style={{ marginBottom: 8, padding: 12 }}>
            <summary style={{ cursor: "pointer", fontSize: 14 }}>
              <strong>{new Date(session.date).toLocaleDateString(undefined, { weekday: "short", day: "numeric", month: "short" })}</strong>
              <span className="text-dim">
                {" "}
                · {session.focus ? FOCUS_LABELS[session.focus] : "Strength"} · {session.sets.length} sets
              </span>
            </summary>
            {[...byExercise.entries()].map(([name, sets]) => (
              <div key={name} className="text-dim" style={{ fontSize: 13, padding: "3px 0" }}>
                {name}: {sets.join(", ")}
              </div>
            ))}
          </details>
        );
      })}
    </>
  );
}

// --- Steps (passive) --------------------------------------------------------

function StepsLog() {
  const [data, setData] = useState<StepsResponse | null>(null);
  useEffect(() => {
    const t = new Date();
    api.getSteps(formatLocalDateKey(new Date(t.getFullYear(), t.getMonth(), t.getDate() - 13)), formatLocalDateKey(new Date(t.getFullYear(), t.getMonth(), t.getDate() + 1))).then(setData);
  }, []);
  if (!data) return <p className="text-dim">Loading…</p>;
  return (
    <div>
      <p className="text-dim" style={{ fontSize: 13, marginTop: 0 }}>
        Imported from Apple Health each day. Nothing to enter. Trends and your average goal are under{" "}
        <Link to="/progress" style={{ color: "var(--accent)" }}>
          Progress → Steps
        </Link>
        .
      </p>
      {data.days.length === 0 && (
        <div className="card">
          <p style={{ margin: 0, fontSize: 14 }}>No steps imported yet.</p>
          <p className="text-dim" style={{ fontSize: 13, marginBottom: 0 }}>
            Set up the Apple Health shortcut in{" "}
            <Link to="/settings" style={{ color: "var(--accent)" }}>
              Settings → Data import
            </Link>
            .
          </p>
        </div>
      )}
      {[...data.days].reverse().map((d) => (
        <div key={d.date} className="card" style={{ marginBottom: 6, padding: "10px 12px", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <span style={{ fontSize: 14 }}>
            <span className="swatch" style={{ background: ACTIVITY_COLORS.STEPS, marginRight: 8 }} />
            {new Date(`${d.date}T12:00`).toLocaleDateString(undefined, { weekday: "short", day: "numeric", month: "short" })}
          </span>
          <span style={{ fontSize: 14, fontWeight: 600 }}>
            {d.steps.toLocaleString()}
            {d.hitGoal === true && <span style={{ color: "var(--good)", marginLeft: 6 }}>✓</span>}
          </span>
        </div>
      ))}
    </div>
  );
}

// --- Connector sports (passive) ---------------------------------------------

function PassiveSportLog({ sport }: { sport: Exclude<LogView, "STRENGTH" | "STEPS"> }) {
  const [sessions, setSessions] = useState<PlannedSession[] | null>(null);
  const matcher = PASSIVE_SPORTS.find((s) => s.key === sport)!.matches;
  useEffect(() => {
    const from = new Date(Date.now() - 60 * 86400_000).toISOString();
    api.getPlannedSessions(from, new Date().toISOString()).then((all) => setSessions(all.filter((s) => matcher(s.type)).reverse()));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sport]);

  return (
    <div>
      <p className="text-dim" style={{ fontSize: 13, marginTop: 0 }}>
        {sport === "GOLF"
          ? "Rounds come in from Strava (via Garmin) and are shown as they arrived. Range, short-game and putting practice are planned and logged from the calendar."
          : "Imported from Strava (via Garmin) and shown as it arrived. Nothing to enter here."}
      </p>
      {sessions === null && <p className="text-dim">Loading…</p>}
      {sessions?.length === 0 && <p className="text-dim" style={{ fontSize: 13 }}>Nothing in the last 60 days.</p>}
      {sessions?.map((s) => (
        <div key={s.id} className="card" style={{ marginBottom: 6, padding: "10px 12px" }}>
          <div style={{ display: "flex", justifyContent: "space-between", fontSize: 14 }}>
            <span>
              <span className="swatch" style={{ background: ACTIVITY_COLORS[activityForSessionType(s.type)], marginRight: 8 }} />
              {fullLabelFor(s.type)}
            </span>
            <span className="text-dim">{new Date(s.date).toLocaleDateString(undefined, { day: "numeric", month: "short" })}</span>
          </div>
          <div className="text-dim" style={{ fontSize: 12, marginTop: 2 }}>
            {s.actualMinutes != null ? `${s.actualMinutes} min${s.actualSource === "STRAVA" ? " · from Strava" : ""}` : s.completed ? "Done" : "Not synced yet"}
          </div>
        </div>
      ))}
    </div>
  );
}
