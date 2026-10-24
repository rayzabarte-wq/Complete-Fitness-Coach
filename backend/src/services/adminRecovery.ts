import { createHash } from "node:crypto";
import { prisma } from "../lib/prisma.js";
import { isAdminEmail } from "../lib/requireAdmin.js";

// Recovery for the owner when the authenticator phone is lost. Admin accounts
// can't have 2FA turned off from inside the app (the admin area needs it, and
// nobody can act on an admin account from the Admin page), so the way back is
// through whoever controls the server settings, the same people who decide who
// is an admin at all (ADMIN_EMAILS).
//
// Set ADMIN_2FA_RESET on the backend service to "<admin email>:<any note>",
// for example "ray@example.com:lost-phone-oct-2026", and redeploy. On start-up
// that account's 2FA is switched off and its sessions and trusted devices are
// signed out. Each distinct value works once, so leaving the setting in place
// does not keep switching 2FA off whenever the server restarts. To do it again,
// change the note. The person then logs in with just the password (use
// "Forgot password" first if that is lost too) and turns 2FA back on in
// Settings → Security.
export async function applyAdminRecovery(): Promise<void> {
  const raw = (process.env.ADMIN_2FA_RESET ?? "").trim();
  if (!raw) return;
  const email = raw.split(":")[0].trim().toLowerCase();
  if (!email || !isAdminEmail(email)) {
    console.warn("[recovery] ADMIN_2FA_RESET ignored: the email before the colon must be one of ADMIN_EMAILS");
    return;
  }
  const valueHash = createHash("sha256").update(raw).digest("hex").slice(0, 16);
  const done = await prisma.adminAuditLog.findFirst({ where: { action: "reset-2fa-env", targetEmail: email, detail: valueHash } });
  if (done) return;
  const user = await prisma.user.findFirst({ where: { email: { equals: email, mode: "insensitive" } } });
  if (!user) {
    console.warn("[recovery] ADMIN_2FA_RESET ignored: no account with that email");
    return;
  }
  await prisma.user.update({ where: { id: user.id }, data: { totpEnabled: false, totpSecret: null, sessionsValidAfter: new Date() } });
  await prisma.adminAuditLog.create({ data: { adminEmail: "server setting", action: "reset-2fa-env", targetEmail: email, detail: valueHash } });
  console.log(`[recovery] 2FA switched off for ${email}. Remove ADMIN_2FA_RESET when you are back in.`);
}
