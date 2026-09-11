import { describe, expect, it } from 'vitest';
import {
  benchInnings,
  buildScenario,
  checkInvariants,
  defensiveInnings,
  inningsInGroup,
  runScenario,
  type PlayerSpec,
} from '@/test/fixtures';

/** Scenarios A-J from the build spec, plus the invariants every lineup must pass. */

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
];

/** A roster where everyone can pitch and catch, so nothing is battery-limited. */
function roster(count: number, overrides: Record<string, Partial<PlayerSpec>> = {}): PlayerSpec[] {
  return NAMES.slice(0, count).map((name) => ({
    name,
    canPitch: true,
    canCatch: true,
    ...(overrides[name] ?? {}),
  }));
}

function spread(counts: Record<string, number>): number {
  const values = Object.values(counts);
  return Math.max(...values) - Math.min(...values);
}

describe('Scenario A — 9 players, 9 positions, 6 innings', () => {
  it('fills every position with nobody on the bench', async () => {
    const scenario = buildScenario({
      formationId: 'baseball-9',
      innings: 6,
      players: roster(9),
    });
    const { result } = await runScenario(scenario);

    expect(result.ok).toBe(true);
    expect(checkInvariants(scenario, result)).toEqual([]);

    const bench = benchInnings(scenario, result);
    expect(Object.values(bench).every((count) => count === 0)).toBe(true);

    const defense = defensiveInnings(result);
    expect(Object.values(defense).every((count) => count === 6)).toBe(true);
  });
});

describe('Scenario B — 10 players, 9 positions, 6 innings', () => {
  it('distributes the six bench innings fairly', async () => {
    const scenario = buildScenario({
      formationId: 'baseball-9',
      innings: 6,
      players: roster(10),
    });
    const { result } = await runScenario(scenario);

    expect(result.ok).toBe(true);
    expect(checkInvariants(scenario, result)).toEqual([]);

    const bench = benchInnings(scenario, result);
    const total = Object.values(bench).reduce((a, b) => a + b, 0);
    expect(total).toBe(6);
    expect(spread(bench)).toBeLessThanOrEqual(1);
  });
});

describe('Scenario C — 11 players, 10-position formation', () => {
  it('sits exactly one player each inning and nobody twice', async () => {
    const scenario = buildScenario({
      formationId: 'baseball-10-lc-rc',
      innings: 6,
      players: roster(11),
    });
    const { result } = await runScenario(scenario);

    expect(result.ok).toBe(true);
    expect(checkInvariants(scenario, result)).toEqual([]);

    for (let inning = 1; inning <= 6; inning++) {
      expect(result.bench[inning]).toHaveLength(1);
    }

    const bench = benchInnings(scenario, result);
    expect(Math.max(...Object.values(bench))).toBe(1);
  });
});

describe('Scenario D — 12 players, 10 defenders, 6 innings', () => {
  it('meets playing-time targets for everyone', async () => {
    const scenario = buildScenario({
      formationId: 'baseball-10-lc-rc',
      innings: 6,
      players: roster(12),
      settings: { minDefensiveInnings: 4, minDefensiveInningsMode: 'REQUIRED' },
    });
    const { result } = await runScenario(scenario);

    expect(result.ok).toBe(true);
    expect(checkInvariants(scenario, result)).toEqual([]);

    const defense = defensiveInnings(result);
    expect(Math.min(...Object.values(defense))).toBeGreaterThanOrEqual(4);
    expect(spread(defense)).toBeLessThanOrEqual(1);
  });
});

describe('Scenario E — four outfielders with restrictions', () => {
  it('respects every NEVER restriction', async () => {
    const scenario = buildScenario({
      formationId: 'baseball-10-lc-rc',
      innings: 6,
      players: roster(11, {
        Walter: { never: ['P', 'C', '1B'], canPitch: false, canCatch: false },
        Ashur: { never: ['C', 'SS'], canCatch: false },
        Mehki: { never: ['P'], canPitch: false, avoid: ['3B'] },
      }),
    });
    const { result } = await runScenario(scenario);

    expect(result.ok).toBe(true);
    expect(checkInvariants(scenario, result)).toEqual([]);

    const walter = scenario.byName('Walter');
    const forbidden = ['P', 'C', '1B'].map((code) => scenario.positionId(code));
    const violations = result.defensive.filter(
      (a) => a.playerId === walter.id && forbidden.includes(a.positionId),
    );
    expect(violations).toEqual([]);
  });

  it('keeps the four outfield spots independently assignable but grouped', async () => {
    const scenario = buildScenario({
      formationId: 'baseball-10-lc-rc',
      innings: 6,
      players: roster(11),
    });
    const { result } = await runScenario(scenario);

    const outfieldCodes = ['LF', 'LC', 'RC', 'RF'];
    const outfieldIds = outfieldCodes.map((code) => scenario.positionId(code));

    // Every outfield spot is filled every inning, and each is its own position.
    for (let inning = 1; inning <= 6; inning++) {
      const assigned = outfieldIds.map(
        (id) => result.defensive.find((a) => a.inning === inning && a.positionId === id)!,
      );
      expect(assigned.every(Boolean)).toBe(true);
      expect(new Set(assigned.map((a) => a.playerId)).size).toBe(4);
    }

    // All four roll up into one OUTFIELD group total.
    const outfield = inningsInGroup(scenario, result, 'OUTFIELD');
    const total = Object.values(outfield).reduce((a, b) => a + b, 0);
    expect(total).toBe(6 * 4);
  });
});

describe('Scenario F — only two eligible first basemen', () => {
  it('covers first base every inning from the two eligible players', async () => {
    const eligible = ['Brody', 'Race'];
    const scenario = buildScenario({
      innings: 6,
      players: roster(11).map((player) =>
        eligible.includes(player.name) ? player : { ...player, never: ['1B'] },
      ),
    });
    const { result } = await runScenario(scenario);

    expect(result.ok).toBe(true);
    expect(checkInvariants(scenario, result)).toEqual([]);

    const firstBase = scenario.positionId('1B');
    const eligibleIds = eligible.map((name) => scenario.byName(name).id);
    const atFirst = result.defensive.filter((a) => a.positionId === firstBase);
    expect(atFirst).toHaveLength(6);
    expect(atFirst.every((a) => eligibleIds.includes(a.playerId))).toBe(true);
  });
});

describe('Scenario G — only three eligible catchers', () => {
  it('covers catcher every inning within the per-player cap', async () => {
    const catchers = ['Brody', 'Race', 'Weston'];
    const scenario = buildScenario({
      innings: 6,
      players: roster(11).map((player) => ({
        ...player,
        canCatch: catchers.includes(player.name),
      })),
      settings: { maxCatcherInningsPerPlayer: 3 },
    });
    const { result } = await runScenario(scenario);

    expect(result.ok).toBe(true);
    expect(checkInvariants(scenario, result)).toEqual([]);

    const catcherPosition = scenario.positionId('C');
    const behindPlate = result.defensive.filter((a) => a.positionId === catcherPosition);
    expect(behindPlate).toHaveLength(6);

    const counts = new Map<string, number>();
    for (const assignment of behindPlate) {
      counts.set(assignment.playerId, (counts.get(assignment.playerId) ?? 0) + 1);
    }
    for (const count of counts.values()) expect(count).toBeLessThanOrEqual(3);

    const catcherIds = catchers.map((name) => scenario.byName(name).id);
    expect(behindPlate.every((a) => catcherIds.includes(a.playerId))).toBe(true);
  });
});

describe('Scenario H — locked pitching schedule', () => {
  it('honours the pitching plan exactly', async () => {
    const scenario = buildScenario({
      innings: 6,
      players: roster(11),
      pitchingPlan: { 1: 'Race', 2: 'Brody', 3: 'Weston', 4: 'Calvin' },
    });
    const { result } = await runScenario(scenario);

    expect(result.ok).toBe(true);
    expect(checkInvariants(scenario, result)).toEqual([]);

    const pitcher = scenario.positionId('P');
    const expected: Record<number, string> = {
      1: scenario.byName('Race').id,
      2: scenario.byName('Brody').id,
      3: scenario.byName('Weston').id,
      4: scenario.byName('Calvin').id,
    };
    for (const [inning, playerId] of Object.entries(expected)) {
      const assignment = result.defensive.find(
        (a) => a.inning === Number(inning) && a.positionId === pitcher,
      );
      expect(assignment?.playerId).toBe(playerId);
    }

    expect(result.quality.checks.find((c) => c.label === 'Pitching plan satisfied')?.ok).toBe(
      true,
    );
  });
});

describe('Scenario I — player arrives in inning 3', () => {
  it('never assigns the late arrival before inning 3', async () => {
    const scenario = buildScenario({
      innings: 6,
      players: [
        ...roster(10),
        { name: 'Jimmy', canPitch: true, canCatch: true, arrival: 3 },
      ],
    });
    const { result } = await runScenario(scenario);

    expect(result.ok).toBe(true);
    expect(checkInvariants(scenario, result)).toEqual([]);

    const jimmy = scenario.byName('Jimmy');
    const early = result.defensive.filter((a) => a.playerId === jimmy.id && a.inning < 3);
    expect(early).toEqual([]);
    expect(result.bench[1]).not.toContain(jimmy.id);
    expect(result.bench[2]).not.toContain(jimmy.id);
  });
});

describe('Scenario J — player leaves after inning 4', () => {
  it('never assigns the early departure after inning 4', async () => {
    const scenario = buildScenario({
      innings: 6,
      players: roster(12, { Otto: { departure: 4 } }),
    });
    const { result } = await runScenario(scenario);

    expect(result.ok).toBe(true);
    expect(checkInvariants(scenario, result)).toEqual([]);

    const otto = scenario.byName('Otto');
    const late = result.defensive.filter((a) => a.playerId === otto.id && a.inning > 4);
    expect(late).toEqual([]);
    expect(result.bench[5]).not.toContain(otto.id);
    expect(result.bench[6]).not.toContain(otto.id);
  });
});

describe('Playing-time rules', () => {
  it('satisfies a required minimum when it is mathematically possible', async () => {
    const scenario = buildScenario({
      innings: 6,
      players: roster(12),
      settings: { minDefensiveInnings: 4, minDefensiveInningsMode: 'REQUIRED' },
    });
    const { result } = await runScenario(scenario);

    expect(result.ok).toBe(true);
    const defense = defensiveInnings(result);
    for (const player of scenario.players) {
      expect(defense[player.id] ?? 0).toBeGreaterThanOrEqual(4);
    }
  });

  it('avoids consecutive bench innings when asked', async () => {
    const scenario = buildScenario({
      innings: 6,
      players: roster(12),
      settings: { noConsecutiveBench: true },
    });
    const { result } = await runScenario(scenario);

    expect(result.ok).toBe(true);
    for (let inning = 1; inning < 6; inning++) {
      const sittingNow = new Set(result.bench[inning]);
      const sittingNext = result.bench[inning + 1] ?? [];
      for (const playerId of sittingNext) {
        expect(sittingNow.has(playerId)).toBe(false);
      }
    }
  });

  it('guarantees an infield inning for every eligible player when required', async () => {
    const scenario = buildScenario({
      innings: 6,
      players: roster(11),
      settings: { infieldOpportunity: { mode: 'REQUIRED', innings: 1 } },
    });
    const { result } = await runScenario(scenario);

    expect(result.ok).toBe(true);
    const infield = inningsInGroup(scenario, result, 'INFIELD');
    for (const player of scenario.players) {
      expect(infield[player.id]).toBeGreaterThanOrEqual(1);
    }
  });
});
