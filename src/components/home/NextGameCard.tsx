'use client';

import { Badge, Button } from '@/components/ui';
import type { Game } from '@/domain/types';
import { cn } from '@/lib/cn';
import { formatDayAndDate } from '@/lib/format';
import { attendanceFor, nextActionFor } from '@/lib/nextAction';
import Link from 'next/link';

/**
 * The dominant object on Home: the game the coach is preparing for, and the
 * one thing to do about it.
 *
 * The old dashboard led with the team name and a season-balance percentage,
 * which is a number to admire rather than a thing to do. A coach opening this
 * on a Saturday morning has exactly one question, and it is not how the season
 * is going.
 *
 * The primary button changes with the state of the game — see
 * `lib/nextAction.ts`. There is deliberately only one filled button: two
 * equally-weighted calls to action is the same as none.
 */
export function NextGameCard({ game }: { game: Game }) {
  const action = nextActionFor(game);
  const attendance = attendanceFor(game);
  const needsAttendance = action.kind === 'CONFIRM_ATTENDANCE';

  return (
    <section
      className={cn(
        'rise relative overflow-hidden rounded-card border border-border bg-surface',
        /* The accent hairline marks this as the live object on the page. */
        'before:absolute before:inset-x-0 before:top-0 before:h-[3px] before:bg-accent before:content-[""]',
      )}
      aria-labelledby="next-game-heading"
    >
      <div className="grid gap-6 p-5 sm:p-6 lg:grid-cols-[1fr_auto] lg:items-end">
        <div className="min-w-0">
          <p className="eyebrow text-accent">Next game</p>

          <h2 id="next-game-heading" className="mt-2 flex flex-wrap items-baseline gap-2.5">
            <span className="scoreboard text-2xl text-ink-subtle">vs</span>
            <span className="display text-4xl text-ink sm:text-5xl">
              {game.opponent || 'TBD'}
            </span>
          </h2>

          <p className="mt-2.5 flex flex-wrap items-center gap-x-2.5 gap-y-1 text-sm text-ink-muted">
            <span className="font-medium text-ink">{formatDayAndDate(game.date)}</span>
            <span aria-hidden className="text-ink-subtle">·</span>
            <span className="tnum">{game.plannedInnings} innings</span>
            <span aria-hidden className="text-ink-subtle">·</span>
            <span className="tnum">
              {game.formationSnapshot.positions.length} on defense
            </span>
          </p>

          {/*
            Attendance as a sentence, not a widget. Three numbers with labels
            beat a progress bar here: "9 of 11" is the fact, and "2 absent" is
            the reason the coach cares.
          */}
          <p className="mt-4 flex flex-wrap items-center gap-2">
            <Badge tone={needsAttendance ? 'caution' : 'positive'}>
              {needsAttendance ? 'Attendance not confirmed' : 'Attendance confirmed'}
            </Badge>
            <span className="text-sm text-ink-muted">
              <span className="tnum font-semibold text-ink">{attendance.expected}</span>
              {' of '}
              <span className="tnum">{attendance.total}</span> expected
              {attendance.absent > 0 ? (
                <>
                  {' · '}
                  <span className="tnum">{attendance.absent}</span> out
                </>
              ) : null}
              {attendance.limited > 0 ? (
                <>
                  {' · '}
                  <span className="tnum">{attendance.limited}</span> part of the game
                </>
              ) : null}
            </span>
          </p>
        </div>

        <div className="flex shrink-0 flex-col gap-2 lg:items-end">
          <Link href={action.href} className="contents">
            <Button variant="primary" size="lg" className="w-full lg:w-auto">
              {action.label}
            </Button>
          </Link>
          {/*
            One secondary at a time. When attendance is the ask, the primary
            button already goes to that screen, so a second link to the same
            place is just a wider target for the same decision.
          */}
          <div className="flex flex-wrap gap-2 lg:justify-end">
            <Link href={`/games/${game.id}`}>
              <Button size="sm">Game details</Button>
            </Link>
            {needsAttendance ? null : (
              <Link href={`/games/${game.id}/build`}>
                <Button size="sm" variant="ghost">
                  Change attendance
                </Button>
              </Link>
            )}
          </div>
        </div>
      </div>

      {action.hint ? (
        <p className="border-t border-border bg-surface-raised px-5 py-2.5 text-xs text-ink-muted sm:px-6">
          {action.hint}
        </p>
      ) : null}
    </section>
  );
}
