import { useEffect, useRef, useState } from "react";
import { api, SetInput, PlannedExercise, ReadinessLevel, WorkoutProgress } from "../lib/api.js";
import { usePlan } from "../lib/planContext.js";
import { Equipment, EquipmentSetting } from "../lib/equipment.js";
import { FOCUS_LABELS } from "../lib/activity.js";

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

/** The live, set-by-set strength log for the workout in progress.
 * Rendered by the Log tab's Strength view once a session has been built.
 * Everything entered is saved to the server as you go (see
 * lib/planContext.tsx), so the workout can be continued on another device. */
export default function LogWorkout({ onSaved }: { onSaved: (sessionId: string) => void }) {
  const { plan, closeWorkout, markSaved, remoteProgress, remoteVersion, saveProgress } = usePlan();
  const plannedSessionId = plan?.plannedSessionId ?? null;
  const [rows, setRows] = useState<Record<string, SetRow[]>>({});
  const [startedAt, setStartedAt] = useState<string | null>(null);
  const [sleepQuality, setSleepQuality] = useState<ReadinessLevel | null>(null);
  const [soreness, setSoreness] = useState<ReadinessLevel | null>(null);
  const [energyLevel, setEnergyLevel] = useState<ReadinessLevel | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [syncError, setSyncError] = useState<string | null>(null);
  // What the person sees about saving: the workout and everything entered
  // is stored on their account, so say so (and when it last happened).
  const [syncState, setSyncState] = useState<"saved" | "saving" | "error">("saved");
  const [savedAt, setSavedAt] = useState<Date | null>(null);
  // True when this device has changes the server doesn't have yet.
  const dirtyRef = useRef(false);
  // The equipment of the gym this workout was built for (what weights/bands
  // can actually be selected), loaded from Settings > Gyms.
  const [equipment, setEquipment] = useState<Record<Equipment, EquipmentSetting> | null>(null);
  const gymId = plan?.gymId;

  useEffect(() => {
    api
      .getGyms()
      .then((res) => {
        // Workouts built before gyms existed have no gymId: use the active one.
        const gym = res.gyms.find((g) => g.id === (gymId ?? res.activeGymId)) ?? res.gyms[0];
        setEquipment(Object.fromEntries(gym.equipment.map((i) => [i.equipment, i])) as Record<Equipment, EquipmentSetting>);
      })
      .catch(() => setError("Couldn't load your equipment settings"));
  }, [gymId]);

  // (Re)load whenever the workout arrives or is replaced from the server:
  // saved progress if there is any, otherwise a fresh start.
  useEffect(() => {
    if (!plan) return;
    const saved = remoteProgress;
    const initial: Record<string, SetRow[]> = {};
    for (const ex of plan.exercises) {
      initial[ex.exerciseId] = saved?.rows[ex.exerciseId] ?? Array.from({ length: ex.suggestedSets }, () => makeDefaultRow(ex));
    }
    setRows(initial);
    setStartedAt(saved?.startedAt ?? new Date().toISOString());
    setSleepQuality(saved?.sleepQuality ?? null);
    setSoreness(saved?.soreness ?? null);
    setEnergyLevel(saved?.energyLevel ?? null);
    setSyncError(null);
    setSyncState("saved");
    setSavedAt(new Date(plan.updatedAt ?? plan.createdAt));
    // A brand-new workout saves its start time straight away, so another
    // device picks up the same one.
    dirtyRef.current = !saved;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [remoteVersion]);

  // Save progress shortly after each change...
  const progress: WorkoutProgress = { rows, startedAt, sleepQuality, soreness, energyLevel };
  const progressRef = useRef(progress);
  progressRef.current = progress;

  async function flush() {
    if (!dirtyRef.current || Object.keys(progressRef.current.rows).length === 0) return;
    dirtyRef.current = false;
    setSyncState("saving");
    try {
      await saveProgress(progressRef.current);
      setSyncError(null);
      setSyncState("saved");
      setSavedAt(new Date());
    } catch {
      dirtyRef.current = true;
      setSyncState("error");
      setSyncError("Couldn't save your progress to your account. It's kept on this device; check your connection.");
    }
  }

  useEffect(() => {
    if (!dirtyRef.current) return;
    setSyncState("saving");
    const timer = setTimeout(flush, 600);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rows, startedAt, sleepQuality, soreness, energyLevel]);

  // ...and immediately when the app goes to the background (switching to
  // another device usually starts with putting this one down).
  useEffect(() => {
    const onHide = () => {
      if (document.visibilityState === "hidden") flush();
    };
    document.addEventListener("visibilitychange", onHide);
    return () => document.removeEventListener("visibilitychange", onHide);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [saveProgress]);

  if (!plan) return null;
  if (!equipment) return <p className="text-dim">{error ?? "Loading your equipment..."}</p>;

  function updateRow(exerciseId: string, index: number, patch: Partial<SetRow>) {
    dirtyRef.current = true;
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
        focus: plan!.movementPattern,
        plannedSessionId: plannedSessionId ?? undefined,
        workoutId: plan!.workoutId,
        gymId: plan!.gymId,
      });
      // Today's workout is now marked done (on every device).
      dirtyRef.current = false;
      markSaved(session.id);
      onSaved(session.id);
    } catch (err: any) {
      setError(err.message ?? "Failed to save session");
    } finally {
      setSaving(false);
    }
  }

  // Leaves the workout (it stays saved for today, progress included) and
  // goes back to the build page.
  async function backToBuildPage() {
    await flush();
    closeWorkout();
  }

  return (
    <div>
      <div className="card" style={{ marginBottom: 12, borderLeft: "4px solid #2a78d6" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
          <strong style={{ color: "var(--navy)", fontSize: 16 }}>{FOCUS_LABELS[plan.movementPattern] ?? plan.movementPattern} day</strong>
          <span className="text-dim" style={{ fontSize: 13 }}>~{plan.estimatedMinutes} min</span>
        </div>
        <div style={{ fontSize: 12, fontWeight: 600, marginTop: 4, color: syncState === "error" ? "var(--danger)" : "var(--good)" }}>
          {syncState === "saving"
            ? "Saving to your account…"
            : syncState === "error"
            ? "Not saved to your account yet. Check your connection."
            : `✓ Saved to your account${savedAt ? ` · ${savedAt.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}` : ""}`}
        </div>
        {plan.block && (
          <div className="text-dim" style={{ fontSize: 12, marginTop: 4 }}>
            {plan.block.isNew
              ? `New ${plan.block.totalWeeks}-week block: exercises rotated to cover the angles you've done least.`
              : `Week ${plan.block.week} of ${plan.block.totalWeeks} in this block. Same exercises, so you can keep adding load.`}
          </div>
        )}
        {plan.block?.swaps.length > 0 && (
          <div className="text-dim" style={{ fontSize: 12, marginTop: 4 }}>
            Swapped this block: {plan.block.swaps.map((s) => `${s.out} → ${s.in}`).join("; ")} (stopped progressing).
          </div>
        )}
        {plan.recoveringMuscles?.length > 0 && (
          <div style={{ fontSize: 12, marginTop: 6, color: "var(--accent)" }}>
            Still recovering: {plan.recoveringMuscles.join(", ")}. Loads are held back a little for those.
          </div>
        )}
        <button className="button-quiet" style={{ marginTop: 8 }} onClick={backToBuildPage}>
          ‹ Back (your progress is kept)
        </button>
      </div>

      <ReadinessCheckIn
        sleepQuality={sleepQuality}
        soreness={soreness}
        energyLevel={energyLevel}
        onChange={(field, value) => {
          dirtyRef.current = true;
          if (field === "sleepQuality") setSleepQuality(value);
          if (field === "soreness") setSoreness(value);
          if (field === "energyLevel") setEnergyLevel(value);
        }}
      />

      {plan.exercises.map((exercise) => (
        <ExerciseCard
          key={exercise.exerciseId}
          exercise={exercise}
          config={equipment[exercise.equipment]}
          rows={rows[exercise.exerciseId] ?? []}
          onChange={(i, patch) => updateRow(exercise.exerciseId, i, patch)}
          onToggle={(i) => toggleLogged(exercise.exerciseId, i)}
        />
      ))}

      {syncError && <p className="text-dim" style={{ fontSize: 12 }}>{syncError}</p>}
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
              color: value === opt.value ? "var(--on-accent)" : "var(--text-dim)",
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

export function FeedbackPrompt({ sessionId, onDone }: { sessionId: string; onDone: () => void }) {
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
        Done
      </button>
    </div>
  );
}

/** The user's loadable weights, plus the row's current value if their gear
 * settings changed after this workout was generated (so the select never
 * shows a value that isn't one of its options). */
function weightChoices(config: EquipmentSetting, current: number): number[] {
  return config.weightsLb.includes(current) ? config.weightsLb : [...config.weightsLb, current].sort((a, b) => a - b);
}

function bandOptions(config: EquipmentSetting, current: string): string[] {
  return current && !config.bandLevels.includes(current) ? [...config.bandLevels, current] : config.bandLevels;
}

function ExerciseCard({
  exercise,
  config,
  rows,
  onChange,
  onToggle,
}: {
  exercise: PlannedExercise;
  config: EquipmentSetting;
  rows: SetRow[];
  onChange: (index: number, patch: Partial<SetRow>) => void;
  onToggle: (index: number) => void;
}) {
  return (
    <div className="card" style={{ marginBottom: 12 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
        <strong>{exercise.name}</strong>
        <span className="text-dim" style={{ fontSize: 12 }}>
          {config.label} · rest {exercise.restSeconds}s
        </span>
      </div>

      {exercise.selectionNote && (
        <div className="text-dim" style={{ fontSize: 12, marginTop: 4, fontStyle: "italic" }}>
          {exercise.selectionNote}
        </div>
      )}
      {exercise.reasoning && (
        <div className="text-dim" style={{ fontSize: 12, marginTop: 2 }}>
          {exercise.reasoning}
        </div>
      )}
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
                  {bandOptions(config, row.bandLevel).map((lvl) => (
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
                  {weightChoices(config, row.weightLb)
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
                  color: row.logged ? "var(--on-accent)" : "var(--text-dim)",
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
                      color: row.rpe === n ? "var(--on-accent)" : "var(--text-dim)",
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
