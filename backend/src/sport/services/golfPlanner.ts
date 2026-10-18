import { prisma } from "../../lib/prisma.js";
import { askClaude } from "../../lib/claude.js";

// Deliberately excludes GOLF_ROUND — a round isn't a practice session to
// generate drills for, it's the real thing.
export type GolfSessionType = "GOLF_RANGE" | "GOLF_SHORT_GAME" | "GOLF_PUTTING";

const GOLF_TYPE_LABELS: Record<GolfSessionType, string> = {
  GOLF_RANGE: "Range",
  GOLF_SHORT_GAME: "Short Game",
  GOLF_PUTTING: "Putting",
};

const DEFAULT_MINUTES: Record<GolfSessionType, number> = {
  GOLF_RANGE: 45,
  GOLF_SHORT_GAME: 30,
  GOLF_PUTTING: 20,
};

/** One line per drill on a session's checklist: done or not, and the person's comment. */
export function describeDrills(drills: unknown): string {
  if (!Array.isArray(drills)) return "";
  return drills
    .filter((d) => d && typeof d.name === "string")
    .map((d) => `${d.name} (${d.done ? "done" : "not done"}${d.comment ? `: "${String(d.comment).replace(/\s+/g, " ").slice(0, 300)}"` : ""})`)
    .join("; ");
}

export interface GolfDrill {
  name: string;
  detail: string;
  minutes: number;
}

export interface GolfSessionPlan {
  sessionType: GolfSessionType;
  focusSummary: string;
  drills: GolfDrill[];
  totalMinutes: number;
  reasoning: string;
}

export async function generateGolfSessionPlan(
  userId: string,
  type: GolfSessionType,
  requestedMinutes?: number
): Promise<GolfSessionPlan> {
  const targetMinutes = requestedMinutes ?? DEFAULT_MINUTES[type];

  // Two sources of feedback, neither of which is real shot-by-shot
  // performance data — the app doesn't track scores or stats itself, and
  // Arccos has no public API to pull that from automatically (see the
  // README's "Golf feedback loop" section). Both are just whatever the
  // user typed into a session's notes.
  //
  // Note: this reads PlannedSession directly, which is the Scheduler
  // module's table, not Sport's — acceptable while everything shares one
  // database, but if Sport and Scheduler ever become separately deployed
  // apps, this read becomes an API call to Scheduler instead.
  const [recentSessions, recentRounds] = await Promise.all([
    prisma.plannedSession.findMany({
      where: { userId, type, completed: true },
      orderBy: { date: "desc" },
      take: 3,
    }),
    prisma.plannedSession.findMany({
      where: { userId, type: "GOLF_ROUND", completed: true },
      orderBy: { date: "desc" },
      take: 2,
    }),
  ]);

  const describeSession = (s: (typeof recentSessions)[number]) => {
    const parts = [s.date.toISOString().slice(0, 10)];
    if (s.actualMinutes) parts.push(`${s.actualMinutes} min actual`);
    if (s.notes) parts.push(`notes: ${s.notes}`);
    const drills = describeDrills(s.drills);
    if (drills) parts.push(`drills: ${drills}`);
    return parts.join(", ");
  };

  const lastSessionText =
    recentSessions.length === 0
      ? "No prior completed sessions of this type — first one."
      : recentSessions.map(describeSession).join("; ");

  const roundText =
    recentRounds.length === 0
      ? "No completed rounds logged."
      : recentRounds.map(describeSession).join("; ");

  const prompt = `You are a golf coach designing a structured ${targetMinutes}-minute practice session focused on ${GOLF_TYPE_LABELS[type]}.

Most recent completed sessions of this type (most recent first — weight the first one, your last session of this type, as the strongest signal for what to adjust):
${lastSessionText}

Most recent rounds played (their notes may mention weaknesses or takeaways from actual on-course play, sometimes copied from a stats app like Arccos — e.g. strokes gained by category, greens in regulation, up-and-down rate):
${roundText}

Design a practice session with specific drills, not just general advice. Each drill needs a clear name, concrete instructions (what to do, how many balls/reps/putts, what distance or target), and a time allocation. The drill times should sum to approximately ${targetMinutes} minutes. Prioritize addressing whatever the last same-type session's notes flagged; if a recent round's notes point to a relevant weakness for this session type (e.g. a putting session following a round with poor strokes gained putting), factor that in too. If neither source gives a specific signal, use sound general practice structure for ${GOLF_TYPE_LABELS[type]}.

Respond with ONLY a JSON object, no other text, in this exact shape:
{"focusSummary": "one sentence on the session's main focus", "drills": [{"name": string, "detail": string, "minutes": number}], "totalMinutes": number, "reasoning": "one or two sentences on why this structure, naming which feedback (last session or a recent round) it responds to, if any"}`;

  const answer = await askClaude(prompt);

  const rawText = answer.replace(/```json|```/g, "").trim();
  const objectMatch = rawText.match(/\{[\s\S]*\}/);
  if (!objectMatch) {
    throw new Error(`Claude's response wasn't valid JSON: ${rawText.slice(0, 300)}`);
  }

  let parsed: { focusSummary: string; drills: GolfDrill[]; totalMinutes: number; reasoning: string };
  try {
    parsed = JSON.parse(objectMatch[0]);
  } catch (err) {
    throw new Error(`Failed to parse Claude's response as JSON: ${(err as Error).message}`);
  }

  return {
    sessionType: type,
    focusSummary: parsed.focusSummary,
    drills: parsed.drills,
    totalMinutes: parsed.totalMinutes,
    reasoning: parsed.reasoning,
  };
}
