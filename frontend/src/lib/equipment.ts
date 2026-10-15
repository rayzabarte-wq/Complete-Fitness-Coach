// Equipment is per gym now (Home / Regular gym / Visiting): what each gym has,
// and the weights it can produce, comes from GET /gyms (resolved server-side — see
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

export type GymKind = "HOME" | "PUBLIC_GYM" | "VISITING";
export type Accessory = "BENCH" | "PULL_UP_BAR" | "RINGS";

export interface Gym {
  id: string;
  kind: GymKind;
  name: string;
  accessories: Accessory[];
  /** Ids of the user's CustomEquipment items this gym has. */
  customEquipmentIds: string[];
  /** The preset this gym follows for anything not changed. */
  presetId: string;
  equipment: EquipmentSetting[];
}

export interface GymPreset {
  id: string;
  kind: GymKind;
  label: string;
  description: string;
}

export interface CustomEquipment {
  id: string;
  name: string;
}

export interface GymsResponse {
  gyms: Gym[];
  activeGymId: string;
  customEquipment: CustomEquipment[];
  presets: GymPreset[];
  allBandLevels: string[];
  allAccessories: { value: Accessory; label: string }[];
}

export const GYM_KIND_LABEL: Record<GymKind, string> = {
  HOME: "Home gym",
  PUBLIC_GYM: "Regular gym",
  VISITING: "Visiting gym",
};

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
