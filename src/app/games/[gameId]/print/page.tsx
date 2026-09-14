'use client';

import { useDugout } from '@/app/providers';
import { Button, EmptyState, SegmentedControl } from '@/components/ui';
import { cn } from '@/lib/cn';
import { formatGameDate } from '@/lib/format';
import { extraInningPlan } from '@/lib/gameDayChanges';
import { buildGameView, UNAVAILABLE } from '@/lib/gameView';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useMemo, useState } from 'react';

/**
 * Print view (spec section 57). Large type, hard black on white, no navigation
 * and no ink-hungry backgrounds. Compact mode fits a clipboard.
 */
export default function PrintPage() {
  const params = useParams<{ gameId: string }>();
  const { ready, team, players, games } = useDugout();
  const [mode, setMode] = useState<'full' | 'compact' | 'dugout'>('full');
  const compact = mode === 'compact';

  const game = games.find((entry) => entry.id === params.gameId) ?? null;
  const view = useMemo(
    () => (game ? buildGameView(game, players, 'PLANNED') : null),
    [game, players],
  );

  if (!ready) return null;

  if (!team || !game || !view) {
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

  const battingOrder = view.battingOrder();
  const extraInnings = extraInningPlan(view);

  /*
    Batting order and defensive assignments, as one table.

    On paper a coach reads down the batting order and needs to know where each
    kid is playing, and two separate tables meant looking up every name twice.
    Ordering the by-player grid by batting slot lets one table answer both.

    Anyone without a batting slot is appended rather than dropped — the
    optimizer gives every available player one, but a STARTERS_SUBS game or a
    hand-edited order could leave someone out, and silently omitting a player
    from the sheet the coach is holding is the worst possible failure here.
  */
  const slotByPlayer = new Map(battingOrder.map((entry) => [entry.player.id, entry.slot]));
  const lineupRows = [
    ...battingOrder.map((entry) => ({ player: entry.player, slot: entry.slot })),
    ...view.players
      .filter((player) => !slotByPlayer.has(player.id))
      .map((player) => ({ player, slot: undefined })),
  ];
  const cellPadding = compact ? 'px-1.5 py-1' : 'px-2 py-2';
  const textSize = compact ? 'text-[11px]' : 'text-sm';

  return (
    /*
      The controls sit on the app's own dark chrome; the sheet below is a real
      white page. The `paper` class flattens every colour token inside it, so
      this preview is literally what the printer produces — the Broadcast
      palette cannot leak onto paper, and a coach checking the printout before
      a game is looking at the printout.
    */
    <div className="mx-auto max-w-5xl px-4 py-6 print:max-w-none print:px-0 print:py-0">
      <div className="mb-5 flex flex-wrap items-center justify-between gap-2 print-hide">
        <Link href={`/games/${game.id}`}>
          <Button size="sm">← Back to lineup</Button>
        </Link>
        <div className="flex items-center gap-2">
          <SegmentedControl
            size="sm"
            label="Print layout"
            value={mode}
            onChange={setMode}
            options={[
              { value: 'full', label: 'Full page' },
              { value: 'compact', label: 'Compact' },
              { value: 'dugout', label: 'Dugout wall' },
            ]}
          />
          <Button size="sm" variant="primary" onClick={() => window.print()}>
            Print
          </Button>
        </div>
      </div>

      <div className="paper rounded-lg px-6 py-6 shadow-xl print:rounded-none print:px-0 print:py-0 print:shadow-none">
      <header className="mb-4 border-b-2 border-black pb-3">
        <div className="flex flex-wrap items-end justify-between gap-2">
          <div>
            <h1 className={compact ? 'text-xl font-bold' : 'text-3xl font-bold'}>
              {team.name} <span className="font-normal">vs</span> {game.opponent || 'TBD'}
            </h1>
            <p className={compact ? 'text-xs' : 'text-base'}>
              {formatGameDate(game.date)} · {game.plannedInnings} innings
            </p>
          </div>
          {mode === 'dugout' ? null : (
            <p className={compact ? 'text-[10px]' : 'text-sm'}>
              {game.formationSnapshot.positions.length} defenders
            </p>
          )}
        </div>
      </header>

      {/*
        Dugout wall. One sheet, taped up, for the players rather than the coach:
        find your name on the left, read across to the inning.

        So it is only that grid — no batting order, no by-position table, no
        pitcher contingency. Type is large enough to read from a step back, and
        every cell is ruled rather than banded: shading is what printers drop
        or lighten, and losing your place a row up or down is the whole failure
        mode of a wide grid. A legend decodes the position codes, because "LC"
        means nothing to a nine-year-old.
      */}
      {mode === 'dugout' ? (
        <section>
          <table className="w-full border-collapse border-2 border-black">
            <thead>
              <tr>
                <th className="border-2 border-black px-2 py-2 text-left text-base font-bold">
                  Player
                </th>
                {view.innings.map((inning) => (
                  <th
                    key={inning}
                    className="border-2 border-black px-2 py-2 text-center text-2xl font-bold"
                  >
                    {inning}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {lineupRows.map(({ player }) => (
                <tr key={player.id}>
                  <th
                    scope="row"
                    className="border-2 border-black px-2 py-2.5 text-left text-lg font-bold whitespace-nowrap"
                  >
                    {player.jerseyNumber ? (
                      <span className="tnum mr-2">{player.jerseyNumber}</span>
                    ) : null}
                    {view.names.plain(player.id)}
                  </th>
                  {view.innings.map((inning) => {
                    const at = view.slotOf(player.id, inning);
                    const resting = at === null;
                    return (
                      <td
                        key={inning}
                        className={cn(
                          'border-2 border-black px-2 py-2.5 text-center text-xl font-bold',
                          /*
                            print-color-adjust is not optional here. Browsers
                            drop background colour when printing unless the
                            user has ticked "background graphics", and a rest
                            inning that only reads as grey would vanish on
                            paper — which is the one place this sheet is used.
                          */
                          resting && 'bg-[#d6d6d6] [print-color-adjust:exact]',
                        )}
                      >
                        {at === UNAVAILABLE ? '—' : resting ? 'REST' : at.code}
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>

          <div className="mt-3 border-t-2 border-black pt-2">
            <p className="text-xs font-bold uppercase">Where that is</p>
            <ul className="mt-1 flex flex-wrap gap-x-5 gap-y-0.5 text-sm">
              {view.positions.map((position) => (
                <li key={position.id} className="whitespace-nowrap">
                  <span className="font-bold">{position.code}</span>{' '}
                  {position.displayName}
                </li>
              ))}
              <li className="whitespace-nowrap">
                <span className="bg-[#d6d6d6] px-1 font-bold [print-color-adjust:exact]">
                  REST
                </span>{' '}
                On the bench this inning
              </li>
              {/* A blank cell would read as a mistake on a wall, so a player
                  who arrives late or leaves early gets a dash with a key. */}
              <li className="whitespace-nowrap">
                <span className="font-bold">—</span> Not at the game yet, or gone home
              </li>
            </ul>
          </div>
        </section>
      ) : (
      <div className={compact ? 'grid gap-4 lg:grid-cols-[200px_1fr]' : 'space-y-6'}>
        {/* Compact keeps a lean batting list: the merged table below adds an
            inning column per inning, which will not fit a clipboard. */}
        {compact ? (
        <section>
          <h2 className={compact ? 'mb-1 text-xs font-bold uppercase' : 'mb-2 text-sm font-bold uppercase'}>
            Batting order
          </h2>
          <table className="w-full border-collapse">
            <tbody>
              {battingOrder.map((entry) => (
                <tr key={entry.player.id} className="border-b border-black/30">
                  <td className={`tnum w-6 font-bold ${cellPadding} ${textSize}`}>
                    {entry.slot}
                  </td>
                  <td className={`${cellPadding} ${textSize} font-medium`}>
                    {view.names.plain(entry.player.id)}
                  </td>
                  <td className={`tnum w-10 text-right ${cellPadding} ${textSize}`}>
                    {entry.player.jerseyNumber ? `#${entry.player.jerseyNumber}` : ''}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
        ) : null}

        <section>
          <h2 className={compact ? 'mb-1 text-xs font-bold uppercase' : 'mb-2 text-sm font-bold uppercase'}>
            Defensive rotation
          </h2>
          <table className="w-full border-collapse">
            <thead>
              <tr className="border-b-2 border-black">
                <th className={`text-left ${cellPadding} ${textSize} font-bold`}>Pos</th>
                {view.innings.map((inning) => (
                  <th key={inning} className={`${cellPadding} ${textSize} font-bold`}>
                    {inning}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {view.positions.map((position) => (
                <tr key={position.id} className="border-b border-black/30">
                  <th
                    scope="row"
                    className={`text-left ${cellPadding} ${textSize} font-bold whitespace-nowrap`}
                  >
                    {position.code}
                  </th>
                  {view.innings.map((inning) => {
                    const player = view.playerAt(inning, position.id);
                    return (
                      <td
                        key={inning}
                        className={`text-center ${cellPadding} ${textSize} whitespace-nowrap`}
                      >
                        {player ? view.names.short(player.id) : '—'}
                      </td>
                    );
                  })}
                </tr>
              ))}
              <tr className="border-t-2 border-black">
                <th scope="row" className={`text-left ${cellPadding} ${textSize} font-bold`}>
                  Bench
                </th>
                {view.innings.map((inning) => (
                  <td
                    key={inning}
                    className={`text-center ${cellPadding} ${textSize} whitespace-nowrap`}
                  >
                    {view.benchAt(inning).map((p) => view.names.short(p.id)).join(', ') || '—'}
                  </td>
                ))}
              </tr>
            </tbody>
          </table>

          {/*
            The pitcher contingency, on paper.

            A coach decides "is this inning quick enough to send him back out?"
            at the fence, holding this sheet — so the swap it implies has to be
            printed, not computed in an app they are not looking at. One line
            per inning, and only for innings where the question arises.
          */}
          {extraInnings.length > 0 ? (
            <div className={compact ? 'mt-2' : 'mt-3'}>
              <h3 className={compact ? 'text-[10px] font-bold uppercase' : 'text-xs font-bold uppercase'}>
                If the pitcher goes another inning
              </h3>
              <ul className={compact ? 'mt-0.5 text-[10px]' : 'mt-1 text-xs'}>
                {extraInnings.map((plan) => (
                  <li key={plan.inning} className="whitespace-nowrap">
                    <span className="font-bold">
                      Inn {plan.inning}
                      {'\u2192'}
                      {plan.nextInning}
                    </span>{' '}
                    {view.names.short(plan.pitcher.id)} stays on
                    {plan.displaced ? (
                      <>
                        {' '}
                        &middot; {view.names.short(plan.displaced.id)} takes{' '}
                        {plan.pitcherNextPosition ? plan.pitcherNextPosition.code : 'the bench'}
                      </>
                    ) : null}
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
        </section>

        {!compact ? (
          <section>
            <h2 className="mb-2 text-sm font-bold uppercase">
              Batting order and positions
            </h2>
            <table className="w-full border-collapse">
              <thead>
                <tr className="border-b-2 border-black">
                  <th className="w-6 px-1 py-2 text-left text-sm font-bold">#</th>
                  <th className="px-2 py-2 text-left text-sm font-bold">Player</th>
                  <th className="w-10 px-1 py-2 text-right text-sm font-bold">No.</th>
                  {view.innings.map((inning) => (
                    <th key={inning} className="px-2 py-2 text-sm font-bold">
                      {inning}
                    </th>
                  ))}
                  <th className="px-2 py-2 text-right text-sm font-bold">Inn</th>
                </tr>
              </thead>
              <tbody>
                {lineupRows.map(({ player, slot: battingSlot }) => (
                  <tr key={player.id} className="border-b border-black/30">
                    <td className="tnum w-6 px-1 py-1.5 text-left text-sm font-bold">
                      {battingSlot ?? ''}
                    </td>
                    <th scope="row" className="px-2 py-1.5 text-left text-sm font-medium">
                      {view.names.plain(player.id)}
                    </th>
                    <td className="tnum w-10 px-1 py-1.5 text-right text-sm">
                      {player.jerseyNumber ? `#${player.jerseyNumber}` : ''}
                    </td>
                    {view.innings.map((inning) => {
                      const at = view.slotOf(player.id, inning);
                      return (
                        <td key={inning} className="px-2 py-1.5 text-center text-sm">
                          {at === UNAVAILABLE ? '' : at === null ? 'Bench' : at.code}
                        </td>
                      );
                    })}
                    <td className="tnum px-2 py-1.5 text-right text-sm font-medium">
                      {view.defensiveInnings(player.id)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </section>
        ) : null}
      </div>
      )}
      </div>
    </div>
  );
}
