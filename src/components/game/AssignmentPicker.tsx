'use client';

import { Badge, Button, Modal, Notice } from '@/components/ui';
import { playerName } from '@/domain/factories';
import type { Player, PositionDefinition } from '@/domain/types';
import { cn } from '@/lib/cn';
import {
  ROLE_BLOCKED,
  eligibilityFor,
  eligibilityRank,
  type EditEligibility,
} from '@/lib/eligibility';
import { UNAVAILABLE, type GameView } from '@/lib/gameView';
import { useState } from 'react';

/**
 * Manual editing (spec section 50). Picking a player who is marked Never at the
 * position asks first, and an override applies to this game only — a coach's
 * long-term player settings are never silently rewritten.
 */
export function AssignmentPicker({
  view,
  inning,
  position,
  onClose,
  onAssign,
  onBench,
  onOverride,
}: {
  view: GameView;
  inning: number;
  position: PositionDefinition;
  onClose: () => void;
  onAssign: (playerId: string) => void;
  onBench: () => void;
  onOverride: (playerId: string) => void;
}) {
  const [pendingOverride, setPendingOverride] = useState<Player | null>(null);

  const current = view.playerAt(inning, position.id);
  const candidates = view.availableAt(inning);

  const eligibilityOf = (player: Player): EditEligibility =>
    eligibilityFor(view.game, player, position);

  const ranked = [...candidates].sort((a, b) => {
    const diff = eligibilityRank(eligibilityOf(a)) - eligibilityRank(eligibilityOf(b));
    if (diff !== 0) return diff;
    return playerName(a).localeCompare(playerName(b));
  });

  if (pendingOverride) {
    const blocked = eligibilityOf(pendingOverride) === ROLE_BLOCKED;
    return (
      <Modal
        open
        onClose={() => setPendingOverride(null)}
        title="Position restriction"
        footer={
          <>
            <Button onClick={() => setPendingOverride(null)}>Cancel</Button>
            <Button
              variant="primary"
              onClick={() => {
                onOverride(pendingOverride.id);
                setPendingOverride(null);
              }}
            >
              Override this game
            </Button>
          </>
        }
      >
        <Notice tone="caution" title={`${playerName(pendingOverride)} is marked ${blocked ? 'not eligible' : 'Never'} at ${position.code}.`}>
          Overriding applies to this game only. {playerName(pendingOverride)}&apos;s roster
          settings stay exactly as they are.
        </Notice>
      </Modal>
    );
  }

  return (
    <Modal
      open
      onClose={onClose}
      title={`Inning ${inning} · ${position.displayName}`}
      footer={
        <>
          {current ? (
            <Button
              onClick={() => {
                onBench();
                onClose();
              }}
            >
              Move to bench
            </Button>
          ) : null}
          <Button onClick={onClose}>Done</Button>
        </>
      }
    >
      <ul className="space-y-1.5">
        {ranked.map((player) => {
          const eligibility = eligibilityOf(player);
          const isCurrent = current?.id === player.id;
          const slot = view.slotOf(player.id, inning);
          const restricted = eligibility === 'NEVER' || eligibility === ROLE_BLOCKED;

          return (
            <li key={player.id}>
              <button
                type="button"
                onClick={() => {
                  if (restricted) {
                    setPendingOverride(player);
                    return;
                  }
                  onAssign(player.id);
                  onClose();
                }}
                className={cn(
                  'ring-focus flex w-full items-center gap-3 rounded-lg border px-3 py-2.5 text-left transition-colors',
                  isCurrent
                    ? 'border-brand bg-brand-soft'
                    : 'border-border hover:border-border-strong',
                )}
              >
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-medium text-ink">
                    {playerName(player)}
                  </span>
                  <span className="mt-0.5 block text-xs text-ink-muted">
                    {slot === UNAVAILABLE
                      ? 'Not available'
                      : slot === null
                        ? 'On the bench this inning'
                        : `Currently at ${slot.code}`}
                  </span>
                </span>

                {eligibility === 'PREFERRED' ? <Badge tone="brand">Preferred</Badge> : null}
                {eligibility === 'AVOID' ? <Badge tone="caution">Avoid</Badge> : null}
                {eligibility === 'NEVER' ? <Badge tone="critical">Never</Badge> : null}
                {eligibility === ROLE_BLOCKED ? (
                  <Badge tone="critical">
                    {position.role === 'PITCHER' ? 'Not a pitcher' : 'Not a catcher'}
                  </Badge>
                ) : null}
                {isCurrent ? <Badge tone="neutral">Current</Badge> : null}
              </button>
            </li>
          );
        })}
      </ul>
    </Modal>
  );
}
