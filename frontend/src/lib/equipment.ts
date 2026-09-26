// Mirrors backend/src/lib/equipmentConfig.ts — keep in sync if it changes.

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
  addedWeightMinLb: number;
  addedWeightMaxLb: number;
  addedWeightStepLb: number;
  label: string;
}

export type EquipmentConfig = WeightedConfig | BandConfig | BodyweightConfig;

export const EQUIPMENT_CONFIG: Record<Equipment, EquipmentConfig> = {
  DUMBBELL: { kind: "weighted", minLb: 5, maxLb: 45, stepLb: 5, label: "Dumbbells" },
  BARBELL: { kind: "weighted", minLb: 20, maxLb: 80, stepLb: 5, label: "Barbell" },
  EZ_BAR: { kind: "weighted", minLb: 20, maxLb: 80, stepLb: 10, label: "EZ Bar" },
  BAND: { kind: "band", levels: ["Light", "Medium", "Heavy", "X-Heavy"], label: "Band" },
  BODYWEIGHT: {
    kind: "bodyweight",
    addedWeightMinLb: 0,
    addedWeightMaxLb: 45,
    addedWeightStepLb: 5,
    label: "Bodyweight",
  },
};

/** All loadable weight values for a weighted equipment type, e.g. [20,30,...,80]. */
export function weightOptions(config: WeightedConfig | BodyweightConfig): number[] {
  const min = config.kind === "weighted" ? config.minLb : config.addedWeightMinLb;
  const max = config.kind === "weighted" ? config.maxLb : config.addedWeightMaxLb;
  const step = config.kind === "weighted" ? config.stepLb : config.addedWeightStepLb;
  const values: number[] = [];
  for (let v = min; v <= max; v += step) values.push(v);
  return values;
}
