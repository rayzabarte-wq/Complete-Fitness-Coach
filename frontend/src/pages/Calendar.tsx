import { useEffect, useState, type CSSProperties } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { api, DayForecast, DaySummary, PlannedSession, SessionType, MovementPattern, StravaActivity, GolfSessionType, GolfSessionPlan } from "../lib/api.js";
import { ACTIVITY_COLORS, FOCUS_LABELS, activityForSessionType } from "../lib/activity.js";
import { quoteForDate } from "../lib/quotes.js";
import MessageCards from "../components/MessageCards.js";
import { requestLocation, parseLocalDate, formatLocalDateKey } from "../lib/location.js";
import {
  fullLabelFor,
  findCategoryByLabel,
  categoryLabelForType,
  visibleCategoryLabels,
} from "../lib/sessionTypes.js";

// Suggested duration when scheduling — a starting point, editable in the
// form. REST has none, since rest days never count toward scheduled time.
const DEFAULT_MINUTES: Record<SessionType, number> = {
  STRENGTH: 60,
  SWIM: 45,
  GOLF_RANGE: 45,
  GOLF_ROUND: 240,
  GOLF_SHORT_GAME: 30,
  GOLF_PUTTING: 20,
  RUN_RECOVERY: 30,
  RUN_TEMPO: 35,
  RUN_FARTLEK: 35,
  RUN_INTERVALS: 40,
  RUN_LONG_RUN: 75,
  WALK_WALK: 30,
  WALK_HIKE: 90,
  CYCLING_EASY: 45,
  CYCLING_LONG: 90,
  CYCLING_HILLS: 60,
  CYCLING_TURBO_EASY: 40,
  CYCLING_TURBO_LONG: 75,
  CYCLING_TURBO_HILLS: 50,
  REST: 0,
};

// Types where the day's weather is actually relevant to the decision.
// Strength, Swim (assumed indoor pool by default), Rest, and the turbo
// trainer are indoor regardless of what's outside.
const OUTDOOR_RELEVANT_TYPES: SessionType[] = [
  "GOLF_RANGE",
  "GOLF_ROUND",
  "GOLF_SHORT_GAME",
  "GOLF_PUTTING",
  "RUN_RECOVERY",
  "RUN_TEMPO",
  "RUN_FARTLEK",
  "RUN_INTERVALS",
  "RUN_LONG_RUN",
  "WALK_WALK",
  "WALK_HIKE",
  "CYCLING_EASY",
  "CYCLING_LONG",
  "CYCLING_HILLS",
];

function formatHoursMinutes(totalMinutes: number): string {
  const h = Math.floor(totalMinutes / 60);
  const m = totalMinutes % 60;
  if (h === 0) return `${m}m`;
  if (m === 0) return `${h}h`;
  return `${h}h ${m}m`;
}

const DAY_COUNT = 7;

function sevenDaysFrom(weekOffset: number): { key: string; date: Date }[] {
  const days = [];
  const today = new Date();
  const start = today.getDate() + weekOffset * DAY_COUNT;
  for (let i = 0; i < DAY_COUNT; i++) {
    const d = new Date(today.getFullYear(), today.getMonth(), start + i);
    days.push({ key: formatLocalDateKey(d), date: d });
  }
  return days;
}

function greeting(now: Date): string {
  const h = now.getHours();
  return h < 12 ? "Good morning" : h < 18 ? "Good afternoon" : "Good evening";
}

export default function Calendar() {
  const [forecast, setForecast] = useState<DayForecast[] | null>(null);
  const [weatherError, setWeatherError] = useState<string | null>(null);
  const [locationDenied, setLocationDenied] = useState(false);
  const [sessions, setSessions] = useState<PlannedSession[]>([]);
  const [summaries, setSummaries] = useState<Map<string, DaySummary>>(new Map());
  const [weekOffset, setWeekOffset] = useState(0);
  const [visibleTypes, setVisibleTypes] = useState<SessionType[]>(["STRENGTH"]);
  const [autofilling, setAutofilling] = useState(false);
  const [autofillNotes, setAutofillNotes] = useState<string[] | null>(null);
  const [autofillError, setAutofillError] = useState<string | null>(null);

  const days = sevenDaysFrom(weekOffset);
  // Weather only matters for outdoor sports — with strength only switched
  // on, the forecast strip is just noise, so it's hidden.
  const showWeather = visibleTypes.some((t) => OUTDOOR_RELEVANT_TYPES.includes(t));

  useEffect(() => {
    api
      .getPreferences()
      .then((p) => setVisibleTypes(p.visibleSessionTypes))
      .catch(() => setVisibleTypes(["STRENGTH"]));
  }, []);

  useEffect(() => {
    if (showWeather && !forecast) loadForecast();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [showWeather]);

  useEffect(() => {
    loadWeek();
    setAutofillNotes(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [weekOffset]);

  async function loadForecast() {
    setWeatherError(null);
    const coords = await requestLocation();
    setLocationDenied(coords === null);
    api
      .getForecast(coords ?? undefined)
      .then(setForecast)
      .catch((err) => setWeatherError(err.message ?? "Failed to load forecast"));
  }

  function loadWeek() {
    const currentDays = sevenDaysFrom(weekOffset);
    const from = new Date(currentDays[0].date);
    from.setHours(0, 0, 0, 0);
    const to = new Date(currentDays[DAY_COUNT - 1].date);
    to.setHours(23, 59, 59, 999);
    api.getPlannedSessions(from.toISOString(), to.toISOString()).then(setSessions);
    const endKey = formatLocalDateKey(new Date(currentDays[DAY_COUNT - 1].date.getTime() + 86400_000));
    api
      .getDaySummaries(currentDays[0].key, endKey)
      .then((list) => setSummaries(new Map(list.map((d) => [d.date, d]))))
      .catch(() => setSummaries(new Map()));
  }

  async function autofill() {
    setAutofilling(true);
    setAutofillError(null);
    try {
      const result = await api.autofillWeek(days[0].key, formatLocalDateKey(new Date()));
      setAutofillNotes(result.notes.length ? result.notes : ["Nothing to add. This week is already planned."]);
      loadWeek();
    } catch (err: any) {
      setAutofillError(err.message ?? "Auto-fill failed");
    } finally {
      setAutofilling(false);
    }
  }

  const forecastByDate = new Map((forecast ?? []).map((d) => [d.date, d]));

  const visibleSessions = sessions.filter((s) => s.type === "REST" || visibleTypes.includes(s.type));

  const sessionsByDay = new Map<string, PlannedSession[]>();
  for (const s of visibleSessions) {
    const key = s.date.slice(0, 10);
    (sessionsByDay.get(key) ?? sessionsByDay.set(key, []).get(key)!).push(s);
  }

  const scheduledMinutes = visibleSessions
    .filter((s) => s.type !== "REST")
    .reduce((sum, s) => sum + (s.estimatedMinutes ?? 0), 0);
  const workoutCount = visibleSessions.filter((s) => s.type !== "REST").length;
  const doneCount = visibleSessions.filter((s) => s.type !== "REST" && s.completed).length;

  const weekLabel =
    weekOffset === 0
      ? "Next 7 days"
      : `${days[0].date.toLocaleDateString(undefined, { month: "short", day: "numeric" })} – ${days[
          DAY_COUNT - 1
        ].date.toLocaleDateString(undefined, { month: "short", day: "numeric" })}`;

  const quote = quoteForDate(new Date());

  return (
    <div>
      <div className="card" style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12, marginBottom: 12 }}>
        <div style={{ minWidth: 0 }}>
          <div style={{ fontFamily: '"Poppins", sans-serif', fontWeight: 600, fontSize: 18, color: "var(--navy)" }}>{greeting(new Date())}</div>
          <div className="text-dim" style={{ fontSize: 13, marginTop: 2 }}>
            {workoutCount === 0
              ? "Nothing planned for these days yet."
              : doneCount === workoutCount
                ? `All ${workoutCount} planned sessions done. Well played.`
                : `${doneCount} of ${workoutCount} planned sessions done`}
          </div>
        </div>
        {workoutCount > 0 && (
          <div
            className="ring"
            style={{ "--pct": Math.round((doneCount / workoutCount) * 100) } as CSSProperties}
            role="img"
            aria-label={`${doneCount} of ${workoutCount} sessions done`}
          >
            <b>{Math.round((doneCount / workoutCount) * 100)}%</b>
          </div>
        )}
      </div>

      <MessageCards />

      <figure className="card" style={{ margin: "0 0 12px", borderLeft: "4px solid var(--sun)" }}>
        <blockquote style={{ margin: 0, fontSize: 14, fontStyle: "italic", lineHeight: 1.45 }}>“{quote.text}”</blockquote>
        <figcaption className="text-dim" style={{ fontSize: 12, marginTop: 6 }}>
          — {quote.author}, {quote.context}
        </figcaption>
      </figure>

      {showWeather && <WeatherStrip forecast={forecast} error={weatherError} locationDenied={locationDenied} onRetryLocation={loadForecast} />}

      <div className="card" style={{ marginBottom: 12 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 4 }}>
          <button
            onClick={() => setWeekOffset((w) => w - 1)}
            aria-label="Previous week"
            style={{ background: "none", border: "none", color: "var(--navy)", cursor: "pointer", fontSize: 20, padding: "0 6px" }}
          >
            ‹
          </button>
          <strong style={{ fontSize: 14, color: "var(--navy)" }}>{weekLabel}</strong>
          <button
            onClick={() => setWeekOffset((w) => w + 1)}
            aria-label="Next week"
            style={{ background: "none", border: "none", color: "var(--navy)", cursor: "pointer", fontSize: 20, padding: "0 6px" }}
          >
            ›
          </button>
        </div>
        <div className="text-dim" style={{ fontSize: 13, textAlign: "center" }}>
          {workoutCount} session{workoutCount === 1 ? "" : "s"} · {formatHoursMinutes(scheduledMinutes)} planned · {doneCount} done
        </div>
        <button className="button-primary" onClick={autofill} disabled={autofilling} style={{ width: "100%", marginTop: 10 }}>
          {autofilling ? "Planning your week…" : "Auto-fill strength for this week"}
        </button>
        {autofillNotes && (
          <ul style={{ margin: "8px 0 0", paddingLeft: 18, fontSize: 12 }} className="text-dim">
            {autofillNotes.map((n, i) => (
              <li key={i}>{n}</li>
            ))}
          </ul>
        )}
        {autofillError && <p style={{ color: "var(--danger)", fontSize: 13, marginBottom: 0 }}>{autofillError}</p>}
        {weekOffset !== 0 && (
          <button
            onClick={() => setWeekOffset(0)}
            style={{ marginTop: 6, fontSize: 12, background: "none", border: "none", color: "var(--text-dim)", cursor: "pointer", padding: 0, textDecoration: "underline" }}
          >
            Back to this week
          </button>
        )}
      </div>

      {days.map(({ key, date }) => (
        <DaySummaryRow
          key={key}
          date={date}
          sessions={sessionsByDay.get(key) ?? []}
          summary={summaries.get(key)}
          dayForecast={showWeather ? forecastByDate.get(key) : undefined}
        />
      ))}
    </div>
  );
}

/** The simplified, at-a-glance day in the 7-day view: one line per
 * activity with its colour and a done/planned state, plus a steps bar.
 * Tapping the day opens the full detail (DayDetail). */
function DaySummaryRow({
  date,
  sessions,
  summary,
  dayForecast,
}: {
  date: Date;
  sessions: PlannedSession[];
  summary: DaySummary | undefined;
  dayForecast: DayForecast | undefined;
}) {
  const key = formatLocalDateKey(date);
  const isToday = key === formatLocalDateKey(new Date());
  const loggedOnly = (summary?.workouts ?? []).filter(
    (w) => !sessions.some((s) => s.type === "STRENGTH" && s.completed && (s.movementPattern === w.focus || !w.focus))
  );
  const nothing = sessions.length === 0 && loggedOnly.length === 0;

  return (
    <Link
      to={`/day/${key}`}
      className="card"
      style={{ display: "block", textDecoration: "none", color: "inherit", marginBottom: 8, padding: "10px 12px", borderColor: isToday ? "var(--navy)" : undefined }}
      aria-label={`${isToday ? "Today" : date.toLocaleDateString(undefined, { weekday: "long" })}, open day details`}
    >
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
        <strong style={{ fontSize: 14, color: "var(--navy)" }}>
          {isToday ? "Today" : date.toLocaleDateString(undefined, { weekday: "long" })}
          <span className="text-dim" style={{ fontWeight: 400, marginLeft: 6, fontSize: 12 }}>
            {date.toLocaleDateString(undefined, { month: "short", day: "numeric" })}
          </span>
        </strong>
        <span className="text-dim" style={{ fontSize: 12 }}>
          {dayForecast ? `${dayForecast.tempMaxC}° · ${dayForecast.condition}  ` : ""}›
        </span>
      </div>

      <div style={{ marginTop: 6, display: "grid", gap: 4 }}>
        {sessions.map((s) => {
          const activity = activityForSessionType(s.type);
          return (
            <ActivityLine
              key={s.id}
              color={ACTIVITY_COLORS[activity]}
              label={s.type === "STRENGTH" && s.movementPattern ? `Strength · ${FOCUS_LABELS[s.movementPattern] ?? s.movementPattern}` : fullLabelFor(s.type)}
              done={s.completed}
              rest={s.type === "REST"}
            />
          );
        })}
        {loggedOnly.map((w) => (
          <ActivityLine key={w.id} color={ACTIVITY_COLORS.STRENGTH} label={`Strength · ${w.focus ? FOCUS_LABELS[w.focus] : "logged"}`} done rest={false} />
        ))}
        {summary?.steps != null && <StepsLine steps={summary.steps} goal={summary.stepGoal} />}
        {summary?.scan && (
          <div className="text-dim" style={{ fontSize: 12 }}>
            Scan{summary.scan.bodyFatPct != null ? ` · ${summary.scan.bodyFatPct}% fat` : ""}
            {summary.scan.weightKg != null ? ` · ${summary.scan.weightKg} kg` : ""}
          </div>
        )}
        {nothing && summary?.steps == null && (
          <span className="text-dim" style={{ fontSize: 12 }}>
            Nothing planned
          </span>
        )}
      </div>
    </Link>
  );
}

/** One activity in the simplified day view. The swatch colour always means
 * the activity type; done vs planned is shown by the tick and by fading,
 * never by changing the colour. */
function ActivityLine({ color, label, done, rest }: { color: string; label: string; done: boolean; rest: boolean }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13, opacity: done || rest ? 1 : 0.75 }}>
      <span className="swatch" style={{ background: color }} />
      <span style={{ flex: 1 }}>{label}</span>
      {!rest && (
        <span style={{ fontSize: 12, fontWeight: 700, color: done ? "var(--good)" : "var(--text-dim)" }}>{done ? "✓ Done" : "Planned"}</span>
      )}
    </div>
  );
}

/** Steps as a bar in the steps colour, filled toward the day's goal, with
 * a tick once it's reached. */
function StepsLine({ steps, goal }: { steps: number; goal: number | null }) {
  const pct = goal ? Math.min(100, (steps / goal) * 100) : 100;
  const hit = goal != null && steps >= goal;
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13 }}>
      <span className="swatch" style={{ background: ACTIVITY_COLORS.STEPS }} />
      <span style={{ width: 44 }}>Steps</span>
      <div style={{ flex: 1, height: 8, background: "var(--surface-2)", borderRadius: 4, overflow: "hidden" }}>
        <div style={{ width: `${pct}%`, height: "100%", background: ACTIVITY_COLORS.STEPS, opacity: hit ? 1 : 0.55, borderRadius: 4 }} />
      </div>
      <span style={{ fontSize: 12, fontWeight: 700, minWidth: 56, textAlign: "right", color: hit ? "var(--good)" : "var(--text-dim)" }}>
        {hit ? "✓ " : ""}
        {steps >= 1000 ? `${Math.round(steps / 100) / 10}k` : steps}
      </span>
    </div>
  );
}

/** The drill-down for one day: every scheduled session with its full
 * controls, what was actually logged (sets, steps, scan), and adding more. */
export function DayDetail() {
  const { date: dateKey } = useParams();
  const navigate = useNavigate();
  const [sessions, setSessions] = useState<PlannedSession[]>([]);
  const [summary, setSummary] = useState<DaySummary | null>(null);
  const [visibleTypes, setVisibleTypes] = useState<SessionType[]>(["STRENGTH"]);
  const [stravaConnected, setStravaConnected] = useState(false);
  const [adding, setAdding] = useState(false);
  const [stepsInput, setStepsInput] = useState("");
  const [stepsError, setStepsError] = useState<string | null>(null);

  const date = dateKey ? parseLocalDate(dateKey) : new Date();

  function load() {
    if (!dateKey) return;
    const from = new Date(date);
    from.setHours(0, 0, 0, 0);
    const to = new Date(date);
    to.setHours(23, 59, 59, 999);
    api.getPlannedSessions(from.toISOString(), to.toISOString()).then((list) => setSessions(list.filter((s) => s.date.slice(0, 10) === dateKey)));
    const next = formatLocalDateKey(new Date(date.getFullYear(), date.getMonth(), date.getDate() + 1));
    api.getDaySummaries(dateKey, next).then((d) => setSummary(d[0] ?? null));
  }

  useEffect(() => {
    load();
    api.getPreferences().then((p) => setVisibleTypes(p.visibleSessionTypes)).catch(() => undefined);
    api.getStravaStatus().then((s) => setStravaConnected(s.connected)).catch(() => undefined);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dateKey]);

  async function saveSteps() {
    setStepsError(null);
    try {
      await api.setSteps(dateKey!, Number(stepsInput));
      setStepsInput("");
      load();
    } catch (err: any) {
      setStepsError(typeof err.message === "string" ? err.message : "Couldn't save steps");
    }
  }

  const visible = sessions.filter((s) => s.type === "REST" || visibleTypes.includes(s.type));

  return (
    <div>
      <button onClick={() => navigate(-1)} className="button-quiet" style={{ marginBottom: 10 }}>
        ‹ Back
      </button>
      <h2 style={{ margin: "0 0 12px", fontSize: 20 }}>
        {date.toLocaleDateString(undefined, { weekday: "long", day: "numeric", month: "long" })}
      </h2>

      <div className="section-title">Planned</div>
      {visible.length === 0 && !adding && <p className="text-dim" style={{ fontSize: 13 }}>Nothing scheduled.</p>}
      {visible.map((s) => (
        <SessionRow
          key={s.id}
          session={s}
          dayForecast={undefined}
          stravaConnected={stravaConnected}
          visibleTypes={visibleTypes}
          onToggleComplete={async (completed) => {
            await api.updatePlannedSession(s.id, { completed });
            load();
          }}
          onDelete={async () => {
            await api.deletePlannedSession(s.id);
            load();
          }}
          onUpdated={load}
        />
      ))}
      {adding ? (
        <AddSessionForm
          date={dateKey!}
          visibleTypes={visibleTypes}
          onCreated={() => {
            setAdding(false);
            load();
          }}
          onCancel={() => setAdding(false)}
        />
      ) : (
        <button
          onClick={() => setAdding(true)}
          style={{ width: "100%", padding: 8, borderRadius: 8, border: "1px dashed var(--border)", background: "none", color: "var(--text-dim)", cursor: "pointer", fontSize: 13 }}
        >
          + Add workout
        </button>
      )}

      <div className="section-title">What you did</div>
      {summary?.workouts.map((w) => (
        <div key={w.id} className="card" style={{ marginBottom: 8, borderLeft: `4px solid ${ACTIVITY_COLORS.STRENGTH}` }}>
          <div style={{ display: "flex", justifyContent: "space-between" }}>
            <strong>Strength{w.focus ? ` · ${FOCUS_LABELS[w.focus]}` : ""}</strong>
            <span className="text-dim" style={{ fontSize: 12 }}>
              {w.setCount} sets{w.minutes ? ` · ${w.minutes} min` : ""}
            </span>
          </div>
          {w.exercises.map((e) => (
            <div key={e.name} className="text-dim" style={{ fontSize: 13, marginTop: 4 }}>
              {e.name}: {e.sets.join(", ")}
            </div>
          ))}
        </div>
      ))}

      <div className="card" style={{ marginBottom: 8, borderLeft: `4px solid ${ACTIVITY_COLORS.STEPS}` }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
          <strong>Steps</strong>
          <span style={{ fontSize: 15, fontWeight: 700 }}>
            {summary?.steps != null ? summary.steps.toLocaleString() : "—"}
            {summary?.hitStepGoal && <span style={{ color: "var(--good)", marginLeft: 6 }}>✓</span>}
          </span>
        </div>
        {summary?.stepGoal != null && (
          <div className="text-dim" style={{ fontSize: 12 }}>
            Goal {summary.stepGoal.toLocaleString()} (your average target)
          </div>
        )}
        <div style={{ display: "flex", gap: 6, marginTop: 8 }}>
          <input
            inputMode="numeric"
            placeholder={summary?.steps != null ? "Correct the count" : "Enter steps by hand"}
            value={stepsInput}
            onChange={(e) => setStepsInput(e.target.value.replace(/[^0-9]/g, ""))}
            style={{ flex: 1, padding: 6, minWidth: 0 }}
            aria-label="Steps"
          />
          <button className="button-secondary" onClick={saveSteps} disabled={!stepsInput}>
            Save
          </button>
        </div>
        {stepsError && <p style={{ color: "var(--danger)", fontSize: 12 }}>{stepsError}</p>}
      </div>

      {summary?.scan && (
        <div className="card" style={{ marginBottom: 8 }}>
          <strong>Body scan</strong>
          <div className="text-dim" style={{ fontSize: 13, marginTop: 4 }}>
            {[
              summary.scan.weightKg != null && `${summary.scan.weightKg} kg`,
              summary.scan.bodyFatPct != null && `${summary.scan.bodyFatPct}% body fat`,
              summary.scan.muscleMassKg != null && `${summary.scan.muscleMassKg} kg muscle`,
            ]
              .filter(Boolean)
              .join(" · ")}
          </div>
        </div>
      )}
    </div>
  );
}

function WeatherStrip({
  forecast,
  error,
  locationDenied,
  onRetryLocation,
}: {
  forecast: DayForecast[] | null;
  error: string | null;
  locationDenied: boolean;
  onRetryLocation: () => void;
}) {
  if (error) {
    return (
      <div className="card" style={{ marginBottom: 12 }}>
        <p className="text-dim" style={{ fontSize: 13 }}>
          {locationDenied
            ? "Location access was denied, and no fallback location is configured. Allow location access for this site in your browser settings, or ask whoever set up the backend to add LOCATION_LAT/LOCATION_LON."
            : error}
        </p>
        {locationDenied && (
          <button className="button-primary" onClick={onRetryLocation} style={{ marginTop: 8, width: "100%" }}>
            Try again
          </button>
        )}
      </div>
    );
  }

  if (!forecast) {
    return (
      <div className="card" style={{ marginBottom: 12 }}>
        <p className="text-dim" style={{ fontSize: 13 }}>
          Loading forecast...
        </p>
      </div>
    );
  }

  return (
    <div
      style={{
        display: "flex",
        gap: 8,
        overflowX: "auto",
        paddingBottom: 4,
        marginBottom: 16,
        WebkitOverflowScrolling: "touch",
      }}
    >
      {forecast.map((day) => (
        <div key={day.date} className="card" style={{ minWidth: 92, flexShrink: 0, textAlign: "center", padding: 10 }}>
          <div style={{ fontSize: 12, fontWeight: 600 }}>
            {parseLocalDate(day.date).toLocaleDateString(undefined, { weekday: "short" })}
          </div>
          <div className="text-dim" style={{ fontSize: 11, marginTop: 2 }}>
            {day.condition}
          </div>
          <div style={{ fontSize: 14, marginTop: 4 }}>
            {day.tempMaxC}° / {day.tempMinC}°
          </div>
          <div className="text-dim" style={{ fontSize: 10, marginTop: 2 }}>
            💧{day.precipProbability}% 🌬{day.windMaxMph}mph
          </div>
          <div
            style={{
              marginTop: 6,
              fontSize: 10,
              fontWeight: 700,
              padding: "2px 0",
              borderRadius: 4,
              background: day.outdoorRecommended ? "var(--accent)" : "var(--border)",
              color: day.outdoorRecommended ? "var(--on-accent)" : "var(--text-dim)",
            }}
          >
            {day.outdoorRecommended ? "OUTDOOR OK" : "GO INDOOR"}
          </div>
        </div>
      ))}
    </div>
  );
}

/** Top-level category dropdown — Strength, Golf, Run, Walk, Cycling,
 * Cycling - Turbo, Swim, Rest Day. Mirrors how the movement pattern
 * selector sits below the Strength option: picking a grouped category
 * here doesn't finalize a type on its own, a SubTypeSelect appears next
 * for that. */
function CategorySelect({
  value,
  visibleTypes,
  onChange,
}: {
  value: string;
  visibleTypes: SessionType[];
  onChange: (label: string) => void;
}) {
  return (
    <select value={value} onChange={(e) => onChange(e.target.value)} style={{ width: "100%", padding: 8, marginTop: 8 }}>
      {visibleCategoryLabels(visibleTypes).map((label) => (
        <option key={label} value={label}>
          {label}
        </option>
      ))}
    </select>
  );
}

/** The second dropdown, shown only when the chosen category has
 * sub-options (Golf/Run/Walk/Cycling/Cycling-Turbo) — e.g. Range/Round/
 * Short Game/Putting under Golf, exactly like Push/Pull/Legs/Core under
 * Strength. */
function SubTypeSelect({
  categoryLabel,
  value,
  visibleTypes,
  onChange,
}: {
  categoryLabel: string;
  value: SessionType;
  visibleTypes: SessionType[];
  onChange: (type: SessionType) => void;
}) {
  const category = findCategoryByLabel(categoryLabel);
  if (!category?.children) return null;
  const visibleChildren = category.children.filter((c) => visibleTypes.includes(c.type));
  if (visibleChildren.length === 0) return null;

  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value as SessionType)}
      style={{ width: "100%", padding: 8, marginTop: 8 }}
    >
      {visibleChildren.map((c) => (
        <option key={c.type} value={c.type}>
          {c.label}
        </option>
      ))}
    </select>
  );
}

/** Resolves a (category label, sub-type) pair down to the actual
 * SessionType to submit — the category itself for a leaf (Strength,
 * Swim), REST for "Rest Day", or the chosen sub-type for a grouped one. */
function resolveType(categoryLabel: string, subType: SessionType): SessionType {
  if (categoryLabel === "Rest Day") return "REST";
  const category = findCategoryByLabel(categoryLabel);
  if (!category) return "REST";
  return category.children ? subType : category.type;
}

/** Default sub-type to select when a grouped category is first chosen —
 * the first visible child, so the selector never lands on a hidden type. */
function defaultSubType(categoryLabel: string, visibleTypes: SessionType[]): SessionType {
  const category = findCategoryByLabel(categoryLabel);
  if (!category?.children) return "REST";
  const firstVisible = category.children.find((c) => visibleTypes.includes(c.type));
  return firstVisible?.type ?? category.children[0].type;
}

const GOLF_TRAINING_TYPES: SessionType[] = ["GOLF_RANGE", "GOLF_SHORT_GAME", "GOLF_PUTTING"];

function isGolfTrainingType(type: SessionType): type is GolfSessionType {
  return GOLF_TRAINING_TYPES.includes(type);
}

/** "Suggest a session (AI)" — shown for Golf Range/Short Game/Putting
 * (never Round, which isn't a practice session to generate drills for).
 * Fills the parent form's notes and estimated-minutes fields on success. */
function GolfSuggestion({
  type,
  onApply,
}: {
  type: GolfSessionType;
  onApply: (notes: string, minutes: number) => void;
}) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function generate() {
    setLoading(true);
    setError(null);
    try {
      const plan: GolfSessionPlan = await api.generateGolfPlan(type);
      const notes = [
        `Focus: ${plan.focusSummary}`,
        "",
        ...plan.drills.map((d, i) => `${i + 1}. ${d.name} (${d.minutes} min) — ${d.detail}`),
        "",
        `Why: ${plan.reasoning}`,
      ].join("\n");
      onApply(notes, plan.totalMinutes);
    } catch (err: any) {
      setError(err.message ?? "Failed to generate a session");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div style={{ marginTop: 8 }}>
      <button
        type="button"
        onClick={generate}
        disabled={loading}
        style={{
          width: "100%",
          padding: 8,
          borderRadius: 8,
          border: "1px solid var(--accent)",
          background: "none",
          color: "var(--accent)",
          cursor: "pointer",
          fontSize: 13,
        }}
      >
        {loading ? "Building a session..." : "Suggest a session (AI)"}
      </button>
      {error && <p style={{ color: "var(--danger)", fontSize: 12, marginTop: 4 }}>{error}</p>}
    </div>
  );
}

function AddSessionForm({
  date,
  visibleTypes,
  onCreated,
  onCancel,
}: {
  date: string;
  visibleTypes: SessionType[];
  onCreated: () => void;
  onCancel: () => void;
}) {
  const [category, setCategory] = useState(() => visibleCategoryLabels(visibleTypes)[0] ?? "Rest Day");
  const [subType, setSubType] = useState<SessionType>(() =>
    defaultSubType(visibleCategoryLabels(visibleTypes)[0] ?? "Rest Day", visibleTypes)
  );
  const [movementPattern, setMovementPattern] = useState<MovementPattern>("PUSH");
  const type = resolveType(category, subType);
  const [estimatedMinutes, setEstimatedMinutes] = useState(() => String(DEFAULT_MINUTES[type] || 45));
  const [notes, setNotes] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function handleCategoryChange(label: string) {
    setCategory(label);
    const nextSubType = defaultSubType(label, visibleTypes);
    setSubType(nextSubType);
    const nextType = resolveType(label, nextSubType);
    setEstimatedMinutes(nextType === "REST" ? "" : String(DEFAULT_MINUTES[nextType] ?? 45));
  }

  function handleSubTypeChange(t: SessionType) {
    setSubType(t);
    setEstimatedMinutes(String(DEFAULT_MINUTES[t] ?? 45));
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setError(null);
    try {
      await api.createPlannedSession({
        date: new Date(date).toISOString(),
        type,
        movementPattern: type === "STRENGTH" ? movementPattern : undefined,
        notes: notes || undefined,
        estimatedMinutes: type !== "REST" && estimatedMinutes ? Number(estimatedMinutes) : undefined,
      });
      onCreated();
    } catch (err: any) {
      setError(err.message ?? "Failed to schedule session");
    } finally {
      setSaving(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="card" style={{ marginTop: 8 }}>
      <CategorySelect value={category} visibleTypes={visibleTypes} onChange={handleCategoryChange} />

      <SubTypeSelect categoryLabel={category} value={subType} visibleTypes={visibleTypes} onChange={handleSubTypeChange} />

      {type === "STRENGTH" && (
        <select
          value={movementPattern}
          onChange={(e) => setMovementPattern(e.target.value as MovementPattern)}
          style={{ width: "100%", padding: 8, marginTop: 8 }}
        >
          <option value="PUSH">Push</option>
          <option value="PULL">Pull</option>
          <option value="LEGS">Legs</option>
          <option value="UPPER">Upper</option>
          <option value="LOWER">Lower</option>
          <option value="FULL_BODY">Full body</option>
          <option value="CORE">Core</option>
        </select>
      )}

      {type !== "REST" && (
        <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 8 }}>
          <input
            type="number"
            min={1}
            value={estimatedMinutes}
            onChange={(e) => setEstimatedMinutes(e.target.value.replace(/[^0-9]/g, ""))}
            style={{ width: 70, padding: 8 }}
          />
          <span className="text-dim" style={{ fontSize: 13 }}>
            minutes expected
          </span>
        </div>
      )}

      {isGolfTrainingType(type) && (
        <GolfSuggestion
          type={type}
          onApply={(generatedNotes, minutes) => {
            setNotes(generatedNotes);
            setEstimatedMinutes(String(minutes));
          }}
        />
      )}

      <input
        placeholder={
          type === "GOLF_ROUND"
            ? "Notes — e.g. paste key stats from Arccos (SG putting, GIR, up-and-down rate)"
            : "Notes (optional)"
        }
        value={notes}
        onChange={(e) => setNotes(e.target.value)}
        style={{ width: "100%", padding: 8, marginTop: 8 }}
      />

      {error && <p style={{ color: "var(--danger)", fontSize: 13, marginTop: 6 }}>{error}</p>}

      <div style={{ display: "flex", gap: 8, marginTop: 10 }}>
        <button
          type="button"
          onClick={onCancel}
          style={{ flex: 1, padding: 8, borderRadius: 6, border: "none", background: "var(--border)", color: "var(--text-dim)", cursor: "pointer" }}
        >
          Cancel
        </button>
        <button className="button-primary" disabled={saving} style={{ flex: 1 }}>
          {saving ? "Adding..." : "Add"}
        </button>
      </div>
    </form>
  );
}

function SessionRow({
  session,
  dayForecast,
  stravaConnected,
  visibleTypes,
  onToggleComplete,
  onDelete,
  onUpdated,
}: {
  session: PlannedSession;
  dayForecast: DayForecast | undefined;
  stravaConnected: boolean;
  visibleTypes: SessionType[];
  onToggleComplete: (completed: boolean) => void;
  onDelete: () => void;
  onUpdated: () => void;
}) {
  const [editing, setEditing] = useState(false);
  const showWeatherWarning =
    dayForecast && !dayForecast.outdoorRecommended && OUTDOOR_RELEVANT_TYPES.includes(session.type);
  const isRestDay = session.type === "REST";

  if (editing) {
    return (
      <EditSessionForm
        session={session}
        visibleTypes={visibleTypes}
        onCancel={() => setEditing(false)}
        onSaved={() => {
          setEditing(false);
          onUpdated();
        }}
      />
    );
  }

  return (
    <div className="card" style={{ marginBottom: 8, opacity: session.completed ? 0.6 : 1 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
        <strong style={{ fontSize: 14, display: "flex", alignItems: "center", gap: 6 }}>
          <span className="swatch" style={{ background: ACTIVITY_COLORS[activityForSessionType(session.type)] }} />
          {fullLabelFor(session.type)}
          {session.movementPattern ? ` · ${FOCUS_LABELS[session.movementPattern] ?? session.movementPattern}` : ""}
          {session.autoPlanned && <span className="chip">Auto</span>}
        </strong>
        {!isRestDay && session.estimatedMinutes && (
          <span className="text-dim" style={{ fontSize: 12 }}>
            ~{formatHoursMinutes(session.estimatedMinutes)}
          </span>
        )}
      </div>

      {session.notes && (
        <p className="text-dim" style={{ fontSize: 13, marginTop: 4 }}>
          {session.notes}
        </p>
      )}

      {showWeatherWarning && (
        <p style={{ fontSize: 12, marginTop: 4, color: "var(--danger)" }}>
          ⚠ {dayForecast!.condition.toLowerCase()}, {dayForecast!.precipProbability}% rain — consider an indoor swap
        </p>
      )}

      {session.type === "STRENGTH" && session.movementPattern && !session.completed && (
        <Link
          to={`/log?focus=${session.movementPattern}&planned=${session.id}`}
          className="button-primary"
          style={{ display: "block", textAlign: "center", textDecoration: "none", marginTop: 8 }}
        >
          Start this workout
        </Link>
      )}

      {!isRestDay && <ActualTimeEntry session={session} stravaConnected={stravaConnected} onUpdated={onUpdated} />}

      <div style={{ display: "flex", gap: 8, marginTop: 8 }}>
        <button
          onClick={() => onToggleComplete(!session.completed)}
          style={{
            flex: 1,
            padding: 6,
            fontSize: 12,
            borderRadius: 6,
            border: "none",
            cursor: "pointer",
            background: session.completed ? "var(--accent)" : "var(--border)",
            color: session.completed ? "var(--on-accent)" : "var(--text-dim)",
          }}
        >
          {session.completed ? "Completed ✓" : isRestDay ? "Mark rested" : "Mark done"}
        </button>
        <button
          onClick={() => setEditing(true)}
          style={{
            padding: "6px 10px",
            fontSize: 12,
            borderRadius: 6,
            border: "none",
            cursor: "pointer",
            background: "var(--border)",
            color: "var(--text-dim)",
          }}
        >
          Edit
        </button>
        <button
          onClick={onDelete}
          style={{
            padding: "6px 10px",
            fontSize: 12,
            borderRadius: 6,
            border: "none",
            cursor: "pointer",
            background: "var(--border)",
            color: "var(--danger)",
          }}
        >
          Remove
        </button>
      </div>
    </div>
  );
}

function EditSessionForm({
  session,
  visibleTypes,
  onCancel,
  onSaved,
}: {
  session: PlannedSession;
  visibleTypes: SessionType[];
  onCancel: () => void;
  onSaved: () => void;
}) {
  const [date, setDate] = useState(session.date.slice(0, 10));
  const [category, setCategory] = useState(() => categoryLabelForType(session.type));
  const [subType, setSubType] = useState<SessionType>(session.type);
  const [movementPattern, setMovementPattern] = useState<MovementPattern>(session.movementPattern ?? "PUSH");
  const type = resolveType(category, subType);
  const [estimatedMinutes, setEstimatedMinutes] = useState(
    session.estimatedMinutes ? String(session.estimatedMinutes) : ""
  );
  const [notes, setNotes] = useState(session.notes ?? "");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // The session's own current type might now be hidden by a Settings
  // change since it was created — still offer it in these dropdowns so
  // editing an already-scheduled session never looks broken.
  const typesForThisForm = visibleTypes.includes(session.type) ? visibleTypes : [...visibleTypes, session.type];

  function handleCategoryChange(label: string) {
    setCategory(label);
    const nextSubType = defaultSubType(label, typesForThisForm);
    setSubType(nextSubType);
    const nextType = resolveType(label, nextSubType);
    if (nextType !== "REST" && !estimatedMinutes) {
      setEstimatedMinutes(String(DEFAULT_MINUTES[nextType] ?? 45));
    }
  }

  function handleSubTypeChange(t: SessionType) {
    setSubType(t);
    if (!estimatedMinutes) {
      setEstimatedMinutes(String(DEFAULT_MINUTES[t] ?? 45));
    }
  }

  async function handleSave() {
    setSaving(true);
    setError(null);
    try {
      await api.updatePlannedSession(session.id, {
        date: new Date(date).toISOString(),
        type,
        movementPattern: type === "STRENGTH" ? movementPattern : undefined,
        estimatedMinutes: type !== "REST" && estimatedMinutes ? Number(estimatedMinutes) : undefined,
        notes: notes || undefined,
      });
      onSaved();
    } catch (err: any) {
      setError(err.message ?? "Failed to save changes");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="card" style={{ marginBottom: 8 }}>
      <strong style={{ fontSize: 14 }}>Edit session</strong>

      <input
        type="date"
        value={date}
        onChange={(e) => setDate(e.target.value)}
        style={{ width: "100%", padding: 8, marginTop: 8 }}
      />

      <CategorySelect value={category} visibleTypes={typesForThisForm} onChange={handleCategoryChange} />

      <SubTypeSelect categoryLabel={category} value={subType} visibleTypes={typesForThisForm} onChange={handleSubTypeChange} />

      {type === "STRENGTH" && (
        <select
          value={movementPattern}
          onChange={(e) => setMovementPattern(e.target.value as MovementPattern)}
          style={{ width: "100%", padding: 8, marginTop: 8 }}
        >
          <option value="PUSH">Push</option>
          <option value="PULL">Pull</option>
          <option value="LEGS">Legs</option>
          <option value="UPPER">Upper</option>
          <option value="LOWER">Lower</option>
          <option value="FULL_BODY">Full body</option>
          <option value="CORE">Core</option>
        </select>
      )}

      {type !== "REST" && (
        <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 8 }}>
          <input
            type="number"
            min={1}
            value={estimatedMinutes}
            onChange={(e) => setEstimatedMinutes(e.target.value.replace(/[^0-9]/g, ""))}
            style={{ width: 70, padding: 8 }}
          />
          <span className="text-dim" style={{ fontSize: 13 }}>
            minutes expected
          </span>
        </div>
      )}

      {isGolfTrainingType(type) && (
        <GolfSuggestion
          type={type}
          onApply={(generatedNotes, minutes) => {
            setNotes(generatedNotes);
            setEstimatedMinutes(String(minutes));
          }}
        />
      )}

      <input
        placeholder={
          type === "GOLF_ROUND"
            ? "Notes — e.g. paste key stats from Arccos (SG putting, GIR, up-and-down rate)"
            : "Notes (optional)"
        }
        value={notes}
        onChange={(e) => setNotes(e.target.value)}
        style={{ width: "100%", padding: 8, marginTop: 8 }}
      />

      {error && <p style={{ color: "var(--danger)", fontSize: 13, marginTop: 6 }}>{error}</p>}

      <div style={{ display: "flex", gap: 8, marginTop: 10 }}>
        <button
          onClick={onCancel}
          style={{ flex: 1, padding: 8, borderRadius: 6, border: "none", background: "var(--border)", color: "var(--text-dim)", cursor: "pointer" }}
        >
          Cancel
        </button>
        <button className="button-primary" onClick={handleSave} disabled={saving} style={{ flex: 1 }}>
          {saving ? "Saving..." : "Save changes"}
        </button>
      </div>
    </div>
  );
}

function ActualTimeEntry({
  session,
  stravaConnected,
  onUpdated,
}: {
  session: PlannedSession;
  stravaConnected: boolean;
  onUpdated: () => void;
}) {
  const [manualMinutes, setManualMinutes] = useState("");
  const [saving, setSaving] = useState(false);
  const [showStravaPicker, setShowStravaPicker] = useState(false);
  const [stravaActivities, setStravaActivities] = useState<StravaActivity[] | null>(null);
  const [stravaLoading, setStravaLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (session.actualMinutes !== null) {
    return (
      <p className="text-dim" style={{ fontSize: 12, marginTop: 6 }}>
        Actual: {formatHoursMinutes(session.actualMinutes)}
        {session.actualSource === "STRAVA" ? " (from Strava)" : " (entered manually)"}
      </p>
    );
  }

  async function saveManual() {
    if (!manualMinutes) return;
    setSaving(true);
    setError(null);
    try {
      await api.updatePlannedSession(session.id, { actualMinutes: Number(manualMinutes) });
      onUpdated();
    } catch (err: any) {
      setError(err.message ?? "Failed to save actual time");
    } finally {
      setSaving(false);
    }
  }

  async function openStravaPicker() {
    setShowStravaPicker(true);
    setStravaLoading(true);
    setError(null);
    try {
      const activities = await api.getStravaActivitiesForSession(session.id);
      setStravaActivities(activities);
    } catch (err: any) {
      setError(err.message ?? "Failed to load Strava activities");
    } finally {
      setStravaLoading(false);
    }
  }

  async function linkActivity(activity: StravaActivity) {
    setSaving(true);
    setError(null);
    try {
      await api.linkStravaActivity(session.id, activity.id, activity.movingMinutes);
      onUpdated();
    } catch (err: any) {
      setError(err.message ?? "Failed to link activity");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div style={{ marginTop: 6, paddingTop: 6, borderTop: "1px solid var(--border)" }}>
      {!showStravaPicker ? (
        <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
          <input
            type="number"
            min={1}
            placeholder="Actual mins"
            value={manualMinutes}
            onChange={(e) => setManualMinutes(e.target.value.replace(/[^0-9]/g, ""))}
            style={{ width: 90, padding: 6 }}
          />
          <button
            onClick={saveManual}
            disabled={saving || !manualMinutes}
            style={{
              padding: "6px 10px",
              fontSize: 12,
              borderRadius: 6,
              border: "none",
              background: "var(--border)",
              color: "var(--text-dim)",
              cursor: "pointer",
            }}
          >
            Log time
          </button>
          {stravaConnected && (
            <button
              onClick={openStravaPicker}
              style={{
                padding: "6px 10px",
                fontSize: 12,
                borderRadius: 6,
                border: "none",
                background: "var(--accent)",
                color: "var(--on-accent)",
                cursor: "pointer",
              }}
            >
              Sync from Strava
            </button>
          )}
        </div>
      ) : (
        <div>
          <div className="text-dim" style={{ fontSize: 11, marginBottom: 4 }}>
            Strava activities that day:
          </div>
          {stravaLoading ? (
            <p className="text-dim" style={{ fontSize: 12 }}>
              Loading...
            </p>
          ) : stravaActivities && stravaActivities.length > 0 ? (
            stravaActivities.map((a) => (
              <button
                key={a.id}
                onClick={() => linkActivity(a)}
                disabled={saving}
                style={{
                  display: "block",
                  width: "100%",
                  textAlign: "left",
                  padding: 6,
                  marginBottom: 4,
                  fontSize: 12,
                  borderRadius: 6,
                  border: "none",
                  background: "var(--border)",
                  color: "var(--text)",
                  cursor: "pointer",
                }}
              >
                {a.name} ({a.type}) — {formatHoursMinutes(a.movingMinutes)}, {a.distanceMiles}mi
              </button>
            ))
          ) : (
            <p className="text-dim" style={{ fontSize: 12 }}>
              No Strava activities found that day.
            </p>
          )}
          <button
            onClick={() => setShowStravaPicker(false)}
            style={{
              fontSize: 11,
              background: "none",
              border: "none",
              color: "var(--text-dim)",
              cursor: "pointer",
              padding: 0,
              marginTop: 4,
            }}
          >
            Cancel
          </button>
        </div>
      )}
      {error && <p style={{ color: "var(--danger)", fontSize: 11, marginTop: 4 }}>{error}</p>}
    </div>
  );
}
