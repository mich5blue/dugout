import { describe, expect, it } from 'vitest';
import { emptyFairnessDebt, type FairnessDebt } from '@/domain/season';
import { createPlayer } from '@/domain/factories';
import { standingCounts, standingFor, STANDING_THRESHOLD } from '@/services/fairness';
import type { Player } from '@/domain/types';

/**
 * The three words Home reports instead of a percentage.
 *
 * Worth testing rather than eyeballing: the boundary is a whole inning, and
 * getting it wrong by a tenth puts a player in a bucket the coach will act on.
 */

function player(id: string, active = true): Player {
  return { ...createPlayer({ teamId: 't', firstName: id }), id, active };
}

function debt(playerId: string, defensiveDebt: number, expected = 20): FairnessDebt {
  return {
    ...emptyFairnessDebt(playerId),
    expectedDefensiveInnings: expected,
    defensiveDebt,
  };
}

describe('standingFor', () => {
  it('reads a full inning either side as the boundary', () => {
    expect(standingFor(STANDING_THRESHOLD)).toBe('OWED');
    expect(standingFor(-STANDING_THRESHOLD)).toBe('AHEAD');
    expect(standingFor(STANDING_THRESHOLD - 0.01)).toBe('ON_TARGET');
    expect(standingFor(-STANDING_THRESHOLD + 0.01)).toBe('ON_TARGET');
  });

  it('calls a fraction of an inning square, because innings are indivisible', () => {
    // A coach cannot hand out 0.7 of an inning, so 0.7 behind is as square as
    // the game allows — reporting it as Owed would be noise.
    expect(standingFor(0.7)).toBe('ON_TARGET');
    expect(standingFor(-0.7)).toBe('ON_TARGET');
    expect(standingFor(0)).toBe('ON_TARGET');
  });
});

describe('standingCounts', () => {
  it('buckets the roster', () => {
    const players = [player('a'), player('b'), player('c'), player('d')];
    const debts = {
      a: debt('a', 2.4),
      b: debt('b', 0.2),
      c: debt('c', -1.8),
      d: debt('d', -0.1),
    };

    expect(standingCounts(players, debts)).toEqual({
      OWED: 1,
      ON_TARGET: 2,
      AHEAD: 1,
      unplayed: 0,
    });
  });

  it('holds out players with no expectation instead of calling them square', () => {
    // A roster that has not played yet would otherwise report everybody On
    // target, which is arithmetically true and misleading on the page.
    const players = [player('a'), player('b')];
    const debts = { a: debt('a', 0, 0), b: debt('b', 1.5) };

    expect(standingCounts(players, debts)).toEqual({
      OWED: 1,
      ON_TARGET: 0,
      AHEAD: 0,
      unplayed: 1,
    });
  });

  it('ignores inactive players', () => {
    const players = [player('a'), player('b', false)];
    const debts = { a: debt('a', 0), b: debt('b', 5) };

    expect(standingCounts(players, debts)).toMatchObject({ OWED: 0, ON_TARGET: 1 });
  });

  it('counts a player with no debt record at all as unplayed', () => {
    expect(standingCounts([player('a')], {})).toMatchObject({ unplayed: 1 });
  });
});
