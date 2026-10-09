import { describe, expect, it } from 'vitest';
import { createPlayer } from '@/domain/factories';
import { cycleEligibility, nextEligibility, updatePlayer } from './playerEdits';

const player = createPlayer({ teamId: 't1', firstName: 'Brody', lastInitial: 'B' });

describe('player edits', () => {
  it('steps through every eligibility and wraps', () => {
    expect(nextEligibility('PREFERRED')).toBe('ALLOWED');
    expect(nextEligibility('ALLOWED')).toBe('AVOID');
    expect(nextEligibility('AVOID')).toBe('NEVER');
    expect(nextEligibility('NEVER')).toBe('PREFERRED');
  });

  it('treats an unrated position as Allowed', () => {
    const next = cycleEligibility(player, 'HEAD_COACH', 'ss');
    expect(next.positionRatings.ss).toEqual({ positionId: 'ss', eligibility: 'AVOID' });
  });

  it('lets an assistant change eligibility but not identity', () => {
    const next = updatePlayer(player, 'ASSISTANT', { firstName: 'Renamed', active: false });
    expect(next.firstName).toBe('Brody');
    expect(next.active).toBe(true);
    expect(cycleEligibility(player, 'ASSISTANT', 'ss').positionRatings.ss?.eligibility).toBe('AVOID');
  });

  it('lets a head coach change anything', () => {
    expect(updatePlayer(player, 'HEAD_COACH', { firstName: 'Renamed' }).firstName).toBe('Renamed');
  });
});
