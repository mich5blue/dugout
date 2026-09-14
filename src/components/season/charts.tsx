'use client';

import { cn } from '@/lib/cn';
import type { PositionGroup } from '@/domain/types';

/**
 * The season's charts, drawn as inline SVG.
 *
 * No chart library: everything here is a handful of rects and a path, and a
 * library would cost more bytes than the whole page while painting its own
 * colours over the palette. Every fill is a token, so the charts follow the
 * theme into light mode and flatten correctly when printed.
 *
 * All of them are sized with a viewBox and `width: 100%`, so they scale with
 * the card instead of needing a resize observer.
 */

export const GROUP_FILL: Record<PositionGroup, string> = {
  BATTERY: 'var(--battery)',
  INFIELD: 'var(--infield)',
  OUTFIELD: 'var(--outfield)',
  BENCH: 'var(--bench)',
};

export const GROUP_LABEL: Record<PositionGroup, string> = {
  BATTERY: 'Pitcher / catcher',
  INFIELD: 'Infield',
  OUTFIELD: 'Outfield',
  BENCH: 'Rest',
};

/**
 * A four-step heat fill, for anything tinted by "how much".
 *
 * Banded rather than a continuous mix because the text has to stay legible in
 * both modes. A smooth ramp into --accent means the label colour has to flip
 * somewhere in the middle, and light mode's accent is a dark olive whose pill
 * text is bright lime — so a half-strength olive got lime text on a mid tone,
 * which reads in neither mode. Each band here is a pair the palette already
 * validates: ink on a soft fill, or --ink-inverse on the full accent.
 */
export function heatStyle(weight: number): { backgroundColor: string; color: string } {
  if (weight >= 0.67) {
    return { backgroundColor: 'var(--accent)', color: 'var(--ink-inverse)' };
  }
  if (weight >= 0.34) {
    return { backgroundColor: 'var(--accent-soft)', color: 'var(--ink)' };
  }
  if (weight > 0) {
    return {
      backgroundColor: 'color-mix(in srgb, var(--accent-soft) 55%, var(--surface-muted))',
      color: 'var(--ink)',
    };
  }
  return { backgroundColor: 'var(--surface-muted)', color: 'var(--ink-muted)' };
}

/** A legend that names every colour used, so hue is never the only cue. */
export function GroupLegend({
  groups = ['BATTERY', 'INFIELD', 'OUTFIELD', 'BENCH'],
  className,
}: {
  groups?: PositionGroup[];
  className?: string;
}) {
  return (
    <ul className={cn('flex flex-wrap items-center gap-x-4 gap-y-1.5', className)}>
      {groups.map((group) => (
        <li key={group} className="flex items-center gap-1.5 text-xs text-ink-muted">
          <span
            aria-hidden
            className="size-2.5 rounded-full"
            style={{ backgroundColor: GROUP_FILL[group] }}
          />
          {GROUP_LABEL[group]}
        </li>
      ))}
    </ul>
  );
}

/**
 * Season balance as a dial.
 *
 * One number the coach is meant to glance at and move on from. An arc reads as
 * "how full" in a way that "83%" does not, and the number stays in the middle
 * for anyone who wants it exactly.
 */
export function BalanceDial({ value, label }: { value: number; label: string }) {
  const clamped = Math.max(0, Math.min(1, value));
  const radius = 54;
  const circumference = Math.PI * radius; // half turn
  const tone =
    clamped >= 0.8 ? 'var(--positive)' : clamped >= 0.6 ? 'var(--accent)' : 'var(--caution)';

  return (
    <div className="flex flex-col items-center">
      <svg viewBox="0 0 140 84" className="w-full max-w-[200px]" role="img" aria-label={`${label}: ${Math.round(clamped * 100)}%`}>
        <path
          d={`M 16 70 A ${radius} ${radius} 0 0 1 124 70`}
          fill="none"
          stroke="var(--border)"
          strokeWidth="12"
          strokeLinecap="round"
        />
        <path
          d={`M 16 70 A ${radius} ${radius} 0 0 1 124 70`}
          fill="none"
          stroke={tone}
          strokeWidth="12"
          strokeLinecap="round"
          strokeDasharray={`${circumference * clamped} ${circumference}`}
          className="transition-[stroke-dasharray] duration-700 ease-out"
        />
        <text
          x="70"
          y="64"
          textAnchor="middle"
          className="display"
          fill="var(--ink)"
          fontSize="30"
        >
          {Math.round(clamped * 100)}
        </text>
        <text x="70" y="80" textAnchor="middle" fill="var(--ink-subtle)" fontSize="9">
          OUT OF 100
        </text>
      </svg>
      <p className="mt-1 text-center text-xs text-ink-muted">{label}</p>
    </div>
  );
}

export interface BarRow {
  id: string;
  label: string;
  value: number;
  /** Stacked segments; when present the bar is split by position group. */
  segments?: Array<{ group: PositionGroup; value: number }>;
  highlight?: boolean;
}

/**
 * Horizontal bars, sorted by the caller.
 *
 * Horizontal rather than vertical because the labels are names: a vertical bar
 * chart of eleven players either rotates its labels or truncates them, and
 * both make the reader work to answer "who".
 */
export function BarChart({
  rows,
  average,
  averageLabel = 'team average',
  unit = 'innings',
}: {
  rows: BarRow[];
  average?: number;
  averageLabel?: string;
  unit?: string;
}) {
  const max = Math.max(1, ...rows.map((row) => row.value));

  return (
    <div className="space-y-1.5">
      {rows.map((row) => {
        const width = (row.value / max) * 100;
        return (
          <div key={row.id} className="flex items-center gap-2">
            <span
              className={cn(
                /* Narrower on a phone: at 7.5rem the bars themselves were
                   down to a third of the screen. */
                'w-16 shrink-0 truncate text-xs sm:w-[7.5rem]',
                row.highlight ? 'font-semibold text-ink' : 'text-ink-muted',
              )}
            >
              {row.label}
            </span>
            <span className="relative h-5 flex-1 overflow-hidden rounded-md bg-surface-muted">
              {row.segments ? (
                <span className="absolute inset-y-0 left-0 flex gap-px" style={{ width: `${width}%` }}>
                  {row.segments
                    .filter((segment) => segment.value > 0)
                    .map((segment) => (
                      <span
                        key={segment.group}
                        title={`${segment.value} ${GROUP_LABEL[segment.group]}`}
                        style={{
                          width: `${(segment.value / Math.max(1, row.value)) * 100}%`,
                          backgroundColor: GROUP_FILL[segment.group],
                        }}
                      />
                    ))}
                </span>
              ) : (
                <span
                  className="absolute inset-y-0 left-0 rounded-md bg-accent transition-[width] duration-500 ease-out"
                  style={{ width: `${width}%` }}
                />
              )}
              {average !== undefined ? (
                <span
                  aria-hidden
                  title={`${average.toFixed(1)} ${averageLabel}`}
                  className="absolute inset-y-0 w-px bg-ink/50"
                  style={{ left: `${(average / max) * 100}%` }}
                />
              ) : null}
            </span>
            <span className="tnum w-8 shrink-0 text-right text-xs font-semibold text-ink">
              {row.value}
            </span>
          </div>
        );
      })}
      {average !== undefined ? (
        <p className="pt-1 pl-[4.5rem] text-[11px] text-ink-subtle sm:pl-[8.25rem]">
          <span aria-hidden className="mr-1.5 inline-block h-2.5 w-px translate-y-0.5 bg-ink/50" />
          {average.toFixed(1)} {unit}, {averageLabel}
        </p>
      ) : null}
    </div>
  );
}

export interface Series {
  id: string;
  label: string;
  points: number[];
  highlight?: boolean;
}

/**
 * Cumulative innings, one line per player.
 *
 * This is the fairness chart. Lines that stay bundled mean nobody is drifting;
 * a line that peels away from the pack is a player the season is leaving
 * behind, and it shows up here games before it shows up in a total.
 */
export function LineChart({
  series,
  labels,
  height = 220,
}: {
  series: Series[];
  labels: string[];
  height?: number;
}) {
  const width = 640;
  const pad = { top: 12, right: 12, bottom: 26, left: 32 };
  const innerWidth = width - pad.left - pad.right;
  const innerHeight = height - pad.top - pad.bottom;

  const steps = Math.max(1, labels.length - 1);
  const max = Math.max(1, ...series.flatMap((entry) => entry.points));

  const x = (index: number) => pad.left + (index / steps) * innerWidth;
  const y = (value: number) => pad.top + innerHeight - (value / max) * innerHeight;

  const ticks = [0, 0.25, 0.5, 0.75, 1].map((fraction) => Math.round(max * fraction));

  /*
    Name the two lines at the edges of the bundle.

    Without them the chart says "the pack is tight" and nothing else — the
    reader can see someone is trailing but not who, which is the only thing
    they would act on. Only two labels, because eleven would be a thicket.
  */
  const final = (entry: Series) => entry.points[entry.points.length - 1] ?? 0;
  const sorted = [...series].sort((a, b) => final(b) - final(a));
  const edges = sorted.length > 1 ? [sorted[0], sorted[sorted.length - 1]] : [];

  return (
    <svg
      viewBox={`0 0 ${width} ${height}`}
      className="w-full"
      role="img"
      aria-label={`Cumulative innings over ${labels.length} games, one line per player`}
    >
      {[...new Set(ticks)].map((tick) => (
        <g key={tick}>
          <line
            x1={pad.left}
            x2={width - pad.right}
            y1={y(tick)}
            y2={y(tick)}
            stroke="var(--border)"
            strokeWidth="1"
          />
          <text x={pad.left - 6} y={y(tick) + 3} textAnchor="end" fontSize="9" fill="var(--ink-subtle)">
            {tick}
          </text>
        </g>
      ))}

      {labels.map((label, index) => (
        <text
          key={`${label}-${index}`}
          x={x(index)}
          y={height - 8}
          textAnchor={index === 0 ? 'start' : index === labels.length - 1 ? 'end' : 'middle'}
          fontSize="9"
          fill="var(--ink-subtle)"
        >
          {label}
        </text>
      ))}

      {/* Unhighlighted lines first, so a highlighted one is never buried. */}
      {[...series]
        .sort((a, b) => Number(Boolean(a.highlight)) - Number(Boolean(b.highlight)))
        .map((entry) => (
          <path
            key={entry.id}
            d={entry.points.map((value, index) => `${index === 0 ? 'M' : 'L'} ${x(index)} ${y(value)}`).join(' ')}
            fill="none"
            stroke={entry.highlight ? 'var(--accent)' : 'var(--ink)'}
            strokeOpacity={entry.highlight ? 1 : 0.22}
            strokeWidth={entry.highlight ? 2.5 : 1.5}
            strokeLinejoin="round"
            strokeLinecap="round"
          />
        ))}

      {edges.map((entry, index) => (
        <g key={`edge-${entry.id}`}>
          <circle cx={x(steps)} cy={y(final(entry))} r="3" fill="var(--ink)" />
          <text
            x={x(steps) - 8}
            /* Flipped to the inside when the point sits against an edge,
               which is exactly where the leader and the trailer sit. */
            y={
              index === 0
                ? y(final(entry)) - pad.top < 16
                  ? y(final(entry)) + 14
                  : y(final(entry)) - 8
                : height - pad.bottom - y(final(entry)) < 18
                  ? y(final(entry)) - 8
                  : y(final(entry)) + 14
            }
            textAnchor="end"
            fontSize="11"
            fontWeight="600"
            fill="var(--ink)"
          >
            {entry.label} {final(entry)}
          </text>
        </g>
      ))}
    </svg>
  );
}

/**
 * Player × game grid of innings played.
 *
 * Answers "who sat when", which no aggregate can. Reads as a season at a
 * glance: a pale row is a player who has been quiet, a pale column is a game
 * where the bench was busy.
 */
export function HeatGrid({
  rows,
  columns,
}: {
  rows: Array<{ id: string; label: string; cells: Array<{ value: number; of: number; title: string } | null> }>;
  columns: string[];
}) {
  /*
    Normalise the ramp to the range actually present, not to 0-100%.

    A little-league rotation puts nearly everyone on the field nearly all the
    time, so shares cluster between 0.8 and 1.0 — mapped against a full scale
    every cell came out the same lime and the grid carried no information at
    all. Stretching the ramp across the observed spread is what makes "5 of 6"
    look different from "6 of 6", which is the entire difference worth seeing.
  */
  const shares = rows
    .flatMap((row) => row.cells)
    .filter((cell): cell is { value: number; of: number; title: string } => Boolean(cell))
    .map((cell) => (cell.of > 0 ? cell.value / cell.of : 0));
  const low = shares.length > 0 ? Math.min(...shares) : 0;
  const high = shares.length > 0 ? Math.max(...shares) : 1;
  const span = high - low;

  const weight = (share: number) => (span < 0.01 ? 0.6 : (share - low) / span);

  return (
    <div className="overflow-x-auto">
      <table className="w-full border-separate border-spacing-0.5">
        <thead>
          <tr>
            <th className="sticky left-0 bg-surface" />
            {columns.map((column, index) => (
              <th
                key={`${column}-${index}`}
                className="px-1 pb-1 text-[10px] font-medium whitespace-nowrap text-ink-subtle"
              >
                {column}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.id}>
              <th
                scope="row"
                className="sticky left-0 bg-surface pr-2 text-left text-xs font-medium whitespace-nowrap text-ink"
              >
                {row.label}
              </th>
              {row.cells.map((cell, index) => {
                if (!cell) {
                  return (
                    <td key={index} className="p-0">
                      <span
                        title="Not with the team for this game"
                        className="block h-6 w-full min-w-9 rounded-sm border border-dashed border-border"
                      />
                    </td>
                  );
                }
                const share = cell.of > 0 ? cell.value / cell.of : 0;
                const heat = weight(share);
                return (
                  <td key={index} className="p-0">
                    <span
                      title={cell.title}
                      className="tnum flex h-6 w-full min-w-9 items-center justify-center rounded-sm text-[11px] font-semibold"
                      style={heatStyle(heat)}
                    >
                      {cell.value}
                    </span>
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
