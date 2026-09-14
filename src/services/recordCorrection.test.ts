import { describe, expect, it } from 'vitest';
import { buildScenario, runScenario } from '@/test/fixtures';
import { buildGameView, UNAVAILABLE } from '@/lib/gameView';
import { recordActualResults, updateActualAssignment } from '@/services/lineupService';
import { getPlayerSeasonUsage } from '@/services/seasonStatistics';
import type { Game, Player } from '@/domain/types';

/**
 * Correcting a recorded game.
 *
 * The case this exists for: a coach logs a game as planned, then remembers
 * that Brody sat the fourth when he was not scheduled to. Every season number
 * is computed from ACTUAL rows, so a correction that leaves the data
 * inconsistent silently poisons fairness for the rest of the season.
 */

const NAMES = ['Brody','Race','Weston','Calvin','Emerson','Solomon','Finnegan','Vasil','Mehki','Ashur','Walter'];

async function recordedGame(): Promise<{ game: Game; players: Player[] }> {
  const scenario = buildScenario({
    innings: 6,
    players: NAMES.map((name) => ({ name, canPitch: true, canCatch: true })),
  });
  const { game } = await runScenario(scenario, { seed: 4 });
  return { game: recordActualResults(game, 6), players: scenario.players };
}

/** Everyone holding a position in this inning, per the ACTUAL record. */
function onFieldAt(game: Game, players: Player[], inning: number): string[] {
  const view = buildGameView(game, players, 'ACTUAL');
  return view.positions
    .map((position) => view.playerAt(inning, position.id)?.id)
    .filter((id): id is string => Boolean(id));
}

describe('correcting a recorded game', () => {
  it('benches a player who sat when they were not scheduled to', async () => {
    const { game, players } = await recordedGame();
    const view = buildGameView(game, players, 'ACTUAL');
    const brody = players.find((p) => p.firstName === 'Brody')!;

    const slot = view.slotOf(brody.id, 4);
    expect(slot).not.toBe(UNAVAILABLE);
    expect(slot).not.toBeNull();

    const corrected = updateActualAssignment(game, 4, (slot as { id: string }).id, null);
    const after = buildGameView(corrected, players, 'ACTUAL');

    expect(after.slotOf(brody.id, 4)).toBeNull();
    // And only that inning changed.
    expect(after.slotOf(brody.id, 3)).toEqual(view.slotOf(brody.id, 3));
    expect(after.slotOf(brody.id, 5)).toEqual(view.slotOf(brody.id, 5));
  });

  it('drops the inning from his season total, and nobody else changes', async () => {
    const { game, players } = await recordedGame();
    const view = buildGameView(game, players, 'ACTUAL');
    const brody = players.find((p) => p.firstName === 'Brody')!;
    const before = view.defensiveInnings(brody.id);

    const slot = view.slotOf(brody.id, 4) as { id: string };
    const after = buildGameView(
      updateActualAssignment(game, 4, slot.id, null),
      players,
      'ACTUAL',
    );

    expect(after.defensiveInnings(brody.id)).toBe(before - 1);
    for (const player of players) {
      if (player.id === brody.id) continue;
      expect(after.defensiveInnings(player.id)).toBe(view.defensiveInnings(player.id));
    }
  });

  it('never leaves one player at two positions in the same inning', async () => {
    const { game, players } = await recordedGame();
    const view = buildGameView(game, players, 'ACTUAL');

    // Put whoever was benched in inning 4 into another player's spot — the
    // correction a coach makes when a substitute actually went in.
    const bench = view.benchAt(4);
    const target = view.positions.find((p) => {
      const at = view.playerAt(4, p.id);
      return at && !bench.some((b) => b.id === at.id);
    })!;
    const substitute = bench[0] ?? players.find((p) => !onFieldAt(game, players, 4).includes(p.id))!;

    const corrected = updateActualAssignment(game, 4, target.id, substitute.id);
    const field = onFieldAt(corrected, players, 4);

    expect(new Set(field).size).toBe(field.length);
    expect(field).toContain(substitute.id);
  });

  it('swaps rather than duplicating when the player is already on the field', async () => {
    const { game, players } = await recordedGame();
    const view = buildGameView(game, players, 'ACTUAL');

    const [first, second] = view.positions;
    const a = view.playerAt(4, first.id)!;
    const b = view.playerAt(4, second.id)!;

    const corrected = updateActualAssignment(game, 4, first.id, b.id);
    const after = buildGameView(corrected, players, 'ACTUAL');

    expect(after.playerAt(4, first.id)?.id).toBe(b.id);
    expect(after.playerAt(4, second.id)?.id).toBe(a.id);

    const field = onFieldAt(corrected, players, 4);
    expect(new Set(field).size).toBe(field.length);
  });

  it('drops the inning from the season statistics, which is what feeds fairness', async () => {
    const { game, players } = await recordedGame();
    const brody = players.find((p) => p.firstName === 'Brody')!;
    const before = getPlayerSeasonUsage([game])[brody.id].defensiveInnings;

    const slot = buildGameView(game, players, 'ACTUAL').slotOf(brody.id, 4) as {
      id: string;
    };
    const corrected = updateActualAssignment(game, 4, slot.id, null);
    const usage = getPlayerSeasonUsage([corrected]);

    expect(usage[brody.id].defensiveInnings).toBe(before - 1);
    // And it is a bench inning now, not a vanished one.
    expect(usage[brody.id].benchInnings).toBeGreaterThan(0);
  });

  it('leaves the plan untouched, so planned and actual stay distinguishable', async () => {
    const { game, players } = await recordedGame();
    const planned = buildGameView(game, players, 'PLANNED');
    const slot = planned.slotOf(
      players.find((p) => p.firstName === 'Brody')!.id,
      4,
    ) as { id: string };

    const corrected = updateActualAssignment(game, 4, slot.id, null);
    const plannedAfter = buildGameView(corrected, players, 'PLANNED');

    for (const position of planned.positions) {
      expect(plannedAfter.playerAt(4, position.id)?.id).toBe(
        planned.playerAt(4, position.id)?.id,
      );
    }
  });
});
