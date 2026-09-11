'use client';

import { Badge, Card, CardHeader, EmptyState, GROUP_STYLE } from '@/components/ui';
import { formatGameDate } from '@/lib/format';
import {
  GROUP_FROM_CODE,
  decodeShare,
  sharedPlayerAt,
  type SharePayload,
} from '@/lib/shareLink';
import { cn } from '@/lib/cn';
import { useParams } from 'next/navigation';
import { useEffect, useState } from 'react';

/**
 * A shared lineup, read-only.
 *
 * Everything is decoded from the URL, so this page works for someone with no
 * account, no data and no connection to the coach's device. It shows only what
 * a parent should see: names, batting order, positions and bench.
 */
export default function SharedLineupPage() {
  const params = useParams<{ token: string }>();
  const [payload, setPayload] = useState<SharePayload | null>(null);
  const [state, setState] = useState<'loading' | 'ready' | 'invalid'>('loading');

  useEffect(() => {
    let active = true;
    void decodeShare(params.token).then((result) => {
      if (!active) return;
      setPayload(result);
      setState(result ? 'ready' : 'invalid');
    });
    return () => {
      active = false;
    };
  }, [params.token]);

  if (state === 'loading') return null;

  if (state === 'invalid' || !payload) {
    return (
      <div className="mx-auto max-w-lg px-4 py-16">
        <EmptyState
          title="This lineup link isn't readable"
          description="It may have been cut short when it was shared. Ask your coach to send it again."
        />
      </div>
    );
  }

  const innings = Array.from({ length: payload.i }, (_, index) => index + 1);

  return (
    <div className="mx-auto max-w-5xl px-4 py-8 sm:px-6">
      <header className="mb-6">
        <p className="eyebrow text-ink-subtle">Lineup</p>
        <h1 className="display mt-1 text-4xl text-ink sm:text-5xl">
          {payload.t} <span className="text-ink-subtle">vs</span> {payload.o || 'TBD'}
        </h1>
        <p className="mt-2 text-sm text-ink-muted">{formatGameDate(payload.d)}</p>
      </header>

      <div className="space-y-4">
        <Card>
          <CardHeader title="Defensive rotation" />
          {/*
            The hint is phone-only: a wide screen fits every inning, and telling
            a desktop reader to scroll sideways sends them looking for something
            that isn't there.
          */}
          {payload.i > 3 ? (
            <p className="border-b border-border px-5 py-2 text-xs text-ink-subtle sm:hidden">
              Scroll sideways for later innings.
            </p>
          ) : null}
          <div className="overflow-x-auto">
            <table className="w-full border-collapse text-sm">
              <thead>
                <tr className="bg-header-tint">
                  <th className="px-3 py-2.5 text-left text-[11px] font-semibold tracking-wider text-ink-muted uppercase">
                    Position
                  </th>
                  {innings.map((inning) => (
                    <th
                      key={inning}
                      className="min-w-24 px-2 py-2.5 text-center text-[11px] font-semibold tracking-wider text-ink-muted uppercase"
                    >
                      Inn {inning}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {payload.p.map((code, positionIndex) => {
                  const group = GROUP_FROM_CODE[payload.g[positionIndex] ?? 'I'];
                  const style = GROUP_STYLE[group];
                  return (
                    <tr key={code} className="border-t border-border">
                      <th scope="row" className="px-3 py-1.5 text-left">
                        <span className="flex items-center gap-2.5">
                          <span
                            className={cn('h-6 w-1 shrink-0 rounded-full', style.dot)}
                            aria-hidden
                          />
                          <span className="text-sm font-semibold text-ink">{code}</span>
                        </span>
                      </th>
                      {innings.map((inning) => (
                        <td key={inning} className="p-1">
                          <span
                            className={cn(
                              'block truncate rounded-lg px-2.5 py-1.5 text-sm font-medium text-ink',
                              style.chip,
                            )}
                          >
                            {sharedPlayerAt(payload, inning, positionIndex) ?? '—'}
                          </span>
                        </td>
                      ))}
                    </tr>
                  );
                })}

                <tr className="border-t-2 border-border-strong bg-bench-soft/50">
                  <th scope="row" className="px-3 py-1.5 text-left">
                    <span className="flex items-center gap-2.5">
                      <span
                        className={cn('h-6 w-1 shrink-0 rounded-full', GROUP_STYLE.BENCH.dot)}
                        aria-hidden
                      />
                      <span className="text-sm font-semibold text-ink-muted">Bench</span>
                    </span>
                  </th>
                  {innings.map((inning) => (
                    <td key={inning} className="p-1 text-sm text-ink-muted">
                      {(payload.bn[inning - 1] ?? [])
                        .map((index) => payload.n[index])
                        .join(', ') || '—'}
                    </td>
                  ))}
                </tr>
              </tbody>
            </table>
          </div>
        </Card>

        <Card>
          <CardHeader title="Batting order" />
          {/*
            Two columns on a wide screen: a single column of eleven names left
            most of the card empty and pushed the rotation below the fold.
          */}
          <ol className="sm:grid sm:grid-cols-2 sm:gap-x-4 sm:px-2 sm:py-2">
            {payload.b.map((playerIndex, slot) => (
              <li
                key={slot}
                className="flex items-center gap-3 border-t border-border px-4 py-2 first:border-t-0 sm:border-t-0"
              >
                <span className="tnum w-5 text-sm font-semibold text-ink-subtle">
                  {slot + 1}
                </span>
                <span className="min-w-0 flex-1 truncate text-sm font-medium text-ink">
                  {payload.n[playerIndex]}
                </span>
              </li>
            ))}
          </ol>
        </Card>
      </div>

      <footer className="mt-8 flex flex-wrap items-center gap-2 border-t border-border pt-4">
        <Badge tone="neutral">Read-only</Badge>
        <p className="text-sm text-ink-subtle">
          Shared from Dugout. This link contains the lineup itself, so it keeps working
          without an account.
        </p>
      </footer>
    </div>
  );
}
