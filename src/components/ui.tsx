'use client';

import { cn } from '@/lib/cn';
import type { PositionGroup } from '@/domain/types';
import React from 'react';

/** Small, hand-rolled primitives. No component library, no visual noise. */

type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger';
type ButtonSize = 'sm' | 'md' | 'lg';

const BUTTON_VARIANT: Record<ButtonVariant, string> = {
  primary:
    'bg-brand text-ink-inverse font-semibold hover:bg-brand-hover disabled:hover:bg-brand border border-transparent',
  secondary:
    'bg-surface-raised text-ink border border-border-strong hover:border-accent/50 hover:bg-surface-muted',
  ghost: 'bg-transparent text-ink-muted hover:text-ink hover:bg-surface-muted border border-transparent',
  danger: 'bg-surface text-critical border border-critical/40 hover:bg-critical-soft',
};

const BUTTON_SIZE: Record<ButtonSize, string> = {
  sm: 'h-8 px-3 text-sm rounded-lg',
  md: 'h-10 px-4 text-sm rounded-lg',
  lg: 'h-12 px-6 text-base rounded-xl',
};

export function Button({
  variant = 'secondary',
  size = 'md',
  className,
  ...props
}: React.ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: ButtonVariant;
  size?: ButtonSize;
}) {
  return (
    <button
      className={cn(
        'ring-focus inline-flex items-center justify-center gap-2 font-medium',
        'transition-[background-color,border-color,color,transform] active:scale-[0.98]',
        'disabled:cursor-not-allowed disabled:opacity-50 disabled:active:scale-100',
        BUTTON_VARIANT[variant],
        BUTTON_SIZE[size],
        className,
      )}
      {...props}
    />
  );
}

export function Card({
  className,
  interactive = false,
  ...props
}: React.HTMLAttributes<HTMLDivElement> & { interactive?: boolean }) {
  return (
    <div
      className={cn(
        'rounded-card border border-border bg-surface shadow-card print-plain',
        interactive &&
          'transition-[transform,box-shadow,border-color] duration-200 hover:-translate-y-0.5 hover:border-border-strong hover:shadow-lg',
        className,
      )}
      {...props}
    />
  );
}

export function CardHeader({
  title,
  description,
  action,
  className,
}: {
  title: React.ReactNode;
  description?: React.ReactNode;
  action?: React.ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        // A tinted band rather than a bare dividing line: it gives each card a
        // readable top edge without adding another border. The accent rail on
        // the left is the broadcast cue that ties a panel to the palette.
        'relative flex flex-wrap items-start justify-between gap-3 overflow-hidden rounded-t-card border-b border-border bg-header-tint px-5 py-3.5',
        'before:absolute before:inset-y-0 before:left-0 before:w-[3px] before:bg-accent before:content-[""]',
        className,
      )}
    >
      <div className="min-w-0">
        <h2 className="eyebrow text-ink">{title}</h2>
        {description ? (
          <p className="mt-1 text-sm text-ink-muted">{description}</p>
        ) : null}
      </div>
      {action}
    </div>
  );
}

export function Label({
  className,
  ...props
}: React.LabelHTMLAttributes<HTMLLabelElement>) {
  return (
    <label className={cn('eyebrow block text-ink-muted', className)} {...props} />
  );
}

export function Input({
  className,
  ...props
}: React.InputHTMLAttributes<HTMLInputElement>) {
  return (
    <input
      className={cn(
        'ring-focus h-10 w-full rounded-lg border border-border-strong bg-surface px-3 text-sm text-ink',
        'placeholder:text-ink-subtle',
        className,
      )}
      {...props}
    />
  );
}

export function Textarea({
  className,
  ...props
}: React.TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return (
    <textarea
      className={cn(
        'ring-focus w-full rounded-lg border border-border-strong bg-surface px-3 py-2 text-sm text-ink',
        'placeholder:text-ink-subtle',
        className,
      )}
      {...props}
    />
  );
}

export function Select({
  className,
  ...props
}: React.SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <select
      className={cn(
        'ring-focus h-10 w-full rounded-lg border border-border-strong bg-surface px-3 text-sm text-ink',
        className,
      )}
      {...props}
    />
  );
}

export function Badge({
  tone = 'neutral',
  className,
  ...props
}: React.HTMLAttributes<HTMLSpanElement> & {
  tone?: 'neutral' | 'brand' | 'positive' | 'caution' | 'critical';
}) {
  const tones = {
    neutral: 'bg-surface-muted text-ink-muted',
    brand: 'bg-brand-soft text-brand',
    positive: 'bg-positive-soft text-positive',
    caution: 'bg-caution-soft text-caution',
    critical: 'bg-critical-soft text-critical',
  } as const;
  return (
    <span
      className={cn(
        'inline-flex items-center rounded-md px-2 py-0.5 text-xs font-medium',
        tones[tone],
        className,
      )}
      {...props}
    />
  );
}

/**
 * Big, tappable on/off control used for availability, formations and rules.
 *
 * The selected state carries a filled check mark and a heavier ring, not just a
 * tinted background — a faint tint was nearly invisible in dark mode, and tint
 * alone would make selection a colour-only signal.
 */
export function Toggle({
  active,
  children,
  className,
  ...props
}: React.ButtonHTMLAttributes<HTMLButtonElement> & { active: boolean }) {
  return (
    <button
      type="button"
      aria-pressed={active}
      className={cn(
        'ring-focus group flex items-center gap-3 rounded-xl border px-4 py-3 text-left transition-all',
        active
          ? 'border-brand bg-brand-soft text-ink ring-2 ring-brand/25'
          : 'border-border bg-surface text-ink-muted hover:border-border-strong hover:bg-surface-muted',
        className,
      )}
      {...props}
    >
      <span
        aria-hidden
        className={cn(
          'flex size-5 shrink-0 items-center justify-center rounded-full border text-[11px] font-bold transition-colors',
          active
            ? 'border-brand bg-brand text-ink-inverse'
            : 'border-border-strong bg-surface text-transparent',
        )}
      >
        ✓
      </span>
      <span className="flex min-w-0 flex-1 items-center justify-between gap-3">
        {children}
      </span>
    </button>
  );
}

/** Segmented control for two-to-five mutually exclusive options. */
export function SegmentedControl<T extends string>({
  options,
  value,
  onChange,
  className,
  size = 'md',
}: {
  options: Array<{ value: T; label: string }>;
  value: T;
  onChange: (value: T) => void;
  className?: string;
  size?: 'sm' | 'md';
}) {
  return (
    <div
      role="radiogroup"
      className={cn(
        'inline-flex rounded-lg border border-border bg-bg/60 p-0.5',
        className,
      )}
    >
      {options.map((option) => (
        <button
          key={option.value}
          type="button"
          role="radio"
          aria-checked={value === option.value}
          onClick={() => onChange(option.value)}
          className={cn(
            'ring-focus rounded-md font-semibold tracking-wide transition-colors',
            size === 'sm' ? 'px-2.5 py-1 text-xs' : 'px-3 py-1.5 text-sm',
            value === option.value
              ? 'bg-brand text-ink-inverse'
              : 'text-ink-muted hover:bg-surface-muted hover:text-ink',
          )}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}

/**
 * Position-group visual identity.
 *
 * - `chip`  the tinted fill
 * - `text`  the readable group colour on that fill, for codes and labels
 * - `dot`   the full-strength swatch, for row rails and legends
 * - `rail`  a full-strength border, for the left edge of a grid cell
 * - `ring`  a softer border, for cards on the field where a tint alone loses
 *           against the grass
 *
 * Every `text`/`chip` pairing here is contrast-checked in both modes by
 * `npm run validate:palette`.
 */
export const GROUP_STYLE: Record<
  PositionGroup,
  { chip: string; text: string; dot: string; rail: string; ring: string }
> = {
  BATTERY: {
    chip: 'bg-battery-soft',
    text: 'text-battery',
    dot: 'bg-battery',
    rail: 'border-battery',
    ring: 'border-battery/60',
  },
  INFIELD: {
    chip: 'bg-infield-soft',
    text: 'text-infield',
    dot: 'bg-infield',
    rail: 'border-infield',
    ring: 'border-infield/60',
  },
  OUTFIELD: {
    chip: 'bg-outfield-soft',
    text: 'text-outfield',
    dot: 'bg-outfield',
    rail: 'border-outfield',
    ring: 'border-outfield/60',
  },
  BENCH: {
    chip: 'bg-bench-soft',
    text: 'text-bench',
    dot: 'bg-bench',
    rail: 'border-bench',
    ring: 'border-bench/50',
  },
};

export function EmptyState({
  title,
  description,
  action,
}: {
  title: string;
  description?: string;
  action?: React.ReactNode;
}) {
  return (
    <div className="flex flex-col items-center gap-3 px-6 py-14 text-center">
      <p className="text-base font-medium text-ink">{title}</p>
      {description ? (
        <p className="max-w-md text-sm text-ink-muted">{description}</p>
      ) : null}
      {action}
    </div>
  );
}

export function Spinner({ className }: { className?: string }) {
  return (
    <span
      className={cn(
        'inline-block size-4 animate-spin rounded-full border-2 border-current border-t-transparent',
        className,
      )}
      aria-hidden
    />
  );
}

/** Inline note used for conflicts, warnings and confirmations. */
export function Notice({
  tone = 'neutral',
  title,
  children,
  action,
  className,
}: {
  tone?: 'neutral' | 'brand' | 'positive' | 'caution' | 'critical';
  title?: React.ReactNode;
  children?: React.ReactNode;
  action?: React.ReactNode;
  className?: string;
}) {
  const tones = {
    neutral: 'border-border bg-surface-muted',
    brand: 'border-brand/30 bg-brand-soft',
    positive: 'border-positive/30 bg-positive-soft',
    caution: 'border-caution/30 bg-caution-soft',
    critical: 'border-critical/30 bg-critical-soft',
  } as const;

  return (
    <div className={cn('rounded-xl border px-4 py-3', tones[tone], className)}>
      {title ? <p className="text-sm font-semibold text-ink">{title}</p> : null}
      {children ? <div className="mt-1 text-sm text-ink-muted">{children}</div> : null}
      {action ? <div className="mt-3">{action}</div> : null}
    </div>
  );
}

/** Lightweight modal. Rendered inline; no portal library needed. */
export function Modal({
  open,
  onClose,
  title,
  children,
  footer,
}: {
  open: boolean;
  onClose: () => void;
  title: React.ReactNode;
  children: React.ReactNode;
  footer?: React.ReactNode;
}) {
  React.useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center p-0 sm:items-center sm:p-6">
      <button
        type="button"
        aria-label="Close"
        onClick={onClose}
        className="absolute inset-0 bg-black/40"
      />
      <div
        role="dialog"
        aria-modal="true"
        className="relative z-10 max-h-[88vh] w-full max-w-lg overflow-y-auto rounded-t-2xl border border-border bg-surface sm:rounded-2xl"
      >
        <div className="flex items-center justify-between border-b border-border px-5 py-4">
          <h2 className="text-base font-semibold text-ink">{title}</h2>
          <Button variant="ghost" size="sm" onClick={onClose} aria-label="Close">
            Close
          </Button>
        </div>
        <div className="px-5 py-4">{children}</div>
        {footer ? (
          <div className="flex justify-end gap-2 border-t border-border px-5 py-4">{footer}</div>
        ) : null}
      </div>
    </div>
  );
}

/**
 * Meter for a 0..1 quality value.
 *
 * The unfilled track is a lighter step of the fill's own hue rather than a
 * neutral gray, so the state reads across the whole bar. The fill carries
 * severity and is always accompanied by a text rating — colour never carries
 * the meaning on its own.
 */
export function Meter({
  value,
  tone = 'brand',
  className,
}: {
  value: number;
  tone?: 'positive' | 'brand' | 'caution' | 'critical';
  className?: string;
}) {
  const hue = {
    positive: 'var(--positive)',
    // --accent, not --brand: brand is the near-black action fill in light
    // mode, which would draw a black bar where the identity wants lime.
    brand: 'var(--accent)',
    caution: 'var(--caution)',
    critical: 'var(--critical)',
  }[tone];

  const pct = Math.max(0, Math.min(100, Math.round(value * 100)));

  return (
    <div
      className={cn('h-1.5 w-full overflow-hidden rounded-full', className)}
      style={{ backgroundColor: `color-mix(in srgb, ${hue} 16%, transparent)` }}
      role="presentation"
    >
      <div
        className="h-full rounded-r-[4px] transition-[width] duration-500 ease-out"
        style={{ width: `${pct}%`, backgroundColor: hue }}
      />
    </div>
  );
}

/**
 * Stat tile: label, value, optional hint.
 *
 * Figures render in the condensed scoreboard face. Deliberately not
 * tabular-nums: tabular gives every digit the width of a zero, which reads
 * loose at display sizes. Tabular figures are for columns that align
 * vertically, which is what the grids use.
 */
export function StatTile({
  label,
  value,
  hint,
  hero = false,
  className,
}: {
  label: string;
  value: React.ReactNode;
  hint?: React.ReactNode;
  hero?: boolean;
  className?: string;
}) {
  return (
    <div className={cn('min-w-0', className)}>
      <p className="eyebrow text-ink-muted">{label}</p>
      <p
        className={cn(
          'display mt-1.5 text-ink',
          hero ? 'text-6xl sm:text-7xl' : 'text-3xl',
        )}
      >
        {value}
      </p>
      {hint ? <p className="mt-1.5 text-xs text-ink-subtle">{hint}</p> : null}
    </div>
  );
}

/** Jersey roundel plus name, the player's identity everywhere they appear. */
export function PlayerChip({
  name,
  jerseyNumber,
  size = 'md',
  muted = false,
  className,
}: {
  name: string;
  jerseyNumber?: string;
  size?: 'sm' | 'md';
  muted?: boolean;
  className?: string;
}) {
  const initials = name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part.charAt(0).toUpperCase())
    .join('');

  return (
    <span className={cn('flex min-w-0 items-center gap-2', className)}>
      <span
        aria-hidden
        className={cn(
          'flex shrink-0 items-center justify-center rounded-full border font-semibold',
          muted
            ? 'border-border bg-surface-muted text-ink-subtle'
            : 'border-brand/20 bg-brand-soft text-brand',
          size === 'sm' ? 'size-6 text-[10px]' : 'size-8 text-xs',
        )}
      >
        {jerseyNumber ? jerseyNumber : initials}
      </span>
      <span
        className={cn(
          'min-w-0 truncate font-medium',
          muted ? 'text-ink-muted' : 'text-ink',
          size === 'sm' ? 'text-sm' : 'text-sm',
        )}
      >
        {name}
      </span>
    </span>
  );
}
