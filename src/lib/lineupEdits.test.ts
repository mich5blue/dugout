import { describe, expect, it } from 'vitest';
import type { Game } from '@/domain/types';
import { generateLineupSync } from '@/services/lineupService';
import { buildScenario } from '@/test/fixtures';
import { movePlayer, positionOptions, reorderBatting, restPlayer, rotateBattingFromPrevious } from './lineupEdits';

const names = ['Ava', 'Ben', 'Cal', 'Dee', 'Eli', 'Fay', 'Gus', 'Hal', 'Ivy', 'Jo', 'Kit'];

function generated() {
  const scenario = buildScenario({
    players: names.map((name, index) => ({ name, canPitch: index < 4, canCatch: index < 4 })),
  });
  const { game } = generateLineupSync({
    team: scenario.team,
    game: scenario.game,
    players: scenario.players,
    history: [],
  });
  return { ...scenario, game };
}

describe('lineup edits', () => {
  it('swaps when moving onto an occupied position', () => {
    const { game, players, positionId } = generated();
    const ss = positionId('SS');
    const options = positionOptions(game, players, players[0].id, 1);
    const target = options.options.find((option) => option.positionId === ss)!;
    const occupant = target.occupantId;

    const moved = movePlayer(game, players[0].id, 1, ss);
    const after = positionOptions(moved, players, players[0].id, 1);
    expect(after.options.find((option) => option.positionId === ss)!.occupantId).toBe(players[0].id);
    if (occupant && occupant !== players[0].id) {
      /* The player who was there is still placed somewhere, or resting — not lost. */
      const theirs = positionOptions(moved, players, occupant, 1);
      expect(theirs.state).not.toBe('OUT');
    }
  });

  it('rests a player who was fielding', () => {
    const { game, players } = generated();
    const fielding = players.find((player) => positionOptions(game, players, player.id, 1).state === 'FIELD')!;
    expect(positionOptions(restPlayer(game, players, fielding.id, 1), players, fielding.id, 1).state).toBe('REST');
  });

  it('marks positions a player cannot take', () => {
    const { game, players, byName, positionId } = generated();
    const pitcher = positionOptions(game, players, byName('Kit').id, 1).options.find(
      (option) => option.positionId === positionId('P'),
    )!;
    expect(pitcher.blocked).toMatch(/pitch/);
  });

  it('reorders the batting order top to bottom', () => {
    const { game, players } = generated();
    const reversed = [...players].reverse().map((player) => player.id);
    const next = reorderBatting(game, reversed);
    const order = [...next.battingAssignments].sort((a, b) => a.battingSlot - b.battingSlot);
    expect(order.map((entry) => entry.playerId)).toEqual(reversed);
  });

  it('rotates from the previous game', () => {
    const { game, players } = generated();
    const previous: Game = { ...game, id: 'prev', date: '2026-04-11', status: 'COMPLETED' };
    const next = rotateBattingFromPrevious(game, [game, previous], players, 2)!;
    const before = [...previous.battingAssignments].sort((a, b) => a.battingSlot - b.battingSlot);
    const after = [...next.battingAssignments].sort((a, b) => a.battingSlot - b.battingSlot);
    expect(after[0].playerId).toBe(before[2].playerId);
    expect(rotateBattingFromPrevious(game, [game], players, 2)).toBeNull();
  });
});
