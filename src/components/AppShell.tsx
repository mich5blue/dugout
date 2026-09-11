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
 * The wordmark's glyph: a home plate, filled in the accent.
 *
 * Solid rather than outlined now — at 20px an outlined plate read as a generic
 * shield, and the mark has to hold its own next to condensed caps.
 */
function HomePlateMark() {
  return (
    <svg viewBox="0 0 20 20" className="size-5 text-accent" aria-hidden>
      <path d="M3 3.2h14v8.3L10 17.2 3 11.5Z" fill="currentColor" />
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
      <header className="sticky top-0 z-30 border-b border-border bg-bg/85 backdrop-blur-xl print-hide">
        <div className="mx-auto flex max-w-6xl items-center gap-4 px-4 py-3 sm:px-6">
          <Link href="/" className="ring-focus flex items-center gap-2 rounded-md">
            <HomePlateMark />
            <span className="scoreboard text-2xl text-ink">Dugout</span>
          </Link>

          {team ? (
            <nav className="ml-auto hidden items-center gap-0.5 sm:flex">
              {NAV.map((item) => {
                const active =
                  item.href === '/' ? pathname === '/' : pathname?.startsWith(item.href);
                return (
                  <Link
                    key={item.href}
                    href={item.href}
                    className={cn(
                      // The active tab is marked by an accent underline rather
                      // than a filled pill: the filled treatment is reserved
                      // for buttons, so navigation never looks pressable.
                      'ring-focus relative rounded-md px-3 py-2 text-sm font-medium transition-colors',
                      'after:absolute after:inset-x-3 after:bottom-0.5 after:h-[2px] after:rounded-full after:content-[""]',
                      active
                        ? 'text-ink after:bg-accent'
                        : 'text-ink-muted after:bg-transparent hover:text-ink',
                    )}
                  >
                    {item.label}
                  </Link>
                );
              })}
            </nav>
          ) : (
            <span className="ml-auto hidden text-sm text-ink-muted sm:block">
              Smart lineups for youth baseball &amp; softball
            </span>
          )}
        </div>
      </header>

      <main className="mx-auto max-w-6xl px-4 py-6 pb-24 sm:px-6 sm:pb-10">{children}</main>

      {team ? (
        <nav className="fixed inset-x-0 bottom-0 z-30 border-t border-border bg-bg/95 pb-[env(safe-area-inset-bottom)] backdrop-blur sm:hidden print-hide">
          <div className="grid grid-cols-4">
            {NAV.map((item) => {
              const active =
                item.href === '/' ? pathname === '/' : pathname?.startsWith(item.href);
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  className={cn(
                    // The accent bar sits on top of the tab so it reads as a
                    // selected edge against the header's underline language.
                    'ring-focus relative px-2 py-3.5 text-center text-xs font-semibold',
                    'before:absolute before:inset-x-5 before:top-0 before:h-[2px] before:rounded-full before:content-[""]',
                    active
                      ? 'text-ink before:bg-accent'
                      : 'text-ink-muted before:bg-transparent',
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
