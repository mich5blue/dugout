import { ASSISTANT_EDITABLE_PLAYER_FIELDS, MAX_ASSISTANT_COACHES } from '@/domain/access';
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

/**
 * The rules file is the enforcement, and it is written in a different language
 * from the permission model it has to agree with. Nothing in the type system
 * connects them, so these tests do — a field added to the assistant's
 * allow-list in TypeScript and forgotten in the rules would otherwise be a
 * silent privilege gap that only shows up as a permission error in production.
 */

const RULES = readFileSync('firestore.rules', 'utf8');

/** Pulls a `hasOnly([...])` argument list out of the rules text. */
function hasOnlyList(after: string): string[] {
  const index = RULES.indexOf(after);
  expect(index, `expected to find ${after} in firestore.rules`).toBeGreaterThan(-1);
  const region = RULES.slice(index);
  const match = /hasOnly\(\[([^\]]*)\]\)/.exec(region);
  expect(match, `expected a hasOnly list after ${after}`).not.toBeNull();
  return (match?.[1] ?? '')
    .split(',')
    .map((entry) => entry.trim().replace(/^'|'$/g, ''))
    .filter(Boolean);
}

describe('firestore rules', () => {
  it('lets an assistant change exactly the fields the domain allows', () => {
    const fields = hasOnlyList('match /teams/{teamId}/players/{playerId}');
    expect(fields.sort()).toEqual([...ASSISTANT_EDITABLE_PLAYER_FIELDS].sort());
  });

  it('enforces the same assistant cap as the domain', () => {
    expect(RULES).toContain(`assistantEmails.size() <= ${MAX_ASSISTANT_COACHES}`);
  });

  it('denies anything not explicitly matched', () => {
    expect(RULES).toContain('match /{document=**}');
    expect(RULES).toMatch(/allow read, write: if false;/);
  });

  it('never allows a team to be read by someone who is not on it', () => {
    // Every read rule is guarded. A bare `allow read: if true` would be a leak
    // of children's names, which is the one thing this app must not do.
    expect(RULES).not.toMatch(/allow (read|get|list)[^:]*: if true/);
    expect(RULES).not.toMatch(/allow (read|write)[^:]*: if signedIn\(\);/);
  });

  it('requires a new team to be owned by its creator', () => {
    expect(RULES).toContain('request.resource.data.ownerUid == myUid()');
    expect(RULES).toContain('request.resource.data.memberUids == [myUid()]');
  });

  it('only lets an invited assistant grant themselves the assistant role', () => {
    expect(RULES).toContain("request.resource.data.roles[myUid()] == 'ASSISTANT'");
    expect(RULES).toContain('.hasOnly([myUid()])');
  });

  it('lets only the owner delete a team', () => {
    expect(RULES).toContain('allow delete: if isMember() && team().ownerUid == myUid();');
  });

  it('gives games, goals and flags no assistant write path', () => {
    for (const collection of ['games', 'formations', 'goals', 'flags']) {
      // Split on the match block's own closing brace, not the first `}` —
      // the path itself contains braces.
      const start = RULES.indexOf(`match /teams/{teamId}/${collection}/`);
      const section = RULES.slice(start, RULES.indexOf('\n    }', start));
      expect(section, collection).toContain('allow write: if isHeadCoachOf(teamId);');
      expect(section, collection).not.toContain('isAssistantOf');
    }
  });
});
