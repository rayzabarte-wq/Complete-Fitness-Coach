import { prisma } from "../../lib/prisma.js";
import {
  ALL_EQUIPMENT,
  ALL_GYM_KINDS,
  Accessory,
  Equipment,
  GYM_KIND_LABEL,
  GymKind,
  ResolvedEquipment,
  defaultPreset,
  resolvePreset,
  resolveEquipment,
} from "../lib/equipmentConfig.js";

/** A gym profile with its equipment resolved (defaults for its kind filled in). */
export interface ResolvedGym {
  id: string;
  kind: GymKind;
  name: string;
  accessories: Accessory[];
  customEquipmentIds: string[];
  /** The preset this gym follows for anything not changed (kind default if never chosen). */
  presetId: string;
  equipment: Record<Equipment, ResolvedEquipment>;
}

/** Creates whichever of the user's three gym profiles don't exist yet. */
export async function ensureGyms(userId: string): Promise<void> {
  const existing = await prisma.gymProfile.findMany({ where: { userId }, select: { kind: true } });
  const have = new Set(existing.map((g) => g.kind));
  const missing = ALL_GYM_KINDS.filter((k) => !have.has(k));
  if (missing.length === 0) return;
  await prisma.gymProfile.createMany({
    data: missing.map((kind) => ({ userId, kind, name: GYM_KIND_LABEL[kind], accessories: defaultPreset(kind).accessories, presetId: defaultPreset(kind).id })),
    skipDuplicates: true,
  });
}

/** All three of the user's gyms, in Home / Regular / Visiting order. */
export async function listGyms(userId: string): Promise<ResolvedGym[]> {
  await ensureGyms(userId);
  const rows = await prisma.gymProfile.findMany({ where: { userId }, include: { equipment: true } });
  return ALL_GYM_KINDS.map((k) => rows.find((r) => r.kind === k)!)
    .filter(Boolean)
    .map((g) => ({
      id: g.id,
      kind: g.kind,
      name: g.name,
      accessories: g.accessories,
      customEquipmentIds: g.customEquipmentIds,
      presetId: resolvePreset(g.kind, g.presetId).id,
      equipment: resolveEquipment(g.equipment, g.kind, g.presetId),
    }));
}

/**
 * The gym to use: the one asked for (must be the user's), else their
 * remembered active gym, else Home.
 */
export async function getGym(userId: string, gymId?: string | null): Promise<ResolvedGym> {
  const gyms = await listGyms(userId);
  if (gymId) {
    const found = gyms.find((g) => g.id === gymId);
    if (found) return found;
  }
  const user = await prisma.user.findUnique({ where: { id: userId }, select: { activeGymId: true } });
  return gyms.find((g) => g.id === user?.activeGymId) ?? gyms.find((g) => g.kind === "HOME") ?? gyms[0];
}

/** The equipment types this gym has switched on. */
export function enabledEquipment(gym: ResolvedGym): Equipment[] {
  return ALL_EQUIPMENT.filter((e) => gym.equipment[e].enabled);
}

interface ExerciseGate {
  equipment: string;
  requires: Accessory[];
  customEquipmentId: string | null;
  archivedAt: Date | null;
}

/** Can this exercise be done at this gym? */
export function isExerciseAvailable(ex: ExerciseGate, gym: ResolvedGym): boolean {
  if (ex.archivedAt) return false;
  if (!gym.equipment[ex.equipment as Equipment]?.enabled) return false;
  if (!ex.requires.every((a) => gym.accessories.includes(a))) return false;
  if (ex.customEquipmentId && !gym.customEquipmentIds.includes(ex.customEquipmentId)) return false;
  return true;
}
