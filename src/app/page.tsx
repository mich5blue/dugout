'use client';

import { useDugout } from './providers';
import {
  Badge,
  Button,
  Card,
  CardHeader,
  EmptyState,
  Notice,
  Spinner,
} from '@/components/ui';
import {
  getFairnessDebt,
  getTeamSeasonFairness,
  standingCounts,
} from '@/services/fairness';
import { formatShortDate } from '@/lib/format';
import { upcomingGames } from '@/lib/schedule';
import { createId } from '@/domain/factories';
import { AwaitingResults } from '@/components/game/AwaitingResults';
import { FairnessSnapshot } from '@/components/home/FairnessSnapshot';
import { NextGameCard } from '@/components/home/NextGameCard';
import { MoveLocalData } from '@/components/MoveLocalData';
import { recordActualResults } from '@/services/lineupService';
import type { FairnessAlert } from '@/domain/season';
import Link from 'next/link';
import { useMemo, useState } from 'react';

export default function HomePage() {
  const {
    ready,
    team,
    players,
    activePlayers,
    games,
    seedDemoTeam,
    saveGame,
    flags,
    saveFlag,
  } = useDugout();
  const [seeding, setSeeding] = useState(false);

  /* Season order comes from lib/schedule so this agrees with the Schedule
     page and the pager on a game. */
  const upcomingList = useMemo(() => upcomingGames(games), [games]);
  const upcoming = upcomingList[0] ?? null;
  /** The next few after this one; the rest are a count behind one link. */
  const laterGames = useMemo(() => upcomingList.slice(1, 4), [upcomingList]);
  const moreCount = Math.max(0, upcomingList.length - 4);

  /** Most recent first: the last thing played is the thing worth glancing at. */
  const recentGames = useMemo(
    () =>
      [...games]
        .filter((game) => game.status === 'COMPLETED')
        .sort((a, b) => b.date.localeCompare(a.date))
        .slice(0, 3),
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
   * Owed / On target / Ahead.
   *
   * Deliberately not the spread of raw innings totals: a player who missed a
   * game has fewer innings without having been treated unfairly, which is the
   * whole reason fairness is measured as expected-versus-actual.
   */
  const standings = useMemo(
    () => standingCounts(players, getFairnessDebt(games, players)),
    [games, players],
  );

  const prioritize = async (alert: FairnessAlert) => {
    if (!team) return;
    await saveFlag({
      id: createId('flag'),
      teamId: team.id,
      playerId: alert.playerId,
      kind: alert.priorityKind,
      createdAt: new Date().toISOString(),
    });
  };

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
          <Link href="/guide">
            <Button variant="ghost" size="lg" className="w-full sm:w-auto">
              How it works
            </Button>
          </Link>
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

      {/* Above everything: a played game that has not been recorded is the one
          thing blocking every number further down the page. */}
      <AwaitingResults
        games={games}
        onRecord={async (game, innings) => {
          await saveGame(recordActualResults(game, innings));
        }}
      />

      {activePlayers.length === 0 ? (
        <Notice
          tone="caution"
          title="Add your roster"
          action={
            <Link href="/team">
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

      {/*
        The greeting earns its place by naming the team and the season, which
        is the only orientation a coach running two teams needs. It is small
        on purpose — the next game is the headline, not the brand.
      */}
      <div>
        <p className="eyebrow text-accent">
          {team.seasonName}
          {team.division ? ` · ${team.division}` : ''}
        </p>
        <h1 className="display mt-1 text-3xl text-ink sm:text-4xl">{team.name}</h1>
      </div>

      {upcoming ? (
        <NextGameCard game={upcoming} />
      ) : (
        <Card>
          <EmptyState
            title="No game scheduled"
            description="Add your next game and InningGrid will have a lineup ready in under a minute."
            action={
              <Link href="/games/new">
                <Button variant="primary" size="lg">
                  Add a game
                </Button>
              </Link>
            }
          />
        </Card>
      )}

      <div className="grid gap-4 lg:grid-cols-[1fr_1fr]">
        {completedCount > 0 ? (
          <FairnessSnapshot
            counts={standings}
            alerts={fairness?.alerts ?? []}
            onPrioritize={prioritize}
            prioritized={(alert) =>
              flags.some(
                (flag) =>
                  flag.playerId === alert.playerId && flag.kind === alert.priorityKind,
              )
            }
          />
        ) : (
          <Card>
            <CardHeader
              title="Season fairness"
              description="Starts the moment you record your first result."
            />
            <div className="px-5 py-5 text-sm text-ink-muted">
              <p>
                Record what was actually played after a game and InningGrid begins
                tracking who is owed innings — then evens it out in the lineups that
                follow.
              </p>
            </div>
          </Card>
        )}

        <Card>
          <CardHeader
            title="Recent games"
            action={
              <Link href="/games">
                <Button size="sm" variant="ghost">
                  Full schedule
                </Button>
              </Link>
            }
          />
          {recentGames.length > 0 ? (
            <ul className="divide-y divide-border">
              {recentGames.map((game) => (
                <li key={game.id}>
                  <Link
                    href={`/games/${game.id}`}
                    className="ring-focus flex items-center gap-3 px-5 py-3 transition-colors hover:bg-surface-muted"
                  >
                    <span className="w-14 shrink-0 text-xs text-ink-muted">
                      {formatShortDate(game.date)}
                    </span>
                    <span className="min-w-0 flex-1 truncate text-sm font-medium text-ink">
                      vs {game.opponent || 'TBD'}
                    </span>
                    <Badge tone="neutral">
                      {game.actualInnings ?? game.plannedInnings} innings
                    </Badge>
                  </Link>
                </li>
              ))}
            </ul>
          ) : (
            <EmptyState
              title="Nothing played yet"
              description="Your recorded games will appear here."
            />
          )}
          {laterGames.length > 0 ? (
            <div className="border-t border-border px-5 py-3">
              <p className="eyebrow text-ink-subtle">Coming up after this one</p>
              <ul className="mt-1.5 space-y-0.5">
                {laterGames.map((game) => (
                  <li key={game.id}>
                    <Link
                      href={`/games/${game.id}`}
                      className="ring-focus -mx-2 flex items-baseline gap-2 rounded-md px-2 py-1 transition-colors hover:bg-surface-muted"
                    >
                      <span className="min-w-0 flex-1 truncate text-sm text-ink">
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
        </Card>
      </div>
    </div>
  );
}
