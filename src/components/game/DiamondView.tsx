'use client';

import { GROUP_STYLE } from '@/components/ui';
import { playerShortName } from '@/domain/factories';
import { cn } from '@/lib/cn';
import type { GameView } from '@/lib/gameView';

/**
 * Diamond view (spec section 49). Positions are placed using the coordinates
 * the formation provides, so a four-outfielder or custom formation renders
 * correctly without any position-specific code here.
 */
export function DiamondView({ view, inning }: { view: GameView; inning: number }) {
  const positioned = view.positions.filter(
    (position) => position.diagramX !== undefined && position.diagramY !== undefined,
  );
  const unpositioned = view.positions.filter(
    (position) => position.diagramX === undefined || position.diagramY === undefined,
  );
  const bench = view.benchAt(inning);

  return (
    <div className="space-y-4">
      <div className="relative mx-auto aspect-4/3 w-full max-w-xl">
        {/* Field: a plain outfield arc and infield diamond, no decoration. */}
        <svg
          viewBox="0 0 100 75"
          className="absolute inset-0 size-full"
          aria-hidden
          preserveAspectRatio="none"
        >
          <path
            d="M 50 68 L 8 26 A 60 60 0 0 1 92 26 Z"
            className="fill-surface-muted stroke-border"
            strokeWidth="0.4"
          />
          <path
            d="M 50 62 L 30 42 L 50 26 L 70 42 Z"
            className="fill-surface stroke-border-strong"
            strokeWidth="0.4"
          />
        </svg>

        {positioned.map((position) => {
          const player = view.playerAt(inning, position.id);
          const style = GROUP_STYLE[position.group];
          return (
            <div
              key={position.id}
              className="absolute -translate-x-1/2 -translate-y-1/2"
              style={{ left: `${position.diagramX}%`, top: `${position.diagramY}%` }}
            >
              <div
                className={cn(
                  'min-w-18 rounded-lg border border-border bg-surface px-2 py-1 text-center shadow-sm',
                )}
              >
                <p className={cn('text-[10px] font-semibold uppercase', style.text)}>
                  {position.code}
                </p>
                <p className="truncate text-xs font-medium text-ink">
                  {player ? playerShortName(player) : '—'}
                </p>
              </div>
            </div>
          );
        })}
      </div>

      {unpositioned.length > 0 ? (
        <div className="flex flex-wrap gap-2">
          {unpositioned.map((position) => {
            const player = view.playerAt(inning, position.id);
            const style = GROUP_STYLE[position.group];
            return (
              <div
                key={position.id}
                className="rounded-lg border border-border bg-surface px-3 py-1.5 text-center"
              >
                <p className={cn('text-[10px] font-semibold uppercase', style.text)}>
                  {position.code}
                </p>
                <p className="text-sm font-medium text-ink">
                  {player ? playerShortName(player) : '—'}
                </p>
              </div>
            );
          })}
        </div>
      ) : null}

      <div className="rounded-lg border border-border bg-bench-soft px-3 py-2">
        <p className="text-[10px] font-semibold tracking-wide text-bench uppercase">Bench</p>
        <p className="mt-0.5 text-sm text-ink">
          {bench.length > 0 ? bench.map(playerShortName).join(' · ') : 'Nobody sits this inning'}
        </p>
      </div>
    </div>
  );
}
