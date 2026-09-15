import { describe, expect, it } from 'vitest';
import {
  buildFeedbackRecord,
  formatReport,
  MAX_MESSAGE,
  validateFeedback,
} from '@/lib/feedback';

describe('feedback validation', () => {
  it('needs a message with something in it', () => {
    expect(validateFeedback({ kind: 'BUG', message: '' })).toHaveLength(1);
    expect(validateFeedback({ kind: 'BUG', message: '   ' })).toHaveLength(1);
    expect(validateFeedback({ kind: 'BUG', message: 'ok?' })).toHaveLength(1);
    expect(validateFeedback({ kind: 'BUG', message: 'It crashed' })).toHaveLength(0);
  });

  it('refuses a message too long to store', () => {
    const problems = validateFeedback({ kind: 'BUG', message: 'x'.repeat(MAX_MESSAGE + 1) });
    expect(problems).toHaveLength(1);
    expect(problems[0].field).toBe('message');
  });

  it('accepts no email at all, because the field is optional', () => {
    expect(validateFeedback({ kind: 'IDEA', message: 'Add a thing' })).toHaveLength(0);
    expect(
      validateFeedback({ kind: 'IDEA', message: 'Add a thing', replyTo: '' }),
    ).toHaveLength(0);
  });

  it('catches an address that is obviously not one', () => {
    const problems = validateFeedback({
      kind: 'IDEA',
      message: 'Add a thing',
      replyTo: 'coach at example',
    });
    expect(problems).toEqual([
      { field: 'replyTo', reason: "That doesn't look like an email address." },
    ]);
  });
});

describe('building the record', () => {
  it('trims, and leaves out an empty reply address rather than storing a blank', () => {
    const record = buildFeedbackRecord(
      { kind: 'CONFUSING', message: '  what does continuity do?  ', replyTo: '   ' },
      { fromPath: '/settings' },
      new Date('2026-09-15T12:00:00.000Z'),
    );

    expect(record.message).toBe('what does continuity do?');
    expect('replyTo' in record).toBe(false);
    expect(record.fromPath).toBe('/settings');
    expect(record.createdAt).toBe('2026-09-15T12:00:00.000Z');
  });
});

describe('the clipboard fallback', () => {
  it('contains the message and the context, so nothing is lost when the send fails', () => {
    const report = formatReport(
      buildFeedbackRecord(
        { kind: 'BUG', message: 'Rebalance ate my locks', replyTo: 'coach@example.com' },
        {
          fromPath: '/games/abc',
          appVersion: '1.2.3',
          teamCount: 2,
          playerCount: 22,
          gameCount: 9,
        },
        new Date('2026-09-15T12:00:00.000Z'),
      ),
    );

    expect(report).toContain('Rebalance ate my locks');
    expect(report).toContain('coach@example.com');
    expect(report).toContain('/games/abc');
    expect(report).toContain('2 teams, 22 players, 9 games');
    expect(report).toContain('Bug');
  });
});
