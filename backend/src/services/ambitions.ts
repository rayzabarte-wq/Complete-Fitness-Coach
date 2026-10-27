import type { Sport } from "@prisma/client";
import { prisma } from "../lib/prisma.js";
import { SPORT_SESSION_TYPES } from "../scheduler/lib/sportMapping.js";

export const SPORTS: Sport[] = ["STRENGTH", "GOLF", "RUN", "WALK", "CYCLING", "CYCLING_TURBO", "SWIM"];

// Which sports a few sentences of free text seem to be about. Plain word
// matching, done here on the server: the text is not sent to the AI or
// anywhere else. It only decides which workout types to offer switching on.
const SPORT_WORDS: Record<Sport, RegExp> = {
  STRENGTH: /\b(strength|strong(er)?|lift(ing|s)?|weights?|weight ?training|gym|muscle|squats?|deadlifts?|bench|barbell|dumbbells?|resistance|powerlifting|bodybuild\w*)\b/i,
  GOLF: /\b(golf(ing|er)?|handicap|fairways?|putt(ing|s)?|birdies?|bogey|tee)\b/i,
  RUN: /\b(run(s|ning|ner)?|jog(ging)?|marathons?|parkrun|5k|10k|half[- ]marathon|couch to 5k|sprint(ing)?)\b/i,
  WALK: /\b(walk(s|ing)?|hik(e|es|ing)|trek(king)?|rambl(e|ing)|trails?|munros?)\b/i,
  CYCLING: /\b(cycl(e|ing|ist)|bik(e|ing)|sportives?|road ?bike|mountain ?bik\w*|gravel)\b/i,
  CYCLING_TURBO: /\b(turbo|zwift|indoor (cycling|bike|riding)|smart trainer|spin(ning)?)\b/i,
  SWIM: /\b(swim(s|ming|mer)?|triathl\w*|open[- ]water|lengths|pool|front crawl|freestyle)\b/i,
};

export function sportsMentioned(text: string): Sport[] {
  return SPORTS.filter((s) => SPORT_WORDS[s].test(text));
}

const DAY = 24 * 60 * 60 * 1000;
const WINDOW_DAYS = 90;

export interface SportProgress {
  days: number;
  sessions: number;
  previousSessions: number;
  perWeek: number;
  minutes: number;
  /** Golf only. */
  rounds?: number;
  bestScore18?: number | null;
  averageScore18?: number | null;
}

const round1 = (n: number) => Math.round(n * 10) / 10;

/** What the person has done in a sport over the last 90 days, and the 90 before. */
export async function progressFor(userId: string, sport: Sport, now = new Date()): Promise<SportProgress> {
  const from = new Date(now.getTime() - WINDOW_DAYS * DAY);
  const prevFrom = new Date(now.getTime() - 2 * WINDOW_DAYS * DAY);

  let sessions: number;
  let previousSessions: number;
  let minutes = 0;

  if (sport === "STRENGTH") {
    // Strength is logged set by set as workout sessions.
    const logged = await prisma.workoutSession.findMany({
      where: { userId, date: { gte: prevFrom, lte: now } },
      select: { date: true, startedAt: true, endedAt: true },
    });
    const recent = logged.filter((s) => s.date >= from);
    sessions = recent.length;
    previousSessions = logged.length - recent.length;
    minutes = recent.reduce((sum, s) => (s.startedAt && s.endedAt ? sum + Math.round((s.endedAt.getTime() - s.startedAt.getTime()) / 60000) : sum), 0);
    // Completed rehab / own sessions count as strength sessions too.
    const own = await prisma.plannedSession.findMany({
      where: { userId, adHoc: true, completed: true, type: "STRENGTH", date: { gte: prevFrom, lte: now } },
      select: { date: true, actualMinutes: true, estimatedMinutes: true },
    });
    const ownRecent = own.filter((s) => s.date >= from);
    sessions += ownRecent.length;
    previousSessions += own.length - ownRecent.length;
    minutes += ownRecent.reduce((sum, s) => sum + (s.actualMinutes ?? s.estimatedMinutes ?? 0), 0);
  } else {
    const done = await prisma.plannedSession.findMany({
      where: { userId, completed: true, type: { in: SPORT_SESSION_TYPES[sport] }, date: { gte: prevFrom, lte: now } },
      select: { date: true, actualMinutes: true, estimatedMinutes: true },
    });
    const recent = done.filter((s) => s.date >= from);
    sessions = recent.length;
    previousSessions = done.length - recent.length;
    minutes = recent.reduce((sum, s) => sum + (s.actualMinutes ?? s.estimatedMinutes ?? 0), 0);
  }

  const progress: SportProgress = {
    days: WINDOW_DAYS,
    sessions,
    previousSessions,
    perWeek: round1(sessions / (WINDOW_DAYS / 7)),
    minutes,
  };

  if (sport === "GOLF") {
    const rounds = await prisma.golfRound.findMany({
      where: { userId, deletedAt: null, date: { gte: from, lte: now } },
      select: { holes: true, score: true },
    });
    const scores = rounds.filter((r) => r.holes === 18 && r.score !== null).map((r) => r.score as number);
    progress.rounds = rounds.length;
    progress.bestScore18 = scores.length ? Math.min(...scores) : null;
    progress.averageScore18 = scores.length ? round1(scores.reduce((a, b) => a + b, 0) / scores.length) : null;
  }
  return progress;
}
