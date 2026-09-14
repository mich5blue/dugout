'use client';

import { heatStyle } from '@/components/season/charts';
import { GROUP_STYLE, PlayerChip } from '@/components/ui';
import type { PlayerSeasonUsage } from '@/domain/season';
import type { PositionGroup } from '@/domain/types';
import { cn } from '@/lib/cn';
import { formatShortDate, formatSigned } from '@/lib/format';
import type { PlayerGameLine } from '@/services/seasonStatistics';
import Link from 'next/link';

/**
 * One player's season, as a parent would ask about it.
 *
 * The season page used to be four tables of integers, which answer "how much"
 * only if you already know what a normal number looks like. This card answers
 * the two questions people actually ask — did they play enough, and did they
 * get to play everywhere — and the second one is the reason the share bar is
 * split by position group rather than being a single innings total.
 */

/** The share bar's segments, in the order they read: field first, rest last. */
const SEGMENTS: Array<{ group: PositionGroup; label: string }> = [
  { group: 'BATTERY', label: 'Pitcher / catcher' },
  { group: 'INFIELD', label: 'Infield' },
  { group: 'OUTFIELD', label: 'Outfield' },
  { group: 'BENCH', label: 'Rest' },
];

const FILL: Record<PositionGroup, string> = {
  BATTERY: 'var(--battery)',
  INFIELD: 'var(--infield)',
  OUTFIELD: 'var(--outfield)',
  BENCH: 'var(--bench)',
};

export function PlayerSeasonCard({
  playerId,
  name,
  jerseyNumber,
  usage,
  debt,
  log,
  teamAverage,
}: {
  playerId: string;
  name: string;
  jerseyNumber?: string;
  usage: PlayerSeasonUsage | undefined;
  debt: number;
  log: PlayerGameLine[];
  teamAverage: number;
}) {
  const innings = usage?.defensiveInnings ?? 0;
  const rest = usage?.benchInnings ?? 0;
  const total = innings + rest;
  const versus = innings - teamAverage;

  const counts: Record<PositionGroup, number> = {
    BATTERY: (usage?.pitchingInnings ?? 0) + (usage?.catchingInnings ?? 0),
    INFIELD: usage?.byGroup.INFIELD ?? 0,
    OUTFIELD: usage?.byGroup.OUTFIELD ?? 0,
    BENCH: rest,
  };

  return (
    <Link
      href={`/roster/${playerId}`}
      className="ring-focus group block rounded-xl border border-border bg-surface p-4 transition-colors hover:border-border-strong"
    >
      <div className="flex items-start justify-between gap-3">
        <PlayerChip name={name} jerseyNumber={jerseyNumber} />
        <div className="shrink-0 text-right">
          <p className="display text-3xl leading-none text-ink">{innings}</p>
          <p className="mt-1 text-[11px] text-ink-subtle">innings</p>
        </div>
      </div>

      {/*
        The share bar. Widths are the player's own innings, so a player who
        missed a game gets a shorter bar rather than a rescaled one that
        pretends they were there — the point of comparison is the team, and
        rescaling each bar to 100% would hide exactly the gap being looked for.
      */}
      <div className="mt-3.5">
        <div
          className="flex h-2.5 w-full gap-px overflow-hidden rounded-full bg-surface-muted"
          role="img"
          aria-label={SEGMENTS.filter((s) => counts[s.group] > 0)
            .map((s) => `${counts[s.group]} ${s.label}`)
            .join(', ')}
        >
          {SEGMENTS.map((segment) => {
            const count = counts[segment.group];
            if (count === 0) return null;
            return (
              <span
                key={segment.group}
                title={`${count} ${count === 1 ? 'inning' : 'innings'} · ${segment.label}`}
                style={{
                  width: `${(count / Math.max(1, total)) * 100}%`,
                  backgroundColor: FILL[segment.group],
                }}
              />
            );
          })}
        </div>

        {/* The numbers, because colour is never the only cue. */}
        <p className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-ink-muted">
          {SEGMENTS.map((segment) => (
            <span key={segment.group} className="flex items-center gap-1">
              <span
                aria-hidden
                className={cn('size-2 rounded-full', GROUP_STYLE[segment.group].dot)}
              />
              <span className="tnum">{counts[segment.group]}</span>
              <span>{segment.group === 'BENCH' ? 'rest' : SHORT[segment.group]}</span>
            </span>
          ))}
        </p>
      </div>

      {/*
        Game by game.

        A total cannot show a pattern, and the pattern is what gets noticed:
        two quiet games in a row read instantly here and are invisible in an
        average. Drawn as numbered pills rather than bars because in a normal
        rotation every bar is nearly full height — a row of near-identical
        blocks that carried no information. The number is always legible, and
        the tint is a second cue on top of it, never the only one.
      */}
      {log.length > 0 ? (
        <div className="mt-4">
          <p className="eyebrow mb-1.5 text-ink-subtle">Innings each game</p>
          <div className="flex gap-1">
            {log.map((line) => {
              const share = line.gameInnings > 0 ? line.innings / line.gameInnings : 0;
              return (
                <span
                  key={line.gameId}
                  title={`${formatShortDate(line.date)} vs ${line.opponent || 'TBD'} · ${line.innings} of ${line.gameInnings} innings`}
                  className="tnum flex h-7 flex-1 items-center justify-center rounded-md text-xs font-semibold"
                  style={heatStyle(share)}
                >
                  {line.innings}
                </span>
              );
            })}
          </div>
        </div>
      ) : null}

      <p className="mt-3 border-t border-border pt-2.5 text-xs">
        <span
          className={cn(
            'font-medium',
            versus <= -1.5 ? 'text-caution' : versus >= 1.5 ? 'text-ink' : 'text-ink-muted',
          )}
        >
          {Math.abs(versus) < 0.5
            ? 'Right on the team average'
            : `${formatSigned(versus)} innings vs the team average`}
        </span>
        {debt >= 1 ? (
          <span className="text-caution"> · next in line for more</span>
        ) : null}
      </p>
    </Link>
  );
}

const SHORT: Record<PositionGroup, string> = {
  BATTERY: 'P/C',
  INFIELD: 'infield',
  OUTFIELD: 'outfield',
  BENCH: 'rest',
};
