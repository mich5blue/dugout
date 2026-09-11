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

export function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const { team } = useDugout();

  // Print and game-day views own the whole screen.
  const bare = pathname?.includes('/print') ?? false;
  if (bare) return <>{children}</>;

  return (
    <div className="min-h-dvh">
      <header className="sticky top-0 z-30 border-b border-border bg-bg/85 backdrop-blur print-hide">
        <div className="mx-auto flex max-w-6xl items-center gap-4 px-4 py-3 sm:px-6">
          <Link href="/" className="ring-focus flex items-baseline gap-2 rounded-md">
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
                      'ring-focus rounded-lg px-3 py-1.5 text-sm font-medium transition-colors',
                      active
                        ? 'bg-surface text-ink shadow-sm'
                        : 'text-ink-muted hover:text-ink',
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
