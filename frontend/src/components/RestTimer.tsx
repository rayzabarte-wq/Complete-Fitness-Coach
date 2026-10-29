import { useEffect, useRef, useState } from "react";

// A rest countdown for strength sets. It stores the moment it should end, not
// a counter, so it stays right if the phone sleeps or the app is backgrounded.

export interface RestState {
  endsAt: number; // ms since epoch
  total: number; // seconds, for the progress bar
  label: string;
}

const AUTO_KEY = "restTimerAuto";

export function readAutoStart(): boolean {
  try {
    return localStorage.getItem(AUTO_KEY) !== "off";
  } catch {
    return true;
  }
}

export function writeAutoStart(on: boolean) {
  try {
    localStorage.setItem(AUTO_KEY, on ? "on" : "off");
  } catch {
    // Not remembered; fine.
  }
}

let audioCtx: AudioContext | null = null;

/** Call from a tap so iOS allows sound later. */
export function primeAudio() {
  try {
    const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctor) return;
    audioCtx = audioCtx ?? new Ctor();
    if (audioCtx.state === "suspended") void audioCtx.resume();
  } catch {
    // No sound; the vibration and the on-screen change still work.
  }
}

function beep() {
  try {
    if (navigator.vibrate) navigator.vibrate([200, 100, 200]);
  } catch {
    // ignore
  }
  try {
    if (!audioCtx) return;
    for (let i = 0; i < 3; i++) {
      const osc = audioCtx.createOscillator();
      const gain = audioCtx.createGain();
      osc.frequency.value = 880;
      gain.gain.value = 0.15;
      osc.connect(gain).connect(audioCtx.destination);
      const t = audioCtx.currentTime + i * 0.25;
      osc.start(t);
      osc.stop(t + 0.15);
    }
  } catch {
    // ignore
  }
}

function fmt(sec: number): string {
  const s = Math.max(0, Math.ceil(sec));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

export default function RestTimer({
  rest,
  onChange,
  onDismiss,
}: {
  rest: RestState;
  onChange: (next: RestState) => void;
  onDismiss: () => void;
}) {
  const [now, setNow] = useState(Date.now());
  const doneFor = useRef<number | null>(null);

  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), 250);
    const onVisible = () => setNow(Date.now());
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      window.clearInterval(id);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, []);

  const left = (rest.endsAt - now) / 1000;
  const done = left <= 0;

  useEffect(() => {
    if (done && doneFor.current !== rest.endsAt) {
      doneFor.current = rest.endsAt;
      beep();
    }
  }, [done, rest.endsAt]);

  const adjust = (delta: number) => onChange({ ...rest, endsAt: rest.endsAt + delta * 1000, total: Math.max(rest.total, rest.total + delta) });
  const pct = done ? 100 : Math.min(100, Math.max(0, (1 - left / rest.total) * 100));

  return (
    <div
      role="timer"
      aria-live="off"
      style={{
        position: "fixed",
        left: 12,
        right: 12,
        bottom: "calc(64px + env(safe-area-inset-bottom))",
        zIndex: 20,
        background: done ? "var(--good)" : "var(--navy)",
        color: "var(--on-navy)",
        borderRadius: 12,
        padding: "10px 12px",
        boxShadow: "0 4px 16px rgba(0,0,0,0.25)",
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 12, opacity: 0.85, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
            {done ? "Rest over. Next set" : `Rest · ${rest.label}`}
          </div>
          <div style={{ fontSize: 28, fontWeight: 700, fontVariantNumeric: "tabular-nums", lineHeight: 1.1 }}>{done ? "Go" : fmt(left)}</div>
        </div>
        {!done && (
          <>
            <button className="button-quiet" style={{ color: "inherit" }} aria-label="15 seconds less" onClick={() => adjust(-15)}>
              −15s
            </button>
            <button className="button-quiet" style={{ color: "inherit" }} aria-label="15 seconds more" onClick={() => adjust(15)}>
              +15s
            </button>
          </>
        )}
        <button className="button-quiet" style={{ color: "inherit", fontWeight: 600 }} onClick={onDismiss}>
          {done ? "Done" : "Skip"}
        </button>
      </div>
      <div style={{ height: 4, borderRadius: 2, background: "rgba(255,255,255,0.3)", marginTop: 8 }}>
        <div style={{ height: 4, borderRadius: 2, width: `${pct}%`, background: "var(--on-navy)", transition: "width 0.25s linear" }} />
      </div>
    </div>
  );
}
