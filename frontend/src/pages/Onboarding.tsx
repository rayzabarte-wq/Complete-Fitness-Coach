import { useEffect, useState } from "react";
import { api, HorizonInfo, OnboardingSuggestion, PriorityLevel, Sport } from "../lib/api.js";
import { SPORT_LABELS } from "../lib/sports.js";
import { formatLocalDateKey, parseLocalDate } from "../lib/location.js";

// The welcome journey. Every question is optional, and so is the whole thing:
//   1. Three questions in your own words (nothing mandatory).
//   2. The sports to plan for, pre-ticked from what you wrote.
//   3. Weekly rhythm: sessions a week for strength / running / golf, steps.
//   4. How far ahead to plan (to the end of a calendar quarter, or a date),
//      then the plan is opened and the AI proposes an approach per sport.
// Shown once to new accounts, and from Settings any time after.

const SPORTS: Sport[] = ["STRENGTH", "RUN", "GOLF", "SWIM", "CYCLING", "CYCLING_TURBO", "WALK"];
const PRIORITIES: { value: PriorityLevel; label: string }[] = [
  { value: "HIGH", label: "Main focus" },
  { value: "MEDIUM", label: "Regular" },
  { value: "LOW", label: "Keep ticking over" },
];

type SportChoice = { on: boolean; priority: PriorityLevel; goalNote: string };

const longDate = (key: string) => parseLocalDate(key).toLocaleDateString(undefined, { day: "numeric", month: "long", year: "numeric" });

function Pills({ values, value, onChange, label }: { values: number[]; value: number; onChange: (n: number) => void; label: string }) {
  return (
    <div style={{ display: "flex", gap: 6, marginTop: 6 }} role="radiogroup" aria-label={label}>
      {values.map((n) => (
        <button
          key={n}
          role="radio"
          aria-checked={value === n}
          onClick={() => onChange(n)}
          style={{
            flex: 1,
            padding: "8px 0",
            borderRadius: 8,
            border: value === n ? "none" : "1px solid var(--border)",
            background: value === n ? "var(--accent)" : "var(--surface)",
            color: value === n ? "var(--on-accent)" : "var(--text)",
            fontWeight: 700,
            cursor: "pointer",
          }}
        >
          {n}
        </button>
      ))}
    </div>
  );
}

export default function Onboarding({ onDone }: { onDone: (openPlan: boolean) => void }) {
  const today = formatLocalDateKey(new Date());
  const [step, setStep] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // 1. prose
  const [goals, setGoals] = useState("");
  const [targets, setTargets] = useState("");
  const [time, setTime] = useState("");
  const [suggestion, setSuggestion] = useState<OnboardingSuggestion | null>(null);

  // 2. sports
  const [aim, setAim] = useState("");
  const [choices, setChoices] = useState<Record<Sport, SportChoice>>(
    () => Object.fromEntries(SPORTS.map((s) => [s, { on: false, priority: "MEDIUM", goalNote: "" }])) as Record<Sport, SportChoice>,
  );

  // 3. rhythm
  const [strengthDays, setStrengthDays] = useState(4);
  const [runDays, setRunDays] = useState(3);
  const [golfPerWeek, setGolfPerWeek] = useState(2);
  const [stepGoal, setStepGoal] = useState("");

  // 4. horizon
  const [horizon, setHorizon] = useState<HorizonInfo | null>(null);
  const [mode, setMode] = useState<"SUGGESTED" | "DATE">("SUGGESTED");
  const [customDate, setCustomDate] = useState("");
  const [planNotBuilt, setPlanNotBuilt] = useState(false);

  // Start from the person's current settings (the defaults for a new account).
  useEffect(() => {
    api
      .getProfile()
      .then((p) => {
        setStrengthDays(p.trainingDaysPerWeek);
        setRunDays(p.runDaysPerWeek);
        if (p.dailyStepGoal) setStepGoal(String(p.dailyStepGoal));
      })
      .catch(() => undefined);
    api
      .getGolfBag()
      .then((g) => setGolfPerWeek(g.practiceSessionsPerWeek))
      .catch(() => undefined);
  }, []);

  const chosen = SPORTS.filter((s) => choices[s].on);
  const setChoice = (s: Sport, patch: Partial<SportChoice>) => setChoices((c) => ({ ...c, [s]: { ...c[s], ...patch } }));

  async function readAnswers() {
    setError(null);
    const any = [goals, targets, time].some((t) => t.trim());
    if (any) {
      setBusy(true);
      try {
        const s = await api.interpretOnboarding({ today, goals, targets, time });
        setSuggestion(s);
        setAim(s.overallGoal || goals.trim().slice(0, 600));
        setChoices((c) => {
          const next = { ...c };
          for (const x of s.sports) next[x.sport] = { on: true, priority: x.priority, goalNote: x.goalNote };
          return next;
        });
        if (s.trainingDaysPerWeek) setStrengthDays(s.trainingDaysPerWeek);
        if (s.runDaysPerWeek) setRunDays(s.runDaysPerWeek);
        if (s.golfPracticePerWeek) setGolfPerWeek(s.golfPracticePerWeek);
        if (s.dailyStepGoal) setStepGoal(String(s.dailyStepGoal));
        if (s.targetDate) {
          setCustomDate(s.targetDate);
          setMode("DATE");
        }
      } catch {
        // Reading the answers is a convenience. Carry on and let them fill it in.
        setAim(goals.trim().slice(0, 600));
      } finally {
        setBusy(false);
      }
    }
    setStep(1);
  }

  async function openHorizon() {
    setError(null);
    setStep(3);
    if (!horizon) {
      try {
        setHorizon(await api.onboardingHorizon(today));
      } catch (e) {
        setError(e instanceof Error ? e.message : "Couldn't work out the plan dates");
      }
    }
  }

  async function finish() {
    setBusy(true);
    setError(null);
    try {
      const steps = stepGoal.trim() ? Number(stepGoal.replace(/[, ]/g, "")) : undefined;
      if (steps !== undefined && (!Number.isFinite(steps) || steps < 1000 || steps > 50000)) {
        throw new Error("Step goal should be between 1,000 and 50,000, or left empty.");
      }
      const result = await api.startOnboarding({
        today,
        about: aim.trim() || undefined,
        overallGoal: aim.trim() || undefined,
        sports: chosen.map((s) => ({ sport: s, priority: choices[s].priority, goalNote: choices[s].goalNote.trim() || undefined })),
        settings: {
          trainingDaysPerWeek: chosen.includes("STRENGTH") ? strengthDays : undefined,
          runDaysPerWeek: chosen.includes("RUN") ? runDays : undefined,
          golfPracticePerWeek: chosen.includes("GOLF") ? golfPerWeek : undefined,
          dailyStepGoal: steps,
        },
        horizon: mode === "DATE" ? { mode: "DATE", endDate: customDate } : { mode: "SUGGESTED" },
      });
      if (!result.planId) return onDone(false);
      try {
        await api.generateApproaches(result.planId);
        onDone(true);
      } catch (e) {
        // The plan exists; only the AI's proposal failed. It can be retried from the plan screen.
        setPlanNotBuilt(true);
        setError(e instanceof Error ? e.message : "The AI couldn't propose your approaches just now.");
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't save that");
    } finally {
      setBusy(false);
    }
  }

  async function skip() {
    setBusy(true);
    try {
      await api.skipOnboarding();
    } catch {
      /* skipping must never trap anyone; it will simply be offered again */
    }
    onDone(false);
  }

  const customError =
    mode === "DATE" && horizon
      ? !customDate
        ? "Choose an end date."
        : customDate < horizon.min
          ? "Pick a date at least two weeks from today."
          : customDate > horizon.max
            ? "Pick a date within the next 18 months."
            : null
      : null;

  const titles = ["What are you after?", "Which sports?", "Your weekly rhythm", "How far ahead?"];

  return (
    <div style={{ maxWidth: 480, margin: "0 auto", padding: "max(24px, env(safe-area-inset-top)) 16px 40px" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <span className="text-dim" style={{ fontSize: 12, fontWeight: 700, letterSpacing: "0.06em", textTransform: "uppercase" }}>
          Step {step + 1} of 4
        </span>
        <button className="button-quiet" onClick={skip} disabled={busy}>
          Skip setup
        </button>
      </div>
      <h1 style={{ fontSize: 22, margin: "8px 0 6px" }}>{titles[step]}</h1>

      {step === 0 && (
        <>
          <p className="text-dim" style={{ fontSize: 14, marginTop: 0 }}>
            Answer in your own words. Every question is optional, and you can change everything on the next screens.
          </p>
          <label style={{ display: "block", fontWeight: 600, marginTop: 12 }}>What do you want from your training?</label>
          <textarea
            value={goals}
            onChange={(e) => setGoals(e.target.value)}
            maxLength={1000}
            rows={3}
            placeholder="e.g. Get stronger, keep my golf handicap coming down, and build up to running a half marathon."
            style={{ width: "100%", padding: 10, marginTop: 4 }}
          />
          <label style={{ display: "block", fontWeight: 600, marginTop: 12 }}>Anything specific you're aiming for?</label>
          <textarea
            value={targets}
            onChange={(e) => setTargets(e.target.value)}
            maxLength={1000}
            rows={3}
            placeholder="A target, event or date: a race, a handicap, a weight, steps a day."
            style={{ width: "100%", padding: 10, marginTop: 4 }}
          />
          <label style={{ display: "block", fontWeight: 600, marginTop: 12 }}>What does a normal week look like for time and kit?</label>
          <textarea
            value={time}
            onChange={(e) => setTime(e.target.value)}
            maxLength={1000}
            rows={3}
            placeholder="Days you're free, how long you have, gym or home, pool nearby…"
            style={{ width: "100%", padding: 10, marginTop: 4 }}
          />
          <p className="text-dim" style={{ fontSize: 12 }}>
            When you continue, what you've written here is sent to Claude (the AI) to suggest settings. Nothing is saved until the last step, and only what you confirm is kept.
          </p>
          <button className="button-primary" style={{ width: "100%" }} onClick={readAnswers} disabled={busy}>
            {busy ? "Reading your answers…" : [goals, targets, time].some((t) => t.trim()) ? "Continue" : "Continue without answering"}
          </button>
        </>
      )}

      {step === 1 && (
        <>
          <p className="text-dim" style={{ fontSize: 14, marginTop: 0 }}>
            {suggestion && suggestion.sports.length > 0
              ? "I've ticked the sports your answers pointed to. Change anything."
              : "Tick the sports you want in your plan. Pick none to just look around."}
          </p>
          <label style={{ display: "block", fontWeight: 600 }}>Your aim in a sentence or two</label>
          <textarea
            value={aim}
            onChange={(e) => setAim(e.target.value)}
            maxLength={600}
            rows={2}
            placeholder="Optional. Shown with your progress and used when planning."
            style={{ width: "100%", padding: 10, marginTop: 4, marginBottom: 8 }}
          />
          {SPORTS.map((s) => (
            <div key={s} className="card" style={{ marginBottom: 8 }}>
              <label style={{ display: "flex", gap: 10, alignItems: "center", cursor: "pointer" }}>
                <input type="checkbox" checked={choices[s].on} onChange={(e) => setChoice(s, { on: e.target.checked })} style={{ width: 20, height: 20 }} />
                <strong style={{ color: "var(--navy)" }}>{SPORT_LABELS[s]}</strong>
              </label>
              {choices[s].on && (
                <div style={{ marginTop: 8 }}>
                  <div style={{ display: "flex", gap: 6 }} role="radiogroup" aria-label={`${SPORT_LABELS[s]} priority`}>
                    {PRIORITIES.map((p) => (
                      <button
                        key={p.value}
                        role="radio"
                        aria-checked={choices[s].priority === p.value}
                        onClick={() => setChoice(s, { priority: p.value })}
                        style={{
                          flex: 1,
                          padding: "7px 2px",
                          fontSize: 12,
                          borderRadius: 8,
                          border: choices[s].priority === p.value ? "none" : "1px solid var(--border)",
                          background: choices[s].priority === p.value ? "var(--accent)" : "var(--surface)",
                          color: choices[s].priority === p.value ? "var(--on-accent)" : "var(--text)",
                          fontWeight: 600,
                          cursor: "pointer",
                        }}
                      >
                        {p.label}
                      </button>
                    ))}
                  </div>
                  <input
                    value={choices[s].goalNote}
                    onChange={(e) => setChoice(s, { goalNote: e.target.value })}
                    maxLength={300}
                    placeholder="A goal for this sport (optional)"
                    style={{ width: "100%", padding: 9, marginTop: 8 }}
                  />
                </div>
              )}
            </div>
          ))}
          <Nav onBack={() => setStep(0)} onNext={() => setStep(2)} nextLabel="Continue" />
        </>
      )}

      {step === 2 && (
        <>
          <p className="text-dim" style={{ fontSize: 14, marginTop: 0 }}>
            How often you want to train. Your planners use these, and you can change them any time in Settings. All optional.
          </p>
          {chosen.includes("STRENGTH") && (
            <div className="card" style={{ marginBottom: 8 }}>
              <strong>Strength days a week</strong>
              <Pills values={[2, 3, 4, 5, 6]} value={strengthDays} onChange={setStrengthDays} label="Strength days a week" />
            </div>
          )}
          {chosen.includes("RUN") && (
            <div className="card" style={{ marginBottom: 8 }}>
              <strong>Runs a week</strong>
              <Pills values={[2, 3, 4, 5, 6]} value={runDays} onChange={setRunDays} label="Runs a week" />
            </div>
          )}
          {chosen.includes("GOLF") && (
            <div className="card" style={{ marginBottom: 8 }}>
              <strong>Golf practice sessions a week</strong>
              <Pills values={[1, 2, 3, 4, 5]} value={golfPerWeek} onChange={setGolfPerWeek} label="Golf practice sessions a week" />
            </div>
          )}
          {!chosen.some((s) => s === "STRENGTH" || s === "RUN" || s === "GOLF") && (
            <p className="text-dim" style={{ fontSize: 13 }}>
              Strength, running and golf have a sessions-a-week setting. The other sports are sized by the plan itself.
            </p>
          )}
          <div className="card" style={{ marginBottom: 8 }}>
            <strong>Daily step goal</strong>
            <input
              value={stepGoal}
              onChange={(e) => setStepGoal(e.target.value.replace(/[^\d,]/g, ""))}
              inputMode="numeric"
              placeholder="e.g. 10000 (optional)"
              style={{ width: "100%", padding: 9, marginTop: 6 }}
            />
          </div>
          <Nav onBack={() => setStep(1)} onNext={() => (chosen.length ? openHorizon() : finish())} nextLabel={chosen.length ? "Continue" : "Finish"} busy={busy} />
        </>
      )}

      {step === 3 && (
        <>
          <p className="text-dim" style={{ fontSize: 14, marginTop: 0 }}>
            Your plan starts today. Choose where it ends, and the AI will propose phases and milestones for {chosen.map((s) => SPORT_LABELS[s]).join(", ")} up to that point.
          </p>
          {!horizon && !error && <p className="text-dim">Working out the dates…</p>}
          {horizon && (
            <>
              <label className="card" style={{ display: "flex", gap: 12, alignItems: "flex-start", cursor: "pointer", marginBottom: 8 }}>
                <input type="radio" name="horizon" checked={mode === "SUGGESTED"} onChange={() => setMode("SUGGESTED")} style={{ width: 20, height: 20, marginTop: 2 }} />
                <span>
                  <strong style={{ color: "var(--navy)" }}>
                    To {longDate(horizon.suggested.endDate)} · {horizon.suggested.weeks} weeks
                  </strong>
                  <span className="text-dim" style={{ display: "block", fontSize: 13, marginTop: 2 }}>
                    {horizon.suggested.reason}
                  </span>
                </span>
              </label>
              <label className="card" style={{ display: "flex", gap: 12, alignItems: "flex-start", cursor: "pointer", marginBottom: 8 }}>
                <input type="radio" name="horizon" checked={mode === "DATE"} onChange={() => setMode("DATE")} style={{ width: 20, height: 20, marginTop: 2 }} />
                <span style={{ flex: 1 }}>
                  <strong style={{ color: "var(--navy)" }}>A date I choose</strong>
                  <span className="text-dim" style={{ display: "block", fontSize: 13, marginTop: 2 }}>
                    {suggestion?.targetDate && suggestion.targetDate === customDate
                      ? `From your answers${suggestion.targetDateNote ? ` (${suggestion.targetDateNote})` : ""}. Change it if that's not right.`
                      : "An event or deadline you're building towards."}
                  </span>
                  <input
                    type="date"
                    value={customDate}
                    min={horizon.min}
                    max={horizon.max}
                    onFocus={() => setMode("DATE")}
                    onChange={(e) => {
                      setCustomDate(e.target.value);
                      setMode("DATE");
                    }}
                    style={{ width: "100%", padding: 9, marginTop: 8 }}
                  />
                  {customError && <span style={{ display: "block", color: "var(--danger)", fontSize: 13, marginTop: 4 }}>{customError}</span>}
                </span>
              </label>
            </>
          )}
          {planNotBuilt ? (
            <div style={{ marginTop: 12 }}>
              <p style={{ fontSize: 13 }}>Your plan is set up, but the AI's proposal didn't come through. You can try again from the plan screen.</p>
              <button className="button-primary" style={{ width: "100%" }} onClick={() => onDone(true)}>
                Open my plan
              </button>
            </div>
          ) : (
            <Nav onBack={() => setStep(2)} onNext={finish} nextLabel={busy ? "Building your plan…" : "Build my plan"} busy={busy || !horizon || !!customError} />
          )}
        </>
      )}

      {error && <p style={{ color: "var(--danger)", fontSize: 13, marginTop: 12 }}>{error}</p>}
    </div>
  );
}

function Nav({ onBack, onNext, nextLabel, busy }: { onBack: () => void; onNext: () => void; nextLabel: string; busy?: boolean }) {
  return (
    <div style={{ display: "flex", gap: 8, marginTop: 12 }}>
      <button className="button-secondary" onClick={onBack} disabled={busy}>
        Back
      </button>
      <button className="button-primary" style={{ flex: 1 }} onClick={onNext} disabled={busy}>
        {nextLabel}
      </button>
    </div>
  );
}
