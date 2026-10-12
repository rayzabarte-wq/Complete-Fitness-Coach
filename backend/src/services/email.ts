// Outgoing email, sent through Resend's HTTP API (https://resend.com) rather
// than SMTP: Railway's Hobby plan blocks outbound SMTP, and an HTTP call
// needs no extra dependency.
//
// Configuration (backend/.env or Railway variables):
// - RESEND_API_KEY: from resend.com → API Keys. Without it, emails aren't
//   sent; their contents are written to the server log instead, so local
//   development and testing still work (copy the link from the log).
// - EMAIL_FROM: the sender, e.g. "Fitness Coach <coach@yourdomain.com>".
//   Defaults to Resend's shared test sender, which can only deliver to the
//   email address you signed up to Resend with — verify your own domain in
//   Resend to send to anyone else.

const DEFAULT_FROM = "Complete Fitness Coach <onboarding@resend.dev>";

export interface Email {
  to: string;
  subject: string;
  text: string;
  html: string;
}

export async function sendEmail(email: Email): Promise<void> {
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) {
    console.warn(
      `[email] RESEND_API_KEY is not set, so this email was NOT sent. Contents:\n` +
        `  To: ${email.to}\n  Subject: ${email.subject}\n\n${email.text}\n`
    );
    return;
  }

  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      from: process.env.EMAIL_FROM || DEFAULT_FROM,
      to: [email.to],
      subject: email.subject,
      text: email.text,
      html: email.html,
    }),
  });
  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    throw new Error(`Resend rejected the email (${res.status}): ${detail}`);
  }
}
