'use client';

import { GROUP_STYLE } from '@/components/ui';
import { playerShortName } from '@/domain/factories';
import type { PositionDefinition } from '@/domain/types';
import { cn } from '@/lib/cn';
import { UNAVAILABLE, type GameView } from '@/lib/gameView';

/**
 * By-inning grid (spec section 47). Rows come from the game's formation, so a
 * ten-player formation renders ten rows and a custom formation renders whatever
 * the coach defined.
 */
export function LineupGrid({
  view,
  onSelectCell,
  onToggleLock,
  readOnly = false,
}: {
  view: GameView;
  onSelectCell?: (inning: number, position: PositionDefinition) => void;
  onToggleLock?: (inning: number, position: PositionDefinition) => void;
  readOnly?: boolean;
}) {
  const benchRows = Math.max(
    1,
    ...view.innings.map((inning) => view.benchAt(inning).length),
  );

  return (
    <div className="overflow-x-auto">
      <table className="w-full border-collapse text-sm">
        <thead>
          <tr className="bg-header-tint">
            <th className="sticky left-0 z-10 bg-header-tint px-3 py-2.5 text-left text-[11px] font-semibold tracking-wider text-ink-muted uppercase">
              Position
            </th>
            {view.innings.map((inning) => (
              <th
                key={inning}
                className="min-w-24 px-2 py-2.5 text-center text-[11px] font-semibold tracking-wider text-ink-muted uppercase"
              >
                Inn {inning}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {view.positions.map((position) => {
            const style = GROUP_STYLE[position.group];
            return (
              <tr key={position.id} className="border-t border-border">
                <th
                  scope="row"
                  className="sticky left-0 z-10 bg-surface px-3 py-1.5 text-left align-middle"
                >
                  {/* A group-coloured rail carries which group the row belongs
                      to without spending a column on it. */}
                  <span className="flex items-center gap-2.5">
                    <span
                      className={cn('h-6 w-1 shrink-0 rounded-full', style.dot)}
                      aria-hidden
                    />
                    <span className="text-sm font-semibold tracking-tight text-ink">
                      {position.code}
                    </span>
                  </span>
                </th>
                {view.innings.map((inning) => {
                  const player = view.playerAt(inning, position.id);
                  const assignment = view.assignmentAt(inning, position.id);
                  const locked = assignment?.locked ?? false;

                  return (
                    <td key={inning} className="p-1 align-middle">
                      <div className="flex items-stretch gap-1">
                        <button
                          type="button"
                          disabled={readOnly}
                          onClick={() => onSelectCell?.(inning, position)}
                          className={cn(
                            'ring-focus min-h-9 flex-1 truncate rounded-lg border px-2.5 py-1.5 text-left text-sm font-medium transition-all',
                            player
                              ? cn('border-transparent', style.chip, 'text-ink')
                              : 'border-dashed border-border-strong text-ink-subtle',
                            !readOnly &&
                              'hover:-translate-y-px hover:border-brand hover:shadow-sm',
                          )}
                        >
                          {player ? playerShortName(player) : '—'}
                        </button>
                        {!readOnly && onToggleLock ? (
                          <button
                            type="button"
                            aria-label={locked ? 'Unlock assignment' : 'Lock assignment'}
                            title={locked ? 'Locked — Rebalance keeps this' : 'Lock this assignment'}
                            onClick={() => onToggleLock(inning, position)}
                            className={cn(
                              'ring-focus w-6 shrink-0 rounded-md border text-xs transition-colors',
                              locked
                                ? 'border-brand bg-brand text-ink-inverse'
                                : 'border-border text-ink-subtle hover:text-ink',
                            )}
                          >
                            {locked ? '●' : '○'}
                          </button>
                        ) : locked ? (
                          <span className="w-3 shrink-0 text-xs text-brand" aria-label="Locked">
                            ●
                          </span>
                        ) : null}
                      </div>
                    </td>
                  );
                })}
              </tr>
            );
          })}

          {Array.from({ length: benchRows }, (_, row) => (
            <tr
              key={`bench-${row}`}
              className={cn(
                'bg-bench-soft/50',
                // One heavier rule separates the bench from the field.
                row === 0 && 'border-t-2 border-border-strong',
              )}
            >
              <th
                scope="row"
                className="sticky left-0 z-10 bg-surface px-3 py-1.5 text-left align-middle"
              >
                {row === 0 ? (
                  <span className="flex items-center gap-2.5">
                    <span
                      className={cn('h-6 w-1 shrink-0 rounded-full', GROUP_STYLE.BENCH.dot)}
                      aria-hidden
                    />
                    <span className="text-sm font-semibold tracking-tight text-ink-muted">
                      Bench
                    </span>
                  </span>
                ) : null}
              </th>
              {view.innings.map((inning) => {
                const bench = view.benchAt(inning);
                const player = bench[row];
                return (
                  <td key={inning} className="p-1 align-middle">
                    <div
                      className={cn(
                        'min-h-9 truncate rounded-md px-2 py-1.5 text-sm',
                        player ? 'bg-bench-soft text-ink-muted' : 'text-transparent',
                      )}
                    >
                      {player ? playerShortName(player) : '—'}
                    </div>
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** By-player grid (spec section 48): fairness at a glance. */
export function PlayerGrid({ view }: { view: GameView }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full border-collapse text-sm">
        <thead>
          <tr className="bg-header-tint">
            <th className="sticky left-0 z-10 bg-header-tint px-3 py-2.5 text-left text-[11px] font-semibold tracking-wider text-ink-muted uppercase">
              Player
            </th>
            {view.innings.map((inning) => (
              <th
                key={inning}
                className="min-w-16 px-2 py-2.5 text-center text-[11px] font-semibold tracking-wider text-ink-muted uppercase"
              >
                {inning}
              </th>
            ))}
            <th className="px-3 py-2.5 text-right text-[11px] font-semibold tracking-wider text-ink-muted uppercase">
              Innings
            </th>
          </tr>
        </thead>
        <tbody>
          {view.players.map((player) => (
            <tr key={player.id} className="border-t border-border">
              <th
                scope="row"
                className="sticky left-0 z-10 bg-surface px-3 py-1.5 text-left text-sm font-medium text-ink"
              >
                {playerShortName(player)}
              </th>
              {view.innings.map((inning) => {
                const slot = view.slotOf(player.id, inning);
                if (slot === UNAVAILABLE) {
                  return (
                    <td key={inning} className="p-1 text-center">
                      <span className="block rounded-md px-2 py-1.5 text-xs text-ink-subtle">
                        —
                      </span>
                    </td>
                  );
                }
                if (slot === null) {
                  return (
                    <td key={inning} className="p-1 text-center">
                      <span className="block rounded-md bg-bench-soft px-2 py-1.5 text-xs font-medium text-bench">
                        Bench
                      </span>
                    </td>
                  );
                }
                const style = GROUP_STYLE[slot.group];
                return (
                  <td key={inning} className="p-1 text-center">
                    <span
                      className={cn(
                        'block rounded-md px-2 py-1.5 text-xs font-semibold',
                        style.chip,
                        style.text,
                      )}
                    >
                      {slot.code}
                    </span>
                  </td>
                );
              })}
              <td className="tnum px-3 py-1.5 text-right text-sm font-medium text-ink">
                {view.defensiveInnings(player.id)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
