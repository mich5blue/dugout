import { describe, expect, it } from 'vitest';
import {
  MAX_ASSISTANT_COACHES,
  ROLE_PERMISSIONS,
  assistantCount,
  can,
  canInviteAssistant,
  permittedPlayerChanges,
  type TeamMembership,
} from './access';

/**
 * The permission matrix is the whole authorization model, so it is asserted
 * explicitly rather than derived — a test that recomputes the table from the
 * table cannot catch a wrong entry.
 */

function membership(overrides: Partial<TeamMembership> = {}): TeamMembership {
  return {
    id: `m_${Math.random().toString(36).slice(2, 8)}`,
    teamId: 'team_1',
    userId: 'user_1',
    email: 'coach@example.com',
    name: 'A Coach',
    role: 'ASSISTANT',
    status: 'ACTIVE',
    createdAt: new Date().toISOString(),
    ...overrides,
  };
}

describe('permission matrix', () => {
  it('gives the head coach everything', () => {
    for (const permission of ROLE_PERMISSIONS.HEAD_COACH) {
      expect(can('HEAD_COACH', permission)).toBe(true);
    }
    expect(can('HEAD_COACH', 'members:manage')).toBe(true);
    expect(can('HEAD_COACH', 'game:generate')).toBe(true);
    expect(can('HEAD_COACH', 'team:delete')).toBe(true);
  });

  it('gives an assistant exactly the two delegated jobs, plus read access', () => {
    expect(can('ASSISTANT', 'player:editEligibility')).toBe(true);
    expect(can('ASSISTANT', 'player:editAbility')).toBe(true);
    expect(can('ASSISTANT', 'team:view')).toBe(true);
    expect(can('ASSISTANT', 'season:view')).toBe(true);

    // Everything else is off limits.
    for (const permission of [
      'team:edit',
      'team:delete',
      'members:manage',
      'roster:add',
      'roster:remove',
      'player:editIdentity',
      'game:create',
      'game:delete',
      'game:generate',
      'game:edit',
      'game:record',
    ] as const) {
      expect(can('ASSISTANT', permission)).toBe(false);
    }
  });

  it('never lets an assistant manage members, which is how the cap is enforced', () => {
    const result = canInviteAssistant('ASSISTANT', [], 'new@example.com');
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe('NOT_ALLOWED');
  });
});

describe('inviting assistant coaches', () => {
  it('allows a head coach to invite up to the cap', () => {
    const members: TeamMembership[] = [membership({ role: 'HEAD_COACH', email: 'head@x.com' })];

    expect(canInviteAssistant('HEAD_COACH', members, 'one@x.com').ok).toBe(true);

    members.push(membership({ email: 'one@x.com' }));
    expect(canInviteAssistant('HEAD_COACH', members, 'two@x.com').ok).toBe(true);

    members.push(membership({ email: 'two@x.com' }));
    expect(assistantCount(members)).toBe(MAX_ASSISTANT_COACHES);

    const third = canInviteAssistant('HEAD_COACH', members, 'three@x.com');
    expect(third.ok).toBe(false);
    if (!third.ok) {
      expect(third.reason).toBe('AT_CAPACITY');
      expect(third.message).toContain('2 assistant coaches');
    }
  });

  it('does not count the head coach against the assistant cap', () => {
    const members = [
      membership({ role: 'HEAD_COACH', email: 'head@x.com' }),
      membership({ email: 'one@x.com' }),
    ];
    expect(assistantCount(members)).toBe(1);
    expect(canInviteAssistant('HEAD_COACH', members, 'two@x.com').ok).toBe(true);
  });

  it('rejects a coach who is already on the team, case and space insensitively', () => {
    const members = [membership({ email: 'Coach@Example.com ' })];
    const result = canInviteAssistant('HEAD_COACH', members, '  coach@example.com');
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe('DUPLICATE');
  });

  it('rejects something that is not an email address', () => {
    for (const bad of ['', 'coach', 'coach@', '@example.com', 'coach@example']) {
      const result = canInviteAssistant('HEAD_COACH', [], bad);
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.reason).toBe('INVALID_EMAIL');
    }
  });
});

describe('permittedPlayerChanges', () => {
  it('passes a head coach through untouched', () => {
    const changes = { firstName: 'Brody', overallTier: 'CORE', active: false };
    expect(permittedPlayerChanges('HEAD_COACH', changes)).toEqual(changes);
  });

  it('keeps only eligibility and ability for an assistant', () => {
    const changes = {
      positionRatings: { p1: { positionId: 'p1', eligibility: 'NEVER' } },
      overallTier: 'CORE',
      canPitch: true,
      canCatch: false,
    };
    expect(permittedPlayerChanges('ASSISTANT', changes)).toEqual(changes);
  });

  it('strips an identity change smuggled alongside a permitted one', () => {
    const result = permittedPlayerChanges('ASSISTANT', {
      overallTier: 'CORE',
      firstName: 'Renamed',
      lastName: 'Player',
      jerseyNumber: '99',
      active: false,
      offensiveTier: 'CORE',
    });

    expect(result).toEqual({ overallTier: 'CORE' });
    expect(result).not.toHaveProperty('firstName');
    expect(result).not.toHaveProperty('active');
    // Hitting ability is the head coach's call, not an assistant's.
    expect(result).not.toHaveProperty('offensiveTier');
  });

  it('returns nothing when an assistant sends only forbidden fields', () => {
    expect(permittedPlayerChanges('ASSISTANT', { firstName: 'X', active: true })).toEqual({});
  });
});
