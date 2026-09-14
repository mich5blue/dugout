'use client';

import { useDugout } from '@/app/providers';
import { BrandMark, BrandWordmark } from '@/components/BrandMark';
import { Button, Card, Input, Label, Notice, Spinner } from '@/components/ui';
import {
  completeEmailLink,
  hasPendingEmailLink,
  pendingEmail,
  sendEmailLink,
  signInWithGoogle,
} from '@/lib/auth';
import { useEffect, useState } from 'react';

/**
 * The way in.
 *
 * Google for the head coach, an email link for whoever they invited — an
 * assistant's address is often not a Google account, and an invitation that
 * cannot be accepted is not an invitation. No passwords: this app holds
 * children's names and does not need to be in the business of storing secrets.
 */
export function SignInScreen() {
  const { account, authReady, enterDemo } = useDugout();
  const [email, setEmail] = useState('');
  const [state, setState] = useState<'idle' | 'working' | 'sent' | 'needEmail'>('idle');
  const [error, setError] = useState('');
  const [demoLoading, setDemoLoading] = useState(false);

  /*
    Arriving on an email link: finish the sign-in before painting anything, so
    the coach never sees a sign-in form they have already filled in once.
  */
  useEffect(() => {
    if (!authReady || account) return;
    if (!hasPendingEmailLink()) return;
    setState('working');
    void completeEmailLink()
      .then((done) => {
        if (!done) {
          setEmail(pendingEmail());
          setState('needEmail');
        }
      })
      .catch((cause: unknown) => {
        setError(message(cause));
        setState('needEmail');
      });
  }, [account, authReady]);

  const google = async () => {
    setError('');
    setState('working');
    try {
      await signInWithGoogle();
    } catch (cause) {
      setError(message(cause));
      setState('idle');
    }
  };

  const link = async () => {
    setError('');
    setState('working');
    try {
      if (hasPendingEmailLink()) {
        await completeEmailLink(email);
        return;
      }
      await sendEmailLink(email);
      setState('sent');
    } catch (cause) {
      setError(message(cause));
      setState('idle');
    }
  };

  return (
    <div className="mx-auto flex min-h-dvh max-w-md flex-col justify-center px-4 py-12">
      {/*
        The one place the full nine-cell mark gets shown: it needs 64px to read,
        which the header does not have but this screen does, and this is where
        a visitor meets the brand.
      */}
      <div className="flex flex-col items-start gap-3">
        <BrandMark detail="full" className="size-16 text-ink" />
        <BrandWordmark className="text-3xl" />
      </div>
      <h1 className="display mt-4 text-4xl text-ink sm:text-5xl">
        Smart lineups. More play time.
      </h1>
      <p className="mt-3 text-sm text-ink-muted">
        Sign in to reach your team from any phone, and to share it with your assistant
        coaches.
      </p>

      <Card className="mt-6 p-5">
        {error ? (
          <Notice tone="critical" className="mb-4">
            {error}
          </Notice>
        ) : null}

        {state === 'sent' ? (
          <Notice tone="positive" title="Check your email">
            We sent a sign-in link to {email}. Open it on this device and you&apos;re in.
          </Notice>
        ) : (
          <div className="space-y-4">
            <Button
              variant="primary"
              size="lg"
              className="w-full"
              disabled={state === 'working'}
              onClick={google}
            >
              {state === 'working' ? (
                <>
                  <Spinner /> Signing in…
                </>
              ) : (
                'Continue with Google'
              )}
            </Button>

            <div className="flex items-center gap-3">
              <span className="h-px flex-1 bg-border" />
              <span className="text-xs text-ink-subtle">or</span>
              <span className="h-px flex-1 bg-border" />
            </div>

            <div>
              <Label htmlFor="sign-in-email">Email</Label>
              <Input
                id="sign-in-email"
                type="email"
                autoComplete="email"
                className="mt-1.5"
                placeholder="coach@example.com"
                value={email}
                onChange={(event) => setEmail(event.target.value)}
              />
              <Button
                className="mt-2 w-full"
                disabled={state === 'working' || !email.includes('@')}
                onClick={link}
              >
                {state === 'needEmail' ? 'Finish signing in' : 'Email me a sign-in link'}
              </Button>
              <p className="mt-2 text-xs text-ink-subtle">
                {state === 'needEmail'
                  ? 'Confirm the address the link was sent to.'
                  : 'No password to remember. The link signs you in.'}
              </p>
            </div>
          </div>
        )}
      </Card>

      {/*
        A way to look around without an account.

        A configured project gates the whole app behind this screen, so the
        demo team was unreachable in production — somebody deciding whether to
        try InningGrid had only "Continue with Google". This seeds the demo into
        browser storage on this device: a full sandbox, instantly, with nothing
        shared and nothing they can break.

        Deliberately not a shared demo login. One password handed out publicly
        means every visitor edits the same roster and sees each other's
        changes, and the first person to vandalise it ruins the demo for
        everyone.
      */}
      <div className="mt-5 text-center">
        <Button
          size="lg"
          disabled={demoLoading}
          onClick={async () => {
            setDemoLoading(true);
            try {
              await enterDemo();
            } finally {
              setDemoLoading(false);
            }
          }}
        >
          {demoLoading ? (
            <>
              <Spinner /> Setting up the demo…
            </>
          ) : (
            'Look around the demo team first'
          )}
        </Button>
        <p className="mt-2 text-xs text-ink-subtle">
          A full season to explore. Nothing is saved to an account, and it stays on
          this device.
        </p>
      </div>

      <p className="mt-6 text-xs text-ink-subtle">
        InningGrid stores your roster so you can build lineups. Player names stay on your
        team and are never shared with anyone you have not invited.
      </p>
    </div>
  );
}

/** Firebase error codes are not sentences. Turn the common ones into English. */
function message(cause: unknown): string {
  const code = (cause as { code?: string }).code ?? '';
  switch (code) {
    case 'auth/invalid-email':
      return 'That does not look like an email address.';
    case 'auth/invalid-action-code':
      return 'That sign-in link has already been used or has expired. Ask for a new one.';
    case 'auth/network-request-failed':
      return 'No connection. Check your signal and try again.';
    case 'auth/unauthorized-domain':
      return 'This site is not on the project’s authorized domain list yet.';
    case 'auth/operation-not-allowed':
      return 'That sign-in method is not enabled for this project yet.';
    default:
      return (cause as { message?: string }).message ?? 'Something went wrong signing in.';
  }
}
