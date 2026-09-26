// Defines what's actually loadable on the equipment on hand, so the API
// can reject a weight that doesn't exist on the gear. Mirrored in
// frontend/src/lib/equipment.ts — keep the two in sync if this changes.

export type Equipment = "DUMBBELL" | "BARBELL" | "EZ_BAR" | "BAND" | "BODYWEIGHT";

interface WeightedConfig {
  kind: "weighted";
  minLb: number;
  maxLb: number;
  stepLb: number;
  label: string;
}

interface BandConfig {
  kind: "band";
  levels: string[];
  label: string;
}

interface BodyweightConfig {
  kind: "bodyweight";
  // Bodyweight movements can optionally add load (e.g. a weighted pull-up
  // using a dumbbell between the feet), reusing the dumbbell increments.
  addedWeightMinLb: number;
  addedWeightMaxLb: number;
  addedWeightStepLb: number;
  label: string;
}

export type EquipmentConfig = WeightedConfig | BandConfig | BodyweightConfig;

export const EQUIPMENT_CONFIG: Record<Equipment, EquipmentConfig> = {
  DUMBBELL: { kind: "weighted", minLb: 5, maxLb: 45, stepLb: 5, label: "Adjustable Dumbbells" },
  BARBELL: { kind: "weighted", minLb: 20, maxLb: 80, stepLb: 5, label: "Barbell" },
  EZ_BAR: { kind: "weighted", minLb: 20, maxLb: 80, stepLb: 10, label: "EZ Bar" },
  BAND: { kind: "band", levels: ["Light", "Medium", "Heavy", "X-Heavy"], label: "Elastic Band" },
  BODYWEIGHT: {
    kind: "bodyweight",
    addedWeightMinLb: 0,
    addedWeightMaxLb: 45,
    addedWeightStepLb: 5,
    label: "Bodyweight (Chin-up Bar / Rings)",
  },
};

/**
 * Validates a logged set's weight/bandLevel against what the given
 * equipment can actually produce. Returns an error message, or null if valid.
 */
export function validateSetLoad(
  equipment: Equipment,
  weightLb: number,
  bandLevel: string | null | undefined
): string | null {
  const config = EQUIPMENT_CONFIG[equipment];

  if (config.kind === "band") {
    if (!bandLevel || !config.levels.includes(bandLevel)) {
      return `bandLevel must be one of: ${config.levels.join(", ")}`;
    }
    return null;
  }

  if (config.kind === "bodyweight") {
    if (weightLb === 0) return null; // plain bodyweight, no added load
    if (weightLb < config.addedWeightMinLb || weightLb > config.addedWeightMaxLb) {
      return `Added weight must be between ${config.addedWeightMinLb} and ${config.addedWeightMaxLb} lb`;
    }
    if ((weightLb - config.addedWeightMinLb) % config.addedWeightStepLb !== 0) {
      return `Added weight must be in ${config.addedWeightStepLb}lb increments`;
    }
    return null;
  }

  // weighted: DUMBBELL, BARBELL, EZ_BAR
  if (weightLb < config.minLb || weightLb > config.maxLb) {
    return `${config.label} weight must be between ${config.minLb} and ${config.maxLb} lb`;
  }
  if ((weightLb - config.minLb) % config.stepLb !== 0) {
    return `${config.label} weight must be in ${config.stepLb}lb increments`;
  }
  return null;
}
