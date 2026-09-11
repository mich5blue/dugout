'use client';

import { Button, GROUP_STYLE } from '@/components/ui';
import { playerName, playerShortName } from '@/domain/factories';
import { cn } from '@/lib/cn';
import { inningChanges, type GameView } from '@/lib/gameView';
import { useState } from 'react';

/**
 * Mobile game-day view (spec section 58): one inning at a time, plus exactly
 * what changes next inning. Not a shrunken desktop table.
 */
export function GameDayView({ view }: { view: GameView }) {
  const [inning, setInning] = useState(1);
  const bench = view.benchAt(inning);
  const changes = inning < view.innings.length ? inningChanges(view, inning, inning + 1) : [];

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3">
        <Button
          size="sm"
          disabled={inning <= 1}
          onClick={() => setInning((current) => Math.max(1, current - 1))}
        >
          ← Prev
        </Button>
        <p className="text-lg font-semibold tracking-tight text-ink">Inning {inning}</p>
        <Button
          size="sm"
          disabled={inning >= view.innings.length}
          onClick={() => setInning((current) => Math.min(view.innings.length, current + 1))}
        >
          Next →
        </Button>
      </div>

      <ul className="divide-y divide-border rounded-card border border-border bg-surface">
        {view.positions.map((position) => {
          const player = view.playerAt(inning, position.id);
          const style = GROUP_STYLE[position.group];
          return (
            <li key={position.id} className="flex items-center gap-3 px-4 py-3">
              <span
                className={cn(
                  'w-12 shrink-0 rounded-md px-1.5 py-1 text-center text-xs font-bold',
                  style.chip,
                  style.text,
                )}
              >
                {position.code}
              </span>
              <span className="min-w-0 flex-1 truncate text-base font-medium text-ink">
                {player ? playerName(player) : '—'}
              </span>
              {player?.jerseyNumber ? (
                <span className="tnum shrink-0 text-sm text-ink-subtle">
                  #{player.jerseyNumber}
                </span>
              ) : null}
            </li>
          );
        })}

        <li className="flex items-center gap-3 bg-bench-soft px-4 py-3">
          <span className="w-12 shrink-0 text-center text-xs font-bold text-bench">BN</span>
          <span className="min-w-0 flex-1 text-base text-ink-muted">
            {bench.length > 0 ? bench.map(playerShortName).join(' · ') : 'Nobody sits'}
          </span>
        </li>
      </ul>

      {changes.length > 0 ? (
        <div className="rounded-card border border-border bg-surface">
          <p className="border-b border-border px-4 py-2.5 text-xs font-semibold tracking-wide text-ink-muted uppercase">
            Next inning changes
          </p>
          <ul className="divide-y divide-border">
            {changes.map((change) => (
              <li
                key={change.playerId}
                className="flex items-center gap-2 px-4 py-2.5 text-sm"
              >
                <span className="min-w-0 flex-1 truncate font-medium text-ink">
                  {change.playerName}
                </span>
                <span className="shrink-0 text-ink-muted">
                  {change.from} <span className="text-ink-subtle">→</span>{' '}
                  <span className="font-medium text-ink">{change.to}</span>
                </span>
              </li>
            ))}
          </ul>
          <div className="border-t border-border px-4 py-3">
            <Button
              className="w-full"
              onClick={() => setInning((current) => Math.min(view.innings.length, current + 1))}
            >
              Next inning →
            </Button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
