import { useMemo, useRef, useState, PointerEvent } from "react";

// Small hand-rolled SVG charts (no chart library dependency). One y-axis
// only; thin marks (2px lines, ≥8px dots with a surface ring); hairline
// recessive grid; text always in text colours, never the series colour; a
// tap/hover tooltip on every chart.

export interface Line {
  points: { x: Date; y: number }[];
  color: string;
  width?: number;
  dashed?: boolean;
  opacity?: number;
  dots?: boolean;
  /** Included in the tooltip when hovering near one of its points. */
  name?: string;
}

export interface Marker {
  x: Date;
  /** Shown in the tooltip when the marker is tapped. */
  label: string;
}

interface TimeChartProps {
  lines: Line[];
  markers?: Marker[];
  /** Extra point drawn as a target dot (e.g. the goal). */
  target?: { x: Date; y: number; label: string };
  unit: string;
  height?: number;
  formatY?: (v: number) => string;
  ariaLabel: string;
}

const PAD = { top: 12, right: 14, bottom: 24, left: 40 };
const WIDTH = 340;

function niceTicks(min: number, max: number, count = 4): number[] {
  if (min === max) {
    min -= 1;
    max += 1;
  }
  const span = max - min;
  const rawStep = span / count;
  const mag = 10 ** Math.floor(Math.log10(rawStep));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * mag).find((s) => s >= rawStep) ?? rawStep;
  const start = Math.floor(min / step) * step;
  const ticks: number[] = [];
  for (let v = start; v <= max + step * 0.5; v += step) ticks.push(Math.round(v * 1000) / 1000);
  return ticks;
}

function fmtDate(d: Date): string {
  return d.toLocaleDateString(undefined, { day: "numeric", month: "short" });
}

export function TimeChart({ lines, markers = [], target, unit, height = 200, formatY, ariaLabel }: TimeChartProps) {
  const svgRef = useRef<SVGSVGElement>(null);
  const [hover, setHover] = useState<{ px: number; py: number; text: string[] } | null>(null);
  const fy = formatY ?? ((v: number) => `${Math.round(v * 10) / 10}`);

  const allPts = lines.flatMap((l) => l.points).concat(target ? [{ x: target.x, y: target.y }] : []);
  const scales = useMemo(() => {
    if (allPts.length === 0) return null;
    const xs = allPts.map((p) => p.x.getTime()).concat(markers.map((m) => m.x.getTime()));
    const ys = allPts.map((p) => p.y);
    let xMin = Math.min(...xs);
    let xMax = Math.max(...xs);
    if (xMin === xMax) {
      xMin -= 86400_000 * 3;
      xMax += 86400_000 * 3;
    }
    const yPad = Math.max((Math.max(...ys) - Math.min(...ys)) * 0.1, 0.5);
    const ticks = niceTicks(Math.min(...ys) - yPad, Math.max(...ys) + yPad);
    const yMin = ticks[0];
    const yMax = ticks[ticks.length - 1];
    const x = (t: Date) => PAD.left + ((t.getTime() - xMin) / (xMax - xMin)) * (WIDTH - PAD.left - PAD.right);
    const y = (v: number) => PAD.top + (1 - (v - yMin) / (yMax - yMin)) * (height - PAD.top - PAD.bottom);
    return { x, y, ticks, xMin, xMax };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [JSON.stringify(allPts), JSON.stringify(markers.map((m) => m.x)), height]);

  if (!scales) {
    return <p className="text-dim" style={{ fontSize: 13 }}>No data yet.</p>;
  }
  const { x, y, ticks, xMin, xMax } = scales;

  function onMove(e: PointerEvent<SVGSVGElement>) {
    const svg = svgRef.current;
    if (!svg) return;
    const rect = svg.getBoundingClientRect();
    const px = ((e.clientX - rect.left) / rect.width) * WIDTH;
    // Nearest marker within 10px wins (so revision markers are tappable);
    // otherwise the nearest point of any named line.
    const m = markers.find((mk) => Math.abs(x(mk.x) - px) < 10);
    if (m) {
      setHover({ px: x(m.x), py: PAD.top + 4, text: [fmtDate(m.x), m.label] });
      return;
    }
    let best: { d: number; px: number; py: number; text: string[] } | null = null;
    for (const l of lines) {
      if (!l.name) continue;
      for (const p of l.points) {
        const d = Math.abs(x(p.x) - px);
        if (!best || d < best.d) best = { d, px: x(p.x), py: y(p.y), text: [fmtDate(p.x), `${l.name}: ${fy(p.y)}${unit}`] };
      }
    }
    if (target && Math.abs(x(target.x) - px) < 12) {
      best = { d: 0, px: x(target.x), py: y(target.y), text: [fmtDate(target.x), target.label] };
    }
    setHover(best && best.d < 40 ? best : null);
  }

  const xLabels = [new Date(xMin), new Date((xMin + xMax) / 2), new Date(xMax)];

  return (
    <div style={{ position: "relative" }}>
      <svg
        ref={svgRef}
        viewBox={`0 0 ${WIDTH} ${height}`}
        width="100%"
        role="img"
        aria-label={ariaLabel}
        onPointerMove={onMove}
        onPointerDown={onMove}
        onPointerLeave={() => setHover(null)}
        style={{ display: "block", touchAction: "pan-y" }}
      >
        {ticks.map((t) => (
          <g key={t}>
            <line x1={PAD.left} x2={WIDTH - PAD.right} y1={y(t)} y2={y(t)} stroke="var(--border)" strokeWidth={1} />
            <text x={PAD.left - 6} y={y(t) + 3} textAnchor="end" fontSize={10} fill="var(--text-dim)">
              {fy(t)}
            </text>
          </g>
        ))}
        {xLabels.map((d, i) => (
          <text
            key={i}
            x={x(d)}
            y={height - 6}
            textAnchor={i === 0 ? "start" : i === 2 ? "end" : "middle"}
            fontSize={10}
            fill="var(--text-dim)"
          >
            {fmtDate(d)}
          </text>
        ))}

        {markers.map((m, i) => (
          <g key={i} opacity={0.55}>
            <line x1={x(m.x)} x2={x(m.x)} y1={PAD.top} y2={height - PAD.bottom} stroke="var(--text-dim)" strokeWidth={1} />
            <circle cx={x(m.x)} cy={PAD.top + 4} r={4} fill="var(--surface)" stroke="var(--text-dim)" strokeWidth={1.5} />
          </g>
        ))}

        {lines.map((l, i) => (
          <g key={i} opacity={l.opacity ?? 1}>
            {l.points.length > 1 && (
              <polyline
                points={l.points.map((p) => `${x(p.x)},${y(p.y)}`).join(" ")}
                fill="none"
                stroke={l.color}
                strokeWidth={l.width ?? 2}
                strokeDasharray={l.dashed ? "5 4" : undefined}
                strokeLinejoin="round"
                strokeLinecap="round"
              />
            )}
            {(l.dots || l.points.length === 1) &&
              l.points.map((p, j) => (
                <circle key={j} cx={x(p.x)} cy={y(p.y)} r={4} fill={l.color} stroke="var(--surface)" strokeWidth={2} />
              ))}
          </g>
        ))}

        {target && <circle cx={x(target.x)} cy={y(target.y)} r={5} fill="var(--accent)" stroke="var(--surface)" strokeWidth={2} />}

        {hover && <line x1={hover.px} x2={hover.px} y1={PAD.top} y2={height - PAD.bottom} stroke="var(--navy)" strokeWidth={1} opacity={0.3} />}
      </svg>
      {hover && (
        <div
          role="status"
          style={{
            position: "absolute",
            top: 0,
            left: `${Math.min(70, Math.max(0, (hover.px / WIDTH) * 100 - 15))}%`,
            background: "var(--bar)",
            color: "var(--on-navy)",
            fontSize: 12,
            padding: "4px 8px",
            borderRadius: 6,
            pointerEvents: "none",
            maxWidth: "60%",
          }}
        >
          {hover.text.map((t, i) => (
            <div key={i} style={{ fontWeight: i === 0 ? 400 : 600, opacity: i === 0 ? 0.8 : 1 }}>
              {t}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

interface BarChartProps {
  bars: { x: Date; y: number; label: string }[];
  color: string;
  /** Horizontal reference line, e.g. the step goal. */
  reference?: { y: number; label: string };
  height?: number;
  ariaLabel: string;
}

export function DailyBarChart({ bars, color, reference, height = 180, ariaLabel }: BarChartProps) {
  const [hover, setHover] = useState<number | null>(null);
  if (bars.length === 0) return <p className="text-dim" style={{ fontSize: 13 }}>No data yet.</p>;
  const maxY = Math.max(...bars.map((b) => b.y), reference?.y ?? 0) * 1.1;
  const ticks = niceTicks(0, maxY, 3);
  const top = ticks[ticks.length - 1];
  const innerW = WIDTH - PAD.left - PAD.right;
  const slot = innerW / bars.length;
  const barW = Math.min(24, Math.max(2, slot - 2));
  const y = (v: number) => PAD.top + (1 - v / top) * (height - PAD.top - PAD.bottom);
  const base = y(0);
  const fmt = (v: number) => (v >= 1000 ? `${Math.round(v / 100) / 10}k` : `${v}`);

  return (
    <div style={{ position: "relative" }}>
      <svg viewBox={`0 0 ${WIDTH} ${height}`} width="100%" role="img" aria-label={ariaLabel} style={{ display: "block" }} onPointerLeave={() => setHover(null)}>
        {ticks.map((t) => (
          <g key={t}>
            <line x1={PAD.left} x2={WIDTH - PAD.right} y1={y(t)} y2={y(t)} stroke="var(--border)" strokeWidth={1} />
            <text x={PAD.left - 6} y={y(t) + 3} textAnchor="end" fontSize={10} fill="var(--text-dim)">
              {fmt(t)}
            </text>
          </g>
        ))}
        {bars.map((b, i) => {
          const cx = PAD.left + slot * i + slot / 2;
          const h = Math.max(0, base - y(b.y));
          const r = Math.min(4, barW / 2, h);
          const x0 = cx - barW / 2;
          // Rounded data-end, square at the baseline.
          const d = `M${x0},${base} L${x0},${base - h + r} Q${x0},${base - h} ${x0 + r},${base - h} L${x0 + barW - r},${base - h} Q${x0 + barW},${base - h} ${x0 + barW},${base - h + r} L${x0 + barW},${base} Z`;
          return (
            <g key={i} onPointerEnter={() => setHover(i)} onPointerDown={() => setHover(i)}>
              <rect x={PAD.left + slot * i} y={PAD.top} width={slot} height={height - PAD.top - PAD.bottom} fill="transparent" />
              {h > 0 && <path d={d} fill={color} opacity={hover === null || hover === i ? 1 : 0.55} />}
            </g>
          );
        })}
        {reference && (
          <g>
            <line x1={PAD.left} x2={WIDTH - PAD.right} y1={y(reference.y)} y2={y(reference.y)} stroke="var(--navy)" strokeWidth={1.5} />
            <text
              x={WIDTH - PAD.right}
              y={y(reference.y) - 4}
              textAnchor="end"
              fontSize={10}
              fill="var(--navy)"
              fontWeight={600}
              stroke="var(--surface)"
              strokeWidth={3}
              paintOrder="stroke"
            >
              {reference.label}
            </text>
          </g>
        )}
        <text x={PAD.left} y={height - 6} fontSize={10} fill="var(--text-dim)">
          {fmtDate(bars[0].x)}
        </text>
        <text x={WIDTH - PAD.right} y={height - 6} textAnchor="end" fontSize={10} fill="var(--text-dim)">
          {fmtDate(bars[bars.length - 1].x)}
        </text>
      </svg>
      {hover !== null && (
        <div
          role="status"
          style={{
            position: "absolute",
            top: 0,
            left: `${Math.min(70, Math.max(0, ((PAD.left + slot * hover) / WIDTH) * 100 - 10))}%`,
            background: "var(--bar)",
            color: "var(--on-navy)",
            fontSize: 12,
            padding: "4px 8px",
            borderRadius: 6,
            pointerEvents: "none",
          }}
        >
          <div style={{ opacity: 0.8 }}>{fmtDate(bars[hover].x)}</div>
          <div style={{ fontWeight: 600 }}>{bars[hover].label}</div>
        </div>
      )}
    </div>
  );
}

/** A horizontal fill bar (0–100%) with a label — used for recovery. */
export function Meter({ percent, color, label }: { percent: number; color: string; label: string }) {
  return (
    <div aria-label={label}>
      <div style={{ height: 8, background: "var(--surface-2)", borderRadius: 4, overflow: "hidden" }}>
        <div style={{ width: `${Math.max(0, Math.min(100, percent))}%`, height: "100%", background: color, borderRadius: 4 }} />
      </div>
    </div>
  );
}
