'use client';

import { Button, Card, Spinner } from '@/components/ui';
import { playerName } from '@/domain/factories';
import type { Game, Player } from '@/domain/types';
import { cn } from '@/lib/cn';

/**
 * Attendance, always on screen.
 *
 * The most common game-day edit is "he didn't show" — and before this the coach
 * had to open game setup to make it. One row of names, tap to toggle, one
 * button to rebalance around whoever is actually here. Arrival and departure
 * innings still live in game setup; this is the fast path, not a replacement.
 */
export function AttendanceBar({
  game,
  players,
  onChange,
  onRebalance,
  busy,
  changed,
}: {
  game: Game;
  players: Player[];
  onChange: (game: Game) => void;
  onRebalance: () => void;
  busy: boolean;
  /** True when the lineup no longer matches this attendance. */
  changed: boolean;
}) {
  const toggle = (playerId: string, available: boolean) => {
    onChange({
      ...game,
      gamePlayers: game.gamePlayers.map((gp) =>
        gp.playerId === playerId ? { ...gp, available } : gp,
      ),
    });
  };

  const here = game.gamePlayers.filter((gp) => gp.available).length;
  const out = game.gamePlayers.length - here;

  return (
    <Card className="px-4 py-3">
      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
        <p className="text-sm font-semibold text-ink">
          <span className="tnum">{here}</span> here
          {out > 0 ? (
            <span className="font-normal text-ink-muted">
              {' · '}
              <span className="tnum">{out}</span> out
            </span>
          ) : null}
        </p>
        <span className="flex items-center gap-3">
          <span className="text-xs text-ink-muted">
            {changed ? 'Keeps your locked spots.' : 'Tap a name to mark them out.'}
          </span>
          <Button
            size="sm"
            variant={changed ? 'primary' : 'secondary'}
            disabled={busy}
            onClick={onRebalance}
          >
            {busy ? (
              <>
                <Spinner /> Working…
              </>
            ) : (
              'Rebalance'
            )}
          </Button>
        </span>
      </div>

      <div className="mt-3 flex flex-wrap gap-1.5">
        {game.gamePlayers.map((gp) => {
          const player = players.find((entry) => entry.id === gp.playerId);
          if (!player) return null;
          return (
            <button
              key={gp.playerId}
              type="button"
              aria-pressed={gp.available}
              onClick={() => toggle(gp.playerId, !gp.available)}
              className={cn(
                'ring-focus flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-sm transition-colors',
                gp.available
                  ? 'border-brand bg-brand-soft font-medium text-ink'
                  : 'border-border bg-surface-muted text-ink-subtle line-through',
              )}
            >
              {/* A visible mark as well as the fill, so state never rests on colour alone. */}
              <span aria-hidden className="text-[10px] font-bold">
                {gp.available ? '✓' : '✕'}
              </span>
              {playerName(player)}
            </button>
          );
        })}
      </div>
    </Card>
  );
}
