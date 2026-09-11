'use client';

import { Button, Card, CardHeader, EmptyState, SegmentedControl } from '@/components/ui';
import { playerName } from '@/domain/factories';
import type { BattingPhilosophy, Game, Player } from '@/domain/types';
import { cn } from '@/lib/cn';
import { useState } from 'react';

/** Batting order (spec sections 28-30) with manual reordering and locks. */
export function BattingOrderPanel({
  game,
  players,
  onReorder,
  onToggleLock,
  onPhilosophyChange,
  onRotate,
  canRotate,
}: {
  game: Game;
  players: Player[];
  onReorder: (playerIds: string[]) => void;
  onToggleLock: (playerId: string) => void;
  onPhilosophyChange: (philosophy: BattingPhilosophy) => void;
  onRotate: (offset: number) => void;
  canRotate: boolean;
}) {
  const [dragging, setDragging] = useState<string | null>(null);

  const order = [...game.battingAssignments].sort((a, b) => a.battingSlot - b.battingSlot);

  const move = (playerId: string, direction: -1 | 1) => {
    const ids = order.map((entry) => entry.playerId);
    const index = ids.indexOf(playerId);
    const target = index + direction;
    if (index < 0 || target < 0 || target >= ids.length) return;
    const next = [...ids];
    next[index] = ids[target];
    next[target] = playerId;
    onReorder(next);
  };

  const dropOn = (targetPlayerId: string) => {
    if (!dragging || dragging === targetPlayerId) return;
    const ids = order.map((entry) => entry.playerId).filter((id) => id !== dragging);
    const targetIndex = ids.indexOf(targetPlayerId);
    ids.splice(targetIndex, 0, dragging);
    onReorder(ids);
    setDragging(null);
  };

  return (
    <Card>
      <CardHeader
        title="Batting order"
        description={`${order.length} ${order.length === 1 ? 'batter' : 'batters'}`}
        action={
          canRotate ? (
            <div className="flex gap-1">
              <Button size="sm" variant="ghost" onClick={() => onRotate(1)}>
                Rotate +1
              </Button>
              <Button size="sm" variant="ghost" onClick={() => onRotate(2)}>
                +2
              </Button>
            </div>
          ) : null
        }
      />

      <div className="border-b border-border px-5 py-3">
        <SegmentedControl<BattingPhilosophy>
          size="sm"
          value={game.settingsSnapshot.battingPhilosophy}
          onChange={onPhilosophyChange}
          options={[
            { value: 'ROTATE_FAIRLY', label: 'Rotate fairly' },
            { value: 'BALANCED', label: 'Balanced' },
            { value: 'COMPETITIVE', label: 'Competitive' },
            { value: 'MANUAL', label: 'Manual' },
          ]}
        />
      </div>

      {order.length === 0 ? (
        <EmptyState
          title="No batting order yet"
          description="Generate the lineup and Dugout builds the order alongside the defense."
        />
      ) : (
        <ol className="divide-y divide-border">
          {order.map((entry, index) => {
            const player = players.find((candidate) => candidate.id === entry.playerId);
            if (!player) return null;
            return (
              <li
                key={entry.playerId}
                draggable
                onDragStart={() => setDragging(entry.playerId)}
                onDragEnd={() => setDragging(null)}
                onDragOver={(event) => event.preventDefault()}
                onDrop={() => dropOn(entry.playerId)}
                className={cn(
                  'flex items-center gap-3 px-5 py-2',
                  dragging === entry.playerId && 'opacity-50',
                )}
              >
                <span className="tnum w-5 shrink-0 text-sm font-semibold text-ink-subtle">
                  {index + 1}
                </span>
                <span className="min-w-0 flex-1 truncate text-sm font-medium text-ink">
                  {playerName(player)}
                  {player.jerseyNumber ? (
                    <span className="ml-2 text-xs text-ink-subtle">#{player.jerseyNumber}</span>
                  ) : null}
                </span>

                <button
                  type="button"
                  aria-label={entry.locked ? 'Unlock batting slot' : 'Lock batting slot'}
                  title={entry.locked ? 'Locked' : 'Lock this slot'}
                  onClick={() => onToggleLock(entry.playerId)}
                  className={cn(
                    'ring-focus size-6 shrink-0 rounded-md border text-xs',
                    entry.locked
                      ? 'border-brand bg-brand text-ink-inverse'
                      : 'border-border text-ink-subtle hover:text-ink',
                  )}
                >
                  {entry.locked ? '●' : '○'}
                </button>

                <span className="flex shrink-0 gap-1">
                  <button
                    type="button"
                    aria-label="Move up"
                    disabled={index === 0}
                    onClick={() => move(entry.playerId, -1)}
                    className="ring-focus size-6 rounded-md border border-border text-xs text-ink-muted disabled:opacity-40 hover:text-ink"
                  >
                    ↑
                  </button>
                  <button
                    type="button"
                    aria-label="Move down"
                    disabled={index === order.length - 1}
                    onClick={() => move(entry.playerId, 1)}
                    className="ring-focus size-6 rounded-md border border-border text-xs text-ink-muted disabled:opacity-40 hover:text-ink"
                  >
                    ↓
                  </button>
                </span>
              </li>
            );
          })}
        </ol>
      )}
    </Card>
  );
}
