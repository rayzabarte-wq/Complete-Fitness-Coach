import { Router } from "express";
import { prisma } from "../lib/prisma.js";
import { AuthedRequest } from "../lib/requireAuth.js";

// What the person sees in the app: messages from the admin (see
// routes/admin.ts) addressed to everyone or to them, not yet dismissed and
// not expired. Mounted behind requireAuth.
export const messagesRouter = Router();

// GET /messages - newest first.
messagesRouter.get("/", async (req: AuthedRequest, res) => {
  const userId = req.userId!;
  const now = new Date();
  const messages = await prisma.announcement.findMany({
    where: {
      AND: [
        { OR: [{ targetUserId: null }, { targetUserId: userId }] },
        { OR: [{ expiresAt: null }, { expiresAt: { gt: now } }] },
        { reads: { none: { userId } } },
      ],
    },
    orderBy: { createdAt: "desc" },
    take: 5,
    select: { id: true, title: true, body: true, createdAt: true },
  });
  res.json(messages);
});

// POST /messages/:id/dismiss
messagesRouter.post("/:id/dismiss", async (req: AuthedRequest, res) => {
  const userId = req.userId!;
  const message = await prisma.announcement.findFirst({
    where: { id: req.params.id, OR: [{ targetUserId: null }, { targetUserId: userId }] },
    select: { id: true },
  });
  if (!message) return res.status(404).json({ error: "No such message" });
  await prisma.announcementRead.upsert({
    where: { announcementId_userId: { announcementId: message.id, userId } },
    update: {},
    create: { announcementId: message.id, userId },
  });
  res.status(204).send();
});
