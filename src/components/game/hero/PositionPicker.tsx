'use client';

import { Badge, Button, GROUP_STYLE, Modal } from '@/components/ui';
import { GROUP_ORDER } from '@/domain/formations';
import type { FairnessDebt } from '@/domain/season';
import type { PositionDefinition } from '@/domain/types';
import { cn } from '@/lib/cn';
import { UNAVAILABLE, type GameView } from '@/lib/gameView';
import { whyAssignment, whyNotEligible } from '@/lib/whyAssignment';
import { useState } from 'react';

/**
 * Change where one player plays in one inning.
 *
 * The existing `AssignmentPicker` answers the other question — who plays this
 * position — which is the right question when you are reading the grid by
 * position. From a player's row the coach is asking "move Brody", and offering
 * them a list of players would be the wrong noun.
 *
 * Taking an occupied position swaps the two players rather than displacing one
 * to nowhere. That is what `setAssignment` already does, and it is what a
 * coach means by "put Brody at shortstop".
 */
export function PositionPicker({
  view,
  playerId,
  inning,
  debt,
  onPick,
  onBench,
  onClose,
}: {
  view: GameView;
  playerId: string;
  inning: number;
  debt?: FairnessDebt;
  onPick: (positionId: string) => void;
  onBench: () => void;
  onClose: () => void;
}) {
  const [whyOpen, setWhyOpen] = useState(false);

  const player = view.playerById.get(playerId);
  const current = view.slotOf(playerId, inning);
  const name = view.names.short(playerId);
  const why = whyAssignment(view, playerId, inning, debt);

  if (!player) return null;

  const grouped = GROUP_ORDER.filter((group) => group !== 'BENCH').map((group) => ({
    group,
    positions: view.positions.filter((position) => position.group === group),
  }));

  return (
    <Modal
      open
      onClose={onClose}
      title={
        <span className="flex flex-wrap items-baseline gap-2">
          <span>{`${name} · inning ${inning}`}</span>
          <span className="text-xs font-normal text-ink-muted">
            {current === UNAVAILABLE
              ? 'Not available this inning'
              : current === null
                ? 'Resting'
                : `Playing ${current.displayName}`}
          </span>
        </span>
      }
    >
      <div className="space-y-4">
        {/* Why, first and collapsed. The answer to "why is this like this" has
            to be available before the coach changes it, or they are editing
            blind. */}
        <div className="rounded-xl border border-border bg-surface-raised">
          <button
            type="button"
            onClick={() => setWhyOpen((open) => !open)}
            aria-expanded={whyOpen}
            className="ring-focus flex w-full items-center justify-between gap-3 px-3.5 py-3 text-left"
          >
            <span className="min-w-0 text-sm text-ink">{why.headline}</span>
            <span className="shrink-0 text-xs font-semibold text-accent">
              {whyOpen ? 'Hide' : 'Why?'}
            </span>
          </button>
          {whyOpen ? (
            <ul className="space-y-2 border-t border-border px-3.5 py-3">
              {why.reasons.map((reason, index) => (
                <li key={index} className="flex gap-2 text-xs leading-relaxed text-ink-muted">
                  <span
                    aria-hidden
                    className={cn(
                      'mt-1.5 size-1.5 shrink-0 rounded-full',
                      reason.coachSet ? 'bg-accent' : 'bg-border-strong',
                    )}
                  />
                  <span>
                    {reason.coachSet ? (
                      <span className="font-semibold text-ink">Your call: </span>
                    ) : null}
                    {reason.text}
                  </span>
                </li>
              ))}
            </ul>
          ) : null}
        </div>

        {current === UNAVAILABLE ? (
          <p className="text-sm text-ink-muted">
            To play {name} this inning, change their availability in{' '}
            <span className="font-medium text-ink">Who&apos;s here</span>.
          </p>
        ) : (
          <>
            {grouped.map(({ group, positions }) =>
              positions.length === 0 ? null : (
                <div key={group}>
                  <p className="eyebrow mb-1.5 flex items-center gap-2 text-ink-subtle">
                    <span
                      aria-hidden
                      className={cn('size-2 rounded-full', GROUP_STYLE[group].dot)}
                    />
                    {group === 'BATTERY'
                      ? 'Pitcher & catcher'
                      : group === 'INFIELD'
                        ? 'Infield'
                        : 'Outfield'}
                  </p>
                  <div className="grid grid-cols-2 gap-1.5 sm:grid-cols-3">
                    {positions.map((position) => (
                      <PositionOption
                        key={position.id}
                        view={view}
                        playerId={playerId}
                        inning={inning}
                        position={position}
                        isCurrent={current !== null && current.id === position.id}
                        onPick={onPick}
                      />
                    ))}
                  </div>
                </div>
              ),
            )}

            <div className="border-t border-border pt-3">
              <Button
                className="w-full"
                disabled={current === null}
                onClick={onBench}
              >
                {current === null ? 'Already resting' : `Rest this inning`}
              </Button>
            </div>
          </>
        )}
      </div>
    </Modal>
  );
}

function PositionOption({
  view,
  playerId,
  inning,
  position,
  isCurrent,
  onPick,
}: {
  view: GameView;
  playerId: string;
  inning: number;
  position: PositionDefinition;
  isCurrent: boolean;
  onPick: (positionId: string) => void;
}) {
  const blocked = whyNotEligible(view, playerId, position);
  const occupant = view.playerAt(inning, position.id);
  const style = GROUP_STYLE[position.group];

  return (
    <button
      type="button"
      disabled={Boolean(blocked) || isCurrent}
      aria-pressed={isCurrent}
      title={blocked ?? undefined}
      onClick={() => onPick(position.id)}
      className={cn(
        'ring-focus rounded-lg border px-2.5 py-2 text-left transition-colors',
        isCurrent
          ? cn('border-accent', style.chip)
          : blocked
            ? 'border-border opacity-50'
            : 'border-border bg-surface hover:border-border-strong',
      )}
    >
      <span className="flex items-baseline gap-1.5">
        <span className={cn('scoreboard text-base', style.text)}>{position.code}</span>
        {isCurrent ? (
          <span className="text-[10px] font-semibold text-accent">now</span>
        ) : null}
      </span>
      <span className="mt-0.5 block truncate text-[11px] text-ink-muted">
        {blocked
          ? 'Not eligible'
          : occupant && occupant.id !== playerId
            ? `Swap with ${view.names.short(occupant.id)}`
            : occupant
              ? 'Here now'
              : 'Open'}
      </span>
    </button>
  );
}
