// "Don't ask for a 2FA code on this device for 24 hours."
//
// After a 2FA code is accepted, the backend returns a signed trust token
// (see backend/src/services/auth.ts). It's kept here in a cookie that the
// browser deletes after 24 hours, and sent with the next login so the code
// can be skipped. The password is always still required.
//
// Why a cookie set by the page rather than one set by the backend: the
// frontend and backend live on different domains, so a backend cookie would
// be a third-party cookie, which Safari (and increasingly other browsers)
// block by default. This one belongs to the app's own domain. It never
// grants a session by itself, can't be used as a session token, and a
// password reset revokes it.

const COOKIE = "fc_2fa_trust";

export function getTwoFactorTrust(): string | undefined {
  const match = document.cookie.split("; ").find((c) => c.startsWith(`${COOKIE}=`));
  return match ? decodeURIComponent(match.slice(COOKIE.length + 1)) : undefined;
}

export function setTwoFactorTrust(token: string, hours: number) {
  const secure = window.location.protocol === "https:" ? "; Secure" : "";
  document.cookie = `${COOKIE}=${encodeURIComponent(token)}; Max-Age=${Math.round(hours * 3600)}; Path=/; SameSite=Strict${secure}`;
}

export function clearTwoFactorTrust() {
  document.cookie = `${COOKIE}=; Max-Age=0; Path=/; SameSite=Strict`;
}
