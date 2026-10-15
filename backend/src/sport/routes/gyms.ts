import { Router } from "express";
import { z } from "zod";
import { prisma } from "../../lib/prisma.js";
import { AuthedRequest } from "../../lib/requireAuth.js";
import {
  ACCESSORY_LABEL,
  ALL_ACCESSORIES,
  ALL_EQUIPMENT,
  BAND_LEVELS,
  EQUIPMENT_KIND,
  MAX_CUSTOM_WEIGHTS,
  MAX_WEIGHT_OPTIONS,
  GYM_PRESETS,
  presetsFor,
  rangeValues,
  resolvePreset,
} from "../lib/equipmentConfig.js";
import { getGym, listGyms } from "../services/gyms.js";

export const gymsRouter = Router();

async function loadResponse(userId: string) {
  const [gyms, user, customEquipment] = await Promise.all([
    listGyms(userId),
    prisma.user.findUnique({ where: { id: userId }, select: { activeGymId: true } }),
    prisma.customEquipment.findMany({ where: { userId }, orderBy: { name: "asc" }, select: { id: true, name: true } }),
  ]);
  const active = await getGym(userId, user?.activeGymId);
  return {
    gyms: gyms.map((g) => ({ ...g, equipment: ALL_EQUIPMENT.map((e) => g.equipment[e]) })),
    activeGymId: active.id,
    customEquipment,
    allBandLevels: BAND_LEVELS,
    presets: GYM_PRESETS.map(({ id, kind, label, description }) => ({ id, kind, label, description })),
    allAccessories: ALL_ACCESSORIES.map((value) => ({ value, label: ACCESSORY_LABEL[value] })),
  };
}

// GET /gyms - the three gym profiles (Home / Regular / Visiting), each with
// its resolved equipment, accessories and ticked custom items, plus the
// user's custom equipment list and which gym is active. Defaults for each
// kind are filled in for anything not configured yet.
gymsRouter.get("/", async (req: AuthedRequest, res) => {
  res.json(await loadResponse(req.userId!));
});

// PUT /gyms/active - remember which gym the workout page should start on.
gymsRouter.put("/active", async (req: AuthedRequest, res) => {
  const parsed = z.object({ gymId: z.string() }).safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  const userId = req.userId!;
  const gyms = await listGyms(userId);
  if (!gyms.some((g) => g.id === parsed.data.gymId)) return res.status(404).json({ error: "Gym not found" });
  await prisma.user.update({ where: { id: userId }, data: { activeGymId: parsed.data.gymId } });
  res.json(await loadResponse(userId));
});

// POST /gyms/:id/preset - set this gym back to a preset: pass presetId to
// switch to a different one, or omit it to reset to the preset it already
// follows. Either way every adjustment to equipment weights and the
// accessory tick-boxes is discarded and replaced by the preset's values.
// The gym's name and its ticked custom equipment are kept.
gymsRouter.post("/:id/preset", async (req: AuthedRequest, res) => {
  const parsed = z.object({ presetId: z.string().optional() }).safeParse(req.body ?? {});
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  const userId = req.userId!;
  const gym = await prisma.gymProfile.findFirst({ where: { id: req.params.id, userId } });
  if (!gym) return res.status(404).json({ error: "Gym not found" });
  const wanted = parsed.data.presetId;
  if (wanted && !presetsFor(gym.kind).some((p) => p.id === wanted)) {
    return res.status(400).json({ error: "That preset isn't available for this gym" });
  }
  const preset = resolvePreset(gym.kind, wanted ?? gym.presetId);
  await prisma.$transaction([
    prisma.gymEquipment.deleteMany({ where: { gymId: gym.id } }),
    prisma.gymProfile.update({ where: { id: gym.id }, data: { presetId: preset.id, accessories: preset.accessories } }),
  ]);
  res.json(await loadResponse(userId));
});

const customNameSchema = z.object({ name: z.string().trim().min(1).max(60) });

// POST /gyms/custom-equipment - name a piece of equipment of your own
// ("Landmine attachment", "Sled"). Tick it per gym, and link custom
// exercises to it, so those exercises only appear where it's available.
gymsRouter.post("/custom-equipment", async (req: AuthedRequest, res) => {
  const parsed = customNameSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  const userId = req.userId!;
  const clash = await prisma.customEquipment.findFirst({ where: { userId, name: { equals: parsed.data.name, mode: "insensitive" } } });
  if (clash) return res.status(409).json({ error: `You already have "${clash.name}"` });
  const count = await prisma.customEquipment.count({ where: { userId } });
  if (count >= 50) return res.status(400).json({ error: "That's the limit of 50 custom items" });
  await prisma.customEquipment.create({ data: { userId, name: parsed.data.name } });
  res.status(201).json(await loadResponse(userId));
});

// DELETE /gyms/custom-equipment/:id - remove it everywhere. Custom
// exercises built around it are archived (they could never be offered again).
gymsRouter.delete("/custom-equipment/:id", async (req: AuthedRequest, res) => {
  const userId = req.userId!;
  const item = await prisma.customEquipment.findFirst({ where: { id: req.params.id, userId } });
  if (!item) return res.status(404).json({ error: "Custom equipment not found" });

  const gyms = await prisma.gymProfile.findMany({ where: { userId } });
  await prisma.$transaction([
    ...gyms
      .filter((g) => g.customEquipmentIds.includes(item.id))
      .map((g) =>
        prisma.gymProfile.update({ where: { id: g.id }, data: { customEquipmentIds: g.customEquipmentIds.filter((x) => x !== item.id) } })
      ),
    prisma.exercise.updateMany({ where: { userId, customEquipmentId: item.id, archivedAt: null }, data: { archivedAt: new Date() } }),
    prisma.customEquipment.delete({ where: { id: item.id } }),
  ]);
  res.json(await loadResponse(userId));
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

const updateGymSchema = z.object({
  name: z.string().trim().min(1).max(60).optional(),
  accessories: z.array(z.enum(["BENCH", "PULL_UP_BAR", "RINGS"])).optional(),
  customEquipmentIds: z.array(z.string()).optional(),
  items: z.array(itemSchema).optional(),
});

type Item = z.infer<typeof itemSchema>;

/** Per-type checks that depend on the equipment's kind. Returns an error or null. */
function validateItem(item: Item): string | null {
  const kind = EQUIPMENT_KIND[item.equipment];
  const name = item.equipment.replace("_", " ").toLowerCase();

  if (kind === "band") {
    const levels = item.bandLevels ?? [];
    if (levels.some((l) => !BAND_LEVELS.includes(l))) return `Band levels must be from: ${BAND_LEVELS.join(", ")}`;
    if (item.enabled && levels.length === 0) return "Pick at least one band level, or untick bands";
    return null;
  }

  // Nothing to check for a type that's unticked — keep whatever they typed.
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

// PUT /gyms/:id - save changes to one gym: its name, ticked accessories,
// ticked custom equipment, and any equipment types (types left out of the
// payload are untouched). At least one equipment type must stay ticked,
// otherwise no workout could be built there.
gymsRouter.put("/:id", async (req: AuthedRequest, res) => {
  const parsed = updateGymSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  const userId = req.userId!;

  const gyms = await listGyms(userId);
  const gym = gyms.find((g) => g.id === req.params.id);
  if (!gym) return res.status(404).json({ error: "Gym not found" });
  const { name, accessories, customEquipmentIds, items = [] } = parsed.data;

  for (const item of items) {
    const error = validateItem(item);
    if (error) return res.status(400).json({ error });
  }

  if (customEquipmentIds) {
    const owned = await prisma.customEquipment.findMany({ where: { userId, id: { in: customEquipmentIds } }, select: { id: true } });
    if (owned.length !== new Set(customEquipmentIds).size) return res.status(400).json({ error: "Unknown custom equipment" });
  }

  const enabledAfter = new Set(ALL_EQUIPMENT.filter((e) => gym.equipment[e].enabled));
  for (const item of items) {
    if (item.enabled) enabledAfter.add(item.equipment);
    else enabledAfter.delete(item.equipment);
  }
  if (enabledAfter.size === 0) {
    return res.status(400).json({ error: "Keep at least one type of equipment ticked for this gym" });
  }

  await prisma.$transaction([
    prisma.gymProfile.update({
      where: { id: gym.id },
      data: {
        ...(name !== undefined ? { name } : {}),
        ...(accessories ? { accessories: ALL_ACCESSORIES.filter((a) => accessories.includes(a)) } : {}),
        ...(customEquipmentIds ? { customEquipmentIds: [...new Set(customEquipmentIds)] } : {}),
      },
    }),
    ...items.map((item) => {
      const kind = EQUIPMENT_KIND[item.equipment];
      const key = { gymId_equipment: { gymId: gym.id, equipment: item.equipment } };
      // Unticking a type only flips the flag, so its weights are still there
      // if it gets ticked again later.
      if (!item.enabled) {
        return prisma.gymEquipment.upsert({
          where: key,
          create: { gymId: gym.id, equipment: item.equipment, enabled: false },
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
      return prisma.gymEquipment.upsert({
        where: key,
        create: { gymId: gym.id, equipment: item.equipment, ...data },
        update: data,
      });
    }),
  ]);

  res.json(await loadResponse(userId));
});
