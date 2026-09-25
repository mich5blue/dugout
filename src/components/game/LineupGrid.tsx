'use client';

import { GROUP_STYLE, LockToggle, PadlockIcon, PinIcon } from '@/components/ui';
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

  /*
    The pitching plan pins the primary pitcher position for an inning in the
    solver (see context.ts), but it does not set the assignment's `locked`
    flag. Those cells therefore used to render an unlocked circle on a cell
    Rebalance would never move, which is worse than no affordance at all.

    Only the first PITCHER-role position is pinned, matching the solver.
  */
  const primaryPitcherId = view.positions.find((position) => position.role === 'PITCHER')?.id;
  const isPlanPinned = (inning: number, position: PositionDefinition): boolean =>
    position.id === primaryPitcherId && Boolean(view.game.pitchingPlan[inning]);

  return (
    <div className="overflow-x-auto">
      <table className="w-full border-collapse text-sm">
        <thead>
          <tr>
            <th className="sticky left-0 z-10 bg-surface px-3 pb-2 text-left align-bottom">
              <span className="eyebrow text-ink-subtle">Position</span>
            </th>
            {view.innings.map((inning) => (
              <th key={inning} className="min-w-24 px-1 pb-2 align-bottom">
                {/* Inning numbers are the scoreboard's own register: condensed
                    figures in a tinted cap, not a table header in small caps. */}
                <span className="flex items-center justify-center gap-1.5">
                  <span className="eyebrow text-ink-subtle">Inn</span>
                  <span className="scoreboard text-lg text-ink">{inning}</span>
                </span>
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {view.positions.map((position, rowIndex) => {
            const style = GROUP_STYLE[position.group];
            return (
              <tr key={position.id} className="border-t border-border">
                <th
                  scope="row"
                  className="sticky left-0 z-10 bg-surface px-3 py-1 text-left align-middle"
                >
                  {/* A group-coloured rail carries which group the row belongs
                      to without spending a column on it. */}
                  <span className="flex items-center gap-2.5">
                    <span
                      className={cn('h-7 w-[3px] shrink-0 rounded-full', style.dot)}
                      aria-hidden
                    />
                    <span className={cn('scoreboard text-base', style.text)}>
                      {position.code}
                    </span>
                  </span>
                </th>
                {view.innings.map((inning, colIndex) => {
                  const player = view.playerAt(inning, position.id);
                  const assignment = view.assignmentAt(inning, position.id);
                  const locked = assignment?.locked ?? false;
                  const planPinned = isPlanPinned(inning, position);

                  return (
                    <td key={inning} className="p-1 align-middle">
                      <div
                        className="sweep-in flex items-stretch gap-1"
                        // Staggered on the diagonal so a generated lineup
                        // resolves as a sweep across the grid rather than all
                        // at once. Capped so a long game never feels slow.
                        style={{
                          animationDelay: `${Math.min(280, (rowIndex + colIndex) * 22)}ms`,
                        }}
                      >
                        <button
                          type="button"
                          disabled={readOnly}
                          onClick={() => onSelectCell?.(inning, position)}
                          className={cn(
                            /*
                              The player's name is the content, so it takes the
                              highest-contrast ink available; the group colour
                              is carried by the rail and the tinted fill. Naming
                              in the group colour was legible but measurably
                              dimmer, and the name is what gets read.
                            */
                            'ring-focus min-h-9 flex-1 truncate rounded-md border-l-2 px-2.5 py-1.5 text-left text-sm font-medium transition-all',
                            player
                              ? cn(style.chip, style.rail, 'text-ink')
                              : 'border-l border-dashed border-border-strong text-ink-subtle',
                            !readOnly && 'hover:-translate-y-px hover:brightness-125',
                            // Pinned state reads on the cell, not only on the
                            // small control beside it, so a coach can see what
                            // is held without inspecting ten tiny buttons.
                            (locked || planPinned) && 'ring-1 ring-accent ring-inset',
                          )}
                        >
                          {player ? view.names.short(player.id) : '—'}
                        </button>

                        {planPinned ? (
                          <span
                            title={`Pitcher for inning ${inning} is set in the pitching plan — change it there`}
                            aria-label={`Pinned by the pitching plan. Pitcher for inning ${inning} is set in the pitching plan.`}
                            className="flex w-6 shrink-0 items-center justify-center rounded-md border border-accent/50 bg-accent-soft text-accent"
                          >
                            <PinIcon />
                          </span>
                        ) : (
                          <LockToggle
                            locked={locked}
                            noun="assignment"
                            onToggle={
                              !readOnly && onToggleLock
                                ? () => onToggleLock(inning, position)
                                : undefined
                            }
                          />
                        )}
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
                // One heavier rule separates the bench from the field.
                row === 0 && 'border-t-2 border-border-strong',
              )}
            >
              <th
                scope="row"
                className="sticky left-0 z-10 bg-surface px-3 py-1 text-left align-middle"
              >
                {row === 0 ? (
                  <span className="flex items-center gap-2.5">
                    <span
                      className={cn('h-7 w-[3px] shrink-0 rounded-full', GROUP_STYLE.BENCH.dot)}
                      aria-hidden
                    />
                    <span className="scoreboard text-base text-ink-subtle">Bench</span>
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
                        'min-h-9 truncate rounded-md px-2.5 py-1.5 text-sm',
                        player ? 'bg-bench-soft text-ink-muted' : 'text-transparent',
                      )}
                    >
                      {player ? view.names.short(player.id) : '—'}
                    </div>
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>

      {/*
        A legend showing the actual controls, rather than a sentence describing
        them from the bottom of the card. Two of these three states are things
        the coach did not create and would otherwise have to guess at.
      */}
      {!readOnly ? (
        <dl className="mt-3 flex flex-wrap items-center gap-x-5 gap-y-2 px-2 text-xs text-ink-subtle">
          <div className="flex items-center gap-1.5">
            <dt className="flex size-6 items-center justify-center rounded-md border border-border text-ink-subtle">
              <PadlockIcon locked={false} />
            </dt>
            <dd>Open — Rebalance may move this player</dd>
          </div>
          <div className="flex items-center gap-1.5">
            <dt className="flex size-6 items-center justify-center rounded-md border border-accent bg-accent text-ink-inverse">
              <PadlockIcon locked />
            </dt>
            <dd>Locked — Rebalance keeps them here</dd>
          </div>
          {primaryPitcherId !== undefined ? (
            <div className="flex items-center gap-1.5">
              <dt className="flex size-6 items-center justify-center rounded-md border border-accent/50 bg-accent-soft text-accent">
                <PinIcon />
              </dt>
              <dd>Set in the pitching plan</dd>
            </div>
          ) : null}
        </dl>
      ) : null}
    </div>
  );
}

/** By-player grid (spec section 48): fairness at a glance. */
/**
 * By-player grid: rows are players, columns are innings.
 *
 * This is the hero grid of the redesign, because it answers the question a
 * coach and a parent both actually ask — where has this kid been all game —
 * which the by-position grid can only answer by scanning ten rows.
 *
 * Editable when `onSelectCell` is passed, read-only otherwise: the guide, the
 * print sheets and the shared link all render it with no handlers and must
 * stay inert.
 */
export function PlayerGrid({
  view,
  onSelectCell,
  onToggleLock,
  /** The player row to mark as the one being inspected. */
  focusedPlayerId,
}: {
  view: GameView;
  onSelectCell?: (playerId: string, inning: number) => void;
  onToggleLock?: (playerId: string, inning: number) => void;
  focusedPlayerId?: string | null;
}) {
  const editable = Boolean(onSelectCell);

  /* Which cells the coach is holding. Read per player-inning rather than per
     position, because that is the axis this grid is on. */
  const lockedAt = (playerId: string, inning: number): boolean => {
    const slot = view.slotOf(playerId, inning);
    if (slot === null || slot === UNAVAILABLE) return false;
    return view.assignmentAt(inning, slot.id)?.locked ?? false;
  };

  return (
    <div className="overflow-x-auto">
      <table className="w-full border-collapse text-sm">
        <thead>
          <tr>
            <th className="sticky left-0 z-10 bg-surface px-3 pb-2 text-left align-bottom">
              <span className="eyebrow text-ink-subtle">Player</span>
            </th>
            {view.innings.map((inning) => (
              <th key={inning} className="min-w-16 px-2 pb-2 align-bottom">
                <span className="scoreboard block text-lg text-ink">{inning}</span>
              </th>
            ))}
            <th className="px-3 pb-2 text-right align-bottom">
              <span className="eyebrow text-ink-subtle">Innings</span>
            </th>
          </tr>
        </thead>
        <tbody>
          {view.players.map((player) => (
            <tr key={player.id} className="border-t border-border">
              <th
                scope="row"
                className={cn(
                  'sticky left-0 z-10 px-3 py-1.5 text-left text-sm font-medium text-ink',
                  focusedPlayerId === player.id ? 'bg-accent-soft' : 'bg-surface',
                )}
              >
                <span className="flex items-center gap-2">
                  {view.names.short(player.id)}
                  {player.jerseyNumber ? (
                    <span className="tnum text-xs text-ink-subtle">
                      #{player.jerseyNumber}
                    </span>
                  ) : null}
                </span>
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
                      <CellButton
                        editable={editable}
                        label="Rest"
                        title={`${view.names.short(player.id)} rests inning ${inning}`}
                        onClick={() => onSelectCell?.(player.id, inning)}
                        className="bg-bench-soft text-bench"
                      />
                    </td>
                  );
                }
                const style = GROUP_STYLE[slot.group];
                const locked = lockedAt(player.id, inning);
                return (
                  <td key={inning} className="p-1 text-center">
                    {/*
                      The rail matters more here than it looks. Pale tints on
                      white cannot be separated from each other under
                      protanopia — the light -soft fills sit about 1 dE apart —
                      so the fill alone can never carry the group. The
                      saturated rail and the code text do, and both are
                      contrast-checked. The position code is always spelled
                      out, so colour is never doing the work alone.
                    */}
                    <CellButton
                      editable={editable}
                      label={slot.code}
                      locked={locked}
                      title={`${view.names.short(player.id)} plays ${slot.displayName} in inning ${inning}`}
                      onClick={() => onSelectCell?.(player.id, inning)}
                      onLockToggle={
                        onToggleLock ? () => onToggleLock(player.id, inning) : undefined
                      }
                      className={cn('border-l-2', style.chip, style.rail, style.text)}
                    />
                  </td>
                );
              })}
              <td className="tnum px-3 py-1.5 text-right text-sm font-semibold text-ink">
                {view.defensiveInnings(player.id)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/**
 * One cell of the by-player grid.
 *
 * A button when the grid is editable and a plain span when it is not — rather
 * than a disabled button — because a disabled control still reads as
 * interactive to a screen reader walking the table, and the read-only grid
 * appears in the guide, the print sheets and the parent's shared link.
 *
 * The lock is a separate hit target rather than a long-press. Long-press has no
 * discoverable affordance, no keyboard equivalent, and fires by accident on a
 * phone held in one hand at a fence.
 */
function CellButton({
  editable,
  label,
  title,
  locked = false,
  onClick,
  onLockToggle,
  className,
}: {
  editable: boolean;
  label: string;
  title: string;
  locked?: boolean;
  onClick?: () => void;
  onLockToggle?: () => void;
  className?: string;
}) {
  const shell = cn(
    'scoreboard block w-full rounded-md px-2 py-2 text-sm transition-all',
    className,
    locked && 'ring-1 ring-accent ring-inset',
  );

  if (!editable) {
    return (
      <span className={shell} title={title}>
        {label}
      </span>
    );
  }

  return (
    <span className="relative block">
      <button
        type="button"
        onClick={onClick}
        title={title}
        aria-label={title}
        className={cn(shell, 'ring-focus text-left hover:-translate-y-px hover:brightness-125')}
      >
        {label}
      </button>
      {onLockToggle ? (
        <button
          type="button"
          onClick={(event) => {
            event.stopPropagation();
            onLockToggle();
          }}
          aria-pressed={locked}
          aria-label={locked ? 'Locked — tap to unlock' : 'Tap to lock this assignment'}
          title={
            locked
              ? 'Locked — Rebalance keeps this'
              : 'Lock so Rebalance keeps this'
          }
          className={cn(
            'ring-focus absolute -top-1 -right-1 flex size-4 items-center justify-center rounded-full border text-[8px] transition-colors',
            locked
              ? 'border-accent bg-accent text-ink-inverse'
              : 'border-border bg-surface text-transparent hover:text-ink-subtle',
          )}
        >
          <PadlockIcon locked={locked} />
        </button>
      ) : null}
    </span>
  );
}
