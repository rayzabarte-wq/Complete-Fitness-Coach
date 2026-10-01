import { useMemo, useState, type CSSProperties } from "react";
import { api, Sport, SportApproach, FrameworkSlot, ScheduleConstraint, TrainingPlan, TimeOfDay, MovementPattern, SessionType, DraftFrameworkSlot } from "../lib/api.js";
import { findCategoryByLabel } from "../lib/sessionTypes.js";

const SPORT_LABELS: Record<Sport, string> = {
  STRENGTH: "Strength",
  GOLF: "Golf",
  RUN: "Run",
  WALK: "Walk",
  CYCLING: "Cycling",
  CYCLING_TURBO: "Cycling - Turbo",
  SWIM: "Swim",
};
const DAY_LABELS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const TIME_LABELS = { MORNING: "Morning", AFTERNOON: "Afternoon", EVENING: "Evening" } as const;
const TIMES: TimeOfDay[] = ["MORNING", "AFTERNOON", "EVENING"];
const MOVEMENT_PATTERNS: MovementPattern[] = ["PUSH", "PULL", "LEGS", "CORE"];

interface Card {
  key: string;
  sport: Sport;
  dayOfWeek: number | null;
  timeOfDay: TimeOfDay | null;
  sessionType: SessionType | null;
  movementPattern: MovementPattern | null;
  estimatedMinutes: number;
}

function subTypeOptions(sport: Sport): { type: SessionType; label: string }[] {
  return findCategoryByLabel(SPORT_LABELS[sport])?.children ?? [];
}

function buildInitialCards(approaches: SportApproach[], existingSlots: FrameworkSlot[]): Card[] {
  const cards: Card[] = [];
  let seq = 0;
  for (const approach of approaches) {
    const existingForSport = existingSlots.filter((s) => s.sport === approach.sport);
    for (let i = 0; i < approach.weeklySessionTarget; i++) {
      const existing = existingForSport[i];
      cards.push({
        key: `card-${seq++}`,
        sport: approach.sport,
        dayOfWeek: existing?.dayOfWeek ?? null,
        timeOfDay: existing?.timeOfDay ?? null,
        sessionType: existing?.sessionType ?? null,
        movementPattern: existing?.movementPattern ?? null,
        estimatedMinutes: existing?.estimatedMinutes ?? approach.sessionMinutes,
      });
    }
  }
  return cards;
}

function formatHoursMinutes(totalMinutes: number): string {
  const h = Math.floor(totalMinutes / 60);
  const m = totalMinutes % 60;
  if (h === 0) return `${m}m`;
  if (m === 0) return `${h}h`;
  return `${h}h ${m}m`;
}

export default function ScheduleBuilder({
  plan,
  approaches,
  existingSlots,
  constraints,
  onSaved,
  onCancel,
}: {
  plan: TrainingPlan;
  approaches: SportApproach[];
  existingSlots: FrameworkSlot[];
  constraints: ScheduleConstraint[];
  onSaved: (plan: TrainingPlan) => void;
  onCancel: () => void;
}) {
  const [cards, setCards] = useState<Card[]>(() => buildInitialCards(approaches, existingSlots));
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function updateCard(key: string, patch: Partial<Card>) {
    setCards((cur) => cur.map((c) => (c.key === key ? { ...c, ...patch } : c)));
  }

  const isConstraintBlocked = (dayOfWeek: number, timeOfDay: TimeOfDay) =>
    constraints.some((c) => c.daysOfWeek.includes(dayOfWeek) && c.blockedTimeOfDay.includes(timeOfDay));

  // Which cards collide with another card's day+time, or with a constraint.
  const { duplicateKeys, blockedKeys } = useMemo(() => {
    const counts = new Map<string, string[]>();
    for (const c of cards) {
      if (c.dayOfWeek === null || c.timeOfDay === null) continue;
      const key = `${c.dayOfWeek}-${c.timeOfDay}`;
      counts.set(key, [...(counts.get(key) ?? []), c.key]);
    }
    const duplicateKeys = new Set<string>();
    for (const keys of counts.values()) {
      if (keys.length > 1) keys.forEach((k) => duplicateKeys.add(k));
    }
    const blockedKeys = new Set<string>();
    for (const c of cards) {
      if (c.dayOfWeek !== null && c.timeOfDay !== null && isConstraintBlocked(c.dayOfWeek, c.timeOfDay)) {
        blockedKeys.add(c.key);
      }
    }
    return { duplicateKeys, blockedKeys };
  }, [cards, constraints]);

  const unplaced = cards.filter((c) => c.dayOfWeek === null || c.timeOfDay === null);
  const missingMovementPattern = cards.filter((c) => c.sport === "STRENGTH" && !c.movementPattern);
  const canSave = unplaced.length === 0 && missingMovementPattern.length === 0 && duplicateKeys.size === 0 && blockedKeys.size === 0;

  // Total planned minutes per day, for the grid preview.
  const minutesPerDay = useMemo(() => {
    const totals = [0, 0, 0, 0, 0, 0, 0];
    for (const c of cards) {
      if (c.dayOfWeek !== null) totals[c.dayOfWeek] += c.estimatedMinutes;
    }
    return totals;
  }, [cards]);

  async function handleSave() {
    if (!canSave) return;
    setBusy(true);
    setError(null);
    try {
      const slots: DraftFrameworkSlot[] = cards.map((c) => ({
        sport: c.sport,
        dayOfWeek: c.dayOfWeek,
        timeOfDay: c.timeOfDay,
        sessionType: c.sessionType ?? undefined,
        movementPattern: c.movementPattern ?? undefined,
        estimatedMinutes: c.estimatedMinutes,
      }));
      const updated = await api.saveFramework(plan.id, slots, plan.status === "ACTIVE" ? note || undefined : undefined);
      onSaved(updated);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save the schedule");
    } finally {
      setBusy(false);
    }
  }

  const cardsBySport = new Map<Sport, Card[]>();
  for (const c of cards) {
    cardsBySport.set(c.sport, [...(cardsBySport.get(c.sport) ?? []), c]);
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      <div className="card">
        <strong>Build your weekly schedule</strong>
        <p className="text-dim" style={{ fontSize: 13, marginTop: 6 }}>
          For each session below, choose a day and time of day. The grid at the bottom updates as you go, so you can see total planned
          time per day before saving.
        </p>
      </div>

      {error && (
        <div className="card" style={{ borderColor: "var(--danger)" }}>
          <p style={{ margin: 0, color: "var(--danger)", fontSize: 13 }}>{error}</p>
        </div>
      )}

      {[...cardsBySport.entries()].map(([sport, sportCards]) => {
        const subOptions = subTypeOptions(sport);
        return (
          <div key={sport} className="card">
            <strong>{SPORT_LABELS[sport]}</strong>
            <div style={{ display: "flex", flexDirection: "column", gap: 10, marginTop: 10 }}>
              {sportCards.map((c, i) => {
                const hasConflict = duplicateKeys.has(c.key) || blockedKeys.has(c.key);
                return (
                  <div
                    key={c.key}
                    style={{
                      border: `1px solid ${hasConflict ? "var(--danger)" : "var(--border)"}`,
                      borderRadius: 8,
                      padding: 10,
                      display: "flex",
                      flexDirection: "column",
                      gap: 6,
                    }}
                  >
                    <span className="text-dim" style={{ fontSize: 12 }}>
                      Session {i + 1} of {sportCards.length}
                    </span>
                    <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                      <select
                        value={c.dayOfWeek ?? ""}
                        onChange={(e) => updateCard(c.key, { dayOfWeek: e.target.value === "" ? null : Number(e.target.value) })}
                        style={selectStyle}
                      >
                        <option value="">Day...</option>
                        {DAY_LABELS.map((d, idx) => (
                          <option key={d} value={idx}>
                            {d}
                          </option>
                        ))}
                      </select>
                      <select
                        value={c.timeOfDay ?? ""}
                        onChange={(e) => updateCard(c.key, { timeOfDay: (e.target.value || null) as TimeOfDay | null })}
                        style={selectStyle}
                      >
                        <option value="">Time...</option>
                        {TIMES.map((t) => (
                          <option key={t} value={t}>
                            {TIME_LABELS[t]}
                          </option>
                        ))}
                      </select>
                      <input
                        type="number"
                        min={5}
                        step={5}
                        value={c.estimatedMinutes}
                        onChange={(e) => updateCard(c.key, { estimatedMinutes: Number(e.target.value) })}
                        style={{ ...selectStyle, width: 70 }}
                        title="Minutes"
                      />
                      <span className="text-dim" style={{ fontSize: 12, alignSelf: "center" }}>
                        min
                      </span>
                    </div>

                    {sport === "STRENGTH" && (
                      <select
                        value={c.movementPattern ?? ""}
                        onChange={(e) => updateCard(c.key, { movementPattern: (e.target.value || null) as MovementPattern | null })}
                        style={selectStyle}
                      >
                        <option value="">Movement pattern...</option>
                        {MOVEMENT_PATTERNS.map((mp) => (
                          <option key={mp} value={mp}>
                            {mp.charAt(0) + mp.slice(1).toLowerCase()}
                          </option>
                        ))}
                      </select>
                    )}

                    {subOptions.length > 0 && (
                      <select
                        value={c.sessionType ?? ""}
                        onChange={(e) => updateCard(c.key, { sessionType: (e.target.value || null) as SessionType | null })}
                        style={selectStyle}
                      >
                        <option value="">Any {SPORT_LABELS[sport].toLowerCase()} session</option>
                        {subOptions.map((o) => (
                          <option key={o.type} value={o.type}>
                            {o.label}
                          </option>
                        ))}
                      </select>
                    )}

                    {hasConflict && (
                      <p style={{ color: "var(--danger)", fontSize: 12, margin: 0 }}>
                        {duplicateKeys.has(c.key)
                          ? "Another session is already placed at this day/time."
                          : "This day/time conflicts with one of your scheduling constraints."}
                      </p>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        );
      })}

      <div className="card">
        <strong>Total planned time per day</strong>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(7, 1fr)", gap: 6, marginTop: 10 }}>
          {DAY_LABELS.map((d, i) => (
            <div key={d} style={{ textAlign: "center" }}>
              <div className="text-dim" style={{ fontSize: 11, fontWeight: 600 }}>
                {d}
              </div>
              <div style={{ fontSize: 13, marginTop: 4 }}>{minutesPerDay[i] > 0 ? formatHoursMinutes(minutesPerDay[i]) : "–"}</div>
            </div>
          ))}
        </div>
      </div>

      {plan.status === "ACTIVE" && (
        <div className="card">
          <strong style={{ fontSize: 13 }}>What changed and why (optional)</strong>
          <textarea
            value={note}
            onChange={(e) => setNote(e.target.value)}
            rows={2}
            placeholder="e.g. moved strength sessions earlier in the week"
            style={{ width: "100%", marginTop: 6, background: "var(--bg)", color: "var(--text)", border: "1px solid var(--border)", borderRadius: 6, padding: 8 }}
          />
        </div>
      )}

      {!canSave && (
        <p className="text-dim" style={{ fontSize: 12 }}>
          {unplaced.length > 0
            ? `${unplaced.length} session${unplaced.length === 1 ? "" : "s"} still need a day and time.`
            : missingMovementPattern.length > 0
            ? "Every Strength session needs a movement pattern."
            : "Fix the conflicts marked in red above before saving."}
        </p>
      )}

      <div style={{ display: "flex", gap: 8 }}>
        <button className="button-primary" disabled={busy || !canSave} onClick={handleSave} style={{ flex: 1 }}>
          {busy ? "Saving..." : "Save schedule for approval"}
        </button>
        <button
          onClick={onCancel}
          disabled={busy}
          style={{ background: "transparent", border: "1px solid var(--border)", color: "var(--text)", borderRadius: 8, padding: "10px 16px", cursor: "pointer" }}
        >
          Cancel
        </button>
      </div>
    </div>
  );
}

const selectStyle: CSSProperties = {
  background: "var(--bg)",
  color: "var(--text)",
  border: "1px solid var(--border)",
  borderRadius: 6,
  padding: 6,
  flex: "1 1 auto",
};
