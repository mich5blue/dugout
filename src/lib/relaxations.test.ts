import { describe, expect, it } from 'vitest';
import { buildScenario } from '@/test/fixtures';
import { applyRelaxation } from './relaxations';

const players = Array.from({ length: 9 }, (_, index) => ({ name: `P${index}` }));

describe('applyRelaxation', () => {
  it('changes this game only, never the team default', () => {
    const { game, team } = buildScenario({ players });
    const next = applyRelaxation(game, team, [], { action: { type: 'ALLOW_CONSECUTIVE_BENCH' } })!;
    expect(next.settingsSnapshot.noConsecutiveBench).toBe(false);
    expect(team.settings.noConsecutiveBench).toBe(game.settingsSnapshot.noConsecutiveBench);
  });

  it('adds an eligibility override for this game', () => {
    const { game, team, byName, positionId } = buildScenario({ players });
    const action = { type: 'ALLOW_POSITION' as const, playerId: byName('P1').id, positionId: positionId('SS') };
    const next = applyRelaxation(game, team, [], { action })!;
    expect(next.eligibilityOverrides).toContainEqual({ playerId: action.playerId, positionId: action.positionId });
  });

  it('swaps to the largest formation that fits', () => {
    const { game, team } = buildScenario({ players });
    expect(game.formationSnapshot.positions.length).toBe(10);
    const next = applyRelaxation(game, team, [], { action: { type: 'USE_SMALLER_FORMATION', positions: 9 } })!;
    expect(next.formationSnapshot.positions.length).toBe(9);
  });

  it('returns null when there is nothing to apply', () => {
    const { game, team } = buildScenario({ players });
    expect(applyRelaxation(game, team, [], {})).toBeNull();
  });
});
