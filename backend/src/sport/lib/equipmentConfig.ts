// What equipment a person has, and which weights it can actually produce.
// This used to be one hardcoded set of gear for everybody; it's now
// per gym (GymEquipment rows on a user's Home / Regular / Visiting gym
// profile, edited in Settings). The constants below are only the DEFAULTS
// applied where a gym hasn't configured a given type yet.
//
// Kept pure (no DB access) on purpose: services/gyms.ts loads the
// rows, this file turns rows into something usable. The frontend only ever
// consumes the resolved output (GET /gyms), never reimplements the
// resolution — except for the live preview in Settings, which mirrors
// buildWeights in frontend/src/lib/equipment.ts.

export type Equipment = "DUMBBELL" | "BARBELL" | "EZ_BAR" | "BAND" | "BODYWEIGHT";
export type EquipmentKind = "weighted" | "band" | "bodyweight";

export const ALL_EQUIPMENT: Equipment[] = ["DUMBBELL", "BARBELL", "EZ_BAR", "BAND", "BODYWEIGHT"];
export const BAND_LEVELS = ["Light", "Medium", "Heavy", "X-Heavy"];

// Guard against a typo like step 0.001 producing millions of options.
export const MAX_WEIGHT_OPTIONS = 500;
export const MAX_CUSTOM_WEIGHTS = 100;

export const EQUIPMENT_KIND: Record<Equipment, EquipmentKind> = {
  DUMBBELL: "weighted",
  BARBELL: "weighted",
  EZ_BAR: "weighted",
  BAND: "band",
  BODYWEIGHT: "bodyweight",
};

export const EQUIPMENT_LABEL: Record<Equipment, string> = {
  DUMBBELL: "Dumbbells",
  BARBELL: "Barbell",
  EZ_BAR: "EZ Bar",
  BAND: "Resistance Bands",
  BODYWEIGHT: "Bodyweight (chin-up bar / rings)",
};

/** A GymEquipment row, as plain data. */
export interface EquipmentSettingRow {
  equipment: Equipment;
  enabled: boolean;
  minLb: number | null;
  maxLb: number | null;
  stepLb: number | null;
  customWeightsLb: number[];
  bandLevels: string[];
}

export type GymKind = "HOME" | "PUBLIC_GYM" | "VISITING";
export type Accessory = "BENCH" | "PULL_UP_BAR" | "RINGS";
export const ALL_GYM_KINDS: GymKind[] = ["HOME", "PUBLIC_GYM", "VISITING"];
export const ALL_ACCESSORIES: Accessory[] = ["BENCH", "PULL_UP_BAR", "RINGS"];
export const ACCESSORY_LABEL: Record<Accessory, string> = {
  BENCH: "Bench",
  PULL_UP_BAR: "Pull-up / chin-up bar",
  RINGS: "Gym rings",
};
export const GYM_KIND_LABEL: Record<GymKind, string> = {
  HOME: "Home gym",
  PUBLIC_GYM: "Regular gym",
  VISITING: "Visiting gym",
};

// PRESETS are the starting points a gym can be set to. A gym uses its preset
// for everything the person hasn't changed: an equipment type with no saved
// row simply follows the preset, and "Reset to defaults" in Settings deletes
// the saved rows and re-applies the preset (equipment and accessories).
// Every value is an editable guess, not a fact about any real gym.
interface PresetEquipment {
  enabled: boolean;
  minLb?: number;
  maxLb?: number;
  stepLb?: number;
  bandLevels?: string[];
}
export interface GymPreset {
  id: string;
  kind: GymKind;
  label: string;
  description: string;
  accessories: Accessory[];
  equipment: Record<Equipment, PresetEquipment>;
}

export const GYM_PRESETS: GymPreset[] = [
  {
    id: "home_standard",
    kind: "HOME",
    label: "Standard home gym",
    description: "Adjustable dumbbells to 45lb, barbell and EZ bar to 80lb, bands, bench, chin-up bar and rings.",
    accessories: ["BENCH", "PULL_UP_BAR", "RINGS"],
    equipment: {
      DUMBBELL: { enabled: true, minLb: 5, maxLb: 45, stepLb: 5 },
      BARBELL: { enabled: true, minLb: 20, maxLb: 80, stepLb: 5 },
      EZ_BAR: { enabled: true, minLb: 20, maxLb: 80, stepLb: 10 },
      BAND: { enabled: true, bandLevels: [...BAND_LEVELS] },
      BODYWEIGHT: { enabled: true, minLb: 0, maxLb: 45, stepLb: 5 },
    },
  },
  {
    id: "commercial_gym",
    kind: "PUBLIC_GYM",
    label: "Commercial gym",
    description: "Dumbbells to 100lb, barbell to 315lb, EZ bar, bands, bench and pull-up bar.",
    accessories: ["BENCH", "PULL_UP_BAR"],
    equipment: {
      DUMBBELL: { enabled: true, minLb: 5, maxLb: 100, stepLb: 5 },
      BARBELL: { enabled: true, minLb: 45, maxLb: 315, stepLb: 5 },
      EZ_BAR: { enabled: true, minLb: 20, maxLb: 100, stepLb: 5 },
      BAND: { enabled: true, bandLevels: [...BAND_LEVELS] },
      BODYWEIGHT: { enabled: true, minLb: 0, maxLb: 90, stepLb: 5 },
    },
  },
  {
    id: "hotel_basic",
    kind: "VISITING",
    label: "Basic hotel gym",
    description: "Light dumbbells to 50lb, a bench and bodyweight. No barbell or bands.",
    accessories: ["BENCH"],
    equipment: {
      DUMBBELL: { enabled: true, minLb: 5, maxLb: 50, stepLb: 5 },
      BARBELL: { enabled: false, minLb: 45, maxLb: 135, stepLb: 5 },
      EZ_BAR: { enabled: false, minLb: 20, maxLb: 60, stepLb: 10 },
      BAND: { enabled: false, bandLevels: [...BAND_LEVELS] },
      BODYWEIGHT: { enabled: true, minLb: 0, maxLb: 0, stepLb: 5 },
    },
  },
  {
    id: "hotel_good",
    kind: "VISITING",
    label: "Well-equipped hotel gym",
    description: "Dumbbells to 75lb, a barbell to 135lb, bench and pull-up bar.",
    accessories: ["BENCH", "PULL_UP_BAR"],
    equipment: {
      DUMBBELL: { enabled: true, minLb: 5, maxLb: 75, stepLb: 5 },
      BARBELL: { enabled: true, minLb: 45, maxLb: 135, stepLb: 5 },
      EZ_BAR: { enabled: false, minLb: 20, maxLb: 60, stepLb: 10 },
      BAND: { enabled: false, bandLevels: [...BAND_LEVELS] },
      BODYWEIGHT: { enabled: true, minLb: 0, maxLb: 45, stepLb: 5 },
    },
  },
  {
    id: "travel_no_equipment",
    kind: "VISITING",
    label: "No equipment (bodyweight + bands)",
    description: "Bodyweight, plus light and medium bands you've packed. No weights, bench or bar.",
    accessories: [],
    equipment: {
      DUMBBELL: { enabled: false, minLb: 5, maxLb: 50, stepLb: 5 },
      BARBELL: { enabled: false, minLb: 45, maxLb: 135, stepLb: 5 },
      EZ_BAR: { enabled: false, minLb: 20, maxLb: 60, stepLb: 10 },
      BAND: { enabled: true, bandLevels: ["Light", "Medium"] },
      BODYWEIGHT: { enabled: true, minLb: 0, maxLb: 0, stepLb: 5 },
    },
  },
];

/** The first preset of a kind is that kind's default. */
export const presetsFor = (kind: GymKind): GymPreset[] => GYM_PRESETS.filter((p) => p.kind === kind);
export const defaultPreset = (kind: GymKind): GymPreset => presetsFor(kind)[0];
/** The named preset if it belongs to this kind, otherwise the kind's default. */
export const resolvePreset = (kind: GymKind, presetId?: string | null): GymPreset =>
  presetsFor(kind).find((p) => p.id === presetId) ?? defaultPreset(kind);

// For BODYWEIGHT, minLb is always 0 (plain bodyweight) and maxLb is the most
// ADDED weight the person will use; maxLb 0 means "no added weight".
function presetRow(preset: GymPreset, equipment: Equipment): EquipmentSettingRow {
  const d = preset.equipment[equipment];
  return {
    equipment,
    enabled: d.enabled,
    minLb: d.minLb ?? null,
    maxLb: d.maxLb ?? null,
    stepLb: d.stepLb ?? null,
    customWeightsLb: [],
    bandLevels: equipment === "BAND" ? [...(d.bandLevels ?? BAND_LEVELS)] : [],
  };
}

/** The fully-resolved view of one equipment type for one person. */
export interface ResolvedEquipment {
  equipment: Equipment;
  kind: EquipmentKind;
  label: string;
  enabled: boolean;
  // Effective range (defaults filled in) — what the Settings form edits.
  // Meaningless (0) for bands.
  minLb: number;
  maxLb: number;
  stepLb: number;
  customWeightsLb: number[];
  // Band resistance levels the person owns, in canonical order. [] unless
  // kind is "band".
  bandLevels: string[];
  // Every loadable weight, ascending. For bodyweight this is the ADDED
  // weight and always starts with 0. [] for bands.
  weightsLb: number[];
}

const round = (n: number) => Math.round(n * 1000) / 1000;

/** min, min+step, ... up to max (inclusive), capped at MAX_WEIGHT_OPTIONS. */
export function rangeValues(minLb: number, maxLb: number, stepLb: number): number[] {
  if (!(stepLb > 0) || maxLb < minLb) return [];
  const values: number[] = [];
  for (let i = 0; i < MAX_WEIGHT_OPTIONS; i++) {
    const v = round(minLb + i * stepLb);
    if (v > maxLb + 1e-9) break;
    values.push(v);
  }
  return values;
}

function buildWeights(kind: EquipmentKind, minLb: number, maxLb: number, stepLb: number, custom: number[]): number[] {
  if (kind === "band") return [];
  let weights = custom.length > 0 ? [...new Set(custom.map(round))].sort((a, b) => a - b) : rangeValues(minLb, maxLb, stepLb);
  if (kind === "bodyweight" && !weights.includes(0)) weights = [0, ...weights];
  return weights;
}

function resolveOne(preset: GymPreset, equipment: Equipment, row: EquipmentSettingRow | undefined): ResolvedEquipment {
  const def = presetRow(preset, equipment);
  const kind = EQUIPMENT_KIND[equipment];
  const enabled = row ? row.enabled : def.enabled;
  const minLb = kind === "band" ? 0 : kind === "bodyweight" ? 0 : row?.minLb ?? def.minLb ?? 0;
  const maxLb = kind === "band" ? 0 : row?.maxLb ?? def.maxLb ?? 0;
  const stepLb = kind === "band" ? 0 : row?.stepLb ?? def.stepLb ?? 0;
  const customWeightsLb = kind === "band" ? [] : [...(row?.customWeightsLb ?? [])].sort((a, b) => a - b);

  // Canonical order, unknown values dropped; an enabled band set with no
  // levels picked falls back to all of them rather than being unusable.
  const chosen = row?.bandLevels ?? def.bandLevels;
  const bandLevels =
    kind === "band" ? (chosen.length > 0 ? BAND_LEVELS.filter((l) => chosen.includes(l)) : [...BAND_LEVELS]) : [];

  return {
    equipment,
    kind,
    label: EQUIPMENT_LABEL[equipment],
    enabled,
    minLb,
    maxLb,
    stepLb,
    customWeightsLb,
    bandLevels,
    weightsLb: buildWeights(kind, minLb, maxLb, stepLb, customWeightsLb),
  };
}

/** Merges a gym's saved rows over its preset (or the kind's default), for every equipment type. */
export function resolveEquipment(rows: EquipmentSettingRow[], gymKind: GymKind = "HOME", presetId?: string | null): Record<Equipment, ResolvedEquipment> {
  const byType = new Map(rows.map((r) => [r.equipment, r]));
  return Object.fromEntries(ALL_EQUIPMENT.map((e) => [e, resolveOne(resolvePreset(gymKind, presetId), e, byType.get(e))])) as Record<Equipment, ResolvedEquipment>;
}

/** Human-readable summary of a weight list, used in the AI prompt and errors. */
export function describeWeights(weights: number[]): string {
  if (weights.length === 0) return "none configured";
  if (weights.length >= 3) {
    const step = round(weights[1] - weights[0]);
    const uniform = weights.every((w, i) => i === 0 || round(w - weights[i - 1]) === step);
    if (uniform) return `${weights[0]}lb to ${weights[weights.length - 1]}lb in ${step}lb increments`;
  }
  return `${weights.join(", ")}lb`;
}

/**
 * Validates a logged set's weight/bandLevel against what this person's
 * equipment can produce. Returns an error message, or null if valid.
 */
export function validateSetLoad(
  config: ResolvedEquipment,
  weightLb: number,
  bandLevel: string | null | undefined
): string | null {
  if (config.kind === "band") {
    if (!bandLevel || !config.bandLevels.includes(bandLevel)) {
      return `bandLevel must be one of your bands: ${config.bandLevels.join(", ")}`;
    }
    return null;
  }

  if (config.weightsLb.some((w) => Math.abs(w - weightLb) < 1e-6)) return null;

  return config.kind === "bodyweight"
    ? `Added weight must be one of: ${describeWeights(config.weightsLb)} (change this under Settings > Gyms)`
    : `${config.label} weight must be one of: ${describeWeights(config.weightsLb)} (change this under Settings > Gyms)`;
}

/** Snaps a suggested weight to the nearest loadable value (ties go lighter). */
export function clampToLoadable(config: ResolvedEquipment, weightLb: number): number {
  if (config.kind === "band") return 0;
  if (config.kind === "bodyweight" && weightLb <= 0) return 0;
  if (config.weightsLb.length === 0) return weightLb;
  return config.weightsLb.reduce((best, w) => (Math.abs(w - weightLb) < Math.abs(best - weightLb) ? w : best));
}
