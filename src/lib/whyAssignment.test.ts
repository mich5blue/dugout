import { describe, expect, it } from 'vitest';
import { buildScenario, runScenario } from '@/test/fixtures';
import { buildGameView, type GameView } from '@/lib/gameView';
import { emptyFairnessDebt } from '@/domain/season';
import { whyAssignment, whyNotEligible } from '@/lib/whyAssignment';
import { setAssignment, toggleLock } from '@/services/lineupService';
import type { Game, Player } from '@/domain/types';

/**
 * "Why this assignment?" — the answer has to be true, and it has to work on a
 * game read back from storage rather than one the solver still has in hand.
 */

const NAMES = ['Ada', 'Bo', 'Cruz', 'Dev', 'Eli', 'Fern', 'Gus', 'Hana', 'Ivo', 'Juno', 'Kit'];

async function built(): Promise<{ game: Game; players: Player[]; view: GameView }> {
  const scenario = buildScenario({
    innings: 6,
    players: NAMES.map((name) => ({ name, canPitch: true, canCatch: true })),
  });
  const { game } = await runScenario(scenario, { seed: 7 });
  return { game, players: scenario.players, view: buildGameView(game, scenario.players) };
}

describe('explaining a cell', () => {
  it('names the player, the position and the inning', async () => {
    const { view } = await built();
    const onField = view.positions
      .map((p) => view.playerAt(3, p.id))
      .find((player) => player !== undefined)!;

    const why = whyAssignment(view, onField.id, 3);
    expect(why.headline).toContain(view.names.short(onField.id));
    expect(why.headline).toContain('inning 3');
    expect(why.reasons.length).toBeGreaterThan(0);
  });

  it('always states eligibility, because that is the one hard constraint', async () => {
    const { view } = await built();
    const position = view.positions[4];
    const player = view.playerAt(2, position.id)!;
    const why = whyAssignment(view, player.id, 2);

    expect(why.reasons.some((r) => r.kind === 'ELIGIBILITY' || r.kind === 'PREFERRED')).toBe(
      true,
    );
  });

  it('credits the coach when the cell is locked, not the optimizer', async () => {
    const { game, players } = await built();
    const position = buildGameView(game, players).positions[0];
    const locked = toggleLock(game, 1, position.id);
    const view = buildGameView(locked, players);
    const player = view.playerAt(1, position.id)!;

    const why = whyAssignment(view, player.id, 1);
    const reason = why.reasons.find((r) => r.kind === 'LOCKED');
    expect(reason).toBeDefined();
    expect(reason?.coachSet).toBe(true);
  });

  it('explains a rest inning as a rest, not as an absence', async () => {
    const { view } = await built();
    const resting = view.benchAt(2)[0];
    expect(resting).toBeDefined();

    const why = whyAssignment(view, resting.id, 2);
    expect(why.headline).toContain('resting');
    expect(why.reasons.some((r) => r.kind === 'BENCH_ROTATION')).toBe(true);
  });

  it('says a limited player loses no ground for innings they were not there for', async () => {
    const { game, players } = await built();
    const first = players[0];
    const limited: Game = {
      ...game,
      gamePlayers: game.gamePlayers.map((gp) =>
        gp.playerId === first.id ? { ...gp, departureInning: 3 } : gp,
      ),
    };
    const why = whyAssignment(buildGameView(limited, players), first.id, 5);

    expect(why.headline).toContain('isn’t available');
    expect(why.reasons[0].text).toContain('lose no ground');
  });

  it('brings the season in only when there is a season', async () => {
    const { view } = await built();
    const position = view.positions.find((p) => p.group === 'INFIELD')!;
    const player = view.playerAt(1, position.id)!;

    const withoutSeason = whyAssignment(view, player.id, 1);
    expect(withoutSeason.reasons.some((r) => r.kind === 'SEASON_DEBT')).toBe(false);

    const withDebt = whyAssignment(view, player.id, 1, {
      ...emptyFairnessDebt(player.id),
      defensiveDebt: 2.5,
      infieldDebt: 1.5,
    });
    expect(withDebt.reasons.some((r) => r.kind === 'SEASON_DEBT')).toBe(true);
    expect(withDebt.reasons.some((r) => r.kind === 'INFIELD_DEBT')).toBe(true);
  });

  it('reports pitching workload against the cap that actually applies', async () => {
    const { view } = await built();
    const pitcher = view.positions.find((p) => p.role === 'PITCHER')!;
    const player = view.playerAt(1, pitcher.id)!;

    const why = whyAssignment(view, player.id, 1);
    const workload = why.reasons.find((r) => r.kind === 'WORKLOAD');
    expect(workload?.text).toMatch(/Pitches \d+ inning/);
  });
});

describe('whyNotEligible', () => {
  it('is silent for a position the player can take', async () => {
    const { view } = await built();
    const position = view.positions.find((p) => p.group === 'OUTFIELD')!;
    expect(whyNotEligible(view, view.players[0].id, position)).toBeNull();
  });

  it('points at the roster page when the battery flag is the blocker', async () => {
    const scenario = buildScenario({
      innings: 6,
      players: NAMES.map((name, i) => ({
        name,
        canPitch: i < 3,
        canCatch: i < 3,
      })),
    });
    const { game } = await runScenario(scenario, { seed: 7 });
    const view = buildGameView(game, scenario.players);
    const pitcher = view.positions.find((p) => p.role === 'PITCHER')!;
    const cannot = scenario.players[9];

    const reason = whyNotEligible(view, cannot.id, pitcher);
    expect(reason).toContain('able to pitch');
  });
});
