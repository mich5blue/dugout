import { cn } from '@/lib/cn';

/**
 * The InningGrid mark: a home plate holding a grid, with one cell filled and a
 * player in it.
 *
 * Redrawn as SVG rather than shipping the raster logo. At header size a PNG of
 * this is mush, and the supplied asset carries an app-icon treatment — rounded
 * tile, white keyline, drop shadow — that has no business inside the page
 * chrome. Drawn, it also inherits colour, which is what lets the same
 * component go monochrome on paper.
 *
 * Two levels of detail, because the full mark does not survive being small.
 * Rendered at 20-32px the nine cells collapse into a dark blob and the green
 * centre — the whole point of the mark — disappears. So `compact` keeps only
 * what carries meaning at that size: the plate, and one filled cell where a
 * player goes. `full` is for 64px and up.
 *
 * The brand green is confined to this file on purpose. It sits 0.3 dE from
 * --critical under red-green colour blindness, so a green control beside a red
 * one is a coin flip; the interface accent stays lime and the green appears
 * only in the mark. On paper both collapse to ink.
 */
export function BrandMark({
  className,
  detail = 'compact',
  tone = 'brand',
}: {
  className?: string;
  /** `compact` reads down to 20px; `full` is the nine-cell mark, 64px and up. */
  detail?: 'compact' | 'full';
  /** `mono` draws everything in currentColor, for print. */
  tone?: 'brand' | 'mono';
}) {
  const cell = tone === 'mono' ? 'currentColor' : 'var(--brand-green)';

  return (
    <svg
      viewBox="0 0 48 48"
      className={cn('shrink-0', className)}
      role="img"
      aria-label="InningGrid"
    >
      {/* The plate: square across the top and shoulders, then down to a point. */}
      <path
        d="M9 8.5h30v19.5L24 41.5 9 28Z"
        fill="none"
        stroke="currentColor"
        strokeWidth={detail === 'compact' ? 4 : 3.4}
        strokeLinejoin="round"
      />

      {detail === 'full' ? (
        <>
          {[0, 1, 2].map((row) =>
            [0, 1, 2].map((col) => {
              const middle = row === 1 && col === 1;
              return (
                <rect
                  key={`${row}-${col}`}
                  x={13.4 + col * 7.4}
                  y={12.9 + row * 7.4}
                  width="5.8"
                  height="5.8"
                  rx="1.4"
                  fill={middle ? cell : 'currentColor'}
                  opacity={middle ? 1 : 0.9}
                />
              );
            }),
          )}
          {/* The player in the middle cell: head and shoulders, knocked out. */}
          <circle cx="24" cy="18.4" r="1.35" fill="var(--bg)" />
          <path d="M21.6 23.1a2.45 2.45 0 0 1 4.8 0Z" fill="var(--bg)" />
        </>
      ) : (
        /*
          One cell, big enough to survive 20px, flanked by two slivers so it
          still reads as a cell in a grid rather than a dot on a plate.
        */
        <>
          <rect x="14.2" y="17.4" width="3" height="9.2" rx="1" fill="currentColor" opacity="0.55" />
          <rect x="18.8" y="16.4" width="10.4" height="11.2" rx="2.2" fill={cell} />
          <rect x="30.8" y="17.4" width="3" height="9.2" rx="1" fill="currentColor" opacity="0.55" />
        </>
      )}
    </svg>
  );
}

/**
 * The wordmark. Two-tone, as the logo has it: the second half carries the
 * brand green so "GRID" reads as the thing the product is named for.
 */
export function BrandWordmark({ className }: { className?: string }) {
  return (
    <span className={cn('scoreboard', className)}>
      <span className="text-ink">Inning</span>
      <span style={{ color: 'var(--brand-green)' }}>Grid</span>
    </span>
  );
}
