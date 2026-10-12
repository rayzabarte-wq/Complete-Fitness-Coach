import { useEffect, useState } from "react";
import { api, Sport, Dashboard, PeriodDashboard, SportReport, SessionType } from "../lib/api.js";
import { formatLocalDateKey } from "../lib/location.js";
import { fullLabelFor } from "../lib/sessionTypes.js";

const SPORT_LABELS: Record<Sport, string> = {
  STRENGTH: "Strength",
  GOLF: "Golf",
  RUN: "Run",
  WALK: "Walk",
  CYCLING: "Cycling",
  CYCLING_TURBO: "Cycling - Turbo",
  SWIM: "Swim",
};

const MOVEMENT_PATTERN_LABELS: Record<string, string> = { PUSH: "Push", PULL: "Pull", LEGS: "Legs", CORE: "Core" };

function subTypeLabel(sport: Sport, key: string): string {
  if (key === "UNSPECIFIED") return "Unspecified";
  if (sport === "STRENGTH") return MOVEMENT_PATTERN_LABELS[key] ?? key;
  return fullLabelFor(key as SessionType).replace(`${SPORT_LABELS[sport]} - `, "");
}

function formatHoursMinutes(totalMinutes: number): string {
  const h = Math.floor(totalMinutes / 60);
  const m = totalMinutes % 60;
  if (h === 0) return `${m}m`;
  if (m === 0) return `${h}h`;
  return `${h}h ${m}m`;
}

function consistencyLabel(percent: number | null): string {
  if (percent === null) return "No plan data";
  if (percent >= 90) return "Excellent";
  if (percent >= 70) return "Good";
  if (percent >= 50) return "Building";
  return "Needs attention";
}

function consistencyColor(percent: number | null): string {
  if (percent === null) return "var(--text-dim)";
  if (percent >= 70) return "var(--accent)";
  if (percent >= 50) return "#d8b355";
  return "var(--danger)";
}

export default function PlanDashboard({ planId }: { planId: string }) {
  const [dashboard, setDashboard] = useState<Dashboard | null | undefined>(undefined);
  const [error, setError] = useState<string | null>(null);
  const [view, setView] = useState<"current" | "original">("current");

  useEffect(() => {
    api
      .getDashboard(planId, formatLocalDateKey(new Date()))
      .then(setDashboard)
      .catch((err) => setError(err instanceof Error ? err.message : "Failed to load the dashboard"));
  }, [planId]);

  if (error) {
    return (
      <div className="card">
        <p className="text-dim" style={{ fontSize: 13, margin: 0 }}>{error}</p>
      </div>
    );
  }

  if (dashboard === undefined) {
    return <p className="text-dim">Loading dashboard...</p>;
  }

  if (dashboard === null) {
    return <p className="text-dim">No dashboard data yet.</p>;
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      {dashboard.hasAmendments && (
        <div className="card" style={{ display: "flex", gap: 8 }}>
          <ToggleButton active={view === "current"} onClick={() => setView("current")} label="Against amended plan" />
          <ToggleButton active={view === "original"} onClick={() => setView("original")} label="As originally planned" />
        </div>
      )}

      <PeriodCard period={dashboard.week} view={view} />
      <PeriodCard period={dashboard.month} view={view} />
    </div>
  );
}

function ToggleButton({ active, onClick, label }: { active: boolean; onClick: () => void; label: string }) {
  return (
    <button
      onClick={onClick}
      style={{
        flex: 1,
        background: active ? "var(--accent)" : "transparent",
        color: active ? "var(--on-accent)" : "var(--text)",
        border: active ? "none" : "1px solid var(--border)",
        borderRadius: 8,
        padding: "8px 10px",
        fontSize: 12,
        fontWeight: 600,
        cursor: "pointer",
      }}
    >
      {label}
    </button>
  );
}

function PeriodCard({ period, view }: { period: PeriodDashboard; view: "current" | "original" }) {
  const report = (view === "original" && period.original) || period.current;

  return (
    <div className="card">
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
        <strong>{period.label}</strong>
        <span className="text-dim" style={{ fontSize: 11 }}>
          {period.from} – {period.to}
        </span>
      </div>

      <div style={{ display: "flex", alignItems: "baseline", gap: 10, marginTop: 10 }}>
        <span style={{ fontSize: 32, fontWeight: 700, color: consistencyColor(report.consistencyPercent) }}>
          {report.consistencyPercent === null ? "–" : `${report.consistencyPercent}%`}
        </span>
        <div>
          <div style={{ fontSize: 13, fontWeight: 600 }}>{consistencyLabel(report.consistencyPercent)}</div>
          <div className="text-dim" style={{ fontSize: 12 }}>
            {report.totalCompleted}/{report.totalPlanned} sessions · {formatHoursMinutes(report.totalCompletedMinutes)} completed
          </div>
        </div>
      </div>

      {report.bySport.length === 0 ? (
        <p className="text-dim" style={{ fontSize: 12, marginTop: 12, marginBottom: 0 }}>
          Nothing planned or logged in this period yet.
        </p>
      ) : (
        <div style={{ marginTop: 14, display: "flex", flexDirection: "column", gap: 10 }}>
          {report.bySport.map((s) => (
            <SportRow key={s.sport} sportReport={s} />
          ))}
        </div>
      )}
    </div>
  );
}

function SportRow({ sportReport }: { sportReport: SportReport }) {
  const [expanded, setExpanded] = useState(false);
  const hasSubTypes = sportReport.subTypes.length > 0;

  return (
    <div style={{ borderTop: "1px solid var(--border)", paddingTop: 10 }}>
      <div
        style={{ display: "flex", justifyContent: "space-between", alignItems: "center", cursor: hasSubTypes ? "pointer" : "default" }}
        onClick={() => hasSubTypes && setExpanded((e) => !e)}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
          <strong style={{ fontSize: 14 }}>{SPORT_LABELS[sportReport.sport]}</strong>
          {hasSubTypes && <span className="text-dim" style={{ fontSize: 11 }}>{expanded ? "▲" : "▼"}</span>}
        </div>
        <div style={{ textAlign: "right" }}>
          <div style={{ fontSize: 13, color: consistencyColor(sportReport.consistencyPercent) }}>
            {sportReport.completedCount}/{sportReport.plannedCount}
            {sportReport.consistencyPercent !== null ? ` (${sportReport.consistencyPercent}%)` : ""}
          </div>
          <div className="text-dim" style={{ fontSize: 11 }}>{formatHoursMinutes(sportReport.completedMinutes)}</div>
        </div>
      </div>

      {expanded && (
        <div style={{ marginTop: 8, paddingLeft: 12, display: "flex", flexDirection: "column", gap: 6 }}>
          {sportReport.subTypes.map((st) => (
            <div key={st.key} style={{ display: "flex", justifyContent: "space-between", fontSize: 12 }}>
              <span className="text-dim">{subTypeLabel(sportReport.sport, st.key)}</span>
              <span>
                {st.completedCount}/{st.plannedCount} · {formatHoursMinutes(st.completedMinutes)}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
