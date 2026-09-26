import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { api, SetInput, PlannedExercise, ReadinessLevel } from "../lib/api.js";
import { usePlan } from "../lib/planContext.js";
import { EQUIPMENT_CONFIG, weightOptions } from "../lib/equipment.js";

interface SetRow {
  weightLb: number;
  bandLevel: string;
  reps: string; // kept as string while typing, parsed on save
  rpe: number | null;
  logged: boolean;
}

function makeDefaultRow(planned: PlannedExercise): SetRow {
  return {
    weightLb: planned.suggestedWeightLb,
    bandLevel: planned.bandLevel ?? "",
    reps: "", // actual reps performed — left blank, not assumed to match the suggestion
    rpe: null,
    logged: false,
  };
}

const READINESS_OPTIONS: { value: ReadinessLevel; label: string }[] = [
  { value: "LOW", label: "Low" },
  { value: "MEDIUM", label: "Medium" },
  { value: "HIGH", label: "High" },
];

export default function LogWorkout() {
  const { plan } = usePlan();
  const [rows, setRows] = useState<Record<string, SetRow[]>>({});
  const [startedAt, setStartedAt] = useState<string | null>(null);
  const [sleepQuality, setSleepQuality] = useState<ReadinessLevel | null>(null);
  const [soreness, setSoreness] = useState<ReadinessLevel | null>(null);
  const [energyLevel, setEnergyLevel] = useState<ReadinessLevel | null>(null);
  const [saving, setSaving] = useState(false);
  const [savedSessionId, setSavedSessionId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!plan) return;
    const initial: Record<string, SetRow[]> = {};
    for (const ex of plan.exercises) {
      initial[ex.exerciseId] = Array.from({ length: ex.suggestedSets }, () => makeDefaultRow(ex));
    }
    setRows(initial);
    // A fresh plan means a fresh session — reset timing and check-in state.
    setStartedAt(new Date().toISOString());
    setSleepQuality(null);
    setSoreness(null);
    setEnergyLevel(null);
    setSavedSessionId(null);
  }, [plan]);

  if (!plan) {
    return (
      <div className="card" style={{ textAlign: "center" }}>
        <p className="text-dim">No workout generated yet.</p>
        <Link to="/workout" className="button-primary" style={{ display: "inline-block", textDecoration: "none", marginTop: 4 }}>
          Pick Push, Pull, Legs, or Core
        </Link>
      </div>
    );
  }

  function updateRow(exerciseId: string, index: number, patch: Partial<SetRow>) {
    setRows((prev) => {
      const next = [...(prev[exerciseId] ?? [])];
      next[index] = { ...next[index], ...patch };
      return { ...prev, [exerciseId]: next };
    });
  }

  function toggleLogged(exerciseId: string, index: number) {
    const row = rows[exerciseId]?.[index];
    if (!row) return;
    if (!row.logged && row.reps === "") return; // require reps before logging
    updateRow(exerciseId, index, { logged: !row.logged });
  }

  async function saveWorkout() {
    const sets: SetInput[] = [];
    for (const exercise of plan!.exercises) {
      const exerciseRows = rows[exercise.exerciseId] ?? [];
      exerciseRows.forEach((row, i) => {
        if (!row.logged) return;
        sets.push({
          exerciseId: exercise.exerciseId,
          weightLb: row.weightLb,
          bandLevel: row.bandLevel || undefined,
          reps: Number(row.reps),
          targetReps: exercise.suggestedReps,
          rpe: row.rpe ?? undefined,
          setOrder: i,
        });
      });
    }

    if (sets.length === 0) {
      setError("Log at least one set (enter reps and tap the checkmark) before saving.");
      return;
    }

    setSaving(true);
    setError(null);
    try {
      const session = await api.logSession({
        startedAt: startedAt ?? undefined,
        endedAt: new Date().toISOString(),
        sleepQuality: sleepQuality ?? undefined,
        soreness: soreness ?? undefined,
        energyLevel: energyLevel ?? undefined,
        sets,
      });
      setSavedSessionId(session.id);
    } catch (err: any) {
      setError(err.message ?? "Failed to save session");
    } finally {
      setSaving(false);
    }
  }

  function startNewSession() {
    const reset: Record<string, SetRow[]> = {};
    for (const ex of plan!.exercises) {
      reset[ex.exerciseId] = Array.from({ length: ex.suggestedSets }, () => makeDefaultRow(ex));
    }
    setRows(reset);
    setStartedAt(new Date().toISOString());
    setSleepQuality(null);
    setSoreness(null);
    setEnergyLevel(null);
    setSavedSessionId(null);
  }

  if (savedSessionId) {
    return <FeedbackPrompt sessionId={savedSessionId} onDone={startNewSession} />;
  }

  return (
    <div>
      <div className="text-dim" style={{ fontSize: 13, marginBottom: 10 }}>
        {plan.movementPattern} DAY · ~{plan.estimatedMinutes} min
      </div>

      <ReadinessCheckIn
        sleepQuality={sleepQuality}
        soreness={soreness}
        energyLevel={energyLevel}
        onChange={(field, value) => {
          if (field === "sleepQuality") setSleepQuality(value);
          if (field === "soreness") setSoreness(value);
          if (field === "energyLevel") setEnergyLevel(value);
        }}
      />

      {plan.exercises.map((exercise) => (
        <ExerciseCard
          key={exercise.exerciseId}
          exercise={exercise}
          rows={rows[exercise.exerciseId] ?? []}
          onChange={(i, patch) => updateRow(exercise.exerciseId, i, patch)}
          onToggle={(i) => toggleLogged(exercise.exerciseId, i)}
        />
      ))}

      {error && <p style={{ color: "var(--danger)" }}>{error}</p>}

      <button className="button-primary" onClick={saveWorkout} disabled={saving} style={{ width: "100%", marginTop: 8 }}>
        {saving ? "Saving..." : "Save workout"}
      </button>
    </div>
  );
}

function ReadinessCheckIn({
  sleepQuality,
  soreness,
  energyLevel,
  onChange,
}: {
  sleepQuality: ReadinessLevel | null;
  soreness: ReadinessLevel | null;
  energyLevel: ReadinessLevel | null;
  onChange: (field: "sleepQuality" | "soreness" | "energyLevel", value: ReadinessLevel) => void;
}) {
  return (
    <div className="card" style={{ marginBottom: 12 }}>
      <div className="text-dim" style={{ fontSize: 12, marginBottom: 6 }}>
        Before you start — quick check-in
      </div>
      <ReadinessRow label="Sleep" value={sleepQuality} onSelect={(v) => onChange("sleepQuality", v)} />
      <ReadinessRow label="Soreness" value={soreness} onSelect={(v) => onChange("soreness", v)} />
      <ReadinessRow label="Energy" value={energyLevel} onSelect={(v) => onChange("energyLevel", v)} />
    </div>
  );
}

function ReadinessRow({
  label,
  value,
  onSelect,
}: {
  label: string;
  value: ReadinessLevel | null;
  onSelect: (v: ReadinessLevel) => void;
}) {
  return (
    <div style={{ display: "grid", gridTemplateColumns: "70px 1fr", alignItems: "center", gap: 8, padding: "4px 0" }}>
      <span style={{ fontSize: 13 }}>{label}</span>
      <div style={{ display: "flex", gap: 6 }}>
        {READINESS_OPTIONS.map((opt) => (
          <button
            key={opt.value}
            onClick={() => onSelect(opt.value)}
            style={{
              flex: 1,
              padding: "6px 0",
              fontSize: 12,
              borderRadius: 6,
              border: "none",
              cursor: "pointer",
              background: value === opt.value ? "var(--accent)" : "var(--border)",
              color: value === opt.value ? "#0e1512" : "var(--text-dim)",
              fontWeight: value === opt.value ? 700 : 400,
            }}
          >
            {opt.label}
          </button>
        ))}
      </div>
    </div>
  );
}

function FeedbackPrompt({ sessionId, onDone }: { sessionId: string; onDone: () => void }) {
  const [submitted, setSubmitted] = useState(false);

  async function handleFeedback(thumbsUp: boolean) {
    try {
      await api.submitFeedback(sessionId, thumbsUp);
    } finally {
      setSubmitted(true);
    }
  }

  return (
    <div className="card" style={{ textAlign: "center" }}>
      <p>Workout saved.</p>
      {!submitted ? (
        <>
          <p className="text-dim" style={{ fontSize: 13 }}>
            How did that plan feel?
          </p>
          <div style={{ display: "flex", gap: 12, justifyContent: "center", marginTop: 8 }}>
            <button
              onClick={() => handleFeedback(true)}
              style={{ fontSize: 28, background: "none", border: "none", cursor: "pointer" }}
              aria-label="Thumbs up"
            >
              👍
            </button>
            <button
              onClick={() => handleFeedback(false)}
              style={{ fontSize: 28, background: "none", border: "none", cursor: "pointer" }}
              aria-label="Thumbs down"
            >
              👎
            </button>
          </div>
        </>
      ) : (
        <p className="text-dim" style={{ fontSize: 13 }}>
          Thanks — noted.
        </p>
      )}
      <button className="button-primary" onClick={onDone} style={{ marginTop: 16, width: "100%" }}>
        Log another session
      </button>
    </div>
  );
}

function ExerciseCard({
  exercise,
  rows,
  onChange,
  onToggle,
}: {
  exercise: PlannedExercise;
  rows: SetRow[];
  onChange: (index: number, patch: Partial<SetRow>) => void;
  onToggle: (index: number) => void;
}) {
  const config = EQUIPMENT_CONFIG[exercise.equipment];

  return (
    <div className="card" style={{ marginBottom: 12 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
        <strong>{exercise.name}</strong>
        <span className="text-dim" style={{ fontSize: 12 }}>
          {config.label} · rest {exercise.restSeconds}s
        </span>
      </div>

      <div
        className="text-dim"
        style={{ fontSize: 12, marginTop: 4, paddingBottom: 8, borderBottom: "1px solid var(--border)" }}
      >
        Suggested (based on last time): {exercise.bandLevel ? `${exercise.bandLevel} band` : exercise.suggestedWeightLb > 0 ? `${exercise.suggestedWeightLb}lb` : "Bodyweight"} × {exercise.suggestedReps} reps
      </div>

      <div style={{ marginTop: 6 }}>
        <div
          className="text-dim"
          style={{ display: "grid", gridTemplateColumns: "24px 1fr 70px 32px", gap: 8, fontSize: 11, padding: "4px 0" }}
        >
          <span />
          <span>Actual weight</span>
          <span>Reps</span>
          <span />
        </div>

        {rows.map((row, i) => (
          <div key={i} style={{ padding: "6px 0", opacity: row.logged ? 1 : 0.9 }}>
            <div
              style={{
                display: "grid",
                gridTemplateColumns: "24px 1fr 70px 32px",
                gap: 8,
                alignItems: "center",
              }}
            >
              <span className="text-dim" style={{ fontSize: 13 }}>
                {i + 1}
              </span>

              {config.kind === "band" ? (
                <select
                  value={row.bandLevel}
                  onChange={(e) => onChange(i, { bandLevel: e.target.value })}
                  disabled={row.logged}
                  style={{ padding: 6 }}
                >
                  {config.levels.map((lvl) => (
                    <option key={lvl} value={lvl}>
                      {lvl}
                    </option>
                  ))}
                </select>
              ) : (
                <select
                  value={row.weightLb}
                  onChange={(e) => onChange(i, { weightLb: Number(e.target.value) })}
                  disabled={row.logged}
                  style={{ padding: 6 }}
                >
                  {config.kind === "bodyweight" && <option value={0}>Bodyweight</option>}
                  {weightOptions(config)
                    .filter((v) => !(config.kind === "bodyweight" && v === 0))
                    .map((v) => (
                      <option key={v} value={v}>
                        {config.kind === "bodyweight" ? `+${v}lb` : `${v}lb`}
                      </option>
                    ))}
                </select>
              )}

              <input
                placeholder="reps"
                value={row.reps}
                onChange={(e) => onChange(i, { reps: e.target.value.replace(/[^0-9]/g, "") })}
                disabled={row.logged}
                style={{ padding: 6, width: "100%" }}
              />

              <button
                onClick={() => onToggle(i)}
                aria-label={row.logged ? "Edit set" : "Log set"}
                style={{
                  background: row.logged ? "var(--accent)" : "var(--border)",
                  color: row.logged ? "#0e1512" : "var(--text-dim)",
                  border: "none",
                  borderRadius: 6,
                  height: 32,
                  cursor: "pointer",
                  fontWeight: 700,
                }}
              >
                {row.logged ? "✓" : "○"}
              </button>
            </div>

            {!row.logged && (
              <div style={{ display: "flex", alignItems: "center", gap: 4, marginTop: 4, marginLeft: 32 }}>
                <span className="text-dim" style={{ fontSize: 10, marginRight: 2 }}>
                  RPE
                </span>
                {Array.from({ length: 10 }, (_, n) => n + 1).map((n) => (
                  <button
                    key={n}
                    onClick={() => onChange(i, { rpe: row.rpe === n ? null : n })}
                    style={{
                      width: 20,
                      height: 20,
                      fontSize: 10,
                      padding: 0,
                      borderRadius: 4,
                      border: "none",
                      cursor: "pointer",
                      background: row.rpe === n ? "var(--accent)" : "var(--border)",
                      color: row.rpe === n ? "#0e1512" : "var(--text-dim)",
                    }}
                  >
                    {n}
                  </button>
                ))}
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
