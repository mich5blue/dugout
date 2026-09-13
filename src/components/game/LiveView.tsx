'use client';

import { Button, GROUP_STYLE } from '@/components/ui';
import { playerName, playerShortName } from '@/domain/factories';
import { cn } from '@/lib/cn';
import { extraInningFor, type ExtraInning } from '@/lib/gameDayChanges';
import { UNAVAILABLE, type GameView } from '@/lib/gameView';
import { useState } from 'react';

/**
 * Live view — the "dugout live" direction.
 *
 * This is the surface a coach actually operates during a game: standing at a
 * fence, one thumb, between innings, under time pressure. It is built for that
 * and nothing else.
 *
 * One inning at a time, at a size readable at arm's length, with each player's
 * previous spot inline so the list reads as instructions to call out rather
 * than a table to cross-reference.
 *
 * It deliberately does *not* carry a separate "what changed" panel. Dugout's
 * optimizer rotates for fairness, so in a typical game nearly every player
 * moves every inning — a changes list ends up restating the whole roster, and
 * showing it above the field list meant reading the same eleven names twice.
 * The `was` column carries the same information in one pass.
 *
 * It carries exactly two actions, because these are the two things that
 * actually change during a youth game: the pitcher can go another inning, or
 * someone has to come out. Free-form swaps stay in the Field and By-inning
 * views, where a mis-tap is cheap; mid-game a mis-tap costs the lineup.
 */
export function LiveView({
  view,
  onInningChange,
  onPitchAnotherInning,
  onSomeoneOut,
}: {
  view: GameView;
  /** Reported up so a mid-game change knows which inning is in progress. */
  onInningChange?: (inning: number) => void;
  /** Keep this inning's pitcher on for the next one. */
  onPitchAnotherInning?: (plan: ExtraInning) => void;
  /** Open the "someone has to come out" flow. */
  onSomeoneOut?: () => void;
}) {
  const [inning, setInningState] = useState(1);
  const setInning = (next: number | ((current: number) => number)) => {
    setInningState((current) => {
      const value = typeof next === 'function' ? next(current) : next;
      onInningChange?.(value);
      return value;
    });
  };

  const last = view.innings.length;
  const bench = view.benchAt(inning);
  const extra = extraInningFor(view, inning);

  /** Where this player was the inning before, as a short label. */
  const previousLabel = (playerId: string): string | null => {
    if (inning <= 1) return null;
    const before = view.slotOf(playerId, inning - 1);
    if (before === UNAVAILABLE) return null;
    return before === null ? 'Bench' : before.code;
  };

  const movedCount = view.positions.reduce((total, position) => {
    const player = view.playerAt(inning, position.id);
    if (!player) return total;
    const was = previousLabel(player.id);
    return was !== null && was !== position.code ? total + 1 : total;
  }, 0);

  return (
    <div className="space-y-3">
      {/* Inning header. The figure is the largest thing in the product on
          purpose: it is the one fact the coach is looking for. */}
      <div className="overflow-hidden rounded-xl border border-border bg-surface-raised">
        <div className="flex items-center gap-4 px-4 pt-3.5 pb-4">
          <div className="min-w-0 flex-1">
            <p className="eyebrow text-accent">On the field</p>
            <p className="display mt-1 text-5xl text-ink sm:text-6xl">Inning {inning}</p>
            <p className="mt-2 text-sm text-ink-muted">
              {inning === 1
                ? 'Starting lineup'
                : movedCount === 0
                  ? 'Same as last inning'
                  : `${movedCount} player${movedCount === 1 ? '' : 's'} moving`}
            </p>
          </div>

          {/*
            Both steppers are held at 44px, the minimum comfortable touch
            target, rather than the `sm` height the surrounding chrome uses.
            This view's whole premise is a coach operating it one-handed
            between innings, and Prev is the only way back through the game.
          */}
          <div className="flex shrink-0 flex-col gap-1.5">
            <Button
              size="sm"
              className="h-11 px-4"
              disabled={inning <= 1}
              onClick={() => setInning((current) => Math.max(1, current - 1))}
              aria-label="Previous inning"
            >
              ↑ Prev
            </Button>
            <Button
              size="sm"
              variant="primary"
              className="h-11 px-4"
              disabled={inning >= last}
              onClick={() => setInning((current) => Math.min(last, current + 1))}
              aria-label="Next inning"
            >
              Next ↓
            </Button>
          </div>
        </div>

        {/* Progress through the game, as a hairline rather than a widget. */}
        <div className="h-1 w-full bg-bg" role="presentation">
          <div
            className="h-full bg-accent transition-[width] duration-300 ease-out"
            style={{ width: `${(inning / last) * 100}%` }}
          />
        </div>
      </div>

      {/*
        The mound decision, stated as a question with its consequence attached.
        A coach deciding this has a live ball in front of them, so the button
        says who ends up where rather than making them work it out from the
        list below.
      */}
      {onPitchAnotherInning && extra && !extra.blocked ? (
        <div className="rounded-xl border border-accent/40 bg-accent-soft p-3">
          <p className="text-base text-ink">
            <span className="font-semibold">{playerShortName(extra.pitcher)}</span> is
            pitching. Quick inning — send them back out?
          </p>
          <Button
            variant="primary"
            size="lg"
            className="mt-2.5 w-full"
            onClick={() => onPitchAnotherInning(extra)}
          >
            Pitch inning {extra.nextInning} too
          </Button>
          <p className="mt-2 text-xs text-ink-muted">
            {extra.summary}
            {extra.warning ? <> · {extra.warning}</> : null}
          </p>
        </div>
      ) : null}

      {onPitchAnotherInning && extra?.blocked ? (
        <p className="rounded-xl border border-border bg-surface-raised px-3 py-2.5 text-xs text-ink-muted">
          {playerShortName(extra.pitcher)} cannot pitch inning {extra.nextInning}.{' '}
          {extra.blocked}
        </p>
      ) : null}

      {/*
        The field, as a list. Rows are tall enough to read standing up, and the
        `was` column means a coach can call the whole inning off one screen.
      */}
      <ul className="overflow-hidden rounded-xl border border-border bg-surface">
        {view.positions.map((position) => {
          const player = view.playerAt(inning, position.id);
          const style = GROUP_STYLE[position.group];
          const was = player ? previousLabel(player.id) : null;
          const moved = was !== null && was !== position.code;

          return (
            <li
              key={position.id}
              className="flex items-center gap-3 border-b border-border px-3 py-3 last:border-b-0"
            >
              <span
                className={cn(
                  'scoreboard w-11 shrink-0 rounded-md border-l-2 py-1.5 text-center text-base',
                  style.chip,
                  style.rail,
                  style.text,
                )}
              >
                {position.code}
              </span>
              <span className="min-w-0 flex-1 truncate text-base font-medium text-ink">
                {player ? playerName(player) : '—'}
              </span>
              {moved ? (
                <span className="shrink-0 text-xs text-ink-subtle">
                  was <span className="scoreboard text-sm text-ink-muted">{was}</span>
                </span>
              ) : null}
              {player?.jerseyNumber ? (
                <span className="tnum w-8 shrink-0 text-right text-sm text-ink-subtle">
                  #{player.jerseyNumber}
                </span>
              ) : null}
            </li>
          );
        })}

        <li className="flex items-center gap-3 bg-bench-soft px-3 py-3">
          <span className="scoreboard w-11 shrink-0 py-1.5 text-center text-base text-bench">
            BN
          </span>
          <span className="min-w-0 flex-1 text-base text-ink-muted">
            {bench.length > 0 ? bench.map(playerShortName).join(' · ') : 'Nobody sits'}
          </span>
        </li>
      </ul>

      {onSomeoneOut ? (
        <Button size="lg" className="w-full" onClick={onSomeoneOut}>
          Someone has to come out
        </Button>
      ) : null}

      {inning < last ? (
        <Button
          variant="primary"
          size="lg"
          className="w-full"
          onClick={() => setInning((current) => Math.min(last, current + 1))}
        >
          Start inning {inning + 1} →
        </Button>
      ) : (
        <p className="px-4 py-2 text-center text-sm text-ink-muted">
          Last planned inning. Record what actually happened so the next game
          can even things out.
        </p>
      )}
    </div>
  );
}
