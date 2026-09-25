'use client';

import { useDugout } from '@/app/providers';
import {
  BalanceDial,
  BarChart,
  GroupLegend,
  HeatGrid,
  LineChart,
  type BarRow,
  type Series,
} from '@/components/season/charts';
import { PlayerSeasonCard } from '@/components/season/PlayerSeasonCard';
import {
  Badge,
  Button,
  Card,
  CardHeader,
  EmptyState,
  GROUP_STYLE,
  Notice,
  StatTile,
} from '@/components/ui';
import { createId } from '@/domain/factories';
import type { PositionGroup, PriorityFlag } from '@/domain/types';
import { getFairnessDebt, getTeamSeasonFairness, seasonOutlook } from '@/services/fairness';
import {
  getPlayerGameLog,
  getPlayerSeasonUsage,
  getPositionDistribution,
} from '@/services/seasonStatistics';
import { cn } from '@/lib/cn';
import { formatShortDate, formatSigned } from '@/lib/format';
import Link from 'next/link';
import { playerNames } from '@/lib/playerNames';
import { useMemo } from 'react';

/**
 * The season, as analytics rather than a spreadsheet.
 *
 * The page used to be four tables of integers, which answer "how much" only if
 * you already know what a normal number looks like. It now leads with the two
 * questions people actually ask — is this fair, and did my kid play enough —
 * and keeps the raw tables underneath for the coach who wants to check the
 * machine's arithmetic.
 */
export default function SeasonPage() {
  const { ready, team, players, activePlayers, games, flags, saveFlag, clearFlags } =
    useDugout();

  const completed = useMemo(
    () =>
      games
        .filter((game) => game.status === 'COMPLETED')
        .sort((a, b) => a.date.localeCompare(b.date) || a.createdAt.localeCompare(b.createdAt)),
    [games],
  );

  const names = useMemo(() => playerNames(players), [players]);

  const usage = useMemo(() => getPlayerSeasonUsage(games), [games]);
  const debts = useMemo(() => getFairnessDebt(games, players), [games, players]);
  const fairness = useMemo(
    () => getTeamSeasonFairness(games, players),
    [games, players],
  );
  const distribution = useMemo(() => getPositionDistribution(games), [games]);
  const log = useMemo(() => getPlayerGameLog(games), [games]);
  const outlook = useMemo(
    () => seasonOutlook(games, players, debts),
    [games, players, debts],
  );

  /* Sorted most innings first: the question is who is at each end. */
  const ranked = useMemo(
    () =>
      [...activePlayers].sort(
        (a, b) =>
          (usage[b.id]?.defensiveInnings ?? 0) - (usage[a.id]?.defensiveInnings ?? 0) ||
          names.short(a.id).localeCompare(names.short(b.id)),
      ),
    [activePlayers, usage, names],
  );

  const totals = ranked.map((player) => usage[player.id]?.defensiveInnings ?? 0);
  const spread = totals.length > 0 ? Math.max(...totals) - Math.min(...totals) : 0;

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
        <h1 className="display text-4xl text-ink sm:text-5xl">Season</h1>
        <Card>
          <EmptyState
            title="No completed games yet"
            description="Record a game's results and InningGrid starts tracking playing time, positions and fairness across the season."
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

  /* Playing time, split by where those innings were spent. */
  const playingTime: BarRow[] = ranked.map((player) => {
    const record = usage[player.id];
    const segments: Array<{ group: PositionGroup; value: number }> = [
      {
        group: 'BATTERY',
        value: (record?.pitchingInnings ?? 0) + (record?.catchingInnings ?? 0),
      },
      { group: 'INFIELD', value: record?.byGroup.INFIELD ?? 0 },
      { group: 'OUTFIELD', value: record?.byGroup.OUTFIELD ?? 0 },
    ];
    return {
      id: player.id,
      label: names.short(player.id),
      value: record?.defensiveInnings ?? 0,
      segments,
      highlight: (debts[player.id]?.defensiveDebt ?? 0) >= 1,
    };
  });

  /*
    Cumulative innings, carried forward across a game a player missed — a flat
    stretch is the honest picture of not being there, and dropping the point
    would have drawn a line that skipped the game entirely.
  */
  const series: Series[] = ranked.map((player) => {
    const byGame = new Map(
      (log[player.id] ?? []).map((line) => [line.gameId, line.innings]),
    );
    let running = 0;
    return {
      id: player.id,
      label: names.short(player.id),
      points: completed.map((game) => {
        running += byGame.get(game.id) ?? 0;
        return running;
      }),
      highlight: (debts[player.id]?.defensiveDebt ?? 0) >= 1,
    };
  });

  const heatRows = ranked.map((player) => {
    const byGame = new Map((log[player.id] ?? []).map((line) => [line.gameId, line]));
    return {
      id: player.id,
      label: names.short(player.id),
      cells: completed.map((game) => {
        const line = byGame.get(game.id);
        if (!line) return null;
        return {
          value: line.innings,
          of: line.gameInnings,
          title: `${names.short(player.id)} · vs ${game.opponent || 'TBD'} · ${line.innings} of ${line.gameInnings} innings, ${line.benchInnings} resting`,
        };
      }),
    };
  });

  const behind = ranked.filter((player) => (debts[player.id]?.defensiveDebt ?? 0) >= 1);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="eyebrow text-ink-subtle">Through {formatShortDate(completed[completed.length - 1].date)}</p>
          <h1 className="display mt-1 text-4xl text-ink sm:text-5xl">Season</h1>
        </div>
        <Badge tone={fairness.balanceScore >= 0.8 ? 'positive' : 'caution'}>
          {fairness.balanceScore >= 0.8 ? 'On track' : 'Needs evening out'}
        </Badge>
      </div>

      {/*
        The outlook, in a sentence, above the numbers.
        
        A coach who opens this page is asking whether the season is going to
        come out fair. "Season balance 93" is an answer to a different
        question — it grades the past. This says what today implies about the
        finish, and names anyone the remaining games cannot rescue.
      */}
      <Card className="rise">
        <div className="border-b border-border px-5 py-4">
          <p className="eyebrow text-ink-subtle">Season outlook</p>
          <p className="mt-1.5 text-[15px] leading-relaxed text-ink">{outlook.headline}</p>
          {outlook.atRisk.length > 0 ? (
            <p className="mt-2 flex flex-wrap items-center gap-2">
              {/* "Needs innings now" is nonsense once there are none left. */}
              <Badge tone="caution">
                {outlook.gamesRemaining === 0 ? 'Finished behind' : 'Needs innings now'}
              </Badge>
              <span className="text-sm text-ink-muted">
                {outlook.atRisk.map((playerId) => names.short(playerId)).join(', ')}
              </span>
            </p>
          ) : null}
        </div>
        <div className="grid gap-6 p-5 sm:grid-cols-[200px_1fr] sm:items-center">
          <BalanceDial value={fairness.balanceScore} label="Season balance" />
          <div className="grid grid-cols-2 gap-x-6 gap-y-5 sm:grid-cols-4">
            <StatTile label="Games" value={completed.length} hint="recorded results" />
            <StatTile
              label="Average"
              value={fairness.averageDefensiveInnings.toFixed(1)}
              hint="defensive innings each"
            />
            <StatTile
              label="Spread"
              value={spread}
              hint={spread === 0 ? 'everyone level' : 'most to fewest innings'}
            />
            <StatTile
              label="Owed innings"
              value={behind.length}
              hint={
                behind.length === 0
                  ? 'nobody is behind'
                  : behind.map((player) => names.short(player.id)).join(', ')
              }
            />
          </div>
        </div>
      </Card>

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
              return player ? names.full(player.id) : null;
            })
            .filter(Boolean)
            .join(', ')}
        </Notice>
      ) : null}

      <Card>
        <CardHeader
          title="Playing time"
          description="Defensive innings this season, split by where they were spent. The line is the team average; a lime name is a player the next lineup will favour."
        />
        <div className="px-5 pt-1 pb-4">
          <GroupLegend groups={['BATTERY', 'INFIELD', 'OUTFIELD']} className="mb-3" />
          <BarChart rows={playingTime} average={fairness.averageDefensiveInnings} />
        </div>
      </Card>

      {completed.length >= 2 ? (
        <Card>
          <CardHeader
            title="Fairness over the season"
            description="Innings added up game by game. Lines that stay bundled mean nobody is drifting; a line peeling away from the pack is a player being left behind."
          />
          <div className="px-3 pt-2 pb-4 sm:px-5">
            <LineChart
              series={series}
              labels={completed.map((game) => formatShortDate(game.date))}
            />
          </div>
        </Card>
      ) : null}

      <Card>
        <CardHeader
          title="Who played when"
          description="Innings in the field, game by game. A pale row is a player who has been quiet; a dashed cell is a game they missed."
        />
        <div className="px-5 pt-1 pb-4">
          <HeatGrid
            rows={heatRows}
            columns={completed.map((game) => game.opponent || 'TBD')}
          />
        </div>
      </Card>

      {/*
        Where everyone has played.

        The most-read thing on the page, so it is not behind a disclosure any
        more: a coach scanning for "who has never played infield" gets it in
        one look, and the dots make the gaps as loud as the numbers. The
        trailing count is the same question asked the other way round — how
        many different spots this player has seen all season.
      */}
      <Card>
        <CardHeader
          title="Where everyone has played"
          description="Innings at every position used this season, including formations you no longer play. A dot means never."
        />
        <div className="px-3 pt-1 pb-4 sm:px-5">
          <GroupLegend groups={['BATTERY', 'INFIELD', 'OUTFIELD']} className="mb-3" />
          <div className="overflow-x-auto">
            <table className="w-full border-collapse text-sm">
              <thead>
                <tr className="border-b border-border">
                  <th className="eyebrow sticky left-0 bg-surface px-2 py-2 text-left text-ink-subtle">
                    Player
                  </th>
                  {distribution.codes.map((code, index) => (
                    <th
                      key={code.code}
                      title={code.displayName}
                      className={cn(
                        'px-2 py-2 text-center text-xs font-semibold uppercase',
                        GROUP_STYLE[code.group].text,
                        /* A hairline where the group changes, so the three
                           blocks of the field read as blocks. */
                        index > 0 && distribution.codes[index - 1].group !== code.group
                          ? 'border-l border-border'
                          : null,
                      )}
                    >
                      {code.code}
                    </th>
                  ))}
                  <th className="eyebrow border-l border-border px-2 py-2 text-center text-ink-subtle">
                    Spots
                  </th>
                </tr>
              </thead>
              <tbody>
                {ranked.map((player) => (
                  <tr key={player.id} className="border-b border-border last:border-0">
                    <th
                      scope="row"
                      className="sticky left-0 bg-surface px-2 py-1.5 text-left text-sm font-medium whitespace-nowrap text-ink"
                    >
                      {names.short(player.id)}
                    </th>
                    {distribution.codes.map((code, index) => {
                      const count = distribution.byPlayer[player.id]?.[code.code] ?? 0;
                      /*
                        A neutral density ramp, not a hue ramp. The column
                        headers already carry position-group colour, so tinting
                        the cells with a second colour would double-encode; and
                        mixing ink into the surface stays legible in both modes,
                        which a --brand ramp does not (brand is near-black in
                        light mode, so a dark cell swallowed its own label).
                      */
                      /* Widened from the old 0.05-0.22: a season's counts sit
                         between one and five, and across that range the narrow
                         ramp made every filled cell the same grey. Capped at
                         32% so --ink still reads on top in both modes. */
                      const intensity =
                        count === 0 ? 0 : 0.06 + 0.26 * (count / maxPositionCount);
                      return (
                        <td
                          key={code.code}
                          className={cn(
                            'p-0.5 text-center',
                            index > 0 && distribution.codes[index - 1].group !== code.group
                              ? 'border-l border-border'
                              : null,
                          )}
                        >
                          <span
                            className="tnum block rounded-md py-1.5 text-xs font-medium"
                            style={{
                              backgroundColor:
                                count === 0
                                  ? 'transparent'
                                  : `color-mix(in srgb, var(--ink) ${Math.round(intensity * 100)}%, transparent)`,
                              color: count === 0 ? 'var(--ink-subtle)' : 'var(--ink)',
                            }}
                          >
                            {count === 0 ? '·' : count}
                          </span>
                        </td>
                      );
                    })}
                    <td className="border-l border-border p-0.5 text-center">
                      <span className="tnum block rounded-md py-1.5 text-xs font-semibold text-ink">
                        {usage[player.id]?.uniquePositionCodes ?? 0}
                        <span className="text-ink-subtle">/{distribution.codes.length}</span>
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </Card>

      {fairness.alerts.length > 0 ? (
        <Card>
          <CardHeader
            title="What to fix next game"
            description="Tap Prioritize and InningGrid will lean toward that player when it builds the next lineup."
          />
          <ul className="divide-y divide-border">
            {fairness.alerts.slice(0, 6).map((alert) => (
              <li key={alert.id} className="flex flex-wrap items-center gap-3 px-5 py-3">
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

      {/*
        The per-player view. This is the card a coach screenshots for a parent
        asking whether their kid plays enough — so it says it in words, not
        only in a bar.
      */}
      <section className="space-y-3">
        <div className="flex flex-wrap items-end justify-between gap-2">
          <h2 className="display text-2xl text-ink">Player by player</h2>
          <GroupLegend />
        </div>
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {ranked.map((player) => (
            <PlayerSeasonCard
              key={player.id}
              playerId={player.id}
              name={names.full(player.id)}
              jerseyNumber={player.jerseyNumber}
              usage={usage[player.id]}
              debt={debts[player.id]?.defensiveDebt ?? 0}
              log={log[player.id] ?? []}
            />
          ))}
        </div>
      </section>

      {/*
        Every number, for the coach who wants to check the arithmetic rather
        than read a chart. Collapsed, because it is the answer to a question
        almost nobody arrives with.
      */}
      <details className="group rounded-xl border border-border bg-surface">
        <summary className="ring-focus flex cursor-pointer items-center justify-between px-5 py-4 text-sm font-semibold text-ink">
          All the numbers
          <span aria-hidden className="text-ink-subtle transition-transform group-open:rotate-90">
            ›
          </span>
        </summary>

        <div className="space-y-6 border-t border-border px-5 py-5">
          <div>
            <p className="eyebrow text-ink-subtle">Defensive playing time</p>
            <p className="mt-1 mb-3 text-xs text-ink-muted">
              From recorded results only — unplayed innings never count.
            </p>
            <div className="overflow-x-auto">
              <table className="w-full border-collapse text-sm">
                <thead>
                  <tr className="border-b border-border">
                    <th className="eyebrow px-4 py-2 text-left text-ink-subtle">Player</th>
                    {['Games', 'Total', 'Rest', 'IF', 'OF', 'P', 'C', 'Debt'].map((header) => (
                      <th key={header} className="eyebrow px-3 py-2 text-right text-ink-subtle">
                        {header}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {ranked.map((player) => {
                    const record = usage[player.id];
                    const debt = debts[player.id];
                    return (
                      <tr key={player.id} className="border-b border-border last:border-0">
                        <th scope="row" className="px-4 py-2 text-left">
                          <Link
                            href={`/team/${player.id}`}
                            className="ring-focus text-sm font-medium text-ink hover:underline"
                          >
                            {names.full(player.id)}
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
                          title="Positive means InningGrid owes this player more innings"
                        >
                          {formatSigned(debt?.defensiveDebt ?? 0)}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>

        </div>
      </details>

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
