import { describe, expect, it } from 'vitest';
import { getFairnessDebt } from '@/services/fairness';
import { getPlayerSeasonUsage } from '@/services/seasonStatistics';
import {
  benchInnings,
  buildScenario,
  checkInvariants,
  defensiveInnings,
  inningsInGroup,
  positionCounts,
  runScenario,
  syntheticCompletedGame,
  type PlayerSpec,
} from '@/test/fixtures';

/** Scenarios K-N: the season-aware behaviour that makes InningGrid different. */

const ELEVEN = [
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
  return ELEVEN.map((name) => ({ name, canPitch: true, canCatch: true }));
}

describe('Scenario K — significant season playing-time debt', () => {
  it('gives the shorted player more innings in the next game', async () => {
    const scenario = buildScenario({ innings: 6, players: roster() });

    // Walter sat three innings in each of two games; everyone else sat at most one.
    const history = [
      syntheticCompletedGame(scenario, {
        date: '2026-04-04',
        innings: 6,
        benchPlan: {
          1: ['Walter'],
          2: ['Walter'],
          3: ['Walter'],
          4: ['Race'],
          5: ['Brody'],
          6: ['Weston'],
        },
      }),
      syntheticCompletedGame(scenario, {
        date: '2026-04-11',
        innings: 6,
        benchPlan: {
          1: ['Walter'],
          2: ['Walter'],
          3: ['Walter'],
          4: ['Calvin'],
          5: ['Emerson'],
          6: ['Solomon'],
        },
      }),
    ];

    const walter = scenario.byName('Walter');
    const debt = getFairnessDebt(history, scenario.players);
    expect(debt[walter.id].defensiveDebt).toBeGreaterThan(3);

    const { result } = await runScenario(scenario, { history });
    expect(result.ok).toBe(true);
    expect(checkInvariants(scenario, result)).toEqual([]);

    const defense = defensiveInnings(result);
    const bench = benchInnings(scenario, result);

    // Walter should now play every inning, and nobody should out-play him.
    expect(bench[walter.id]).toBe(0);
    expect(defense[walter.id]).toBe(6);
    expect(defense[walter.id]).toBeGreaterThanOrEqual(
      Math.max(...Object.values(defense)),
    );
  });

  it('explains the compensation in plain language', async () => {
    const scenario = buildScenario({ innings: 6, players: roster() });
    const history = [
      syntheticCompletedGame(scenario, {
        date: '2026-04-04',
        innings: 6,
        benchPlan: { 1: ['Walter'], 2: ['Walter'], 3: ['Walter'], 4: ['Race'], 5: ['Brody'], 6: ['Weston'] },
      }),
    ];

    const { result } = await runScenario(scenario, { history });
    const walterExplanation = result.explanations.find(
      (entry) => entry.playerId === scenario.byName('Walter').id,
    );
    expect(walterExplanation?.text).toMatch(/Walter/);
    expect(walterExplanation?.text).toMatch(/fewer innings/);
  });
});

describe('Scenario L — significant infield fairness debt', () => {
  it('increases eligible infield opportunity for the shorted player', async () => {
    const scenario = buildScenario({ innings: 6, players: roster() });

    // Calvin spent two whole games in right field.
    const history = [
      syntheticCompletedGame(scenario, {
        date: '2026-04-04',
        innings: 6,
        benchPlan: { 1: ['Walter'], 2: ['Race'], 3: ['Brody'], 4: ['Weston'], 5: ['Emerson'], 6: ['Solomon'] },
        fixedPositions: { Calvin: 'RF' },
      }),
      syntheticCompletedGame(scenario, {
        date: '2026-04-11',
        innings: 6,
        benchPlan: { 1: ['Vasil'], 2: ['Mehki'], 3: ['Ashur'], 4: ['Walter'], 5: ['Race'], 6: ['Brody'] },
        fixedPositions: { Calvin: 'RF' },
      }),
    ];

    const calvin = scenario.byName('Calvin');
    const debt = getFairnessDebt(history, scenario.players);
    expect(debt[calvin.id].infieldDebt).toBeGreaterThan(3);

    const { result } = await runScenario(scenario, { history });
    expect(result.ok).toBe(true);
    expect(checkInvariants(scenario, result)).toEqual([]);

    const infield = inningsInGroup(scenario, result, 'INFIELD');
    const average =
      Object.values(infield).reduce((a, b) => a + b, 0) / scenario.players.length;
    expect(infield[calvin.id]).toBeGreaterThan(average);
  });

  it('reduces usage at a position a player has already over-played', async () => {
    const scenario = buildScenario({ innings: 6, players: roster() });

    // Race played shortstop in every inning of three games.
    const history = [1, 2, 3].map((week) =>
      syntheticCompletedGame(scenario, {
        date: `2026-04-0${week}`,
        innings: 6,
        benchPlan: { 1: ['Walter'], 2: ['Brody'], 3: ['Weston'], 4: ['Calvin'], 5: ['Emerson'], 6: ['Solomon'] },
        fixedPositions: { Race: 'SS' },
      }),
    );

    const race = scenario.byName('Race');
    const debt = getFairnessDebt(history, scenario.players);
    expect(debt[race.id].positionDebt['SS']).toBeLessThan(-10);

    const { result } = await runScenario(scenario, { history });
    expect(result.ok).toBe(true);

    const counts = positionCounts(scenario, result, race.id);
    expect(counts['SS'] ?? 0).toBeLessThanOrEqual(2);
  });
});

describe('Scenario M — game ends early', () => {
  it('counts nothing from the innings that were never played', async () => {
    const scenario = buildScenario({ innings: 6, players: roster() });

    const fullGame = syntheticCompletedGame(scenario, {
      date: '2026-04-04',
      innings: 6,
      benchPlan: { 1: ['Walter'], 2: ['Race'], 3: ['Brody'], 4: ['Weston'], 5: ['Emerson'], 6: ['Solomon'] },
    });
    const shortGame = syntheticCompletedGame(scenario, {
      date: '2026-04-04',
      innings: 6,
      actualInnings: 5,
      benchPlan: { 1: ['Walter'], 2: ['Race'], 3: ['Brody'], 4: ['Weston'], 5: ['Emerson'], 6: ['Solomon'] },
    });

    const fullUsage = getPlayerSeasonUsage([fullGame]);
    const shortUsage = getPlayerSeasonUsage([shortGame]);

    const totalDefensive = (usage: typeof fullUsage) =>
      Object.values(usage).reduce((acc, record) => acc + record.defensiveInnings, 0);

    // 10 positions x innings played.
    expect(totalDefensive(fullUsage)).toBe(60);
    expect(totalDefensive(shortUsage)).toBe(50);

    // Solomon sat inning 6 in the plan, so in the shortened game he never sat.
    const solomon = scenario.byName('Solomon');
    expect(fullUsage[solomon.id].benchInnings).toBe(1);
    expect(shortUsage[solomon.id].benchInnings).toBe(0);
    expect(shortUsage[solomon.id].availableInnings).toBe(5);
  });

  it('carries the unplayed opportunity forward as debt', async () => {
    const scenario = buildScenario({ innings: 6, players: roster() });

    // Walter sat innings 1-3 and was scheduled to play 4-6, but the game ended
    // after five innings, so he never made the time up.
    const shortGame = syntheticCompletedGame(scenario, {
      date: '2026-04-04',
      innings: 6,
      actualInnings: 5,
      benchPlan: {
        1: ['Walter'],
        2: ['Walter'],
        3: ['Walter'],
        4: ['Race'],
        5: ['Brody'],
        6: ['Weston'],
      },
    });

    const walter = scenario.byName('Walter');
    const debt = getFairnessDebt([shortGame], scenario.players);
    expect(debt[walter.id].defensiveDebt).toBeGreaterThan(1.5);

    const { result } = await runScenario(scenario, { history: [shortGame] });
    expect(result.ok).toBe(true);
    const bench = benchInnings(scenario, result);
    expect(bench[walter.id]).toBe(0);
  });
});

describe('Scenario N — formation changes mid-season', () => {
  it('keeps position-group statistics accurate across formations', async () => {
    const scenario = buildScenario({ innings: 6, players: roster() });

    // Five games with ten defenders, then five with nine.
    const tenPlayerGame = syntheticCompletedGame(scenario, {
      date: '2026-04-04',
      innings: 6,
      formationId: 'baseball-10-lc-rc',
      benchPlan: { 1: ['Walter'], 2: ['Race'], 3: ['Brody'], 4: ['Weston'], 5: ['Emerson'], 6: ['Solomon'] },
    });
    const ninePlayerGame = syntheticCompletedGame(scenario, {
      date: '2026-05-09',
      innings: 6,
      formationId: 'baseball-9',
      benchPlan: {
        1: ['Walter', 'Race'],
        2: ['Brody', 'Weston'],
        3: ['Emerson', 'Solomon'],
        4: ['Finnegan', 'Vasil'],
        5: ['Mehki', 'Ashur'],
        6: ['Walter', 'Brody'],
      },
    });

    const usage = getPlayerSeasonUsage([tenPlayerGame, ninePlayerGame]);

    const totalOutfield = Object.values(usage).reduce(
      (acc, record) => acc + record.byGroup.OUTFIELD,
      0,
    );
    // Four outfielders for six innings, then three for six innings.
    expect(totalOutfield).toBe(6 * 4 + 6 * 3);

    const totalInfield = Object.values(usage).reduce(
      (acc, record) => acc + record.byGroup.INFIELD,
      0,
    );
    expect(totalInfield).toBe(6 * 4 + 6 * 4);

    // Individual codes stay distinct: LC only exists in the ten-player games,
    // CF only in the nine-player games.
    const allCodes = new Set<string>();
    for (const record of Object.values(usage)) {
      for (const code of Object.keys(record.byPositionCode)) allCodes.add(code);
    }
    expect(allCodes.has('LC')).toBe(true);
    expect(allCodes.has('CF')).toBe(true);

    const lcTotal = Object.values(usage).reduce(
      (acc, record) => acc + (record.byPositionCode['LC'] ?? 0),
      0,
    );
    const cfTotal = Object.values(usage).reduce(
      (acc, record) => acc + (record.byPositionCode['CF'] ?? 0),
      0,
    );
    expect(lcTotal).toBe(6);
    expect(cfTotal).toBe(6);
  });

  it('still generates a valid lineup after the formation changes', async () => {
    const scenario = buildScenario({
      innings: 6,
      formationId: 'baseball-9',
      players: roster(),
    });
    const history = [
      syntheticCompletedGame(scenario, {
        date: '2026-04-04',
        innings: 6,
        formationId: 'baseball-10-lc-rc',
        benchPlan: { 1: ['Walter'], 2: ['Race'], 3: ['Brody'], 4: ['Weston'], 5: ['Emerson'], 6: ['Solomon'] },
      }),
    ];

    const { result } = await runScenario(scenario, { history });
    expect(result.ok).toBe(true);
    expect(checkInvariants(scenario, result)).toEqual([]);
  });
});

describe('Fairness debt accounting', () => {
  it('creates no debt for a player who simply missed a game', async () => {
    const scenario = buildScenario({ innings: 6, players: roster() });
    const game = syntheticCompletedGame(scenario, {
      date: '2026-04-04',
      innings: 6,
      benchPlan: { 1: ['Walter'], 2: ['Race'], 3: ['Brody'], 4: ['Weston'], 5: ['Emerson'], 6: ['Solomon'] },
    });

    // Mark Mehki absent for that game entirely.
    const mehki = scenario.byName('Mehki');
    const withAbsence = {
      ...game,
      gamePlayers: game.gamePlayers.map((gp) =>
        gp.playerId === mehki.id ? { ...gp, available: false } : gp,
      ),
      defensiveAssignments: game.defensiveAssignments.filter(
        (a) => a.playerId !== mehki.id,
      ),
    };

    const debt = getFairnessDebt([withAbsence], scenario.players);
    expect(debt[mehki.id].expectedDefensiveInnings).toBe(0);
    expect(debt[mehki.id].defensiveDebt).toBe(0);
  });
});
