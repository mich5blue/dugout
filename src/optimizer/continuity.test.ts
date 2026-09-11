import { describe, expect, it } from 'vitest';
import {
  buildScenario,
  checkInvariants,
  runScenario,
  type PlayerSpec,
} from '@/test/fixtures';

/**
 * Position continuity: hold a player at one spot for a set number of innings
 * before rotating them. The counterpart to position variety, for continuity and
 * for doubleheaders.
 */

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
];

function roster(): PlayerSpec[] {
  return NAMES.map((name) => ({ name, canPitch: true, canCatch: true }));
}

/** Counts each unbroken run of innings at one position as a single stint. */
function stintsPerPlayer(
  scenario: ReturnType<typeof buildScenario>,
  result: Awaited<ReturnType<typeof runScenario>>['result'],
): Record<string, number> {
  const innings = scenario.game.plannedInnings;
  const stints: Record<string, number> = {};

  for (const player of scenario.players) {
    let previous: string | null = null;
    let count = 0;
    for (let inning = 1; inning <= innings; inning++) {
      const at =
        result.defensive.find(
          (a) => a.inning === inning && a.playerId === player.id,
        )?.positionId ?? null;
      if (at !== null && at !== previous) count++;
      previous = at;
    }
    stints[player.id] = count;
  }

  return stints;
}

/**
 * The fewest stints a player could have had, given the innings they actually
 * played. A bench inning splits a block, so each unbroken run of played innings
 * needs its own ceil(run / block).
 */
function floorStints(
  scenario: ReturnType<typeof buildScenario>,
  result: Awaited<ReturnType<typeof runScenario>>['result'],
  playerId: string,
  block: number,
): number {
  let minimum = 0;
  let run = 0;
  for (let inning = 1; inning <= scenario.game.plannedInnings; inning++) {
    const playing = result.defensive.some(
      (a) => a.inning === inning && a.playerId === playerId,
    );
    if (playing) {
      run++;
    } else if (run > 0) {
      minimum += Math.ceil(run / block);
      run = 0;
    }
  }
  if (run > 0) minimum += Math.ceil(run / block);
  return minimum;
}

describe('position continuity', () => {
  it('keeps players at one position for two innings at a time', async () => {
    const scenario = buildScenario({
      innings: 6,
      players: roster(),
      seed: 21,
      settings: { positionContinuityInnings: 2, variety: 'MEDIUM' },
    });
    const { result } = await runScenario(scenario);

    expect(result.ok).toBe(true);
    expect(checkInvariants(scenario, result)).toEqual([]);

    /*
      With 11 players and 10 positions, one player sits each inning and the
      pitcher changes between blocks, so the resulting substitution chain has to
      break somebody's block. Nearly everyone lands on clean pairs and no single
      player absorbs more than one extra rotation.
    */
    const stints = stintsPerPlayer(scenario, result);
    const over = scenario.players.filter(
      (player) => stints[player.id] > floorStints(scenario, result, player.id, 2),
    );

    expect(over.length).toBeLessThanOrEqual(1);
    for (const player of scenario.players) {
      expect(stints[player.id]).toBeLessThanOrEqual(
        floorStints(scenario, result, player.id, 2) + 1,
      );
    }
  });

  it('moves players far less often than rotating freely does', async () => {
    const base = buildScenario({
      innings: 6,
      players: roster(),
      seed: 21,
      settings: { variety: 'HIGH' },
    });
    const continuous = buildScenario({
      innings: 6,
      players: roster(),
      seed: 21,
      settings: { positionContinuityInnings: 2, variety: 'HIGH' },
    });

    const free = await runScenario(base);
    const held = await runScenario(continuous);

    const total = (
      scenario: ReturnType<typeof buildScenario>,
      result: Awaited<ReturnType<typeof runScenario>>['result'],
    ) => Object.values(stintsPerPlayer(scenario, result)).reduce((a, b) => a + b, 0);

    // The dial has to actually change the lineup, not just the wording.
    expect(total(continuous, held.result)).toBeLessThan(total(base, free.result));
  });

  it('honours three-inning blocks even at high variety', async () => {
    // Variety HIGH caps consecutive innings at one position at 2, which would
    // silently defeat a three-inning block if continuity did not lift it.
    const scenario = buildScenario({
      innings: 6,
      players: roster(),
      seed: 7,
      settings: { positionContinuityInnings: 3, variety: 'HIGH' },
    });
    const { result } = await runScenario(scenario);

    expect(result.ok).toBe(true);
    const runs = scenario.players.map((player) => {
      let longest = 0;
      let current = 0;
      let previous: string | null = null;
      for (let inning = 1; inning <= 6; inning++) {
        const at =
          result.defensive.find(
            (a) => a.inning === inning && a.playerId === player.id,
          )?.positionId ?? null;
        current = at !== null && at === previous ? current + 1 : at !== null ? 1 : 0;
        if (current > longest) longest = current;
        previous = at;
      }
      return longest;
    });

    expect(Math.max(...runs)).toBeGreaterThanOrEqual(3);
  });

  it('still respects the pitching plan and every hard rule', async () => {
    const scenario = buildScenario({
      innings: 6,
      players: roster(),
      seed: 3,
      pitchingPlan: { 1: 'Race', 2: 'Brody', 3: 'Weston' },
      settings: {
        positionContinuityInnings: 2,
        minDefensiveInnings: 4,
        minDefensiveInningsMode: 'REQUIRED',
        infieldOpportunity: { mode: 'REQUIRED', innings: 1 },
      },
    });
    const { result } = await runScenario(scenario);

    expect(result.ok).toBe(true);
    expect(checkInvariants(scenario, result)).toEqual([]);

    const pitcher = scenario.positionId('P');
    expect(
      result.defensive.find((a) => a.inning === 1 && a.positionId === pitcher)?.playerId,
    ).toBe(scenario.byName('Race').id);

    for (const player of scenario.players) {
      const played = result.defensive.filter((a) => a.playerId === player.id).length;
      expect(played).toBeGreaterThanOrEqual(4);
    }
  });

  it('gives everyone clean blocks when nobody has to sit', async () => {
    // Ten players for ten positions: no bench rotation to break a block, so
    // perfect two-inning pairs are reachable and should actually be reached.
    const scenario = buildScenario({
      innings: 6,
      players: roster().slice(0, 10),
      seed: 21,
      settings: { positionContinuityInnings: 2 },
    });
    const { result } = await runScenario(scenario);

    expect(result.ok).toBe(true);
    expect(checkInvariants(scenario, result)).toEqual([]);

    const stints = stintsPerPlayer(scenario, result);
    for (const player of scenario.players) {
      // Six innings, no bench: exactly three two-inning blocks each.
      expect(stints[player.id]).toBe(3);
    }

    const check = result.quality.checks.find((entry) =>
      entry.label.includes('hold a position for 2 innings'),
    );
    expect(check?.ok).toBe(true);
  });

  it('reports continuity in the lineup quality checks', async () => {
    const scenario = buildScenario({
      innings: 6,
      players: roster(),
      seed: 21,
      settings: { positionContinuityInnings: 2 },
    });
    const { result } = await runScenario(scenario);

    const check = result.quality.checks.find((entry) =>
      entry.label.includes('hold a position for 2 innings'),
    );
    expect(check).toBeDefined();
    // The count is the useful part: it tells the coach how close the lineup got.
    expect(check!.label).toMatch(/\d+ of 11/);
  });

  it('leaves lineups untouched when the setting is off', async () => {
    const a = buildScenario({ innings: 6, players: roster(), seed: 42 });
    const b = buildScenario({
      innings: 6,
      players: roster(),
      seed: 42,
      settings: { positionContinuityInnings: undefined },
    });

    const first = await runScenario(a);
    const second = await runScenario(b);

    const shape = (
      scenario: ReturnType<typeof buildScenario>,
      result: Awaited<ReturnType<typeof runScenario>>['result'],
    ) =>
      result.defensive
        .map((assignment) => {
          const player = scenario.players.findIndex((p) => p.id === assignment.playerId);
          return `${assignment.inning}|${assignment.positionId}|${player}`;
        })
        .sort()
        .join(',');

    expect(shape(b, second.result)).toBe(shape(a, first.result));
  });
});
