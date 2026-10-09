'use client';

import { BrandMark, BrandWordmark } from '@/components/BrandMark';
import { Button, Notice, Spinner } from '@/components/ui';
import { firebaseAuth, isFirebaseConfigured } from '@/lib/firebase';
import { callbackWith, safeCallback, safeState } from '@/lib/nativeAuth';
import {
  getRedirectResult,
  GoogleAuthProvider,
  signInWithPopup,
  signInWithRedirect,
  type UserCredential,
} from 'firebase/auth';
import { useSearchParams } from 'next/navigation';
import { Suspense, useEffect, useState } from 'react';

/**
 * Sign in to the iOS app with an existing InningGrid account.
 *
 * Opened by the app in a Safari sheet (ASWebAuthenticationSession). See
 * src/lib/nativeAuth.ts for why this exists and what keeps it safe.
 */
export default function NativeAuthPage() {
  return (
    <Suspense fallback={null}>
      <Bridge />
    </Suspense>
  );
}

/* Survives the round trip to Google when the popup is blocked and the page
   falls back to a full redirect. */
const STATE_KEY = 'inninggrid.nativeAuth.state';

function Bridge() {
  const params = useSearchParams();
  const [phase, setPhase] = useState<'idle' | 'working' | 'handing-back' | 'error'>('idle');
  const [message, setMessage] = useState<string | null>(null);

  const callback = safeCallback(params.get('redirect'));
  const state =
    safeState(params.get('state')) ??
    safeState(typeof window === 'undefined' ? null : sessionStorage.getItem(STATE_KEY));

  const handBack = (result: UserCredential) => {
    const credential = GoogleAuthProvider.credentialFromResult(result);
    if (!credential?.idToken || !callback || !state) {
      setPhase('error');
      setMessage('Google signed you in but did not return what the app needs. Close this and try again.');
      return;
    }
    sessionStorage.removeItem(STATE_KEY);
    setPhase('handing-back');
    window.location.href = callbackWith(callback, { state, idToken: credential.idToken });
  };

  /* Arriving back from a redirect sign-in: finish it. */
  useEffect(() => {
    if (!isFirebaseConfigured()) return;
    void getRedirectResult(firebaseAuth())
      .then((result) => {
        if (result) handBack(result);
      })
      .catch(() => {
        setPhase('error');
        setMessage('That sign-in did not finish. Try again.');
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const google = async () => {
    if (!state) return;
    setPhase('working');
    sessionStorage.setItem(STATE_KEY, state);
    const provider = new GoogleAuthProvider();
    try {
      handBack(await signInWithPopup(firebaseAuth(), provider));
    } catch (error) {
      const code = (error as { code?: string }).code ?? '';
      if (code.includes('popup')) {
        await signInWithRedirect(firebaseAuth(), provider);
        return;
      }
      setPhase('error');
      setMessage(code === 'auth/cancelled-popup-request' ? null : 'Sign-in did not work. Try again.');
    }
  };

  const invalid = !callback || !state;

  return (
    <main className="mx-auto flex min-h-dvh max-w-sm flex-col justify-center px-6 py-10">
      <div className="flex items-center gap-2">
        <BrandMark className="size-7 text-ink" />
        <BrandWordmark className="text-2xl" />
      </div>
      <h1 className="display mt-6 text-3xl text-ink">Sign in to the app</h1>
      <p className="mt-2 text-sm text-ink-muted">
        Use the same account you use on the website. Your teams, rosters and season
        come with you.
      </p>

      {invalid ? (
        <Notice tone="critical" className="mt-6" title="Open this from the InningGrid app">
          This page signs the iOS app in, and it was opened without the details the
          app sends. Go back to the app and tap Sign in again.
        </Notice>
      ) : phase === 'handing-back' ? (
        <p className="mt-6 flex items-center gap-2 text-sm text-ink-muted">
          <Spinner /> Returning you to the app…
        </p>
      ) : (
        <div className="mt-6 space-y-3">
          <Button
            variant="primary"
            size="lg"
            className="w-full"
            disabled={phase === 'working'}
            onClick={google}
          >
            {phase === 'working' ? (
              <>
                <Spinner /> Signing in…
              </>
            ) : (
              'Continue with Google'
            )}
          </Button>
          {message ? <Notice tone="critical">{message}</Notice> : null}
        </div>
      )}
    </main>
  );
}
