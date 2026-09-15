'use client';

import { useDugout } from '@/app/providers';
import {
  Button,
  Card,
  CardHeader,
  Input,
  Label,
  Notice,
  Spinner,
  Textarea,
  Toggle,
} from '@/components/ui';
import {
  buildFeedbackRecord,
  collectContext,
  FEEDBACK_KINDS,
  MAX_MESSAGE,
  submitFeedback,
  validateFeedback,
  type FeedbackKind,
  type FeedbackOutcome,
} from '@/lib/feedback';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { Suspense, useState } from 'react';

/**
 * Tell us what is wrong.
 *
 * Three things this page refuses to do, all of which are the normal way to
 * build a feedback form:
 *
 *  - It does not put an email address on a public page for scrapers to find.
 *  - It does not silently swallow a failed submit. The one thing the person is
 *    trying to report is that something broke, so a failure hands back the
 *    whole report for the clipboard.
 *  - It does not attach anything about the roster. Context is the page, the
 *    viewport, the browser and how many teams/players/games exist — counts,
 *    never names. These are rosters of children.
 */
export default function FeedbackPage() {
  return (
    <Suspense fallback={null}>
      <FeedbackForm />
    </Suspense>
  );
}

function FeedbackForm() {
  const params = useSearchParams();
  const { teams, players, games, demoMode, backend } = useDugout();

  /* Arriving from a "this page is confusing" link pre-picks the kind and
     remembers which page they came from. */
  const initialKind = (params.get('kind')?.toUpperCase() ?? '') as FeedbackKind;
  const [kind, setKind] = useState<FeedbackKind>(
    FEEDBACK_KINDS.some((option) => option.value === initialKind) ? initialKind : 'CONFUSING',
  );
  const from = params.get('from') ?? undefined;

  const [message, setMessage] = useState('');
  const [replyTo, setReplyTo] = useState('');
  const [sending, setSending] = useState(false);
  const [outcome, setOutcome] = useState<FeedbackOutcome | null>(null);
  const [copied, setCopied] = useState(false);
  const [showProblems, setShowProblems] = useState(false);

  const draft = { kind, message, replyTo };
  const problems = validateFeedback(draft);
  const problemFor = (field: 'message' | 'replyTo') =>
    showProblems ? problems.find((problem) => problem.field === field)?.reason : undefined;

  const send = async () => {
    setShowProblems(true);
    if (problems.length > 0) return;
    setSending(true);
    try {
      const record = buildFeedbackRecord(
        draft,
        collectContext({
          fromPath: from ?? undefined,
          teamCount: teams.length,
          playerCount: players.length,
          gameCount: games.length,
          demoMode,
          appVersion: process.env.NEXT_PUBLIC_APP_VERSION,
        }),
      );
      setOutcome(await submitFeedback(record));
    } finally {
      setSending(false);
    }
  };

  const copy = async (text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
    } catch {
      /* A denied clipboard is not worth an error state — the text is on screen
         in a textarea they can select by hand. */
      setCopied(false);
    }
  };

  if (outcome?.status === 'SENT') {
    return (
      <div className="mx-auto max-w-xl py-10">
        <p className="eyebrow text-accent">Thank you</p>
        <h1 className="display mt-2 text-4xl text-ink">Got it.</h1>
        <p className="mt-4 text-ink-muted">
          {replyTo.trim()
            ? 'If it needs a reply, it goes to the address you gave.'
            : 'Every one of these gets read. Nothing was sent about your players — just counts.'}
        </p>
        <div className="mt-6 flex flex-wrap gap-2">
          <Link href="/">
            <Button variant="primary">Back to the dashboard</Button>
          </Link>
          <Button
            onClick={() => {
              setOutcome(null);
              setMessage('');
              setShowProblems(false);
            }}
          >
            Send another
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-xl space-y-6">
      <div>
        <p className="eyebrow text-accent">Feedback</p>
        <h1 className="display mt-2 text-4xl text-ink sm:text-5xl">
          What should be better?
        </h1>
        <p className="mt-4 text-ink-muted">
          Bugs, confusing options, things you wish it did. If an option made no sense,
          that is worth reporting — the wording is the bug.
        </p>
      </div>

      <Card>
        <CardHeader title="What kind of thing is it?" />
        <div className="grid gap-2 p-4 sm:grid-cols-2">
          {FEEDBACK_KINDS.map((option) => (
            <Toggle
              key={option.value}
              active={kind === option.value}
              onClick={() => setKind(option.value)}
              className="w-full"
            >
              <span className="block min-w-0 text-left">
                <span className="block text-sm font-semibold text-ink">{option.label}</span>
                <span className="mt-0.5 block text-xs text-ink-muted">{option.hint}</span>
              </span>
            </Toggle>
          ))}
        </div>
      </Card>

      <div>
        <div className="flex items-baseline justify-between">
          <Label htmlFor="feedback-message">Tell us what happened</Label>
          <span className="tnum text-xs text-ink-subtle">
            {message.trim().length}/{MAX_MESSAGE}
          </span>
        </div>
        <Textarea
          id="feedback-message"
          className="mt-1.5"
          rows={7}
          autoFocus
          placeholder={
            kind === 'BUG'
              ? 'I tapped Rebalance after locking two cells and the locks were gone.'
              : kind === 'CONFUSING'
                ? "I can't tell what Position continuity does, or whether it fights Position variety."
                : 'It would help if the dugout sheet fitted on one page for 14 players.'
          }
          value={message}
          onChange={(event) => setMessage(event.target.value)}
          aria-invalid={Boolean(problemFor('message'))}
          aria-describedby={problemFor('message') ? 'feedback-message-error' : undefined}
        />
        {problemFor('message') ? (
          <p id="feedback-message-error" className="mt-1.5 text-xs text-critical">
            {problemFor('message')}
          </p>
        ) : (
          <p className="mt-1.5 text-xs text-ink-subtle">
            If it is a bug: what you did, what happened, what you expected.
          </p>
        )}
      </div>

      <div>
        <Label htmlFor="feedback-reply">Your email — only if you want a reply</Label>
        <Input
          id="feedback-reply"
          className="mt-1.5"
          type="email"
          autoComplete="email"
          placeholder="Optional"
          value={replyTo}
          onChange={(event) => setReplyTo(event.target.value)}
          aria-invalid={Boolean(problemFor('replyTo'))}
          aria-describedby={problemFor('replyTo') ? 'feedback-reply-error' : undefined}
        />
        {problemFor('replyTo') ? (
          <p id="feedback-reply-error" className="mt-1.5 text-xs text-critical">
            {problemFor('replyTo')}
          </p>
        ) : null}
      </div>

      {/*
        Say exactly what is attached. "Diagnostics" as a word means nothing, and
        a coach has every right to know before sending anything from an app
        holding a roster of children.
      */}
      <details className="rounded-xl border border-border bg-surface">
        <summary className="ring-focus cursor-pointer px-4 py-3 text-sm font-medium text-ink">
          What gets sent with this
        </summary>
        <ul className="space-y-1.5 border-t border-border px-4 py-3 text-sm text-ink-muted">
          <li>Your message, and your email if you filled it in.</li>
          <li>The page you came from{from ? <> — {from}</> : null}, and your screen size.</li>
          <li>Your browser and version.</li>
          <li>
            How many teams, players and games you have —{' '}
            <span className="tnum">
              {teams.length}, {players.length}, {games.length}
            </span>
            . Counts only.
          </li>
          <li className="text-ink">
            No player names, no roster, no lineups, nothing about your team beyond those
            three numbers.
          </li>
        </ul>
      </details>

      {outcome?.status === 'NO_BACKEND' || outcome?.status === 'FAILED' ? (
        <Notice
          tone={outcome.status === 'FAILED' ? 'caution' : 'brand'}
          title={
            outcome.status === 'FAILED'
              ? "That didn't send — here it is to copy"
              : 'This copy of InningGrid has no account attached'
          }
        >
          <p className="text-sm">
            {outcome.status === 'FAILED'
              ? 'Copy the report below and send it however you like. Nothing is lost.'
              : 'Nothing to send it to from here, so copy the report and send it however you like.'}
          </p>
          <Textarea
            readOnly
            rows={8}
            className="mt-3 text-xs"
            value={outcome.report}
            onFocus={(event) => event.currentTarget.select()}
          />
          <div className="mt-2 flex flex-wrap gap-2">
            <Button size="sm" variant="primary" onClick={() => copy(outcome.report)}>
              {copied ? 'Copied' : 'Copy report'}
            </Button>
          </div>
        </Notice>
      ) : null}

      <div className="flex flex-wrap items-center gap-3">
        <Button variant="primary" size="lg" disabled={sending} onClick={send}>
          {sending ? (
            <>
              <Spinner /> Sending…
            </>
          ) : (
            'Send feedback'
          )}
        </Button>
        <Link href="/guide">
          <Button size="lg">Read the guide first</Button>
        </Link>
      </div>

      {backend !== 'firebase' ? (
        <p className="text-xs text-ink-subtle">
          You are running InningGrid on this device only, so feedback cannot be sent
          from here — you will get a report to copy instead.
        </p>
      ) : null}
    </div>
  );
}
