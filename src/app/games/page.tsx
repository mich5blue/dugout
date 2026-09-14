'use client';

import { useDugout } from '@/app/providers';
import { AwaitingResults } from '@/components/game/AwaitingResults';
import { recordActualResults } from '@/services/lineupService';
import { Badge, Button, Card, CardHeader, EmptyState } from '@/components/ui';
import { formatDayAndDate, formatGameDate } from '@/lib/format';
import { completedGames, hasLineup, upcomingGames } from '@/lib/schedule';
import { cn } from '@/lib/cn';
import Link from 'next/link';
import { useMemo } from 'react';

/**
 * The schedule.
 *
 * The dashboard only ever showed the next game and the last one, so a coach
 * with four games booked could not see past the first. This is the whole
 * season in one place, split the way a coach thinks about it: what is coming,
 * and what has been played.
 */
export default function SchedulePage() {
  const { ready, team, games, can, saveGame } = useDugout();

  const upcoming = useMemo(() => upcomingGames(games), [games]);
  const played = useMemo(() => completedGames(games), [games]);

  if (!ready) return null;

  if (!team) {
    return (
      <EmptyState
        title="No team yet"
        description="Create your team first, then add games."
        action={
          <Link href="/setup">
            <Button variant="primary">Create your team</Button>
          </Link>
        }
      />
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="display text-4xl text-ink sm:text-5xl">Schedule</h1>
          <p className="mt-2 text-sm text-ink-muted">
            <span className="tnum">{upcoming.length}</span> upcoming ·{' '}
            <span className="tnum">{played.length}</span> played
          </p>
        </div>
        {can('game:create') ? (
          <Link href="/games/new">
            <Button variant="primary">New game</Button>
          </Link>
        ) : null}
      </div>

      <AwaitingResults
        games={games}
        onRecord={async (game, innings) => {
          await saveGame(recordActualResults(game, innings));
        }}
      />

      {games.length === 0 ? (
        <Card>
          <EmptyState
            title="No games yet"
            description="Add a game and InningGrid will build the lineup."
            action={
              can('game:create') ? (
                <Link href="/games/new">
                  <Button variant="primary">New game</Button>
                </Link>
              ) : undefined
            }
          />
        </Card>
      ) : null}

      {upcoming.length > 0 ? (
        <Card>
          <CardHeader title="Upcoming" description="Soonest first" />
          <ul>
            {upcoming.map((game, index) => (
              <li key={game.id} className="border-b border-border last:border-b-0">
                <Link
                  href={`/games/${game.id}`}
                  className="ring-focus group flex items-center gap-3 px-4 py-3.5 transition-colors hover:bg-surface-muted"
                >
                  {/*
                    The soonest game is marked rather than merely being first,
                    so "which one is next" survives a coach scanning from the
                    middle of the list.
                  */}
                  <span className="w-16 shrink-0">
                    {index === 0 ? (
                      <span className="eyebrow rounded bg-accent-soft px-1.5 py-0.5 text-accent">
                        Next
                      </span>
                    ) : null}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="flex flex-wrap items-baseline gap-1.5">
                      <span className="scoreboard text-base text-ink-subtle">vs</span>
                      <span className="display text-2xl text-ink">
                        {game.opponent || 'TBD'}
                      </span>
                    </span>
                    <span className="mt-1 block text-sm text-ink-muted">
                      {formatGameDate(game.date)} ·{' '}
                      <span className="tnum">{game.plannedInnings}</span> innings
                    </span>
                  </span>
                  <span className="shrink-0">
                    {hasLineup(game) ? (
                      <Badge tone="positive">Lineup ready</Badge>
                    ) : (
                      <Badge tone="neutral">No lineup</Badge>
                    )}
                  </span>
                  <span
                    aria-hidden
                    className="shrink-0 text-ink-subtle transition-colors group-hover:text-accent"
                  >
                    →
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        </Card>
      ) : null}

      {played.length > 0 ? (
        <Card>
          <CardHeader title="Played" description="Most recent first" />
          <ul>
            {played.map((game) => (
              <li key={game.id} className="border-b border-border last:border-b-0">
                <Link
                  href={`/games/${game.id}`}
                  className={cn(
                    'ring-focus group flex items-center gap-3 px-4 py-3',
                    'transition-colors hover:bg-surface-muted',
                  )}
                >
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-base font-medium text-ink">
                      vs {game.opponent || 'TBD'}
                    </span>
                    <span className="mt-0.5 block text-sm text-ink-muted">
                      {formatDayAndDate(game.date)} ·{' '}
                      <span className="tnum">
                        {game.actualInnings ?? game.plannedInnings}
                      </span>{' '}
                      innings played
                    </span>
                  </span>
                  <span
                    aria-hidden
                    className="shrink-0 text-ink-subtle transition-colors group-hover:text-accent"
                  >
                    →
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        </Card>
      ) : null}
    </div>
  );
}
