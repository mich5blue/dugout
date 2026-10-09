import { describe, expect, it } from 'vitest';
import { buildScenario } from '@/test/fixtures';
import { finishGame, frozenInningsFor, playerOut, startGame } from './liveGame';
import { generateLineupSync } from './lineupService';

function liveGame() {
  const scenario = buildScenario({
    players: Array.from({ length: 11 }, (_, index) => ({ name: `P${index}`, canPitch: index < 4, canCatch: index < 4 })),
  });
  const { game } = generateLineupSync({ team: scenario.team, game: scenario.game, players: scenario.players, history: [] });
  return { ...scenario, game: startGame(game, new Date('2026-04-18T17:00:00Z')) };
}

describe('game-day changes', () => {
  it('finishing records the innings played and leaves live mode', () => {
    const { game } = liveGame();
    const done = finishGame(game, 5);
    expect(done.status).toBe('COMPLETED');
    expect(done.actualInnings).toBe(5);
    expect(done.liveState).toBeNull();
    expect(done.defensiveAssignments.some((a) => a.assignmentType === 'ACTUAL')).toBe(true);
  });

  it('someone out from the start is unavailable; mid-game sets a departure', () => {
    const { game, players } = liveGame();
    const id = players[5].id;
    const gone = playerOut(game, id, 0).gamePlayers.find((gp) => gp.playerId === id)!;
    expect(gone.available).toBe(false);
    const leaving = playerOut(game, id, 3).gamePlayers.find((gp) => gp.playerId === id)!;
    expect(leaving.available).toBe(true);
    expect(leaving.departureInning).toBe(3);
  });

  it('freezes exactly the innings already played', () => {
    expect(frozenInningsFor(0)).toBe(0);
    expect(frozenInningsFor(3)).toBe(3);
    expect(frozenInningsFor(-1)).toBe(0);
  });
});
