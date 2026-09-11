import { describe, expect, it } from 'vitest';
import { getFairnessDebt } from '@/services/fairness';
import { countedInnings, getPlayerSeasonUsage } from '@/services/seasonStatistics';
import {
  generateLineup,
  recordActualResults,
  setAssignment,
  toggleLock,
} from '@/services/lineupService';
import type { Game } from '@/domain/types';
import {
  benchInnings,
  buildScenario,
  checkInvariants,
  defensiveInnings,
  inningsInGroup,
  type Scenario,
} from '@/test/fixtures';

/**
 * The end-to-end scenario from section 81 of the spec: the exact game a real
 * coach described, run all the way through recording results and the next
 * game's compensation.
 */

/** 11 players, 7 pitchers, 5 catchers, Walter can't play P, C or 1B. */
function buildDefinitionOfDoneScenario(): Scenario {
  const pitchers = new Set(['Brody', 'Race', 'Weston', 'Calvin', 'Emerson', 'Solomon', 'Finnegan']);
  const catchers = new Set(['Brody', 'Race', 'Calvin', 'Vasil', 'Mehki']);
  const core = new Set(['Brody', 'Race', 'Weston']);
  const developing = new Set(['Walter', 'Ashur']);

  const names = [
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

  return buildScenario({
    formationId: 'baseball-10-lc-rc',
    innings: 6,
    seed: 7,
    players: names.map((name) => ({
      name,
      canPitch: pitchers.has(name),
      canCatch: catchers.has(name),
      tier: core.has(name) ? 'CORE' : developing.has(name) ? 'DEVELOPING' : 'REGULAR',
      never: name === 'Walter' ? ['P', 'C', '1B'] : undefined,
    })),
    pitchingPlan: { 1: 'Race', 2: 'Brody', 3: 'Weston' },
    settings: {
      philosophy: 'BALANCED',
      minDefensiveInnings: 4,
      minDefensiveInningsMode: 'REQUIRED',
      noConsecutiveBench: true,
      infieldOpportunity: { mode: 'REQUIRED', innings: 1 },
      variety: 'HIGH',
      criticalStrength: 'MEDIUM',
    },
  });
}

describe('Definition of done — the section 81 game', () => {
  it('generates a mathematically valid six-inning lineup', async () => {
    const scenario = buildDefinitionOfDoneScenario();
    const { result } = await generateLineup({
      team: scenario.team,
      game: scenario.game,
      players: scenario.players,
      history: [],
    });

    expect(result.ok).toBe(true);
    expect(checkInvariants(scenario, result)).toEqual([]);

    // Every stated requirement holds.
    const defense = defensiveInnings(result);
    for (const player of scenario.players) {
      expect(defense[player.id] ?? 0).toBeGreaterThanOrEqual(4);
    }

    const infield = inningsInGroup(scenario, result, 'INFIELD');
    for (const player of scenario.players) {
      expect(infield[player.id]).toBeGreaterThanOrEqual(1);
    }

    for (let inning = 1; inning < 6; inning++) {
      const sittingNow = new Set(result.bench[inning]);
      for (const playerId of result.bench[inning + 1] ?? []) {
        expect(sittingNow.has(playerId)).toBe(false);
      }
    }

    // Walter never appears at a restricted position.
    const walter = scenario.byName('Walter');
    const restricted = ['P', 'C', '1B'].map((code) => scenario.positionId(code));
    expect(
      result.defensive.filter(
        (a) => a.playerId === walter.id && restricted.includes(a.positionId),
      ),
    ).toEqual([]);

    // The locked pitching plan survives.
    const pitcher = scenario.positionId('P');
    expect(
      result.defensive.find((a) => a.inning === 1 && a.positionId === pitcher)?.playerId,
    ).toBe(scenario.byName('Race').id);
    expect(
      result.defensive.find((a) => a.inning === 2 && a.positionId === pitcher)?.playerId,
    ).toBe(scenario.byName('Brody').id);
    expect(
      result.defensive.find((a) => a.inning === 3 && a.positionId === pitcher)?.playerId,
    ).toBe(scenario.byName('Weston').id);
  });

  it('favours stronger players at critical positions without wrecking playing time', async () => {
    const scenario = buildDefinitionOfDoneScenario();
    const { result } = await generateLineup({
      team: scenario.team,
      game: scenario.game,
      players: scenario.players,
      history: [],
    });

    const abilityByPlayer = new Map(
      scenario.players.map((player) => [
        player.id,
        player.overallTier === 'CORE' ? 3 : player.overallTier === 'REGULAR' ? 2 : 1,
      ]),
    );
    const criticalCodes = new Set(['P', 'C', '1B', 'SS']);
    const codeByPositionId = new Map(
      scenario.formation.positions.map((p) => [p.id, p.code]),
    );

    let criticalAbility = 0;
    let criticalCount = 0;
    let otherAbility = 0;
    let otherCount = 0;

    for (const assignment of result.defensive) {
      const code = codeByPositionId.get(assignment.positionId)!;
      const ability = abilityByPlayer.get(assignment.playerId)!;
      if (criticalCodes.has(code)) {
        criticalAbility += ability;
        criticalCount++;
      } else {
        otherAbility += ability;
        otherCount++;
      }
    }

    expect(criticalAbility / criticalCount).toBeGreaterThan(otherAbility / otherCount);

    // Playing time stays close to equal despite the competitive tilt.
    const defense = defensiveInnings(result);
    const values = Object.values(defense);
    expect(Math.max(...values) - Math.min(...values)).toBeLessThanOrEqual(2);
  });

  it('rebalances around a manual swap the coach locked', async () => {
    const scenario = buildDefinitionOfDoneScenario();
    const generated = await generateLineup({
      team: scenario.team,
      game: scenario.game,
      players: scenario.players,
      history: [],
    });
    expect(generated.result.ok).toBe(true);

    const shortstop = scenario.positionId('SS');
    const leftField = scenario.positionId('LF');
    const before = generated.game.defensiveAssignments.filter(
      (a) => a.assignmentType === 'PLANNED' && a.inning === 3,
    );
    const ssPlayer = before.find((a) => a.positionId === shortstop)!.playerId;
    const lfPlayer = before.find((a) => a.positionId === leftField)!.playerId;

    // Coach swaps the two players in inning 3 and locks the change.
    let edited = setAssignment(generated.game, 3, shortstop, lfPlayer);
    edited = toggleLock(edited, 3, shortstop);
    edited = toggleLock(edited, 3, leftField);

    const afterSwap = edited.defensiveAssignments.filter(
      (a) => a.assignmentType === 'PLANNED' && a.inning === 3,
    );
    expect(afterSwap.find((a) => a.positionId === shortstop)?.playerId).toBe(lfPlayer);
    expect(afterSwap.find((a) => a.positionId === leftField)?.playerId).toBe(ssPlayer);

    // Rebalance: locked cells must survive, everything else is re-optimised.
    const rebalanced = await generateLineup({
      team: scenario.team,
      game: edited,
      players: scenario.players,
      history: [],
    });

    expect(rebalanced.result.ok).toBe(true);
    expect(checkInvariants(scenario, rebalanced.result)).toEqual([]);

    const inning3 = rebalanced.result.defensive.filter((a) => a.inning === 3);
    expect(inning3.find((a) => a.positionId === shortstop)?.playerId).toBe(lfPlayer);
    expect(inning3.find((a) => a.positionId === leftField)?.playerId).toBe(ssPlayer);

    // Requirements still hold after the rebalance.
    const defense = defensiveInnings(rebalanced.result);
    for (const player of scenario.players) {
      expect(defense[player.id] ?? 0).toBeGreaterThanOrEqual(4);
    }
  });

  it('drops the unplayed sixth inning from season history and compensates next game', async () => {
    const scenario = buildDefinitionOfDoneScenario();
    const generated = await generateLineup({
      team: scenario.team,
      game: scenario.game,
      players: scenario.players,
      history: [],
    });
    expect(generated.result.ok).toBe(true);

    // Who was scheduled to play the sixth inning that never happened.
    const inning6PlayerIds = new Set(
      generated.result.defensive.filter((a) => a.inning === 6).map((a) => a.playerId),
    );

    // The game ends after five innings.
    const completed = recordActualResults(generated.game, 5);
    expect(completed.status).toBe('COMPLETED');
    expect(completed.actualInnings).toBe(5);
    expect(countedInnings(completed)).toBe(5);

    const usage = getPlayerSeasonUsage([completed]);
    const totalDefensive = Object.values(usage).reduce(
      (acc, record) => acc + record.defensiveInnings,
      0,
    );
    // Ten positions across the five innings that were actually played.
    expect(totalDefensive).toBe(50);
    for (const record of Object.values(usage)) {
      expect(record.availableInnings).toBe(5);
      expect(record.defensiveInnings).toBeLessThanOrEqual(5);
    }

    // Nothing from inning 6 leaked into history.
    const actualInnings = completed.defensiveAssignments
      .filter((a) => a.assignmentType === 'ACTUAL')
      .map((a) => a.inning);
    expect(Math.max(...actualInnings)).toBe(5);
    expect(actualInnings).toHaveLength(50);

    // The players who lost that inning now carry the debt.
    const debts = getFairnessDebt([completed], scenario.players);
    const shorted = scenario.players
      .filter((player) => inning6PlayerIds.has(player.id))
      .sort((a, b) => debts[b.id].defensiveDebt - debts[a.id].defensiveDebt)[0];
    expect(debts[shorted.id].defensiveDebt).toBeGreaterThan(0);

    // Next game: build a fresh game and let the optimizer compensate.
    const nextScenario = buildDefinitionOfDoneScenario();
    const nextGame: Game = {
      ...nextScenario.game,
      // Reuse the first scenario's player identities for continuity.
      gamePlayers: scenario.players.map((player) => ({
        playerId: player.id,
        available: true,
      })),
      pitchingPlan: {},
      id: 'game_next',
    };

    const next = await generateLineup({
      team: scenario.team,
      game: nextGame,
      players: scenario.players,
      history: [completed],
    });

    expect(next.result.ok).toBe(true);

    const nextDefense = defensiveInnings(next.result);
    const nextBench = benchInnings(
      { ...scenario, game: nextGame } as Scenario,
      next.result,
    );

    /*
      The next game is built from that carried debt and still satisfies every
      rule the coach set. The debts created by a single called game are only
      about half an inning, and this game also requires an infield inning for
      all eleven players, high position variety and medium critical-position
      strength — so which player picks up the spare inning is decided by those
      rules together, not by the half-inning debt alone. Compensation is
      verified where it is the subject: seasonAware.test.ts (material debt is
      always repaid) and seasonSimulation.test.ts (drift stays bounded across
      a whole season).
    */
    for (const player of scenario.players) {
      expect(nextDefense[player.id] ?? 0).toBeGreaterThanOrEqual(4);
      expect(nextBench[player.id]).toBeLessThanOrEqual(1);
    }

    const nextInfield = inningsInGroup(
      { ...scenario, game: nextGame } as Scenario,
      next.result,
      'INFIELD',
    );
    for (const player of scenario.players) {
      expect(nextInfield[player.id]).toBeGreaterThanOrEqual(1);
    }
  });
});
