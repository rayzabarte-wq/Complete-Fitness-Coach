import Anthropic from "@anthropic-ai/sdk";
import { prisma } from "../../lib/prisma.js";
import type { Sport, TimeOfDay, SessionType, SportPriority, MovementPattern } from "@prisma/client";

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
// rather than each sport being sized as if it were the only one.
// ---------------------------------------------------------------------------

export interface GeneratedApproach {
  sport: Sport;
  approachText: string;
  weeklySessionTarget: number;
}

export async function generateSportApproaches(
  overallGoal: string | null,
  priorities: Pick<SportPriority, "sport" | "priority" | "goalNote">[]
): Promise<GeneratedApproach[]> {
  const priorityLines = priorities
    .map((p) => `- ${SPORT_LABELS[p.sport]}: priority ${p.priority}${p.goalNote ? `, goal: "${p.goalNote}"` : ""}`)
    .join("\n");

  const prompt = `You are a training coach building a balanced 3-month (12-week) plan across multiple sports/activities for one person.

${overallGoal ? `Overall goal stated by the person: "${overallGoal}"\n` : ""}
Sports they want included this quarter, with their priority level and any specific goal for that sport:
${priorityLines}

For EACH sport listed above, propose:
1. A short approach (2-4 sentences) describing how training in that sport should be structured and progress across the 12 weeks — mention phasing where it helps (e.g. base building, then intensity), and what the main focus is given its priority level and goal.
2. A realistic weekly session count (weeklySessionTarget) for that sport.

Balance the weekly session targets ACROSS all sports together — the total weekly commitment must be realistic for one person to actually do (a HIGH priority sport should get more sessions/week than a LOW priority one, and the grand total across all sports should be a plausible week, generally in the 4-8 total sessions/week range unless the goals clearly call for more). A sport marked LOW priority should still appear with a maintenance-level approach and a small session count, not be dropped.

Respond with ONLY a JSON array, no other text, in this exact shape:
[{"sport": "STRENGTH", "approachText": "...", "weeklySessionTarget": 3}, ...]
Use these exact sport codes: ${priorities.map((p) => p.sport).join(", ")}.`;

  const rawText = await askClaude(prompt, 2000);
  const parsed = extractJson(rawText) as GeneratedApproach[];
  if (!Array.isArray(parsed)) {
    throw new Error("Expected a JSON array of sport approaches");
  }
  return parsed;
}

// ---------------------------------------------------------------------------
// Step 2: weekly scheduling framework — a recurring template (day of week +
// time of day + sport, optionally a specific sub-type) distributing every
// approved sport's weekly session target across the week.
// ---------------------------------------------------------------------------

export interface GeneratedSlot {
  dayOfWeek: number;
  timeOfDay: TimeOfDay;
  sport: Sport;
  sessionType?: SessionType | null;
  // Only meaningful when sport is STRENGTH — mirrors PlannedSession's own
  // field so the dashboard can compare planned vs. actual Push/Pull/Legs/
  // Core minutes directly.
  movementPattern?: MovementPattern | null;
  label?: string | null;
  notes?: string | null;
}

export async function generateWeeklyFramework(
  approaches: { sport: Sport; approachText: string; weeklySessionTarget: number }[],
  visibleSessionTypes: SessionType[],
  existingConstraints: { rawText: string; daysOfWeek: number[]; blockedTimeOfDay: TimeOfDay[] }[]
): Promise<GeneratedSlot[]> {
  const approachLines = approaches
    .map((a) => `- ${SPORT_LABELS[a.sport]}: ${a.weeklySessionTarget} sessions/week. Approach: ${a.approachText}`)
    .join("\n");

  const constraintLines =
    existingConstraints.length === 0
      ? "None yet."
      : existingConstraints
          .map(
            (c) =>
              `- "${c.rawText}" -> blocks ${c.blockedTimeOfDay.map((t) => TIME_LABELS[t]).join("/")} on ${c.daysOfWeek
                .map((d) => DAY_LABELS[d])
                .join(", ")}`
          )
          .join("\n");

  const visibleTypesLine = visibleSessionTypes.length > 0 ? visibleSessionTypes.join(", ") : "(use general sport-level slots only)";

  const prompt = `You are building a recurring WEEKLY scheduling framework (a template, not dated sessions) for a training plan that spans several sports.

Approved sport approaches and weekly session targets:
${approachLines}

Session types the person actually tracks (only use these for the optional "sessionType" field, or omit it if none fits well):
${visibleTypesLine}

Known scheduling constraints already in place — do NOT place anything in a blocked day/time combination:
${constraintLines}

Design one recurring week (Sunday through Saturday, each day split into Morning/Afternoon/Evening) placing exactly the weekly session target for each sport somewhere across the week. Rules:
- Never put two sessions in the same day+time-of-day slot.
- Spread hard sessions out — don't stack two demanding sessions back-to-back when avoidable (e.g. don't put a long run the morning right before an evening strength session on the same day if a better slot exists).
- Respect the constraints listed above exactly — do not use a blocked day/time-of-day for anything.
- Leave slots empty (i.e. don't create an entry) for rest/recovery — you don't need to fill every slot.
- Prefer Evening or Morning for most sessions; use Afternoon sparingly, only when it clearly helps spacing.
- For every STRENGTH slot, set "movementPattern" to one of PUSH, PULL, LEGS, or CORE, and rotate through them sensibly across the week (e.g. don't repeat the same pattern on back-to-back strength days without adequate spacing) so each gets covered roughly evenly.

Respond with ONLY a JSON array, no other text, in this exact shape:
[{"dayOfWeek": 1, "timeOfDay": "EVENING", "sport": "STRENGTH", "sessionType": "STRENGTH", "movementPattern": "PUSH", "label": "Push day", "notes": "one short reason for this placement"}, ...]
dayOfWeek is 0=Sunday .. 6=Saturday. sessionType is optional (omit or null if none fits). movementPattern is required for STRENGTH slots and should be omitted/null for every other sport. Use these exact sport codes: ${approaches.map((a) => a.sport).join(", ")}.`;

  const rawText = await askClaude(prompt, 2500);
  const parsed = extractJson(rawText) as GeneratedSlot[];
  if (!Array.isArray(parsed)) {
    throw new Error("Expected a JSON array of framework slots");
  }
  return parsed;
}

// ---------------------------------------------------------------------------
// Step 3: parse a free-text scheduling constraint into structured days/times.
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
// Step 4: for a given constraint, find any framework slots it conflicts
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
 * is explicitly closed (see applyAmendment below). */
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
// Amendments: the user can ask, in free text, to change the plan partway
// through the 3 months ("cut running back to twice a week and add a second
// golf short-game session"). Unlike the initial framework, this needs the
// current state (approaches, current slots) as context, and can adjust
// both the per-sport weekly targets and the weekly template — but only for
// the sports the request actually concerns; the rest should come back
// unchanged so the caller can apply a partial update.
// ---------------------------------------------------------------------------

export interface ApproachUpdate {
  sport: Sport;
  approachText?: string;
  weeklySessionTarget?: number;
}

export interface PlanAmendment {
  changeSummary: string;
  approachUpdates: ApproachUpdate[];
  slots: GeneratedSlot[];
}

export async function generatePlanAmendment(params: {
  overallGoal: string | null;
  approaches: { sport: Sport; approachText: string; weeklySessionTarget: number }[];
  currentSlots: { dayOfWeek: number; timeOfDay: TimeOfDay; sport: Sport; sessionType: SessionType | null; movementPattern: MovementPattern | null; label: string | null }[];
  constraints: { rawText: string; daysOfWeek: number[]; blockedTimeOfDay: TimeOfDay[] }[];
  requestText: string;
}): Promise<PlanAmendment> {
  const { overallGoal, approaches, currentSlots, constraints, requestText } = params;

  const approachLines = approaches
    .map((a) => `- ${SPORT_LABELS[a.sport]}: ${a.weeklySessionTarget} sessions/week. Current approach: ${a.approachText}`)
    .join("\n");

  const slotLines =
    currentSlots.length === 0
      ? "(no weekly framework yet)"
      : currentSlots
          .map(
            (s) =>
              `- ${DAY_LABELS[s.dayOfWeek]} ${TIME_LABELS[s.timeOfDay]}: ${SPORT_LABELS[s.sport]}${
                s.movementPattern ? ` (${s.movementPattern})` : s.sessionType ? ` (${s.sessionType})` : ""
              }${s.label ? ` - ${s.label}` : ""}`
          )
          .join("\n");

  const constraintLines =
    constraints.length === 0
      ? "None."
      : constraints
          .map((c) => `- "${c.rawText}" -> blocks ${c.blockedTimeOfDay.map((t) => TIME_LABELS[t]).join("/")} on ${c.daysOfWeek.map((d) => DAY_LABELS[d]).join(", ")}`)
          .join("\n");

  const prompt = `You are amending an in-progress 3-month training plan partway through, based on the person's own request. This is NOT a fresh plan — keep everything the request doesn't ask you to change exactly as it is.

${overallGoal ? `Overall goal for the quarter: "${overallGoal}"\n` : ""}
Current per-sport approaches and weekly session targets:
${approachLines}

Current weekly framework (the recurring template in effect right now):
${slotLines}

Scheduling constraints that still apply — do NOT place anything in a blocked day/time combination:
${constraintLines}

The person's amendment request: "${requestText}"

Apply ONLY the change(s) the request actually asks for. For any sport whose weekly session target or approach text should change as a result, include it in approachUpdates (only the sports that change — omit sports that don't need updating). Then produce the FULL new weekly framework (every slot for every sport, not just the changed ones) reflecting the update — reuse the existing placements for anything unaffected by the request, and only move/add/remove what the request requires. Keep the same rules as before: no double-booking a day+time-of-day, respect constraints, spread hard sessions out, set movementPattern for every STRENGTH slot.

Respond with ONLY a JSON object, no other text, in this exact shape:
{"changeSummary": "one short sentence describing what changed, in plain terms", "approachUpdates": [{"sport": "RUN", "weeklySessionTarget": 2}], "slots": [{"dayOfWeek": 1, "timeOfDay": "EVENING", "sport": "STRENGTH", "sessionType": "STRENGTH", "movementPattern": "PUSH", "label": "Push day", "notes": "..."}]}`;

  const rawText = await askClaude(prompt, 3000);
  const parsed = extractJson(rawText) as PlanAmendment;
  if (!Array.isArray(parsed.slots) || !Array.isArray(parsed.approachUpdates)) {
    throw new Error("Expected an amendment object with slots and approachUpdates arrays");
  }
  return parsed;
}
