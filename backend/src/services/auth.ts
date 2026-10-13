import bcrypt from "bcrypt";
import jwt from "jsonwebtoken";
import { authenticator } from "otplib";

const secret = process.env.JWT_SECRET;
if (!secret) {
  throw new Error("JWT_SECRET is not set — generate one and add it to .env before starting the server");
}
const JWT_SECRET: string = secret;

const SESSION_TTL = "12h";

export async function hashPassword(password: string): Promise<string> {
  return bcrypt.hash(password, 12);
}

export async function verifyPassword(password: string, hash: string): Promise<boolean> {
  return bcrypt.compare(password, hash);
}

export function generateTotpSecret(): string {
  return authenticator.generateSecret();
}

export function totpKeyUri(email: string, secret: string): string {
  return authenticator.keyuri(email, "Strength App", secret);
}

export function verifyTotpCode(secret: string, code: string): boolean {
  return authenticator.verify({ token: code, secret });
}

export function issueSessionToken(userId: string): string {
  return jwt.sign({ sub: userId }, JWT_SECRET, { expiresIn: SESSION_TTL });
}

export function verifySessionToken(token: string): { sub: string; iat?: number } | null {
  try {
    const payload = jwt.verify(token, JWT_SECRET) as { sub: string; iat?: number; aud?: unknown };
    // A 2FA trust token (below) is signed with the same secret but is not a
    // session — never accept one here.
    if (payload.aud !== undefined) return null;
    return payload;
  } catch {
    return null;
  }
}

// "Trust this device for 24 hours" after a successful 2FA code: a signed
// token the frontend keeps in a first-party cookie that expires after 24
// hours, and sends with the next login so the 6-digit code can be skipped
// (the password is still required). Its own audience means it can't be used
// as a session token, and a session token can't be used as one of these.
const TWO_FACTOR_TRUST_AUDIENCE = "2fa-trust";
export const TWO_FACTOR_TRUST_HOURS = 24;

export function issueTwoFactorTrustToken(userId: string): string {
  return jwt.sign({ sub: userId }, JWT_SECRET, {
    expiresIn: `${TWO_FACTOR_TRUST_HOURS}h`,
    audience: TWO_FACTOR_TRUST_AUDIENCE,
  });
}

export function verifyTwoFactorTrustToken(token: string): { sub: string; iat?: number } | null {
  try {
    return jwt.verify(token, JWT_SECRET, { audience: TWO_FACTOR_TRUST_AUDIENCE }) as { sub: string; iat?: number };
  } catch {
    return null;
  }
}
