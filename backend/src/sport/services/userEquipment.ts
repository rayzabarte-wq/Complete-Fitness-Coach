import { prisma } from "../../lib/prisma.js";
import { ALL_EQUIPMENT, Equipment, ResolvedEquipment, resolveEquipment } from "../lib/equipmentConfig.js";

/** This user's equipment, with defaults filled in for anything unconfigured. */
export async function getUserEquipment(userId: string): Promise<Record<Equipment, ResolvedEquipment>> {
  const rows = await prisma.userEquipment.findMany({ where: { userId } });
  return resolveEquipment(rows);
}

/** The equipment types this user has switched on. */
export function enabledEquipment(config: Record<Equipment, ResolvedEquipment>): Equipment[] {
  return ALL_EQUIPMENT.filter((e) => config[e].enabled);
}
