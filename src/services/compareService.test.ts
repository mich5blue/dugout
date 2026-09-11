import { describe, expect, it } from 'vitest';
import { buildScenario, checkInvariants, type PlayerSpec } from '@/test/fixtures';
import { compareApproaches, describeTradeoff } from './compareService';

/** Three-lineup comparison (spec section 46). */

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
    never: index > 8 ? ['1B'] : undefined,
  }));
}

describe('compareApproaches', () => {
  it('returns three valid lineups built from the same inputs', async () => {
    const scenario = buildScenario({ innings: 6, players: roster(), seed: 12 });

    const comparison = await compareApproaches({
      team: scenario.team,
      game: scenario.game,
      players: scenario.players,
      history: [],
    });

    expect(comparison.approaches.map((approach) => approach.philosophy)).toEqual([
      'EQUAL_PLAYING_TIME',
      'BALANCED',
      'COMPETITIVE',
    ]);

    for (const approach of comparison.approaches) {
      expect(approach.result.ok).toBe(true);
      expect(checkInvariants(scenario, approach.result)).toEqual([]);
      expect(approach.result.defensive).toHaveLength(6 * 10);
    }
  });

  it('produces genuinely different lineups across approaches', async () => {
    const scenario = buildScenario({ innings: 6, players: roster(), seed: 12 });
    const comparison = await compareApproaches({
      team: scenario.team,
      game: scenario.game,
      players: scenario.players,
      history: [],
    });

    const serialise = (approach: (typeof comparison.approaches)[number]) =>
      approach.result.defensive
        .map((a) => `${a.inning}|${a.positionId}|${a.playerId}`)
        .sort()
        .join(',');

    const fair = serialise(comparison.approaches[0]);
    const competitive = serialise(comparison.approaches[2]);
    expect(fair).not.toBe(competitive);
  });

  it('trades playing-time evenness for defensive strength, in that direction', async () => {
    const scenario = buildScenario({ innings: 6, players: roster(), seed: 12 });
    const comparison = await compareApproaches({
      team: scenario.team,
      game: scenario.game,
      players: scenario.players,
      history: [],
    });

    const metricOf = (philosophy: string, key: string) =>
      comparison.approaches
        .find((approach) => approach.philosophy === philosophy)!
        .result.quality.metrics.find((metric) => metric.key === key)!.value;

    // The whole point of the comparison: Competitive should be at least as
    // strong defensively, and Equal Playing Time at least as even.
    expect(metricOf('COMPETITIVE', 'defensiveStrength')).toBeGreaterThanOrEqual(
      metricOf('EQUAL_PLAYING_TIME', 'defensiveStrength'),
    );
    expect(metricOf('EQUAL_PLAYING_TIME', 'playingTime')).toBeGreaterThanOrEqual(
      metricOf('COMPETITIVE', 'playingTime'),
    );
  });

  it('keeps the coach\'s hard rules in every approach', async () => {
    const scenario = buildScenario({
      innings: 6,
      players: roster(),
      seed: 12,
      settings: {
        minDefensiveInnings: 4,
        minDefensiveInningsMode: 'REQUIRED',
        infieldOpportunity: { mode: 'REQUIRED', innings: 1 },
      },
    });

    const comparison = await compareApproaches({
      team: scenario.team,
      game: scenario.game,
      players: scenario.players,
      history: [],
    });

    for (const approach of comparison.approaches) {
      expect(approach.result.ok).toBe(true);
      // A required minimum stays required even under Competitive.
      expect(approach.settings.minDefensiveInnings).toBe(4);
      expect(approach.settings.minDefensiveInningsMode).toBe('REQUIRED');
      expect(approach.settings.infieldOpportunity).toEqual({
        mode: 'REQUIRED',
        innings: 1,
      });
      expect(approach.minInnings).toBeGreaterThanOrEqual(4);
    }
  });

  it('aligns metrics across approaches for side-by-side reading', async () => {
    const scenario = buildScenario({ innings: 6, players: roster(), seed: 12 });
    const comparison = await compareApproaches({
      team: scenario.team,
      game: scenario.game,
      players: scenario.players,
      history: [],
    });

    expect(comparison.metrics.length).toBeGreaterThan(0);
    for (const metric of comparison.metrics) {
      expect(Object.keys(metric.values).sort()).toEqual(
        ['BALANCED', 'COMPETITIVE', 'EQUAL_PLAYING_TIME'].sort(),
      );
      for (const value of Object.values(metric.values)) {
        expect(value).toBeGreaterThanOrEqual(0);
        expect(value).toBeLessThanOrEqual(1);
      }
    }
  });

  it('describes the trade-off in one actionable sentence', async () => {
    const scenario = buildScenario({ innings: 6, players: roster(), seed: 12 });
    const comparison = await compareApproaches({
      team: scenario.team,
      game: scenario.game,
      players: scenario.players,
      history: [],
    });

    const sentence = describeTradeoff(comparison, scenario.players);
    expect(sentence).toBeTruthy();
    expect(sentence!.length).toBeGreaterThan(20);
    expect(sentence).toMatch(/\.$/);
  });

  it('stays within the performance budget for three lineups', async () => {
    const scenario = buildScenario({ innings: 6, players: roster(), seed: 12 });

    const started = Date.now();
    await compareApproaches({
      team: scenario.team,
      game: scenario.game,
      players: scenario.players,
      history: [],
    });
    expect(Date.now() - started).toBeLessThan(3000);
  });
});
