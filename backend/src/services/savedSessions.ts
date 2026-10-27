// Helpers for the library of saved rehab / own sessions (routes/savedSessions.ts).

export const MAX_SAVED_SESSIONS = 100;

/** Names are compared ignoring case and surrounding spaces. */
export const nameKey = (name: string) => name.trim().toLowerCase();

/** "Name (copy)", then "Name (copy 2)", and so on, skipping names already taken. */
export function copyName(base: string, taken: Iterable<string>): string {
  const used = new Set([...taken].map(nameKey));
  const root = base.trim().replace(/\s+\(copy(?: \d+)?\)$/i, "").slice(0, 70);
  let candidate = `${root} (copy)`;
  for (let n = 2; used.has(nameKey(candidate)); n++) candidate = `${root} (copy ${n})`;
  return candidate;
}
