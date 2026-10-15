import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import {
  api,
  Balance,
  Benchmarks,
  BodyGoal,
  BodyMeasurement,
  BodyMetric,
  QuarterReview,
  RevisionReason,
  StepsResponse,
  StrengthSeries,
} from "../lib/api.js";
import { formatLocalDateKey } from "../lib/location.js";
import { ACTIVITY_COLORS, MUSCLE_LABELS } from "../lib/activity.js";
import { TimeChart, DailyBarChart, Meter, Line, Marker } from "../components/charts.js";
import PeriodCompare, { CompareRow } from "../components/PeriodCompare.js";
import Collapsible from "../components/Collapsible.js";

// Progress: one tab, four sub-tabs. Goals (body goals + setting/revising
// them, benchmarks, the quarterly review), Strength (lift progression),
// Balance (recovery + variation coverage) and Steps. Every sub-tab has a
// trend view and the same period-on-period comparison.

type SubTab = "goals" | "strength" | "balance" | "steps";
const SUBTABS: { key: SubTab; label: string }[] = [
  { key: "goals", label: "Goals" },
  { key: "strength", label: "Strength" },
  { key: "balance", label: "Balance" },
  { key: "steps", label: "Steps" },
];
const SUBTAB_KEY = "progress_subtab";

export default function Progress() {
  const [tab, setTab] = useState<SubTab>(() => {
    try {
      return (localStorage.getItem(SUBTAB_KEY) as SubTab) || "goals";
    } catch {
      return "goals";
    }
  });
  function choose(t: SubTab) {
    setTab(t);
    try {
      localStorage.setItem(SUBTAB_KEY, t);
    } catch {
      /* per-viewer convenience only */
    }
  }
  return (
    <div>
      <div className="subtabs" role="tablist" aria-label="Progress views">
        {SUBTABS.map((t) => (
          <button key={t.key} role="tab" aria-selected={tab === t.key} onClick={() => choose(t.key)}>
            {t.label}
          </button>
        ))}
      </div>
      {tab === "goals" && <GoalsTab />}
      {tab === "strength" && <StrengthTab />}
      {tab === "balance" && <BalanceTab />}
      {tab === "steps" && <StepsTab />}
    </div>
  );
}

// --- Goals -----------------------------------------------------------------

const METRICS: { key: BodyMetric; label: string; unit: string; field: "bodyFatPct" | "muscleMassKg" | "weightKg" }[] = [
  { key: "BODY_FAT_PCT", label: "Body fat", unit: "%", field: "bodyFatPct" },
  { key: "MUSCLE_MASS_KG", label: "Muscle mass", unit: " kg", field: "muscleMassKg" },
  { key: "BODY_WEIGHT_KG", label: "Body weight", unit: " kg", field: "weightKg" },
];
const metricInfo = (m: BodyMetric) => METRICS.find((x) => x.key === m)!;

const REASONS: { key: RevisionReason; label: string }[] = [
  { key: "INJURY_OR_ILLNESS", label: "Injury or illness" },
  { key: "LIFE_EVENT", label: "Life event (travel, work, family)" },
  { key: "TOO_AMBITIOUS", label: "Target was too ambitious" },
  { key: "TOO_EASY", label: "Target was too easy" },
  { key: "CHANGED_PRIORITIES", label: "Changed priorities" },
  { key: "OTHER", label: "Other" },
];
const reasonLabel = (r: RevisionReason | null) => REASONS.find((x) => x.key === r)?.label ?? "No reason given";

function fmtDay(iso: string): string {
  return new Date(iso).toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" });
}

function GoalsTab() {
  const [goals, setGoals] = useState<BodyGoal[] | null>(null);
  const [measurements, setMeasurements] = useState<BodyMeasurement[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [logging, setLogging] = useState(false);
  const [version, setVersion] = useState(0);

  function reload() {
    setVersion((v) => v + 1);
  }

  useEffect(() => {
    Promise.all([api.getGoals(), api.getMeasurements()])
      .then(([g, m]) => {
        setGoals(g);
        setMeasurements(m);
      })
      .catch((e) => setError(e.message));
  }, [version]);

  const active = (goals ?? []).filter((g) => g.status === "ACTIVE");
  const past = (goals ?? []).filter((g) => g.status !== "ACTIVE");
  const latest = (field: "bodyFatPct" | "muscleMassKg" | "weightKg") =>
    [...measurements].reverse().find((m) => m[field] != null)?.[field] ?? null;

  const directionFor = (metric: BodyMetric): "up" | "down" | "neutral" => {
    const g = active.find((x) => x.metric === metric);
    if (g) return g.direction === 1 ? "up" : "down";
    return metric === "BODY_FAT_PCT" ? "down" : metric === "MUSCLE_MASS_KG" ? "up" : "neutral";
  };

  return (
    <div>
      {error && <p style={{ color: "var(--danger)" }}>{error}</p>}

      <Collapsible title="How you compare" rememberAs="progress-compare">
        <BenchmarksCard version={version} />
      </Collapsible>

      <Collapsible title="Body goals" hint={goals ? (active.length ? `${active.length} active` : "none yet") : undefined} rememberAs="progress-goals">
      <div style={{ display: "flex", justifyContent: "flex-end", alignItems: "center", marginTop: 8 }}>
        <div style={{ display: "flex", gap: 6 }}>
          <button className="button-quiet" onClick={() => setLogging((v) => !v)}>
            + Scan
          </button>
          <button className="button-quiet" onClick={() => setAdding((v) => !v)} style={{ color: "var(--accent)", fontWeight: 700 }}>
            + Goal
          </button>
        </div>
      </div>

      {logging && (
        <MeasurementForm
          onDone={() => {
            setLogging(false);
            reload();
          }}
        />
      )}
      {adding && (
        <NewGoalForm
          latest={latest}
          onDone={() => {
            setAdding(false);
            reload();
          }}
        />
      )}

      {goals === null && !error && <p className="text-dim">Loading…</p>}
      {goals && active.length === 0 && !adding && (
        <div className="card">
          <p style={{ margin: 0 }}>No active goals.</p>
          <p className="text-dim" style={{ fontSize: 13, marginBottom: 0 }}>
            Set a number to aim for, like body fat to 18% by 1 March. Your scans are tracked against it, with a pace line that shows whether you're on track.
            {measurements.length === 0 && " Log a scan first so the goal has a starting point."}
          </p>
        </div>
      )}
      {active.map((g) => (
        <GoalCard key={g.id} goal={g} onChanged={reload} />
      ))}

      {past.length > 0 && (
        <details style={{ marginTop: 12 }}>
          <summary className="text-dim" style={{ cursor: "pointer", fontSize: 13 }}>
            Past goals ({past.length})
          </summary>
          {past.map((g) => (
            <GoalCard key={g.id} goal={g} onChanged={reload} />
          ))}
        </details>
      )}
      </Collapsible>

      {measurements.length > 0 && (
        <Collapsible title="Recent scans" hint={`${measurements.length} logged`} rememberAs="progress-scans">
          <RecentScans measurements={measurements} onChanged={reload} />
        </Collapsible>
      )}

      <Collapsible title="Quarterly goal review" rememberAs="progress-quarterly">
        <QuarterlyReviewCard version={version} />
      </Collapsible>

      <Collapsible title="Compare periods" rememberAs="progress-goals-compare">
      <PeriodCompare
        hideTitle
        reloadKey={version}
        load={async (a, b) => {
          const [sa, sb] = await Promise.all([api.getBodySummary(a.from, a.to), api.getBodySummary(b.from, b.to)]);
          return METRICS.filter((m) => sa[m.key].count + sb[m.key].count > 0).map(
            (m): CompareRow => ({
              label: `${m.label} (average)`,
              current: sa[m.key].average,
              previous: sb[m.key].average,
              unit: m.unit,
              decimals: 1,
              betterWhen: directionFor(m.key),
            })
          );
        }}
      />
      </Collapsible>
    </div>
  );
}

function GoalCard({ goal, onChanged }: { goal: BodyGoal; onChanged: () => void }) {
  const [revising, setRevising] = useState(false);
  const [showHistory, setShowHistory] = useState(false);
  const info = metricInfo(goal.metric);
  const current = goal.targets[goal.targets.length - 1];
  const previous = goal.targets.slice(0, -1);
  const pace = goal.pace;
  const good = pace.state === "AHEAD" || pace.state === "ON_TRACK" || pace.state === "REACHED";

  // Readings: the actual trend, bold. Current pace line: bold dashed.
  // Earlier pace lines (from before each revision): faint ghosts. A faint
  // marker at each revision point; tap it to see what changed.
  const lines: Line[] = [
    ...previous.map((t) => ({
      points: [
        { x: new Date(t.anchorDate), y: t.anchorValue },
        { x: new Date(t.targetDate), y: t.targetValue },
      ],
      color: "var(--text-dim)",
      dashed: true,
      opacity: 0.3,
      width: 1.5,
    })),
    {
      points: [
        { x: new Date(current.anchorDate), y: current.anchorValue },
        { x: new Date(current.targetDate), y: current.targetValue },
      ],
      color: "var(--text-dim)",
      dashed: true,
      width: 2,
      name: "Pace",
    },
    {
      points: goal.readings.map((r) => ({ x: new Date(r.date), y: r.value })),
      color: "var(--navy)",
      dots: true,
      name: info.label,
    },
  ];
  const markers: Marker[] = goal.targets.slice(1).map((t, i) => {
    const before = goal.targets[i];
    const fmtT = (v: { targetValue: number; targetDate: string }) => `${v.targetValue}${info.unit.trim()} by ${fmtDay(v.targetDate)}`;
    return {
      x: new Date(t.anchorDate),
      label: `Revised ${fmtT(before)} → ${fmtT(t)} (${reasonLabel(t.reason).toLowerCase()})`,
    };
  });

  return (
    <div className="card" style={{ marginBottom: 12 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 8 }}>
        <div>
          <div style={{ fontWeight: 700, color: "var(--navy)" }}>{info.label}</div>
          <div style={{ fontSize: 22, fontWeight: 700, marginTop: 2 }}>
            {pace.latest ? `${pace.latest.value}${info.unit}` : "—"}
            <span className="text-dim" style={{ fontSize: 14, fontWeight: 500 }}>
              {" "}
              → {current.targetValue}
              {info.unit} by {fmtDay(current.targetDate)}
            </span>
          </div>
        </div>
        {goal.status === "ACTIVE" ? (
          <span className={good ? "chip" : "chip chip-accent"} style={good ? { background: "#e6f2ec", color: "var(--good)" } : undefined}>
            {pace.state === "REACHED" ? "✓ " : pace.state === "BEHIND" ? "▼ " : pace.state === "AHEAD" ? "▲ " : ""}
            {pace.label}
          </span>
        ) : (
          <span className="chip">{goal.status === "ACHIEVED" ? "✓ Achieved" : "Closed"}</span>
        )}
      </div>

      <div style={{ marginTop: 10 }}>
        <TimeChart
          lines={lines}
          markers={markers}
          target={{ x: new Date(current.targetDate), y: current.targetValue, label: `Target: ${current.targetValue}${info.unit}` }}
          unit={info.unit}
          ariaLabel={`${info.label} readings against the pace line to ${current.targetValue}${info.unit} by ${fmtDay(current.targetDate)}`}
        />
      </div>
      <div className="text-dim" style={{ fontSize: 12, display: "flex", gap: 12, flexWrap: "wrap", marginTop: 4 }}>
        <span>
          <span className="swatch" style={{ background: "var(--navy)", borderRadius: 5, marginRight: 4 }} />
          Your scans
        </span>
        <span>
          <span style={{ display: "inline-block", width: 14, borderTop: "2px dashed var(--text-dim)", marginRight: 4, verticalAlign: "middle" }} />
          Pace to target
        </span>
        <span>
          <span className="swatch" style={{ background: "var(--accent)", borderRadius: 5, marginRight: 4 }} />
          Target
        </span>
        {previous.length > 0 && (
          <span>
            <span style={{ display: "inline-block", width: 14, borderTop: "2px dashed var(--text-dim)", opacity: 0.4, marginRight: 4, verticalAlign: "middle" }} />
            Earlier targets (tap a marker)
          </span>
        )}
      </div>

      {pace.projectedAtTarget != null && goal.status === "ACTIVE" && (
        <p className="text-dim" style={{ fontSize: 13, marginBottom: 0 }}>
          At your current trend you'd be at about {pace.projectedAtTarget}
          {info.unit} on {fmtDay(current.targetDate)}.
        </p>
      )}

      {goal.status === "ACTIVE" && !revising && (
        <div style={{ display: "flex", gap: 6, marginTop: 10, flexWrap: "wrap" }}>
          <button className="button-quiet" onClick={() => setRevising(true)}>
            Revise target
          </button>
          <button
            className="button-quiet"
            onClick={async () => {
              await api.setGoalStatus(goal.id, "ACHIEVED");
              onChanged();
            }}
          >
            Mark achieved
          </button>
          <button
            className="button-quiet"
            onClick={async () => {
              await api.setGoalStatus(goal.id, "CLOSED");
              onChanged();
            }}
          >
            Close goal
          </button>
          {previous.length > 0 && (
            <button className="button-quiet" onClick={() => setShowHistory((v) => !v)}>
              {showHistory ? "Hide" : "Show"} revision history ({previous.length})
            </button>
          )}
        </div>
      )}
      {goal.status !== "ACTIVE" && previous.length > 0 && (
        <button className="button-quiet" style={{ marginTop: 8 }} onClick={() => setShowHistory((v) => !v)}>
          {showHistory ? "Hide" : "Show"} revision history
        </button>
      )}

      {revising && (
        <ReviseForm
          goal={goal}
          onDone={() => {
            setRevising(false);
            onChanged();
          }}
          onCancel={() => setRevising(false)}
        />
      )}

      {showHistory && (
        <ol style={{ margin: "10px 0 0", paddingLeft: 18, fontSize: 13 }}>
          {goal.targets.map((t, i) => (
            <li key={i} style={{ marginBottom: 4 }}>
              {i === 0 ? "Set" : "Revised"} {fmtDay(t.createdAt)}: {t.targetValue}
              {info.unit} by {fmtDay(t.targetDate)}
              {i > 0 && (
                <span className="text-dim">
                  {" "}
                  · {t.revisionDirection === "EASIER" ? "easier" : t.revisionDirection === "HARDER" ? "harder" : "similar"} · {reasonLabel(t.reason).toLowerCase()}
                  {t.note ? ` · "${t.note}"` : ""}
                </span>
              )}
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}

function ReviseForm({ goal, onDone, onCancel }: { goal: BodyGoal; onDone: () => void; onCancel: () => void }) {
  const current = goal.targets[goal.targets.length - 1];
  const info = metricInfo(goal.metric);
  const [value, setValue] = useState(String(current.targetValue));
  const [date, setDate] = useState(current.targetDate.slice(0, 10));
  const [reason, setReason] = useState<RevisionReason | "">("");
  const [note, setNote] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  async function save() {
    if (!reason) {
      setError("Pick a reason. The quarterly review uses it to describe changes fairly.");
      return;
    }
    setSaving(true);
    setError(null);
    try {
      await api.reviseGoal(goal.id, {
        targetValue: Number(value) !== current.targetValue ? Number(value) : undefined,
        targetDate: date !== current.targetDate.slice(0, 10) ? date : undefined,
        reason,
        note: note || undefined,
      });
      onDone();
    } catch (e: any) {
      setError(typeof e.message === "string" ? e.message : "Couldn't save the revision");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div style={{ marginTop: 10, paddingTop: 10, borderTop: "1px solid var(--border)" }}>
      <div className="text-dim" style={{ fontSize: 12, marginBottom: 6 }}>
        Your current target is kept on record. The new pace line starts from where you are now.
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 6 }}>
        <label style={{ fontSize: 12 }}>
          New target ({info.unit.trim()})
          <input inputMode="decimal" value={value} onChange={(e) => setValue(e.target.value)} style={{ width: "100%", padding: 6 }} />
        </label>
        <label style={{ fontSize: 12 }}>
          By
          <input type="date" value={date} onChange={(e) => setDate(e.target.value)} style={{ width: "100%", padding: 6 }} />
        </label>
      </div>
      <select value={reason} onChange={(e) => setReason(e.target.value as RevisionReason)} style={{ width: "100%", padding: 6, marginTop: 6 }} aria-label="Reason">
        <option value="">Why are you changing it?</option>
        {REASONS.map((r) => (
          <option key={r.key} value={r.key}>
            {r.label}
          </option>
        ))}
      </select>
      <input placeholder="Note (optional)" value={note} onChange={(e) => setNote(e.target.value)} style={{ width: "100%", padding: 6, marginTop: 6 }} />
      {error && <p style={{ color: "var(--danger)", fontSize: 13 }}>{error}</p>}
      <div style={{ display: "flex", gap: 6, marginTop: 8 }}>
        <button className="button-quiet" onClick={onCancel} style={{ flex: 1 }}>
          Cancel
        </button>
        <button className="button-primary" onClick={save} disabled={saving} style={{ flex: 1 }}>
          {saving ? "Saving…" : "Save revision"}
        </button>
      </div>
    </div>
  );
}

function NewGoalForm({ latest, onDone }: { latest: (f: "bodyFatPct" | "muscleMassKg" | "weightKg") => number | null; onDone: () => void }) {
  const [metric, setMetric] = useState<BodyMetric>("BODY_FAT_PCT");
  const info = metricInfo(metric);
  const start = latest(info.field);
  const [startValue, setStartValue] = useState("");
  const [target, setTarget] = useState("");
  const [date, setDate] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  async function save() {
    setSaving(true);
    setError(null);
    try {
      await api.createGoal({
        metric,
        targetValue: Number(target),
        targetDate: date,
        startValue: startValue ? Number(startValue) : undefined,
      });
      onDone();
    } catch (e: any) {
      setError(typeof e.message === "string" ? e.message : "Couldn't create the goal");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="card" style={{ marginBottom: 12 }}>
      <strong style={{ color: "var(--navy)" }}>New body goal</strong>
      <select value={metric} onChange={(e) => setMetric(e.target.value as BodyMetric)} style={{ width: "100%", padding: 6, marginTop: 8 }} aria-label="Metric">
        {METRICS.map((m) => (
          <option key={m.key} value={m.key}>
            {m.label}
          </option>
        ))}
      </select>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 6, marginTop: 6 }}>
        <label style={{ fontSize: 12 }}>
          Now ({info.unit.trim()})
          <input inputMode="decimal" placeholder={start != null ? String(start) : "—"} value={startValue} onChange={(e) => setStartValue(e.target.value)} style={{ width: "100%", padding: 6 }} />
        </label>
        <label style={{ fontSize: 12 }}>
          Target
          <input inputMode="decimal" value={target} onChange={(e) => setTarget(e.target.value)} style={{ width: "100%", padding: 6 }} />
        </label>
        <label style={{ fontSize: 12 }}>
          By
          <input type="date" value={date} onChange={(e) => setDate(e.target.value)} style={{ width: "100%", padding: 6 }} />
        </label>
      </div>
      <div className="text-dim" style={{ fontSize: 12, marginTop: 4 }}>
        {start != null ? `"Now" defaults to your latest scan (${start}${info.unit}).` : "No scan for this yet. Enter where you are now."}
      </div>
      {error && <p style={{ color: "var(--danger)", fontSize: 13 }}>{error}</p>}
      <button className="button-primary" onClick={save} disabled={saving || !target || !date} style={{ width: "100%", marginTop: 8 }}>
        {saving ? "Saving…" : "Set goal"}
      </button>
    </div>
  );
}

function MeasurementForm({ onDone }: { onDone: () => void }) {
  const [date, setDate] = useState(formatLocalDateKey(new Date()));
  const [weight, setWeight] = useState("");
  const [fat, setFat] = useState("");
  const [muscle, setMuscle] = useState("");
  const [error, setError] = useState<string | null>(null);

  async function save() {
    setError(null);
    try {
      const now = new Date();
      const at = date === formatLocalDateKey(now) ? now : new Date(`${date}T08:00`);
      await api.addMeasurement({
        measuredAt: at.toISOString(),
        weightKg: weight ? Number(weight) : undefined,
        bodyFatPct: fat ? Number(fat) : undefined,
        muscleMassKg: muscle ? Number(muscle) : undefined,
      });
      onDone();
    } catch (e: any) {
      setError(typeof e.message === "string" ? e.message : "Couldn't save the scan");
    }
  }

  return (
    <div className="card" style={{ marginBottom: 12 }}>
      <strong style={{ color: "var(--navy)" }}>Add a scan by hand</strong>
      <div className="text-dim" style={{ fontSize: 12, marginTop: 2 }}>
        Renpho scans can come in automatically. See Settings → Data import.
      </div>
      <input type="date" value={date} onChange={(e) => setDate(e.target.value)} style={{ width: "100%", padding: 6, marginTop: 8 }} aria-label="Date" />
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 6, marginTop: 6 }}>
        <label style={{ fontSize: 12 }}>
          Weight (kg)
          <input inputMode="decimal" value={weight} onChange={(e) => setWeight(e.target.value)} style={{ width: "100%", padding: 6 }} />
        </label>
        <label style={{ fontSize: 12 }}>
          Body fat (%)
          <input inputMode="decimal" value={fat} onChange={(e) => setFat(e.target.value)} style={{ width: "100%", padding: 6 }} />
        </label>
        <label style={{ fontSize: 12 }}>
          Muscle (kg)
          <input inputMode="decimal" value={muscle} onChange={(e) => setMuscle(e.target.value)} style={{ width: "100%", padding: 6 }} />
        </label>
      </div>
      {error && <p style={{ color: "var(--danger)", fontSize: 13 }}>{error}</p>}
      <button className="button-primary" onClick={save} disabled={!weight && !fat && !muscle} style={{ width: "100%", marginTop: 8 }}>
        Save scan
      </button>
    </div>
  );
}

function RecentScans({ measurements, onChanged }: { measurements: BodyMeasurement[]; onChanged: () => void }) {
  if (measurements.length === 0) return null;
  const recent = [...measurements].reverse().slice(0, 5);
  return (
    <>
      <div className="card" style={{ marginTop: 6, padding: 10 }}>
        {recent.map((m) => (
          <div key={m.id} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", fontSize: 13, padding: "4px 0" }}>
            <span>
              {new Date(m.measuredAt).toLocaleDateString(undefined, { day: "numeric", month: "short" })} ·{" "}
              {[m.weightKg != null && `${m.weightKg} kg`, m.bodyFatPct != null && `${m.bodyFatPct}% fat`, m.muscleMassKg != null && `${m.muscleMassKg} kg muscle`]
                .filter(Boolean)
                .join(" · ")}
              <span className="text-dim"> · {m.source === "RENPHO" ? "Renpho" : m.source === "APPLE_HEALTH" ? "Apple Health" : "manual"}</span>
            </span>
            <button
              className="button-quiet"
              aria-label="Delete scan"
              onClick={async () => {
                await api.deleteMeasurement(m.id);
                onChanged();
              }}
            >
              ✕
            </button>
          </div>
        ))}
      </div>
    </>
  );
}

function BenchmarksCard({ version }: { version: number }) {
  const [data, setData] = useState<Benchmarks | null>(null);
  useEffect(() => {
    api.getBenchmarks().then(setData).catch(() => setData(null));
  }, [version]);
  if (!data) return null;
  if (!data.available) {
    return (
      <div className="card" style={{ marginBottom: 4 }}>
        <p className="text-dim" style={{ fontSize: 13, marginBottom: 0 }}>
          {data.reason}{" "}
          <Link to="/settings" style={{ color: "var(--accent)" }}>
            Settings
          </Link>
        </p>
      </div>
    );
  }
  return (
    <div className="card" style={{ marginBottom: 4 }}>
      {data.benchmarks.map((b) => (
        <div key={b.metric} style={{ marginTop: 8 }}>
          <div style={{ fontSize: 14 }}>
            <strong>{b.metric === "BMI" ? `BMI ${b.value}` : `Body fat ${b.value}%`}</strong>: {b.category}
          </div>
          <div className="text-dim" style={{ fontSize: 12 }}>
            {b.rangeText} <span style={{ opacity: 0.8 }}>({b.source})</span>
          </div>
        </div>
      ))}
      {data.reason && (
        <p className="text-dim" style={{ fontSize: 12, marginBottom: 0 }}>
          {data.reason}
        </p>
      )}
    </div>
  );
}

function quarterOptions(): string[] {
  const now = new Date();
  const out: string[] = [];
  let y = now.getFullYear();
  let q = Math.floor(now.getMonth() / 3) + 1;
  for (let i = 0; i < 4; i++) {
    out.push(`${y}-Q${q}`);
    q--;
    if (q === 0) {
      q = 4;
      y--;
    }
  }
  return out;
}

function QuarterlyReviewCard({ version }: { version: number }) {
  const options = useMemo(quarterOptions, []);
  const [quarter, setQuarter] = useState(options[0]);
  const [review, setReview] = useState<QuarterReview | null>(null);
  useEffect(() => {
    api.getQuarterReview(quarter).then(setReview).catch(() => setReview(null));
  }, [quarter, version]);

  return (
    <div className="card" style={{ marginTop: 12 }}>
      <div style={{ display: "flex", justifyContent: "flex-end", alignItems: "center" }}>
        <select value={quarter} onChange={(e) => setQuarter(e.target.value)} style={{ padding: "4px 6px", width: "100%" }} aria-label="Quarter">
          {options.map((q, i) => (
            <option key={q} value={q}>
              {i === 0 ? `${q.replace("-", " ")} (so far)` : q.replace("-", " ")}
            </option>
          ))}
        </select>
      </div>
      <p className="text-dim" style={{ fontSize: 12, margin: "4px 0 8px" }}>
        How ambitious your goals were, and how you recalibrated them. Revisions tagged with an injury or life event are counted separately.
      </p>
      {!review ? (
        <p className="text-dim" style={{ fontSize: 13 }}>Loading…</p>
      ) : (
        <>
          {review.summary.map((s, i) => (
            <p key={i} style={{ fontSize: 14, margin: "0 0 6px" }}>
              {s}
            </p>
          ))}
          {review.revisions.length > 0 && (
            <ul style={{ margin: "6px 0 0", paddingLeft: 18, fontSize: 12 }} className="text-dim">
              {review.revisions.map((r, i) => (
                <li key={i}>
                  {fmtDay(r.at)}: {metricInfo(r.metric).label.toLowerCase()} {r.targetChange}
                  {r.dateChangeDays !== 0 ? `, date ${r.dateChangeDays > 0 ? "pushed out" : "brought in"} ${Math.abs(Math.round(r.dateChangeDays / 7))} wk` : ""} ·{" "}
                  {r.direction.toLowerCase()} · {reasonLabel(r.reason).toLowerCase()}
                </li>
              ))}
            </ul>
          )}
        </>
      )}
    </div>
  );
}

// --- Strength ---------------------------------------------------------------

function StrengthTab() {
  const [series, setSeries] = useState<StrengthSeries[] | null>(null);
  const [selected, setSelected] = useState<string>("");

  useEffect(() => {
    api.getStrengthSeries().then((s) => {
      setSeries(s);
      if (s.length) setSelected(s[0].id);
    });
  }, []);

  const current = series?.find((s) => s.id === selected);

  return (
    <div>
      <Collapsible title="Strength progression" hint={series && series.length ? `${series.length} lift${series.length === 1 ? "" : "s"}` : undefined} rememberAs="progress-strength">
      <div className="card">
        <p className="text-dim" style={{ fontSize: 12, margin: "2px 0 8px" }}>
          Best set each session, as an estimated one-rep max (reps for bodyweight and band work).
        </p>
        {series === null ? (
          <p className="text-dim">Loading…</p>
        ) : series.length === 0 ? (
          <p className="text-dim" style={{ fontSize: 13 }}>
            Log a few workouts and your lifts will chart here.
          </p>
        ) : (
          <>
            <select value={selected} onChange={(e) => setSelected(e.target.value)} style={{ width: "100%", padding: 6, marginBottom: 8 }} aria-label="Exercise">
              {series.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name} ({s.points.length} session{s.points.length === 1 ? "" : "s"})
                </option>
              ))}
            </select>
            {current && (
              <>
                <TimeChart
                  lines={[{ points: current.points.map((p) => ({ x: new Date(p.date), y: p.value })), color: ACTIVITY_COLORS.STRENGTH, dots: true, name: current.unit === "reps" ? "Reps" : "e1RM" }]}
                  unit={current.unit === "reps" ? " reps" : " lb"}
                  ariaLabel={`${current.name} best set per session`}
                />
                <div className="text-dim" style={{ fontSize: 12, marginTop: 4 }}>
                  Latest: {current.points[current.points.length - 1].bestSet}
                  {current.points.length > 1 && ` · first logged: ${current.points[0].bestSet}`}
                </div>
              </>
            )}
          </>
        )}
      </div>
      </Collapsible>

      <Collapsible title="Compare periods" rememberAs="progress-strength-compare">
      <PeriodCompare
        hideTitle
        load={async (a, b) => {
          const [sa, sb] = await Promise.all([api.getStrengthSummary(a.from, a.to), api.getStrengthSummary(b.from, b.to)]);
          const rows: CompareRow[] = [
            { label: "Sessions", current: sa.sessions, previous: sb.sessions, betterWhen: "up" },
            { label: "Working sets", current: sa.sets, previous: sb.sets, betterWhen: "up" },
            { label: "Volume lifted", current: sa.volumeLb, previous: sb.volumeLb, unit: " lb", betterWhen: "up" },
            { label: "Sets that hit the target reps", current: sa.hitTargetPercent, previous: sb.hitTargetPercent, unit: "%", betterWhen: "up" },
            { label: "Average effort (RPE)", current: sa.averageRpe, previous: sb.averageRpe, decimals: 1, betterWhen: "neutral" },
          ];
          // Best estimated 1RM for lifts done in both periods.
          for (const [id, best] of Object.entries(sa.bestLifts)) {
            const before = sb.bestLifts[id];
            if (before) rows.push({ label: `${best.name} (best e1RM)`, current: best.value, previous: before.value, unit: " lb", decimals: 1, betterWhen: "up" });
          }
          return rows;
        }}
      />
      </Collapsible>
    </div>
  );
}

// --- Balance ----------------------------------------------------------------

function BalanceTab() {
  const [data, setData] = useState<Balance | null>(null);
  useEffect(() => {
    api.getBalance(28).then(setData);
  }, []);

  if (!data) return <p className="text-dim">Loading…</p>;
  const order = Object.keys(MUSCLE_LABELS);
  const coverage = [...data.coverage].sort((a, b) => order.indexOf(a.muscle) - order.indexOf(b.muscle));

  const recovering = data.recovery.filter((r) => r.status === "RECOVERING").length;

  return (
    <div>
      <Collapsible title="Recovery right now" hint={recovering ? `${recovering} recovering` : "all ready"} rememberAs="progress-recovery">
      <div className="card">
        <p className="text-dim" style={{ fontSize: 12, margin: "2px 0 8px" }}>
          Each muscle's clock restarts when you train it: about 3 days as the main target, 2 as a helper, longer after very hard sets.
        </p>
        {data.recovery.map((r) => (
          <div key={r.muscle} style={{ display: "grid", gridTemplateColumns: "92px 1fr 96px", alignItems: "center", gap: 8, padding: "5px 0" }}>
            <span style={{ fontSize: 13 }}>{MUSCLE_LABELS[r.muscle]}</span>
            <Meter percent={r.percentRecovered} color={r.status === "RECOVERING" ? "var(--navy-2)" : "var(--good)"} label={`${MUSCLE_LABELS[r.muscle]} ${r.percentRecovered}% recovered`} />
            <span className="text-dim" style={{ fontSize: 12, textAlign: "right" }}>
              {r.status === "READY" ? "✓ Ready" : r.status === "UNTRAINED" ? "Fresh" : `Ready in ${r.hoursUntilReady}h`}
            </span>
          </div>
        ))}
      </div>

      </Collapsible>

      <Collapsible title="Coverage, last 4 weeks" rememberAs="progress-coverage">
      <div className="card" style={{ marginTop: 12 }}>
        <p className="text-dim" style={{ fontSize: 12, margin: "2px 0 8px" }}>
          Sets per week for each muscle, and how evenly its different angles were worked. Highlighted angles got no sets. The next training block will rotate them in.
        </p>
        {coverage.map((c) => (
          <div key={c.muscle} style={{ padding: "6px 0", borderTop: "1px solid var(--border)" }}>
            <div style={{ display: "flex", justifyContent: "space-between", fontSize: 13 }}>
              <strong>{MUSCLE_LABELS[c.muscle]}</strong>
              <span className="text-dim">{c.weeklySets} sets/week</span>
            </div>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 4, marginTop: 4 }}>
              {c.variations.map((v) => (
                <span key={v.tag} className={v.sets === 0 ? "chip chip-accent" : "chip"}>
                  {v.label.replace(/^(chest|shoulder|triceps|back|biceps|quad|hamstring|glute|core) /, "")}: {v.sets}
                </span>
              ))}
            </div>
          </div>
        ))}
      </div>
      </Collapsible>

      <Collapsible title="Compare periods" rememberAs="progress-balance-compare">
      <PeriodCompare
        hideTitle
        load={async (a, b) => {
          const [sa, sb] = await Promise.all([api.getStrengthSummary(a.from, a.to), api.getStrengthSummary(b.from, b.to)]);
          return order
            .filter((m) => (sa.setsByMuscle as any)[m] || (sb.setsByMuscle as any)[m])
            .map((m) => ({
              label: `${MUSCLE_LABELS[m]} sets`,
              current: (sa.setsByMuscle as any)[m] ?? 0,
              previous: (sb.setsByMuscle as any)[m] ?? 0,
              betterWhen: "neutral" as const,
            }));
        }}
      />
      </Collapsible>
    </div>
  );
}

// --- Steps ------------------------------------------------------------------

function StepsTab() {
  const [data, setData] = useState<StepsResponse | null>(null);
  const [goalInput, setGoalInput] = useState("");
  const [entryDate, setEntryDate] = useState(formatLocalDateKey(new Date()));
  const [entrySteps, setEntrySteps] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [version, setVersion] = useState(0);

  const today = new Date();
  const to = formatLocalDateKey(new Date(today.getFullYear(), today.getMonth(), today.getDate() + 1));
  const from = formatLocalDateKey(new Date(today.getFullYear(), today.getMonth(), today.getDate() - 29));

  useEffect(() => {
    api.getSteps(from, to).then((d) => {
      setData(d);
      if (d.goal) setGoalInput(String(d.goal));
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [version]);

  async function saveGoal() {
    setError(null);
    try {
      await api.updateProfile({ dailyStepGoal: Number(goalInput) });
      setVersion((v) => v + 1);
    } catch (e: any) {
      setError(typeof e.message === "string" ? e.message : "Couldn't save the goal");
    }
  }

  async function saveEntry() {
    setError(null);
    try {
      await api.setSteps(entryDate, Number(entrySteps));
      setEntrySteps("");
      setVersion((v) => v + 1);
    } catch (e: any) {
      setError(typeof e.message === "string" ? e.message : "Couldn't save steps");
    }
  }

  if (!data) return <p className="text-dim">Loading…</p>;
  const goal = data.goal;
  const avg = data.average;
  const onTrack = goal != null && avg != null && avg >= goal;

  return (
    <div>
      <Collapsible title="Daily steps, last 30 days" hint={avg != null ? `${avg.toLocaleString()} avg` : undefined} rememberAs="progress-steps">
      <div className="card">
        <div style={{ display: "flex", alignItems: "baseline", gap: 8, marginTop: 6 }}>
          <span style={{ fontSize: 28, fontWeight: 700 }}>{avg != null ? avg.toLocaleString() : "—"}</span>
          <span className="text-dim" style={{ fontSize: 13 }}>
            average a day{goal != null ? ` · goal ${goal.toLocaleString()}` : ""}
          </span>
        </div>
        {goal != null && avg != null && (
          <div style={{ fontSize: 13, marginTop: 2, color: onTrack ? "var(--good)" : "var(--bad)", fontWeight: 600 }}>
            {onTrack ? "✓ Average is at or above your goal" : `▼ ${(goal - avg).toLocaleString()} a day below your goal`}
            <span className="text-dim" style={{ fontWeight: 400 }}>
              {" "}
              · goal reached on {data.daysHitGoal} of {data.daysWithData} days
            </span>
          </div>
        )}
        <div style={{ marginTop: 10 }}>
          <DailyBarChart
            bars={data.days.map((d) => ({ x: new Date(`${d.date}T12:00`), y: d.steps, label: `${d.steps.toLocaleString()} steps${d.hitGoal ? " ✓" : ""}` }))}
            color={ACTIVITY_COLORS.STEPS}
            reference={goal ? { y: goal, label: `Goal ${goal.toLocaleString()}` } : undefined}
            ariaLabel="Daily steps over the last 30 days"
          />
        </div>
        {data.days.length === 0 && (
          <p className="text-dim" style={{ fontSize: 13 }}>
            No steps yet. Set up the Apple Health shortcut in{" "}
            <Link to="/settings" style={{ color: "var(--accent)" }}>
              Settings → Data import
            </Link>
            , or add a day below.
          </p>
        )}
      </div>

      </Collapsible>

      <Collapsible title="Average daily step goal" hint={goal != null ? goal.toLocaleString() : "not set"} rememberAs="progress-step-goal">
      <div className="card" style={{ marginTop: 12 }}>
        <p className="text-dim" style={{ fontSize: 12, margin: "2px 0 6px" }}>
          The goal is an average. Progress compares your average with it, and the calendar ticks the days you reached it.
        </p>
        <div style={{ display: "flex", gap: 6 }}>
          <input inputMode="numeric" value={goalInput} onChange={(e) => setGoalInput(e.target.value.replace(/[^0-9]/g, ""))} placeholder="e.g. 8000" style={{ flex: 1, padding: 6 }} aria-label="Average daily step goal" />
          <button className="button-primary" onClick={saveGoal} disabled={!goalInput}>
            Save
          </button>
        </div>
        <div style={{ display: "flex", gap: 6, marginTop: 10 }}>
          <input type="date" value={entryDate} onChange={(e) => setEntryDate(e.target.value)} style={{ padding: 6 }} aria-label="Day" />
          <input inputMode="numeric" value={entrySteps} onChange={(e) => setEntrySteps(e.target.value.replace(/[^0-9]/g, ""))} placeholder="Steps" style={{ flex: 1, padding: 6, minWidth: 0 }} aria-label="Steps that day" />
          <button className="button-secondary" onClick={saveEntry} disabled={!entrySteps}>
            Add
          </button>
        </div>
        {error && <p style={{ color: "var(--danger)", fontSize: 13 }}>{error}</p>}
      </div>
      </Collapsible>

      <Collapsible title="Compare periods" rememberAs="progress-steps-compare">
      <PeriodCompare
        hideTitle
        reloadKey={version}
        load={async (a, b) => {
          const [sa, sb] = await Promise.all([api.getSteps(a.from, a.to), api.getSteps(b.from, b.to)]);
          const rows: CompareRow[] = [{ label: "Average daily steps", current: sa.average, previous: sb.average, betterWhen: "up" }];
          if (sa.goal != null) rows.push({ label: "Days the goal was reached", current: sa.daysHitGoal, previous: sb.daysHitGoal, betterWhen: "up" });
          rows.push({ label: "Days with step data", current: sa.daysWithData, previous: sb.daysWithData, betterWhen: "neutral" });
          return rows;
        }}
      />
      </Collapsible>
    </div>
  );
}
