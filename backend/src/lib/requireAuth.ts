import { Request, Response, NextFunction } from "express";
import { verifySessionToken } from "../services/auth.js";
import { prisma } from "./prisma.js";

export interface AuthedRequest extends Request {
  userId?: string;
}

export async function requireAuth(req: AuthedRequest, res: Response, next: NextFunction) {
  const header = req.headers.authorization;
  const token = header?.startsWith("Bearer ") ? header.slice(7) : null;

  if (!token) {
    return res.status(401).json({ error: "Not authenticated" });
  }

  const payload = verifySessionToken(token);
  if (!payload) {
    return res.status(401).json({ error: "Session expired or invalid — please log in again" });
  }

  // Reject sessions issued before the account's last password reset (and
  // sessions for accounts that no longer exist). JWT iat is in whole
  // seconds, so compare at that resolution.
  const user = await prisma.user.findUnique({
    where: { id: payload.sub },
    select: { sessionsValidAfter: true },
  });
  const validAfterSec = user?.sessionsValidAfter ? Math.floor(user.sessionsValidAfter.getTime() / 1000) : null;
  if (!user || (validAfterSec !== null && (payload.iat ?? 0) < validAfterSec)) {
    return res.status(401).json({ error: "Session expired or invalid — please log in again" });
  }

  req.userId = payload.sub;
  next();
}
