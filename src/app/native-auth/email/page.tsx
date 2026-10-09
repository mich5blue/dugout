'use client';

import { BrandMark, BrandWordmark } from '@/components/BrandMark';
import { Notice } from '@/components/ui';
import { useSearchParams } from 'next/navigation';
import { Suspense, useEffect, useState } from 'react';

/**
 * Where an iOS app's email sign-in link lands.
 *
 * The link opens in Mail, then Safari, never in the app, so this page passes
 * the link's one-time code on to `inninggrid://auth/email`. The app redeems it
 * against the address it asked for the link with. The code is single-use and
 * bound to that address, so this page never holds anything worth stealing —
 * and it signs nothing in itself.
 */
export default function NativeEmailBridge() {
  return (
    <Suspense fallback={null}>
      <Forward />
    </Suspense>
  );
}

function Forward() {
  const params = useSearchParams();
  const [opened, setOpened] = useState(false);

  /* Firebase puts the code on this URL directly, or — through some mail
     clients' link rewriting — inside a nested `link` parameter. */
  const nested = (() => {
    const link = params.get('link');
    if (!link) return null;
    try {
      return new URL(link).searchParams;
    } catch {
      return null;
    }
  })();
  const oobCode = params.get('oobCode') ?? nested?.get('oobCode') ?? null;
  const target = oobCode
    ? `inninggrid://auth/email?oobCode=${encodeURIComponent(oobCode)}`
    : null;

  useEffect(() => {
    if (!target) return;
    window.location.href = target;
    setOpened(true);
  }, [target]);

  return (
    <main className="mx-auto flex min-h-dvh max-w-sm flex-col justify-center px-6 py-10">
      <div className="flex items-center gap-2">
        <BrandMark className="size-7 text-ink" />
        <BrandWordmark className="text-2xl" />
      </div>
      {target ? (
        <>
          <h1 className="display mt-6 text-3xl text-ink">Opening InningGrid…</h1>
          <p className="mt-2 text-sm text-ink-muted">
            {opened
              ? 'If the app did not open, tap below.'
              : 'Handing your sign-in to the app.'}
          </p>
          <a
            href={target}
            className="ring-focus mt-6 inline-flex h-12 items-center justify-center rounded-xl bg-brand px-5 font-semibold text-ink-inverse"
          >
            Open the app
          </a>
        </>
      ) : (
        <Notice tone="critical" className="mt-6" title="This link is incomplete">
          It may have been cut short by your email app. Go back to InningGrid and send a
          new sign-in link.
        </Notice>
      )}
    </main>
  );
}
