import { describe, expect, it } from 'vitest';
import { getFairnessDebt, getTeamSeasonFairness } from '@/services/fairness';
import { getPlayerSeasonUsage } from '@/services/seasonStatistics';
import { buildDemoDatabase } from './seed';

describe('demo team', () => {
  it('seeds eleven players with the documented eligibility', async () => {
    const db = await buildDemoDatabase();

    expect(db.teams).toHaveLength(1);
    expect(db.teams[0].name).toBe('Balsam Waters');
    expect(db.players).toHaveLength(11);

    expect(db.players.filter((p) => p.canPitch)).toHaveLength(7);
    expect(db.players.filter((p) => p.canCatch)).toHaveLength(6);

    const formation = db.games[0].formationSnapshot;
    const firstBase = formation.positions.find((p) => p.code === '1B')!;
    const cannotPlayFirst = db.players.filter(
      (p) => p.positionRatings[firstBase.id]?.eligibility === 'NEVER',
    );
    expect(cannotPlayFirst).toHaveLength(2);

    expect(db.players.filter((p) => p.overallTier === 'CORE').length).toBeGreaterThanOrEqual(3);
    expect(
      db.players.filter((p) => p.overallTier === 'DEVELOPING').length,
    ).toBeGreaterThanOrEqual(3);
  });

  it('seeds four completed games plus one upcoming game', async () => {
    const db = await buildDemoDatabase();

    const completed = db.games.filter((game) => game.status === 'COMPLETED');
    const upcoming = db.games.filter((game) => game.status === 'PLANNED');

    expect(completed).toHaveLength(4);
    expect(upcoming).toHaveLength(1);

    // Every completed game has actual results recorded.
    for (const game of completed) {
      expect(game.actualInnings).toBeGreaterThan(0);
      const actuals = game.defensiveAssignments.filter(
        (a) => a.assignmentType === 'ACTUAL',
      );
      expect(actuals.length).toBe(game.actualInnings! * game.formationSnapshot.positions.length);
      expect(Math.max(...actuals.map((a) => a.inning))).toBe(game.actualInnings);
    }

    // One game was called early, so it contributes fewer innings.
    expect(completed.some((game) => game.actualInnings === 5)).toBe(true);
  });

  it('produces realistic season imbalance for the optimizer to work against', async () => {
    const db = await buildDemoDatabase();
    const usage = getPlayerSeasonUsage(db.games);
    const debts = getFairnessDebt(db.games, db.players);
    const fairness = getTeamSeasonFairness(db.games, db.players);

    // Everyone who played has history.
    const played = Object.values(usage).filter((record) => record.games > 0);
    expect(played.length).toBe(11);

    // There is genuine spread to compensate for, but nothing absurd.
    const debtValues = db.players.map((p) => debts[p.id].defensiveDebt);
    const spread = Math.max(...debtValues) - Math.min(...debtValues);
    expect(spread).toBeGreaterThan(0.5);
    expect(spread).toBeLessThan(15);

    expect(fairness.averageDefensiveInnings).toBeGreaterThan(10);
    expect(fairness.balanceScore).toBeGreaterThan(0);
    expect(fairness.balanceScore).toBeLessThanOrEqual(1);

    // The player who missed a whole game is not penalised for it.
    const walter = db.players.find((p) => p.firstName === 'Walter')!;
    expect(usage[walter.id].games).toBe(3);
  });
});
