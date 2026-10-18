import { Fragment, useEffect, useState } from "react";
import { api, track, GolfWeekProposal, GolfWeekSession } from "../lib/api.js";
import { formatLocalDateKey } from "../lib/location.js";
import { formatMinutes } from "./WeeklyAvailability.js";

// Calendar card: "Plan my golf week". Proposes practice for the next 7 days
// from the notes on recent rounds, recent practice, the golf ambition and the
// time free each day. Nothing is added until the person chooses.

const TYPE_LABEL = { GOLF_RANGE: "Range", GOLF_SHORT_GAME: "Short game", GOLF_PUTTING: "Putting", GOLF_SIMULATOR: "Simulator" } as const;
const VENUE_LABEL = { RANGE: "At the range", HOME: "At home / garage", COURSE: "At the course", SIMULATOR: "Indoor simulator" } as const;
const AREA_LABEL = {
  DRIVING: "Driving",
  APPROACH: "Approach shots",
  SHORT_GAME: "Short game",
  PUTTING: "Putting",
  COURSE_MANAGEMENT: "Course management",
  OTHER: "Other",
} as const;

function dayName(key: string): string {
  const [y, m, d] = key.split("-").map(Number);
  return new Date(y, m - 1, d).toLocaleDateString(undefined, { weekday: "long", day: "numeric", month: "short" });
}

function notesFor(s: GolfWeekSession): string {
  return [`Focus: ${s.focus}`, `Where: ${VENUE_LABEL[s.venue]}`, `Why: ${s.reason}`].join("\n");
}

export default function GolfWeek({
  onAdded,
  embedded = false,
  autoStart = false,
  onClose,
  mode = "outdoor",
}: {
  mode?: "outdoor" | "simulator";
  onAdded: () => void;
  /** Inside the Calendar's Plan section: no card of its own, and a Close button. */
  embedded?: boolean;
  /** Start building the proposal as soon as it appears. */
  autoStart?: boolean;
  onClose?: () => void;
}) {
  const [proposal, setProposal] = useState<GolfWeekProposal | null>(null);
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const [adding, setAdding] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);

  useEffect(() => {
    if (autoStart) propose();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function propose() {
    setBusy(true);
    setError(null);
    setDone(null);
    try {
      const p = await api.proposeGolfWeek(formatLocalDateKey(new Date()), mode);
      setProposal(p);
      setPicked(new Set(p.sessions.map((s) => s.date)));
    } catch (e: any) {
      setError(e.message ?? "Couldn't build a golf week");
    } finally {
      setBusy(false);
    }
  }

  async function add() {
    if (!proposal) return;
    setAdding(true);
    setError(null);
    const chosen = proposal.sessions.filter((s) => picked.has(s.date));
    let added = 0;
    try {
      for (const s of chosen) {
        await api.createPlannedSession({ date: new Date(s.date).toISOString(), type: s.type, notes: notesFor(s),
          estimatedMinutes: s.minutes,
          drills: s.drills.map((d) => ({ name: d.name, club: d.club ?? null, detail: d.detail, minutes: d.minutes, done: false, comment: "" })),
        });
        added++;
      }
      track("golf_week_added");
      setDone(`Added ${added} session${added === 1 ? "" : "s"} to your calendar.`);
      setProposal(null);
    } catch (e: any) {
      setError(`${e.message ?? "Couldn't add them"}${added ? ` (${added} were added before it stopped)` : ""}`);
    } finally {
      setAdding(false);
      if (added) onAdded();
    }
  }

  function toggle(date: string) {
    setPicked((cur) => {
      const next = new Set(cur);
      next.has(date) ? next.delete(date) : next.add(date);
      return next;
    });
  }

  const Wrapper = embedded ? Fragment : "div";
  const wrapperProps = embedded ? {} : { className: "card", style: { marginBottom: 12 } };

  return (
    <Wrapper {...(wrapperProps as any)}>
      {embedded ? (
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8 }}>
          <span className="text-dim" style={{ fontSize: 12 }}>From your round notes, recent practice and the time you have free</span>
          <span style={{ display: "flex", gap: 4 }}>
            <button type="button" className="button-quiet" onClick={propose} disabled={busy || adding}>
              {busy ? "Thinking…" : "Redo"}
            </button>
            {onClose && (
              <button type="button" className="button-quiet" onClick={onClose}>
                Close
              </button>
            )}
          </span>
        </div>
      ) : (
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8 }}>
          <div>
            <strong>{mode === "simulator" ? "Simulator sessions" : "Golf practice"} for the next 7 days</strong>
            <div className="text-dim" style={{ fontSize: 12 }}>From your round notes, recent practice and the time you have free</div>
          </div>
          <button type="button" className="button-secondary" onClick={propose} disabled={busy || adding}>
            {busy ? "Thinking…" : proposal ? "Redo" : "Plan it"}
          </button>
        </div>
      )}
      {error && <p style={{ color: "var(--danger)", fontSize: 13 }}>{error}</p>}
      {done && <p style={{ fontSize: 13 }}>{done}</p>}

      {proposal && (
        <div style={{ marginTop: 10 }}>
          {proposal.caveats.map((c) => (
            <p key={c} className="text-dim" style={{ fontSize: 13, margin: "4px 0" }}>{c}</p>
          ))}
          {proposal.summary && <p style={{ fontSize: 14 }}>{proposal.summary}</p>}

          {proposal.findings.length > 0 && (
            <ul style={{ paddingLeft: 18, fontSize: 13, margin: "6px 0" }}>
              {proposal.findings.map((f, i) => (
                <li key={i}>
                  <strong>{AREA_LABEL[f.area]}:</strong> {f.finding}
                  {f.evidence && f.evidence !== "general" && <span className="text-dim"> — “{f.evidence}”</span>}
                </li>
              ))}
            </ul>
          )}

          {proposal.sessions.map((s) => (
            <div key={s.date} style={{ borderTop: "1px solid var(--surface-2)", padding: "10px 0" }}>
              <label style={{ display: "flex", gap: 8, alignItems: "flex-start", cursor: "pointer" }}>
                <input type="checkbox" checked={picked.has(s.date)} onChange={() => toggle(s.date)} style={{ marginTop: 3 }} />
                <span style={{ flex: 1 }}>
                  <strong>{dayName(s.date)}</strong> · {TYPE_LABEL[s.type]} · {formatMinutes(s.minutes)}{" "}
                  <span className="chip">{VENUE_LABEL[s.venue]}</span>
                  <div style={{ fontSize: 13, marginTop: 2 }}>{s.focus}</div>
                </span>
              </label>
              <ol style={{ margin: "6px 0 0 26px", paddingLeft: 16, fontSize: 13 }}>
                {s.drills.map((d, i) => (
                  <li key={i}>
                    <strong>{d.club ? `${d.club}: ` : ""}{d.name}</strong> ({d.minutes} min) — {d.detail}
                  </li>
                ))}
              </ol>
              <div className="text-dim" style={{ fontSize: 12, margin: "4px 0 0 26px" }}>{s.reason}</div>
            </div>
          ))}

          {proposal.sessions.length > 0 && (
            <button type="button" className="button-primary" onClick={add} disabled={adding || picked.size === 0}>
              {adding ? "Adding…" : `Add ${picked.size} to my calendar`}
            </button>
          )}
        </div>
      )}
    </Wrapper>
  );
}
