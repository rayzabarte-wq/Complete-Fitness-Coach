import { Router } from "express";
import rateLimit from "express-rate-limit";
import { z } from "zod";
import { prisma } from "../lib/prisma.js";
import { requireAuth, AuthedRequest } from "../lib/requireAuth.js";
import {
  hashPassword,
  verifyPassword,
  generateTotpSecret,
  totpKeyUri,
  verifyTotpCode,
  issueSessionToken,
} from "../services/auth.js";
import QRCode from "qrcode";

export const authRouter = Router();

// Slow down brute-force attempts against login and 2FA verification.
const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Too many attempts. Try again in a few minutes." },
});

const credentialsSchema = z.object({
  email: z.string().email(),
  password: z.string().min(10, "Use at least 10 characters"),
});

// POST /auth/register - creates a new account. The app is multi-user: any
// number of people can register, each gets their own fully isolated data
// (see the userId scoping throughout every other route). Duplicate emails
// are rejected via the unique constraint on User.email.
authRouter.post("/register", async (req, res) => {
  const parsed = credentialsSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: parsed.error.flatten() });
  }

  const existing = await prisma.user.findUnique({ where: { email: parsed.data.email } });
  if (existing) {
    return res.status(409).json({ error: "An account with that email already exists" });
  }

  const passwordHash = await hashPassword(parsed.data.password);
  const user = await prisma.user.create({
    data: { email: parsed.data.email, passwordHash },
  });

  const token = issueSessionToken(user.id);
  res.status(201).json({ token, totpEnabled: false });
});

const loginSchema = z.object({
  email: z.string().email(),
  password: z.string(),
  code: z.string().length(6).optional(), // required once 2FA is enabled
});

// POST /auth/login - password check, then TOTP code check if 2FA is enabled.
authRouter.post("/login", loginLimiter, async (req, res) => {
  const parsed = loginSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: parsed.error.flatten() });
  }
  const { email, password, code } = parsed.data;

  const user = await prisma.user.findUnique({ where: { email } });
  // Same error for "no such user" and "wrong password" so login can't be
  // used to enumerate whether an email is registered.
  if (!user || !(await verifyPassword(password, user.passwordHash))) {
    return res.status(401).json({ error: "Invalid email or password" });
  }

  if (user.totpEnabled) {
    if (!code) {
      return res.status(401).json({ error: "2FA code required", requires2fa: true });
    }
    if (!user.totpSecret || !verifyTotpCode(user.totpSecret, code)) {
      return res.status(401).json({ error: "Invalid 2FA code" });
    }
  }

  const token = issueSessionToken(user.id);
  res.json({ token, totpEnabled: user.totpEnabled });
});

// POST /auth/2fa/setup - must already be logged in with a password. Issues a
// new TOTP secret and a QR code to scan into an authenticator app. 2FA isn't
// enforced until /2fa/verify confirms the user can generate a valid code.
authRouter.post("/2fa/setup", requireAuth, async (req: AuthedRequest, res) => {
  const user = await prisma.user.findUniqueOrThrow({ where: { id: req.userId } });

  const secret = generateTotpSecret();
  await prisma.user.update({ where: { id: user.id }, data: { totpSecret: secret } });

  const qrDataUrl = await QRCode.toDataURL(totpKeyUri(user.email, secret));
  res.json({ secret, qrDataUrl });
});

const verify2faSchema = z.object({ code: z.string().length(6) });

// POST /auth/2fa/verify - confirms the authenticator app is working, then
// turns 2FA enforcement on for this account.
authRouter.post("/2fa/verify", requireAuth, async (req: AuthedRequest, res) => {
  const parsed = verify2faSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: parsed.error.flatten() });
  }

  const user = await prisma.user.findUniqueOrThrow({ where: { id: req.userId } });
  if (!user.totpSecret) {
    return res.status(400).json({ error: "Call /2fa/setup first" });
  }
  if (!verifyTotpCode(user.totpSecret, parsed.data.code)) {
    return res.status(401).json({ error: "Invalid 2FA code" });
  }

  await prisma.user.update({ where: { id: user.id }, data: { totpEnabled: true } });
  res.json({ totpEnabled: true });
});
