'use client';

import type { Formation } from '@/domain/types';

/**
 * A miniature field showing where a formation puts its players.
 *
 * Formation options are otherwise distinguishable only by reading a row of
 * position codes, which made the two ten-player setups look like the same
 * option twice. The shape is the fastest way to tell nine defenders from ten,
 * and dots carry their position group's colour so the split between battery,
 * infield and outfield reads at a glance.
 */
export function FormationThumbnail({
  formation,
  className,
}: {
  formation: Formation;
  className?: string;
}) {
  const placed = formation.positions.filter(
    (position) => position.diagramX !== undefined && position.diagramY !== undefined,
  );

  const colorFor = (group: string) =>
    group === 'BATTERY'
      ? 'var(--battery)'
      : group === 'INFIELD'
        ? 'var(--infield)'
        : 'var(--outfield)';

  return (
    <svg
      viewBox="0 0 100 100"
      className={className}
      role="img"
      aria-label={`${formation.positions.length} defensive positions`}
    >
      {/* Fair territory and the base paths, at the same coordinates the full
          diamond view uses so the thumbnail is a true miniature. */}
      <path d="M 50 84 L 2 30 A 58 58 0 0 1 98 30 Z" fill="var(--field-grass)" />
      <path
        d="M 50 82 L 72 57 L 50 32 L 28 57 Z"
        fill="var(--field-infield)"
        stroke="var(--field-line)"
        strokeWidth="1.5"
      />

      {placed.map((position) => (
        <circle
          key={position.id}
          cx={position.diagramX}
          cy={position.diagramY}
          r="6"
          fill={colorFor(position.group)}
          stroke="var(--surface)"
          strokeWidth="2"
        />
      ))}
    </svg>
  );
}
