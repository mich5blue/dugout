import { describe, expect, it } from 'vitest';
import { emptyFairnessDebt, type FairnessDebt } from '@/domain/season';
import { createPlayer } from '@/domain/factories';
import {
  seasonOutlook,
  standingCounts,
  standingFor,
  STANDING_THRESHOLD,
} from '@/services/fairness';
import { createGame } from '@/domain/factories';
import { getSystemFormation } from '@/domain/formations';
import { defaultTeamSettings } from '@/domain/weights';
import type { Game, Player } from '@/domain/types';

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

describe('seasonOutlook', () => {
  const formation = getSystemFormation('baseball-10-lc-rc')!;

  function scheduled(count: number, status: Game['status']): Game[] {
    return Array.from({ length: count }, (_, i) => ({
      ...createGame({
        teamId: 't',
        opponent: `Team ${i}`,
        date: `2026-05-0${i + 1}`,
        plannedInnings: 6,
        formation,
        settings: defaultTeamSettings(),
        players: [],
      }),
      status,
      actualInnings: status === 'COMPLETED' ? 6 : null,
    }));
  }

  it('says nothing is wrong when nobody is behind', () => {
    const outlook = seasonOutlook(scheduled(3, 'PLANNED'), []);
    expect(outlook.gamesRemaining).toBe(3);
    expect(outlook.atRisk).toEqual([]);
    expect(outlook.headline).toContain('on track');
  });

  it('flags a gap bigger than the remaining games can close', () => {
    // One inning per remaining game is the stated headroom, so a 3-inning gap
    // with one game left is not closing and the coach needs to know now.
    const games = [...scheduled(1, 'PLANNED'), ...scheduled(1, 'COMPLETED')];
    const players = [player('a'), player('b')];
    const outlook = seasonOutlook(games, players, {
      a: debt('a', 3),
      b: debt('b', 0.5),
    });

    expect(outlook.gamesRemaining).toBe(1);
    expect(outlook.atRisk).toEqual(['a']);
    expect(outlook.worst).toEqual({ playerId: 'a', debt: 3 });
    expect(outlook.headline).toContain('further behind than');
  });

  it('does not flag a gap the remaining games can absorb', () => {
    const games = [...scheduled(4, 'PLANNED'), ...scheduled(1, 'COMPLETED')];
    const outlook = seasonOutlook(games, [player('a')], { a: debt('a', 2.2) });

    expect(outlook.atRisk).toEqual([]);
    expect(outlook.headline).toContain('enough to close it');
  });

  it('is honest when the season is over', () => {
    const outlook = seasonOutlook(scheduled(2, 'COMPLETED'), []);
    expect(outlook.gamesRemaining).toBe(0);
    expect(outlook.headline).toMatch(/finish/);
  });
});

describe('the outlook does not contradict itself', () => {
  const formation = getSystemFormation('baseball-10-lc-rc')!;
  const game = (status: Game['status']): Game => ({
    ...createGame({
      teamId: 't',
      opponent: 'X',
      date: '2026-05-01',
      plannedInnings: 6,
      formation,
      settings: defaultTeamSettings(),
      players: [],
    }),
    status,
  });

  it('never lists a sub-inning gap as at risk', () => {
    // This is the bug: with the season over, every positive debt counted as at
    // risk, so the page said "everyone finished within an inning of their
    // expectation" above a list of seven players needing innings.
    const outlook = seasonOutlook([game('COMPLETED')], [player('a'), player('b')], {
      a: debt('a', 0.3),
      b: debt('b', 0.9),
    });

    expect(outlook.atRisk).toEqual([]);
    expect(outlook.headline).toContain('within an inning');
  });

  it('still lists a real gap when the season has run out of games', () => {
    const outlook = seasonOutlook([game('COMPLETED')], [player('a')], {
      a: debt('a', 2.5),
    });
    expect(outlook.atRisk).toEqual(['a']);
    expect(outlook.headline).toContain('No games left');
  });
});
