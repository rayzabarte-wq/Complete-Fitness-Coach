import { Router } from "express";
import rateLimit from "express-rate-limit";
import { z } from "zod";
import { Prisma } from "@prisma/client";
import { prisma } from "../lib/prisma.js";
import { requireAuth, AuthedRequest, SUSPENDED_MESSAGE } from "../lib/requireAuth.js";
import {
  hashPassword,
  verifyPassword,
  generateTotpSecret,
  totpKeyUri,
  verifyTotpCode,
  issueSessionToken,
  issueTwoFactorTrustToken,
  verifyTwoFactorTrustToken,
  TWO_FACTOR_TRUST_HOURS,
} from "../services/auth.js";
import QRCode from "qrcode";
import { createHash, randomBytes } from "node:crypto";
import { sendEmail } from "../services/email.js";

export const authRouter = Router();

// Slow down brute-force attempts against login and 2FA verification.
const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Too many attempts. Try again in a few minutes." },
});

// Emails are compared without regard to case or stray spaces: phones capitalise
// the first letter and keyboards add a trailing space.
const emailSchema = z.string().trim().toLowerCase().email("Enter a valid email address");
// 2FA codes are often shown as "123 456"; keep the digits only.
const codeSchema = z.preprocess((v) => (typeof v === "string" ? v.replace(/\D/g, "") : v), z.string().length(6, "Enter the 6-digit code"));
const findUserByEmail = (email: string) => prisma.user.findFirst({ where: { email: { equals: email, mode: "insensitive" } } });

const credentialsSchema = z.object({
  email: emailSchema,
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

  const existing = await findUserByEmail(parsed.data.email);
  if (existing) {
    return res.status(409).json({ error: "An account with that email already exists. Log in instead, or use Forgot password." });
  }

  const passwordHash = await hashPassword(parsed.data.password);
  let user;
  try {
    user = await prisma.user.create({
      data: { email: parsed.data.email, passwordHash },
    });
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
      return res.status(409).json({ error: "An account with that email already exists. Log in instead, or use Forgot password." });
    }
    console.error("[auth] Registration failed:", err);
    return res.status(500).json({ error: "We couldn't create the account just now. Please try again in a minute." });
  }

  const token = issueSessionToken(user.id);
  res.status(201).json({ token, totpEnabled: false });
});

const loginSchema = z.object({
  email: emailSchema,
  password: z.string(),
  code: codeSchema.optional(), // required once 2FA is enabled
  // From an earlier successful 2FA on this device within the last 24 hours
  // (see issueTwoFactorTrustToken) — lets the code be skipped.
  trustToken: z.string().max(2000).optional(),
});

// Whether a 2FA trust token lets this user skip the code: it must be valid
// and unexpired, belong to this user, and have been issued after their last
// password reset (resetting the password revokes trusted devices too).
function trustsDevice(user: { id: string; sessionsValidAfter: Date | null }, trustToken: string | undefined): boolean {
  if (!trustToken) return false;
  const payload = verifyTwoFactorTrustToken(trustToken);
  if (!payload || payload.sub !== user.id) return false;
  const validAfterSec = user.sessionsValidAfter ? Math.floor(user.sessionsValidAfter.getTime() / 1000) : null;
  return validAfterSec === null || (payload.iat ?? 0) >= validAfterSec;
}

// POST /auth/login - password check, then TOTP code check if 2FA is enabled.
authRouter.post("/login", loginLimiter, async (req, res) => {
  const parsed = loginSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: parsed.error.flatten() });
  }
  const { email, password, code, trustToken } = parsed.data;

  const user = await findUserByEmail(email);
  // Same error for "no such user" and "wrong password" so login can't be
  // used to enumerate whether an email is registered.
  if (!user || !(await verifyPassword(password, user.passwordHash))) {
    return res.status(401).json({ error: "Invalid email or password" });
  }

  if (user.suspendedAt) {
    return res.status(403).json({ error: SUSPENDED_MESSAGE });
  }

  // A fresh trust token is only issued when a code is actually entered, so
  // the 24 hours run from the last real 2FA check rather than sliding.
  let newTrustToken: string | undefined;
  if (user.totpEnabled) {
    if (code) {
      if (!user.totpSecret || !verifyTotpCode(user.totpSecret, code)) {
        return res.status(401).json({ error: "Invalid 2FA code" });
      }
      newTrustToken = issueTwoFactorTrustToken(user.id);
    } else if (!trustsDevice(user, trustToken)) {
      return res.status(401).json({ error: "2FA code required", requires2fa: true });
    }
  }

  const token = issueSessionToken(user.id);
  res.json({ token, totpEnabled: user.totpEnabled, trustToken: newTrustToken, trustHours: TWO_FACTOR_TRUST_HOURS });
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

const verify2faSchema = z.object({ code: codeSchema });

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
  // Setting up 2FA counts as passing it: no code needed on this device for
  // the next 24 hours.
  res.json({ totpEnabled: true, trustToken: issueTwoFactorTrustToken(user.id), trustHours: TWO_FACTOR_TRUST_HOURS });
});

// ---------------------------------------------------------------------------
// Forgotten password: email a one-time link that expires after 3 minutes.
// ---------------------------------------------------------------------------

const RESET_TTL_MINUTES = 3;
const RESET_TTL_MS = RESET_TTL_MINUTES * 60 * 1000;

const resetLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 5,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Too many reset requests. Try again in a few minutes." },
});

const resetAttemptLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 20,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Too many attempts. Try again in a few minutes." },
});

function hashResetToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

// The link always points at FRONTEND_URL, never at a URL taken from the
// request (Origin/Host headers can be forged to send the victim a link to
// an attacker's site that captures the token).
function frontendUrl(): string {
  const url = process.env.FRONTEND_URL?.trim().replace(/\/+$/, "");
  if (url) return url;
  if (process.env.NODE_ENV === "production") {
    console.error("[auth] FRONTEND_URL is not set — password reset links will point at localhost.");
  }
  return "http://localhost:5173";
}

async function sendPasswordResetEmail(email: string): Promise<void> {
  const user = await findUserByEmail(email);
  if (!user) return;

  const token = randomBytes(32).toString("base64url");
  const expiresAt = new Date(Date.now() + RESET_TTL_MS);
  // Only the newest link works: requesting another one replaces it.
  await prisma.$transaction([
    prisma.passwordResetToken.deleteMany({ where: { userId: user.id, usedAt: null } }),
    prisma.passwordResetToken.create({ data: { userId: user.id, tokenHash: hashResetToken(token), expiresAt } }),
  ]);

  const link = `${frontendUrl()}/?reset=${encodeURIComponent(token)}`;
  await sendEmail({
    to: user.email,
    subject: "Reset your Complete Fitness Coach password",
    text:
      `Someone (hopefully you) asked to reset the password for your Complete Fitness Coach account.\n\n` +
      `Open this link to choose a new password:\n${link}\n\n` +
      `The link expires in ${RESET_TTL_MINUTES} minutes and can only be used once.\n\n` +
      `If you didn't ask for this, you can ignore this email — your password won't change.`,
    html:
      `<p>Someone (hopefully you) asked to reset the password for your Complete Fitness Coach account.</p>` +
      `<p><a href="${link}" style="display:inline-block;padding:10px 16px;background:#b5442d;color:#fff;border-radius:6px;text-decoration:none">Choose a new password</a></p>` +
      `<p>Or copy this link into your browser:<br>${link}</p>` +
      `<p><strong>The link expires in ${RESET_TTL_MINUTES} minutes</strong> and can only be used once.</p>` +
      `<p>If you didn't ask for this, you can ignore this email — your password won't change.</p>`,
  });
}

const forgotPasswordSchema = z.object({ email: emailSchema });

// POST /auth/forgot-password - always gives the same answer, whether or not
// the email has an account, so it can't be used to discover who's
// registered. The lookup and email happen after responding, so response
// timing doesn't give it away either.
authRouter.post("/forgot-password", resetLimiter, async (req, res) => {
  const parsed = forgotPasswordSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: parsed.error.flatten() });
  }

  res.json({
    message: `If there's an account for that email, we've sent a link to reset the password. It expires in ${RESET_TTL_MINUTES} minutes.`,
  });

  sendPasswordResetEmail(parsed.data.email).catch((err) => {
    console.error("[auth] Failed to send password reset email:", err);
  });
});

const resetTokenSchema = z.object({ token: z.string().min(1) });

// POST /auth/reset-password/check - lets the reset page say straight away
// whether the link still works, and count down to when it expires.
authRouter.post("/reset-password/check", resetAttemptLimiter, async (req, res) => {
  const parsed = resetTokenSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: parsed.error.flatten() });
  }
  const record = await prisma.passwordResetToken.findUnique({ where: { tokenHash: hashResetToken(parsed.data.token) } });
  const msLeft = record && !record.usedAt ? record.expiresAt.getTime() - Date.now() : 0;
  // secondsLeft rather than just a timestamp, so the countdown isn't thrown
  // off by a phone whose clock is wrong.
  res.json({ valid: msLeft > 0, secondsLeft: Math.max(0, Math.floor(msLeft / 1000)) });
});

const resetPasswordSchema = z.object({
  token: z.string().min(1),
  password: z.string().min(10, "Use at least 10 characters"),
});

// POST /auth/reset-password - sets the new password if the link is still
// valid, then signs out every existing session. It doesn't log the person
// in: they log in normally afterwards, so 2FA still applies.
authRouter.post("/reset-password", resetAttemptLimiter, async (req, res) => {
  const parsed = resetPasswordSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: parsed.error.flatten() });
  }

  const now = new Date();
  const record = await prisma.passwordResetToken.findUnique({ where: { tokenHash: hashResetToken(parsed.data.token) } });
  // Claim the token atomically, so two requests racing with the same link
  // can't both succeed.
  const claimed = record
    ? await prisma.passwordResetToken.updateMany({
        where: { id: record.id, usedAt: null, expiresAt: { gt: now } },
        data: { usedAt: now },
      })
    : { count: 0 };
  if (!record || claimed.count !== 1) {
    return res.status(400).json({
      error: "This reset link has expired or has already been used. Please request a new one.",
      resetLinkInvalid: true,
    });
  }

  const passwordHash = await hashPassword(parsed.data.password);
  await prisma.$transaction([
    prisma.user.update({ where: { id: record.userId }, data: { passwordHash, sessionsValidAfter: now } }),
    prisma.passwordResetToken.deleteMany({ where: { userId: record.userId, usedAt: null } }),
  ]);

  res.json({ message: "Your password has been changed. You can now log in with your new password." });
});
