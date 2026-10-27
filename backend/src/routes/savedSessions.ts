import { Router } from "express";
import { z } from "zod";
import { Prisma } from "@prisma/client";
import { prisma } from "../lib/prisma.js";
import { AuthedRequest } from "../lib/requireAuth.js";
import { MAX_SAVED_SESSIONS, copyName, nameKey } from "../services/savedSessions.js";

// The library of saved rehab / own sessions: type a physio's sheet in once,
// then add it to any day again later. Scheduling a saved session copies it onto
// the calendar, so editing the library never changes sessions already planned.
// Mounted at /saved-sessions behind requireAuth.
export const savedSessionsRouter = Router();

const exerciseSchema = z.object({
  name: z.string().trim().min(1).max(80),
  detail: z.string().trim().max(400).default(""),
});

const fieldsSchema = z.object({
  name: z.string().trim().min(1, "Give it a name").max(80),
  estimatedMinutes: z.number().int().min(1).max(600).nullish(),
  notes: z.string().trim().max(1000).nullish(),
  exercises: z.array(exerciseSchema).max(20),
});

const shape = (r: { id: string; name: string; estimatedMinutes: number | null; notes: string | null; exercises: Prisma.JsonValue; timesUsed: number; lastUsedAt: Date | null; updatedAt: Date }) => ({
  id: r.id,
  name: r.name,
  estimatedMinutes: r.estimatedMinutes,
  notes: r.notes,
  exercises: Array.isArray(r.exercises) ? r.exercises : [],
  timesUsed: r.timesUsed,
  lastUsedAt: r.lastUsedAt,
  updatedAt: r.updatedAt,
});

async function findByName(userId: string, name: string) {
  const all = await prisma.savedSession.findMany({ where: { userId }, select: { id: true, name: true } });
  return all.find((r) => nameKey(r.name) === nameKey(name)) ?? null;
}

const BAD = "Check the details: a name up to 80 characters, up to 20 exercises, and notes up to 1,000 characters.";

// GET /saved-sessions - the library, most recently used first.
savedSessionsRouter.get("/", async (req: AuthedRequest, res) => {
  const rows = await prisma.savedSession.findMany({ where: { userId: req.userId } });
  rows.sort((a, b) => (b.lastUsedAt?.getTime() ?? 0) - (a.lastUsedAt?.getTime() ?? 0) || a.name.localeCompare(b.name));
  res.json(rows.map(shape));
});

const createSchema = fieldsSchema.extend({ overwrite: z.boolean().optional() });

// POST /saved-sessions - save a new one. If the name is taken it answers 409
// with the existing id, unless overwrite is set, which replaces that entry.
savedSessionsRouter.post("/", async (req: AuthedRequest, res) => {
  const parsed = createSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: BAD });
  const { overwrite, ...data } = parsed.data;
  const userId = req.userId!;
  const clash = await findByName(userId, data.name);
  const values = { name: data.name, estimatedMinutes: data.estimatedMinutes ?? null, notes: data.notes || null, exercises: data.exercises as Prisma.InputJsonValue };
  if (clash) {
    if (!overwrite) return res.status(409).json({ error: `"${clash.name}" is already in your library.`, existingId: clash.id });
    return res.json(shape(await prisma.savedSession.update({ where: { id: clash.id }, data: values })));
  }
  if ((await prisma.savedSession.count({ where: { userId } })) >= MAX_SAVED_SESSIONS) {
    return res.status(400).json({ error: `Your library holds up to ${MAX_SAVED_SESSIONS} sessions. Delete one you no longer use first.` });
  }
  res.status(201).json(shape(await prisma.savedSession.create({ data: { userId, ...values } })));
});

// PUT /saved-sessions/:id - edit one (including renaming it).
savedSessionsRouter.put("/:id", async (req: AuthedRequest, res) => {
  const parsed = fieldsSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: BAD });
  const userId = req.userId!;
  const existing = await prisma.savedSession.findFirst({ where: { id: req.params.id, userId } });
  if (!existing) return res.status(404).json({ error: "Saved session not found" });
  const clash = await findByName(userId, parsed.data.name);
  if (clash && clash.id !== existing.id) return res.status(409).json({ error: `"${clash.name}" is already in your library. Choose a different name.`, existingId: clash.id });
  const d = parsed.data;
  res.json(
    shape(
      await prisma.savedSession.update({
        where: { id: existing.id },
        data: { name: d.name, estimatedMinutes: d.estimatedMinutes ?? null, notes: d.notes || null, exercises: d.exercises as Prisma.InputJsonValue },
      }),
    ),
  );
});

// POST /saved-sessions/:id/duplicate { name? } - a copy under a new name.
savedSessionsRouter.post("/:id/duplicate", async (req: AuthedRequest, res) => {
  const userId = req.userId!;
  const existing = await prisma.savedSession.findFirst({ where: { id: req.params.id, userId } });
  if (!existing) return res.status(404).json({ error: "Saved session not found" });
  if ((await prisma.savedSession.count({ where: { userId } })) >= MAX_SAVED_SESSIONS) {
    return res.status(400).json({ error: `Your library holds up to ${MAX_SAVED_SESSIONS} sessions. Delete one you no longer use first.` });
  }
  const names = (await prisma.savedSession.findMany({ where: { userId }, select: { name: true } })).map((r) => r.name);
  const asked = z.string().trim().min(1).max(80).safeParse(req.body?.name);
  let name = copyName(existing.name, names);
  if (asked.success) {
    if (names.some((n) => nameKey(n) === nameKey(asked.data))) return res.status(409).json({ error: `"${asked.data}" is already in your library. Choose a different name.` });
    name = asked.data;
  }
  const copy = await prisma.savedSession.create({
    data: { userId, name, estimatedMinutes: existing.estimatedMinutes, notes: existing.notes, exercises: existing.exercises as Prisma.InputJsonValue },
  });
  res.status(201).json(shape(copy));
});

// POST /saved-sessions/:id/used - note that it was added to the calendar.
savedSessionsRouter.post("/:id/used", async (req: AuthedRequest, res) => {
  const r = await prisma.savedSession.updateMany({ where: { id: req.params.id, userId: req.userId }, data: { timesUsed: { increment: 1 }, lastUsedAt: new Date() } });
  if (r.count === 0) return res.status(404).json({ error: "Saved session not found" });
  res.json({ ok: true });
});

// DELETE /saved-sessions/:id
savedSessionsRouter.delete("/:id", async (req: AuthedRequest, res) => {
  const r = await prisma.savedSession.deleteMany({ where: { id: req.params.id, userId: req.userId } });
  if (r.count === 0) return res.status(404).json({ error: "Saved session not found" });
  res.json({ ok: true });
});
