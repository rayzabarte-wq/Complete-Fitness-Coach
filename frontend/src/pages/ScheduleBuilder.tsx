import { useMemo, useState, type CSSProperties } from "react";
import { api, Sport, SportApproach, FrameworkSlot, ScheduleConstraint, TrainingPlan, TimeOfDay, DraftFrameworkSlot } from "../lib/api.js";

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
const TIMES: TimeOfDay[] = ["MORNING", "AFTERNOON", "EVENING"];
const MAX_PER_DAY = TIMES.length;

// A session in the weekly pattern is only a sport, a day and the minutes
// available. What the workout actually is (which strength day, which kind of
// run or golf practice) is chosen by "Plan my week" on the Calendar, from
// what has been done so far in the plan.

interface Card {
  key: string;
  sport: Sport;
  dayOfWeek: number | null;
  /** Kept from a saved schedule so an unchanged day keeps its time; otherwise worked out on save. */
  timeOfDay: TimeOfDay | null;
  estimatedMinutes: number;
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

  // Times of day a constraint blocks, per day, so a day with no free time left
  // (or with more sessions than free times) is flagged before saving.
  const freeTimesOn = (dayOfWeek: number) =>
    TIMES.filter((t) => !constraints.some((c) => c.daysOfWeek.includes(dayOfWeek) && c.blockedTimeOfDay.includes(t))).length;

  const { crowdedKeys } = useMemo(() => {
    const perDay = new Map<number, string[]>();
    for (const c of cards) {
      if (c.dayOfWeek === null) continue;
      perDay.set(c.dayOfWeek, [...(perDay.get(c.dayOfWeek) ?? []), c.key]);
    }
    const crowdedKeys = new Set<string>();
    for (const [day, keys] of perDay) {
      if (keys.length > Math.min(MAX_PER_DAY, freeTimesOn(day))) keys.forEach((k) => crowdedKeys.add(k));
    }
    return { crowdedKeys };
  }, [cards, constraints]);

  const unplaced = cards.filter((c) => c.dayOfWeek === null);
  const canSave = unplaced.length === 0 && crowdedKeys.size === 0 && cards.every((c) => c.estimatedMinutes > 0);

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
        timeOfDay: c.timeOfDay ?? undefined,
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

  // The number of sessions a week can be changed here too, whatever the AI first suggested.
  function addCard(sport: Sport) {
    setCards((cur) => {
      const same = cur.filter((c) => c.sport === sport);
      if (same.length >= 7) return cur;
      const minutes = approaches.find((a) => a.sport === sport)?.sessionMinutes ?? same[same.length - 1]?.estimatedMinutes ?? 45;
      const card: Card = { key: `card-new-${Date.now()}-${same.length}`, sport, dayOfWeek: null, timeOfDay: null, estimatedMinutes: minutes };
      const lastAt = cur.map((c) => c.sport).lastIndexOf(sport);
      return [...cur.slice(0, lastAt + 1), card, ...cur.slice(lastAt + 1)];
    });
  }
  function removeCard(sport: Sport) {
    setCards((cur) => {
      const same = cur.filter((c) => c.sport === sport);
      if (same.length <= 1) return cur;
      // Drop one that has no day yet, otherwise the last one.
      const drop = [...same].reverse().find((c) => c.dayOfWeek === null) ?? same[same.length - 1];
      return cur.filter((c) => c.key !== drop.key);
    });
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
          For each session below, choose the day and how many minutes you have. That's all: when you ask for a week plan on the Calendar,
          each of these becomes a real workout for that day, chosen from what you've done so far. The grid at the bottom shows the total per day. Use − and + to change how many sessions a week each sport has; that updates your plan and your sessions-a-week setting too.
        </p>
      </div>

      {error && (
        <div className="card" style={{ borderColor: "var(--danger)" }}>
          <p style={{ margin: 0, color: "var(--danger)", fontSize: 13 }}>{error}</p>
        </div>
      )}

      {[...cardsBySport.entries()].map(([sport, sportCards]) => {
        return (
          <div key={sport} className="card">
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <strong style={{ flex: 1 }}>{SPORT_LABELS[sport]}</strong>
              <span className="text-dim" style={{ fontSize: 12 }}>Sessions a week</span>
              <button className="button-secondary" style={{ padding: "2px 12px" }} aria-label={`One fewer ${SPORT_LABELS[sport]} session`} disabled={sportCards.length <= 1} onClick={() => removeCard(sport)}>
                −
              </button>
              <strong style={{ minWidth: 18, textAlign: "center" }}>{sportCards.length}</strong>
              <button className="button-secondary" style={{ padding: "2px 12px" }} aria-label={`One more ${SPORT_LABELS[sport]} session`} disabled={sportCards.length >= 7} onClick={() => addCard(sport)}>
                +
              </button>
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 10, marginTop: 10 }}>
              {sportCards.map((c, i) => {
                const hasConflict = crowdedKeys.has(c.key);
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
                        onChange={(e) => updateCard(c.key, { dayOfWeek: e.target.value === "" ? null : Number(e.target.value), timeOfDay: null })}
                        style={selectStyle}
                      >
                        <option value="">Day...</option>
                        {DAY_LABELS.map((d, idx) => (
                          <option key={d} value={idx}>
                            {d}
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

                    {hasConflict && (
                      <p style={{ color: "var(--danger)", fontSize: 12, margin: 0 }}>
                        Too many sessions on this day: up to three a day, fewer if your scheduling constraints block some times.
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
            ? `${unplaced.length} session${unplaced.length === 1 ? "" : "s"} still need a day.`
            : "Fix the days marked in red above before saving."}
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
