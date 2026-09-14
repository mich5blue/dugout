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
import { formatDayAndDate, formatGameDate, formatShortDate, percent } from '@/lib/format';
import { upcomingGames } from '@/lib/schedule';
import { playerName } from '@/domain/factories';
import { AwaitingResults } from '@/components/game/AwaitingResults';
import { MoveLocalData } from '@/components/MoveLocalData';
import { recordActualResults } from '@/services/lineupService';
import Link from 'next/link';
import { useMemo, useState } from 'react';

export default function DashboardPage() {
  const { ready, team, players, activePlayers, games, seedDemoTeam, saveGame } =
    useDugout();
  const [seeding, setSeeding] = useState(false);

  /* Season order comes from lib/schedule so this agrees with the Schedule
     page and the pager on a game. */
  const upcomingList = useMemo(() => upcomingGames(games), [games]);
  const upcoming = upcomingList[0] ?? null;
  /** The next few after this one; the rest are a count behind one link. */
  const laterGames = useMemo(() => upcomingList.slice(1, 4), [upcomingList]);
  const moreCount = Math.max(0, upcomingList.length - 4);

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
   * The most innings InningGrid currently owes any player.
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
        <div className="mb-6 empty:hidden">
          <MoveLocalData />
        </div>
        <p className="eyebrow text-accent">Youth baseball &amp; softball</p>
        <h1 className="display mt-2 text-6xl text-ink sm:text-7xl">
          Smart lineups, <span className="text-accent">every inning.</span>
        </h1>
        <p className="mt-5 text-lg text-ink-muted">
          Pick who&apos;s playing, choose how you want to coach, and generate a full
          batting order and inning-by-inning defense. InningGrid remembers what
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
            <Card
              key={item.title}
              className="border-t-2 border-t-accent/50 p-4 pt-3.5"
            >
              <p className="eyebrow text-ink">{item.title}</p>
              <p className="mt-1.5 text-sm text-ink-muted">{item.body}</p>
            </Card>
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <MoveLocalData />

      {/* Above the season card on purpose: those numbers are empty until
          these are logged. */}
      <AwaitingResults
        games={games}
        onRecord={async (game, innings) => {
          await saveGame(recordActualResults(game, innings));
        }}
      />

      <div>
        <p className="eyebrow text-accent">
          {team.seasonName}
          {team.division ? ` · ${team.division}` : ''}
        </p>
        <h1 className="display mt-1.5 text-5xl text-ink sm:text-6xl">{team.name}</h1>
        <p className="mt-2 text-sm text-ink-muted">
          <span className="tnum">{activePlayers.length}</span>{' '}
          {activePlayers.length === 1 ? 'player' : 'players'} ·{' '}
          <span className="tnum">{team.defaultInnings}</span>-inning games
        </p>
      </div>

      {/*
        The season scoreboard. The balance figure is the headline number of the
        whole product, so it gets the largest type on the page and a divider
        separating it from the supporting three — previously all four figures
        were the same size and the hierarchy was flat.
      */}
      {fairness && completedCount > 0 ? (
        <Card className="overflow-hidden">
          <div className="grid gap-6 px-5 py-6 sm:grid-cols-[minmax(0,auto)_1fr] sm:items-center sm:gap-10">
            <div className="accent-rule">
              <StatTile
                hero
                label="Season balance"
                value={percent(fairness.balanceScore)}
                hint={
                  fairness.balanceScore >= 0.8
                    ? 'Playing time is even across the roster'
                    : 'InningGrid is still evening this out'
                }
              />
              <Meter
                className="mt-3 max-w-48"
                value={fairness.balanceScore}
                tone={fairness.balanceScore >= 0.8 ? 'positive' : 'caution'}
              />
            </div>

            <dl className="grid grid-cols-2 gap-5 border-border sm:grid-cols-3 sm:border-l sm:pl-10">
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
          <CardHeader
            title="Next game"
            action={
              <Link href="/games">
                <Button size="sm" variant="ghost">
                  Full schedule
                </Button>
              </Link>
            }
          />
          {upcoming ? (
            <div className="px-5 py-5">
              <p className="flex flex-wrap items-baseline gap-2">
                <span className="scoreboard text-xl text-ink-subtle">vs</span>
                <span className="display text-4xl text-ink">
                  {upcoming.opponent || 'TBD'}
                </span>
              </p>
              <p className="mt-2 text-sm text-ink-muted">{formatGameDate(upcoming.date)}</p>
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

              {/*
                The games after this one. The card used to stop at the next
                game, which made a coach with four booked games unable to see
                past the first without opening each in turn.
              */}
              {laterGames.length > 0 ? (
                <div className="mt-5 border-t border-border pt-3">
                  <p className="eyebrow text-ink-subtle">Then</p>
                  <ul className="mt-1.5 space-y-0.5">
                    {laterGames.map((game) => (
                      <li key={game.id}>
                        <Link
                          href={`/games/${game.id}`}
                          className="ring-focus group -mx-2 flex items-baseline gap-2 rounded-md px-2 py-1.5 transition-colors hover:bg-surface-muted"
                        >
                          <span className="min-w-0 flex-1 truncate text-sm font-medium text-ink">
                            vs {game.opponent || 'TBD'}
                          </span>
                          <span className="shrink-0 text-xs text-ink-muted">
                            {formatShortDate(game.date)}
                          </span>
                        </Link>
                      </li>
                    ))}
                  </ul>
                  {moreCount > 0 ? (
                    <Link
                      href="/games"
                      className="ring-focus mt-1.5 inline-block rounded-md text-xs text-ink-muted underline hover:text-ink"
                    >
                      {moreCount} more
                    </Link>
                  ) : null}
                </div>
              ) : null}
            </div>
          ) : (
            <EmptyState
              title="No game scheduled"
              description="Create a game and InningGrid will build the lineup."
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
              <p className="flex flex-wrap items-baseline gap-2">
                <span className="scoreboard text-xl text-ink-subtle">vs</span>
                <span className="display text-4xl text-ink">{lastGame.opponent}</span>
              </p>
              <p className="mt-2 text-sm text-ink-muted">
                {formatDayAndDate(lastGame.date)} ·{' '}
                <span className="tnum">
                  {lastGame.actualInnings ?? lastGame.plannedInnings}
                </span>{' '}
                innings played
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
              description="Once you record a game, InningGrid starts balancing the season."
            />
          )}
        </Card>
      </div>

      {fairness && fairness.alerts.length > 0 ? (
        <Card>
          <CardHeader
            title="Fairness alerts"
            description="Imbalances InningGrid will try to fix in the next game."
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
          InningGrid needs a roster before it can build a lineup. Paste a list of names
          and you&apos;ll be done in under a minute.
        </Notice>
      ) : null}

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {[
          { href: '/games', label: 'Schedule', hint: 'Every game, upcoming and played' },
          { href: '/roster', label: 'Roster', hint: 'Players, positions, eligibility' },
          { href: '/season', label: 'Season', hint: 'Playing time and position history' },
          { href: '/settings', label: 'Team Settings', hint: 'Formation, rules, philosophy' },
        ].map((item) => (
          <Link key={item.href} href={item.href} className="ring-focus rounded-card">
            <Card
              interactive
              className="h-full border-l-2 border-l-border-strong p-4 transition-colors hover:border-l-accent"
            >
              <p className="scoreboard text-xl text-ink">{item.label}</p>
              <p className="mt-1 text-sm text-ink-muted">{item.hint}</p>
            </Card>
          </Link>
        ))}
      </div>
    </div>
  );
}
