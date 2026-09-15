import { firestore, isFirebaseConfigured } from '@/lib/firebase';
import { addDoc, collection, serverTimestamp } from 'firebase/firestore';

/**
 * Feedback: bugs, confusions and requests, from the coach to whoever maintains
 * this.
 *
 * Deliberately not a team repository. Feedback is not team data — it is
 * write-only, outbound, and read in the Firebase console rather than in the
 * app — so putting it in the repository contract would have added a fifth
 * method to every store implementation for something nothing reads back.
 *
 * There is no email address anywhere in this file on purpose. A mailto: on a
 * public page is an address handed to every scraper that visits, and it would
 * be the maintainer's personal address.
 */

export type FeedbackKind = 'BUG' | 'CONFUSING' | 'IDEA' | 'OTHER';

export const FEEDBACK_KINDS: Array<{ value: FeedbackKind; label: string; hint: string }> = [
  { value: 'BUG', label: 'Something is broken', hint: 'It did the wrong thing, or nothing.' },
  {
    value: 'CONFUSING',
    label: 'Something is confusing',
    hint: "I couldn't tell what an option does, or where to find something.",
  },
  { value: 'IDEA', label: 'I want something new', hint: 'A feature, or a different default.' },
  { value: 'OTHER', label: 'Something else', hint: 'Anything at all.' },
];

export interface FeedbackDraft {
  kind: FeedbackKind;
  message: string;
  /** Optional: only if they want a reply. */
  replyTo?: string;
}

export interface FeedbackContext {
  /** Which page they were on when they hit the feedback link. */
  fromPath?: string;
  /** Sizing context for a layout complaint, and nothing more. */
  viewport?: string;
  userAgent?: string;
  appVersion?: string;
  /** Rough shape of their data, which is often the whole explanation. */
  teamCount?: number;
  playerCount?: number;
  gameCount?: number;
  demoMode?: boolean;
}

export interface FeedbackRecord extends FeedbackDraft, FeedbackContext {
  createdAt: string;
}

export interface FeedbackProblem {
  field: 'message' | 'replyTo';
  reason: string;
}

const MIN_MESSAGE = 4;
export const MAX_MESSAGE = 4000;

/**
 * Validation, kept pure so it is testable and so the form and the submit path
 * cannot disagree about what counts as sendable.
 */
export function validateFeedback(draft: FeedbackDraft): FeedbackProblem[] {
  const problems: FeedbackProblem[] = [];
  const message = draft.message.trim();

  if (message.length < MIN_MESSAGE) {
    problems.push({ field: 'message', reason: 'Tell us what happened, in a sentence or two.' });
  }
  if (message.length > MAX_MESSAGE) {
    problems.push({
      field: 'message',
      reason: `That is longer than ${MAX_MESSAGE} characters — trim it, or send two.`,
    });
  }
  /*
    Barely a check on purpose. Rejecting a valid address because a regex is
    clever is worse than accepting a typo: the field is optional, and the only
    cost of a bad one is that a reply bounces.
  */
  const replyTo = draft.replyTo?.trim();
  if (replyTo && !/^[^@\s]+@[^@\s.]+\.[^@\s]+$/.test(replyTo)) {
    problems.push({ field: 'replyTo', reason: "That doesn't look like an email address." });
  }

  return problems;
}

export function buildFeedbackRecord(
  draft: FeedbackDraft,
  context: FeedbackContext,
  now: Date = new Date(),
): FeedbackRecord {
  const replyTo = draft.replyTo?.trim();
  return {
    kind: draft.kind,
    message: draft.message.trim(),
    ...(replyTo ? { replyTo } : {}),
    ...context,
    createdAt: now.toISOString(),
  };
}

/** What the browser can tell us that is worth attaching, and nothing more. */
export function collectContext(extra: Partial<FeedbackContext> = {}): FeedbackContext {
  if (typeof window === 'undefined') return { ...extra };
  return {
    fromPath: window.location.pathname,
    viewport: `${window.innerWidth}x${window.innerHeight}`,
    userAgent: window.navigator.userAgent,
    ...extra,
  };
}

export type FeedbackOutcome =
  | { status: 'SENT' }
  /** No backend configured: the coach still needs a way not to lose it. */
  | { status: 'NO_BACKEND'; report: string }
  | { status: 'FAILED'; report: string; error: string };

/**
 * Send it, or hand back something the coach can paste somewhere.
 *
 * A feedback form that silently swallows a failed submit is a special kind of
 * insult — the one thing the person was trying to tell you is that something
 * is broken. So every path that does not reach the server returns the full
 * report as text for the clipboard.
 */
export async function submitFeedback(record: FeedbackRecord): Promise<FeedbackOutcome> {
  if (!isFirebaseConfigured()) {
    return { status: 'NO_BACKEND', report: formatReport(record) };
  }
  try {
    await addDoc(collection(firestore(), 'feedback'), {
      ...record,
      /* Written by the server so the timestamp cannot be a wrong device clock;
         createdAt stays as the client saw it, which is occasionally the bug. */
      receivedAt: serverTimestamp(),
    });
    return { status: 'SENT' };
  } catch (error) {
    return {
      status: 'FAILED',
      report: formatReport(record),
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

const KIND_LABEL: Record<FeedbackKind, string> = {
  BUG: 'Bug',
  CONFUSING: 'Confusing',
  IDEA: 'Feature request',
  OTHER: 'Other',
};

/** The record as plain text, for the clipboard fallback. */
export function formatReport(record: FeedbackRecord): string {
  const lines = [
    `InningGrid feedback — ${KIND_LABEL[record.kind]}`,
    record.createdAt,
    '',
    record.message,
    '',
  ];
  if (record.replyTo) lines.push(`Reply to: ${record.replyTo}`);
  if (record.fromPath) lines.push(`Page: ${record.fromPath}`);
  if (record.appVersion) lines.push(`Version: ${record.appVersion}`);
  if (record.viewport) lines.push(`Viewport: ${record.viewport}`);
  if (record.teamCount !== undefined) {
    lines.push(
      `Data: ${record.teamCount} teams, ${record.playerCount ?? 0} players, ${
        record.gameCount ?? 0
      } games${record.demoMode ? ' (demo)' : ''}`,
    );
  }
  if (record.userAgent) lines.push(`Browser: ${record.userAgent}`);
  return lines.join('\n');
}
