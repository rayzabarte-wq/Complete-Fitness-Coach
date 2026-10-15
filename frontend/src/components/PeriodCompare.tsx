import { useEffect, useState } from "react";
import { formatLocalDateKey } from "../lib/location.js";

// Period-on-period comparison, the same control on every Progress sub-tab:
// pick two periods, see each number now vs then with the difference and an
// up/down arrow. Plain numbers rather than a chart.

export interface Range {
  /** Inclusive local day key. */
  from: string;
  /** Exclusive local day key. */
  to: string;
  label: string;
}

export interface CompareRow {
  label: string;
  current: number | null;
  previous: number | null;
  unit?: string;
  /** Which direction counts as progress, so the arrow can be coloured for
   * meaning. "neutral" = no judgement (e.g. body weight with no goal). */
  betterWhen: "up" | "down" | "neutral";
  decimals?: number;
}

type PresetKey = "7d" | "30d" | "month" | "quarter" | "custom";

const PRESETS: { key: PresetKey; label: string }[] = [
  { key: "7d", label: "Last 7 days vs 7 before" },
  { key: "30d", label: "Last 30 days vs 30 before" },
  { key: "month", label: "This month vs last month" },
  { key: "quarter", label: "This quarter vs last quarter" },
  { key: "custom", label: "Custom periods" },
];

function addDays(d: Date, n: number): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate() + n);
}

export function presetRanges(key: Exclude<PresetKey, "custom">, today = new Date()): [Range, Range] {
  const t = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  const tomorrow = addDays(t, 1);
  const k = formatLocalDateKey;
  if (key === "7d" || key === "30d") {
    const n = key === "7d" ? 7 : 30;
    const aFrom = addDays(tomorrow, -n);
    const bFrom = addDays(aFrom, -n);
    return [
      { from: k(aFrom), to: k(tomorrow), label: `Last ${n} days` },
      { from: k(bFrom), to: k(aFrom), label: `${n} days before` },
    ];
  }
  if (key === "month") {
    const aFrom = new Date(t.getFullYear(), t.getMonth(), 1);
    const bFrom = new Date(t.getFullYear(), t.getMonth() - 1, 1);
    const name = (d: Date) => d.toLocaleDateString(undefined, { month: "long" });
    return [
      { from: k(aFrom), to: k(tomorrow), label: `${name(aFrom)} so far` },
      { from: k(bFrom), to: k(aFrom), label: name(bFrom) },
    ];
  }
  const q = Math.floor(t.getMonth() / 3);
  const aFrom = new Date(t.getFullYear(), q * 3, 1);
  const bFrom = new Date(t.getFullYear(), q * 3 - 3, 1);
  return [
    { from: k(aFrom), to: k(tomorrow), label: "This quarter so far" },
    { from: k(bFrom), to: k(aFrom), label: "Last quarter" },
  ];
}

function fmt(v: number, decimals: number): string {
  return v.toLocaleString(undefined, { maximumFractionDigits: decimals, minimumFractionDigits: 0 });
}

export function DeltaRow({ row }: { row: CompareRow }) {
  const d = row.decimals ?? 0;
  const unit = row.unit ?? "";
  const hasBoth = row.current != null && row.previous != null;
  const delta = hasBoth ? row.current! - row.previous! : null;
  const rounded = delta != null ? Math.round(delta * 10 ** d) / 10 ** d : null;
  const dir = rounded == null || rounded === 0 ? "flat" : rounded > 0 ? "up" : "down";
  const good = row.betterWhen === "neutral" || dir === "flat" ? null : (dir === "up") === (row.betterWhen === "up");
  const color = good === null ? "var(--text-dim)" : good ? "var(--good)" : "var(--bad)";
  const arrow = dir === "up" ? "▲" : dir === "down" ? "▼" : "■";
  const word = dir === "flat" ? "no change" : `${dir === "up" ? "up" : "down"} ${fmt(Math.abs(rounded!), d)}${unit}`;

  return (
    <div style={{ display: "grid", gridTemplateColumns: "1fr auto", gap: 8, padding: "8px 0", borderTop: "1px solid var(--border)", alignItems: "center" }}>
      <div>
        <div style={{ fontSize: 14, fontWeight: 600 }}>{row.label}</div>
        <div className="text-dim" style={{ fontSize: 12 }}>
          {row.current != null ? `${fmt(row.current, d)}${unit}` : "—"}
          {", "}
          {row.previous != null ? `from ${fmt(row.previous, d)}${unit}` : "no data before"}
        </div>
      </div>
      {hasBoth ? (
        <div style={{ textAlign: "right", fontSize: 13, fontWeight: 700, color }} aria-label={word}>
          <span aria-hidden="true" style={{ marginRight: 4 }}>
            {arrow}
          </span>
          {word}
        </div>
      ) : (
        <span className="text-dim" style={{ fontSize: 12 }}>
          —
        </span>
      )}
    </div>
  );
}

export default function PeriodCompare({
  title = "Compare periods",
  hideTitle = false,
  load,
  reloadKey,
}: {
  title?: string;
  /** Leave the title out when a collapsible header above already says it. */
  hideTitle?: boolean;
  load: (current: Range, previous: Range) => Promise<CompareRow[]>;
  /** Change it to force a reload when the parent's data changes. */
  reloadKey?: unknown;
}) {
  const [preset, setPreset] = useState<PresetKey>("30d");
  const [custom, setCustom] = useState<[Range, Range]>(() => presetRanges("30d"));
  const [rows, setRows] = useState<CompareRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const ranges = preset === "custom" ? custom : presetRanges(preset);

  useEffect(() => {
    let cancelled = false;
    setRows(null);
    setError(null);
    load(ranges[0], ranges[1])
      .then((r) => !cancelled && setRows(r))
      .catch((e) => !cancelled && setError(e.message ?? "Failed to load"));
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [preset, JSON.stringify(custom), reloadKey]);

  return (
    <div className="card" style={{ marginTop: 12 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8 }}>
        {!hideTitle && <strong style={{ color: "var(--navy)" }}>{title}</strong>}
        <select
          value={preset}
          onChange={(e) => setPreset(e.target.value as PresetKey)}
          style={{ padding: "4px 6px", ...(hideTitle ? { width: "100%" } : { maxWidth: "62%" }) }}
          aria-label="Periods to compare"
        >
          {PRESETS.map((p) => (
            <option key={p.key} value={p.key}>
              {p.label}
            </option>
          ))}
        </select>
      </div>

      {preset === "custom" && (
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 6, marginTop: 8, fontSize: 12 }}>
          {(["This period", "Compared with"] as const).map((label, i) => (
            <div key={label}>
              <div className="text-dim" style={{ marginBottom: 2 }}>
                {label}
              </div>
              <input
                type="date"
                aria-label={`${label} start`}
                value={custom[i].from}
                onChange={(e) => {
                  const next = [...custom] as [Range, Range];
                  next[i] = { ...next[i], from: e.target.value };
                  setCustom(next);
                }}
                style={{ width: "100%", padding: 4 }}
              />
              <input
                type="date"
                aria-label={`${label} end`}
                value={formatLocalDateKey(addDays(new Date(custom[i].to + "T00:00"), -1))}
                onChange={(e) => {
                  const next = [...custom] as [Range, Range];
                  next[i] = { ...next[i], to: formatLocalDateKey(addDays(new Date(e.target.value + "T00:00"), 1)) };
                  setCustom(next);
                }}
                style={{ width: "100%", padding: 4, marginTop: 4 }}
              />
            </div>
          ))}
        </div>
      )}

      <div className="text-dim" style={{ fontSize: 12, margin: "8px 0 2px" }}>
        {preset === "custom" ? "Your two chosen periods" : `${ranges[0].label} vs ${ranges[1].label.toLowerCase()}`}
      </div>
      {error && <p style={{ color: "var(--danger)", fontSize: 13 }}>{error}</p>}
      {!rows && !error && <p className="text-dim" style={{ fontSize: 13 }}>Loading…</p>}
      {rows && rows.length === 0 && <p className="text-dim" style={{ fontSize: 13 }}>Nothing to compare yet.</p>}
      {rows?.map((r) => <DeltaRow key={r.label} row={r} />)}
    </div>
  );
}
