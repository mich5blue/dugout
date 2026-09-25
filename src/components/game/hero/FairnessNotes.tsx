'use client';

import { Badge, Button, Card, CardHeader } from '@/components/ui';
import type { Explanation, LineupCheck, LineupQuality } from '@/optimizer';
import { cn } from '@/lib/cn';
import { useState } from 'react';

/**
 * What the lineup did, and whether it holds up.
 *
 * Both panels come straight out of the engine — `explanations` and
 * `quality.checks` have existed since the first version and were shown as a
 * score plus a collapsed metric list, which is the shape of a diagnostic
 * readout rather than an explanation. A coach does not want to know the lineup
 * scored 92; they want to know why Calvin is catching.
 */

export function FairnessNotes({
  explanations,
  onWhyAnything,
}: {
  explanations: Explanation[];
  /** Points at the grid, because that is where per-cell answers live. */
  onWhyAnything?: () => void;
}) {
  if (explanations.length === 0) {
    return (
      <Card>
        <CardHeader
          title="Why this lineup"
          description="Nothing unusual to report — the lineup follows your rules with no trade-offs worth flagging."
        />
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader
        title="Why this lineup"
        description="The decisions most worth questioning, in the order they surprise."
      />
      <ul className="divide-y divide-border">
        {explanations.map((explanation, index) => (
          <li key={index} className="px-4 py-3 text-sm leading-relaxed text-ink-muted">
            {explanation.text}
          </li>
        ))}
      </ul>
      {onWhyAnything ? (
        <p className="border-t border-border px-4 py-2.5 text-xs text-ink-subtle">
          Tap any cell in the grid to ask why that player is there.
        </p>
      ) : null}
    </Card>
  );
}

/**
 * Rule checks: a list of plain statements that are either true or not.
 *
 * Passing checks stay visible rather than collapsing to a count. "Nobody sits
 * twice in a row ✓" is the reassurance the coach came for, and hiding it
 * behind "7 checks passed" means they have to click to find out whether the
 * one they care about is in there.
 */
export function RuleChecks({
  quality,
  onFix,
}: {
  quality: LineupQuality;
  /** Offered only where a failure has a fix that does not need a judgement. */
  onFix?: (check: LineupCheck) => void;
}) {
  const [metricsOpen, setMetricsOpen] = useState(false);
  const failed = quality.checks.filter((check) => !check.ok);

  return (
    <Card>
      <CardHeader
        title="Rule checks"
        action={
          failed.length === 0 ? (
            <Badge tone="positive">All clear</Badge>
          ) : (
            <Badge tone="caution">
              {failed.length} to look at
            </Badge>
          )
        }
      />

      <ul className="divide-y divide-border">
        {/* Failures first: a list a coach scans top-down should not bury the
            one line that needs them. */}
        {[...quality.checks].sort((a, b) => Number(a.ok) - Number(b.ok)).map((check) => (
          <li key={check.label} className="flex items-start gap-2.5 px-4 py-2.5">
            <span
              aria-hidden
              className={cn(
                'mt-0.5 flex size-4 shrink-0 items-center justify-center rounded-full text-[10px] font-bold',
                check.ok
                  ? 'bg-positive-soft text-positive'
                  : 'bg-caution-soft text-caution',
              )}
            >
              {check.ok ? '✓' : '!'}
            </span>
            <span
              className={cn(
                'min-w-0 flex-1 text-sm leading-relaxed',
                check.ok ? 'text-ink-muted' : 'text-ink',
              )}
            >
              {check.label}
              <span className="sr-only">{check.ok ? ' — passing' : ' — needs attention'}</span>
            </span>
            {!check.ok && onFix ? (
              <Button size="sm" variant="ghost" onClick={() => onFix(check)}>
                Fix
              </Button>
            ) : null}
          </li>
        ))}
      </ul>

      {/* The numbers, for a coach who wants to check the machine. */}
      <div className="border-t border-border">
        <button
          type="button"
          onClick={() => setMetricsOpen((open) => !open)}
          aria-expanded={metricsOpen}
          className="ring-focus flex w-full items-center justify-between gap-3 px-4 py-2.5 text-left"
        >
          <span className="text-xs font-medium text-ink-muted">
            How this lineup scored
          </span>
          <span
            aria-hidden
            className={cn('text-ink-subtle transition-transform', metricsOpen && 'rotate-90')}
          >
            ›
          </span>
        </button>
        {metricsOpen ? (
          <dl className="space-y-2.5 border-t border-border px-4 py-3">
            {quality.metrics.map((metric) => (
              <div key={metric.key}>
                <div className="flex items-baseline justify-between gap-3">
                  <dt className="text-xs text-ink-muted">{metric.label}</dt>
                  <dd className="tnum text-xs font-semibold text-ink">
                    {Math.round(metric.value * 100)}
                  </dd>
                </div>
                <div className="mt-1 h-1 overflow-hidden rounded-full bg-surface-muted">
                  <div
                    className={cn(
                      'h-full rounded-full',
                      metric.rating === 'EXCELLENT' || metric.rating === 'GOOD'
                        ? 'bg-positive'
                        : metric.rating === 'FAIR'
                          ? 'bg-caution'
                          : 'bg-critical',
                    )}
                    style={{ width: `${Math.round(metric.value * 100)}%` }}
                  />
                </div>
                {metric.detail ? (
                  <p className="mt-1 text-[11px] text-ink-subtle">{metric.detail}</p>
                ) : null}
              </div>
            ))}
            <p className="border-t border-border pt-2.5 text-[11px] text-ink-subtle">
              Scored against what was achievable with the players you had — not against a
              perfect lineup no roster could reach.
            </p>
          </dl>
        ) : null}
      </div>
    </Card>
  );
}
