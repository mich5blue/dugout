import { describe, expect, it } from 'vitest';
import { minCostAssignment } from './hungarian';
import { rotateBattingOrder } from './batting';
import { parseQuickAddRoster } from '@/domain/factories';
import {
  buildScenario,
  checkInvariants,
  runScenario,
  type PlayerSpec,
} from '@/test/fixtures';

const NAMES = [
  'Brody',
  'Race',
  'Weston',
  'Calvin',
  'Emerson',
  'Solomon',
  'Finnegan',
  'Vasil',
  'Mehki',
  'Ashur',
  'Walter',
  'Otto',
  'Nico',
  'Jimmy',
  'Rex',
];

function roster(count: number): PlayerSpec[] {
  return NAMES.slice(0, count).map((name) => ({ name, canPitch: true, canCatch: true }));
}

describe('Scenario O — impossible configuration', () => {
  it('explains why a required minimum cannot be met and what to change', async () => {
    const scenario = buildScenario({
      formationId: 'baseball-9',
      innings: 6,
      players: roster(14),
      settings: { minDefensiveInnings: 4, minDefensiveInningsMode: 'REQUIRED' },
    });
    const { result } = await runScenario(scenario);

    expect(result.ok).toBe(false);
    expect(result.defensive).toEqual([]);

    const conflict = result.conflicts.find((c) => c.code === 'MIN_INNINGS_IMPOSSIBLE');
    expect(conflict).toBeDefined();
    expect(conflict?.message).toContain('4 defensive innings');
    expect(conflict?.message).toContain('14 players');
    expect(conflict?.message).toContain('9 defensive positions');

    // Never fail without ranked, actionable suggestions.
    expect(result.relaxations.length).toBeGreaterThan(0);
    const reduce = result.relaxations.find(
      (r) => r.action?.type === 'REDUCE_MIN_DEFENSIVE_INNINGS',
    );
    expect(reduce?.message).toContain('3');
  });

  it('reports when no eligible catcher exists', async () => {
    const scenario = buildScenario({
      innings: 6,
      players: roster(11).map((player) => ({ ...player, canCatch: false })),
    });
    const { result } = await runScenario(scenario);

    expect(result.ok).toBe(false);
    expect(result.conflicts.some((c) => c.code === 'NO_CATCHERS')).toBe(true);
  });

  it('reports when the only eligible player at a position leaves early', async () => {
    const scenario = buildScenario({
      innings: 6,
      players: roster(11).map((player) =>
        player.name === 'Brody'
          ? { ...player, departure: 3 }
          : { ...player, never: ['1B'] },
      ),
    });
    const { result } = await runScenario(scenario);

    expect(result.ok).toBe(false);
    const messages = result.conflicts.map((c) => c.message).join(' ');
    expect(messages).toMatch(/1B/);
  });

  it('reports when not enough players are available to field the formation', async () => {
    const scenario = buildScenario({
      formationId: 'baseball-10-lc-rc',
      innings: 6,
      players: roster(8),
    });
    const { result } = await runScenario(scenario);

    expect(result.ok).toBe(false);
    const conflict = result.conflicts.find((c) => c.code === 'NOT_ENOUGH_PLAYERS');
    expect(conflict?.message).toContain('8 available players');
    expect(conflict?.message).toContain('needs 10');
  });
});

/** Stable string for one lineup. Player ids are random per scenario, so a
 *  comparison is only meaningful within a single scenario instance. */
function serialise(result: { defensive: Array<{ inning: number; positionId: string; playerId: string }> }): string {
  return result.defensive
    .map((a) => `${a.inning}|${a.positionId}|${a.playerId}`)
    .sort()
    .join(',');
}

describe('Determinism and Generate Another', () => {
  it('returns an identical lineup for the same inputs and seed', async () => {
    const scenario = buildScenario({ innings: 6, players: roster(11), seed: 42 });

    const first = await runScenario(scenario, { seed: 42 });
    const second = await runScenario(scenario, { seed: 42 });

    expect(serialise(first.result)).toBe(serialise(second.result));
    expect(first.result.batting).toEqual(second.result.batting);
  });

  it('returns a different but still valid lineup for a different seed', async () => {
    const scenario = buildScenario({ innings: 6, players: roster(12), seed: 1 });

    const first = await runScenario(scenario, { seed: 1 });
    const second = await runScenario(scenario, { seed: 99 });

    expect(first.result.ok).toBe(true);
    expect(second.result.ok).toBe(true);
    expect(checkInvariants(scenario, second.result)).toEqual([]);
    expect(serialise(first.result)).not.toBe(serialise(second.result));
  });
});

describe('Performance', () => {
  it('generates a 15-player, 7-inning lineup well inside the budget', async () => {
    const scenario = buildScenario({
      formationId: 'baseball-10-lc-rc',
      innings: 7,
      players: roster(15),
    });

    const started = Date.now();
    const { result } = await runScenario(scenario);
    const elapsed = Date.now() - started;

    expect(result.ok).toBe(true);
    expect(checkInvariants(scenario, result)).toEqual([]);
    expect(elapsed).toBeLessThan(2000);
  });
});

describe('minCostAssignment', () => {
  it('finds the optimal assignment', () => {
    const result = minCostAssignment([
      [4, 1, 3],
      [2, 0, 5],
      [3, 2, 2],
    ]);
    expect(result).not.toBeNull();
    expect(result!.total).toBe(5);
  });

  it('handles more columns than rows', () => {
    const result = minCostAssignment([
      [1, 9, 9, 9],
      [9, 2, 9, 9],
    ]);
    expect(result!.cols).toEqual([0, 1]);
    expect(result!.total).toBe(3);
  });

  it('returns null when a row has no permitted column', () => {
    const inf = Number.POSITIVE_INFINITY;
    const result = minCostAssignment([
      [inf, inf],
      [1, 2],
    ]);
    expect(result).toBeNull();
  });

  it('returns null when there are fewer columns than rows', () => {
    expect(minCostAssignment([[1], [2]])).toBeNull();
  });

  it('avoids forbidden cells when a feasible assignment exists', () => {
    const inf = Number.POSITIVE_INFINITY;
    const result = minCostAssignment([
      [inf, 5],
      [3, inf],
    ]);
    expect(result!.cols).toEqual([1, 0]);
    expect(result!.total).toBe(8);
  });
});

describe('rotateBattingOrder', () => {
  it('rotates the previous order by the requested offset', () => {
    const previous = [
      { playerId: 'brody', battingSlot: 1 },
      { playerId: 'race', battingSlot: 2 },
      { playerId: 'weston', battingSlot: 3 },
      { playerId: 'calvin', battingSlot: 4 },
    ];
    const rotated = rotateBattingOrder(previous, 2, ['brody', 'race', 'weston', 'calvin']);
    expect(rotated.map((entry) => entry.playerId)).toEqual([
      'weston',
      'calvin',
      'brody',
      'race',
    ]);
    expect(rotated.map((entry) => entry.battingSlot)).toEqual([1, 2, 3, 4]);
  });

  it('drops absent players and appends new ones at the bottom', () => {
    const previous = [
      { playerId: 'brody', battingSlot: 1 },
      { playerId: 'race', battingSlot: 2 },
      { playerId: 'weston', battingSlot: 3 },
    ];
    const rotated = rotateBattingOrder(previous, 1, ['brody', 'weston', 'newkid']);
    expect(rotated.map((entry) => entry.playerId)).toEqual(['weston', 'brody', 'newkid']);
  });
});

describe('parseQuickAddRoster', () => {
  it('parses one player per line', () => {
    const parsed = parseQuickAddRoster(
      `Brody Borek\nRace Smith\nWeston Jones\nCalvin Miller`,
      'team_1',
    );
    expect(parsed).toHaveLength(4);
    expect(parsed[0]).toMatchObject({ firstName: 'Brody', lastName: 'Borek' });
    expect(parsed[3]).toMatchObject({ firstName: 'Calvin', lastName: 'Miller' });
  });

  it('picks up jersey numbers in common formats', () => {
    const parsed = parseQuickAddRoster(
      `Brody Borek #8\n12 Race Smith\nWeston Jones, 4\nSolo`,
      'team_1',
    );
    expect(parsed[0]).toMatchObject({ firstName: 'Brody', jerseyNumber: '8' });
    expect(parsed[1]).toMatchObject({ firstName: 'Race', jerseyNumber: '12' });
    expect(parsed[2]).toMatchObject({ firstName: 'Weston', jerseyNumber: '4' });
    expect(parsed[3]).toMatchObject({ firstName: 'Solo', lastName: '' });
  });

  it('ignores blank lines', () => {
    expect(parseQuickAddRoster('\n\n  \nBrody\n\n', 'team_1')).toHaveLength(1);
  });
});
