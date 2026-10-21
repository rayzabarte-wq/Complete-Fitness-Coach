import { Router } from "express";
import { z } from "zod";
import { prisma } from "../lib/prisma.js";
import { AuthedRequest } from "../lib/requireAuth.js";
import { USAGE_EVENTS } from "../services/usage.js";
import { AdminRequest, isAdminEmail, requireAdmin } from "../lib/requireAdmin.js";

// The admin area: see who has signed up, suspend or delete accounts, and send
// in-app messages. Everything except /admin/me needs requireAdmin (see
// lib/requireAdmin.ts). Deliberately limited to account basics and counts —
// no training, body, nutrition or consent data is exposed here.
export const adminRouter = Router();

async function audit(admin: string, action: string, targetEmail?: string | null, detail?: string) {
  await prisma.adminAuditLog.create({ data: { adminEmail: admin, action, targetEmail: targetEmail ?? null, detail: detail ?? null } });
}

// GET /admin/me - lets the app decide whether to show the admin link.
// Open to any logged-in user; it only ever says whether *they* are an admin.
export const adminMeRoute = async (req: AuthedRequest, res: import("express").Response) => {
  const user = await prisma.user.findUnique({ where: { id: req.userId }, select: { email: true, totpEnabled: true } });
  res.json({ isAdmin: !!user && isAdminEmail(user.email), totpEnabled: !!user?.totpEnabled });
};

adminRouter.get("/me", adminMeRoute);

adminRouter.use(requireAdmin);

const DAY = 24 * 60 * 60 * 1000;

// GET /admin/users - everyone, newest first, with a few counts.
adminRouter.get("/users", async (_req, res) => {
  const [users, sessionCounts, lastSessions] = await Promise.all([
    prisma.user.findMany({
      orderBy: { createdAt: "desc" },
      select: { id: true, email: true, createdAt: true, lastSeenAt: true, totpEnabled: true, suspendedAt: true },
    }),
    prisma.workoutSession.groupBy({ by: ["userId"], _count: { _all: true } }),
    prisma.workoutSession.groupBy({ by: ["userId"], _max: { date: true } }),
  ]);
  const counts = new Map(sessionCounts.map((s) => [s.userId, s._count._all]));
  const last = new Map(lastSessions.map((s) => [s.userId, s._max.date]));
  const now = Date.now();
  const rows = users.map((u) => ({
    id: u.id,
    email: u.email,
    createdAt: u.createdAt,
    lastSeenAt: u.lastSeenAt,
    totpEnabled: u.totpEnabled,
    suspendedAt: u.suspendedAt,
    isAdmin: isAdminEmail(u.email),
    sessionCount: counts.get(u.id) ?? 0,
    lastSessionAt: last.get(u.id) ?? null,
  }));
  res.json({
    summary: {
      total: rows.length,
      newLast7Days: rows.filter((u) => now - u.createdAt.getTime() < 7 * DAY).length,
      activeLast7Days: rows.filter((u) => u.lastSeenAt && now - u.lastSeenAt.getTime() < 7 * DAY).length,
      suspended: rows.filter((u) => u.suspendedAt).length,
    },
    users: rows,
  });
});

// Either the account to act on, or why it can't be acted on. Spelled out so
// that after `if (r.error)` TypeScript knows `r.user` is present.
type ActionableResult =
  | { user: { id: string; email: string }; error?: undefined }
  | { user?: undefined; error: { status: number; message: string } };

async function actionableUser(id: string): Promise<ActionableResult> {
  const user = await prisma.user.findUnique({ where: { id }, select: { id: true, email: true } });
  if (!user) return { error: { status: 404, message: "No such user" } };
  if (isAdminEmail(user.email)) return { error: { status: 400, message: "Admin accounts can't be changed from here." } };
  return { user };
}

// POST /admin/users/:id/suspend and /reinstate. Suspending takes effect on
// the person's very next request (requireAuth checks it) and blocks login.
adminRouter.post("/users/:id/suspend", async (req: AdminRequest, res) => {
  const r = await actionableUser(req.params.id);
  if (r.error) return res.status(r.error.status).json({ error: r.error.message });
  await prisma.user.update({ where: { id: r.user.id }, data: { suspendedAt: new Date() } });
  await audit(req.adminEmail!, "suspend", r.user.email);
  res.json({ ok: true });
});

adminRouter.post("/users/:id/reinstate", async (req: AdminRequest, res) => {
  const r = await actionableUser(req.params.id);
  if (r.error) return res.status(r.error.status).json({ error: r.error.message });
  await prisma.user.update({ where: { id: r.user.id }, data: { suspendedAt: null } });
  await audit(req.adminEmail!, "reinstate", r.user.email);
  res.json({ ok: true });
});

// POST /admin/users/:id/reset-2fa - switches 2FA off for someone who has lost
// their authenticator, so they can use Forgot password and log in again (a
// reset link doesn't remove the code step). Also signs out their trusted
// devices. The person can turn 2FA back on in Settings → Security.
adminRouter.post("/users/:id/reset-2fa", async (req: AdminRequest, res) => {
  const r = await actionableUser(req.params.id);
  if (r.error) return res.status(r.error.status).json({ error: r.error.message });
  await prisma.user.update({ where: { id: r.user.id }, data: { totpEnabled: false, totpSecret: null, sessionsValidAfter: new Date() } });
  await audit(req.adminEmail!, "reset-2fa", r.user.email);
  res.json({ ok: true });
});

const deleteSchema = z.object({ confirmEmail: z.string() });

// DELETE /admin/users/:id - permanent. The admin must type the person's
// email as confirmation. Removes everything the account owns, the same as
// the person deleting their own account (see routes/account.ts).
adminRouter.delete("/users/:id", async (req: AdminRequest, res) => {
  const parsed = deleteSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "Type the person's email to confirm." });
  const r = await actionableUser(req.params.id);
  if (r.error) return res.status(r.error.status).json({ error: r.error.message });
  if (parsed.data.confirmEmail.trim().toLowerCase() !== r.user.email.toLowerCase()) {
    return res.status(400).json({ error: "That doesn't match the person's email." });
  }
  await prisma.user.delete({ where: { id: r.user.id } });
  await prisma.exercise.deleteMany({ where: { userId: r.user.id } });
  // Messages written to just this person go with them.
  await prisma.announcement.deleteMany({ where: { targetUserId: r.user.id } });
  await audit(req.adminEmail!, "delete", r.user.email);
  res.status(204).send();
});

const messageSchema = z.object({
  title: z.string().trim().min(1, "Add a title").max(80),
  body: z.string().trim().min(1, "Write a message").max(1000),
  // Omitted = everyone.
  targetUserId: z.string().optional(),
  // Days until it stops showing. Omitted = 14. 0 = no expiry.
  expiresInDays: z.number().int().min(0).max(365).optional(),
});

// POST /admin/messages
adminRouter.post("/messages", async (req: AdminRequest, res) => {
  const parsed = messageSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  const { title, body, targetUserId, expiresInDays } = parsed.data;
  let targetEmail: string | null = null;
  if (targetUserId) {
    const target = await prisma.user.findUnique({ where: { id: targetUserId }, select: { email: true } });
    if (!target) return res.status(404).json({ error: "No such user" });
    targetEmail = target.email;
  }
  const days = expiresInDays ?? 14;
  const message = await prisma.announcement.create({
    data: { title, body, targetUserId: targetUserId ?? null, expiresAt: days > 0 ? new Date(Date.now() + days * DAY) : null },
  });
  await audit(req.adminEmail!, "message", targetEmail, targetUserId ? title : `${title} (everyone)`);
  res.status(201).json({ id: message.id });
});

// GET /admin/messages - recent messages, with how many people dismissed each.
adminRouter.get("/messages", async (_req, res) => {
  const messages = await prisma.announcement.findMany({
    orderBy: { createdAt: "desc" },
    take: 30,
    include: { _count: { select: { reads: true } } },
  });
  const targetIds = messages.map((m) => m.targetUserId).filter((id): id is string => !!id);
  const targets = await prisma.user.findMany({ where: { id: { in: targetIds } }, select: { id: true, email: true } });
  const emailById = new Map(targets.map((t) => [t.id, t.email]));
  res.json(
    messages.map((m) => ({
      id: m.id,
      title: m.title,
      body: m.body,
      createdAt: m.createdAt,
      expiresAt: m.expiresAt,
      targetEmail: m.targetUserId ? (emailById.get(m.targetUserId) ?? null) : null,
      everyone: !m.targetUserId,
      dismissedBy: m._count.reads,
    })),
  );
});

// DELETE /admin/messages/:id - withdraw a message.
adminRouter.delete("/messages/:id", async (req: AdminRequest, res) => {
  const found = await prisma.announcement.findUnique({ where: { id: req.params.id }, select: { title: true } });
  if (!found) return res.status(404).json({ error: "No such message" });
  await prisma.announcement.delete({ where: { id: req.params.id } });
  await audit(req.adminEmail!, "withdraw-message", null, found.title);
  res.status(204).send();
});

// GET /admin/log - the most recent admin actions.
adminRouter.get("/log", async (_req, res) => {
  res.json(await prisma.adminAuditLog.findMany({ orderBy: { createdAt: "desc" }, take: 50 }));
});

// GET /admin/usage - how much each feature is used: totals only, never who.
// Features nobody has used are listed with zeros.
adminRouter.get("/usage", async (_req, res) => {
  const now = Date.now();
  const since30 = new Date(now - 30 * DAY);
  const since7 = now - 7 * DAY;
  const [rows, totalUsers, optedIn] = await Promise.all([
    prisma.usageEvent.groupBy({ by: ["name", "userId"], where: { createdAt: { gte: since30 } }, _count: { _all: true }, _max: { createdAt: true } }),
    prisma.user.count(),
    prisma.consentRecord.findMany({ where: { purpose: "PRODUCT_ANALYTICS" }, orderBy: { createdAt: "asc" }, select: { userId: true, granted: true } }),
  ]);
  const consent = new Map<string, boolean>();
  for (const r of optedIn) consent.set(r.userId, r.granted);
  const byName = new Map<string, { events30: number; users30: Set<string>; users7: Set<string> }>();
  for (const r of rows) {
    const e = byName.get(r.name) ?? { events30: 0, users30: new Set<string>(), users7: new Set<string>() };
    e.events30 += r._count._all;
    e.users30.add(r.userId);
    if (r._max.createdAt && r._max.createdAt.getTime() >= since7) e.users7.add(r.userId);
    byName.set(r.name, e);
  }
  res.json({
    totalUsers,
    optedInUsers: [...consent.values()].filter(Boolean).length,
    features: USAGE_EVENTS.map((name) => {
      const e = byName.get(name);
      return { name, events30: e?.events30 ?? 0, users30: e?.users30.size ?? 0, users7: e?.users7.size ?? 0 };
    }),
  });
});
