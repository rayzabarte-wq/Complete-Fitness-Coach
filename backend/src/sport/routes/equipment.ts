import { Router } from "express";
import { z } from "zod";
import { prisma } from "../../lib/prisma.js";
import { AuthedRequest } from "../../lib/requireAuth.js";
import {
  ALL_EQUIPMENT,
  BAND_LEVELS,
  EQUIPMENT_KIND,
  MAX_CUSTOM_WEIGHTS,
  MAX_WEIGHT_OPTIONS,
  rangeValues,
} from "../lib/equipmentConfig.js";
import { getUserEquipment } from "../services/userEquipment.js";

export const equipmentRouter = Router();

async function loadResponse(userId: string) {
  const config = await getUserEquipment(userId);
  return { items: ALL_EQUIPMENT.map((e) => config[e]), allBandLevels: BAND_LEVELS };
}

// GET /equipment - the signed-in user's equipment, defaults filled in for
// anything they haven't configured. Each item carries both the editable
// settings (min/max/step, custom list, band levels) and the resolved list
// of loadable weights, so the Log page and the Settings form read the same
// thing.
equipmentRouter.get("/", async (req: AuthedRequest, res) => {
  res.json(await loadResponse(req.userId!));
});

const itemSchema = z.object({
  equipment: z.enum(["DUMBBELL", "BARBELL", "EZ_BAR", "BAND", "BODYWEIGHT"]),
  enabled: z.boolean(),
  minLb: z.number().nonnegative().optional(),
  maxLb: z.number().nonnegative().optional(),
  stepLb: z.number().positive().optional(),
  customWeightsLb: z.array(z.number().positive()).max(MAX_CUSTOM_WEIGHTS).optional(),
  bandLevels: z.array(z.string()).optional(),
});

const saveSchema = z.object({ items: z.array(itemSchema).min(1) });

type Item = z.infer<typeof itemSchema>;

/** Per-type checks that depend on the equipment's kind. Returns an error or null. */
function validateItem(item: Item): string | null {
  const kind = EQUIPMENT_KIND[item.equipment];
  const name = item.equipment.replace("_", " ").toLowerCase();

  if (kind === "band") {
    const levels = item.bandLevels ?? [];
    if (levels.some((l) => !BAND_LEVELS.includes(l))) return `Band levels must be from: ${BAND_LEVELS.join(", ")}`;
    if (item.enabled && levels.length === 0) return "Pick at least one band level, or turn bands off";
    return null;
  }

  // Nothing to check for a type that's switched off — keep whatever they typed.
  if (!item.enabled) return null;

  if ((item.customWeightsLb ?? []).length > 0) return null;

  const min = kind === "bodyweight" ? 0 : item.minLb;
  if (min === undefined || item.maxLb === undefined || item.stepLb === undefined) {
    return `${name}: enter a min, max and step (or a custom list of weights)`;
  }
  if (kind === "weighted" && min <= 0) return `${name}: minimum weight must be above 0`;
  if (item.maxLb < min) return `${name}: maximum must be at least the minimum`;
  if (rangeValues(min, item.maxLb, item.stepLb).length >= MAX_WEIGHT_OPTIONS) {
    return `${name}: that range makes more than ${MAX_WEIGHT_OPTIONS} weights — use a larger step`;
  }
  return null;
}

// PUT /equipment - save changes for any of the equipment types (types left
// out of the payload are untouched). At least one type must end up enabled,
// otherwise no workout could be generated at all.
equipmentRouter.put("/", async (req: AuthedRequest, res) => {
  const parsed = saveSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  const userId = req.userId!;

  for (const item of parsed.data.items) {
    const error = validateItem(item);
    if (error) return res.status(400).json({ error });
  }

  // Work out the end state to enforce "something must be enabled".
  const current = await getUserEquipment(userId);
  const enabledAfter = new Set(ALL_EQUIPMENT.filter((e) => current[e].enabled));
  for (const item of parsed.data.items) {
    if (item.enabled) enabledAfter.add(item.equipment);
    else enabledAfter.delete(item.equipment);
  }
  if (enabledAfter.size === 0) {
    return res.status(400).json({ error: "Keep at least one type of equipment switched on" });
  }

  await prisma.$transaction(
    parsed.data.items.map((item) => {
      const kind = EQUIPMENT_KIND[item.equipment];
      // Switching a type off only flips the flag, so its weights are still
      // there if they switch it back on later.
      if (!item.enabled) {
        return prisma.userEquipment.upsert({
          where: { userId_equipment: { userId, equipment: item.equipment } },
          create: { userId, equipment: item.equipment, enabled: false },
          update: { enabled: false },
        });
      }
      const data = {
        enabled: item.enabled,
        minLb: kind === "band" ? null : kind === "bodyweight" ? 0 : item.minLb ?? null,
        maxLb: kind === "band" ? null : item.maxLb ?? null,
        stepLb: kind === "band" ? null : item.stepLb ?? null,
        customWeightsLb: kind === "band" ? [] : item.customWeightsLb ?? [],
        bandLevels: kind === "band" ? BAND_LEVELS.filter((l) => (item.bandLevels ?? []).includes(l)) : [],
      };
      return prisma.userEquipment.upsert({
        where: { userId_equipment: { userId, equipment: item.equipment } },
        create: { userId, equipment: item.equipment, ...data },
        update: data,
      });
    })
  );

  res.json(await loadResponse(userId));
});
