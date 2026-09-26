import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { api, MovementPattern } from "../lib/api.js";
import { usePlan } from "../lib/planContext.js";

const PATTERNS: { key: MovementPattern; label: string }[] = [
  { key: "PUSH", label: "Push" },
  { key: "PULL", label: "Pull" },
  { key: "LEGS", label: "Legs" },
  { key: "CORE", label: "Core" },
];

export default function Workout() {
  const { plan, setPlan } = usePlan();
  const navigate = useNavigate();
  const [loading, setLoading] = useState<MovementPattern | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function handleGenerate(pattern: MovementPattern) {
    setLoading(pattern);
    setError(null);
    try {
      const result = await api.generatePlan(pattern);
      setPlan(result);
      navigate("/log");
    } catch (err: any) {
      setError(err.message ?? "Failed to generate workout");
    } finally {
      setLoading(null);
    }
  }

  return (
    <div>
      <p className="text-dim">Pick a session — you'll get every exercise, weight, reps, sets, and rest time in one go.</p>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, marginBottom: 16 }}>
        {PATTERNS.map((p) => (
          <button
            key={p.key}
            className="button-primary"
            onClick={() => handleGenerate(p.key)}
            disabled={loading !== null}
            style={{ opacity: loading && loading !== p.key ? 0.6 : 1 }}
          >
            {loading === p.key ? "Building..." : p.label}
          </button>
        ))}
      </div>

      {error && <p style={{ color: "var(--danger)" }}>{error}</p>}

      {plan && (
        <div>
          <div className="card" style={{ marginBottom: 12, textAlign: "center" }}>
            <div className="text-dim" style={{ fontSize: 13 }}>
              {plan.movementPattern} DAY · ~{plan.estimatedMinutes} min
            </div>
          </div>

          {plan.exercises.map((ex, i) => (
            <div key={ex.exerciseId} className="card" style={{ marginBottom: 10 }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
                <strong>
                  {i + 1}. {ex.name}
                </strong>
              </div>

              <div style={{ fontSize: 20, fontWeight: 700, marginTop: 6 }}>
                {ex.bandLevel
                  ? `${ex.bandLevel} band`
                  : ex.suggestedWeightLb > 0
                  ? `${ex.suggestedWeightLb}lb`
                  : "Bodyweight"}
                {" × "}
                {ex.suggestedReps} reps × {ex.suggestedSets} sets
              </div>

              <div className="text-dim" style={{ fontSize: 13, marginTop: 4 }}>
                Rest {ex.restSeconds}s between sets
              </div>

              <p className="text-dim" style={{ marginTop: 8, marginBottom: 0, fontSize: 14 }}>
                {ex.reasoning}
              </p>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
