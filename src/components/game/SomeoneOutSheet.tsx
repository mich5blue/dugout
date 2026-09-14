'use client';

import { Button, Modal } from '@/components/ui';
import { playerName } from '@/domain/factories';
import type { Player } from '@/domain/types';
import { cn } from '@/lib/cn';
import type { GameView } from '@/lib/gameView';
import { useState } from 'react';

/**
 * "Someone has to come out."
 *
 * Every piece of machinery this needs already existed — a departure inning on
 * the game player, frozen innings on the generator, and Rebalance — but it was
 * only reachable as three separate planning controls, one of them a dropdown
 * labelled "Keep innings". No coach standing at a fence was going to assemble
 * that during a game.
 *
 * So this asks the two questions a coach can answer in the moment, in their own
 * words, and does the rest: who, and from when. Innings already played are held
 * exactly as they were, and only the rest of the game is rebuilt.
 */
export function SomeoneOutSheet({
  view,
  open,
  currentInning,
  onClose,
  onApply,
}: {
  view: GameView;
  open: boolean;
  /** The inning the coach is currently on, used as the default cut-off. */
  currentInning: number;
  onClose: () => void;
  /**
   * `lastInning` is the last inning the player is still available for, so
   * "done now" is the inning before the one being played.
   */
  onApply: (playerId: string, lastInning: number) => Promise<void> | void;
}) {
  const [playerId, setPlayerId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const available = view.players.filter((player) =>
    view.game.gamePlayers.some((gp) => gp.playerId === player.id && gp.available),
  );

  const chosen: Player | undefined = available.find((p) => p.id === playerId);

  const close = () => {
    setPlayerId(null);
    onClose();
  };

  const apply = async (lastInning: number) => {
    if (!playerId) return;
    setBusy(true);
    try {
      await onApply(playerId, lastInning);
      setPlayerId(null);
      onClose();
    } finally {
      setBusy(false);
    }
  };

  /*
    "Done now" means they do not play the inning in progress, so the last
    inning they are available for is the one before it. Clamped at 0, which
    the availability model reads as "not available at all".
  */
  const doneNow = Math.max(0, currentInning - 1);
  const afterThis = currentInning;
  const canFinishInning = afterThis < view.innings.length;

  return (
    <Modal open={open} onClose={close} title="Someone has to come out">
      {!chosen ? (
        <>
          <p className="text-sm text-ink-muted">Who is coming out?</p>
          <div className="mt-3 grid gap-2 sm:grid-cols-2">
            {available.map((player) => (
              <button
                key={player.id}
                type="button"
                onClick={() => setPlayerId(player.id)}
                className={cn(
                  'ring-focus flex items-center gap-2 rounded-xl border border-border bg-surface',
                  'px-3 py-3 text-left text-sm font-medium text-ink',
                  'hover:border-accent hover:bg-surface-muted',
                )}
              >
                <span className="min-w-0 flex-1 truncate">{playerName(player)}</span>
                {player.jerseyNumber ? (
                  <span className="tnum shrink-0 text-xs text-ink-subtle">
                    #{player.jerseyNumber}
                  </span>
                ) : null}
              </button>
            ))}
          </div>
        </>
      ) : (
        <>
          <p className="text-base text-ink">
            <span className="font-semibold">{playerName(chosen)}</span> is coming out.
            When?
          </p>

          <div className="mt-3 space-y-2">
            <Button
              variant="primary"
              size="lg"
              className="w-full"
              disabled={busy}
              onClick={() => apply(doneNow)}
            >
              Right now — done for the day
            </Button>
            {canFinishInning ? (
              <Button
                size="lg"
                className="w-full"
                disabled={busy}
                onClick={() => apply(afterThis)}
              >
                After inning {afterThis} — let them finish
              </Button>
            ) : null}
          </div>

          <p className="mt-3 text-xs text-ink-muted">
            {doneNow > 0
              ? `Innings 1–${doneNow} stay exactly as they were played. InningGrid rebuilds the rest of the game around the change, and the season keeps track of the innings ${playerName(chosen)} missed.`
              : `InningGrid rebuilds the game without ${playerName(chosen)}, and the season keeps track of the innings they missed.`}
          </p>

          <button
            type="button"
            onClick={() => setPlayerId(null)}
            className="ring-focus mt-3 rounded-md text-xs text-ink-muted underline hover:text-ink"
          >
            ← Pick someone else
          </button>
        </>
      )}
    </Modal>
  );
}
