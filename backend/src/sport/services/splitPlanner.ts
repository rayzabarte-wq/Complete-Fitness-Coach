import { prisma } from "../../lib/prisma.js";
import { Focus, focusMuscles, splitForDays, Split, FOCUS_LABELS, MUSCLE_LABELS } from "../lib/training.js";
import { getRecovery, MuscleRecovery } from "./recovery.js";

/** Given the rotation and the last focus trained, the focus that comes next. */
export function nextInRotation(rotation: Focus[], lastFocus: Focus | null): Focus {
  if (!lastFocus) return rotation[0];
  // Rotations repeat (e.g. U L U L), so continue after the LAST time this
  // focus appears in the first cycle — for repeated patterns that's the
  // same thing as "the one after it".
  const idx = rotation.indexOf(lastFocus);
  if (idx === -1) return rotation[0];
  return rotation[(idx + 1) % rotation.length];
}

/** The most recent strength focus actually trained (logged session), or
 * failing that the latest completed planned strength session. */
export async function lastTrainedFocus(userId: string): Promise<Focus | null> {
  const [logged, planned] = await Promise.all([
    prisma.workoutSession.findFirst({ where: { userId, focus: { not: null } }, orderBy: { date: "desc" } }),
    prisma.plannedSession.findFirst({
      where: { userId, type: "STRENGTH", completed: true, movementPattern: { not: null } },
      orderBy: { date: "desc" },
    }),
  ]);
  if (logged && (!planned || logged.date >= planned.date)) return logged.focus as Focus;
  return (planned?.movementPattern as Focus | undefined) ?? null;
}

export interface TodaySuggestion {
  split: Split;
  /** Next in the rotation. */
  nextFocus: Focus;
  /** What to train today: the next focus if its muscles are recovered,
   * otherwise the first focus in the rotation whose muscles are. */
  suggestedFocus: Focus | null;
  reason: string;
  recovery: MuscleRecovery[];
}

export async function suggestToday(userId: string): Promise<TodaySuggestion> {
  const user = await prisma.user.findUniqueOrThrow({ where: { id: userId }, select: { trainingDaysPerWeek: true } });
  const split = splitForDays(user.trainingDaysPerWeek);
  const [last, recovery] = await Promise.all([lastTrainedFocus(userId), getRecovery(userId)]);
  const nextFocus = nextInRotation(split.rotation, last);
  const status = new Map(recovery.map((r) => [r.muscle, r]));
  const notReady = (f: Focus) => focusMuscles(f).filter((m) => status.get(m)?.status === "RECOVERING");

  const unique = [...new Set(split.rotation)];
  const order = [nextFocus, ...unique.filter((f) => f !== nextFocus)];
  const ready = order.find((f) => notReady(f).length === 0) ?? null;

  let reason: string;
  if (ready === nextFocus) {
    reason = `${FOCUS_LABELS[nextFocus]} is next in your ${split.label} split and those muscles are recovered.`;
  } else if (ready) {
    reason = `${FOCUS_LABELS[nextFocus]} is next, but ${notReady(nextFocus).map((m) => MUSCLE_LABELS[m].toLowerCase()).join(", ")} still recovering, so ${FOCUS_LABELS[ready]} fits better today.`;
  } else {
    reason = "Everything you'd train is still recovering. A rest day is the better call.";
  }
  return { split, nextFocus, suggestedFocus: ready, reason, recovery };
}
