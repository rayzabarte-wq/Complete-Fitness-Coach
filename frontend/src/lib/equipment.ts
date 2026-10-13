// Equipment is per-user now: what each person owns, and the weights it can
// produce, comes from GET /equipment (resolved server-side — see
// backend/src/sport/lib/equipmentConfig.ts). The only logic mirrored here is
// buildWeights, used for the live preview while editing in Settings.

export type Equipment = "DUMBBELL" | "BARBELL" | "EZ_BAR" | "BAND" | "BODYWEIGHT";
export type EquipmentKind = "weighted" | "band" | "bodyweight";

export interface EquipmentSetting {
  equipment: Equipment;
  kind: EquipmentKind;
  label: string;
  enabled: boolean;
  minLb: number;
  maxLb: number;
  stepLb: number;
  customWeightsLb: number[];
  bandLevels: string[];
  // Every loadable weight, ascending. For bodyweight it's the ADDED weight
  // and starts at 0. Empty for bands.
  weightsLb: number[];
}

export interface EquipmentResponse {
  items: EquipmentSetting[];
  allBandLevels: string[];
}

const MAX_WEIGHT_OPTIONS = 500;
const round = (n: number) => Math.round(n * 1000) / 1000;

/** Mirrors the server's resolution of a range / custom list into weights. */
export function buildWeights(kind: EquipmentKind, minLb: number, maxLb: number, stepLb: number, custom: number[]): number[] {
  if (kind === "band") return [];
  let weights: number[];
  if (custom.length > 0) {
    weights = [...new Set(custom.map(round))].sort((a, b) => a - b);
  } else {
    weights = [];
    if (stepLb > 0 && maxLb >= minLb) {
      for (let i = 0; i < MAX_WEIGHT_OPTIONS; i++) {
        const v = round(minLb + i * stepLb);
        if (v > maxLb + 1e-9) break;
        weights.push(v);
      }
    }
  }
  if (kind === "bodyweight" && !weights.includes(0)) weights = [0, ...weights];
  return weights;
}
