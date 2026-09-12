import { describe, expect, it } from 'vitest';
import {
  buildScenario,
  checkInvariants,
  inningsInGroup,
  runScenario,
  type PlayerSpec,
  type Scenario,
} from '@/test/fixtures';
import type { InfieldSpread } from '@/domain/types';
import type { OptimizationResult } from '@/optimizer';

/**
 * Infield ability spread: avoid stacking developing players in the infield in
 * the same inning, and avoid it harder two innings running.
 *
 * The point of these tests is that the setting does something measurable
 * *without* taking infield innings away from developing players — the failure
 * mode worth guarding against is the optimizer "solving" the problem by
 * benching them or parking them in the outfield, which would quietly break the
 * infield-opportunity promise.
 */

/**
 * Eleven players, four of them developing. That ratio is the interesting one:
 * a ten-player defence has five infield spots per inning, so with four
 * developing players the solver has to actively spread them to keep two out of
 * the infield at once, but it is not impossible.
 */
const DEVELOPING = ['Mehki', 'Ashur', 'Walter', 'Vasil'];

function roster(): PlayerSpec[] {
  return [
    'Brody',
    'Race',
    'Weston',
    'Calvin',
    'Emerson',
    'Solomon',
    'Finnegan',
    ...DEVELOPING,
  ].map((name) => ({
    name,
    tier: DEVELOPING.includes(name) ? ('DEVELOPING' as const) : ('CORE' as const),
    // Everyone can pitch and catch, so the battery never forces a placement
    // and the infield is the only thing under test.
    canPitch: true,
    canCatch: true,
  }));
}

function scenarioWith(infieldSpread: InfieldSpread): Scenario {
  return buildScenario({
    innings: 6,
    players: roster(),
    settings: {
      infieldSpread,
      // Continuity off: holding players in place for blocks of innings is a
      // separate instruction that would confound the spread measurement.
      positionContinuityInnings: undefined,
    },
  });
}

/** Developing players in the infield, per inning. */
function developingInfieldByInning(
  scenario: Scenario,
  result: OptimizationResult,
): number[] {
  const groupByPositionId = new Map(
    scenario.formation.positions.map((p) => [p.id, p.group]),
  );
  const tierByPlayerId = new Map(
    scenario.players.map((p) => [p.id, p.overallTier]),
  );

  const innings = scenario.game.plannedInnings;
  const counts = new Array<number>(innings).fill(0);

  for (const assignment of result.defensive) {
    if (groupByPositionId.get(assignment.positionId) !== 'INFIELD') continue;
    if (tierByPlayerId.get(assignment.playerId) !== 'DEVELOPING') continue;
    counts[assignment.inning - 1]++;
  }

  return counts;
}

/** Innings holding more than one developing infielder. */
function stackedInnings(counts: number[]): number {
  return counts.filter((count) => count > 1).length;
}

/** Adjacent inning pairs that are both stacked — the case the coach cares most about. */
function stackedRuns(counts: number[]): number {
  let runs = 0;
  for (let i = 1; i < counts.length; i++) {
    if (counts[i] > 1 && counts[i - 1] > 1) runs++;
  }
  return runs;
}

describe('infield ability spread', () => {
  it('is off by default for settings saved before it existed', async () => {
    const scenario = buildScenario({
      innings: 6,
      players: roster(),
      settings: { infieldSpread: undefined },
    });
    const { result } = await runScenario(scenario, { seed: 7 });

    expect(result.ok).toBe(true);
    // Absent must behave exactly like OFF, so existing teams keep the lineups
    // they had. Compared by cost rather than by grid equality because the
    // weight is what drives placement.
    const off = scenarioWith('OFF');
    const offRun = await runScenario(off, { seed: 7 });
    expect(developingInfieldByInning(scenario, result)).toEqual(
      developingInfieldByInning(off, offRun.result),
    );
  });

  it('reduces innings with two developing infielders', async () => {
    const offScenario = scenarioWith('OFF');
    const highScenario = scenarioWith('HIGH');

    /*
      Averaged over several seeds rather than asserted on one. A single seed can
      land on a lineup that happens to be well spread with the setting off, and
      a flaky optimizer test is worse than no test.
    */
    let offStacked = 0;
    let highStacked = 0;

    for (const seed of [1, 2, 3, 4, 5, 6]) {
      const off = await runScenario(offScenario, { seed });
      const high = await runScenario(highScenario, { seed });
      expect(off.result.ok).toBe(true);
      expect(high.result.ok).toBe(true);

      offStacked += stackedInnings(developingInfieldByInning(offScenario, off.result));
      highStacked += stackedInnings(
        developingInfieldByInning(highScenario, high.result),
      );
    }

    expect(highStacked).toBeLessThan(offStacked);
  });

  it('reduces back-to-back stacked innings at least as much', async () => {
    const offScenario = scenarioWith('OFF');
    const highScenario = scenarioWith('HIGH');

    let offRuns = 0;
    let highRuns = 0;

    for (const seed of [1, 2, 3, 4, 5, 6]) {
      const off = await runScenario(offScenario, { seed });
      const high = await runScenario(highScenario, { seed });

      offRuns += stackedRuns(developingInfieldByInning(offScenario, off.result));
      highRuns += stackedRuns(developingInfieldByInning(highScenario, high.result));
    }

    expect(highRuns).toBeLessThanOrEqual(offRuns);
  });

  it('does not buy the spread by keeping developing players out of the infield', async () => {
    const scenario = scenarioWith('HIGH');
    const { result } = await runScenario(scenario, { seed: 3 });

    expect(result.ok).toBe(true);
    expect(checkInvariants(scenario, result)).toEqual([]);

    /*
      The whole risk of this setting: the cheapest way to stop two developing
      players sharing the infield is to stop playing them there at all. The
      default infield-opportunity target is one inning each, and that promise
      outranks this preference, so it has to survive at HIGH.
    */
    const infield = inningsInGroup(scenario, result, 'INFIELD');
    for (const player of scenario.players) {
      if (player.overallTier !== 'DEVELOPING') continue;
      expect(
        infield[player.id],
        `${player.firstName} should still get an infield inning`,
      ).toBeGreaterThanOrEqual(1);
    }
  });

  it('never makes a game infeasible, even at HIGH with an all-developing roster', async () => {
    // A roster the setting cannot possibly satisfy: every infield inning must
    // stack. It must degrade rather than fail.
    const scenario = buildScenario({
      innings: 6,
      players: roster().map((player) => ({
        ...player,
        tier: 'DEVELOPING' as const,
      })),
      settings: { infieldSpread: 'HIGH' },
    });

    const { result } = await runScenario(scenario, { seed: 11 });

    expect(result.ok).toBe(true);
    expect(checkInvariants(scenario, result)).toEqual([]);
  });
});
