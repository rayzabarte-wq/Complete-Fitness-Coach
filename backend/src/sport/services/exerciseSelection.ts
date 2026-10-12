import { Prisma } from "@prisma/client";
import { prisma } from "../../lib/prisma.js";
import { Focus, FOCUS_SLOTS, FOCUS_SOURCE_PATTERNS, Muscle, MUSCLE_LABELS } from "../lib/training.js";

// Block-based exercise variation.
//
// What the evidence says (and why it's built this way): changing exercises
// every session doesn't build more muscle or strength than keeping them
// stable, and constant novelty can leave you more sore and fatigued. What
// does help is covering different regions of a muscle with complementary
// exercises, changed between training blocks rather than within them
// (e.g. Kassiano et al. 2022, J Strength Cond Res; Baz-Valle et al. 2019,
// PLOS One). So:
//
// - Each session focus keeps the same exercises for a block (BLOCK_WEEKS),
//   so the load on them can actually progress.
// - Inside a block, an exercise is only swapped if progress on it stalls.
// - When a block ends, main lifts that are still progressing carry over;
//   the rest rotate to complementary variations, chosen from whichever
//   regions/angles of each muscle (Exercise.variationTag) got the least
//   work over the last LOOKBACK_DAYS — a coverage problem, not random
//   shuffling.

export const BLOCK_WEEKS = 4;
export const LOOKBACK_DAYS = 56;
const STALL_EXPOSURES = 3;

export interface CatalogExercise {
  id: string;
  name: string;
  category: "COMPOUND" | "ACCESSORY";
  movementPattern: string;
  primaryMuscle: Muscle | null;
  secondaryMuscles: Muscle[];
  variationTag: string | null;
}

/** One logged set, flattened, for the pure functions below. */
export interface HistorySet {
  exerciseId: string;
  variationTag: string | null;
  primaryMuscle: Muscle | null;
  date: Date;
  sessionId: string;
  weightLb: number;
  reps: number;
}

/** Sets per variation tag over the history window. */
export function tallyTags(history: HistorySet[]): Map<string, number> {
  const out = new Map<string, number>();
  for (const s of history) {
    if (!s.variationTag) continue;
    out.set(s.variationTag, (out.get(s.variationTag) ?? 0) + 1);
  }
  return out;
}

/** Best-set performance score per session for one exercise, oldest first.
 * Loaded movements use estimated 1-rep max (Epley); bodyweight/band
 * movements without added load use reps. */
export function exposureScores(history: HistorySet[], exerciseId: string): number[] {
  const bySession = new Map<string, { date: Date; best: number }>();
  for (const s of history) {
    if (s.exerciseId !== exerciseId) continue;
    const score = s.weightLb > 0 ? s.weightLb * (1 + s.reps / 30) : s.reps;
    const cur = bySession.get(s.sessionId);
    if (!cur || score > cur.best) bySession.set(s.sessionId, { date: s.date, best: Math.max(score, cur?.best ?? 0) });
  }
  return [...bySession.values()].sort((a, b) => a.date.getTime() - b.date.getTime()).map((x) => x.best);
}

/** Stalled = at least 4 sessions of history, and the best of the last 3 is
 * no better than the best before them. */
export function isStalled(scores: number[]): boolean {
  if (scores.length < STALL_EXPOSURES + 1) return false;
  const recent = scores.slice(-STALL_EXPOSURES);
  const earlier = scores.slice(0, -STALL_EXPOSURES);
  return Math.max(...recent) <= Math.max(...earlier);
}

export interface SelectionContext {
  tagSets: Map<string, number>;
  stalled: Set<string>;
  /** Exercises in the previous block for this focus (empty on the first). */
  previousBlockIds: Set<string>;
}

export interface SelectedExercise {
  exercise: CatalogExercise;
  slotMuscles: Muscle[];
  reason: string;
}

function tagLabel(tag: string): string {
  return tag.toLowerCase().replace(/_/g, " ");
}

function scoreCandidate(
  ex: CatalogExercise,
  isFirstSlotForMuscle: boolean,
  ctx: SelectionContext,
  chosenTags: Set<string>
): { score: number; reason: string } {
  const tag = ex.variationTag ?? ex.id;
  const tagSets = ctx.tagSets.get(tag) ?? 0;
  let score = 12 / (1 + tagSets / 4);
  let reason =
    tagSets === 0
      ? `Covers ${tagLabel(tag)}, which got no work in the last ${LOOKBACK_DAYS / 7} weeks`
      : `Covers ${tagLabel(tag)} (${tagSets} sets in the last ${LOOKBACK_DAYS / 7} weeks)`;

  if (chosenTags.has(tag)) score -= 15; // same angle twice in one session
  if (isFirstSlotForMuscle) score += ex.category === "COMPOUND" ? 4 : -1;

  const stalled = ctx.stalled.has(ex.id);
  if (ctx.previousBlockIds.has(ex.id)) {
    if (stalled) {
      score -= 20;
    } else if (ex.category === "COMPOUND") {
      score += 6;
      reason = "Kept from your last block — still progressing";
    } else {
      score -= 6; // rotate accessories to a complementary variation
    }
  } else if (stalled) {
    score -= 10;
  }
  return { score, reason };
}

/** Fills the focus's slots, one exercise per slot, primary muscle in the
 * slot's list, no exercise twice. Deterministic for a given context. */
export function chooseExercises(focus: Focus, catalog: CatalogExercise[], ctx: SelectionContext): SelectedExercise[] {
  const patterns = FOCUS_SOURCE_PATTERNS[focus];
  const pool = catalog.filter((e) => patterns.includes(e.movementPattern as never) && e.primaryMuscle);
  const chosen: SelectedExercise[] = [];
  const chosenIds = new Set<string>();
  const chosenTags = new Set<string>();
  const musclesSeen = new Set<Muscle>();

  for (const slot of FOCUS_SLOTS[focus]) {
    // For a slot that accepts either of two muscles (e.g. triceps OR
    // biceps), prefer the one with less recent work.
    const candidates = pool.filter((e) => slot.includes(e.primaryMuscle!) && !chosenIds.has(e.id));
    if (candidates.length === 0) continue;
    let best: { ex: CatalogExercise; score: number; reason: string } | null = null;
    for (const ex of candidates) {
      const { score, reason } = scoreCandidate(ex, !musclesSeen.has(ex.primaryMuscle!), ctx, chosenTags);
      if (!best || score > best.score || (score === best.score && ex.name < best.ex.name)) {
        best = { ex, score, reason };
      }
    }
    if (!best) continue;
    chosen.push({ exercise: best.ex, slotMuscles: slot, reason: best.reason });
    chosenIds.add(best.ex.id);
    chosenTags.add(best.ex.variationTag ?? best.ex.id);
    musclesSeen.add(best.ex.primaryMuscle!);
  }
  return chosen;
}

/** Two core exercises to finish a non-core session with — the two least-
 * worked core angles, never the same angle twice, and not a repeat of the
 * last session's finisher where avoidable. Core work is low-load and
 * recovers fast, so it rotates per session rather than per block. */
export function chooseCoreFinisher(catalog: CatalogExercise[], tagSets: Map<string, number>, lastFinisherIds: Set<string>): CatalogExercise[] {
  const core = catalog
    .filter((e) => e.movementPattern === "CORE")
    .map((e) => ({
      e,
      score: (tagSets.get(e.variationTag ?? e.id) ?? 0) + (lastFinisherIds.has(e.id) ? 100 : 0),
    }))
    .sort((a, b) => a.score - b.score || a.e.name.localeCompare(b.e.name));
  const picked: CatalogExercise[] = [];
  const tags = new Set<string>();
  for (const { e } of core) {
    const tag = e.variationTag ?? e.id;
    if (tags.has(tag)) continue;
    picked.push(e);
    tags.add(tag);
    if (picked.length === 2) break;
  }
  return picked;
}

/** Best replacement for a stalled exercise: same primary muscle, not
 * already in the block, by the same coverage scoring. */
export function chooseReplacement(
  stalledEx: CatalogExercise,
  focus: Focus,
  catalog: CatalogExercise[],
  blockIds: Set<string>,
  ctx: SelectionContext
): CatalogExercise | null {
  const patterns = FOCUS_SOURCE_PATTERNS[focus];
  const blockTags = new Set(catalog.filter((e) => blockIds.has(e.id)).map((e) => e.variationTag ?? e.id));
  blockTags.delete(stalledEx.variationTag ?? stalledEx.id);
  const candidates = catalog.filter(
    (e) => patterns.includes(e.movementPattern as never) && e.primaryMuscle === stalledEx.primaryMuscle && !blockIds.has(e.id) && !ctx.stalled.has(e.id)
  );
  let best: { ex: CatalogExercise; score: number } | null = null;
  for (const ex of candidates) {
    const { score } = scoreCandidate(ex, ex.category === "COMPOUND", { ...ctx, previousBlockIds: new Set() }, blockTags);
    // Prefer staying in the same category (a compound replaces a compound).
    const adjusted = score + (ex.category === stalledEx.category ? 3 : 0);
    if (!best || adjusted > best.score) best = { ex, score: adjusted };
  }
  return best?.ex ?? null;
}

// --- Database-facing ------------------------------------------------------

function toCatalog(rows: Awaited<ReturnType<typeof prisma.exercise.findMany>>): CatalogExercise[] {
  return rows.map((e) => ({
    id: e.id,
    name: e.name,
    category: e.category,
    movementPattern: e.movementPattern,
    primaryMuscle: (e.primaryMuscle as Muscle | null) ?? null,
    secondaryMuscles: (e.secondaryMuscles as Muscle[]) ?? [],
    variationTag: e.variationTag,
  }));
}

export async function loadHistory(userId: string, since: Date): Promise<HistorySet[]> {
  const sets = await prisma.setEntry.findMany({
    where: { session: { userId, date: { gte: since } } },
    include: { exercise: true, session: true },
  });
  return sets.map((s) => ({
    exerciseId: s.exerciseId,
    variationTag: s.exercise.variationTag,
    primaryMuscle: (s.exercise.primaryMuscle as Muscle | null) ?? null,
    date: s.session.date,
    sessionId: s.sessionId,
    weightLb: s.weightLb,
    reps: s.reps,
  }));
}

interface SwapLogEntry {
  at: string;
  out: string;
  in: string;
  why: string;
}

export interface SessionExercisePick {
  exercise: CatalogExercise;
  note: string;
  isCoreFinisher: boolean;
}

export interface BlockInfo {
  startedAt: string;
  endsAt: string;
  week: number;
  totalWeeks: number;
  isNew: boolean;
  swaps: SwapLogEntry[];
}

/**
 * The exercises for today's session of this focus: the current block's
 * exercises (starting a new block if the last one has ended), with any
 * stalled exercise swapped out, plus the core finisher.
 */
export async function pickSessionExercises(
  userId: string,
  focus: Focus,
  now = new Date()
): Promise<{ picks: SessionExercisePick[]; block: BlockInfo }> {
  const catalog = toCatalog(await prisma.exercise.findMany());
  const byId = new Map(catalog.map((e) => [e.id, e]));
  const history = await loadHistory(userId, new Date(now.getTime() - LOOKBACK_DAYS * 86400_000));
  const tagSets = tallyTags(history);
  const stalled = new Set(catalog.filter((e) => isStalled(exposureScores(history, e.id))).map((e) => e.id));

  let block = await prisma.trainingBlock.findFirst({
    where: { userId, focus, closedAt: null },
    orderBy: { startedAt: "desc" },
  });

  let isNew = false;
  const notes = new Map<string, string>();

  if (!block || block.endsAt <= now || block.exerciseIds.every((id) => !byId.has(id))) {
    const previousBlockIds = new Set(block?.exerciseIds ?? []);
    if (block) {
      await prisma.trainingBlock.update({ where: { id: block.id }, data: { closedAt: now } });
    }
    const selected = chooseExercises(focus, catalog, { tagSets, stalled, previousBlockIds });
    for (const s of selected) notes.set(s.exercise.id, s.reason);
    block = await prisma.trainingBlock.create({
      data: {
        userId,
        focus,
        startedAt: now,
        endsAt: new Date(now.getTime() + BLOCK_WEEKS * 7 * 86400_000),
        exerciseIds: selected.map((s) => s.exercise.id),
      },
    });
    isNew = true;
  } else {
    // Mid-block: only swap an exercise out if progress on it has stalled.
    const ids = [...block.exerciseIds];
    const swapLog = (block.swapLog as unknown as SwapLogEntry[]) ?? [];
    let changed = false;
    for (let i = 0; i < ids.length; i++) {
      const ex = byId.get(ids[i]);
      if (!ex || !stalled.has(ex.id)) continue;
      const replacement = chooseReplacement(ex, focus, catalog, new Set(ids), { tagSets, stalled, previousBlockIds: new Set() });
      if (!replacement) continue;
      ids[i] = replacement.id;
      swapLog.push({ at: now.toISOString(), out: ex.name, in: replacement.name, why: `no progress on ${ex.name} over the last ${STALL_EXPOSURES} sessions` });
      notes.set(replacement.id, `Swapped in for ${ex.name}, which stopped progressing`);
      changed = true;
    }
    if (changed) {
      block = await prisma.trainingBlock.update({
        where: { id: block.id },
        data: { exerciseIds: ids, swapLog: swapLog as unknown as Prisma.InputJsonValue },
      });
    }
  }

  const picks: SessionExercisePick[] = block.exerciseIds
    .map((id) => byId.get(id))
    .filter((e): e is CatalogExercise => !!e)
    .map((exercise) => ({
      exercise,
      note: notes.get(exercise.id) ?? `Block exercise for ${MUSCLE_LABELS[exercise.primaryMuscle ?? "CORE"].toLowerCase()} — keep progressing the load`,
      isCoreFinisher: false,
    }));

  if (focus !== "CORE") {
    const lastSession = await prisma.workoutSession.findFirst({
      where: { userId },
      orderBy: { date: "desc" },
      include: { sets: { include: { exercise: true } } },
    });
    const lastCore = new Set((lastSession?.sets ?? []).filter((s) => s.exercise.movementPattern === "CORE").map((s) => s.exerciseId));
    for (const e of chooseCoreFinisher(catalog, tagSets, lastCore)) {
      picks.push({ exercise: e, note: "Core finisher — rotates every session", isCoreFinisher: true });
    }
  }

  const weekMs = 7 * 86400_000;
  const swapLog = (block.swapLog as unknown as SwapLogEntry[]) ?? [];
  return {
    picks,
    block: {
      startedAt: block.startedAt.toISOString(),
      endsAt: block.endsAt.toISOString(),
      week: Math.min(BLOCK_WEEKS, Math.floor((now.getTime() - block.startedAt.getTime()) / weekMs) + 1),
      totalWeeks: Math.round((block.endsAt.getTime() - block.startedAt.getTime()) / weekMs),
      isNew,
      swaps: swapLog,
    },
  };
}

/** Coverage of each muscle's variation tags over the last `days` days —
 * for the Progress → Balance view. */
export async function getCoverage(userId: string, days = 28, now = new Date()) {
  const catalog = toCatalog(await prisma.exercise.findMany());
  const history = await loadHistory(userId, new Date(now.getTime() - days * 86400_000));
  const tagSets = tallyTags(history);
  const tagsByMuscle = new Map<Muscle, Set<string>>();
  for (const e of catalog) {
    if (!e.primaryMuscle || !e.variationTag) continue;
    const set = tagsByMuscle.get(e.primaryMuscle) ?? new Set<string>();
    set.add(e.variationTag);
    tagsByMuscle.set(e.primaryMuscle, set);
  }
  const setsByMuscle = new Map<Muscle, number>();
  for (const s of history) {
    if (s.primaryMuscle) setsByMuscle.set(s.primaryMuscle, (setsByMuscle.get(s.primaryMuscle) ?? 0) + 1);
  }
  return [...tagsByMuscle.entries()].map(([muscle, tags]) => ({
    muscle,
    sets: setsByMuscle.get(muscle) ?? 0,
    weeklySets: Math.round(((setsByMuscle.get(muscle) ?? 0) / days) * 7 * 10) / 10,
    variations: [...tags].sort().map((tag) => ({ tag, label: tagLabel(tag), sets: tagSets.get(tag) ?? 0 })),
  }));
}
