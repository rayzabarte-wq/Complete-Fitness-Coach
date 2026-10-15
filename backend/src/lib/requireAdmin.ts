import { NextFunction, Response } from "express";
import { prisma } from "./prisma.js";
import { AuthedRequest } from "./requireAuth.js";

// Who counts as an admin: the emails listed (comma-separated) in the
// ADMIN_EMAILS environment variable. Kept out of the database on purpose, so
// nobody can become an admin through the app or a database edit alone, and
// removing an address takes effect on the next request.
export function isAdminEmail(email: string): boolean {
  const list = (process.env.ADMIN_EMAILS ?? "")
    .split(",")
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean);
  return list.includes(email.toLowerCase());
}

export interface AdminRequest extends AuthedRequest {
  adminEmail?: string;
}

// Use after requireAuth. Admin pages hold other people's account details, so
// an admin must also have 2FA switched on.
export async function requireAdmin(req: AdminRequest, res: Response, next: NextFunction) {
  const user = await prisma.user.findUnique({ where: { id: req.userId }, select: { email: true, totpEnabled: true } });
  if (!user || !isAdminEmail(user.email)) {
    // Same answer as an unknown route, so the admin area isn't advertised.
    return res.status(404).json({ error: "Not found" });
  }
  if (!user.totpEnabled) {
    return res.status(403).json({ error: "Turn on 2FA in Settings before using the admin area." });
  }
  req.adminEmail = user.email;
  next();
}
