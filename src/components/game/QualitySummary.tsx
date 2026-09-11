'use client';

import { Badge, Card, CardHeader, Notice } from '@/components/ui';
import { RATING_LABEL, RATING_TONE, percent } from '@/lib/format';
import type { Conflict, Explanation, LineupQuality, RelaxationSuggestion } from '@/optimizer';
import { cn } from '@/lib/cn';

/** Lineup quality summary (spec section 52) and the "why" behind it (section 42). */
export function QualitySummary({ quality }: { quality: LineupQuality }) {
  return (
    <Card>
      <CardHeader title="Lineup quality" />
      <div className="px-5 py-5">
        <div className="grid gap-4 sm:grid-cols-3">
          {quality.metrics.map((metric) => (
            <div key={metric.key}>
              <div className="flex items-baseline justify-between gap-2">
                <p className="text-xs font-semibold tracking-wide text-ink-muted uppercase">
                  {metric.label}
                </p>
                <span className="tnum text-xs text-ink-subtle">{percent(metric.value)}</span>
              </div>
              <p className="mt-1 text-base font-semibold text-ink">
                {RATING_LABEL[metric.rating]}
              </p>
              <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-surface-muted">
                <div
                  className={cn(
                    'h-full rounded-full',
                    metric.rating === 'EXCELLENT'
                      ? 'bg-positive'
                      : metric.rating === 'GOOD'
                        ? 'bg-brand'
                        : metric.rating === 'FAIR'
                          ? 'bg-caution'
                          : 'bg-critical',
                  )}
                  style={{ width: `${Math.round(metric.value * 100)}%` }}
                />
              </div>
              {metric.detail ? (
                <p className="mt-1.5 text-xs text-ink-subtle">{metric.detail}</p>
              ) : null}
            </div>
          ))}
        </div>

        {quality.checks.length > 0 ? (
          <ul className="mt-6 space-y-1.5">
            {quality.checks.map((check) => (
              <li key={check.label} className="flex items-start gap-2 text-sm">
                <span
                  className={cn(
                    'mt-0.5 shrink-0 font-semibold',
                    check.ok ? 'text-positive' : 'text-caution',
                  )}
                  aria-hidden
                >
                  {check.ok ? '✓' : '⚠'}
                </span>
                <span className={check.ok ? 'text-ink-muted' : 'text-ink'}>{check.label}</span>
              </li>
            ))}
          </ul>
        ) : null}
      </div>
    </Card>
  );
}

export function WhyThisLineup({ explanations }: { explanations: Explanation[] }) {
  if (explanations.length === 0) return null;
  return (
    <Card>
      <CardHeader title="Why this lineup?" />
      <ul className="divide-y divide-border">
        {explanations.map((explanation, index) => (
          <li key={index} className="px-5 py-3 text-sm text-ink-muted">
            {explanation.text}
          </li>
        ))}
      </ul>
    </Card>
  );
}

export function ConflictList({
  conflicts,
  relaxations,
  onApply,
}: {
  conflicts: Conflict[];
  relaxations: RelaxationSuggestion[];
  onApply?: (suggestion: RelaxationSuggestion) => void;
}) {
  const errors = conflicts.filter((conflict) => conflict.severity === 'ERROR');
  const warnings = conflicts.filter((conflict) => conflict.severity === 'WARNING');

  if (errors.length === 0 && warnings.length === 0) return null;

  return (
    <div className="space-y-3">
      {errors.length > 0 ? (
        <Notice tone="critical" title="We couldn't satisfy every rule.">
          <ul className="mt-1 space-y-1">
            {errors.map((conflict, index) => (
              <li key={index}>{conflict.message}</li>
            ))}
          </ul>

          {relaxations.length > 0 ? (
            <div className="mt-3">
              <p className="text-sm font-medium text-ink">Try one of these:</p>
              <ol className="mt-1.5 space-y-1.5">
                {relaxations.map((suggestion, index) => (
                  <li key={index} className="flex flex-wrap items-center gap-2 text-sm">
                    <span className="tnum text-ink-subtle">{index + 1}.</span>
                    <span className="text-ink">{suggestion.message}</span>
                    {onApply && suggestion.action ? (
                      <button
                        type="button"
                        onClick={() => onApply(suggestion)}
                        className="ring-focus rounded border border-border-strong px-2 py-0.5 text-xs font-medium text-ink hover:bg-surface-muted"
                      >
                        Apply
                      </button>
                    ) : null}
                  </li>
                ))}
              </ol>
            </div>
          ) : null}
        </Notice>
      ) : null}

      {warnings.length > 0 ? (
        <Notice tone="caution" title="Worth knowing">
          <ul className="mt-1 space-y-1">
            {warnings.slice(0, 5).map((conflict, index) => (
              <li key={index}>{conflict.message}</li>
            ))}
          </ul>
        </Notice>
      ) : null}
    </div>
  );
}

export function QualityBadges({ quality }: { quality: LineupQuality }) {
  return (
    <div className="flex flex-wrap gap-1.5">
      {quality.metrics.slice(0, 4).map((metric) => (
        <Badge key={metric.key} tone={RATING_TONE[metric.rating]}>
          {metric.label}: {RATING_LABEL[metric.rating]}
        </Badge>
      ))}
    </div>
  );
}
