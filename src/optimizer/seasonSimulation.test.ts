import { describe, expect, it } from 'vitest';
import { createGame } from '@/domain/factories';
import { getSystemFormation } from '@/domain/formations';
import type { Game } from '@/domain/types';
import { getFairnessDebt } from '@/services/fairness';
import { getPlayerSeasonUsage } from '@/services/seasonStatistics';
import { generateLineup, recordActualResults } from '@/services/lineupService';
import { buildScenario, type PlayerSpec } from '@/test/fixtures';

/**
 * Season-long simulation.
 *
 * With 11 players and 10 defensive positions, a fair share is 5.45 innings per
 * game — integer slots make it impossible for any single game to leave zero
 * debt. What must hold is that debt does not accumulate on the same players:
 * whoever is short one week gets the extra inning the next. These tests check
 * that mean-reversion over a real season rather than per-game perfection.
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
  return NAMES.map((name, index) => ({
    name,
    canPitch: index < 7,
    canCatch: index % 2 === 0,
    tier: index < 3 ? 'CORE' : index > 7 ? 'DEVELOPING' : 'REGULAR',
    // Two players cannot cover first base, as in the demo team.
    never: index > 8 ? ['1B'] : undefined,
  }));
}

async function simulateSeason(
  gameCount: number,
  options: {
    actualInnings?: (game: number) => number;
    settings?: Parameters<typeof buildScenario>[0]['settings'];
  } = {},
) {
  const scenario = buildScenario({
    innings: 6,
    players: roster(),
    settings: options.settings,
  });
  const formation = getSystemFormation('baseball-10-lc-rc')!;
  const history: Game[] = [];
  const inningsPerGame: number[] = [];

  for (let index = 0; index < gameCount; index++) {
    const game = createGame({
      teamId: scenario.team.id,
      opponent: `Opponent ${index + 1}`,
      date: `2026-04-${String(index + 1).padStart(2, '0')}`,
      plannedInnings: 6,
      formation,
      settings: scenario.team.settings,
      players: scenario.players,
      seed: 1000 + index,
    });

    const { result, game: planned } = await generateLineup({
      team: scenario.team,
      game,
      players: scenario.players,
      history,
    });
    expect(result.ok).toBe(true);

    const actual = options.actualInnings?.(index + 1) ?? 6;
    inningsPerGame.push(actual);
    history.push(recordActualResults(planned, actual));
  }

  const debts = getFairnessDebt(history, scenario.players);
  const usage = getPlayerSeasonUsage(history);
  const active = scenario.players;

  const absDebts = active.map((player) => Math.abs(debts[player.id].defensiveDebt));
  const infieldDebts = active.map((player) => Math.abs(debts[player.id].infieldDebt));
  const defensiveTotals = active.map((player) => usage[player.id].defensiveInnings);
  const benchTotals = active.map((player) => usage[player.id].benchInnings);

  return {
    scenario,
    history,
    debts,
    usage,
    meanAbsDebt: absDebts.reduce((a, b) => a + b, 0) / active.length,
    maxAbsDebt: Math.max(...absDebts),
    maxInfieldDebt: Math.max(...infieldDebts),
    defensiveSpread: Math.max(...defensiveTotals) - Math.min(...defensiveTotals),
    benchSpread: Math.max(...benchTotals) - Math.min(...benchTotals),
    inningsPerGame,
  };
}

describe('season-long fairness', () => {
  it('keeps defensive innings debt bounded over ten games', async () => {
    const season = await simulateSeason(10);

    /*
      With 11 players and 10 positions a fair share is 5.4545 innings per game,
      so after any game every player sits at either +0.4545 or -0.5454 and the
      best drift achievable at any moment is 0.5454. Under the default Balanced
      philosophy the optimizer also honours player preferences and critical
      positions, which can hold a player one inning away from that ideal — what
      must not happen is drift growing with the number of games.
    */
    expect(season.maxAbsDebt).toBeLessThan(2);
    expect(season.meanAbsDebt).toBeLessThan(0.8);

    // Over ten games, 54.5 innings each: season totals stay tightly clustered.
    expect(season.defensiveSpread).toBeLessThanOrEqual(3);
    expect(season.benchSpread).toBeLessThanOrEqual(3);
  });

  it('does not let drift grow as the season goes on', async () => {
    const short = await simulateSeason(5);
    const long = await simulateSeason(15);

    // Debt is corrected continuously rather than accumulating, so a longer
    // season is no less fair than a short one.
    expect(long.maxAbsDebt).toBeLessThanOrEqual(short.maxAbsDebt + 0.6);
  });

  it('allows wider differences when the coach chooses Competitive', async () => {
    const fair = await simulateSeason(10, {
      settings: { philosophy: 'EQUAL_PLAYING_TIME', playingTimeBalance: 'EQUAL' },
    });
    const competitive = await simulateSeason(10, {
      settings: { philosophy: 'COMPETITIVE', playingTimeBalance: 'COMPETITIVE' },
    });

    // The philosophy dial has to actually mean something.
    expect(fair.maxAbsDebt).toBeLessThan(0.6);
    expect(competitive.maxAbsDebt).toBeGreaterThan(fair.maxAbsDebt);
  });

  it('evens out infield opportunity over a season', async () => {
    const season = await simulateSeason(10);
    expect(season.maxInfieldDebt).toBeLessThan(4);

    // Every player gets meaningful infield time, including the two who
    // cannot play first base.
    for (const player of season.scenario.players) {
      expect(season.usage[player.id].byGroup.INFIELD).toBeGreaterThan(0);
    }
  });

  it('recovers from a run of short games', async () => {
    // Three of the first four games are called early, which is exactly the
    // situation that creates real-world imbalance.
    const season = await simulateSeason(10, {
      actualInnings: (game) => (game <= 4 && game !== 2 ? 4 : 6),
    });

    expect(season.inningsPerGame.slice(0, 4)).toEqual([4, 6, 4, 4]);
    expect(season.maxAbsDebt).toBeLessThan(2);
    expect(season.defensiveSpread).toBeLessThanOrEqual(3);
  });

  it('spreads positions rather than parking players in one spot', async () => {
    const season = await simulateSeason(10);

    for (const player of season.scenario.players) {
      const record = season.usage[player.id];
      // Everyone sees several different positions over a season.
      expect(record.uniquePositionCodes).toBeGreaterThanOrEqual(4);

      // Nobody spends most of the season at a single position.
      const heaviest = Math.max(...Object.values(record.byPositionCode));
      expect(heaviest / record.defensiveInnings).toBeLessThan(0.5);
    }
  });

  it('rotates who sits first', async () => {
    const season = await simulateSeason(10);
    const firstInningBench = season.scenario.players.map(
      (player) => season.usage[player.id].firstInningBenchGames,
    );
    // 11 players, one sits each inning: no single player should absorb the
    // first-inning bench more than a couple of times in ten games.
    expect(Math.max(...firstInningBench)).toBeLessThanOrEqual(3);
  });
});
