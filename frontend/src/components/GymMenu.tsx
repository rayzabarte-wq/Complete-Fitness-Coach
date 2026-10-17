import { useEffect, useRef, useState } from "react";
import { useGyms } from "../lib/gymContext.js";
import { GYM_KIND_LABEL } from "../lib/equipment.js";
import type { GymKind } from "../lib/equipment.js";

// The gym button in the header, left of the settings gear: shows where you're
// training and opens a drop-down to switch between Home, Regular and Visiting.
// Only shown on strength screens (see useShowGymMenu in lib/gymContext.tsx).

const SHORT_LABEL: Record<GymKind, string> = { HOME: "Home", PUBLIC_GYM: "Gym", VISITING: "Visiting" };

export default function GymMenu() {
  const { gyms, activeGymId, chooseGym, refresh, showMenu } = useGyms();
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function onPointerDown(e: PointerEvent) {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setOpen(false);
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  if (!showMenu || gyms.length === 0) return null;
  const current = gyms.find((g) => g.id === activeGymId) ?? gyms[0];

  return (
    <div ref={wrapRef} style={{ position: "relative" }}>
      <button
        type="button"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label={`Training at ${current.name}. Change gym`}
        onClick={() => {
          if (!open) refresh(); // picks up a rename made in Settings
          setOpen((o) => !o);
        }}
        style={{
          display: "flex",
          alignItems: "center",
          gap: 5,
          background: "rgba(255,255,255,0.14)",
          border: "1px solid rgba(255,255,255,0.3)",
          color: "var(--on-navy)",
          borderRadius: 999,
          padding: "5px 10px",
          fontSize: 13,
          fontWeight: 600,
          cursor: "pointer",
          whiteSpace: "nowrap",
        }}
      >
        <PinIcon />
        {SHORT_LABEL[current.kind]}
        <span aria-hidden="true" style={{ fontSize: 10, opacity: 0.85 }}>
          ▾
        </span>
      </button>

      {open && (
        <div
          role="listbox"
          aria-label="Where are you training?"
          style={{
            position: "absolute",
            right: 0,
            top: "calc(100% + 8px)",
            minWidth: 220,
            background: "var(--surface)",
            color: "var(--text)",
            border: "1px solid var(--border)",
            borderRadius: 12,
            boxShadow: "0 8px 24px rgba(0,0,0,0.25)",
            padding: 6,
            zIndex: 20,
          }}
        >
          <div className="text-dim" style={{ fontSize: 11, padding: "4px 8px 6px" }}>
            Where are you training? Workouts only use that gym's equipment.
          </div>
          {gyms.map((g) => {
            const selected = g.id === current.id;
            return (
              <button
                key={g.id}
                type="button"
                role="option"
                aria-selected={selected}
                onClick={() => {
                  chooseGym(g.id);
                  setOpen(false);
                }}
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "center",
                  gap: 8,
                  width: "100%",
                  textAlign: "left",
                  background: selected ? "var(--surface-2)" : "transparent",
                  color: "var(--text)",
                  border: "none",
                  borderRadius: 8,
                  padding: "9px 8px",
                  cursor: "pointer",
                }}
              >
                <span>
                  <span style={{ display: "block", fontWeight: 600, fontSize: 14 }}>{GYM_KIND_LABEL[g.kind]}</span>
                  <span className="text-dim" style={{ display: "block", fontSize: 12 }}>
                    {g.name}
                  </span>
                </span>
                {selected && (
                  <span aria-hidden="true" style={{ color: "var(--accent)", fontWeight: 700 }}>
                    ✓
                  </span>
                )}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

function PinIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M12 21s-7-6.2-7-11.5A7 7 0 0 1 19 9.5C19 14.8 12 21 12 21z" />
      <circle cx="12" cy="9.5" r="2.5" />
    </svg>
  );
}
