import type { Game } from '@/domain/types';

/**
 * Running a game.
 *
 * Every transition here is a pure function on the game, for two reasons. The
 * dugout is where this code runs with the worst connection and the least
 * attention, so it has to be the easiest part of the product to reason about
 * and the easiest to test. And the game-day surface must never invent a
 * separate idea of the truth — it moves the same `Game` the planning screens
 * move, so what a coach does at the fence is already recorded when they get
 * home.
 *
 * What these deliberately do NOT do is touch `defensiveAssignments`. Advancing
 * an inning is not a claim about who played it: the plan already says that, and
 * turning the plan into the record is `recordActualResults`, at the end, once.
 * Writing ACTUAL rows inning by inning would mean a coach who put the phone
 * away in the third had a game half-recorded and half-planned, which is the
 * state the whole planned-versus-actual split exists to avoid.
 */

export function startGame(game: Game, now: Date = new Date()): Game {
  return {
    ...game,
    status: 'IN_PROGRESS',
    liveState: {
      inning: 1,
      batterIndex: 0,
      startedAt: now.toISOString(),
    },
  };
}

/** The inning being played, defaulting to the first. */
export function currentInning(game: Game): number {
  return game.liveState?.inning ?? 1;
}

export function currentBatterIndex(game: Game): number {
  return game.liveState?.batterIndex ?? 0;
}

export function advanceInning(game: Game): Game {
  if (!game.liveState) return game;
  /* Clamped at the planned innings: extra innings are a change to the plan
     (plannedInnings), not something the counter should invent on its own. */
  const inning = Math.min(game.plannedInnings, game.liveState.inning + 1);
  return { ...game, liveState: { ...game.liveState, inning } };
}

export function previousInning(game: Game): Game {
  if (!game.liveState) return game;
  const inning = Math.max(1, game.liveState.inning - 1);
  return { ...game, liveState: { ...game.liveState, inning } };
}

/**
 * Next batter, wrapping at the end of the order.
 *
 * Wraps rather than stopping because a continuous batting order is exactly
 * that — after the last batter the first one is up again, and in youth ball a
 * long inning goes round twice.
 */
export function nextBatter(game: Game): Game {
  if (!game.liveState) return game;
  const size = game.battingAssignments.length;
  if (size === 0) return game;
  return {
    ...game,
    liveState: {
      ...game.liveState,
      batterIndex: (game.liveState.batterIndex + 1) % size,
    },
  };
}

export function previousBatter(game: Game): Game {
  if (!game.liveState) return game;
  const size = game.battingAssignments.length;
  if (size === 0) return game;
  return {
    ...game,
    liveState: {
      ...game.liveState,
      batterIndex: (game.liveState.batterIndex - 1 + size) % size,
    },
  };
}

/** Who is up, on deck, and in the hole, in batting order. */
export function batterQueue(game: Game, count = 3): string[] {
  const order = [...game.battingAssignments].sort((a, b) => a.battingSlot - b.battingSlot);
  if (order.length === 0) return [];
  const start = currentBatterIndex(game) % order.length;
  return Array.from({ length: Math.min(count, order.length) }, (_, offset) =>
    order[(start + offset) % order.length].playerId,
  );
}
