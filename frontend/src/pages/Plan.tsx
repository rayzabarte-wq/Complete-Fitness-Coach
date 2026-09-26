import { Fragment, useEffect, useState } from "react";
import {
  api,
  Sport,
  PriorityLevel,
  TrainingPlan,
  SportApproach,
  FrameworkSlot,
  SlotConflict,
} from "../lib/api.js";
import PlanDashboard from "./PlanDashboard.js";

const SPORTS: Sport[] = ["STRENGTH", "GOLF", "RUN", "WALK", "CYCLING", "CYCLING_TURBO", "SWIM"];
const SPORT_LABELS: Record<Sport, string> = {
  STRENGTH: "Strength",
  GOLF: "Golf",
  RUN: "Run",
  WALK: "Walk",
  CYCLING: "Cycling",
  CYCLING_TURBO: "Cycling - Turbo",
  SWIM: "Swim",
};
const PRIORITIES: PriorityLevel[] = ["LOW", "MEDIUM", "HIGH"];
const DAY_LABELS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const TIME_LABELS = { MORNING: "Morning", AFTERNOON: "Afternoon", EVENING: "Evening" } as const;
const TIMES: (keyof typeof TIME_LABELS)[] = ["MORNING", "AFTERNOON", "EVENING"];

type DraftPriority = { sport: Sport; included: boolean; priority: PriorityLevel; goalNote: string };

function defaultDraftPriorities(): DraftPriority[] {
  return SPORTS.map((sport) => ({ sport, included: sport === "STRENGTH", priority: "MEDIUM", goalNote: "" }));
}

export default function Plan() {
  const [plan, setPlan] = useState<TrainingPlan | null | undefined>(undefined); // undefined = loading
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const [overallGoal, setOverallGoal] = useState("");
  const [draftPriorities, setDraftPriorities] = useState<DraftPriority[]>(defaultDraftPriorities());
  const [editingPriorities, setEditingPriorities] = useState(false);

  const [constraintText, setConstraintText] = useState("");
  const [pendingConflicts, setPendingConflicts] = useState<{ constraintId: string; conflicts: SlotConflict[] } | null>(null);

  const [amendmentText, setAmendmentText] = useState("");
  const [view, setView] = useState<"plan" | "dashboard">("plan");

  useEffect(() => {
    refresh();
  }, []);

  async function refresh() {
    try {
      const current = await api.getCurrentPlan();
      setPlan(current);
      if (current) {
        setOverallGoal(current.overallGoal ?? "");
        setDraftPriorities(
          SPORTS.map((sport) => {
            const existing = current.priorities.find((p) => p.sport === sport);
            return existing
              ? { sport, included: true, priority: existing.priority, goalNote: existing.goalNote ?? "" }
              : { sport, included: false, priority: "MEDIUM", goalNote: "" };
          })
        );
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load your training plan");
    }
  }

  async function handleStartOrUpdatePlan() {
    const included = draftPriorities.filter((p) => p.included);
    if (included.length === 0) {
      setError("Pick at least one sport to include");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const payload = {
        overallGoal: overallGoal || undefined,
        priorities: included.map((p) => ({ sport: p.sport, priority: p.priority, goalNote: p.goalNote || undefined })),
      };
      const updated = plan && plan.status === "DRAFT" ? await api.updatePlanPriorities(plan.id, payload) : await api.createPlan(payload);
      setPlan(updated);
      setEditingPriorities(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save priorities");
    } finally {
      setBusy(false);
    }
  }

  async function handleGenerateApproaches() {
    if (!plan) return;
    setBusy(true);
    setError(null);
    try {
      setPlan(await api.generateApproaches(plan.id));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to generate sport approaches");
    } finally {
      setBusy(false);
    }
  }

  async function handleApproveApproach(approach: SportApproach, edits?: { approachText?: string; weeklySessionTarget?: number }) {
    if (!plan) return;
    setBusy(true);
    setError(null);
    try {
      setPlan(await api.updateApproach(plan.id, approach.sport, { status: "APPROVED", ...edits }));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to approve approach");
    } finally {
      setBusy(false);
    }
  }

  async function handleGenerateFramework() {
    if (!plan) return;
    setBusy(true);
    setError(null);
    try {
      setPlan(await api.generateFramework(plan.id));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to generate the weekly framework");
    } finally {
      setBusy(false);
    }
  }

  async function handleActivate() {
    if (!plan) return;
    setBusy(true);
    setError(null);
    try {
      setPlan(await api.activatePlan(plan.id));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to activate the plan");
    } finally {
      setBusy(false);
    }
  }

  async function handleAddConstraint() {
    if (!plan || !constraintText.trim()) return;
    setBusy(true);
    setError(null);
    try {
      const { constraint, conflicts } = await api.addConstraint(plan.id, constraintText.trim());
      setConstraintText("");
      await refresh();
      if (conflicts.length > 0) {
        setPendingConflicts({ constraintId: constraint.id, conflicts });
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to add that constraint");
    } finally {
      setBusy(false);
    }
  }

  async function handleApplyMove(constraintId: string, slotId: string, dayOfWeek: number, timeOfDay: "MORNING" | "AFTERNOON" | "EVENING") {
    if (!plan) return;
    setBusy(true);
    setError(null);
    try {
      const updated = await api.applyConstraintMove(plan.id, constraintId, { slotId, dayOfWeek, timeOfDay });
      setPlan(updated);
      setPendingConflicts((cur) => {
        if (!cur || cur.constraintId !== constraintId) return cur;
        const remaining = cur.conflicts.filter((c) => c.slot.id !== slotId);
        return remaining.length > 0 ? { ...cur, conflicts: remaining } : null;
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to move that session");
    } finally {
      setBusy(false);
    }
  }

  async function handleDeleteConstraint(constraintId: string) {
    if (!plan) return;
    setBusy(true);
    setError(null);
    try {
      setPlan(await api.deleteConstraint(plan.id, constraintId));
      setPendingConflicts((cur) => (cur?.constraintId === constraintId ? null : cur));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to remove that constraint");
    } finally {
      setBusy(false);
    }
  }

  async function handleAmend() {
    if (!plan || !amendmentText.trim()) return;
    setBusy(true);
    setError(null);
    try {
      setPlan(await api.amendPlan(plan.id, amendmentText.trim()));
      setAmendmentText("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to apply that amendment");
    } finally {
      setBusy(false);
    }
  }

  if (plan === undefined) {
    return <p className="text-dim">Loading your training plan...</p>;
  }

  const showPriorityForm = editingPriorities || !plan || (plan.status === "DRAFT" && plan.priorities.length === 0);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      <div>
        <h2 style={{ margin: "4px 0" }}>3-Month Plan</h2>
        <p className="text-dim" style={{ fontSize: 13, margin: 0 }}>
          Set priorities per sport, review the AI's proposed 3-month approach for each, then approve a weekly scheduling framework.
        </p>
      </div>

      {error && (
        <div className="card" style={{ borderColor: "var(--danger)" }}>
          <p style={{ margin: 0, color: "var(--danger)", fontSize: 13 }}>{error}</p>
        </div>
      )}

      {plan && (plan.status === "FRAMEWORK" || plan.status === "ACTIVE") && (
        <div className="card" style={{ display: "flex", gap: 8 }}>
          <button
            onClick={() => setView("plan")}
            style={{
              flex: 1,
              background: view === "plan" ? "var(--accent)" : "transparent",
              color: view === "plan" ? "#0e1512" : "var(--text)",
              border: view === "plan" ? "none" : "1px solid var(--border)",
              borderRadius: 8,
              padding: "8px 10px",
              fontSize: 13,
              fontWeight: 600,
              cursor: "pointer",
            }}
          >
            Plan
          </button>
          <button
            onClick={() => setView("dashboard")}
            style={{
              flex: 1,
              background: view === "dashboard" ? "var(--accent)" : "transparent",
              color: view === "dashboard" ? "#0e1512" : "var(--text)",
              border: view === "dashboard" ? "none" : "1px solid var(--border)",
              borderRadius: 8,
              padding: "8px 10px",
              fontSize: 13,
              fontWeight: 600,
              cursor: "pointer",
            }}
          >
            Dashboard
          </button>
        </div>
      )}

      {view === "dashboard" && plan ? (
        <PlanDashboard planId={plan.id} />
      ) : (
        <>
      {plan && plan.status !== "DRAFT" && (
        <div className="card" style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <div>
            <strong>{plan.status === "ACTIVE" ? "Active plan" : "Framework in review"}</strong>
            <p className="text-dim" style={{ fontSize: 12, margin: "2px 0 0" }}>
              {new Date(plan.startDate).toLocaleDateString()} – {new Date(plan.endDate).toLocaleDateString()}
            </p>
          </div>
          <button
            className="button-primary"
            style={{ background: "transparent", border: "1px solid var(--border)", color: "var(--text)" }}
            onClick={() => setEditingPriorities(true)}
          >
            Start a new plan
          </button>
        </div>
      )}

      {showPriorityForm && (
        <PriorityForm
          overallGoal={overallGoal}
          setOverallGoal={setOverallGoal}
          draftPriorities={draftPriorities}
          setDraftPriorities={setDraftPriorities}
          busy={busy}
          onSubmit={handleStartOrUpdatePlan}
          isNewPlan={!plan || plan.status !== "DRAFT"}
        />
      )}

      {plan && plan.status === "DRAFT" && !showPriorityForm && plan.approaches.length === 0 && (
        <button className="button-primary" disabled={busy} onClick={handleGenerateApproaches}>
          {busy ? "Generating..." : "Generate 3-month approach per sport"}
        </button>
      )}

      {plan && plan.approaches.length > 0 && plan.status === "DRAFT" && (
        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          {plan.approaches.map((a) => (
            <ApproachCard key={a.sport} approach={a} busy={busy} onApprove={handleApproveApproach} />
          ))}

          <button className="button-primary" disabled={busy} onClick={handleGenerateApproaches} style={{ background: "transparent", border: "1px solid var(--border)", color: "var(--text)" }}>
            Regenerate all approaches
          </button>

          {plan.approaches.every((a) => a.status === "APPROVED") ? (
            <button className="button-primary" disabled={busy} onClick={handleGenerateFramework}>
              {busy ? "Building framework..." : "Propose weekly scheduling framework"}
            </button>
          ) : (
            <p className="text-dim" style={{ fontSize: 13 }}>
              Approve every sport's approach above to move on to weekly scheduling.
            </p>
          )}
        </div>
      )}

      {plan && plan.slots.length > 0 && (plan.status === "FRAMEWORK" || plan.status === "ACTIVE") && (
        <>
          <WeekGrid slots={plan.slots} />

          {plan.status === "FRAMEWORK" && (
            <button className="button-primary" disabled={busy} onClick={handleActivate}>
              Approve this framework — activate plan
            </button>
          )}

          {plan.status === "FRAMEWORK" && (
            <button
              className="button-primary"
              disabled={busy}
              onClick={handleGenerateFramework}
              style={{ background: "transparent", border: "1px solid var(--border)", color: "var(--text)" }}
            >
              Regenerate framework
            </button>
          )}

          {plan.status === "ACTIVE" && (
            <div className="card">
              <strong>Request a plan amendment</strong>
              <p className="text-dim" style={{ fontSize: 13, marginTop: 6 }}>
                Describe a change in your own words — e.g. "cut running back to twice a week and add a second golf short-game session".
                It applies from today through the rest of the 3 months; the dashboard keeps track of progress from before and after the change.
              </p>
              <textarea
                value={amendmentText}
                onChange={(e) => setAmendmentText(e.target.value)}
                placeholder="Describe what you'd like to change..."
                rows={2}
                style={{ width: "100%", marginTop: 8, background: "var(--bg)", color: "var(--text)", border: "1px solid var(--border)", borderRadius: 6, padding: 8 }}
              />
              <button className="button-primary" disabled={busy || !amendmentText.trim()} onClick={handleAmend} style={{ marginTop: 8 }}>
                {busy ? "Applying..." : "Apply amendment"}
              </button>

              {plan.versions.length > 1 && (
                <div style={{ marginTop: 14, display: "flex", flexDirection: "column", gap: 8 }}>
                  <strong style={{ fontSize: 13 }}>Amendment history</strong>
                  {[...plan.versions].reverse().map((v) => (
                    <div key={v.id} style={{ borderTop: "1px solid var(--border)", paddingTop: 8, fontSize: 12 }}>
                      <span className="text-dim">
                        {new Date(v.effectiveFrom).toLocaleDateString()}
                        {v.effectiveTo ? ` – ${new Date(v.effectiveTo).toLocaleDateString()}` : " – now"}:
                      </span>{" "}
                      {v.amendmentSummary ?? "Initial framework"}
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          <div className="card">
            <strong>Scheduling constraints</strong>
            <p className="text-dim" style={{ fontSize: 13, marginTop: 6 }}>
              Describe a limitation in your own words — e.g. "I can't train mornings on office days, Tuesday and Thursday" or "no evening
              workouts on Fridays". We'll parse it and flag any sessions it conflicts with, with options to move them.
            </p>
            <textarea
              value={constraintText}
              onChange={(e) => setConstraintText(e.target.value)}
              placeholder="Describe a scheduling constraint..."
              rows={2}
              style={{ width: "100%", marginTop: 8, background: "var(--bg)", color: "var(--text)", border: "1px solid var(--border)", borderRadius: 6, padding: 8 }}
            />
            <button className="button-primary" disabled={busy || !constraintText.trim()} onClick={handleAddConstraint} style={{ marginTop: 8 }}>
              Add constraint
            </button>

            {plan.constraints.length > 0 && (
              <div style={{ marginTop: 14, display: "flex", flexDirection: "column", gap: 10 }}>
                {plan.constraints.map((c) => (
                  <div key={c.id} style={{ borderTop: "1px solid var(--border)", paddingTop: 10 }}>
                    <div style={{ display: "flex", justifyContent: "space-between", gap: 8 }}>
                      <div>
                        <p style={{ margin: 0, fontSize: 13 }}>"{c.rawText}"</p>
                        {c.parseExplanation && (
                          <p className="text-dim" style={{ margin: "2px 0 0", fontSize: 12 }}>
                            {c.parseExplanation}
                          </p>
                        )}
                      </div>
                      <button onClick={() => handleDeleteConstraint(c.id)} style={{ background: "none", border: "none", color: "var(--danger)", cursor: "pointer", fontSize: 12 }}>
                        Remove
                      </button>
                    </div>

                    {pendingConflicts?.constraintId === c.id && pendingConflicts.conflicts.length > 0 && (
                      <div style={{ marginTop: 8, display: "flex", flexDirection: "column", gap: 8 }}>
                        {pendingConflicts.conflicts.map((conflict) => (
                          <div key={conflict.slot.id} style={{ background: "var(--bg)", borderRadius: 6, padding: 8 }}>
                            <p style={{ margin: "0 0 6px", fontSize: 12 }}>
                              Conflicts: {SPORT_LABELS[conflict.slot.sport]} on {DAY_LABELS[conflict.slot.dayOfWeek]}{" "}
                              {TIME_LABELS[conflict.slot.timeOfDay]}
                              {conflict.slot.label ? ` (${conflict.slot.label})` : ""}
                            </p>
                            {conflict.options.length === 0 ? (
                              <p className="text-dim" style={{ fontSize: 12, margin: 0 }}>
                                No open slot found this week — try removing another session or a different constraint.
                              </p>
                            ) : (
                              <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
                                {conflict.options.map((opt) => (
                                  <button
                                    key={`${opt.dayOfWeek}-${opt.timeOfDay}`}
                                    disabled={busy}
                                    onClick={() => handleApplyMove(c.id, conflict.slot.id, opt.dayOfWeek, opt.timeOfDay)}
                                    style={{
                                      background: "var(--surface)",
                                      border: "1px solid var(--border)",
                                      color: "var(--text)",
                                      borderRadius: 6,
                                      padding: "6px 10px",
                                      fontSize: 12,
                                      cursor: "pointer",
                                    }}
                                  >
                                    Move to {opt.dayLabel} {opt.timeLabel}
                                  </button>
                                ))}
                              </div>
                            )}
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        </>
      )}
        </>
      )}
    </div>
  );
}

function PriorityForm({
  overallGoal,
  setOverallGoal,
  draftPriorities,
  setDraftPriorities,
  busy,
  onSubmit,
  isNewPlan,
}: {
  overallGoal: string;
  setOverallGoal: (v: string) => void;
  draftPriorities: DraftPriority[];
  setDraftPriorities: (v: DraftPriority[]) => void;
  busy: boolean;
  onSubmit: () => void;
  isNewPlan: boolean;
}) {
  function update(sport: Sport, patch: Partial<DraftPriority>) {
    setDraftPriorities(draftPriorities.map((p) => (p.sport === sport ? { ...p, ...patch } : p)));
  }

  return (
    <div className="card" style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      <div>
        <strong>{isNewPlan ? "Start a 3-month plan" : "Sport priorities"}</strong>
        <p className="text-dim" style={{ fontSize: 13, margin: "4px 0 0" }}>
          Overall goal for the next 3 months (optional):
        </p>
        <textarea
          value={overallGoal}
          onChange={(e) => setOverallGoal(e.target.value)}
          rows={2}
          placeholder="e.g. build strength and lean muscle while keeping up golf and a cardio base"
          style={{ width: "100%", marginTop: 6, background: "var(--bg)", color: "var(--text)", border: "1px solid var(--border)", borderRadius: 6, padding: 8 }}
        />
      </div>

      <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
        {draftPriorities.map((p) => (
          <div key={p.sport} style={{ borderTop: "1px solid var(--border)", paddingTop: 10 }}>
            <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 14 }}>
              <input type="checkbox" checked={p.included} onChange={(e) => update(p.sport, { included: e.target.checked })} />
              {SPORT_LABELS[p.sport]}
            </label>
            {p.included && (
              <div style={{ marginTop: 6, display: "flex", flexDirection: "column", gap: 6, paddingLeft: 24 }}>
                <select value={p.priority} onChange={(e) => update(p.sport, { priority: e.target.value as PriorityLevel })} style={{ background: "var(--bg)", color: "var(--text)", border: "1px solid var(--border)", borderRadius: 6, padding: 6 }}>
                  {PRIORITIES.map((lvl) => (
                    <option key={lvl} value={lvl}>
                      {lvl.charAt(0) + lvl.slice(1).toLowerCase()} priority
                    </option>
                  ))}
                </select>
                <input
                  type="text"
                  value={p.goalNote}
                  onChange={(e) => update(p.sport, { goalNote: e.target.value })}
                  placeholder={`Specific goal for ${SPORT_LABELS[p.sport]} (optional)`}
                  style={{ background: "var(--bg)", color: "var(--text)", border: "1px solid var(--border)", borderRadius: 6, padding: 6 }}
                />
              </div>
            )}
          </div>
        ))}
      </div>

      <button className="button-primary" disabled={busy} onClick={onSubmit}>
        {busy ? "Saving..." : isNewPlan ? "Start plan" : "Save priorities"}
      </button>
    </div>
  );
}

function ApproachCard({
  approach,
  busy,
  onApprove,
}: {
  approach: SportApproach;
  busy: boolean;
  onApprove: (a: SportApproach, edits?: { approachText?: string; weeklySessionTarget?: number }) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState(approach.approachText);
  const [target, setTarget] = useState(approach.weeklySessionTarget);

  return (
    <div className="card">
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
        <strong>{SPORT_LABELS[approach.sport]}</strong>
        {approach.status === "APPROVED" && <span style={{ color: "var(--accent)", fontSize: 12, fontWeight: 600 }}>Approved</span>}
      </div>

      {editing ? (
        <div style={{ marginTop: 8, display: "flex", flexDirection: "column", gap: 8 }}>
          <textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            rows={3}
            style={{ width: "100%", background: "var(--bg)", color: "var(--text)", border: "1px solid var(--border)", borderRadius: 6, padding: 8 }}
          />
          <label style={{ fontSize: 13 }}>
            Sessions/week:{" "}
            <input
              type="number"
              min={1}
              value={target}
              onChange={(e) => setTarget(Number(e.target.value))}
              style={{ width: 60, background: "var(--bg)", color: "var(--text)", border: "1px solid var(--border)", borderRadius: 6, padding: 4 }}
            />
          </label>
          <button
            className="button-primary"
            disabled={busy}
            onClick={() => {
              onApprove(approach, { approachText: text, weeklySessionTarget: target });
              setEditing(false);
            }}
          >
            Save & approve
          </button>
        </div>
      ) : (
        <>
          <p style={{ fontSize: 14, margin: "8px 0" }}>{approach.approachText}</p>
          <p className="text-dim" style={{ fontSize: 13, margin: "0 0 10px" }}>{approach.weeklySessionTarget} sessions/week</p>
          {approach.status !== "APPROVED" && (
            <div style={{ display: "flex", gap: 8 }}>
              <button className="button-primary" disabled={busy} onClick={() => onApprove(approach)}>
                Approve
              </button>
              <button
                onClick={() => setEditing(true)}
                style={{ background: "transparent", border: "1px solid var(--border)", color: "var(--text)", borderRadius: 8, padding: "10px 16px", cursor: "pointer" }}
              >
                Edit
              </button>
            </div>
          )}
        </>
      )}
    </div>
  );
}

function WeekGrid({ slots }: { slots: FrameworkSlot[] }) {
  return (
    <div className="card">
      <strong>Weekly framework</strong>
      <p className="text-dim" style={{ fontSize: 12, margin: "4px 0 10px" }}>
        A recurring weekly shape, not dated sessions — use it as a guide when scheduling on the Calendar tab.
      </p>
      <div style={{ display: "grid", gridTemplateColumns: "56px repeat(7, 1fr)", gap: 4, fontSize: 11 }}>
        <div />
        {DAY_LABELS.map((d) => (
          <div key={d} className="text-dim" style={{ textAlign: "center", fontWeight: 600 }}>
            {d}
          </div>
        ))}
        {TIMES.map((time) => (
          <Fragment key={time}>
            <div className="text-dim" style={{ display: "flex", alignItems: "center" }}>
              {TIME_LABELS[time]}
            </div>
            {DAY_LABELS.map((_, dayIndex) => {
              const slot = slots.find((s) => s.dayOfWeek === dayIndex && s.timeOfDay === time);
              return (
                <div
                  key={`${time}-${dayIndex}`}
                  title={slot?.notes ?? undefined}
                  style={{
                    minHeight: 44,
                    background: slot ? "var(--bg)" : "transparent",
                    border: slot ? "1px solid var(--border)" : "1px dashed var(--border)",
                    borderRadius: 6,
                    padding: 4,
                    fontSize: 10,
                    lineHeight: 1.3,
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    textAlign: "center",
                  }}
                >
                  {slot ? slot.label ?? SPORT_LABELS[slot.sport] : ""}
                </div>
              );
            })}
          </Fragment>
        ))}
      </div>
    </div>
  );
}
