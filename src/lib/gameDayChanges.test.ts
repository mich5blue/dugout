import { describe, expect, it } from 'vitest';
import { buildScenario, runScenario, type PlayerSpec } from '@/test/fixtures';
import { buildGameView, UNAVAILABLE } from '@/lib/gameView';
import { setAssignment } from '@/services/lineupService';
import { extraInningFor, plannedPitchingInnings } from '@/lib/gameDayChanges';
import { playerShortName } from '@/domain/factories';

/**
 * The "goes another inning" preview has one job: say what will happen before
 * the coach commits. So the thing worth testing is that the sentence it shows
 * and the write that follows cannot disagree.
 */

const NAMES = ['Brody','Race','Weston','Calvin','Emerson','Solomon','Finnegan','Vasil','Mehki','Ashur','Walter'];

function roster(overrides: Partial<PlayerSpec> = {}): PlayerSpec[] {
  return NAMES.map((name) => ({ name, canPitch: true, canCatch: true, ...overrides }));
}

async function lineup(spec: Parameters<typeof buildScenario>[0] = { players: roster() }) {
  const scenario = buildScenario(spec);
  const { game } = await runScenario(scenario, { seed: 5 });
  return { scenario, game, view: buildGameView(game, scenario.players, 'PLANNED') };
}

describe('extra inning preview', () => {
  it('predicts exactly what applying the swap does', async () => {
    const { scenario, game, view } = await lineup();
    const plan = extraInningFor(view, 1);
    expect(plan).not.toBeNull();
    expect(plan!.blocked).toBeUndefined();

    const next = setAssignment(game, plan!.nextInning, plan!.pitcherPositionId, plan!.pitcher.id);
    const after = buildGameView(next, scenario.players, 'PLANNED');

    // The pitcher holds the mound.
    expect(after.playerAt(plan!.nextInning, plan!.pitcherPositionId)?.id).toBe(plan!.pitcher.id);

    // And the displaced pitcher lands exactly where the preview said.
    if (plan!.displaced) {
      const landed = after.slotOf(plan!.displaced.id, plan!.nextInning);
      if (plan!.pitcherNextPosition) {
        expect(landed === UNAVAILABLE ? null : landed?.id).toBe(plan!.pitcherNextPosition.id);
        expect(plan!.summary).toContain(plan!.pitcherNextPosition.code);
      } else {
        expect(landed).toBeNull();
      }
      expect(plan!.summary).toContain(playerShortName(plan!.displaced));
    }
  });

  it('leaves everyone else in that inning alone', async () => {
    const { scenario, game, view } = await lineup();
    const plan = extraInningFor(view, 2)!;
    const moved = new Set([plan.pitcher.id, plan.displaced?.id]);

    const before = view.positions.map((p) => [p.id, view.playerAt(plan.nextInning, p.id)?.id] as const);
    const next = setAssignment(game, plan.nextInning, plan.pitcherPositionId, plan.pitcher.id);
    const after = buildGameView(next, scenario.players, 'PLANNED');

    for (const [positionId, playerId] of before) {
      if (playerId && moved.has(playerId)) continue;
      expect(after.playerAt(plan.nextInning, positionId)?.id).toBe(playerId);
    }
  });

  it('changes no other inning', async () => {
    const { scenario, game, view } = await lineup();
    const plan = extraInningFor(view, 3)!;
    const next = setAssignment(game, plan.nextInning, plan.pitcherPositionId, plan.pitcher.id);
    const after = buildGameView(next, scenario.players, 'PLANNED');

    for (const inning of view.innings) {
      if (inning === plan.nextInning) continue;
      for (const position of view.positions) {
        expect(after.playerAt(inning, position.id)?.id).toBe(
          view.playerAt(inning, position.id)?.id,
        );
      }
    }
  });

  it('offers nothing for the last inning', async () => {
    const { view } = await lineup();
    expect(extraInningFor(view, view.innings.length)).toBeNull();
  });

  it('offers nothing when the same player already pitches both innings', async () => {
    const { scenario, game } = await lineup();
    const view = buildGameView(game, scenario.players, 'PLANNED');
    const plan = extraInningFor(view, 1)!;
    const applied = setAssignment(game, plan.nextInning, plan.pitcherPositionId, plan.pitcher.id);
    const after = buildGameView(applied, scenario.players, 'PLANNED');
    // Having gone again, the question no longer arises for that inning.
    expect(extraInningFor(after, 1)).toBeNull();
  });

  it('blocks the swap when it would break the pitching cap', async () => {
    const { view } = await lineup({
      players: roster(),
      settings: { maxPitchingInningsPerPlayer: 1 },
    });
    const plan = extraInningFor(view, 1);
    expect(plan?.blocked).toMatch(/capped at 1 inning/);
  });

  it('blocks the swap when the pitcher has already left', async () => {
    const { view } = await lineup({
      players: roster().map((p, i) => (i === 0 ? { ...p, departure: 2 } : p)),
      innings: 6,
    });
    // Find an inning whose pitcher departs before the next one.
    const departing = view.players.find(
      (p) => view.slotOf(p.id, 3) === UNAVAILABLE,
    );
    expect(departing).toBeDefined();
    for (const inning of view.innings.slice(0, -1)) {
      const plan = extraInningFor(view, inning);
      if (plan && plan.pitcher.id === departing!.id && plan.blocked) {
        expect(plan.blocked).toMatch(/not available/);
        return;
      }
    }
  });

  it('counts planned pitching innings', async () => {
    const { view } = await lineup();
    const total = view.players.reduce(
      (sum, p) => sum + plannedPitchingInnings(view, p.id),
      0,
    );
    // Exactly one pitcher per inning.
    expect(total).toBe(view.innings.length);
  });
});
