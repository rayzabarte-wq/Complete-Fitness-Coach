import { useCallback, useEffect, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { api, DailyWorkout, SavedWorkout, MovementPattern, PlannedSession, SessionType, StepsResponse, TodaySuggestion } from "../lib/api.js";
import { usePlan, loggedSets } from "../lib/planContext.js";
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
  const { today: todaysWorkout, plan, loaded, loadFailed, retryLoad, date, setBuilt, adopt, openWorkout } = usePlan();
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

  // Every workout built in the last 30 days (and any scheduled ahead): what
  // makes a missed or past workout recallable. Loading it never calls the AI.
  const [saved, setSaved] = useState<SavedWorkout[]>([]);
  const [reusing, setReusing] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  // A saved workout waiting for the person to confirm replacing a day's workout.
  const [confirmReuse, setConfirmReuse] = useState<{ item: SavedWorkout; date: string; replaceWorkoutId: string } | null>(null);

  const loadSaved = useCallback(() => {
    api.getSavedWorkouts(date).then(setSaved).catch(() => {});
  }, [date]);

  useEffect(() => {
    if (loaded) loadSaved();
  }, [loaded, loadSaved, todaysWorkout?.workoutId, todaysWorkout?.savedSessionId]);

  useEffect(() => {
    const onVisible = () => {
      if (document.visibilityState === "visible") loadSaved();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => document.removeEventListener("visibilitychange", onVisible);
  }, [loadSaved]);

  // Uses a saved workout on a day by copying it: NO AI call. For today it
  // opens straight away; for another day it's scheduled and will be that
  // day's workout on every device.
  async function reuse(item: SavedWorkout, targetDate: string, replaceWorkoutId: string | null = null) {
    setConfirmReuse(null);
    setReusing(item.id);
    setError(null);
    setNotice(null);
    try {
      const result = await api.reuseWorkout(item.id, targetDate, replaceWorkoutId);
      if (targetDate === date) setBuilt(result);
      else setNotice(`Scheduled for ${formatDay(targetDate, date)}. It'll be that day's workout on all your devices. No AI call needed.`);
      loadSaved();
    } catch (err: any) {
      if (err.status === 409 && err.body?.existing) {
        // That day has a workout this device didn't know about: keep it.
        if (targetDate === date) adopt(err.body.existing);
        setNotice(`${formatDay(targetDate, date)} already had a workout saved, so nothing was replaced.`);
        loadSaved();
      } else {
        setError(err.message ?? "Couldn't use that workout");
      }
    } finally {
      setReusing(null);
    }
  }

  // Replacing a day that already has a workout asks first.
  function requestReuse(item: SavedWorkout, targetDate: string) {
    const existing = targetDate === date ? todaysWorkout : saved.find((w) => w.date === targetDate);
    if (existing) setConfirmReuse({ item, date: targetDate, replaceWorkoutId: existing.workoutId });
    else reuse(item, targetDate);
  }

  // Calls the AI. Only reached from an explicit Build/Regenerate tap (or a
  // calendar start when nothing's been built today) — never on page load.
  async function build(focus: MovementPattern, plannedId: string | null) {
    setConfirmReplace(null);
    setLoading(focus);
    setError(null);
    try {
      // Only replaces the workout this device knows about and the person
      // agreed to replace. If the server has a different one (this device
      // didn't know), it answers 409 and we show that one instead.
      setBuilt(await api.generatePlan(focus, date, plannedId, todaysWorkout?.workoutId ?? null));
    } catch (err: any) {
      if (err.status === 409 && err.body?.existing) {
        adopt(err.body.existing);
        setNotice("You already had a workout saved for today, so I opened it instead of building a new one. Nothing was replaced.");
      } else {
        setError(err.message ?? "Failed to build the workout");
      }
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
  if (plan) return <LogWorkout onSaved={setFeedbackSessionId} notice={notice} />;
  if (!loaded) {
    if (loadFailed) {
      // We couldn't reach the server, so we DON'T KNOW whether today already
      // has a workout. Offering to build one here is how a saved workout got
      // replaced, so don't offer it until we can check.
      return (
        <div className="card" style={{ borderLeft: "4px solid var(--accent)" }}>
          <strong style={{ color: "var(--navy)" }}>Couldn't check for today's workout</strong>
          <p className="text-dim" style={{ fontSize: 13, margin: "6px 0 10px" }}>
            This looks like a connection problem. Anything you've saved is safe on your account. I won't offer to build a new workout until
            I can check, so nothing gets replaced by mistake.
          </p>
          <button className="button-primary" style={{ width: "100%" }} onClick={retryLoad}>
            Try again
          </button>
        </div>
      );
    }
    return <p className="text-dim">Loading…</p>;
  }

  const rotation = today ? [...new Set(today.split.rotation)] : [];
  const others = ALL_FOCUSES.filter((f) => !rotation.includes(f));
  // The most recent missed workout that matches what today's split calls for.
  const missedMatch = today?.suggestedFocus
    ? saved.find((w) => w.status === "MISSED" && w.movementPattern === today.suggestedFocus) ?? null
    : null;

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
          {!todaysWorkout.savedSessionId && loggedSets(todaysWorkout) > 0 && (
            <p style={{ fontSize: 13, fontWeight: 600, color: "var(--danger)", margin: "0 0 10px" }}>
              ⚠ You've logged {loggedSets(todaysWorkout)} set{loggedSets(todaysWorkout) === 1 ? "" : "s"} in today's workout. Replacing it throws them away.
            </p>
          )}
          <div style={{ display: "flex", gap: 8 }}>
            <button className="button-primary" style={{ flex: 1 }} onClick={() => build(confirmReplace.focus, confirmReplace.plannedId)}>
              {!todaysWorkout.savedSessionId && loggedSets(todaysWorkout) > 0 ? "Yes, discard my sets" : "Yes, build a new one"}
            </button>
            <button className="button-secondary" style={{ flex: 1 }} onClick={() => setConfirmReplace(null)}>
              Keep today's
            </button>
          </div>
        </div>
      )}

      {confirmReuse && (
        <div className="card" style={{ borderLeft: "4px solid var(--accent)" }}>
          <strong style={{ color: "var(--navy)" }}>
            Use the saved {FOCUS_LABELS[confirmReuse.item.movementPattern]} workout from {formatDay(confirmReuse.item.date, date)} on{" "}
            {formatDay(confirmReuse.date, date)}?
          </strong>
          <p className="text-dim" style={{ fontSize: 13, margin: "6px 0 10px" }}>
            That day already has a workout, which this replaces (anything already saved to your history stays there). It copies the saved
            workout, so no AI call is made.
          </p>
          {confirmReuse.date === date && todaysWorkout && !todaysWorkout.savedSessionId && loggedSets(todaysWorkout) > 0 && (
            <p style={{ fontSize: 13, fontWeight: 600, color: "var(--danger)", margin: "0 0 10px" }}>
              ⚠ You've logged {loggedSets(todaysWorkout)} set{loggedSets(todaysWorkout) === 1 ? "" : "s"} in today's workout. Replacing it throws them away.
            </p>
          )}
          <div style={{ display: "flex", gap: 8 }}>
            <button className="button-primary" style={{ flex: 1 }} onClick={() => reuse(confirmReuse.item, confirmReuse.date, confirmReuse.replaceWorkoutId)}>
              Yes, use it
            </button>
            <button className="button-secondary" style={{ flex: 1 }} onClick={() => setConfirmReuse(null)}>
              Cancel
            </button>
          </div>
        </div>
      )}

      {notice && (
        <div className="card" style={{ borderLeft: "4px solid var(--good)" }}>
          <p style={{ margin: 0, fontSize: 13 }}>✓ {notice}</p>
        </div>
      )}

      {loading && (
        <div className="card">
          <p style={{ margin: 0 }}>Building your {FOCUS_LABELS[loading]} session…</p>
          <p className="text-dim" style={{ fontSize: 12, margin: "4px 0 0" }}>This usually takes 10-30 seconds.</p>
        </div>
      )}

      {!todaysWorkout && missedMatch && (
        <div className="card" style={{ borderLeft: "4px solid var(--accent)" }}>
          <strong style={{ color: "var(--navy)" }}>
            You missed {FOCUS_LABELS[missedMatch.movementPattern]} on {formatDay(missedMatch.date, date)}
          </strong>
          <p className="text-dim" style={{ fontSize: 13, margin: "6px 0 10px" }}>
            {missedMatch.exerciseCount} exercises · ~{missedMatch.estimatedMinutes} min. It's still saved on your account, so use it today
            instead of building a new one. No AI call.
          </p>
          <button className="button-primary" style={{ width: "100%" }} disabled={reusing !== null || loading !== null} onClick={() => requestReuse(missedMatch, date)}>
            {reusing === missedMatch.id ? "Opening…" : `Use the missed ${FOCUS_LABELS[missedMatch.movementPattern]} workout today`}
          </button>
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

      <SavedWorkouts items={saved.filter((w) => w.status !== "TODAY")} today={date} busy={reusing !== null || loading !== null} onUse={requestReuse} />

      <RecentStrength />
    </div>
  );
}

const FOCUS_LABEL = (f: MovementPattern) => FOCUS_LABELS[f] ?? f;

/** "Today (Tue, Oct 13)", "Yesterday (…)", "Tomorrow (…)" or "Mon, Oct 12". */
function formatDay(key: string, todayKey: string): string {
  const parse = (k: string) => {
    const [y, m, d] = k.split("-").map(Number);
    return new Date(y, m - 1, d);
  };
  const day = parse(key);
  const label = day.toLocaleDateString([], { weekday: "short", month: "short", day: "numeric" });
  const diff = Math.round((day.getTime() - parse(todayKey).getTime()) / 86400000);
  if (diff === 0) return `Today (${label})`;
  if (diff === -1) return `Yesterday (${label})`;
  if (diff === 1) return `Tomorrow (${label})`;
  return label;
}

function tomorrowKey(todayKey: string): string {
  const [y, m, d] = todayKey.split("-").map(Number);
  return formatLocalDateKey(new Date(y, m - 1, d + 1));
}

const BADGES: Record<SavedWorkout["status"], { label: string; bg: string; color: string }> = {
  TODAY: { label: "Today", bg: "#e6edf7", color: "var(--navy)" },
  DONE: { label: "Done ✓", bg: "#e3f1ea", color: "var(--good)" },
  MISSED: { label: "Missed", bg: "var(--accent-soft)", color: "var(--accent)" },
  SCHEDULED: { label: "Scheduled", bg: "#e6edf7", color: "var(--navy)" },
  MOVED: { label: "Moved", bg: "#eceae4", color: "var(--text-dim)" },
};

/** Workouts built on earlier days (or scheduled ahead), newest first. Any of
 * them can be used again today or on another day by copying it, so a missed
 * session doesn't need another AI call. */
function SavedWorkouts({
  items,
  today,
  busy,
  onUse,
}: {
  items: SavedWorkout[];
  today: string;
  busy: boolean;
  onUse: (item: SavedWorkout, date: string) => void;
}) {
  const [showAll, setShowAll] = useState(false);
  const [pickerFor, setPickerFor] = useState<string | null>(null);
  const [picked, setPicked] = useState("");
  if (items.length === 0) return null;

  const shown = showAll ? items : items.slice(0, 5);
  const earliest = tomorrowKey(today);

  return (
    <>
      <div className="section-title">Saved workouts</div>
      <div className="card">
        <p className="text-dim" style={{ fontSize: 12, margin: "0 0 8px" }}>
          Every workout you've built is saved on your account. Using one again copies it, so it doesn't call the AI.
        </p>
        {shown.map((w) => {
          const badge = BADGES[w.status];
          return (
            <div key={w.id} style={{ padding: "10px 0", borderTop: "1px solid var(--border)" }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 8 }}>
                <strong style={{ fontSize: 14 }}>{formatDay(w.date, today)}</strong>
                <span style={{ fontSize: 11, fontWeight: 600, padding: "2px 8px", borderRadius: 10, background: badge.bg, color: badge.color }}>
                  {w.status === "MOVED" && w.reusedOnDate ? `Moved to ${formatDay(w.reusedOnDate, today)}` : badge.label}
                </span>
              </div>
              <div className="text-dim" style={{ fontSize: 13, margin: "2px 0 8px" }}>
                {FOCUS_LABEL(w.movementPattern)} · {w.exerciseCount} exercises · ~{w.estimatedMinutes} min
                {w.status === "MISSED" && w.setsLogged > 0 ? ` · ${w.setsLogged} set${w.setsLogged === 1 ? "" : "s"} logged, not saved` : ""}
              </div>
              <div style={{ display: "flex", gap: 8 }}>
                <button className="button-secondary" style={{ flex: 1 }} disabled={busy} onClick={() => onUse(w, today)}>
                  {w.status === "DONE" ? "Repeat today" : "Use today"}
                </button>
                <button
                  className="button-quiet"
                  disabled={busy}
                  onClick={() => {
                    setPickerFor(pickerFor === w.id ? null : w.id);
                    setPicked(earliest);
                  }}
                >
                  Another day…
                </button>
              </div>
              {pickerFor === w.id && (
                <div style={{ display: "flex", gap: 8, marginTop: 8 }}>
                  <input type="date" min={earliest} value={picked} onChange={(e) => setPicked(e.target.value)} style={{ flex: 1, padding: 8 }} />
                  <button
                    className="button-primary"
                    disabled={busy || !picked || picked < earliest}
                    onClick={() => {
                      setPickerFor(null);
                      onUse(w, picked);
                    }}
                  >
                    Schedule
                  </button>
                </div>
              )}
            </div>
          );
        })}
        {!showAll && items.length > shown.length && (
          <button className="button-quiet" style={{ marginTop: 4 }} onClick={() => setShowAll(true)}>
            Show all {items.length}
          </button>
        )}
      </div>
    </>
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
      <div style={{ fontSize: 12, fontWeight: 600, marginTop: 4, color: "var(--good)" }}>
        {saved ? "✓ Completed and logged to your history" : "✓ Saved to your account · open it on any device"}
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
