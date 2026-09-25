'use client';

import { Button, Card, CardHeader } from '@/components/ui';
import type { FairnessAlert } from '@/domain/season';
import { cn } from '@/lib/cn';
import { STANDING_LABEL, type StandingCounts } from '@/services/fairness';
import Link from 'next/link';

/**
 * Where the season stands, in three numbers a coach can act on.
 *
 * This replaces a "Season balance 93%" tile. The percentage was accurate and
 * inert: it told a coach the machine was satisfied without telling them who to
 * play more. Three counts name the work — and the alerts under them name the
 * players, because "2 players are owed infield opportunities" is useful and a
 * generic notification is not.
 */

const BUCKETS = [
  {
    key: 'OWED' as const,
    /* Caution, not critical. Being owed an inning is the normal state of a
       fair season halfway through, never an error. */
    tone: 'text-caution',
    fill: 'bg-caution',
    blurb: 'need more time',
  },
  {
    key: 'ON_TARGET' as const,
    tone: 'text-positive',
    fill: 'bg-positive',
    blurb: 'where they should be',
  },
  {
    key: 'AHEAD' as const,
    tone: 'text-infield',
    fill: 'bg-infield',
    blurb: 'have played extra',
  },
];

export function FairnessSnapshot({
  counts,
  alerts,
  onPrioritize,
  prioritized,
}: {
  counts: StandingCounts;
  alerts: FairnessAlert[];
  onPrioritize?: (alert: FairnessAlert) => void;
  /** Already flagged for the next lineup, so the button reads as done. */
  prioritized?: (alert: FairnessAlert) => boolean;
}) {
  const total = counts.OWED + counts.ON_TARGET + counts.AHEAD;

  return (
    <Card>
      <CardHeader
        title="Season fairness"
        description="Measured against the innings each player was actually there for."
        action={
          <Link href="/season">
            <Button size="sm" variant="ghost">
              View details
            </Button>
          </Link>
        }
      />

      <div className="px-5 py-5">
        <div className="grid grid-cols-3 gap-3">
          {BUCKETS.map((bucket) => (
            <div key={bucket.key}>
              <p className={cn('display text-4xl leading-none', bucket.tone)}>
                {counts[bucket.key]}
              </p>
              <p className="eyebrow mt-1.5 text-ink">{STANDING_LABEL[bucket.key]}</p>
              <p className="mt-0.5 text-xs text-ink-subtle">{bucket.blurb}</p>
            </div>
          ))}
        </div>

        {/*
          One bar, three segments, in the same order as the columns above it.
          Labelled by the counts rather than by colour — the numbers above are
          the reading, and this is the shape of it.
        */}
        {total > 0 ? (
          <div
            className="mt-4 flex h-2 gap-0.5 overflow-hidden rounded-full"
            role="img"
            aria-label={BUCKETS.map(
              (bucket) => `${counts[bucket.key]} ${STANDING_LABEL[bucket.key]}`,
            ).join(', ')}
          >
            {BUCKETS.map((bucket) =>
              counts[bucket.key] > 0 ? (
                <span
                  key={bucket.key}
                  className={bucket.fill}
                  style={{ width: `${(counts[bucket.key] / total) * 100}%` }}
                />
              ) : null,
            )}
          </div>
        ) : null}

        {counts.unplayed > 0 ? (
          <p className="mt-3 text-xs text-ink-subtle">
            <span className="tnum">{counts.unplayed}</span>{' '}
            {counts.unplayed === 1 ? 'player has' : 'players have'} not played a recorded
            game yet, so {counts.unplayed === 1 ? 'they are' : 'they are'} not counted here.
          </p>
        ) : null}
      </div>

      {/*
        Named, actionable alerts. Capped at three on Home: the Season page is
        where a coach reads the whole list, and a dashboard that scrolls is a
        dashboard nobody finishes.
      */}
      {alerts.length > 0 ? (
        <div className="border-t border-border">
          <ul className="divide-y divide-border">
            {alerts.slice(0, 3).map((alert) => {
              const done = prioritized?.(alert) ?? false;
              return (
                <li key={alert.id} className="flex flex-wrap items-center gap-3 px-5 py-3">
                  <span className="min-w-0 flex-1 text-sm text-ink">{alert.message}</span>
                  {onPrioritize ? (
                    <Button
                      size="sm"
                      variant="ghost"
                      disabled={done}
                      onClick={() => onPrioritize(alert)}
                    >
                      {done ? 'Prioritized' : 'Prioritize next game'}
                    </Button>
                  ) : null}
                </li>
              );
            })}
          </ul>
          {alerts.length > 3 ? (
            <Link
              href="/season"
              className="ring-focus block border-t border-border px-5 py-2.5 text-xs text-ink-muted hover:text-ink"
            >
              {alerts.length - 3} more to look at
            </Link>
          ) : null}
        </div>
      ) : total > 0 ? (
        <p className="border-t border-border px-5 py-3 text-sm text-ink-muted">
          Nothing needs attention — every player is within an inning of where they
          should be.
        </p>
      ) : null}
    </Card>
  );
}
