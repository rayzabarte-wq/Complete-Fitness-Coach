import Anthropic from "@anthropic-ai/sdk";
import { prisma } from "../../lib/prisma.js";
import type { Sport, TimeOfDay, SportPriority } from "@prisma/client";

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

const SPORT_LABELS: Record<Sport, string> = {
  STRENGTH: "Strength",
  GOLF: "Golf",
  RUN: "Run",
  WALK: "Walk",
  CYCLING: "Cycling",
  CYCLING_TURBO: "Cycling - Turbo",
  SWIM: "Swim",
};

const DAY_LABELS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const TIME_LABELS: Record<TimeOfDay, string> = { MORNING: "Morning", AFTERNOON: "Afternoon", EVENING: "Evening" };
const ALL_TIMES: TimeOfDay[] = ["MORNING", "AFTERNOON", "EVENING"];

function extractJson(rawText: string): unknown {
  const cleaned = rawText.replace(/```json|```/g, "").trim();
  const match = cleaned.match(/[[{][\s\S]*[\]}]/);
  if (!match) {
    throw new Error(`Claude's response wasn't valid JSON: ${cleaned.slice(0, 300)}`);
  }
  try {
    return JSON.parse(match[0]);
  } catch (err) {
    throw new Error(`Failed to parse Claude's response as JSON: ${(err as Error).message}`);
  }
}

async function askClaude(prompt: string, maxTokens: number): Promise<string> {
  const message = await anthropic.messages.create({
    model: "claude-sonnet-5",
    max_tokens: maxTokens,
    messages: [{ role: "user", content: prompt }],
  });
  const textBlock = message.content.find((block) => block.type === "text");
  if (!textBlock || textBlock.type !== "text") {
    throw new Error("No text response from Claude");
  }
  return textBlock.text;
}

// ---------------------------------------------------------------------------
// Step 1: per-sport 3-month approach, generated together across every
// prioritized sport in one call so total weekly volume stays realistic
// rather than each sport being sized as if it were the only one. This is
// as far as AI involvement in scheduling goes — the day/time placement
// itself (see PUT /:id/framework in routes/plan.ts) is the person's own
// choice, not generated. An earlier version had Claude propose the whole
// week's layout too, but it didn't place sessions the way people actually
// wanted, so that step is now a manual grid the person fills in, seeded by
// the session count/length proposed here.
// ---------------------------------------------------------------------------

export interface GeneratedApproach {
  sport: Sport;
  approachText: string;
  weeklySessionTarget: number;
  sessionMinutes: number;
}

export async function generateSportApproaches(
  overallGoal: string | null,
  priorities: Pick<SportPriority, "sport" | "priority" | "goalNote" | "weeklyMinutesAvailable">[]
): Promise<GeneratedApproach[]> {
  const priorityLines = priorities
    .map(
      (p) =>
        `- ${SPORT_LABELS[p.sport]}: priority ${p.priority}${p.goalNote ? `, goal: "${p.goalNote}"` : ""}${
          p.weeklyMinutesAvailable ? `, time available: ${p.weeklyMinutesAvailable} minutes/week` : ""
        }`
    )
    .join("\n");

  const prompt = `You are a training coach building a balanced 3-month (12-week) plan across multiple sports/activities for one person.

${overallGoal ? `Overall goal stated by the person: "${overallGoal}"\n` : ""}
Sports they want included this quarter, with their priority level, any specific goal, and (where given) how much weekly time they actually have available for that sport:
${priorityLines}

For EACH sport listed above, propose:
1. A short approach (2-4 sentences) describing how training in that sport should be structured and progress across the 12 weeks — mention phasing where it helps (e.g. base building, then intensity), and what the main focus is given its priority level and goal.
2. A realistic weekly session count (weeklySessionTarget) for that sport.
3. A typical single-session length in minutes (sessionMinutes) for that sport.

Where a weekly time-available figure is given, treat it as a hard ceiling: weeklySessionTarget x sessionMinutes must not exceed it (round session count/length down rather than over-committing). Where none is given, use your own judgment for a realistic weekly commitment. Balance the weekly session targets ACROSS all sports together too — the total weekly commitment must be realistic for one person to actually do (a HIGH priority sport should get more sessions/week than a LOW priority one). A sport marked LOW priority should still appear with a maintenance-level approach and a small session count, not be dropped.

Respond with ONLY a JSON array, no other text, in this exact shape:
[{"sport": "STRENGTH", "approachText": "...", "weeklySessionTarget": 3, "sessionMinutes": 45}, ...]
Use these exact sport codes: ${priorities.map((p) => p.sport).join(", ")}.`;

  const rawText = await askClaude(prompt, 2000);
  const parsed = extractJson(rawText) as GeneratedApproach[];
  if (!Array.isArray(parsed)) {
    throw new Error("Expected a JSON array of sport approaches");
  }
  return parsed;
}

// ---------------------------------------------------------------------------
// Step 2: parse a free-text scheduling constraint into structured days/times.
// ---------------------------------------------------------------------------

export interface ParsedConstraint {
  daysOfWeek: number[];
  blockedTimeOfDay: TimeOfDay[];
  parseExplanation: string;
}

export async function parseScheduleConstraint(rawText: string): Promise<ParsedConstraint> {
  const prompt = `Parse this scheduling constraint, written in the person's own words, into structured data.

Constraint: "${rawText}"

Figure out which day(s) of the week it applies to (0=Sunday, 1=Monday, 2=Tuesday, 3=Wednesday, 4=Thursday, 5=Friday, 6=Saturday) and which time(s) of day are blocked (MORNING, AFTERNOON, EVENING). Common phrases: "office days" or "work days" usually means Monday-Friday unless the person names specific days; "weekends" means Saturday and Sunday; if a specific set of days is named (e.g. "Tuesdays and Thursdays"), use exactly those.

Respond with ONLY a JSON object, no other text, in this exact shape:
{"daysOfWeek": [1,2,3,4,5], "blockedTimeOfDay": ["MORNING"], "parseExplanation": "one short sentence stating what you understood, naming the actual days, so the person can confirm or correct it"}`;

  const rawResponse = await askClaude(prompt, 500);
  const parsed = extractJson(rawResponse) as ParsedConstraint;
  return parsed;
}

// ---------------------------------------------------------------------------
// Step 3: for a given constraint, find any framework slots it conflicts
// with and propose alternative day/time-of-day options for each — plain
// deterministic scheduling logic (no AI needed), so it's fast and reliable.
// ---------------------------------------------------------------------------

export interface SlotMoveOption {
  dayOfWeek: number;
  timeOfDay: TimeOfDay;
  dayLabel: string;
  timeLabel: string;
}

export interface SlotConflict {
  slot: { id: string; dayOfWeek: number; timeOfDay: TimeOfDay; sport: Sport; label: string | null };
  options: SlotMoveOption[];
}

/** The framework version currently in force for a plan (effectiveTo: null).
 * There's at most one at a time — a new one only opens once the prior one
 * is explicitly closed (see PUT /:id/framework in routes/plan.ts). */
export async function getCurrentVersion(planId: string) {
  return prisma.frameworkVersion.findFirst({ where: { planId, effectiveTo: null }, include: { slots: true } });
}

export async function findConstraintConflicts(planId: string, constraintId: string): Promise<SlotConflict[]> {
  const constraint = await prisma.scheduleConstraint.findFirst({ where: { id: constraintId, planId } });
  if (!constraint) {
    throw new Error("Constraint not found");
  }

  const currentVersion = await getCurrentVersion(planId);
  const allSlots = currentVersion?.slots ?? [];
  const occupied = new Set(allSlots.map((s) => `${s.dayOfWeek}-${s.timeOfDay}`));

  // Every constraint currently on this plan (including the one just added)
  // — a candidate slot must avoid ALL of them, not just this one.
  const allConstraints = await prisma.scheduleConstraint.findMany({ where: { planId } });
  const isBlocked = (day: number, time: TimeOfDay) =>
    allConstraints.some((c) => c.daysOfWeek.includes(day) && c.blockedTimeOfDay.includes(time));

  const conflictingSlots = allSlots.filter(
    (s) => constraint.daysOfWeek.includes(s.dayOfWeek) && constraint.blockedTimeOfDay.includes(s.timeOfDay)
  );

  const conflicts: SlotConflict[] = conflictingSlots.map((slot) => {
    const candidates: SlotMoveOption[] = [];

    // 1) Same day, a different time-of-day.
    for (const t of ALL_TIMES) {
      if (t === slot.timeOfDay) continue;
      const key = `${slot.dayOfWeek}-${t}`;
      if (!occupied.has(key) && !isBlocked(slot.dayOfWeek, t)) {
        candidates.push({ dayOfWeek: slot.dayOfWeek, timeOfDay: t, dayLabel: DAY_LABELS[slot.dayOfWeek], timeLabel: TIME_LABELS[t] });
      }
    }

    // 2) Same time-of-day, nearest other days first.
    const dayOrderByDistance = [...Array(7).keys()]
      .filter((d) => d !== slot.dayOfWeek)
      .sort((a, b) => {
        const distA = Math.min(Math.abs(a - slot.dayOfWeek), 7 - Math.abs(a - slot.dayOfWeek));
        const distB = Math.min(Math.abs(b - slot.dayOfWeek), 7 - Math.abs(b - slot.dayOfWeek));
        return distA - distB;
      });
    for (const d of dayOrderByDistance) {
      const key = `${d}-${slot.timeOfDay}`;
      if (!occupied.has(key) && !isBlocked(d, slot.timeOfDay)) {
        candidates.push({ dayOfWeek: d, timeOfDay: slot.timeOfDay, dayLabel: DAY_LABELS[d], timeLabel: TIME_LABELS[slot.timeOfDay] });
      }
      if (candidates.length >= 5) break;
    }

    // 3) Fallback: any other free, unblocked slot at all.
    if (candidates.length === 0) {
      for (let d = 0; d < 7; d++) {
        for (const t of ALL_TIMES) {
          const key = `${d}-${t}`;
          if (!occupied.has(key) && !isBlocked(d, t)) {
            candidates.push({ dayOfWeek: d, timeOfDay: t, dayLabel: DAY_LABELS[d], timeLabel: TIME_LABELS[t] });
          }
        }
      }
    }

    return {
      slot: { id: slot.id, dayOfWeek: slot.dayOfWeek, timeOfDay: slot.timeOfDay, sport: slot.sport, label: slot.label },
      options: candidates.slice(0, 3),
    };
  });

  return conflicts;
}

// ---------------------------------------------------------------------------
// Amendments: the user can ask, in free text, to change the plan's CONTENT
// partway through the 3 months ("cut running back to twice a week and add a
// second golf short-game session"). This only touches approaches (weekly
// session target, session length, approach text) — never the day/time
// layout itself. Once the approach changes are applied, the person goes
// back to the same manual schedule-builder grid to rework the placement
// themselves (see PUT /:id/framework), which is exactly how the initial
// schedule was built — one placement mechanism, not two.
// ---------------------------------------------------------------------------

export interface ApproachUpdate {
  sport: Sport;
  approachText?: string;
  weeklySessionTarget?: number;
  sessionMinutes?: number;
}

export interface PlanAmendment {
  changeSummary: string;
  approachUpdates: ApproachUpdate[];
}

export async function generatePlanAmendment(params: {
  overallGoal: string | null;
  approaches: { sport: Sport; approachText: string; weeklySessionTarget: number; sessionMinutes: number }[];
  requestText: string;
}): Promise<PlanAmendment> {
  const { overallGoal, approaches, requestText } = params;

  const approachLines = approaches
    .map((a) => `- ${SPORT_LABELS[a.sport]}: ${a.weeklySessionTarget} sessions/week x ${a.sessionMinutes} min. Current approach: ${a.approachText}`)
    .join("\n");

  const prompt = `You are amending an in-progress 3-month training plan partway through, based on the person's own request. This is NOT a fresh plan — keep everything the request doesn't ask you to change exactly as it is, and you are only adjusting the CONTENT of the plan (weekly session count, session length, approach text) — never a day/time schedule, which the person builds themselves separately.

${overallGoal ? `Overall goal for the quarter: "${overallGoal}"\n` : ""}
Current per-sport approaches:
${approachLines}

The person's amendment request: "${requestText}"

Apply ONLY the change(s) the request actually asks for. For any sport whose weekly session target, session length, or approach text should change as a result, include it in approachUpdates with just the fields that change (omit sports that don't need updating, and omit fields on a sport that don't need updating).

Respond with ONLY a JSON object, no other text, in this exact shape:
{"changeSummary": "one short sentence describing what changed, in plain terms", "approachUpdates": [{"sport": "RUN", "weeklySessionTarget": 2}]}`;

  const rawText = await askClaude(prompt, 1200);
  const parsed = extractJson(rawText) as PlanAmendment;
  if (!Array.isArray(parsed.approachUpdates)) {
    throw new Error("Expected an amendment object with an approachUpdates array");
  }
  return parsed;
}
