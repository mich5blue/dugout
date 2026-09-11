import { describe, expect, it } from 'vitest';
import { buildDemoDatabase } from '@/data/seed';
import { createMemoryStore } from '@/data/localStore';
import { createGame } from '@/domain/factories';
import { getSystemFormation } from '@/domain/formations';
import { getFairnessDebt } from './fairness';
import { getPlayerSeasonUsage } from './seasonStatistics';
import { compensationDirectionHolds } from '@/test/fixtures';
import {
  generateLineup,
  recordActualResults,
  setAssignment,
  setAvailability,
  setBattingOrder,
  setPitchingPlan,
  toggleLock,
} from './lineupService';

/**
 * The whole coach workflow through the repository layer, exactly as the UI
 * drives it: seed a team, build a game, lose a player 45 minutes before first
 * pitch, rebalance, record a short game, and check the next game compensates.
 *
 * This is the UX north star from spec section 79.
 */

describe('coach workflow through the store', () => {
  it('runs a full game from setup to recorded results', async () => {
    const store = createMemoryStore(await buildDemoDatabase());

    const teams = await store.teams.list();
    const team = teams[0];
    expect(team).toBeDefined();

    const players = await store.players.listByTeam(team.id);
    const allGames = await store.games.listByTeam(team.id);
    const upcoming = allGames.find((game) => game.status === 'PLANNED');
    expect(upcoming).toBeDefined();

    // ---- Generate -------------------------------------------------------
    const first = await generateLineup({
      team,
      game: upcoming!,
      players,
      history: allGames,
    });
    expect(first.result.ok).toBe(true);
    expect(first.result.elapsedMs).toBeLessThan(2000);
    await store.games.save(first.game);

    const positionCount = first.game.formationSnapshot.positions.length;
    expect(first.result.defensive).toHaveLength(
      positionCount * first.game.plannedInnings,
    );
    expect(first.result.batting).toHaveLength(
      first.game.gamePlayers.filter((gp) => gp.available).length,
    );

    // ---- A player drops out 45 minutes before first pitch ---------------
    const missing = players.find((player) => player.firstName === 'Mehki')!;
    const withAbsence = setAvailability(first.game, missing.id, { available: false });
    await store.games.save(withAbsence);

    const rebalanced = await generateLineup({
      team,
      game: withAbsence,
      players,
      history: allGames,
    });
    expect(rebalanced.result.ok).toBe(true);
    expect(
      rebalanced.result.defensive.some(
        (assignment) => assignment.playerId === missing.id,
      ),
    ).toBe(false);
    expect(rebalanced.result.batting.some((entry) => entry.playerId === missing.id)).toBe(
      false,
    );
    await store.games.save(rebalanced.game);

    // ---- Coach locks a pitching change, then rebalances ------------------
    const pitcherPosition = rebalanced.game.formationSnapshot.positions.find(
      (position) => position.role === 'PITCHER',
    )!;
    const newPitcher = players.find(
      (player) => player.firstName === 'Solomon' && player.canPitch,
    )!;
    const planned = setPitchingPlan(rebalanced.game, 4, newPitcher.id);
    await store.games.save(planned);

    const afterPlan = await generateLineup({
      team,
      game: planned,
      players,
      history: allGames,
    });
    expect(afterPlan.result.ok).toBe(true);
    expect(
      afterPlan.result.defensive.find(
        (assignment) =>
          assignment.inning === 4 && assignment.positionId === pitcherPosition.id,
      )?.playerId,
    ).toBe(newPitcher.id);
    await store.games.save(afterPlan.game);

    // ---- Manual swap, locked, then rebalanced around --------------------
    const shortstop = afterPlan.game.formationSnapshot.positions.find(
      (position) => position.code === 'SS',
    )!;
    const leftField = afterPlan.game.formationSnapshot.positions.find(
      (position) => position.code === 'LF',
    )!;
    const inning2 = afterPlan.result.defensive.filter(
      (assignment) => assignment.inning === 2,
    );
    const shortstopPlayerId = inning2.find(
      (assignment) => assignment.positionId === shortstop.id,
    )!.playerId;
    const leftFieldPlayerId = inning2.find(
      (assignment) => assignment.positionId === leftField.id,
    )!.playerId;
    expect(shortstopPlayerId).not.toBe(leftFieldPlayerId);

    // Swapping in a player already on the field swaps the two positions.
    let edited = setAssignment(afterPlan.game, 2, shortstop.id, leftFieldPlayerId);
    edited = toggleLock(edited, 2, shortstop.id);
    edited = toggleLock(edited, 2, leftField.id);
    await store.games.save(edited);

    const afterSwap = await generateLineup({
      team,
      game: edited,
      players,
      history: allGames,
    });
    expect(afterSwap.result.ok).toBe(true);
    const swappedInning2 = afterSwap.result.defensive.filter(
      (assignment) => assignment.inning === 2,
    );
    expect(
      swappedInning2.find((assignment) => assignment.positionId === shortstop.id)?.playerId,
    ).toBe(leftFieldPlayerId);
    expect(
      swappedInning2.find((assignment) => assignment.positionId === leftField.id)?.playerId,
    ).toBe(shortstopPlayerId);
    await store.games.save(afterSwap.game);

    // ---- Manual batting order edit survives -----------------------------
    const order = afterSwap.result.batting.map((entry) => entry.playerId);
    const flipped = [order[1], order[0], ...order.slice(2)];
    const withOrder = setBattingOrder(
      afterSwap.game,
      flipped.map((playerId, index) => ({ playerId, battingSlot: index + 1 })),
    );
    await store.games.save(withOrder);

    const stored = await store.games.get(withOrder.id);
    expect(
      stored!.battingAssignments.find((entry) => entry.battingSlot === 1)?.playerId,
    ).toBe(order[1]);

    // ---- Game is called after five innings ------------------------------
    const completed = recordActualResults(withOrder, 5);
    await store.games.save(completed);

    expect(completed.status).toBe('COMPLETED');
    const actuals = completed.defensiveAssignments.filter(
      (assignment) => assignment.assignmentType === 'ACTUAL',
    );
    expect(actuals).toHaveLength(positionCount * 5);
    expect(Math.max(...actuals.map((assignment) => assignment.inning))).toBe(5);

    // The absent player contributed nothing to this game and carries no debt
    // for it: they appear in the four earlier games only.
    const history = await store.games.listByTeam(team.id);
    const usage = getPlayerSeasonUsage(history);
    const debts = getFairnessDebt(history, players);
    expect(usage[missing.id].games).toBe(4);
    expect(
      completed.defensiveAssignments.filter(
        (assignment) =>
          assignment.assignmentType === 'ACTUAL' && assignment.playerId === missing.id,
      ),
    ).toEqual([]);
    const debtBeforeThisGame = getFairnessDebt(
      history.filter((game) => game.id !== completed.id),
      players,
    );
    expect(debts[missing.id].defensiveDebt).toBeCloseTo(
      debtBeforeThisGame[missing.id].defensiveDebt,
      6,
    );

    // ---- Next game compensates ------------------------------------------
    const formation = getSystemFormation(team.defaultFormationId)!;
    const nextGame = createGame({
      teamId: team.id,
      opponent: 'Giants',
      date: '2026-05-09',
      plannedInnings: 6,
      formation,
      settings: team.settings,
      players,
      seed: 5,
    });
    await store.games.save(nextGame);

    const next = await generateLineup({
      team,
      game: nextGame,
      players,
      history: await store.games.listByTeam(team.id),
    });
    expect(next.result.ok).toBe(true);

    const inningsOf = (playerId: string) =>
      next.result.defensive.filter((assignment) => assignment.playerId === playerId).length;

    const active = players.filter((player) => player.active);
    const inningsSpread =
      Math.max(...active.map((player) => inningsOf(player.id))) -
      Math.min(...active.map((player) => inningsOf(player.id)));
    expect(inningsSpread).toBeLessThanOrEqual(1);

    // Players who are owed innings get at least as much of this game as the
    // players who are already ahead.
    const compensation = compensationDirectionHolds(
      active,
      (playerId) => debts[playerId].defensiveDebt,
      inningsOf,
    );
    expect(compensation.holds).toBe(true);

    await store.games.save(recordActualResults(next.game, 6));
  });

  it('persists through the repository layer across reads', async () => {
    const store = createMemoryStore(await buildDemoDatabase());
    const team = (await store.teams.list())[0];
    const players = await store.players.listByTeam(team.id);

    const updated = { ...players[0], jerseyNumber: '99', overallTier: 'CORE' as const };
    await store.players.save(updated);

    const reread = await store.players.get(players[0].id);
    expect(reread?.jerseyNumber).toBe('99');
    expect(reread?.overallTier).toBe('CORE');

    // Removing a player also cleans up their goals and priority flags.
    await store.flags.save({
      id: 'flag_1',
      teamId: team.id,
      playerId: players[1].id,
      kind: 'INFIELD',
      createdAt: new Date().toISOString(),
    });
    expect(await store.flags.listByTeam(team.id)).toHaveLength(1);

    await store.players.remove(players[1].id);
    expect(await store.flags.listByTeam(team.id)).toHaveLength(0);
    expect(await store.players.get(players[1].id)).toBeNull();
  });

  it('keeps history stable when team settings change afterwards', async () => {
    const store = createMemoryStore(await buildDemoDatabase());
    const team = (await store.teams.list())[0];
    const games = await store.games.listByTeam(team.id);
    const completed = games.find((game) => game.status === 'COMPLETED')!;

    const before = getPlayerSeasonUsage(games);
    const beforeTotal = Object.values(before).reduce(
      (acc, record) => acc + record.defensiveInnings,
      0,
    );

    // Switch the team to a nine-player formation and a different philosophy.
    await store.teams.save({
      ...team,
      defaultFormationId: 'baseball-9',
      defaultInnings: 7,
      settings: { ...team.settings, philosophy: 'COMPETITIVE', minDefensiveInnings: 1 },
    });

    const after = getPlayerSeasonUsage(await store.games.listByTeam(team.id));
    const afterTotal = Object.values(after).reduce(
      (acc, record) => acc + record.defensiveInnings,
      0,
    );

    expect(afterTotal).toBe(beforeTotal);
    // The completed game still remembers the formation it was played under.
    expect(completed.formationSnapshot.positions).toHaveLength(10);
    expect(completed.settingsSnapshot.philosophy).not.toBe('COMPETITIVE');
  });
});
