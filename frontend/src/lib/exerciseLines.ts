import type { PlannedDrill } from "./api.js";

// A rehab or own session's exercises are typed or pasted one per line, the way
// a physio sheet lists them: "Clamshells — 3 x 12 each side". The text before
// the first " — ", " - " or ": " is the exercise, the rest is how to do it.

export const MAX_EXERCISES = 20;

export function parseExerciseLines(text: string, previous: PlannedDrill[] = []): PlannedDrill[] {
  const lines = text
    .split(/\r?\n/)
    .map((l) => l.replace(/^\s*(?:[-*•]|\d+[.)])\s+/, "").trim())
    .filter(Boolean)
    .slice(0, MAX_EXERCISES);
  return lines.map((line) => {
    const m = line.match(/^(.*?)(?:\s+[—–-]\s+|:\s+)(.+)$/);
    const name = (m ? m[1] : line).trim().slice(0, 80);
    const detail = (m ? m[2] : "").trim().slice(0, 400);
    // Editing the list keeps what was already ticked or commented on.
    const before = previous.find((p) => p.name.toLowerCase() === name.toLowerCase());
    return { name, detail, minutes: 0, done: before?.done ?? false, comment: before?.comment ?? "" };
  });
}

export function drillsToLines(drills: { name: string; detail?: string }[] | null | undefined): string {
  return (drills ?? []).map((d) => (d.detail ? `${d.name} — ${d.detail}` : d.name)).join("\n");
}
