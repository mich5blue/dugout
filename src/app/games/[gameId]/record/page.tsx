'use client';

import { useDugout } from '@/app/providers';
import {
  Button,
  Card,
  CardHeader,
  EmptyState,
  GROUP_STYLE,
  Label,
  Notice,
  SegmentedControl,
  Select,
} from '@/components/ui';
import { playerName, playerShortName } from '@/domain/factories';
import type { Game } from '@/domain/types';
import { recordActualResults, updateActualAssignment } from '@/services/lineupService';
import { formatGameDate } from '@/lib/format';
import { buildGameView } from '@/lib/gameView';
import { cn } from '@/lib/cn';
import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { useMemo, useState } from 'react';

/**
 * Planned vs actual (spec sections 39-40). Unplayed innings must never reach
 * season statistics, so recording results is a first-class step.
 */
export default function RecordResultsPage() {
  const params = useParams<{ gameId: string }>();
  const router = useRouter();
  const { ready, team, players, games, saveGame } = useDugout();

  const game = games.find((entry) => entry.id === params.gameId) ?? null;
  const [innings, setInnings] = useState<number | null>(null);

  const view = useMemo(
    () => (game ? buildGameView(game, players, 'ACTUAL') : null),
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

  const recorded = game.status === 'COMPLETED';
  const actualInnings = innings ?? game.actualInnings ?? game.plannedInnings;
  const countedInnings = Array.from({ length: actualInnings }, (_, i) => i + 1);

  const save = async () => {
    const next: Game = recordActualResults(game, actualInnings);
    await saveGame(next);
    router.push('/season');
  };

  return (
    <div className="space-y-6">
      <div>
        <Link href={`/games/${game.id}`} className="ring-focus text-sm text-ink-muted hover:text-ink">
          ← Back to lineup
        </Link>
        <h1 className="mt-1 text-2xl font-semibold tracking-tight text-ink">
          {recorded ? 'Edit results' : 'Record results'}
        </h1>
        <p className="mt-1 text-sm text-ink-muted">
          vs {game.opponent || 'TBD'} · {formatGameDate(game.date)}
        </p>
      </div>

      <Card>
        <CardHeader
          title="How many innings were played?"
          description="Innings that were never played contribute nothing to season totals."
        />
        <div className="px-5 py-5">
          <SegmentedControl
            value={String(actualInnings)}
            onChange={(value) => setInnings(Number(value))}
            options={Array.from({ length: game.plannedInnings }, (_, i) => ({
              value: String(i + 1),
              label: String(i + 1),
            }))}
          />
          {actualInnings < game.plannedInnings ? (
            <Notice tone="brand" className="mt-4">
              {game.plannedInnings - actualInnings}{' '}
              {game.plannedInnings - actualInnings === 1 ? 'inning' : 'innings'} won&apos;t
              count. Players who were scheduled to play then carry that time forward, and
              Dugout makes it up in the next game.
            </Notice>
          ) : null}
        </div>
      </Card>

      {recorded ? (
        <Card>
          <CardHeader
            title="What actually happened"
            description="Change any assignment that differed from the plan — season totals use these."
          />
          <div className="overflow-x-auto px-2 py-3 sm:px-4">
            <table className="w-full border-collapse text-sm">
              <thead>
                <tr>
                  <th className="px-3 py-2 text-left text-xs font-semibold tracking-wide text-ink-muted uppercase">
                    Position
                  </th>
                  {countedInnings.map((inning) => (
                    <th
                      key={inning}
                      className="min-w-32 px-2 py-2 text-center text-xs font-semibold tracking-wide text-ink-muted uppercase"
                    >
                      {inning}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {view.positions.map((position) => {
                  const style = GROUP_STYLE[position.group];
                  return (
                    <tr key={position.id} className="border-t border-border">
                      <th scope="row" className="px-3 py-1.5 text-left">
                        <span className="flex items-center gap-2">
                          <span
                            className={cn('size-1.5 rounded-full', style.dot)}
                            aria-hidden
                          />
                          <span className="text-sm font-semibold text-ink">
                            {position.code}
                          </span>
                        </span>
                      </th>
                      {countedInnings.map((inning) => {
                        const current = view.playerAt(inning, position.id);
                        return (
                          <td key={inning} className="p-1">
                            <Select
                              className="h-9"
                              value={current?.id ?? ''}
                              onChange={async (event) => {
                                if (!event.target.value) return;
                                await saveGame(
                                  updateActualAssignment(
                                    game,
                                    inning,
                                    position.id,
                                    event.target.value,
                                  ),
                                );
                              }}
                            >
                              <option value="">—</option>
                              {view.availableAt(inning).map((player) => (
                                <option key={player.id} value={player.id}>
                                  {playerShortName(player)}
                                </option>
                              ))}
                            </Select>
                          </td>
                        );
                      })}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <p className="border-t border-border px-5 py-3 text-xs text-ink-subtle">
            Editing here never changes the generated plan — Dugout keeps both, so you can
            always see what you intended alongside what happened.
          </p>
        </Card>
      ) : (
        <Card>
          <CardHeader title="Lineup as planned" />
          <ul className="divide-y divide-border">
            {countedInnings.map((inning) => (
              <li key={inning} className="px-5 py-3">
                <p className="text-xs font-semibold tracking-wide text-ink-muted uppercase">
                  Inning {inning}
                </p>
                <p className="mt-1 text-sm text-ink">
                  {view.positions
                    .map((position) => {
                      const player = view.playerAt(inning, position.id);
                      return `${position.code} ${player ? playerShortName(player) : '—'}`;
                    })
                    .join(' · ')}
                </p>
                {view.benchAt(inning).length > 0 ? (
                  <p className="mt-1 text-sm text-ink-muted">
                    Bench: {view.benchAt(inning).map(playerShortName).join(', ')}
                  </p>
                ) : null}
              </li>
            ))}
          </ul>
        </Card>
      )}

      <div className="flex flex-wrap justify-end gap-2 pb-6">
        <Link href={`/games/${game.id}`}>
          <Button>Cancel</Button>
        </Link>
        <Button variant="primary" size="lg" onClick={save}>
          {recorded ? `Save ${actualInnings} innings` : `Record ${actualInnings} innings played`}
        </Button>
      </div>
    </div>
  );
}
