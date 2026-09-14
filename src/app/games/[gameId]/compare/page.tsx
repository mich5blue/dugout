'use client';

import { useDugout } from '@/app/providers';
import {
  Badge,
  Button,
  Card,
  CardHeader,
  EmptyState,
  Meter,
  Notice,
  SegmentedControl,
  Spinner,
} from '@/components/ui';
import { playerName } from '@/domain/factories';
import type { Philosophy } from '@/domain/types';
import {
  compareApproaches,
  describeTradeoff,
  type ApproachOutcome,
  type Comparison,
} from '@/services/compareService';
import { cn } from '@/lib/cn';
import { RATING_LABEL, formatGameDate, percent } from '@/lib/format';
import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { useCallback, useEffect, useMemo, useState } from 'react';

/**
 * Compare approaches (spec section 46).
 *
 * Three lineups from the same roster, same seed, same rules — the only thing
 * that changes is what the optimizer is asked to value. The coach reads the
 * trade-off and picks one.
 */
export default function ComparePage() {
  const params = useParams<{ gameId: string }>();
  const router = useRouter();
  const { ready, team, players, games, saveGame, goals, flags } = useDugout();

  const [comparison, setComparison] = useState<Comparison | null>(null);
  const [working, setWorking] = useState(true);
  const [applying, setApplying] = useState<Philosophy | null>(null);
  const [display, setDisplay] = useState<'cards' | 'table'>('cards');

  const game = games.find((entry) => entry.id === params.gameId) ?? null;

  const run = useCallback(async () => {
    if (!team || !game) return;
    setWorking(true);
    try {
      setComparison(
        await compareApproaches({
          team,
          game,
          players,
          history: games,
          goals,
          flags,
        }),
      );
    } finally {
      setWorking(false);
    }
    // Re-running on every store change would regenerate mid-read; the coach
    // asks for a fresh comparison explicitly.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [team, game?.id]);

  useEffect(() => {
    void run();
  }, [run]);

  const tradeoff = useMemo(
    () => (comparison ? describeTradeoff(comparison, players) : null),
    [comparison, players],
  );

  if (!ready) return null;

  if (!team || !game) {
    return (
      <EmptyState
        title="Game not found"
        action={
          <Link href="/">
            <Button variant="primary">Back to dashboard</Button>
          </Link>
        }
      />
    );
  }

  const apply = async (approach: ApproachOutcome) => {
    setApplying(approach.philosophy);
    try {
      // Save the settings that produced this lineup too, so a later Rebalance
      // behaves the way the coach just chose.
      await saveGame({
        ...approach.game,
        settingsSnapshot: approach.settings,
      });
      router.push(`/games/${game.id}`);
    } finally {
      setApplying(null);
    }
  };

  const failed = comparison?.approaches.filter((approach) => !approach.result.ok) ?? [];

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <Link
            href={`/games/${game.id}`}
            className="ring-focus text-sm text-ink-muted hover:text-ink"
          >
            ← Back to lineup
          </Link>
          <h1 className="display mt-1.5 text-4xl text-ink sm:text-5xl">
            Compare approaches
          </h1>
          <p className="mt-1 text-sm text-ink-muted">
            vs {game.opponent || 'TBD'} · {formatGameDate(game.date)}
          </p>
        </div>

        {comparison ? (
          <SegmentedControl
            size="sm"
            value={display}
            onChange={setDisplay}
            options={[
              { value: 'cards', label: 'Cards' },
              { value: 'table', label: 'Table' },
            ]}
          />
        ) : null}
      </div>

      {working ? (
        <Card>
          <div className="flex items-center gap-3 px-5 py-14">
            <Spinner />
            <p className="text-sm text-ink-muted">
              Building three lineups from the same roster…
            </p>
          </div>
        </Card>
      ) : null}

      {!working && comparison ? (
        <>
          <Notice tone="brand">
            All three use the same players, availability, pitching plan and locked
            assignments — and every rule you marked required still holds. The only
            difference is what InningGrid was asked to value.
          </Notice>

          {tradeoff ? (
            <Card>
              <div className="px-5 py-4">
                <p className="text-xs font-semibold tracking-wide text-ink-muted uppercase">
                  The trade-off
                </p>
                <p className="mt-1.5 text-base text-ink">{tradeoff}</p>
              </div>
            </Card>
          ) : null}

          {failed.length > 0 ? (
            <Notice
              tone="caution"
              title={`${failed.length} of 3 approaches couldn't satisfy your rules`}
            >
              {failed.map((approach) => (
                <p key={approach.philosophy}>
                  <span className="font-medium text-ink">{approach.label}:</span>{' '}
                  {approach.result.conflicts[0]?.message ?? 'No valid lineup.'}
                </p>
              ))}
            </Notice>
          ) : null}

          {display === 'cards' ? (
            <div className="grid gap-4 lg:grid-cols-3">
              {comparison.approaches.map((approach) => (
                <ApproachCard
                  key={approach.philosophy}
                  approach={approach}
                  isCurrent={game.settingsSnapshot.philosophy === approach.philosophy}
                  applying={applying === approach.philosophy}
                  disabled={applying !== null}
                  playerNameOf={(playerId) => {
                    const player = players.find((entry) => entry.id === playerId);
                    return player ? playerName(player) : 'A player';
                  }}
                  onApply={() => apply(approach)}
                />
              ))}
            </div>
          ) : (
            <ComparisonTable comparison={comparison} />
          )}

          <div className="flex justify-end">
            <Button disabled={working} onClick={() => void run()}>
              Rebuild comparison
            </Button>
          </div>
        </>
      ) : null}
    </div>
  );
}

function ApproachCard({
  approach,
  isCurrent,
  applying,
  disabled,
  playerNameOf,
  onApply,
}: {
  approach: ApproachOutcome;
  isCurrent: boolean;
  applying: boolean;
  disabled: boolean;
  playerNameOf: (playerId: string) => string;
  onApply: () => void;
}) {
  const metrics = approach.result.quality.metrics.filter((metric) =>
    ['playingTime', 'positionVariety', 'infieldOpportunity', 'defensiveStrength'].includes(
      metric.key,
    ),
  );

  return (
    // A labelled region per approach, so the three comparable blocks are
    // navigable and distinguishable rather than three anonymous cards.
    <Card
      role="region"
      aria-label={approach.label}
      className={cn('flex flex-col', isCurrent && 'border-brand')}
    >
      <div className="border-b border-border px-5 py-4">
        <div className="flex items-start justify-between gap-2">
          <h2 className="text-base font-semibold text-ink">{approach.label}</h2>
          {isCurrent ? <Badge tone="brand">Current</Badge> : null}
        </div>
        <p className="mt-1 text-sm text-ink-muted">{approach.description}</p>
      </div>

      <div className="flex-1 space-y-4 px-5 py-4">
        {approach.result.ok ? (
          <>
            {metrics.map((metric) => (
              <div key={metric.key}>
                <div className="flex items-baseline justify-between gap-2">
                  <p className="text-sm text-ink">{metric.label}</p>
                  <p className="text-xs font-medium text-ink-muted">
                    {RATING_LABEL[metric.rating]}
                    <span className="ml-1.5 text-ink-subtle">{percent(metric.value)}</span>
                  </p>
                </div>
                {/*
                  One hue, not severity colours. Here the meters compare
                  magnitude between three options the coach is choosing
                  among — a red bar would read as a defect when low defensive
                  strength is precisely the trade Equal Playing Time makes on
                  purpose. Severity colouring belongs on the lineup-quality
                  panel, which assesses a single lineup's state.
                */}
                <Meter className="mt-1.5" value={metric.value} tone="brand" />
              </div>
            ))}

            <dl className="space-y-1.5 border-t border-border pt-3 text-sm">
              <div className="flex justify-between gap-2">
                <dt className="text-ink-muted">Innings played</dt>
                <dd className="tnum font-medium text-ink">
                  {approach.minInnings === approach.maxInnings
                    ? `${approach.minInnings} each`
                    : `${approach.minInnings}–${approach.maxInnings}`}
                </dd>
              </div>
              {approach.mostBenched[0] ? (
                <div className="flex justify-between gap-2">
                  <dt className="text-ink-muted">Plays least</dt>
                  <dd className="min-w-0 truncate font-medium text-ink">
                    {playerNameOf(approach.mostBenched[0].playerId)}
                  </dd>
                </div>
              ) : null}
            </dl>
          </>
        ) : (
          <p className="text-sm text-ink-muted">
            {approach.result.conflicts[0]?.message ??
              'No lineup satisfies your rules under this approach.'}
          </p>
        )}
      </div>

      <div className="border-t border-border px-5 py-4">
        <Button
          variant={isCurrent ? 'secondary' : 'primary'}
          className="w-full"
          disabled={disabled || !approach.result.ok}
          onClick={onApply}
        >
          {applying ? (
            <>
              <Spinner /> Applying…
            </>
          ) : (
            'Use this lineup'
          )}
        </Button>
      </div>
    </Card>
  );
}

/** The table view, so nothing is gated behind reading a chart. */
function ComparisonTable({ comparison }: { comparison: Comparison }) {
  return (
    <Card>
      <CardHeader title="Side by side" />
      <div className="overflow-x-auto">
        <table className="w-full border-collapse text-sm">
          <thead>
            <tr className="border-b border-border">
              <th className="px-4 py-2 text-left text-xs font-semibold tracking-wide text-ink-muted uppercase">
                Measure
              </th>
              {comparison.approaches.map((approach) => (
                <th
                  key={approach.philosophy}
                  className="px-4 py-2 text-right text-xs font-semibold tracking-wide text-ink-muted uppercase"
                >
                  {approach.label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {comparison.metrics.map((metric) => {
              const best = Math.max(
                ...comparison.approaches.map(
                  (approach) => metric.values[approach.philosophy] ?? 0,
                ),
              );
              return (
                <tr key={metric.key} className="border-b border-border last:border-0">
                  <th scope="row" className="px-4 py-2 text-left font-medium text-ink">
                    {metric.label}
                  </th>
                  {comparison.approaches.map((approach) => {
                    const value = metric.values[approach.philosophy];
                    return (
                      <td
                        key={approach.philosophy}
                        className={cn(
                          'tnum px-4 py-2 text-right',
                          value !== undefined && value >= best
                            ? 'font-semibold text-ink'
                            : 'text-ink-muted',
                        )}
                      >
                        {value === undefined ? '—' : percent(value)}
                      </td>
                    );
                  })}
                </tr>
              );
            })}
            <tr className="border-t border-border">
              <th scope="row" className="px-4 py-2 text-left font-medium text-ink">
                Innings played
              </th>
              {comparison.approaches.map((approach) => (
                <td
                  key={approach.philosophy}
                  className="tnum px-4 py-2 text-right text-ink-muted"
                >
                  {approach.minInnings === approach.maxInnings
                    ? `${approach.minInnings} each`
                    : `${approach.minInnings}–${approach.maxInnings}`}
                </td>
              ))}
            </tr>
          </tbody>
        </table>
      </div>
    </Card>
  );
}
