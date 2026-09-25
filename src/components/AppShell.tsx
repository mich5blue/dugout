'use client';

import { useDugout } from '@/app/providers';
import { BrandMark, BrandWordmark } from '@/components/BrandMark';
import { SignInScreen } from '@/components/SignInScreen';
import { TeamSwitcher } from '@/components/TeamSwitcher';
import { cn } from '@/lib/cn';
import Link from 'next/link';
import { usePathname } from 'next/navigation';

/**
 * Five destinations, down from six.
 *
 * Coaches was a top-level tab for a screen most coaches open once a season, and
 * "Roster" named the object rather than the place — a coach going to check who
 * can catch is going to their team. So Roster becomes Team and carries the link
 * to Coaches, which is where it is looked for anyway.
 *
 * Six tabs at 375px left about 62px each, which is why "Dashboard" and "Team
 * Settings" needed a separate `short`. At five they fit, and the label is the
 * same word in both bars — one name per destination.
 */
const NAV = [
  { href: '/', label: 'Home' },
  { href: '/team', label: 'Team' },
  { href: '/games', label: 'Games' },
  { href: '/season', label: 'Season' },
  { href: '/settings', label: 'Settings' },
];

export function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const { team, role, setPreviewRole, backend, account, authReady, demoMode, exitDemo } =
    useDugout();

  /*
    Three surfaces own the whole screen.

    Print and a shared lineup, because a parent opening a share link has no
    team and team navigation would be dead ends. And game day, because a coach
    at a fence in the sun holding a phone in one hand does not need five tabs
    and a team switcher — everything on that screen has to be the game.
  */
  const bare =
    (pathname?.includes('/print') ?? false) ||
    (pathname?.startsWith('/s/') ?? false) ||
    (pathname?.endsWith('/live') ?? false);
  if (bare) return <>{children}</>;

  /*
    With a backend configured there is nothing to show before sign-in — the data
    lives in the account. Shared lineups are already past this point, because a
    parent opening a link has no account and needs none.
  */
  /*
    The guide is readable without an account.

    The landing page invites a visitor to read "How it works" before they sign
    up, and behind the sign-in wall that invitation is a dead end. There is
    nothing in the guide to protect: it is help text and pictures of a fixture
    team. Feedback stays behind sign-in, because it writes to the database and
    the rules require an account to stop anonymous submissions.
  */
  const publicPage = pathname?.startsWith('/guide') ?? false;

  if (backend === 'firebase') {
    if (!authReady) return null;
    if (!account && !publicPage) return <SignInScreen />;
  }

  /*
    Setup is a focused flow with its own footer. Now that it is reachable while
    a team already exists, the phone tab bar sat on top of its Continue button
    — and tab navigation mid-wizard is a way to lose half-entered work anyway.
  */
  const focused = pathname?.startsWith('/setup') ?? false;
  const showNav = Boolean(team) && !focused;

  return (
    <div className="min-h-dvh">
      <header className="sticky top-0 z-30 border-b border-border bg-bg/85 backdrop-blur-xl print-hide">
        <div className="mx-auto flex max-w-6xl items-center gap-4 px-4 py-3 sm:px-6">
          <Link href="/" className="ring-focus flex shrink-0 items-center gap-2 rounded-md">
            <BrandMark className="size-6 text-ink" />
            {/* The wordmark gives up its space to the team name on a phone. */}
            <BrandWordmark className="hidden text-2xl sm:inline" />
          </Link>

          <TeamSwitcher />

          {showNav ? (
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
              Smart lineups. More play time.
            </span>
          )}

          {/*
            Help sits outside the tab set on purpose. The phone bar is already
            six tabs at 62px each, and a seventh would shrink every one of them
            to make room for the thing a coach needs least often — but it has
            to be on every screen, because "where do I ask" is exactly the
            question you have when you are lost.
          */}
          <Link
            href="/guide"
            aria-label="How to use InningGrid"
            title="How to use InningGrid"
            className={cn(
              'ring-focus ml-1 flex size-8 shrink-0 items-center justify-center rounded-full border text-sm font-semibold transition-colors',
              pathname?.startsWith('/guide') || pathname?.startsWith('/feedback')
                ? 'border-accent text-ink'
                : 'border-border text-ink-muted hover:border-border-strong hover:text-ink',
            )}
          >
            ?
          </Link>
        </div>
      </header>

      {/*
        The demo must never be mistaken for a real team. A visitor can edit
        everything in here, so the banner says plainly that it is a sandbox on
        this device and offers the way out.
      */}
      {demoMode ? (
        <div className="border-b border-accent/30 bg-accent-soft print-hide">
          <div className="mx-auto flex max-w-6xl flex-wrap items-center gap-3 px-4 py-2 sm:px-6">
            <span className="text-sm text-ink">
              You&apos;re exploring the <strong>demo team</strong> — change anything you
              like. It stays on this device and is not saved to an account.
            </span>
            <button
              type="button"
              onClick={exitDemo}
              className="ring-focus ml-auto rounded-md border border-accent/50 px-2.5 py-1 text-xs font-medium text-ink hover:bg-surface"
            >
              Sign in for real
            </button>
          </div>
        </div>
      ) : null}

      {/*
        A restricted session must never be mistaken for a broken one: if edit
        controls are missing, the reason is on screen with a way out.
      */}
      {team && role === 'ASSISTANT' ? (
        <div className="border-b border-caution/30 bg-caution-soft print-hide">
          <div className="mx-auto flex max-w-6xl flex-wrap items-center gap-3 px-4 py-2 sm:px-6">
            <span className="text-sm text-ink">
              Viewing as an <strong>assistant coach</strong> — you can set positions
              and core players; everything else is read-only.
            </span>
            <button
              type="button"
              onClick={() => setPreviewRole('HEAD_COACH')}
              className="ring-focus ml-auto rounded-md border border-border-strong px-2.5 py-1 text-xs font-medium text-ink hover:bg-surface"
            >
              Back to head coach
            </button>
          </div>
        </div>
      ) : null}

      <main className="mx-auto max-w-6xl px-4 py-6 pb-24 sm:px-6 sm:pb-10">{children}</main>

      {showNav ? (
        <nav className="fixed inset-x-0 bottom-0 z-30 border-t border-border bg-bg/95 pb-[env(safe-area-inset-bottom)] backdrop-blur sm:hidden print-hide">
          <div className="grid grid-cols-5">
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
                  {item.label}
                </Link>
              );
            })}
          </div>
        </nav>
      ) : null}
    </div>
  );
}
