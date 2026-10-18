import { prisma } from "../../lib/prisma.js";
import { askClaude } from "../../lib/claude.js";
import { addDays, dateToDayKey, dayKeyToDate } from "../../lib/dates.js";
import { getAvailability } from "../../services/availability.js";
import { progressFor } from "../../services/ambitions.js";
import { describeDrills, type GolfSessionType } from "./golfPlanner.js";
import { bagPromptBlock, checkDrill, loadGolfBag, type GolfBag } from "./golfBag.js";

// Proposes golf practice for the next 7 days. It reads what the person wrote
// about their recent rounds (a round itself is never counted as practice
// history, only its notes), what recent practice sessions covered and flagged,
// their golf ambition, and how much time each day has left. Nothing is saved:
// the person reviews the proposal and adds the sessions they want.

const TYPES: GolfSessionType[] = ["GOLF_RANGE", "GOLF_SHORT_GAME", "GOLF_PUTTING"];
const TYPE_LABEL: Record<GolfSessionType, string> = { GOLF_RANGE: "Range / full swing", GOLF_SHORT_GAME: "Short game", GOLF_PUTTING: "Putting" };
const AREAS = ["DRIVING", "APPROACH", "SHORT_GAME", "PUTTING", "COURSE_MANAGEMENT", "OTHER"] as const;
export type WeaknessArea = (typeof AREAS)[number];
const MIN_SESSION = 15;
const ROUND_LOOKBACK_DAYS = 75;

export interface WeekDrill { name: string; club: string | null; detail: string; minutes: number }
export interface WeekSession {
  date: string; // day key
  type: GolfSessionType;
  /** Range = at the driving range; Home = garage/net/mat, no ball flight needed. */
  venue: "RANGE" | "HOME" | "COURSE";
  minutes: number;
  focus: string;
  reason: string;
  drills: WeekDrill[];
}
export interface WeekFinding { area: WeaknessArea; finding: string; evidence: string }
export interface GolfWeekProposal {
  from: string;
  to: string;
  summary: string;
  findings: WeekFinding[];
  sessions: WeekSession[];
  /** Why the proposal is thin, e.g. no round notes or no free time. */
  caveats: string[];
  basedOnRoundNotes: number;
}

const clip = (s: string | null | undefined, n: number) => (s ?? "").replace(/\s+/g, " ").trim().slice(0, n);

export async function proposeGolfWeek(userId: string, fromKey: string): Promise<GolfWeekProposal> {
  const start = dayKeyToDate(fromKey);
  const end = addDays(start, 7); // exclusive
  const dayKeys = Array.from({ length: 7 }, (_, i) => dateToDayKey(addDays(start, i)));

  const [availability, plannedInWindow, rounds, practice, ambition, progress, bag] = await Promise.all([
    getAvailability(userId),
    prisma.plannedSession.findMany({
      where: { userId, date: { gte: start, lt: end }, type: { not: "REST" } },
      select: { date: true, type: true, estimatedMinutes: true, completed: true },
    }),
    prisma.golfRound.findMany({
      where: { userId, deletedAt: null, notes: { not: null }, date: { gte: addDays(start, -ROUND_LOOKBACK_DAYS), lt: end } },
      orderBy: { date: "desc" },
      take: 4,
      select: { date: true, course: true, holes: true, notes: true },
    }),
    prisma.plannedSession.findMany({
      where: { userId, completed: true, type: { in: TYPES }, date: { lt: end } },
      orderBy: { date: "desc" },
      take: 6,
      select: { date: true, type: true, notes: true, drills: true, actualMinutes: true, estimatedMinutes: true },
    }),
    prisma.sportAmbition.findUnique({ where: { userId_sport: { userId, sport: "GOLF" } }, select: { statement: true } }),
    progressFor(userId, "GOLF"),
    loadGolfBag(userId),
  ]);

  // Minutes still free each day = what they said they can give, less what is
  // already planned that day (any sport).
  const free = new Map<string, number>();
  for (const key of dayKeys) {
    const avail = availability.minutesByDay[dayKeyToDate(key).getUTCDay()] ?? 0;
    const used = plannedInWindow.filter((p) => dateToDayKey(p.date) === key).reduce((s, p) => s + (p.estimatedMinutes ?? 0), 0);
    free.set(key, Math.max(0, avail - used));
  }
  const usableDays = dayKeys.filter((k) => (free.get(k) ?? 0) >= MIN_SESSION);

  const caveats: string[] = [];
  if (!availability.isSet) caveats.push("You haven't set your weekly time yet (Settings → Weekly time), so no days have time free. Set it and try again.");
  else if (usableDays.length === 0) caveats.push("No day in the next 7 has at least 15 free minutes once your planned sessions are counted.");
  if (rounds.length === 0) caveats.push("No notes on recent rounds, so this is a balanced week rather than one aimed at a weakness. Adding notes to a round (Log → Golf) sharpens it.");

  if (bag.handicap === null) caveats.push("Add your handicap in Settings → Golf so practice is pitched at your level.");
  if (bag.canShapeShots === null) caveats.push("Say whether you can shape shots in Settings → Golf. Until then no shot-shaping drills are offered.");
  if (bag.clubs.length === 0) caveats.push("Add your clubs in Settings → Golf so each drill can name the exact club and practice can cover the whole bag.");

  const base = { from: fromKey, to: dayKeys[6], basedOnRoundNotes: rounds.length };
  if (usableDays.length === 0) return { ...base, summary: "", findings: [], sessions: [], caveats };

  const dayLines = dayKeys.map((k) => {
    const d = dayKeyToDate(k);
    const name = d.toLocaleDateString("en-GB", { weekday: "long", timeZone: "UTC" });
    const already = plannedInWindow.filter((p) => dateToDayKey(p.date) === k).map((p) => `${p.type}${p.estimatedMinutes ? ` ${p.estimatedMinutes}m` : ""}${p.completed ? " (done)" : ""}`);
    return `${k} ${name}: ${free.get(k)} min free${already.length ? `; already planned: ${already.join(", ")}` : ""}`;
  });
  const roundLines = rounds.length
    ? rounds.map((r) => `${dateToDayKey(r.date)} — ${clip(r.course, 60)} (${r.holes} holes): ${clip(r.notes, 700)}`).join("\n")
    : "None.";
  const practiceLines = practice.length
    ? practice.map((s) => `${dateToDayKey(s.date)} ${TYPE_LABEL[s.type as GolfSessionType]}${s.actualMinutes ?? s.estimatedMinutes ? ` ${s.actualMinutes ?? s.estimatedMinutes}m` : ""}: ${clip(s.notes, 400) || "(no notes)"}${describeDrills(s.drills) ? ` | Drills: ${clip(describeDrills(s.drills), 700)}` : ""}`).join("\n")
    : "None.";

  const prompt = `You are a golf coach planning the next 7 days of golf practice for one amateur golfer.

HOW TO USE THEIR ROUND NOTES
The golfer's own notes on recent rounds are the main evidence (a round is not practice history and its score is not given; only what they wrote). Identify the weakest areas the notes point to and aim sessions at them:
- Approach shots hurting scores → a range or home (garage net/mat) session on those clubs and shots (name the clubs/distances/shot shapes the notes mention).
- Driving weak → a range session on driving.
- Short game weak → a short-game session.
- Putting weak → a putting session.
Weight newer rounds more. If the notes name something specific (e.g. "pulled 7-iron", "three-putts from distance"), build drills around it. Do not invent weaknesses the notes do not support; if they are thin, say so in the findings and keep the week balanced.

${bagPromptBlock(bag, TYPES)}

THEIR GOLF AMBITION (their words)
${clip(ambition?.statement, 400) || "Not written."}
Last 90 days: ${progress.rounds ?? 0} rounds, ${progress.sessions} practice sessions.

RECENT ROUND NOTES (newest first)
${roundLines}

RECENT PRACTICE SESSIONS (newest first; notes and drill comments say what was planned, what was done and how it went; drills marked not done are unfinished; do not repeat the same drills unless the notes say they are unfinished or still weak)
${practiceLines}

THE NEXT 7 DAYS (these are the only days available; "free" is the most golf practice that day can hold)
${dayLines.join("\n")}
${availability.notes ? `Their note on their time: ${clip(availability.notes, 300)}` : ""}

RULES
- Propose 2 to 4 sessions in total, at most one per day, only on days with at least ${MIN_SESSION} minutes free, and never longer than that day's free minutes. Fewer, better-aimed sessions beat filling every day. Spread them out; do not stack hard sessions on consecutive days unless time forces it.
- type is one of GOLF_RANGE (full swing: driving, irons, approach), GOLF_SHORT_GAME, GOLF_PUTTING.
- venue is RANGE (driving range), HOME (garage net or mat, short on time, no ball flight needed) or COURSE (practice area at a course). Prefer HOME for sessions of 30 minutes or less and for drills that do not need ball flight; use RANGE when ball flight or driver distance matters.
- Each session has 3 to 6 drills, each with ONE club, and concrete instructions (number of balls or putts, distance, target, a pass mark). Drill minutes must add up to the session minutes.
- Pitch every drill at the player's handicap and shot-shaping ability as described above.
- Do not plan a round. The summary is two sentences at most.

Respond with ONLY a JSON object, no other text, in this exact shape:
{"summary": string, "findings": [{"area": "DRIVING"|"APPROACH"|"SHORT_GAME"|"PUTTING"|"COURSE_MANAGEMENT"|"OTHER", "finding": string, "evidence": "a short quote or paraphrase from their notes, or 'general' if none"}], "sessions": [{"date": "YYYY-MM-DD", "type": "GOLF_RANGE"|"GOLF_SHORT_GAME"|"GOLF_PUTTING", "venue": "RANGE"|"HOME"|"COURSE", "minutes": number, "focus": string, "reason": string, "drills": [{"name": string, "club": "exact club name from the bag, or null if the bag was not entered", "detail": string, "minutes": number}]}]}`;

  const answer = await askClaude(prompt);
  const raw = answer.replace(/```json|```/g, "").trim();
  const m = raw.match(/\{[\s\S]*\}/);
  if (!m) throw new Error(`Claude's response wasn't valid JSON: ${raw.slice(0, 300)}`);
  let parsed: any;
  try {
    parsed = JSON.parse(m[0]);
  } catch (err) {
    throw new Error(`Failed to parse Claude's response as JSON: ${(err as Error).message}`);
  }
  return { ...base, ...cleanProposal(parsed, free, bag), caveats };
}

/** Keeps only what fits the person's real constraints, whatever the model returned. Exported for tests. */
export function cleanProposal(parsed: any, free: Map<string, number>, bag: GolfBag) {
  const findings: WeekFinding[] = (Array.isArray(parsed?.findings) ? parsed.findings : [])
    .filter((f: any) => f && typeof f.finding === "string")
    .slice(0, 5)
    .map((f: any) => ({
      area: (AREAS as readonly string[]).includes(f.area) ? (f.area as WeaknessArea) : "OTHER",
      finding: clip(f.finding, 240),
      evidence: clip(typeof f.evidence === "string" ? f.evidence : "", 240),
    }));

  const seen = new Set<string>();
  const sessions: WeekSession[] = [];
  const rawSessions: any[] = Array.isArray(parsed?.sessions) ? parsed.sessions : [];
  for (const s of rawSessions.sort((a, b) => String(a?.date).localeCompare(String(b?.date)))) {
    const date = typeof s?.date === "string" ? s.date : "";
    const cap = free.get(date) ?? 0; // also rejects dates outside the window
    if (cap < MIN_SESSION || seen.has(date) || !TYPES.includes(s?.type)) continue;

    // Drop trailing drills until they fit the day's free time.
    const drills: WeekDrill[] = [];
    let total = 0;
    for (const d of Array.isArray(s.drills) ? s.drills : []) {
      const minutes = Math.round(Number(d?.minutes));
      if (typeof d?.name !== "string" || !Number.isFinite(minutes) || minutes <= 0) continue;
      const checked = checkDrill(d, s.type, bag);
      if (checked === "drop") continue;
      if (total + minutes > cap) break;
      drills.push({ name: clip(d.name, 80), club: checked.club, detail: clip(d.detail, 400), minutes });
      total += minutes;
    }
    if (drills.length === 0 || total < MIN_SESSION) continue;

    seen.add(date);
    sessions.push({
      date,
      type: s.type,
      venue: s.venue === "HOME" || s.venue === "COURSE" ? s.venue : "RANGE",
      minutes: total,
      focus: clip(s.focus, 200),
      reason: clip(s.reason, 300),
      drills,
    });
    if (sessions.length === 4) break;
  }
  return { summary: clip(parsed?.summary, 400), findings, sessions };
}
