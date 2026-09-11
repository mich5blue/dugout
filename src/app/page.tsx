'use client';

import { useDugout } from './providers';
import {
  Badge,
  Button,
  Card,
  CardHeader,
  EmptyState,
  Meter,
  Notice,
  PlayerChip,
  Spinner,
  StatTile,
} from '@/components/ui';
import { getFairnessDebt, getTeamSeasonFairness } from '@/services/fairness';
import { formatDayAndDate, formatGameDate, percent } from '@/lib/format';
import { playerName } from '@/domain/factories';
import Link from 'next/link';
import { useMemo, useState } from 'react';

export default function DashboardPage() {
  const { ready, team, players, activePlayers, games, seedDemoTeam } = useDugout();
  const [seeding, setSeeding] = useState(false);

  const upcoming = useMemo(
    () =>
      [...games]
        .filter((game) => game.status !== 'COMPLETED')
        .sort((a, b) => a.date.localeCompare(b.date))[0] ?? null,
    [games],
  );

  const lastGame = useMemo(
    () =>
      [...games]
        .filter((game) => game.status === 'COMPLETED')
        .sort((a, b) => b.date.localeCompare(a.date))[0] ?? null,
    [games],
  );

  const fairness = useMemo(
    () => (team ? getTeamSeasonFairness(games, players) : null),
    [games, players, team],
  );

  const completedCount = useMemo(
    () => games.filter((game) => game.status === 'COMPLETED').length,
    [games],
  );

  /**
   * The most innings Dugout currently owes any player.
   *
   * Deliberately not the spread of raw innings totals: a player who missed a
   * game has fewer innings without having been treated unfairly, which is the
   * whole reason fairness is measured as expected-versus-actual.
   */
  const mostOwed = useMemo(() => {
    if (!team || completedCount === 0) return null;
    const debts = getFairnessDebt(games, players);
    const owed = activePlayers
      .map((player) => ({ player, debt: debts[player.id]?.defensiveDebt ?? 0 }))
      .sort((a, b) => b.debt - a.debt)[0];
    return owed && owed.debt > 0.1 ? owed : null;
  }, [activePlayers, completedCount, games, players, team]);

  if (!ready) {
    return (
      <div className="flex items-center gap-3 py-20 text-ink-muted">
        <Spinner />
        <span className="text-sm">Loading your team…</span>
      </div>
    );
  }

  if (!team) {
    return (
      <div className="mx-auto max-w-2xl py-10">
        <h1 className="text-3xl font-semibold tracking-tight text-ink sm:text-4xl">
          Smart lineups for youth baseball &amp; softball.
        </h1>
        <p className="mt-4 text-lg text-ink-muted">
          Pick who&apos;s playing, choose how you want to coach, and generate a full
          batting order and inning-by-inning defense. Dugout remembers what
          actually happened and makes the whole season fair.
        </p>

        <div className="mt-8 flex flex-col gap-3 sm:flex-row">
          <Link href="/setup">
            <Button variant="primary" size="lg" className="w-full sm:w-auto">
              Create your team
            </Button>
          </Link>
          <Button
            size="lg"
            className="w-full sm:w-auto"
            disabled={seeding}
            onClick={async () => {
              setSeeding(true);
              try {
                await seedDemoTeam();
              } finally {
                setSeeding(false);
              }
            }}
          >
            {seeding ? (
              <>
                <Spinner /> Building demo season…
              </>
            ) : (
              'Explore the demo team'
            )}
          </Button>
        </div>

        <div className="mt-10 grid gap-3 sm:grid-cols-3">
          {[
            {
              title: 'Fair playing time',
              body: 'Equal innings, rotated bench, and an infield opportunity for everyone.',
            },
            {
              title: 'Season-aware',
              body: 'Missed innings carry forward, and the next game makes them up.',
            },
            {
              title: 'Rebalance in seconds',
              body: 'A kid drops out 45 minutes before first pitch? One tap fixes the whole game.',
            },
          ].map((item) => (
            <Card key={item.title} className="p-4">
              <p className="text-sm font-semibold text-ink">{item.title}</p>
              <p className="mt-1 text-sm text-ink-muted">{item.body}</p>
            </Card>
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div>
        <p className="text-sm font-medium tracking-wide text-ink-muted uppercase">
          {team.seasonName}
          {team.division ? ` · ${team.division}` : ''}
        </p>
        <h1 className="mt-1 text-3xl font-semibold tracking-tight text-ink">{team.name}</h1>
        <p className="mt-1 text-sm text-ink-muted">
          {activePlayers.length} {activePlayers.length === 1 ? 'player' : 'players'} ·{' '}
          {team.defaultInnings}-inning games
        </p>
      </div>

      {fairness && completedCount > 0 ? (
        <Card>
          <div className="grid gap-6 px-5 py-5 sm:grid-cols-[auto_1fr] sm:items-end sm:gap-10">
            <div>
              <StatTile
                hero
                label="Season balance"
                value={percent(fairness.balanceScore)}
                hint={
                  fairness.balanceScore >= 0.8
                    ? 'Playing time is even across the roster'
                    : 'Dugout is still evening this out'
                }
              />
              <Meter
                className="mt-3 max-w-48"
                value={fairness.balanceScore}
                tone={fairness.balanceScore >= 0.8 ? 'positive' : 'caution'}
              />
            </div>

            <dl className="grid grid-cols-2 gap-5 sm:grid-cols-3">
              <StatTile label="Games played" value={completedCount} />
              <StatTile
                label="Avg innings"
                value={fairness.averageDefensiveInnings.toFixed(1)}
                hint="Defensive innings per player"
              />
              <StatTile
                label="Most owed"
                value={mostOwed ? mostOwed.debt.toFixed(1) : '0'}
                hint={
                  mostOwed
                    ? `Innings — ${mostOwed.player.firstName} next game`
                    : 'Nobody is behind'
                }
              />
            </dl>
          </div>
        </Card>
      ) : null}

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader title="Next game" />
          {upcoming ? (
            <div className="px-5 py-5">
              <p className="text-2xl font-semibold tracking-tight text-ink">
                vs {upcoming.opponent || 'TBD'}
              </p>
              <p className="mt-1 text-sm text-ink-muted">{formatGameDate(upcoming.date)}</p>
              <div className="mt-5 flex flex-wrap gap-2">
                <Link href={`/games/${upcoming.id}`}>
                  <Button variant="primary" size="lg">
                    {upcoming.defensiveAssignments.length > 0
                      ? 'Open lineup'
                      : 'Build lineup'}
                  </Button>
                </Link>
                <Link href="/games/new">
                  <Button size="lg">New game</Button>
                </Link>
              </div>
            </div>
          ) : (
            <EmptyState
              title="No game scheduled"
              description="Create a game and Dugout will build the lineup."
              action={
                <Link href="/games/new">
                  <Button variant="primary">New game</Button>
                </Link>
              }
            />
          )}
        </Card>

        <Card>
          <CardHeader title="Last game" />
          {lastGame ? (
            <div className="px-5 py-5">
              <p className="text-2xl font-semibold tracking-tight text-ink">
                vs {lastGame.opponent}
              </p>
              <p className="mt-1 text-sm text-ink-muted">
                {formatDayAndDate(lastGame.date)} ·{' '}
                {lastGame.actualInnings ?? lastGame.plannedInnings} innings played
              </p>
              <div className="mt-5 flex flex-wrap gap-2">
                <Link href={`/games/${lastGame.id}`}>
                  <Button>View lineup</Button>
                </Link>
                <Link href="/season">
                  <Button variant="ghost">Season totals</Button>
                </Link>
              </div>
            </div>
          ) : (
            <EmptyState
              title="No completed games yet"
              description="Once you record a game, Dugout starts balancing the season."
            />
          )}
        </Card>
      </div>

      {fairness && fairness.alerts.length > 0 ? (
        <Card>
          <CardHeader
            title="Fairness alerts"
            description="Imbalances Dugout will try to fix in the next game."
            action={
              <Link href="/season">
                <Button size="sm" variant="ghost">
                  View season
                </Button>
              </Link>
            }
          />
          <ul className="divide-y divide-border">
            {fairness.alerts.slice(0, 4).map((alert) => {
              const player = players.find((entry) => entry.id === alert.playerId);
              if (!player) return null;
              return (
                <li key={alert.id}>
                  <Link
                    href={`/roster/${player.id}`}
                    className="ring-focus flex items-center gap-3 px-5 py-3 transition-colors hover:bg-surface-muted"
                  >
                    <PlayerChip
                      name={playerName(player)}
                      jerseyNumber={player.jerseyNumber}
                      className="w-44 shrink-0"
                    />
                    <span className="min-w-0 flex-1 text-sm text-ink-muted">
                      {alert.message.replace(`${playerName(player)} `, '')}
                    </span>
                  </Link>
                </li>
              );
            })}
          </ul>
        </Card>
      ) : null}

      {activePlayers.length === 0 ? (
        <Notice
          tone="caution"
          title="Add your roster"
          action={
            <Link href="/roster">
              <Button size="sm" variant="primary">
                Add players
              </Button>
            </Link>
          }
        >
          Dugout needs a roster before it can build a lineup. Paste a list of names
          and you&apos;ll be done in under a minute.
        </Notice>
      ) : null}

      <div className="grid gap-3 sm:grid-cols-3">
        {[
          { href: '/roster', label: 'Roster', hint: 'Players, positions, eligibility' },
          { href: '/season', label: 'Season', hint: 'Playing time and position history' },
          { href: '/settings', label: 'Team Settings', hint: 'Formation, rules, philosophy' },
        ].map((item) => (
          <Link key={item.href} href={item.href} className="ring-focus rounded-card">
            <Card className="h-full p-4 transition-colors hover:border-border-strong">
              <p className="text-sm font-semibold text-ink">{item.label}</p>
              <p className="mt-1 text-sm text-ink-muted">{item.hint}</p>
            </Card>
          </Link>
        ))}
      </div>
    </div>
  );
}
