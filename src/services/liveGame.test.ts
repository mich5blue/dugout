import { describe, expect, it } from 'vitest';
import { buildScenario, runScenario } from '@/test/fixtures';
import {
  advanceInning,
  batterQueue,
  currentInning,
  nextBatter,
  previousBatter,
  previousInning,
  startGame,
} from '@/services/liveGame';
import type { Game } from '@/domain/types';

/**
 * Game-day transitions. Tested because this is the code that runs with the
 * worst connection and the least attention, and because a wrong inning
 * counter sends nine kids to the wrong positions.
 */

const NAMES = ['Ada', 'Bo', 'Cruz', 'Dev', 'Eli', 'Fern', 'Gus', 'Hana', 'Ivo', 'Juno', 'Kit'];

async function played(): Promise<Game> {
  const scenario = buildScenario({
    innings: 6,
    players: NAMES.map((name) => ({ name, canPitch: true, canCatch: true })),
  });
  const { game } = await runScenario(scenario, { seed: 5 });
  return game;
}

describe('starting a game', () => {
  it('marks it in progress at the first inning and first batter', async () => {
    const game = startGame(await played(), new Date('2026-05-10T17:00:00Z'));
    expect(game.status).toBe('IN_PROGRESS');
    expect(game.liveState).toMatchObject({ inning: 1, batterIndex: 0 });
    expect(game.liveState?.startedAt).toBe('2026-05-10T17:00:00.000Z');
  });

  it('does not touch the lineup — starting is not a claim about who played', async () => {
    const before = await played();
    const after = startGame(before);
    expect(after.defensiveAssignments).toEqual(before.defensiveAssignments);
    expect(after.actualInnings).toBeNull();
  });
});

describe('innings', () => {
  it('advances and steps back', async () => {
    let game = startGame(await played());
    game = advanceInning(game);
    game = advanceInning(game);
    expect(currentInning(game)).toBe(3);
    game = previousInning(game);
    expect(currentInning(game)).toBe(2);
  });

  it('stops at the first and last inning rather than running past them', async () => {
    let game = startGame(await played());
    game = previousInning(game);
    expect(currentInning(game)).toBe(1);

    for (let i = 0; i < 20; i++) game = advanceInning(game);
    // Extra innings are a change to plannedInnings, not something the counter
    // invents on its own.
    expect(currentInning(game)).toBe(game.plannedInnings);
  });

  it('is inert on a game that was never started', async () => {
    const game = await played();
    expect(advanceInning(game)).toBe(game);
    expect(currentInning(game)).toBe(1);
  });
});

describe('the batting order', () => {
  it('wraps, because a continuous order goes round again', async () => {
    let game = startGame(await played());
    const size = game.battingAssignments.length;
    for (let i = 0; i < size; i++) game = nextBatter(game);
    expect(game.liveState?.batterIndex).toBe(0);

    game = previousBatter(game);
    expect(game.liveState?.batterIndex).toBe(size - 1);
  });

  it('reports up, on deck and in the hole in slot order', async () => {
    const game = startGame(await played());
    const order = [...game.battingAssignments].sort((a, b) => a.battingSlot - b.battingSlot);
    expect(batterQueue(game)).toEqual([
      order[0].playerId,
      order[1].playerId,
      order[2].playerId,
    ]);
  });

  it('wraps the queue at the end of the order', async () => {
    let game = startGame(await played());
    const order = [...game.battingAssignments].sort((a, b) => a.battingSlot - b.battingSlot);
    for (let i = 0; i < order.length - 1; i++) game = nextBatter(game);

    expect(batterQueue(game)).toEqual([
      order[order.length - 1].playerId,
      order[0].playerId,
      order[1].playerId,
    ]);
  });
});
