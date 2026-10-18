import type { GolfClubType, SessionType } from "@prisma/client";
import { prisma } from "../../lib/prisma.js";
import { DAY_MS, dateToDayKey } from "../../lib/dates.js";

// What the golf coach knows about the person's game: handicap, whether they can
// shape shots, the clubs in the bag, and which clubs recent practice has used.
// Both golf planners build their prompts from this and then enforce its rules
// on whatever the model returns.

export type PracticeType = "GOLF_RANGE" | "GOLF_SHORT_GAME" | "GOLF_PUTTING";

/** Which club types each kind of practice may use. A sand wedge isn't hit at
 * the range, and putting practice is the putter only. */
export const ALLOWED_CLUBS: Record<PracticeType, GolfClubType[]> = {
  GOLF_RANGE: ["DRIVER", "WOOD", "HYBRID", "IRON", "WEDGE"],
  GOLF_SHORT_GAME: ["IRON", "WEDGE", "SAND_WEDGE"],
  GOLF_PUTTING: ["PUTTER"],
};

export const STANDARD_BAG: { name: string; type: GolfClubType }[] = [
  { name: "Driver", type: "DRIVER" },
  { name: "3 wood", type: "WOOD" },
  { name: "5 wood", type: "WOOD" },
  { name: "4 hybrid", type: "HYBRID" },
  { name: "5 iron", type: "IRON" },
  { name: "6 iron", type: "IRON" },
  { name: "7 iron", type: "IRON" },
  { name: "8 iron", type: "IRON" },
  { name: "9 iron", type: "IRON" },
  { name: "Pitching wedge", type: "WEDGE" },
  { name: "Gap wedge (50°)", type: "WEDGE" },
  { name: "Sand wedge (56°)", type: "SAND_WEDGE" },
  { name: "Lob wedge (60°)", type: "WEDGE" },
  { name: "Putter", type: "PUTTER" },
];

export interface BagClub { name: string; type: GolfClubType }
export interface ClubCoverage { name: string; sessions: number; lastPracticed: string | null }
export interface GolfBag {
  handicap: number | null;
  canShapeShots: boolean | null;
  clubs: BagClub[];
  coverage: ClubCoverage[];
}

const COVERAGE_DAYS = 90;

export async function loadGolfBag(userId: string): Promise<GolfBag> {
  const since = new Date(Date.now() - COVERAGE_DAYS * DAY_MS);
  const [profile, clubs, sessions] = await Promise.all([
    prisma.golfProfile.findUnique({ where: { userId } }),
    prisma.golfClub.findMany({ where: { userId }, orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }], select: { name: true, type: true } }),
    prisma.plannedSession.findMany({
      where: { userId, completed: true, date: { gte: since }, type: { in: ["GOLF_RANGE", "GOLF_SHORT_GAME", "GOLF_PUTTING"] } },
      select: { date: true, drills: true },
    }),
  ]);

  const byClub = new Map<string, { sessions: Set<string>; last: Date | null }>();
  for (const s of sessions) {
    for (const d of Array.isArray(s.drills) ? (s.drills as any[]) : []) {
      if (!d || !d.done || typeof d.club !== "string") continue;
      const e = byClub.get(d.club) ?? { sessions: new Set<string>(), last: null };
      e.sessions.add(dateToDayKey(s.date));
      if (!e.last || s.date > e.last) e.last = s.date;
      byClub.set(d.club, e);
    }
  }
  const coverage = clubs.map((c) => {
    const e = byClub.get(c.name);
    return { name: c.name, sessions: e?.sessions.size ?? 0, lastPracticed: e?.last ? dateToDayKey(e.last) : null };
  });
  return { handicap: profile?.handicap ?? null, canShapeShots: profile?.canShapeShots ?? null, clubs, coverage };
}

export function clubsFor(type: PracticeType, bag: GolfBag): BagClub[] {
  return bag.clubs.filter((c) => ALLOWED_CLUBS[type].includes(c.type));
}

function levelGuidance(h: number | null): string {
  if (h === null) return "Handicap unknown: assume a mid-handicap club golfer and say nothing about level.";
  if (h <= 5) return `Handicap ${h}: a low-handicap player. Practice should be precise: distance control, dispersion to small targets, pressure games with scoring, and wedge distance gaps. Skip basic fundamentals unless the notes show a fault.`;
  if (h <= 12) return `Handicap ${h}: a solid single-figure to low-teens player. Mix tempo/contact work with target games, distance control and up-and-down practice.`;
  if (h <= 20) return `Handicap ${h}: a mid-handicap player. Priorities are solid contact, a repeatable start line and tempo, keeping the ball in play off the tee, avoiding big misses, getting chips on the green and eliminating three-putts. Keep drills simple and repeatable.`;
  return `Handicap ${h}: a higher-handicap player still developing. Prioritise fundamentals: grip, setup, alignment, ball position, tempo and clean contact; simple chips and pitches that reach the green; lag putting to avoid three-putts. Short, simple drills with generous targets. Nothing advanced.`;
}

/** The part of a golf prompt that describes the player and the rules the answer must follow. */
export function bagPromptBlock(bag: GolfBag, types: PracticeType[]): string {
  const lines: string[] = ["THE PLAYER", levelGuidance(bag.handicap)];
  lines.push(
    bag.canShapeShots === true
      ? "Shot shaping: yes, they can work the ball both ways, so draw/fade control drills are fine when the notes call for them."
      : "Shot shaping: NO (or not known). Offer no shot-shaping drills of any kind: no draws, fades, working the ball, curving it around objects or intentional hooks and slices. Build consistency instead: more repetitions of the basic shot, start-line, strike and tempo drills, aimed at what their comments and round notes complain about."
  );

  if (bag.clubs.length === 0) {
    lines.push("Their bag has not been entered. Name the club a drill suits in the drill (e.g. '7-iron') and set club to null.");
  } else {
    const usage = new Map(bag.coverage.map((c) => [c.name, c]));
    lines.push("", "THE BAG, and which clubs each kind of practice may use");
    for (const t of types) {
      const list = clubsFor(t, bag);
      lines.push(`- ${t}: ${list.length ? list.map((c) => c.name).join(", ") : "(none in their bag)"}`);
    }
    lines.push(
      "",
      `CLUB COVERAGE (drills ticked done in the last ${COVERAGE_DAYS} days, with the date last practised)`,
      ...bag.clubs.map((c) => {
        const u = usage.get(c.name);
        return `- ${c.name}: ${u && u.sessions ? `${u.sessions} session${u.sessions === 1 ? "" : "s"}, last ${u.lastPracticed}` : "never practised"}`;
      }),
      "Over time practice should cover every club in the bag. Give clubs that are never or least recently practised priority, unless the round notes point at something else, and do not repeat the club from the last session in the same area.",
      "",
      "CLUB RULES (strict)",
      "- Every drill has a club: the exact name from the list above, matching the session type's allowed clubs. One club per drill; use separate drills for separate clubs.",
      "- A sand wedge is never used at the range. Putting practice uses only the putter, with no other club. Range sessions use driver, woods, hybrids, irons and the other wedges.",
      "- Short game covers chipping and pitching from grass and from the BUNKER. Bunker drills use the sand wedge (or the nearest wedge if they have none), and say so in the drill."
    );
  }
  return lines.join("\n");
}

// Shot-shaping vocabulary. A drill that fixes a slice or hook is fine; one that
// asks for a deliberate draw/fade is not, for a player who can't shape the ball.
const SHAPING_RE = /\b(shap(e|es|ed|ing)|draw(s)?|fade(s)?|work(ing)? the ball|curve(d|s)? (the )?(ball|shot)|bend(ing)? the ball|intentional(ly)? (hook|slice|draw|fade)|punch[- ]?(draw|fade))\b/i;
const BUNKER_RE = /\b(bunker|sand trap|greenside sand|sand shot)\b/i;

export interface RawDrill { name?: unknown; detail?: unknown; minutes?: unknown; club?: unknown }

/**
 * Applies the bag rules to a drill from the model. Returns the club to record
 * (null when the bag isn't entered) or "drop" if the drill breaks a rule.
 */
export function checkDrill(d: RawDrill, type: PracticeType, bag: GolfBag): { club: string | null } | "drop" {
  const text = `${d.name ?? ""} ${d.detail ?? ""}`;
  // (Putting is exempt: "draw a line on the ball" is an alignment aid, not shaping.)
  if (type !== "GOLF_PUTTING" && bag.canShapeShots !== true && SHAPING_RE.test(text)) return "drop";

  if (bag.clubs.length === 0) return { club: null };

  const allowed = clubsFor(type, bag);
  const named = typeof d.club === "string" ? bag.clubs.find((c) => c.name.toLowerCase() === d.club!.toString().toLowerCase()) : undefined;

  if (type === "GOLF_PUTTING") {
    const putter = allowed[0] ?? bag.clubs.find((c) => c.type === "PUTTER");
    return putter ? { club: putter.name } : { club: null };
  }
  if (!named || !allowed.some((c) => c.name === named.name)) return "drop";
  // Bunker work needs a sand wedge, or failing that another wedge.
  if (type === "GOLF_SHORT_GAME" && BUNKER_RE.test(text) && named.type !== "SAND_WEDGE" && named.type !== "WEDGE") return "drop";
  return { club: named.name };
}

export type { SessionType };
