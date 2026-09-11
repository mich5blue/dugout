'use client';

import { useDugout } from '@/app/providers';
import { cn } from '@/lib/cn';
import Link from 'next/link';
import { useEffect, useRef, useState } from 'react';

/**
 * The team the app is showing, and the way to change it.
 *
 * A coach running two teams — a rec team and a travel team, or two age groups —
 * had no way to reach the second one: every page read the first team on the
 * device, so creating another looked like it had failed. This is also where
 * "Add a team" lives, because the only place it makes sense to ask for a new
 * team is next to the name of the current one.
 */
export function TeamSwitcher() {
  const { team, teams, setActiveTeam, account, signOut } = useDugout();
  const [open, setOpen] = useState(false);
  const container = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: MouseEvent | TouchEvent) => {
      if (!container.current?.contains(event.target as Node)) setOpen(false);
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', onPointerDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onPointerDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  if (!team) return null;

  /*
    With one team there is nothing to switch between, so the control is a plain
    label — but it still opens, because "Add a team" has to be reachable from
    the first team as well as the fifth.
  */
  return (
    <div ref={container} className="relative min-w-0">
      <button
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
        className="ring-focus flex min-w-0 items-center gap-1.5 rounded-lg border border-border px-2.5 py-1.5 text-sm font-medium text-ink hover:border-border-strong"
      >
        <span className="truncate">{team.name}</span>
        {teams.length > 1 ? (
          <span className="tnum shrink-0 rounded bg-surface-muted px-1 text-[10px] font-semibold text-ink-muted">
            {teams.length}
          </span>
        ) : null}
        <span aria-hidden className="shrink-0 text-[10px] text-ink-subtle">
          ▾
        </span>
      </button>

      {open ? (
        <div
          role="menu"
          className="absolute left-0 top-full z-40 mt-1 w-64 overflow-hidden rounded-card border border-border bg-surface shadow-lg"
        >
          {teams.length > 1 ? (
            <p className="eyebrow border-b border-border bg-header-tint px-3 py-2 text-ink-muted">
              Your teams
            </p>
          ) : null}

          <ul className="max-h-72 overflow-y-auto">
            {teams.map((candidate) => {
              const active = candidate.id === team.id;
              return (
                <li key={candidate.id}>
                  <button
                    type="button"
                    role="menuitemradio"
                    aria-checked={active}
                    onClick={() => {
                      setActiveTeam(candidate.id);
                      setOpen(false);
                    }}
                    className={cn(
                      'ring-focus flex w-full items-center gap-2.5 px-3 py-2.5 text-left text-sm hover:bg-surface-muted',
                      active && 'bg-brand-soft',
                    )}
                  >
                    <span
                      aria-hidden
                      className={cn(
                        'w-3 shrink-0 text-xs font-bold',
                        active ? 'text-brand' : 'text-transparent',
                      )}
                    >
                      ✓
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate font-medium text-ink">
                        {candidate.name}
                      </span>
                      <span className="block truncate text-xs text-ink-muted">
                        {candidate.seasonName}
                        {candidate.division ? ` · ${candidate.division}` : ''}
                      </span>
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>

          <Link
            href="/setup"
            onClick={() => setOpen(false)}
            className="ring-focus flex items-center gap-2.5 border-t border-border px-3 py-2.5 text-sm font-medium text-ink hover:bg-surface-muted"
          >
            <span aria-hidden className="w-3 shrink-0 text-center text-ink-muted">
              +
            </span>
            Add a team
          </Link>

          {account ? (
            <div className="border-t border-border px-3 py-2.5">
              <p className="truncate text-xs text-ink-subtle">
                {account.email || account.name}
              </p>
              <button
                type="button"
                onClick={() => void signOut()}
                className="ring-focus mt-1 rounded text-sm font-medium text-ink hover:underline"
              >
                Sign out
              </button>
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
