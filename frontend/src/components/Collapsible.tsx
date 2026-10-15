import { ReactNode, useState } from "react";

// A section that starts closed and opens with a tap on its header (used by
// Settings and Progress). The body stays mounted while closed, so a form
// isn't lost by collapsing it and a section's data is ready when opened.
//
// - id: a link to #<id> opens it (Settings uses this for #privacy, #import).
// - hint: a short summary beside the title, so a closed section still says
//   something ("2 active", "6 lifts").
// - rememberAs: remembers on this device whether you left it open or closed.
//   Only used where the section is something you check regularly.
// - defaultOpen: whether it starts open when you've never chosen either way.
//   Once you open or close it yourself, that choice wins.
export default function Collapsible({
  title,
  id,
  hint,
  rememberAs,
  defaultOpen = false,
  children,
}: {
  title: string;
  id?: string;
  hint?: string;
  rememberAs?: string;
  defaultOpen?: boolean;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(() => {
    if (id && window.location.hash === `#${id}`) return true;
    if (rememberAs) {
      try {
        const stored = localStorage.getItem(`section_open:${rememberAs}`);
        if (stored === "1") return true;
        if (stored === "0") return false;
      } catch {
        // fall through to the default
      }
    }
    return defaultOpen;
  });
  const bodyId = `section-${(rememberAs ?? title).toLowerCase().replace(/[^a-z0-9]+/g, "-")}`;

  function toggle() {
    const next = !open;
    setOpen(next);
    if (rememberAs) {
      try {
        localStorage.setItem(`section_open:${rememberAs}`, next ? "1" : "0");
      } catch {
        // per-device convenience only
      }
    }
  }

  return (
    <div id={id}>
      <button type="button" className="section-toggle" aria-expanded={open} aria-controls={bodyId} onClick={toggle}>
        <span>{title}</span>
        <span style={{ display: "flex", alignItems: "center", gap: 8 }}>
          {hint && (
            <span style={{ fontSize: 12, fontWeight: 400, letterSpacing: 0, textTransform: "none", color: "var(--text-dim)" }}>{hint}</span>
          )}
          <span aria-hidden="true" className="section-chevron" style={{ transform: open ? "rotate(90deg)" : "none" }}>
            ›
          </span>
        </span>
      </button>
      <div id={bodyId} hidden={!open}>
        {children}
      </div>
    </div>
  );
}
