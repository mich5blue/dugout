'use client';

import { useDugout } from '@/app/providers';
import { cn } from '@/lib/cn';
import Link from 'next/link';
import { usePathname } from 'next/navigation';

const NAV = [
  { href: '/', label: 'Dashboard' },
  { href: '/roster', label: 'Roster' },
  { href: '/season', label: 'Season' },
  { href: '/settings', label: 'Team Settings' },
];

/**
 * The wordmark's glyph: a home plate.
 *
 * A restrained sport cue — flat geometry in the brand colour, no stitching and
 * no cartoon baseball, per the design direction.
 */
function HomePlateMark() {
  return (
    <svg viewBox="0 0 20 20" className="size-5 text-brand" aria-hidden>
      <path
        d="M3 3.2h14v8.3L10 17.2 3 11.5Z"
        fill="currentColor"
        opacity="0.16"
      />
      <path
        d="M3 3.2h14v8.3L10 17.2 3 11.5Z"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinejoin="round"
      />
    </svg>
  );
}

export function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const { team } = useDugout();

  // Print and game-day views own the whole screen.
  const bare = pathname?.includes('/print') ?? false;
  if (bare) return <>{children}</>;

  return (
    <div className="min-h-dvh">
      <header className="sticky top-0 z-30 border-b border-border bg-surface/80 backdrop-blur-xl print-hide">
        <div className="mx-auto flex max-w-6xl items-center gap-4 px-4 py-3 sm:px-6">
          <Link href="/" className="ring-focus flex items-center gap-2.5 rounded-md">
            <HomePlateMark />
            <span className="text-lg font-semibold tracking-tight text-ink">Dugout</span>
          </Link>

          {team ? (
            <nav className="ml-auto hidden items-center gap-1 sm:flex">
              {NAV.map((item) => {
                const active =
                  item.href === '/' ? pathname === '/' : pathname?.startsWith(item.href);
                return (
                  <Link
                    key={item.href}
                    href={item.href}
                    className={cn(
                      'ring-focus relative rounded-lg px-3 py-1.5 text-sm font-medium transition-colors',
                      active
                        ? 'bg-brand-soft text-brand'
                        : 'text-ink-muted hover:bg-surface-muted hover:text-ink',
                    )}
                  >
                    {item.label}
                  </Link>
                );
              })}
            </nav>
          ) : (
            <span className="ml-auto text-sm text-ink-muted">
              Smart lineups for youth baseball &amp; softball
            </span>
          )}
        </div>
      </header>

      <main className="mx-auto max-w-6xl px-4 py-6 pb-24 sm:px-6 sm:pb-10">{children}</main>

      {team ? (
        <nav className="fixed inset-x-0 bottom-0 z-30 border-t border-border bg-surface/95 backdrop-blur sm:hidden print-hide">
          <div className="grid grid-cols-4">
            {NAV.map((item) => {
              const active =
                item.href === '/' ? pathname === '/' : pathname?.startsWith(item.href);
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  className={cn(
                    'ring-focus px-2 py-3 text-center text-xs font-medium',
                    active ? 'text-brand' : 'text-ink-muted',
                  )}
                >
                  {item.label === 'Team Settings' ? 'Settings' : item.label}
                </Link>
              );
            })}
          </div>
        </nav>
      ) : null}
    </div>
  );
}
