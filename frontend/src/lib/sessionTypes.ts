import { SessionType } from "./api.js";

/** A top-level category with no sub-types of its own (Strength, Swim). */
interface LeafCategory {
  label: string;
  type: SessionType;
  children?: undefined;
}

/** A top-level category that groups several specific session types
 * (Golf, Run, Walk, Cycling, Cycling - Turbo). */
interface GroupedCategory {
  label: string;
  type?: undefined;
  children: { type: SessionType; label: string }[];
}

export type SessionTypeCategory = LeafCategory | GroupedCategory;

// The full taxonomy — matches what's shown in Settings' checkbox tree and
// used to group/filter the Calendar's type picker and day view. REST isn't
// here: it's a scheduling option but not a "workout type" a person would
// want to hide.
export const SESSION_TYPE_TREE: SessionTypeCategory[] = [
  { label: "Strength", type: "STRENGTH" },
  {
    label: "Golf",
    children: [
      { type: "GOLF_RANGE", label: "Range" },
      { type: "GOLF_ROUND", label: "Round" },
      { type: "GOLF_SHORT_GAME", label: "Short Game" },
      { type: "GOLF_PUTTING", label: "Putting" },
      { type: "GOLF_SIMULATOR", label: "Simulator" },
    ],
  },
  {
    label: "Run",
    children: [
      { type: "RUN_RECOVERY", label: "Recovery" },
      { type: "RUN_TEMPO", label: "Tempo" },
      { type: "RUN_FARTLEK", label: "Fartlek" },
      { type: "RUN_INTERVALS", label: "Intervals" },
      { type: "RUN_LONG_RUN", label: "Long Run" },
    ],
  },
  {
    label: "Walk",
    children: [
      { type: "WALK_WALK", label: "Walk" },
      { type: "WALK_HIKE", label: "Hike" },
    ],
  },
  {
    label: "Cycling",
    children: [
      { type: "CYCLING_EASY", label: "Easy" },
      { type: "CYCLING_LONG", label: "Long" },
      { type: "CYCLING_HILLS", label: "Hills" },
    ],
  },
  {
    label: "Cycling - Turbo",
    children: [
      { type: "CYCLING_TURBO_EASY", label: "Easy" },
      { type: "CYCLING_TURBO_LONG", label: "Long" },
      { type: "CYCLING_TURBO_HILLS", label: "Hills" },
    ],
  },
  { label: "Swim", type: "SWIM" },
];

/** Every real (non-REST) session type, flattened — for defaults and validation. */
export const ALL_SESSION_TYPES: SessionType[] = SESSION_TYPE_TREE.flatMap((cat) =>
  cat.children ? cat.children.map((c) => c.type) : [cat.type]
);

/** Full label for a type, e.g. "Run - Tempo" or "Strength" or "Rest Day" —
 * combines the parent category with the sub-option where there is one. */
export function fullLabelFor(type: SessionType): string {
  if (type === "REST") return "Rest Day";
  for (const cat of SESSION_TYPE_TREE) {
    if (cat.type === type) return cat.label;
    if (cat.children) {
      const child = cat.children.find((c) => c.type === type);
      if (child) return `${cat.label} - ${child.label}`;
    }
  }
  return type;
}

/** Looks up a category by its top-level label (used as the value for the
 * category <select>, since grouped categories don't have a SessionType of
 * their own — only their children do). "Rest Day" isn't in the tree, so
 * it returns undefined for that; callers handle REST as a special case. */
export function findCategoryByLabel(label: string): SessionTypeCategory | undefined {
  return SESSION_TYPE_TREE.find((c) => c.label === label);
}

/** Which top-level category a given type belongs to, as a label — the
 * inverse of findCategoryByLabel. Used to initialize the two-step
 * selector from an existing session's type when editing. */
export function categoryLabelForType(type: SessionType): string {
  if (type === "REST") return "Rest Day";
  for (const cat of SESSION_TYPE_TREE) {
    if (cat.type === type) return cat.label;
    if (cat.children?.some((c) => c.type === type)) return cat.label;
  }
  return type;
}

/** True if at least one type under this category (itself, if a leaf, or
 * any of its children) is in the visible set. */
export function isCategoryVisible(cat: SessionTypeCategory, visibleTypes: SessionType[]): boolean {
  if (cat.children) return cat.children.some((c) => visibleTypes.includes(c.type));
  return visibleTypes.includes(cat.type);
}

/** The category labels to offer in the top-level selector, in taxonomy
 * order, filtered to only categories with at least one visible type, with
 * "Rest Day" always appended at the end (REST is exempt from visibility). */
export function visibleCategoryLabels(visibleTypes: SessionType[]): string[] {
  return [...SESSION_TYPE_TREE.filter((c) => isCategoryVisible(c, visibleTypes)).map((c) => c.label), "Rest Day"];
}
