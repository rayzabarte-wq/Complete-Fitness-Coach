import { ReactNode } from "react";
import Collapsible from "./Collapsible.js";

// The Calendar's "Plan" section: one place to plan any kind of workout. Each
// workout type is a Planner, a row with a title, a line on what it does and a
// button; whatever it produces (a result, a proposal to review) opens beneath
// its row. To add a type, add a planner to the list built in the Calendar.

export interface Planner {
  key: string;
  title: string;
  /** One line on what pressing the button does. */
  blurb: string;
  buttonLabel: string;
  onPress: () => void;
  busy?: boolean;
  /** Shown under the row, e.g. a result or a proposal. */
  body?: ReactNode;
}

export default function PlanPanel({ planners }: { planners: Planner[] }) {
  if (planners.length === 0) return null;
  return (
    <Collapsible title="Plan" id="plan" hint={planners.map((p) => p.title.toLowerCase()).join(", ")} rememberAs="calendar-plan">
      {planners.map((p, i) => (
        <div key={p.key} style={{ padding: "10px 0", borderTop: i === 0 ? undefined : "1px solid var(--border)" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <div style={{ flex: 1, minWidth: 0 }}>
              <strong style={{ fontSize: 14 }}>{p.title}</strong>
              <div className="text-dim" style={{ fontSize: 12, marginTop: 2 }}>{p.blurb}</div>
            </div>
            <button type="button" className="button-primary" onClick={p.onPress} disabled={p.busy} style={{ whiteSpace: "nowrap" }}>
              {p.busy ? "Planning…" : p.buttonLabel}
            </button>
          </div>
          {p.body && <div style={{ marginTop: 8 }}>{p.body}</div>}
        </div>
      ))}
    </Collapsible>
  );
}
