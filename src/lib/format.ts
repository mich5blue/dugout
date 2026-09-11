import type { QualityRating } from '@/optimizer';

/** Date strings are stored as YYYY-MM-DD and formatted in local terms. */
export function parseGameDate(date: string): Date {
  const [year, month, day] = date.split('-').map(Number);
  return new Date(year, (month ?? 1) - 1, day ?? 1);
}

export function formatGameDate(date: string): string {
  return parseGameDate(date).toLocaleDateString(undefined, {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
  });
}

export function formatShortDate(date: string): string {
  return parseGameDate(date).toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
  });
}

export function formatDayAndDate(date: string): string {
  return parseGameDate(date).toLocaleDateString(undefined, {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
  });
}

export function todayIso(): string {
  const now = new Date();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  return `${now.getFullYear()}-${month}-${day}`;
}

export function percent(value: number): string {
  return `${Math.round(value * 100)}%`;
}

export function formatInnings(count: number): string {
  return `${count} ${count === 1 ? 'inning' : 'innings'}`;
}

export function formatSigned(value: number, digits = 1): string {
  const rounded = Number(value.toFixed(digits));
  if (rounded === 0) return '0';
  return rounded > 0 ? `+${rounded}` : `${rounded}`;
}

export const RATING_LABEL: Record<QualityRating, string> = {
  EXCELLENT: 'Excellent',
  GOOD: 'Good',
  FAIR: 'Fair',
  POOR: 'Needs work',
};

export const RATING_TONE: Record<QualityRating, 'positive' | 'brand' | 'caution' | 'critical'> = {
  EXCELLENT: 'positive',
  GOOD: 'brand',
  FAIR: 'caution',
  POOR: 'critical',
};

export function ordinal(value: number): string {
  const mod100 = value % 100;
  if (mod100 >= 11 && mod100 <= 13) return `${value}th`;
  switch (value % 10) {
    case 1:
      return `${value}st`;
    case 2:
      return `${value}nd`;
    case 3:
      return `${value}rd`;
    default:
      return `${value}th`;
  }
}
