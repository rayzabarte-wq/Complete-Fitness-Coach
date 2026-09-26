import { Request, Response, NextFunction } from "express";
import { verifySessionToken } from "../services/auth.js";

export interface AuthedRequest extends Request {
  userId?: string;
}

export function requireAuth(req: AuthedRequest, res: Response, next: NextFunction) {
  const header = req.headers.authorization;
  const token = header?.startsWith("Bearer ") ? header.slice(7) : null;

  if (!token) {
    return res.status(401).json({ error: "Not authenticated" });
  }

  const payload = verifySessionToken(token);
  if (!payload) {
    return res.status(401).json({ error: "Session expired or invalid — please log in again" });
  }

  req.userId = payload.sub;
  next();
}
