'use client';

import { useDugout } from '@/app/providers';
import {
  Badge,
  Button,
  Card,
  CardHeader,
  EmptyState,
  GROUP_STYLE,
  Notice,
} from '@/components/ui';
import { createId, playerName, playerShortName } from '@/domain/factories';
import type { PriorityFlag } from '@/domain/types';
import { getFairnessDebt, getTeamSeasonFairness } from '@/services/fairness';
import {
  getPlayerSeasonUsage,
  getPositionDistribution,
} from '@/services/seasonStatistics';
import { cn } from '@/lib/cn';
import { formatShortDate, formatSigned, percent } from '@/lib/format';
import Link from 'next/link';
import { useMemo } from 'react';

export default function SeasonPage() {
  const { ready, team, players, activePlayers, games, flags, saveFlag, clearFlags } =
    useDugout();

  const completed = useMemo(
    () => games.filter((game) => game.status === 'COMPLETED'),
    [games],
  );

  const usage = useMemo(() => getPlayerSeasonUsage(games), [games]);
  const debts = useMemo(() => getFairnessDebt(games, players), [games, players]);
  const fairness = useMemo(
    () => getTeamSeasonFairness(games, players),
    [games, players],
  );
  const distribution = useMemo(() => getPositionDistribution(games), [games]);

  if (!ready) return null;

  if (!team) {
    return (
      <EmptyState
        title="No team yet"
        action={
          <Link href="/setup">
            <Button variant="primary">Create your team</Button>
          </Link>
        }
      />
    );
  }

  if (completed.length === 0) {
    return (
      <div className="space-y-6">
        <h1 className="text-2xl font-semibold tracking-tight text-ink">Season</h1>
        <Card>
          <EmptyState
            title="No completed games yet"
            description="Record a game's results and Dugout starts tracking playing time, positions and fairness across the season."
            action={
              <Link href="/">
                <Button variant="primary">Back to dashboard</Button>
              </Link>
            }
          />
        </Card>
      </div>
    );
  }

  const maxPositionCount = Math.max(
    1,
    ...activePlayers.flatMap((player) =>
      distribution.codes.map((code) => distribution.byPlayer[player.id]?.[code.code] ?? 0),
    ),
  );

  const prioritize = async (playerId: string, kind: PriorityFlag['kind']) => {
    await saveFlag({
      id: createId('flag'),
      teamId: team.id,
      playerId,
      kind,
      createdAt: new Date().toISOString(),
    });
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-ink">Season</h1>
          <p className="mt-1 text-sm text-ink-muted">
            {completed.length} {completed.length === 1 ? 'game' : 'games'} ·{' '}
            {fairness.averageDefensiveInnings.toFixed(1)} average defensive innings
          </p>
        </div>
        <Badge tone={fairness.balanceScore >= 0.8 ? 'positive' : 'caution'}>
          Season balance {percent(fairness.balanceScore)}
        </Badge>
      </div>

      {flags.length > 0 ? (
        <Notice
          tone="brand"
          title={`${flags.length} ${flags.length === 1 ? 'player is' : 'players are'} prioritized for the next game`}
          action={
            <Button size="sm" onClick={clearFlags}>
              Clear priorities
            </Button>
          }
        >
          {flags
            .map((flag) => {
              const player = players.find((entry) => entry.id === flag.playerId);
              return player ? playerName(player) : null;
            })
            .filter(Boolean)
            .join(', ')}
        </Notice>
      ) : null}

      {fairness.alerts.length > 0 ? (
        <Card>
          <CardHeader
            title="Fairness alerts"
            description="Tap Prioritize and Dugout will lean toward that player when it builds the next lineup."
          />
          <ul className="divide-y divide-border">
            {fairness.alerts.slice(0, 6).map((alert) => (
              <li
                key={alert.id}
                className="flex flex-wrap items-center gap-3 px-5 py-3"
              >
                <span className="min-w-0 flex-1 text-sm text-ink">{alert.message}</span>
                <Button
                  size="sm"
                  variant="ghost"
                  disabled={flags.some(
                    (flag) =>
                      flag.playerId === alert.playerId && flag.kind === alert.priorityKind,
                  )}
                  onClick={() => prioritize(alert.playerId, alert.priorityKind)}
                >
                  {flags.some(
                    (flag) =>
                      flag.playerId === alert.playerId && flag.kind === alert.priorityKind,
                  )
                    ? 'Prioritized'
                    : 'Prioritize next game'}
                </Button>
              </li>
            ))}
          </ul>
        </Card>
      ) : null}

      <Card>
        <CardHeader
          title="Defensive playing time"
          description="From recorded results only — unplayed innings never count."
        />
        <div className="overflow-x-auto">
          <table className="w-full border-collapse text-sm">
            <thead>
              <tr className="border-b border-border">
                <th className="px-4 py-2 text-left text-xs font-semibold tracking-wide text-ink-muted uppercase">
                  Player
                </th>
                {['Games', 'Total', 'Bench', 'IF', 'OF', 'P', 'C', 'Debt'].map((header) => (
                  <th
                    key={header}
                    className="px-3 py-2 text-right text-xs font-semibold tracking-wide text-ink-muted uppercase"
                  >
                    {header}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {activePlayers.map((player) => {
                const record = usage[player.id];
                const debt = debts[player.id];
                return (
                  <tr key={player.id} className="border-b border-border last:border-0">
                    <th scope="row" className="px-4 py-2 text-left">
                      <Link
                        href={`/roster/${player.id}`}
                        className="ring-focus text-sm font-medium text-ink hover:underline"
                      >
                        {playerName(player)}
                      </Link>
                    </th>
                    <Cell value={record?.games ?? 0} />
                    <Cell value={record?.defensiveInnings ?? 0} strong />
                    <Cell value={record?.benchInnings ?? 0} />
                    <Cell value={record?.byGroup.INFIELD ?? 0} />
                    <Cell value={record?.byGroup.OUTFIELD ?? 0} />
                    <Cell value={record?.pitchingInnings ?? 0} />
                    <Cell value={record?.catchingInnings ?? 0} />
                    <td
                      className={cn(
                        'tnum px-3 py-2 text-right text-sm font-medium',
                        (debt?.defensiveDebt ?? 0) >= 1
                          ? 'text-caution'
                          : (debt?.defensiveDebt ?? 0) <= -1
                            ? 'text-ink-subtle'
                            : 'text-ink-muted',
                      )}
                      title="Positive means Dugout owes this player more innings"
                    >
                      {formatSigned(debt?.defensiveDebt ?? 0)}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </Card>

      <Card>
        <CardHeader
          title="Position breakdown"
          description="Every position used this season, including formations you no longer play."
        />
        <div className="overflow-x-auto">
          <table className="w-full border-collapse text-sm">
            <thead>
              <tr className="border-b border-border">
                <th className="px-4 py-2 text-left text-xs font-semibold tracking-wide text-ink-muted uppercase">
                  Player
                </th>
                {distribution.codes.map((code) => (
                  <th
                    key={code.code}
                    title={code.displayName}
                    className={cn(
                      'px-2 py-2 text-center text-xs font-semibold uppercase',
                      GROUP_STYLE[code.group].text,
                    )}
                  >
                    {code.code}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {activePlayers.map((player) => (
                <tr key={player.id} className="border-b border-border last:border-0">
                  <th
                    scope="row"
                    className="px-4 py-1.5 text-left text-sm font-medium whitespace-nowrap text-ink"
                  >
                    {playerShortName(player)}
                  </th>
                  {distribution.codes.map((code) => {
                    const count = distribution.byPlayer[player.id]?.[code.code] ?? 0;
                    // Restrained heat map: opacity only, no rainbow.
                    const intensity = count === 0 ? 0 : 0.12 + 0.68 * (count / maxPositionCount);
                    return (
                      <td key={code.code} className="p-0.5 text-center">
                        <span
                          className="tnum block rounded-md py-1.5 text-xs font-medium"
                          style={{
                            backgroundColor:
                              count === 0
                                ? 'transparent'
                                : `color-mix(in srgb, var(--brand) ${Math.round(intensity * 100)}%, transparent)`,
                            color: count === 0 ? 'var(--ink-subtle)' : 'var(--ink)',
                          }}
                        >
                          {count === 0 ? '·' : count}
                        </span>
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>

      <Card>
        <CardHeader title="Games" />
        <ul className="divide-y divide-border">
          {games.map((game) => (
            <li key={game.id}>
              <Link
                href={`/games/${game.id}`}
                className="ring-focus flex items-center gap-3 px-5 py-3 hover:bg-surface-muted"
              >
                <span className="w-16 shrink-0 text-sm text-ink-muted">
                  {formatShortDate(game.date)}
                </span>
                <span className="min-w-0 flex-1 truncate text-sm font-medium text-ink">
                  vs {game.opponent || 'TBD'}
                </span>
                {game.status === 'COMPLETED' ? (
                  <Badge tone="neutral">
                    {game.actualInnings} of {game.plannedInnings} innings
                  </Badge>
                ) : (
                  <Badge tone="brand">Upcoming</Badge>
                )}
              </Link>
            </li>
          ))}
        </ul>
      </Card>
    </div>
  );
}

function Cell({ value, strong = false }: { value: number; strong?: boolean }) {
  return (
    <td
      className={cn(
        'tnum px-3 py-2 text-right text-sm',
        strong ? 'font-semibold text-ink' : 'text-ink-muted',
      )}
    >
      {value}
    </td>
  );
}
