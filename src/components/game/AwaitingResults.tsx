'use client';

import { Button, Card, CardHeader } from '@/components/ui';
import type { Game } from '@/domain/types';
import { formatDayAndDate } from '@/lib/format';
import { awaitingResults, hasLineup } from '@/lib/schedule';
import Link from 'next/link';
import { useMemo, useState } from 'react';

/**
 * Games that have been played but never recorded.
 *
 * Every season number in InningGrid comes from recorded results, so a coach who
 * never opens "Record results" gets an empty Season page and no fairness
 * carry-over — the whole point of the product silently does not run. This is
 * what closes that loop.
 *
 * It asks rather than assuming, and the reason is rain. Auto-recording a past
 * game as played-in-full would be one tap cheaper and occasionally very wrong:
 * a rained-out game booked as six innings tells the optimizer that everybody
 * got their innings, and it then under-plays them for weeks to compensate for
 * a game that never happened. Bad fairness data is worse than none, because it
 * is invisible.
 *
 * So the common answer is one tap and the wrong answers are one tap too.
 */
export function AwaitingResults({
  games,
  onRecord,
}: {
  games: Game[];
  /** Innings actually played; 0 means the game did not happen. */
  onRecord: (game: Game, innings: number) => Promise<void>;
}) {
  const pending = useMemo(() => awaitingResults(games), [games]);
  const [busy, setBusy] = useState<string | null>(null);

  if (pending.length === 0) return null;

  const record = async (game: Game, innings: number) => {
    setBusy(game.id);
    try {
      await onRecord(game, innings);
    } finally {
      setBusy(null);
    }
  };

  return (
    <Card className="border-accent/40">
      <CardHeader
        title={pending.length === 1 ? 'One game to log' : `${pending.length} games to log`}
        description="The season only counts games you've logged — playing time, positions and fairness all come from these."
      />
      <ul>
        {pending.map((game) => {
          const planned = game.plannedInnings;
          const built = hasLineup(game);
          const working = busy === game.id;

          return (
            <li
              key={game.id}
              className="flex flex-wrap items-center gap-3 border-b border-border px-5 py-4 last:border-b-0"
            >
              <div className="min-w-0 flex-1">
                <p className="flex flex-wrap items-baseline gap-1.5">
                  <span className="scoreboard text-base text-ink-subtle">vs</span>
                  <span className="display text-2xl text-ink">
                    {game.opponent || 'TBD'}
                  </span>
                </p>
                <p className="mt-1 text-sm text-ink-muted">
                  {formatDayAndDate(game.date)}
                  {built ? null : ' · no lineup was built'}
                </p>
              </div>

              <div className="flex flex-wrap items-center gap-2">
                {built ? (
                  <Button
                    variant="primary"
                    disabled={working}
                    onClick={() => record(game, planned)}
                  >
                    Played all {planned}
                  </Button>
                ) : null}
                {built ? (
                  <Link href={`/games/${game.id}/record`}>
                    <Button disabled={working}>Fewer innings</Button>
                  </Link>
                ) : null}
                <Button
                  variant="ghost"
                  disabled={working}
                  onClick={() => record(game, 0)}
                  title="Rained out, forfeited, or cancelled — nothing counts toward the season"
                >
                  Didn&apos;t play
                </Button>
              </div>
            </li>
          );
        })}
      </ul>
    </Card>
  );
}
