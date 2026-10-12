// Body-goal maths: pace lines, on-track status, revision direction and the
// quarterly goal-setting review. Pure functions only — routes/body.ts loads
// the data and calls these — so the logic can be tested without a database.

export type BodyMetric = "BODY_FAT_PCT" | "MUSCLE_MASS_KG" | "BODY_WEIGHT_KG";

export const METRIC_LABELS: Record<BodyMetric, string> = {
  BODY_FAT_PCT: "Body fat",
  MUSCLE_MASS_KG: "Muscle mass",
  BODY_WEIGHT_KG: "Body weight",
};

export const METRIC_UNITS: Record<BodyMetric, string> = {
  BODY_FAT_PCT: "%",
  MUSCLE_MASS_KG: "kg",
  BODY_WEIGHT_KG: "kg",
};

export type RevisionReason = "INJURY_OR_ILLNESS" | "LIFE_EVENT" | "TOO_AMBITIOUS" | "TOO_EASY" | "CHANGED_PRIORITIES" | "OTHER";

export const REASON_LABELS: Record<RevisionReason, string> = {
  INJURY_OR_ILLNESS: "injury or illness",
  LIFE_EVENT: "a life event",
  TOO_AMBITIOUS: "the target was too ambitious",
  TOO_EASY: "the target was too easy",
  CHANGED_PRIORITIES: "changed priorities",
  OTHER: "another reason",
};

/** Revisions driven by circumstances rather than the target itself. */
const CIRCUMSTANCE_REASONS: RevisionReason[] = ["INJURY_OR_ILLNESS", "LIFE_EVENT"];

export interface Target {
  anchorDate: Date;
  anchorValue: number;
  targetValue: number;
  targetDate: Date;
  reason: RevisionReason | null;
  note: string | null;
  createdAt: Date;
}

export interface Reading {
  date: Date;
  value: number;
}

const DAY = 86400_000;

function round1(n: number): number {
  return Math.round(n * 10) / 10;
}

/** The value the pace line says you should be at on `date`. */
export function paceValueAt(t: Target, date: Date): number {
  const span = t.targetDate.getTime() - t.anchorDate.getTime();
  if (span <= 0) return t.targetValue;
  const frac = Math.min(1, Math.max(0, (date.getTime() - t.anchorDate.getTime()) / span));
  return t.anchorValue + (t.targetValue - t.anchorValue) * frac;
}

/** +1 if the goal is to increase the metric, -1 to decrease it. */
export function goalDirection(startValue: number, firstTarget: Target): 1 | -1 {
  return firstTarget.targetValue >= startValue ? 1 : -1;
}

export type PaceState = "AHEAD" | "ON_TRACK" | "BEHIND" | "REACHED" | "NO_DATA";

export interface PaceStatus {
  state: PaceState;
  label: string;
  /** Signed gap to the pace line in metric units (positive = ahead). */
  gap: number | null;
  latest: Reading | null;
  /** Where the recent trend points on the target date, if there's enough data. */
  projectedAtTarget: number | null;
}

const TOLERANCE: Record<BodyMetric, number> = { BODY_FAT_PCT: 0.3, MUSCLE_MASS_KG: 0.3, BODY_WEIGHT_KG: 0.5 };

/** Least-squares slope (units per day) through readings since `from`. */
function trendSlope(readings: Reading[], from: Date): { slope: number; intercept: number } | null {
  const pts = readings.filter((r) => r.date >= from);
  if (pts.length < 3) return null;
  const xs = pts.map((p) => (p.date.getTime() - from.getTime()) / DAY);
  const ys = pts.map((p) => p.value);
  const n = xs.length;
  const mx = xs.reduce((a, b) => a + b, 0) / n;
  const my = ys.reduce((a, b) => a + b, 0) / n;
  let num = 0;
  let den = 0;
  for (let i = 0; i < n; i++) {
    num += (xs[i] - mx) * (ys[i] - my);
    den += (xs[i] - mx) ** 2;
  }
  if (den === 0) return null;
  const slope = num / den;
  return { slope, intercept: my - slope * mx };
}

export function paceStatus(metric: BodyMetric, direction: 1 | -1, current: Target, readings: Reading[]): PaceStatus {
  const sorted = [...readings].sort((a, b) => a.date.getTime() - b.date.getTime());
  const latest = sorted[sorted.length - 1] ?? null;
  const unit = METRIC_UNITS[metric];
  if (!latest) {
    return { state: "NO_DATA", label: "No measurements yet", gap: null, latest: null, projectedAtTarget: null };
  }

  const trend = trendSlope(sorted, current.anchorDate);
  const projectedAtTarget = trend
    ? round1(trend.intercept + trend.slope * ((current.targetDate.getTime() - current.anchorDate.getTime()) / DAY))
    : null;

  if ((latest.value - current.targetValue) * direction >= 0) {
    return { state: "REACHED", label: "Target reached", gap: round1((latest.value - current.targetValue) * direction), latest, projectedAtTarget };
  }

  const pace = paceValueAt(current, latest.date);
  const gap = (latest.value - pace) * direction;
  const tol = TOLERANCE[metric];
  const amount = `${round1(Math.abs(gap))}${unit === "%" ? "%" : ` ${unit}`}`;
  if (gap > tol) return { state: "AHEAD", label: `${amount} ahead of pace`, gap: round1(gap), latest, projectedAtTarget };
  if (gap < -tol) return { state: "BEHIND", label: `${amount} behind pace`, gap: round1(gap), latest, projectedAtTarget };
  return { state: "ON_TRACK", label: "On track", gap: round1(gap), latest, projectedAtTarget };
}

export type RevisionDirection = "EASIER" | "HARDER" | "SIMILAR";

/** Compares a revised target with the one it replaced, from the revision's
 * own starting point: how much change per day each would demand. */
export function revisionDirection(direction: 1 | -1, previous: Target, revised: Target): RevisionDirection {
  const days = (d: Date) => Math.max(1, (d.getTime() - revised.anchorDate.getTime()) / DAY);
  const prevRate = ((previous.targetValue - revised.anchorValue) * direction) / days(previous.targetDate);
  const newRate = ((revised.targetValue - revised.anchorValue) * direction) / days(revised.targetDate);
  if (newRate < prevRate * 0.95 - 1e-9) return "EASIER";
  if (newRate > prevRate * 1.05 + 1e-9) return "HARDER";
  return "SIMILAR";
}

/** Rough sustainable rates of change, per 30 days, used only to describe
 * how ambitious a goal is. They're broad rules of thumb, not medical
 * guidance: losing ~0.5–1% of body weight a week, ~0.5–1 body-fat point a
 * month, and ~0.25–0.5 kg of muscle a month for someone past their
 * beginner gains. */
const TYPICAL_MONTHLY: Record<BodyMetric, (start: number) => [number, number]> = {
  BODY_FAT_PCT: () => [0.5, 1],
  MUSCLE_MASS_KG: () => [0.25, 0.5],
  BODY_WEIGHT_KG: (start) => [start * 0.005 * 4.3, start * 0.01 * 4.3],
};

export type Ambition = "GENTLE" | "TYPICAL" | "AMBITIOUS";

export function ambitionOf(metric: BodyMetric, startValue: number, t: Target): { ambition: Ambition; monthlyRate: number; typical: [number, number] } {
  const months = Math.max(0.25, (t.targetDate.getTime() - t.anchorDate.getTime()) / (30 * DAY));
  const monthlyRate = Math.abs(t.targetValue - t.anchorValue) / months;
  const typical = TYPICAL_MONTHLY[metric](startValue);
  const ambition: Ambition = monthlyRate > typical[1] * 1.05 ? "AMBITIOUS" : monthlyRate < typical[0] * 0.95 ? "GENTLE" : "TYPICAL";
  const r2 = (n: number) => Math.round(n * 100) / 100;
  return { ambition, monthlyRate: r2(monthlyRate), typical: [r2(typical[0]), r2(typical[1])] };
}

// --- Quarterly review ------------------------------------------------------

export interface ReviewGoal {
  id: string;
  metric: BodyMetric;
  startValue: number;
  createdAt: Date;
  status: "ACTIVE" | "ACHIEVED" | "CLOSED";
  closedAt: Date | null;
  targets: Target[]; // oldest first
}

export interface QuarterReview {
  quarter: string;
  from: string;
  to: string;
  goalsSet: number;
  goalsAchieved: number;
  revisions: {
    goalId: string;
    metric: BodyMetric;
    at: string;
    direction: RevisionDirection;
    reason: RevisionReason | null;
    targetChange: string;
    dateChangeDays: number;
  }[];
  counts: { easier: number; harder: number; similar: number; circumstance: number };
  ambition: { goalId: string; metric: BodyMetric; ambition: Ambition; monthlyRate: number; typical: [number, number] }[];
  summary: string[];
}

/** "2026-Q4" → [Oct 1, Jan 1) in UTC. */
export function quarterBounds(quarter: string): { from: Date; to: Date } {
  const m = /^(\d{4})-Q([1-4])$/.exec(quarter);
  if (!m) throw new Error("Quarter must look like 2026-Q4");
  const year = Number(m[1]);
  const q = Number(m[2]);
  return { from: new Date(Date.UTC(year, (q - 1) * 3, 1)), to: new Date(Date.UTC(year, q * 3, 1)) };
}

export function quarterOf(date: Date): string {
  return `${date.getUTCFullYear()}-Q${Math.floor(date.getUTCMonth() / 3) + 1}`;
}

function plural(n: number, word: string): string {
  return `${n} ${word}${n === 1 ? "" : "s"}`;
}

/**
 * Describes — rather than scores — how goals were set and recalibrated in a
 * calendar quarter. Revisions tagged with a circumstance (injury, a life
 * event) are reported separately so a necessary change isn't framed the
 * same way as quietly lowering the bar.
 */
export function buildQuarterReview(quarter: string, goals: ReviewGoal[]): QuarterReview {
  const { from, to } = quarterBounds(quarter);
  const inQ = (d: Date) => d >= from && d < to;

  const set = goals.filter((g) => inQ(g.createdAt));
  const achieved = goals.filter((g) => g.status === "ACHIEVED" && g.closedAt && inQ(g.closedAt));

  const revisions: QuarterReview["revisions"] = [];
  for (const g of goals) {
    const dir = goalDirection(g.startValue, g.targets[0]);
    for (let i = 1; i < g.targets.length; i++) {
      const t = g.targets[i];
      if (!inQ(t.createdAt)) continue;
      const prev = g.targets[i - 1];
      const unit = METRIC_UNITS[g.metric];
      revisions.push({
        goalId: g.id,
        metric: g.metric,
        at: t.createdAt.toISOString(),
        direction: revisionDirection(dir, prev, t),
        reason: t.reason,
        targetChange: `${round1(prev.targetValue)}${unit} → ${round1(t.targetValue)}${unit}`,
        dateChangeDays: Math.round((t.targetDate.getTime() - prev.targetDate.getTime()) / DAY),
      });
    }
  }

  const circumstance = revisions.filter((r) => r.reason && CIRCUMSTANCE_REASONS.includes(r.reason));
  const counts = {
    easier: revisions.filter((r) => r.direction === "EASIER").length,
    harder: revisions.filter((r) => r.direction === "HARDER").length,
    similar: revisions.filter((r) => r.direction === "SIMILAR").length,
    circumstance: circumstance.length,
  };

  const ambition = set.map((g) => ({ goalId: g.id, metric: g.metric, ...ambitionOf(g.metric, g.startValue, g.targets[0]) }));

  const summary: string[] = [];
  if (set.length === 0 && revisions.length === 0 && achieved.length === 0) {
    summary.push("No goals were set or changed this quarter.");
  } else {
    summary.push(
      `You set ${plural(set.length, "goal")}, revised targets ${revisions.length === 1 ? "once" : `${revisions.length} times`}, and reached ${plural(achieved.length, "goal")}.`
    );
    if (revisions.length > 0) {
      const parts: string[] = [];
      if (counts.easier) parts.push(`${counts.easier} made the target easier`);
      if (counts.harder) parts.push(`${counts.harder} made it harder`);
      if (counts.similar) parts.push(`${counts.similar} kept roughly the same demand`);
      summary.push(`Of the revisions, ${parts.join(", ")}.`);
      if (counts.circumstance > 0) {
        summary.push(
          `${counts.circumstance === revisions.length ? "All" : counts.circumstance} of them came from circumstances (injury, illness or a life event) rather than the target itself.`
        );
      }
      const easierWithoutReason = revisions.filter((r) => r.direction === "EASIER" && (!r.reason || !CIRCUMSTANCE_REASONS.includes(r.reason))).length;
      if (easierWithoutReason >= 2) {
        summary.push(
          `${easierWithoutReason} targets were eased without an outside cause. If that's a pattern, try setting the next goal a little gentler from the start and holding to it.`
        );
      }
      if (counts.harder > 0 && counts.easier === 0) {
        summary.push("You only ever raised the bar. Your starting targets may have been on the cautious side.");
      }
    }
    for (const a of ambition) {
      const unit = METRIC_UNITS[a.metric];
      const rate = `${a.monthlyRate}${unit === "%" ? " points" : ` ${unit}`} a month`;
      const typical = `${a.typical[0]}–${a.typical[1]}${unit === "%" ? " points" : ` ${unit}`}`;
      if (a.ambition === "AMBITIOUS") {
        summary.push(`Your ${METRIC_LABELS[a.metric].toLowerCase()} goal asked for ${rate}, faster than the roughly ${typical} most people sustain, so it was ambitious.`);
      } else if (a.ambition === "GENTLE") {
        summary.push(`Your ${METRIC_LABELS[a.metric].toLowerCase()} goal asked for ${rate}, gentler than the usual ${typical}. There's room to aim higher.`);
      } else {
        summary.push(`Your ${METRIC_LABELS[a.metric].toLowerCase()} goal asked for ${rate}, within the usual ${typical}. A realistic target.`);
      }
    }
  }

  return {
    quarter,
    from: from.toISOString(),
    to: to.toISOString(),
    goalsSet: set.length,
    goalsAchieved: achieved.length,
    revisions,
    counts,
    ambition,
    summary,
  };
}
