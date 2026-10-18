import type { GolfClubType, SessionType } from "@prisma/client";
import { prisma } from "../../lib/prisma.js";
import { DAY_MS, dateToDayKey } from "../../lib/dates.js";

// What the golf coach knows about the person's game: handicap, whether they can
// shape shots, the clubs in the bag, and which clubs recent practice has used.
// Both golf planners build their prompts from this and then enforce its rules
// on whatever the model returns.

export type PracticeType = "GOLF_RANGE" | "GOLF_SHORT_GAME" | "GOLF_PUTTING" | "GOLF_SIMULATOR";

/** Which club types each kind of practice may use. A sand wedge isn't hit at
 * the range, and putting practice is the putter only. */
export const ALLOWED_CLUBS: Record<PracticeType, GolfClubType[]> = {
  GOLF_RANGE: ["DRIVER", "WOOD", "HYBRID", "IRON", "WEDGE"],
  GOLF_SHORT_GAME: ["IRON", "WEDGE", "SAND_WEDGE"],
  GOLF_PUTTING: ["PUTTER"],
  // Indoors, hitting off a mat into a screen: full swings, so like the range.
  GOLF_SIMULATOR: ["DRIVER", "WOOD", "HYBRID", "IRON", "WEDGE"],
};

/**
 * A club's loft in degrees: from the degrees in its name ("Gap wedge (50°)",
 * "56 wedge"), else the typical loft for its number ("7 iron" ≈ 34°, "3 wood" ≈ 15°,
 * "4 hybrid" ≈ 22°) or its name ("pitching", "gap", "sand", "lob"). Lower loft =
 * longer club, so sorting by this gives the bag in order from driver to wedges,
 * with hybrids and woods falling between where their loft puts them. The putter
 * goes last. Good enough to order a normal bag.
 */
export function estimatedLoft(c: BagClub): number {
  if (c.type === "PUTTER") return 999;
  const name = c.name;
  const deg = name.match(/(\d{1,2}(?:\.\d)?)\s*(?:°|deg)/i)?.[1];
  if (deg) return Number(deg);
  const n = Number(name.match(/\d+/)?.[0]);
  const hasN = Number.isFinite(n);

  switch (c.type) {
    case "DRIVER":
      return 10.5;
    case "WOOD": {
      const woods: Record<number, number> = { 1: 10.5, 2: 13, 3: 15, 4: 16.5, 5: 18, 7: 21, 9: 24 };
      return hasN ? woods[n] ?? 15 + (n - 3) * 1.5 : 15;
    }
    case "HYBRID":
      return hasN ? 17 + (n - 2) * 2.5 : 22;
    case "IRON": {
      const irons: Record<number, number> = { 1: 16, 2: 18, 3: 21, 4: 24, 5: 27, 6: 30, 7: 34, 8: 38, 9: 42 };
      return hasN ? irons[n] ?? 21 + (n - 3) * 3.3 : 30;
    }
    default: {
      // Wedges. A bare number of 40 or more is degrees ("52 wedge").
      if (hasN && n >= 40) return n;
      if (/pitch|\bpw\b/i.test(name)) return 46;
      if (/gap|approach|\baw\b|\bgw\b|\buw\b/i.test(name)) return 50;
      if (/sand|\bsw\b/i.test(name)) return 56;
      if (/lob|\blw\b/i.test(name)) return 60;
      return c.type === "SAND_WEDGE" ? 56 : 52;
    }
  }
}

/** Kept for the simulator's longest-club cutoff: smaller = longer club. */
export const clubRank = estimatedLoft;

export function sortByLength<T extends BagClub>(clubs: T[]): T[] {
  return [...clubs].sort((a, b) => clubRank(a) - clubRank(b) || a.name.localeCompare(b.name));
}

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
  /** Longest club usable in the indoor simulator, null = no restriction. */
  simulatorLongestClub: string | null;
  /** Practice sessions a week the weekly proposal aims for. */
  practiceSessionsPerWeek: number;
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
      where: { userId, completed: true, date: { gte: since }, type: { in: ["GOLF_RANGE", "GOLF_SHORT_GAME", "GOLF_PUTTING", "GOLF_SIMULATOR"] } },
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
  const coverage = sortByLength(clubs).map((c) => {
    const e = byClub.get(c.name);
    return { name: c.name, sessions: e?.sessions.size ?? 0, lastPracticed: e?.last ? dateToDayKey(e.last) : null };
  });
  return { handicap: profile?.handicap ?? null, canShapeShots: profile?.canShapeShots ?? null, simulatorLongestClub: profile?.simulatorLongestClub ?? null, practiceSessionsPerWeek: profile?.practiceSessionsPerWeek ?? 2, clubs: sortByLength(clubs), coverage };
}

/** The clubs that fit the indoor space: nothing longer than the chosen longest club. */
export function simulatorClubs(bag: GolfBag): BagClub[] {
  const longest = bag.clubs.find((c) => c.name === bag.simulatorLongestClub);
  const cutoff = longest ? clubRank(longest) : -Infinity;
  return bag.clubs.filter((c) => ALLOWED_CLUBS.GOLF_SIMULATOR.includes(c.type) && clubRank(c) >= cutoff);
}

export function clubsFor(type: PracticeType, bag: GolfBag): BagClub[] {
  if (type === "GOLF_SIMULATOR") return simulatorClubs(bag);
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
    if (types.includes("GOLF_SIMULATOR")) {
      const limit = bag.clubs.find((c) => c.name === bag.simulatorLongestClub);
      if (limit) {
        const excluded = bag.clubs.filter((c) => ALLOWED_CLUBS.GOLF_SIMULATOR.includes(c.type) && !simulatorClubs(bag).includes(c)).map((c) => c.name);
        lines.push(`- SIMULATOR SPACE LIMIT: the longest club they can swing indoors is the ${limit.name}. Never use a longer club in a simulator session${excluded.length ? ` (not allowed: ${excluded.join(", ")})` : ""}.`);
      } else {
        lines.push("- Simulator space: no restriction on club length.");
      }
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
      "- Indoor golf simulator sessions (GOLF_SIMULATOR) use only the clubs listed for them, full swings off a mat into a screen. They never include bunker shots, and putting only if the simulator has a putting surface, which is not assumed.",
      "- Short game covers chipping and pitching from grass and from the BUNKER. Bunker drills use the sand wedge (or the nearest wedge if they have none), and say so in the drill."
    );
  }
  return lines.join("\n");
}

/** What makes a good indoor simulator session, for the prompts. */
export const SIMULATOR_GUIDE = `INDOOR GOLF SIMULATOR SESSIONS
Hitting off a mat into a screen, with launch-monitor numbers (carry distance, ball speed, spin, dispersion, face and path where shown). Use that data: club gapping and carry-distance ladders, dispersion games (e.g. 10 balls, count how many finish inside a fairway-width or a target circle), start-line gates, a wedge distance matrix, closest-to-pin target games and the simulator's own skills challenges. A short virtual 9 holes is fine when time allows, with the club for each shot named. Do not include anything that needs real turf or outdoor ball flight (divot depth, bunker shots, wind), and do not assume a putting surface.`;

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
  if (type === "GOLF_SIMULATOR" && BUNKER_RE.test(text)) return "drop";
  // Bunker work needs a sand wedge, or failing that another wedge.
  if (type === "GOLF_SHORT_GAME" && BUNKER_RE.test(text) && named.type !== "SAND_WEDGE" && named.type !== "WEDGE") return "drop";
  return { club: named.name };
}

export type { SessionType };
